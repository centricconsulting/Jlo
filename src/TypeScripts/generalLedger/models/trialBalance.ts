/**
 * trialBalance.ts
 * Pure helpers for the trial balance by subsidiary: account classification, period selection,
 * the pivot from summarized balances to rows by subsidiary, and CSV output.
 * See docs/developers/trial-balance-by-subsidiary.md.
 */

/** Dates are ISO `YYYY-MM-DD` strings throughout. */
export interface Period {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
}

export interface Account {
  id: number;
  number: string;
  name: string;
  /** NetSuite accttype, e.g. 'Bank', 'Income', 'NonPosting'. */
  type: string;
  isInactive: boolean;
  isSummary: boolean;
}

export interface Subsidiary {
  id: number;
  name: string;
  isElimination: boolean;
  /** Null for the top-level parent. */
  parentId: number | null;
}

/** One summarized search row: net (debit minus credit) for an account in a subsidiary. */
export interface BalanceRow {
  accountId: number;
  subsidiaryId: number;
  /** Net of all periods ending on or before the selected period's end. */
  cumulative: number;
  /** Net of periods from the fiscal year start through the selected period's end. */
  ytd: number;
}

export type AccountKind = 'balanceSheet' | 'incomeStatement' | 'excluded';

export interface TrialBalanceInput {
  accounts: Account[];
  subsidiaries: Subsidiary[];
  balances: BalanceRow[];
  retainedEarningsAccountId: number;
  showZeros: boolean;
}

export interface TrialBalanceRow {
  accountId: number;
  /** "31301 - Retained Earnings (system)". */
  label: string;
  /** One per entry in TrialBalance.subsidiaries, in that order. */
  amounts: number[];
  consolidated: number;
}

export interface TrialBalance {
  /** Column order: parent first, then the rest by name, eliminations last. */
  subsidiaries: Subsidiary[];
  /** Sorted by account number. */
  rows: TrialBalanceRow[];
  totals: { amounts: number[]; consolidated: number };
}

export interface TrialBalanceRequest {
  periodId: number | null;
  showZeros: boolean;
  action: 'form' | 'view' | 'csv';
}

const BALANCE_SHEET_TYPES = new Set([
  'Bank',
  'AcctRec',
  'OthCurrAsset',
  'FixedAsset',
  'OthAsset',
  'DeferExpense',
  'UnbilledRec',
  'AcctPay',
  'CredCard',
  'OthCurrLiab',
  'LongTermLiab',
  'DeferRevenue',
  'Equity',
]);

const INCOME_STATEMENT_TYPES = new Set(['Income', 'COGS', 'Expense', 'OthIncome', 'OthExpense']);

/** Balance sheet, income statement, or excluded (NonPosting, Stat, unknown). */
export function accountKind(type: string): AccountKind {
  if (BALANCE_SHEET_TYPES.has(type)) return 'balanceSheet';
  if (INCOME_STATEMENT_TYPES.has(type)) return 'incomeStatement';
  return 'excluded';
}

/** The most recent period whose end date is before `today`; null if none has ended. */
export function defaultPeriod(periods: Period[], today: string): Period | null {
  let best: Period | null = null;
  for (const period of periods) {
    if (period.endDate < today && (best === null || period.endDate > best.endDate)) {
      best = period;
    }
  }
  return best;
}

/** Integer cents, so sums don't drift. */
function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Back to a 2-decimal number; `|| 0` turns -0 into 0. */
function fromCents(cents: number): number {
  return cents / 100 || 0;
}

/** Parent (no parentId) first, then the rest by name, eliminations last. */
function columnRank(sub: Subsidiary): number {
  if (sub.parentId === null) return 0;
  return sub.isElimination ? 2 : 1;
}

function accountLabel(account: Account): string {
  return account.number ? `${account.number} - ${account.name}` : account.name;
}

/** Pivots summarized balances into rows by account with a column per subsidiary, applying the trial balance rules. */
export function buildTrialBalance(input: TrialBalanceInput): TrialBalance {
  const subsidiaries = [...input.subsidiaries].sort(
    (a, b) => columnRank(a) - columnRank(b) || a.name.localeCompare(b.name) || a.id - b.id,
  );
  const columnOf = new Map<number, number>();
  subsidiaries.forEach((sub, index) => columnOf.set(sub.id, index));

  const accountsById = new Map<number, Account>();
  for (const account of input.accounts) accountsById.set(account.id, account);

  const reId = input.retainedEarningsAccountId;
  const reAccount = accountsById.get(reId);
  const isIncluded = (account: Account): boolean => account.id === reId || accountKind(account.type) !== 'excluded';

  const centsByAccount = new Map<number, number[]>();
  const centsFor = (accountId: number): number[] => {
    let cents = centsByAccount.get(accountId);
    if (!cents) {
      cents = subsidiaries.map(() => 0);
      centsByAccount.set(accountId, cents);
    }
    return cents;
  };

  for (const row of input.balances) {
    const account = accountsById.get(row.accountId);
    const column = columnOf.get(row.subsidiaryId);
    if (!account || column === undefined || !isIncluded(account)) continue;

    const kind = accountKind(account.type);
    if (account.id === reId || kind === 'balanceSheet') {
      centsFor(account.id)[column] += toCents(row.cumulative);
    } else {
      // Income statement: fiscal YTD here, prior years roll into retained earnings.
      centsFor(account.id)[column] += toCents(row.ytd);
      if (reAccount) {
        centsFor(reId)[column] += toCents(row.cumulative) - toCents(row.ytd);
      }
    }
  }

  if (input.showZeros) {
    for (const account of input.accounts) {
      if (!account.isInactive && !account.isSummary && accountKind(account.type) !== 'excluded') {
        centsFor(account.id);
      }
    }
  }

  const rowAccounts = [...centsByAccount.keys()]
    .map((id) => accountsById.get(id) as Account)
    .filter((account) => input.showZeros || centsByAccount.get(account.id)!.some((cents) => cents !== 0))
    .sort(
      (a, b) =>
        a.number.localeCompare(b.number, undefined, { numeric: true }) || a.name.localeCompare(b.name) || a.id - b.id,
    );

  const totalCents = subsidiaries.map(() => 0);
  const rows: TrialBalanceRow[] = rowAccounts.map((account) => {
    const cents = centsByAccount.get(account.id)!;
    cents.forEach((value, index) => (totalCents[index] += value));
    return {
      accountId: account.id,
      label: accountLabel(account),
      amounts: cents.map(fromCents),
      consolidated: fromCents(cents.reduce((sum, value) => sum + value, 0)),
    };
  });

  return {
    subsidiaries,
    rows,
    totals: {
      amounts: totalCents.map(fromCents),
      consolidated: fromCents(totalCents.reduce((sum, value) => sum + value, 0)),
    },
  };
}

/** RFC 4180: quote a field holding a comma, quote, or line break, doubling inner quotes. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Text cells starting with = + - @ get a leading apostrophe so spreadsheets don't read them as formulas. */
function csvText(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvAmount(amount: number): string {
  return (amount || 0).toFixed(2);
}

/** The table as CSV: a title block (title, period), a header row, account rows, then a totals row. */
export function toCsv(tb: TrialBalance, periodName: string): string {
  const line = (fields: string[]): string => fields.map(csvField).join(',');
  const lines = [
    line(['Trial Balance by Subsidiary']),
    line([`Period: ${periodName}`]),
    '',
    line(['Account', ...tb.subsidiaries.map((sub) => csvText(sub.name)), 'Consolidated']),
    ...tb.rows.map((row) => line([csvText(row.label), ...row.amounts.map(csvAmount), csvAmount(row.consolidated)])),
    line(['Total', ...tb.totals.amounts.map(csvAmount), csvAmount(tb.totals.consolidated)]),
  ];
  return lines.join('\r\n');
}

/** Reads Suitelet parameters (`periodid`, `showzeros`, `action`); malformed input falls back to the form. */
export function parseRequest(params: Record<string, string | undefined>): TrialBalanceRequest {
  const rawPeriod = (params.periodid ?? '').trim();
  const periodId = /^\d+$/.test(rawPeriod) && Number(rawPeriod) > 0 ? Number(rawPeriod) : null;
  const showZeros = params.showzeros === 'T' || params.showzeros === 'true';
  let action: TrialBalanceRequest['action'] = 'form';
  if (periodId !== null) action = params.action === 'csv' ? 'csv' : 'view';
  return { periodId, showZeros, action };
}

/** "TrialBalance_P9_2026.csv"; characters outside [A-Za-z0-9_-] become underscores. */
export function csvFileName(periodName: string): string {
  return `TrialBalance_${periodName.replace(/[^A-Za-z0-9_-]/g, '_')}.csv`;
}
