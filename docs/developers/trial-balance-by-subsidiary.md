# Trial Balance by Subsidiary

A Suitelet that shows a JLo trial balance with every account down the rows and each subsidiary across the columns, plus a consolidated column, for a period the user picks. Requested by JLo accounting, October 2026 (Notion TASK-325). It replaces pasting four per-subsidiary runs of the native Trial Balance into Excel.

## Files

| Layer | Path |
|---|---|
| Suitelet (form, results, CSV) | `src/TypeScripts/generalLedger/cen_jlo_gl_trial_balance_sl.ts` |
| Service (N/query, N/search) | `src/TypeScripts/generalLedger/cen_jlo_gl_trial_balance_svc.ts` |
| Pure model | `src/TypeScripts/generalLedger/models/trialBalance.ts` |
| Script object | `src/Objects/suitelet/customscript_cen_jlo_gl_trial_balance_sl.xml` |
| Tests | `__tests__/generalLedger/` |

Script id `customscript_cen_jlo_gl_trial_balance_sl`, deployment `customdeploy_cen_jlo_gl_trial_balance_sl`.

## Account facts (sandbox, 2026-10-29)

- Subsidiaries, all USD: 1 JLo Beauty & Lifestyle, LLC (parent), 5 JLBL Holdings LLC, 7 JLBL Productions LLC, 6 JLBL Elims (elimination). No currency translation, so Consolidated is the sum of the subsidiary columns.
- One accounting book (1, primary).
- 4-4-5 fiscal calendar. Fiscal years don't start on Jan 1 (FY 2026 runs 2026-01-05 to 2027-01-03). Periods sit under quarters under years. No adjustment periods.
- Retained Earnings (system) is account 52 (`31301`). NetSuite computes it; nothing posts to it.
- Account types in use: Bank, AcctRec, OthCurrAsset, FixedAsset, OthAsset, DeferExpense, AcctPay, OthCurrLiab, LongTermLiab, Equity (balance sheet); Income, COGS, Expense, OthIncome, OthExpense (income statement); NonPosting (excluded).
- Accounting and Finance roles: 1021 Accounting Manager, 1143 Accounting Staff, 1144 Controller, Accounting, 1145 Director, Finance, 1141 CFO, plus Administrator.

## How a balance is computed

For a selected period P with fiscal year start FYS:

| Account kind | Amount |
|---|---|
| Balance sheet | Net (debit minus credit) of every posting line in periods ending on or before P's end |
| Income statement | Net of posting lines in periods starting on or after FYS and ending on or before P's end (fiscal YTD) |
| Retained Earnings (system) | Its own postings (normally none) plus the net of every income statement account before FYS |
| NonPosting, statistical | Excluded |

Amounts are net, debit positive and credit negative, matching the native Trial Balance's Total view. Every subsidiary column sums to zero.

## Data access

Balances come from one transaction saved search, created in script, summarized by account and subsidiary:

- filters: `posting is T`, `accountingperiod.internalid anyof <ids of periods ending on or before P>` (`postingperiod anyof` matches nothing on this summarized search)
- columns: account (GROUP), subsidiary (GROUP), `SUM(NVL({debitamount},0) - NVL({creditamount},0))` as cumulative, and the same wrapped in `CASE WHEN {accountingperiod.startdate} >= TO_DATE('<FYS>','YYYY-MM-DD')` as YTD.

The search takes about 17 to 22 s over full history in sandbox; a full run of the Suitelet takes about 37 s. The equivalent SuiteQL over `transactionaccountingline` took 140 s, which is why balances don't use SuiteQL. The search's plain `amount` column is sign-flipped for credit-normal accounts, so the formula uses debit and credit amounts instead.

Periods, accounts and subsidiaries come from SuiteQL (each under a second).

Guards, so a wrong number never looks right:
- Retained Earnings (system) is found by special account type, then by name; the report fails if neither finds exactly one account.
- The report fails if subsidiaries don't share one base currency, since Consolidated adds the columns without translation.
- An inactive subsidiary that still carries balances keeps its column, so Consolidated stays complete.

## Behavior

- Period dropdown: posting periods (not years or quarters), newest first. Defaults to the most recent period that has ended.
- "Show zero balances": off shows only accounts with a non-zero amount in some column; on adds every active posting account.
- Columns: one per subsidiary (parent first, then others by name, elimination last), then Consolidated. A totals row ends the table.
- Export CSV returns the same table as a file.
- Access: the deployment's audience is the Accounting and Finance roles above plus Administrator. It runs as the user's role. All five roles have Find Transaction, Accounts and Trial Balance permissions and no subsidiary restriction (sandbox, 2026-10-29). CFO (1141) has no Subsidiaries list permission, which the subsidiary lookup may need; confirm with a CFO user.
- Menu link: Financial > Reports > Trial Balance by Subsidiary in the Accounting Center (`ACCOUNTCENTERFINANCIALREPORTS`), which every audience role uses. Administrator is on the Classic Center and opens it from the deployment URL. Its place in the menu, right after Trial Balance, was set by hand on the deployment record (Links > Insert Before: Post Closing Trial Balance), because SDF doesn't carry Insert Before. If a redeploy drops it to the bottom of the menu, set it again there.

## Verification

Tie-out is against the native Trial Balance (custom report cr=292, Debit/Credit view netted) run once per subsidiary and once consolidated, in sandbox, for P9 2026 (open), P12 2025 (year end) and P1 2026 (first period of a fiscal year). On 2026-10-29 all 1,004 non-zero native balances matched the Suitelet's CSV to the cent, with no extra rows, and every column totaled zero.

The comparison ran in the browser against the deployed Suitelet: the native report rows were read from the page, then compared to `?periodid=<id>&action=csv` output.
