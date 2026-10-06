/**
 * cen_jlo_so_proforma_sl.ts
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 * @NAuthor cary.pruitt@centricconsulting.com
 * @NDescription Returns a sales order's pro forma invoice PDF inline. Opened by the Print Pro Forma button (customscript_cen_jlo_so_proforma_ue) with ?soid=<internal id>.
 * @Id customscript_cen_jlo_so_proforma_sl
 * @NName JLo - Print Pro Forma Invoice
 */

import { EntryPoints } from 'N/types';
import log = require('N/log');
import { parseSalesOrderId } from './models/proForma';
import { renderProForma } from './cen_jlo_so_proforma_svc';

export const onRequest: EntryPoints.Suitelet.onRequest = (context) => {
  try {
    const parsed = parseSalesOrderId(context.request.parameters.soid);
    if (parsed.ok === false) {
      writeMessage(context.response, parsed.message);
      return;
    }
    context.response.writeFile({ file: renderProForma(parsed.id), isInline: true });
  } catch (e) {
    log.error({ title: 'Pro forma render failed', details: e });
    writeMessage(context.response, 'The pro forma could not be printed. Please contact your NetSuite administrator.');
  }
};

function writeMessage(response: EntryPoints.Suitelet.onRequestContext['response'], message: string): void {
  response.setHeader({ name: 'Content-Type', value: 'text/plain; charset=utf-8' });
  response.write({ output: message });
}
