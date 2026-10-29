/**
 * cen_jlo_gl_trial_balance_svc.ts
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @NAuthor cary.pruitt@centricconsulting.com
 * @NDescription Data access for the trial balance by subsidiary: periods, accounts and subsidiaries from SuiteQL, balances from a summarized transaction search. See docs/developers/trial-balance-by-subsidiary.md.
 */

import log = require('N/log');
import query = require('N/query');
import search = require('N/search');
import { Account, BalanceRow, buildTrialBalance, Period, Subsidiary, TrialBalance } from './models/trialBalance';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const NET_FORMULA = 'NVL({debitamount},0) - NVL({creditamount},0)';

type Row = Record<string, string | number | boolean | null>;

function runQuery(sql: string, params: Array<string | number> = []): Row[] {
  return query.runSuiteQL({ query: sql, params }).asMappedResults() as Row[];
}

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function bool(value: unknown): boolean {
  return value === true || value === 'T';
}

/**
 * Posting periods (not years or quarters), newest first. Inactive periods are left out of the dropdown
 * but kept for balances, since transactions posted to a period that was later inactivated still count.
 */
function queryPostingPeriods(includeInactive: boolean): Period[] {
  const rows = runQuery(
    `SELECT id, periodname, TO_CHAR(startdate, 'YYYY-MM-DD') AS start_date, TO_CHAR(enddate, 'YYYY-MM-DD') AS end_date
       FROM accountingperiod
      WHERE isyear = 'F' AND isquarter = 'F'${includeInactive ? '' : " AND isinactive = 'F'"}
      ORDER BY accountingperiod.startdate DESC`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: str(r.periodname),
    startDate: str(r.start_date),
    endDate: str(r.end_date),
  }));
}

/** Active posting periods for the dropdown, newest first, dates as ISO strings. */
export function listPeriods(): Period[] {
  return queryPostingPeriods(false);
}

/** ISO start date of the fiscal year containing the period. Throws if no fiscal year contains it. */
export function fiscalYearStart(periodId: number): string {
  const rows = runQuery(
    `SELECT TO_CHAR(y.startdate, 'YYYY-MM-DD') AS start_date
       FROM accountingperiod y, accountingperiod p
      WHERE p.id = ? AND y.isyear = 'T' AND y.startdate <= p.startdate AND y.enddate >= p.enddate`,
    [periodId],
  );
  const start = rows.length ? str(rows[0].start_date) : '';
  if (!ISO_DATE.test(start)) {
    throw new Error(`No fiscal year found for accounting period ${periodId}`);
  }
  return start;
}

export function listAccounts(): Account[] {
  const rows = runQuery(
    `SELECT id, acctnumber, accountsearchdisplaynamecopy AS name, accttype, isinactive, issummary FROM account`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    number: str(r.acctnumber),
    name: str(r.name),
    type: str(r.accttype),
    isInactive: bool(r.isinactive),
    isSummary: bool(r.issummary),
  }));
}

interface SubsidiaryRow extends Subsidiary {
  isInactive: boolean;
  currency: string;
}

function querySubsidiaries(): SubsidiaryRow[] {
  const rows = runQuery(`SELECT id, name, iselimination, parent, isinactive, currency FROM subsidiary`);
  return rows.map((r) => ({
    id: Number(r.id),
    name: str(r.name),
    isElimination: bool(r.iselimination),
    parentId: r.parent === null || r.parent === undefined || r.parent === '' ? null : Number(r.parent),
    isInactive: bool(r.isinactive),
    currency: str(r.currency),
  }));
}

/** Active subsidiaries. */
export function listSubsidiaries(): Subsidiary[] {
  return querySubsidiaries()
    .filter((s) => !s.isInactive)
    .map(({ id, name, isElimination, parentId }) => ({ id, name, isElimination, parentId }));
}

/**
 * Columns for the report: active subsidiaries plus any inactive one that still carries balances, so its amounts
 * stay in Consolidated. Throws when the subsidiaries don't share one currency, since Consolidated sums the
 * columns without translation.
 */
export function reportSubsidiaries(balances: BalanceRow[]): Subsidiary[] {
  const all = querySubsidiaries();
  const currencies = new Set(all.map((s) => s.currency));
  if (currencies.size > 1) {
    throw new Error('Subsidiaries use more than one base currency; the Consolidated column would add unconverted amounts.');
  }
  const withBalances = new Set(balances.map((b) => b.subsidiaryId));
  return all
    .filter((s) => !s.isInactive || withBalances.has(s.id))
    .map(({ id, name, isElimination, parentId }) => ({ id, name, isElimination, parentId }));
}

/**
 * Internal id of Retained Earnings (system): by special account type, then by name. Throws if neither finds exactly
 * one account, because rolling prior-year income into the wrong account would still look balanced.
 * sspecacct is wrapped in its own try because SuiteQL rejects the query outright if the column is not exposed.
 */
export function retainedEarningsAccountId(): number {
  const lookups: Array<[string, string]> = [
    [`SELECT id FROM account WHERE sspecacct = 'RetEarnings'`, 'special account type'],
    [`SELECT id FROM account WHERE accountsearchdisplaynamecopy = 'Retained Earnings (system)'`, 'name'],
  ];
  for (const [sql, how] of lookups) {
    try {
      const rows = runQuery(sql);
      if (rows.length === 1) {
        return Number(rows[0].id);
      }
    } catch (e) {
      log.debug({ title: `Retained earnings lookup by ${how} failed`, details: (e as Error).message });
    }
  }
  throw new Error('Retained Earnings (system) account not found.');
}

/** Ids of the periods ending on or before the selected period's end. */
export function periodIdsThrough(period: Period, periods: Period[]): number[] {
  return periods.filter((p) => p.endDate <= period.endDate).map((p) => p.id);
}

/** The YTD formula: net of posting lines in periods starting on or after the fiscal year start. Rejects anything but YYYY-MM-DD. */
export function ytdFormula(fiscalYearStartIso: string): string {
  if (!ISO_DATE.test(fiscalYearStartIso)) {
    throw new Error(`Invalid fiscal year start: ${fiscalYearStartIso}`);
  }
  return `CASE WHEN {accountingperiod.startdate} >= TO_DATE('${fiscalYearStartIso}','YYYY-MM-DD') THEN ${NET_FORMULA} ELSE 0 END`;
}

/** Net (debit minus credit) by account and subsidiary, cumulative and fiscal YTD, through the selected period. */
export function loadBalances(period: Period, fiscalYearStartIso: string, periods: Period[]): BalanceRow[] {
  const formula = ytdFormula(fiscalYearStartIso);
  const periodIds = periodIdsThrough(period, periods);
  if (!periodIds.length) {
    return [];
  }

  const accountCol = search.createColumn({ name: 'account', summary: search.Summary.GROUP });
  const subsidiaryCol = search.createColumn({ name: 'subsidiary', summary: search.Summary.GROUP });
  const cumulativeCol = search.createColumn({ name: 'formulacurrency', summary: search.Summary.SUM, formula: NET_FORMULA });
  const ytdCol = search.createColumn({ name: 'formulacurrency', summary: search.Summary.SUM, formula });

  // NOTE: 'postingperiod anyof' matches no rows on a summarized transaction search; the period join does.
  const balanceSearch = search.create({
    type: 'transaction',
    filters: [['posting', 'is', 'T'], 'and', ['accountingperiod.internalid', 'anyof', periodIds.map(String)]],
    columns: [accountCol, subsidiaryCol, cumulativeCol, ytdCol],
  });

  const rows: BalanceRow[] = [];
  const paged = balanceSearch.runPaged({ pageSize: 1000 });
  paged.pageRanges.forEach((range) => {
    paged.fetch({ index: range.index }).data.forEach((result) => {
      const accountId = str(result.getValue(accountCol));
      if (!accountId) {
        return;
      }
      rows.push({
        accountId: Number(accountId),
        subsidiaryId: Number(result.getValue(subsidiaryCol)),
        cumulative: Number(result.getValue(cumulativeCol)) || 0,
        ytd: Number(result.getValue(ytdCol)) || 0,
      });
    });
  });
  return rows;
}

/** Runs the whole report for a period. Throws if the period does not exist. */
export function runTrialBalance(periodId: number, showZeros: boolean): { period: Period; tb: TrialBalance } {
  const periods = queryPostingPeriods(true);
  const period = periods.find((p) => p.id === periodId);
  if (!period) {
    throw new Error(`Accounting period ${periodId} not found`);
  }
  const balances = loadBalances(period, fiscalYearStart(periodId), periods);
  const tb = buildTrialBalance({
    accounts: listAccounts(),
    subsidiaries: reportSubsidiaries(balances),
    balances,
    retainedEarningsAccountId: retainedEarningsAccountId(),
    showZeros,
  });
  return { period, tb };
}
