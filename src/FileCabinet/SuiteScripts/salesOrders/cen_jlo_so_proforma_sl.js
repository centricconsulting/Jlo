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
define(["require", "exports", "N/log", "./models/proForma", "./cen_jlo_so_proforma_svc"], function (require, exports, log, proForma_1, cen_jlo_so_proforma_svc_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.onRequest = void 0;
    const onRequest = (context) => {
        try {
            const parsed = (0, proForma_1.parseSalesOrderId)(context.request.parameters.soid);
            if (parsed.ok === false) {
                writeMessage(context.response, parsed.message);
                return;
            }
            context.response.writeFile({ file: (0, cen_jlo_so_proforma_svc_1.renderProForma)(parsed.id), isInline: true });
        }
        catch (e) {
            log.error({ title: 'Pro forma render failed', details: e });
            writeMessage(context.response, 'The pro forma could not be printed. Please contact your NetSuite administrator.');
        }
    };
    exports.onRequest = onRequest;
    function writeMessage(response, message) {
        response.setHeader({ name: 'Content-Type', value: 'text/plain; charset=utf-8' });
        response.write({ output: message });
    }
});
