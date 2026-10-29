/**
 * cen_jlo_gl_trial_balance_svc.ts
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @NAuthor cary.pruitt@centricconsulting.com
 * @NDescription Data access for the trial balance by subsidiary: periods, accounts and subsidiaries from SuiteQL, balances from a summarized transaction search. See docs/developers/trial-balance-by-subsidiary.md.
 */
define(["require", "exports", "N/log", "N/query", "N/search", "./models/trialBalance"], function (require, exports, log, query, search, trialBalance_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.listPeriods = listPeriods;
    exports.fiscalYearStart = fiscalYearStart;
    exports.listAccounts = listAccounts;
    exports.listSubsidiaries = listSubsidiaries;
    exports.reportSubsidiaries = reportSubsidiaries;
    exports.retainedEarningsAccountId = retainedEarningsAccountId;
    exports.periodIdsThrough = periodIdsThrough;
    exports.ytdFormula = ytdFormula;
    exports.loadBalances = loadBalances;
    exports.runTrialBalance = runTrialBalance;
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
    const NET_FORMULA = 'NVL({debitamount},0) - NVL({creditamount},0)';
    function runQuery(sql, params = []) {
        return query.runSuiteQL({ query: sql, params }).asMappedResults();
    }
    function str(value) {
        return value === null || value === undefined ? '' : String(value);
    }
    function bool(value) {
        return value === true || value === 'T';
    }
    /**
     * Posting periods (not years or quarters), newest first. Inactive periods are left out of the dropdown
     * but kept for balances, since transactions posted to a period that was later inactivated still count.
     */
    function queryPostingPeriods(includeInactive) {
        const rows = runQuery(`SELECT id, periodname, TO_CHAR(startdate, 'YYYY-MM-DD') AS start_date, TO_CHAR(enddate, 'YYYY-MM-DD') AS end_date
       FROM accountingperiod
      WHERE isyear = 'F' AND isquarter = 'F'${includeInactive ? '' : " AND isinactive = 'F'"}
      ORDER BY accountingperiod.startdate DESC`);
        return rows.map((r) => ({
            id: Number(r.id),
            name: str(r.periodname),
            startDate: str(r.start_date),
            endDate: str(r.end_date),
        }));
    }
    /** Active posting periods for the dropdown, newest first, dates as ISO strings. */
    function listPeriods() {
        return queryPostingPeriods(false);
    }
    /** ISO start date of the fiscal year containing the period. Throws if no fiscal year contains it. */
    function fiscalYearStart(periodId) {
        const rows = runQuery(`SELECT TO_CHAR(y.startdate, 'YYYY-MM-DD') AS start_date
       FROM accountingperiod y, accountingperiod p
      WHERE p.id = ? AND y.isyear = 'T' AND y.startdate <= p.startdate AND y.enddate >= p.enddate`, [periodId]);
        const start = rows.length ? str(rows[0].start_date) : '';
        if (!ISO_DATE.test(start)) {
            throw new Error(`No fiscal year found for accounting period ${periodId}`);
        }
        return start;
    }
    function listAccounts() {
        const rows = runQuery(`SELECT id, acctnumber, accountsearchdisplaynamecopy AS name, accttype, isinactive, issummary FROM account`);
        return rows.map((r) => ({
            id: Number(r.id),
            number: str(r.acctnumber),
            name: str(r.name),
            type: str(r.accttype),
            isInactive: bool(r.isinactive),
            isSummary: bool(r.issummary),
        }));
    }
    function querySubsidiaries() {
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
    function listSubsidiaries() {
        return querySubsidiaries()
            .filter((s) => !s.isInactive)
            .map(({ id, name, isElimination, parentId }) => ({ id, name, isElimination, parentId }));
    }
    /**
     * Columns for the report: active subsidiaries plus any inactive one that still carries balances, so its amounts
     * stay in Consolidated. Throws when the subsidiaries don't share one currency, since Consolidated sums the
     * columns without translation.
     */
    function reportSubsidiaries(balances) {
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
    function retainedEarningsAccountId() {
        const lookups = [
            [`SELECT id FROM account WHERE sspecacct = 'RetEarnings'`, 'special account type'],
            [`SELECT id FROM account WHERE accountsearchdisplaynamecopy = 'Retained Earnings (system)'`, 'name'],
        ];
        for (const [sql, how] of lookups) {
            try {
                const rows = runQuery(sql);
                if (rows.length === 1) {
                    return Number(rows[0].id);
                }
            }
            catch (e) {
                log.debug({ title: `Retained earnings lookup by ${how} failed`, details: e.message });
            }
        }
        throw new Error('Retained Earnings (system) account not found.');
    }
    /** Ids of the periods ending on or before the selected period's end. */
    function periodIdsThrough(period, periods) {
        return periods.filter((p) => p.endDate <= period.endDate).map((p) => p.id);
    }
    /** The YTD formula: net of posting lines in periods starting on or after the fiscal year start. Rejects anything but YYYY-MM-DD. */
    function ytdFormula(fiscalYearStartIso) {
        if (!ISO_DATE.test(fiscalYearStartIso)) {
            throw new Error(`Invalid fiscal year start: ${fiscalYearStartIso}`);
        }
        return `CASE WHEN {accountingperiod.startdate} >= TO_DATE('${fiscalYearStartIso}','YYYY-MM-DD') THEN ${NET_FORMULA} ELSE 0 END`;
    }
    /** Net (debit minus credit) by account and subsidiary, cumulative and fiscal YTD, through the selected period. */
    function loadBalances(period, fiscalYearStartIso, periods) {
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
        const rows = [];
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
    function runTrialBalance(periodId, showZeros) {
        const periods = queryPostingPeriods(true);
        const period = periods.find((p) => p.id === periodId);
        if (!period) {
            throw new Error(`Accounting period ${periodId} not found`);
        }
        const balances = loadBalances(period, fiscalYearStart(periodId), periods);
        const tb = (0, trialBalance_1.buildTrialBalance)({
            accounts: listAccounts(),
            subsidiaries: reportSubsidiaries(balances),
            balances,
            retainedEarningsAccountId: retainedEarningsAccountId(),
            showZeros,
        });
        return { period, tb };
    }
});
