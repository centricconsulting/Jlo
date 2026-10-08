/**
 * Unit tests for the pro forma model (pure helpers, no N/* imports).
 */
const {
	parseSalesOrderId,
	proFormaFileName,
	buildCompanyHeader,
	parseLogoUrl,
	htmlAttr,
} = require('SuiteScripts/salesOrders/models/proForma');

describe('parseSalesOrderId', () => {
	it('accepts a positive integer id, trimming whitespace', () => {
		expect(parseSalesOrderId(' 7094172 ')).toEqual({ ok: true, id: 7094172 });
	});

	it.each([undefined, null, '', '0', '-5', '12.5', 'abc', '12;DROP', 42])(
		'rejects %p',
		(raw) => {
			const result = parseSalesOrderId(raw);
			expect(result.ok).toBe(false);
			expect(result.message).toMatch(/sales order id/);
		},
	);
});

describe('proFormaFileName', () => {
	it('builds the file name from the order number', () => {
		expect(proFormaFileName('SO0011030')).toBe('ProForma_SO0011030.pdf');
	});

	it('drops characters that do not belong in a file name', () => {
		expect(proFormaFileName('SO 11/030#')).toBe('ProForma_SO11030.pdf');
	});

	it('falls back when nothing usable is left', () => {
		expect(proFormaFileName('///')).toBe('ProForma_SalesOrder.pdf');
	});
});

describe('buildCompanyHeader', () => {
	it('splits the address block into trimmed, non-empty lines', () => {
		const header = buildCompanyHeader({
			name: 'JLO Beauty & Lifestyle, LLC',
			addressText: 'JLO Beauty & Lifestyle, LLC\r\n100 N Pacific Coast Hwy\n\n  Suite 1600 \nEl Segundo CA 90245',
			logoUrl: 'https://example.test/logo.png',
		});
		expect(header).toEqual({
			name: 'JLO Beauty & Lifestyle, LLC',
			addressLines: ['JLO Beauty & Lifestyle, LLC', '100 N Pacific Coast Hwy', 'Suite 1600', 'El Segundo CA 90245'],
			logoUrl: 'https://example.test/logo.png',
		});
	});

	it('uses the company name when there is no address', () => {
		expect(buildCompanyHeader({ name: 'JLO', addressText: '', logoUrl: '' }).addressLines).toEqual(['JLO']);
	});

	it('returns no lines when there is neither address nor name', () => {
		expect(buildCompanyHeader({ name: '', addressText: ' \n ', logoUrl: '' }).addressLines).toEqual([]);
	});
});

describe('parseLogoUrl', () => {
	it('keeps an absolute https URL, trimmed', () => {
		const url = 'https://6966778-sb1.app.netsuite.com/core/media/media.nl?id=8115&c=6966778_SB1&h=abc';
		expect(parseLogoUrl(` ${url} `)).toBe(url);
	});

	it.each([undefined, null, '', 'media.nl?id=8115', '/core/media/media.nl?id=8115', 'javascript:alert(1)', 'https://a b', 42])(
		'prints no logo for %p',
		(raw) => {
			expect(parseLogoUrl(raw)).toBe('');
		},
	);
});

describe('htmlAttr', () => {
	it('escapes the characters that break a double-quoted attribute', () => {
		expect(htmlAttr('/app/x.nl?script=1&deploy=1&soid="5"<>')).toBe(
			'/app/x.nl?script=1&amp;deploy=1&amp;soid=&quot;5&quot;&lt;&gt;',
		);
	});
});
