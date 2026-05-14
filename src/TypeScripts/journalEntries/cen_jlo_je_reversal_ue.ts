/**
 * cen_jlo_je_reversal_ue.ts
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 * @NAuthor cary.pruitt@centricconsulting.com
 * @NDescription Clears the reversal date when a Journal Entry (any subtype) is copied, so the user can save the copy without the source JE's reversal date carrying over and breaking the save.
 * @Id customscript_cen_jlo_je_reversal_ue
 * @NName JLo , Clear Reversal Date on JE Copy
 */

import { EntryPoints } from 'N/types';

export const beforeLoad: EntryPoints.UserEvent.beforeLoad = (context) => {
  if (context.type !== context.UserEventType.COPY) return;

  const rec = context.newRecord;
  rec.setValue({ fieldId: 'reversaldate', value: null });
  rec.setValue({ fieldId: 'reversaldefer', value: false });
};
