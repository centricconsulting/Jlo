/**
 * Unit tests for cen_jlo_je_reversal_ue (JLo , Clear Reversal Date on JE Copy).
 *
 * Tests the compiled JS entry point. The script has no N/* runtime imports
 * (N/types is type-only and erased at compile), so no module mocking is needed.
 */
const { beforeLoad } = require('SuiteScripts/journalEntries/cen_jlo_je_reversal_ue');

const UserEventType = {
	CREATE: 'create',
	EDIT: 'edit',
	VIEW: 'view',
	COPY: 'copy',
};

/** Builds a minimal beforeLoad context for the given event type. */
function buildContext(type) {
	return {
		type,
		UserEventType,
		newRecord: { setValue: jest.fn() },
	};
}

describe('cen_jlo_je_reversal_ue beforeLoad', () => {
	it('clears the reversal date and defer flag when the JE is copied', () => {
		const context = buildContext(UserEventType.COPY);

		beforeLoad(context);

		expect(context.newRecord.setValue).toHaveBeenCalledTimes(2);
		expect(context.newRecord.setValue).toHaveBeenCalledWith({ fieldId: 'reversaldate', value: null });
		expect(context.newRecord.setValue).toHaveBeenCalledWith({ fieldId: 'reversaldefer', value: false });
	});

	it.each([UserEventType.CREATE, UserEventType.EDIT, UserEventType.VIEW])(
		'leaves the record untouched on a non-copy event (%s)',
		(type) => {
			const context = buildContext(type);

			beforeLoad(context);

			expect(context.newRecord.setValue).not.toHaveBeenCalled();
		}
	);
});
