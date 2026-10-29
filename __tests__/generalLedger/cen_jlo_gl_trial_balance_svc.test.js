/**
 * Unit tests for cen_jlo_gl_trial_balance_svc (data access for the trial balance by subsidiary).
 */
jest.mock('N/query', () => ({ runSuiteQL: jest.fn() }), { virtual: true });
jest.mock('N/search', () => ({
	Summary: { GROUP: 'GROUP', SUM: 'SUM' },
	createColumn: jest.fn((opts) => ({ ...opts })),
	create: jest.fn(),
}), { virtual: true });
jest.mock('N/log', () => ({ debug: jest.fn(), audit: jest.fn(), error: jest.fn() }), { virtual: true });
jest.mock('SuiteScripts/generalLedger/models/trialBalance', () => ({ buildTrialBalance: jest.fn() }));

const query = require('N/query');
const search = require('N/search');
const svc = require('SuiteScripts/generalLedger/cen_jlo_gl_trial_balance_svc');

function mockQuery(rows) {
	query.runSuiteQL.mockReturnValueOnce({ asMappedResults: () => rows });
}

const periods = [
	{ id: 30, name: 'P10 2026', startDate: '2026-10-05', endDate: '2026-11-01' },
	{ id: 29, name: 'P9 2026', startDate: '2026-08-31', endDate: '2026-10-04' },
	{ id: 28, name: 'P8 2026', startDate: '2026-08-03', endDate: '2026-08-30' },
];

/** A fake search whose results return values by column object identity. */
function mockSearch(rows) {
	const created = {};
	search.create.mockImplementation((opts) => {
		created.opts = opts;
		const [account, subsidiary, cumulative, ytd] = opts.columns;
		const results = rows.map((r) => ({
			getValue: (col) => ({ [0]: r.account, [1]: r.subsidiary, [2]: r.cumulative, [3]: r.ytd })[[account, subsidiary, cumulative, ytd].indexOf(col)],
		}));
		return {
			runPaged: jest.fn(() => ({
				pageRanges: [{ index: 0 }],
				fetch: () => ({ data: results }),
			})),
		};
	});
	return created;
}

beforeEach(() => {
	query.runSuiteQL.mockReset();
	search.create.mockReset();
});

describe('listPeriods', () => {
	it('maps ISO dates from TO_CHAR and filters to active posting periods', () => {
		mockQuery([{ id: 29, periodname: 'P9 2026', start_date: '2026-08-31', end_date: '2026-10-04' }]);

		expect(svc.listPeriods()).toEqual([{ id: 29, name: 'P9 2026', startDate: '2026-08-31', endDate: '2026-10-04' }]);
		const sql = query.runSuiteQL.mock.calls[0][0].query;
		expect(sql).toMatch(/TO_CHAR\(startdate, 'YYYY-MM-DD'\)/);
		expect(sql).toMatch(/isyear = 'F' AND isquarter = 'F' AND isinactive = 'F'/);
		expect(sql).toMatch(/ORDER BY accountingperiod.startdate DESC/);
	});
});

describe('fiscalYearStart', () => {
	it('returns the containing fiscal year start', () => {
		mockQuery([{ start_date: '2026-01-05' }]);
		expect(svc.fiscalYearStart(29)).toBe('2026-01-05');
		expect(query.runSuiteQL.mock.calls[0][0].params).toEqual([29]);
	});

	it('throws when no fiscal year contains the period', () => {
		mockQuery([]);
		expect(() => svc.fiscalYearStart(29)).toThrow(/No fiscal year/);
	});
});

describe('listAccounts and listSubsidiaries', () => {
	it('converts T/F flags and null parents', () => {
		mockQuery([{ id: 52, acctnumber: '31301', name: 'Retained Earnings (system)', accttype: 'Equity', isinactive: 'F', issummary: 'F' }]);
		expect(svc.listAccounts()).toEqual([
			{ id: 52, number: '31301', name: 'Retained Earnings (system)', type: 'Equity', isInactive: false, isSummary: false },
		]);

		mockQuery([
			{ id: 1, name: 'JLo Beauty & Lifestyle, LLC', iselimination: 'F', parent: null, isinactive: 'F', currency: 1 },
			{ id: 6, name: 'JLBL Elims', iselimination: 'T', parent: 1, isinactive: 'F', currency: 1 },
			{ id: 9, name: 'Old Sub', iselimination: 'F', parent: 1, isinactive: 'T', currency: 1 },
		]);
		expect(svc.listSubsidiaries()).toEqual([
			{ id: 1, name: 'JLo Beauty & Lifestyle, LLC', isElimination: false, parentId: null },
			{ id: 6, name: 'JLBL Elims', isElimination: true, parentId: 1 },
		]);
	});
});

describe('reportSubsidiaries', () => {
	const subs = [
		{ id: 1, name: 'Parent', iselimination: 'F', parent: null, isinactive: 'F', currency: 1 },
		{ id: 8, name: 'Dormant', iselimination: 'F', parent: 1, isinactive: 'T', currency: 1 },
		{ id: 9, name: 'Closed', iselimination: 'F', parent: 1, isinactive: 'T', currency: 1 },
	];

	it('keeps an inactive subsidiary only when it carries balances', () => {
		mockQuery(subs);
		const ids = svc.reportSubsidiaries([{ accountId: 1, subsidiaryId: 9, cumulative: 5, ytd: 0 }]).map((s) => s.id);
		expect(ids).toEqual([1, 9]);
	});

	it('throws when subsidiaries use different currencies', () => {
		mockQuery([subs[0], { ...subs[1], isinactive: 'F', currency: 2 }]);
		expect(() => svc.reportSubsidiaries([])).toThrow(/more than one base currency/);
	});
});

describe('retainedEarningsAccountId', () => {
	it('uses the special account type when available', () => {
		mockQuery([{ id: 52 }]);
		expect(svc.retainedEarningsAccountId()).toBe(52);
	});

	it('falls back to the name, then throws', () => {
		query.runSuiteQL.mockImplementationOnce(() => { throw new Error('Unknown column sspecacct'); });
		mockQuery([{ id: 77 }]);
		expect(svc.retainedEarningsAccountId()).toBe(77);

		mockQuery([]);
		mockQuery([]);
		expect(() => svc.retainedEarningsAccountId()).toThrow(/Retained Earnings \(system\) account not found/);
	});
});

describe('periodIdsThrough', () => {
	it('selects periods ending on or before the selected period end', () => {
		expect(svc.periodIdsThrough(periods[1], periods)).toEqual([29, 28]);
		expect(svc.periodIdsThrough(periods[2], periods)).toEqual([28]);
	});
});

describe('ytdFormula', () => {
	it('embeds the fiscal year start in a TO_DATE literal', () => {
		expect(svc.ytdFormula('2026-01-05')).toBe(
			"CASE WHEN {accountingperiod.startdate} >= TO_DATE('2026-01-05','YYYY-MM-DD') THEN NVL({debitamount},0) - NVL({creditamount},0) ELSE 0 END"
		);
	});

	it.each(['01/05/2026', "2026-01-05') OR 1=1 --", '', '2026-1-5'])('rejects %p', (bad) => {
		expect(() => svc.ytdFormula(bad)).toThrow(/Invalid fiscal year start/);
	});
});

describe('loadBalances', () => {
	it('builds the summarized search and maps rows, skipping empty accounts', () => {
		const created = mockSearch([
			{ account: '101', subsidiary: '1', cumulative: '1500.25', ytd: '200' },
			{ account: '', subsidiary: '1', cumulative: '9', ytd: '9' },
			{ account: '401', subsidiary: '5', cumulative: '-75', ytd: '' },
		]);

		const rows = svc.loadBalances(periods[1], '2026-01-05', periods);

		expect(rows).toEqual([
			{ accountId: 101, subsidiaryId: 1, cumulative: 1500.25, ytd: 200 },
			{ accountId: 401, subsidiaryId: 5, cumulative: -75, ytd: 0 },
		]);
		expect(created.opts.type).toBe('transaction');
		expect(created.opts.filters).toEqual([['posting', 'is', 'T'], 'and', ['accountingperiod.internalid', 'anyof', ['29', '28']]]);
		expect(created.opts.columns.map((c) => [c.name, c.summary])).toEqual([
			['account', 'GROUP'], ['subsidiary', 'GROUP'], ['formulacurrency', 'SUM'], ['formulacurrency', 'SUM'],
		]);
		expect(created.opts.columns[2].formula).toBe('NVL({debitamount},0) - NVL({creditamount},0)');
		expect(created.opts.columns[3].formula).toContain("TO_DATE('2026-01-05','YYYY-MM-DD')");
	});

	it('rejects a bad fiscal year start before searching', () => {
		expect(() => svc.loadBalances(periods[1], 'bad', periods)).toThrow(/Invalid fiscal year start/);
		expect(search.create).not.toHaveBeenCalled();
	});
});
