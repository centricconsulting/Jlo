/**
 * Unit tests for cen_jlo_so_proforma_ue (JLo - Pro Forma Button on Sales Order).
 */
jest.mock('N/url', () => ({ resolveScript: jest.fn() }), { virtual: true });
jest.mock('N/ui/serverWidget', () => ({ FieldType: { INLINEHTML: 'inlinehtml' } }), { virtual: true });

const url = require('N/url');
const { beforeLoad, PRINT_URL_FIELD_ID } = require('SuiteScripts/salesOrders/cen_jlo_so_proforma_ue');

const UserEventType = { CREATE: 'create', EDIT: 'edit', VIEW: 'view', COPY: 'copy', PRINT: 'print' };

function buildContext(type) {
	const field = {};
	return {
		type,
		UserEventType,
		newRecord: { id: 7094172 },
		field,
		form: {
			addField: jest.fn(() => field),
			addButton: jest.fn(),
			clientScriptModulePath: undefined,
		},
	};
}

describe('cen_jlo_so_proforma_ue beforeLoad', () => {
	beforeEach(() => {
		url.resolveScript.mockReset();
		url.resolveScript.mockReturnValue('/app/site/hosting/scriptlet.nl?script=9&deploy=1&soid=7094172');
	});

	it('adds the Print Pro Forma button in view mode, with the Suitelet URL in a hidden field', () => {
		const context = buildContext(UserEventType.VIEW);

		beforeLoad(context);

		expect(url.resolveScript).toHaveBeenCalledWith({
			scriptId: 'customscript_cen_jlo_so_proforma_sl',
			deploymentId: 'customdeploy_cen_jlo_so_proforma_sl',
			params: { soid: 7094172 },
		});
		expect(context.form.addField).toHaveBeenCalledWith(
			expect.objectContaining({ id: PRINT_URL_FIELD_ID, type: 'inlinehtml' }),
		);
		expect(context.field.defaultValue).toBe(
			`<input type="hidden" id="${PRINT_URL_FIELD_ID}" value="/app/site/hosting/scriptlet.nl?script=9&amp;deploy=1&amp;soid=7094172" />`,
		);
		expect(context.form.clientScriptModulePath).toBe('./cen_jlo_so_proforma_cs.js');
		expect(context.form.addButton).toHaveBeenCalledWith({
			id: 'custpage_cen_jlo_print_proforma',
			label: 'Print Pro Forma',
			functionName: 'printProForma',
		});
	});

	it.each([UserEventType.CREATE, UserEventType.EDIT, UserEventType.COPY, UserEventType.PRINT])(
		'leaves the form alone outside view mode (%s)',
		(type) => {
			const context = buildContext(type);

			beforeLoad(context);

			expect(url.resolveScript).not.toHaveBeenCalled();
			expect(context.form.addField).not.toHaveBeenCalled();
			expect(context.form.addButton).not.toHaveBeenCalled();
		},
	);
});
