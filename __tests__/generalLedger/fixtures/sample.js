/**
 * A small balanced trial balance: three operating subsidiaries plus eliminations.
 * Every subsidiary's cumulative balances net to zero, so every trial balance column does too.
 * Subsidiaries are listed out of column order on purpose.
 */

const RETAINED_EARNINGS_ID = 52;

const subsidiaries = [
	{ id: 7, name: 'JLBL Productions LLC', isElimination: false, parentId: 1 },
	{ id: 6, name: 'JLBL Elims', isElimination: true, parentId: 1 },
	{ id: 5, name: 'JLBL Holdings LLC', isElimination: false, parentId: 1 },
	{ id: 1, name: 'JLo Beauty & Lifestyle, LLC', isElimination: false, parentId: null },
];

const account = (id, number, name, type, extra = {}) => ({
	id,
	number,
	name,
	type,
	isInactive: false,
	isSummary: false,
	...extra,
});

const accounts = [
	account(1, '10100', 'Cash', 'Bank'),
	account(2, '12000', 'Accounts Receivable', 'AcctRec'),
	account(3, '20000', 'Accounts Payable', 'AcctPay'),
	account(4, '30000', 'Common Stock', 'Equity'),
	account(RETAINED_EARNINGS_ID, '31301', 'Retained Earnings (system)', 'Equity'),
	account(5, '40000', 'Sales', 'Income'),
	account(6, '50000', 'Cost of Goods Sold', 'COGS'),
	account(7, '60000', 'Rent', 'Expense'),
	account(8, '10000', 'Assets', 'NonPosting'),
	account(9, '61000', 'Old Expense', 'Expense', { isInactive: true }),
	account(10, '15000', 'Fixed Assets', 'FixedAsset', { isSummary: true }),
	account(11, '9100', 'Petty Cash', 'Bank'),
];

const balances = [
	// Parent: income statement accounts carry prior-year activity that rolls to retained earnings.
	{ accountId: 1, subsidiaryId: 1, cumulative: 1000, ytd: 300 },
	{ accountId: 2, subsidiaryId: 1, cumulative: 500.1, ytd: 500.1 },
	{ accountId: 3, subsidiaryId: 1, cumulative: -400.1, ytd: -400.1 },
	{ accountId: 4, subsidiaryId: 1, cumulative: -200, ytd: 0 },
	{ accountId: 5, subsidiaryId: 1, cumulative: -2000, ytd: -1500 },
	{ accountId: 6, subsidiaryId: 1, cumulative: 800, ytd: 600 },
	{ accountId: 7, subsidiaryId: 1, cumulative: 300, ytd: 100 },
	// Holdings: current year only.
	{ accountId: 1, subsidiaryId: 5, cumulative: 250, ytd: 250 },
	{ accountId: 5, subsidiaryId: 5, cumulative: -250, ytd: -250 },
	// Productions: retained earnings has its own posting on top of the roll.
	{ accountId: 1, subsidiaryId: 7, cumulative: 50, ytd: 50 },
	{ accountId: RETAINED_EARNINGS_ID, subsidiaryId: 7, cumulative: 25, ytd: 0 },
	{ accountId: 4, subsidiaryId: 7, cumulative: -75, ytd: 0 },
	{ accountId: 7, subsidiaryId: 7, cumulative: 40, ytd: 10 },
	{ accountId: 5, subsidiaryId: 7, cumulative: -40, ytd: -40 },
	// Eliminations.
	{ accountId: 2, subsidiaryId: 6, cumulative: -100, ytd: -100 },
	{ accountId: 3, subsidiaryId: 6, cumulative: 100, ytd: 100 },
	// Rows the model ignores: "- None -" account, NonPosting, unknown subsidiary, unknown account.
	{ accountId: 0, subsidiaryId: 1, cumulative: 999, ytd: 999 },
	{ accountId: 8, subsidiaryId: 1, cumulative: 123, ytd: 123 },
	{ accountId: 1, subsidiaryId: 99, cumulative: 77, ytd: 77 },
	{ accountId: 999, subsidiaryId: 1, cumulative: 55, ytd: 55 },
];

/** Expected rows with showZeros off; columns are parent, Holdings, Productions, Elims. */
const expectedRows = [
	{ accountId: 1, label: '10100 - Cash', amounts: [1000, 250, 50, 0], consolidated: 1300 },
	{ accountId: 2, label: '12000 - Accounts Receivable', amounts: [500.1, 0, 0, -100], consolidated: 400.1 },
	{ accountId: 3, label: '20000 - Accounts Payable', amounts: [-400.1, 0, 0, 100], consolidated: -300.1 },
	{ accountId: 4, label: '30000 - Common Stock', amounts: [-200, 0, -75, 0], consolidated: -275 },
	{
		accountId: RETAINED_EARNINGS_ID,
		label: '31301 - Retained Earnings (system)',
		amounts: [-100, 0, 55, 0],
		consolidated: -45,
	},
	{ accountId: 5, label: '40000 - Sales', amounts: [-1500, -250, -40, 0], consolidated: -1790 },
	{ accountId: 6, label: '50000 - Cost of Goods Sold', amounts: [600, 0, 0, 0], consolidated: 600 },
	{ accountId: 7, label: '60000 - Rent', amounts: [100, 0, 10, 0], consolidated: 110 },
];

const periods = [
	{ id: 101, name: 'P8 2026', startDate: '2026-08-03', endDate: '2026-08-30' },
	{ id: 103, name: 'P10 2026', startDate: '2026-10-05', endDate: '2026-11-01' },
	{ id: 102, name: 'P9 2026', startDate: '2026-08-31', endDate: '2026-10-04' },
];

const input = (overrides = {}) => ({
	accounts,
	subsidiaries,
	balances,
	retainedEarningsAccountId: RETAINED_EARNINGS_ID,
	showZeros: false,
	...overrides,
});

module.exports = { RETAINED_EARNINGS_ID, subsidiaries, accounts, balances, expectedRows, periods, input, account };
