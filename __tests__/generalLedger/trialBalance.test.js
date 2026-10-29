/**
 * Unit tests for the trial balance by subsidiary model (pure helpers, no N/* imports).
 */
const {
	accountKind,
	defaultPeriod,
	buildTrialBalance,
	toCsv,
	parseRequest,
	csvFileName,
} = require('SuiteScripts/generalLedger/models/trialBalance');
const sample = require('./fixtures/sample');

const sub = (id, name, extra = {}) => ({ id, name, isElimination: false, parentId: 1, ...extra });
const isNegativeZero = (value) => Object.is(value, -0);

describe('accountKind', () => {
	it.each([
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
	])('classifies %s as balance sheet', (type) => {
		expect(accountKind(type)).toBe('balanceSheet');
	});

	it.each(['Income', 'COGS', 'Expense', 'OthIncome', 'OthExpense'])('classifies %s as income statement', (type) => {
		expect(accountKind(type)).toBe('incomeStatement');
	});

	it.each(['NonPosting', 'Stat', '', 'Mystery', 'bank'])('excludes %p', (type) => {
		expect(accountKind(type)).toBe('excluded');
	});
});

describe('defaultPeriod', () => {
	it('picks the most recent period that ended before today, whatever the input order', () => {
		expect(defaultPeriod(sample.periods, '2026-10-29').name).toBe('P9 2026');
	});

	it('does not count a period ending today as ended', () => {
		expect(defaultPeriod(sample.periods, '2026-10-04').name).toBe('P8 2026');
		expect(defaultPeriod(sample.periods, '2026-10-05').name).toBe('P9 2026');
	});

	it('returns null when no period has ended', () => {
		expect(defaultPeriod(sample.periods, '2026-08-30')).toBeNull();
		expect(defaultPeriod([], '2026-10-29')).toBeNull();
	});
});

describe('buildTrialBalance', () => {
	describe('with the balanced sample', () => {
		const tb = buildTrialBalance(sample.input());

		it('orders columns parent first, then by name, eliminations last', () => {
			expect(tb.subsidiaries.map((s) => s.id)).toEqual([1, 5, 7, 6]);
		});

		it('does not reorder the caller\'s subsidiary array', () => {
			expect(sample.subsidiaries.map((s) => s.id)).toEqual([7, 6, 5, 1]);
		});

		it('produces the expected rows sorted by account number', () => {
			expect(tb.rows).toEqual(sample.expectedRows);
		});

		it('uses cumulative for balance sheet accounts and YTD for income statement accounts', () => {
			const byId = new Map(tb.rows.map((row) => [row.accountId, row]));
			expect(byId.get(1).amounts[0]).toBe(1000); // cumulative, not the 300 YTD
			expect(byId.get(5).amounts[0]).toBe(-1500); // YTD, not the -2000 cumulative
		});

		it('rolls prior-year income statement activity into retained earnings per subsidiary, on top of its own postings', () => {
			const re = tb.rows.find((row) => row.accountId === sample.RETAINED_EARNINGS_ID);
			// Parent: (-2000 - -1500) + (800 - 600) + (300 - 100) = -100. Productions: own 25 + (40 - 10) = 55.
			expect(re.amounts).toEqual([-100, 0, 55, 0]);
			expect(re.consolidated).toBe(-45);
		});

		it('ignores rows for no account, excluded accounts, unknown accounts, and unknown subsidiaries', () => {
			const ids = tb.rows.map((row) => row.accountId);
			expect(ids).not.toContain(0);
			expect(ids).not.toContain(8);
			expect(ids).not.toContain(999);
			expect(tb.rows.find((row) => row.accountId === 1).consolidated).toBe(1300);
		});

		it('totals every column to zero', () => {
			expect(tb.totals).toEqual({ amounts: [0, 0, 0, 0], consolidated: 0 });
			tb.totals.amounts.forEach((value) => expect(isNegativeZero(value)).toBe(false));
		});

		it('makes consolidated the sum of the subsidiary columns', () => {
			for (const row of tb.rows) {
				const sum = row.amounts.reduce((a, b) => a + b, 0);
				expect(row.consolidated).toBeCloseTo(sum, 10);
			}
		});
	});

	describe('showZeros', () => {
		it('off keeps only accounts with a non-zero amount', () => {
			const tb = buildTrialBalance(sample.input());
			expect(tb.rows.some((row) => row.accountId === 11)).toBe(false);
		});

		it('on adds active, non-summary, posting accounts with zeros, numerically sorted', () => {
			const tb = buildTrialBalance(sample.input({ showZeros: true }));
			expect(tb.rows[0]).toEqual({
				accountId: 11,
				label: '9100 - Petty Cash',
				amounts: [0, 0, 0, 0],
				consolidated: 0,
			});
			expect(tb.rows.slice(1)).toEqual(sample.expectedRows);
		});

		it('on still leaves out inactive, summary, and excluded accounts with no balance', () => {
			const ids = buildTrialBalance(sample.input({ showZeros: true })).rows.map((row) => row.accountId);
			expect(ids).not.toContain(9);
			expect(ids).not.toContain(10);
			expect(ids).not.toContain(8);
		});

		it('keeps an inactive account that still has a balance', () => {
			const tb = buildTrialBalance(
				sample.input({
					balances: [
						{ accountId: 9, subsidiaryId: 1, cumulative: 5, ytd: 5 },
						{ accountId: 1, subsidiaryId: 1, cumulative: -5, ytd: -5 },
					],
				}),
			);
			expect(tb.rows.map((row) => row.accountId)).toEqual([1, 9]);
		});

		it('includes retained earnings when it has an amount even if its type would be excluded', () => {
			const accounts = sample.accounts.map((a) =>
				a.id === sample.RETAINED_EARNINGS_ID ? { ...a, type: 'NonPosting', isInactive: true } : a,
			);
			const tb = buildTrialBalance(sample.input({ accounts }));
			expect(tb.rows.find((row) => row.accountId === sample.RETAINED_EARNINGS_ID).amounts).toEqual([-100, 0, 55, 0]);
			const zeroTb = buildTrialBalance(sample.input({ accounts, balances: [], showZeros: true }));
			expect(zeroTb.rows.some((row) => row.accountId === sample.RETAINED_EARNINGS_ID)).toBe(false);
		});
	});

	it('sums in cents so 0.1 + 0.2 is 0.3', () => {
		const tb = buildTrialBalance(
			sample.input({
				subsidiaries: [sub(1, 'Parent', { parentId: null })],
				balances: [
					{ accountId: 1, subsidiaryId: 1, cumulative: 0.1, ytd: 0 },
					{ accountId: 1, subsidiaryId: 1, cumulative: 0.2, ytd: 0 },
					{ accountId: 3, subsidiaryId: 1, cumulative: -0.3, ytd: 0 },
				],
			}),
		);
		expect(tb.rows.map((row) => row.amounts[0])).toEqual([0.3, -0.3]);
		expect(tb.totals.consolidated).toBe(0);
	});

	it('rounds amounts to two decimals', () => {
		const tb = buildTrialBalance(
			sample.input({
				subsidiaries: [sub(1, 'Parent', { parentId: null })],
				balances: [{ accountId: 1, subsidiaryId: 1, cumulative: 12.3456, ytd: 0 }],
			}),
		);
		expect(tb.rows[0].amounts[0]).toBe(12.35);
	});

	it('never returns -0 when amounts cancel', () => {
		const tb = buildTrialBalance(
			sample.input({
				subsidiaries: [sub(1, 'Parent', { parentId: null }), sub(2, 'Other')],
				showZeros: true,
				balances: [
					{ accountId: 1, subsidiaryId: 1, cumulative: -0.001, ytd: 0 },
					{ accountId: 3, subsidiaryId: 2, cumulative: -0.1, ytd: 0 },
					{ accountId: 3, subsidiaryId: 2, cumulative: 0.1, ytd: 0 },
				],
			}),
		);
		for (const row of tb.rows) {
			row.amounts.forEach((value) => expect(isNegativeZero(value)).toBe(false));
			expect(isNegativeZero(row.consolidated)).toBe(false);
		}
		tb.totals.amounts.forEach((value) => expect(isNegativeZero(value)).toBe(false));
		expect(isNegativeZero(tb.totals.consolidated)).toBe(false);
	});

	it('drops the prior-year roll when the retained earnings account is not in the account list', () => {
		const tb = buildTrialBalance(sample.input({ retainedEarningsAccountId: 12345 }));
		expect(tb.rows.some((row) => row.accountId === sample.RETAINED_EARNINGS_ID)).toBe(true); // still a plain Equity account
		const accounts = sample.accounts.filter((a) => a.id !== sample.RETAINED_EARNINGS_ID);
		const missing = buildTrialBalance(sample.input({ accounts }));
		expect(missing.rows.some((row) => row.accountId === sample.RETAINED_EARNINGS_ID)).toBe(false);
	});

	it('labels an account with no number by name alone and sorts it first', () => {
		const accounts = [sample.account(1, '', 'Unnumbered Cash', 'Bank'), sample.account(2, '200', 'AP', 'AcctPay')];
		const tb = buildTrialBalance(
			sample.input({
				accounts,
				subsidiaries: [sub(1, 'Parent', { parentId: null })],
				balances: [
					{ accountId: 2, subsidiaryId: 1, cumulative: -1, ytd: 0 },
					{ accountId: 1, subsidiaryId: 1, cumulative: 1, ytd: 0 },
				],
			}),
		);
		expect(tb.rows.map((row) => row.label)).toEqual(['Unnumbered Cash', '200 - AP']);
	});

	it('breaks account number ties by name', () => {
		const accounts = [sample.account(1, '100', 'Beta', 'Bank'), sample.account(2, '100', 'Alpha', 'Bank')];
		const tb = buildTrialBalance(
			sample.input({
				accounts,
				subsidiaries: [sub(1, 'Parent', { parentId: null })],
				showZeros: true,
				balances: [],
			}),
		);
		expect(tb.rows.map((row) => row.accountId)).toEqual([2, 1]);
	});

	it('falls back to internal id when account number, name, and subsidiary name all tie', () => {
		const accounts = [sample.account(8, '100', 'Cash', 'Bank'), sample.account(3, '100', 'Cash', 'Bank')];
		const tb = buildTrialBalance(
			sample.input({
				accounts,
				subsidiaries: [sub(9, 'Same'), sub(1, 'Top', { parentId: null }), sub(4, 'Same')],
				showZeros: true,
				balances: [],
			}),
		);
		expect(tb.subsidiaries.map((s) => s.id)).toEqual([1, 4, 9]);
		expect(tb.rows.map((row) => row.accountId)).toEqual([3, 8]);
	});

	it('sorts several eliminations and non-parents by name', () => {
		const tb = buildTrialBalance(
			sample.input({
				subsidiaries: [
					sub(4, 'Z Elims', { isElimination: true }),
					sub(3, 'B Sub'),
					sub(2, 'A Elims', { isElimination: true }),
					sub(9, 'Top', { parentId: null }),
					sub(5, 'A Sub'),
				],
				balances: [],
			}),
		);
		expect(tb.subsidiaries.map((s) => s.id)).toEqual([9, 5, 3, 2, 4]);
		expect(tb.rows).toEqual([]);
		expect(tb.totals).toEqual({ amounts: [0, 0, 0, 0, 0], consolidated: 0 });
	});
});

describe('toCsv', () => {
	it('prefixes text cells that start like a formula, but not amounts', () => {
		const tb = {
			subsidiaries: [{ id: 1, name: '=HYPERLINK("x")', isElimination: false, parentId: null }],
			rows: [{ accountId: 1, label: '@SUM(A1)', amounts: [-5], consolidated: -5 }],
			totals: { amounts: [-5], consolidated: -5 },
		};
		const lines = toCsv(tb, 'P1').split('\r\n');
		expect(lines[3]).toBe('Account,"\'=HYPERLINK(""x"")",Consolidated');
		expect(lines[4]).toBe("'@SUM(A1),-5.00,-5.00");
	});

	it('writes the title block, header, rows, and totals with CRLF line endings', () => {
		const csv = toCsv(buildTrialBalance(sample.input()), 'P9 2026');
		const lines = csv.split('\r\n');
		expect(lines.slice(0, 4)).toEqual([
			'Trial Balance by Subsidiary',
			'Period: P9 2026',
			'',
			'Account,"JLo Beauty & Lifestyle, LLC",JLBL Holdings LLC,JLBL Productions LLC,JLBL Elims,Consolidated',
		]);
		expect(lines[4]).toBe('10100 - Cash,1000.00,250.00,50.00,0.00,1300.00');
		expect(lines[6]).toBe('20000 - Accounts Payable,-400.10,0.00,0.00,100.00,-300.10');
		expect(lines[lines.length - 1]).toBe('Total,0.00,0.00,0.00,0.00,0.00');
		expect(lines).toHaveLength(4 + sample.expectedRows.length + 1);
		expect(csv.endsWith('\r\n')).toBe(false);
	});

	it('writes large amounts without thousands separators', () => {
		const tb = {
			subsidiaries: [sub(1, 'Parent', { parentId: null })],
			rows: [{ accountId: 1, label: '1 - Cash', amounts: [-1234567.5], consolidated: -1234567.5 }],
			totals: { amounts: [-1234567.5], consolidated: -1234567.5 },
		};
		expect(toCsv(tb, 'P1').split('\r\n')[4]).toBe('1 - Cash,-1234567.50,-1234567.50');
	});

	it('quotes fields with commas, quotes, or line breaks and doubles inner quotes', () => {
		const tb = {
			subsidiaries: [sub(1, 'Sub "One"', { parentId: null }), sub(2, 'Line\nBreak')],
			rows: [{ accountId: 1, label: '100 - Cash, Operating', amounts: [-0, 0], consolidated: -0 }],
			totals: { amounts: [0, 0], consolidated: 0 },
		};
		const lines = toCsv(tb, 'P1, 2026').split('\r\n');
		expect(lines[1]).toBe('"Period: P1, 2026"');
		expect(lines[3]).toBe('Account,"Sub ""One""","Line\nBreak",Consolidated');
		expect(lines[4]).toBe('"100 - Cash, Operating",0.00,0.00,0.00');
	});
});

describe('parseRequest', () => {
	it('shows the form with no parameters', () => {
		expect(parseRequest({})).toEqual({ periodId: null, showZeros: false, action: 'form' });
	});

	it('views a valid period', () => {
		expect(parseRequest({ periodid: '102' })).toEqual({ periodId: 102, showZeros: false, action: 'view' });
	});

	it('trims the period id', () => {
		expect(parseRequest({ periodid: ' 102 ' }).periodId).toBe(102);
	});

	it('exports CSV for a valid period', () => {
		expect(parseRequest({ periodid: '102', action: 'csv', showzeros: 'T' })).toEqual({
			periodId: 102,
			showZeros: true,
			action: 'csv',
		});
	});

	it('views when the action is anything other than csv', () => {
		expect(parseRequest({ periodid: '102', action: 'pdf' }).action).toBe('view');
		expect(parseRequest({ periodid: '102', action: 'CSV' }).action).toBe('view');
	});

	it.each(['', '0', '-3', '1.5', 'abc', '12;DROP', '1e3'])('falls back to the form for period id %p', (periodid) => {
		expect(parseRequest({ periodid, action: 'csv' })).toEqual({ periodId: null, showZeros: false, action: 'form' });
	});

	it.each([
		['T', true],
		['true', true],
		['F', false],
		['false', false],
		['', false],
		[undefined, false],
		['yes', false],
	])('reads showzeros %p as %p', (showzeros, expected) => {
		expect(parseRequest({ showzeros }).showZeros).toBe(expected);
	});
});

describe('csvFileName', () => {
	it('builds the name from the period', () => {
		expect(csvFileName('P9 2026')).toBe('TrialBalance_P9_2026.csv');
	});

	it('replaces characters outside [A-Za-z0-9_-] with underscores', () => {
		expect(csvFileName('Q3/FY-2026: Adj.')).toBe('TrialBalance_Q3_FY-2026__Adj_.csv');
	});
});
