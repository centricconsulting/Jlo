/**
 * cen_jlo_so_proforma_ue.ts
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 * @NAuthor cary.pruitt@centricconsulting.com
 * @NDescription Adds a Print Pro Forma button to sales orders in view mode. The button opens customscript_cen_jlo_so_proforma_sl for the order; the URL reaches the client script through a hidden field.
 * @Id customscript_cen_jlo_so_proforma_ue
 * @NName JLo - Pro Forma Button on Sales Order
 */
define(["require", "exports", "N/ui/serverWidget", "N/url", "./models/proForma"], function (require, exports, serverWidget, url, proForma_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.beforeLoad = exports.PRINT_URL_FIELD_ID = void 0;
    exports.PRINT_URL_FIELD_ID = 'custpage_cen_jlo_proforma_url';
    const beforeLoad = (context) => {
        if (context.type !== context.UserEventType.VIEW)
            return;
        const suiteletUrl = url.resolveScript({
            scriptId: 'customscript_cen_jlo_so_proforma_sl',
            deploymentId: 'customdeploy_cen_jlo_so_proforma_sl',
            params: { soid: context.newRecord.id },
        });
        const holder = context.form.addField({
            id: exports.PRINT_URL_FIELD_ID,
            type: serverWidget.FieldType.INLINEHTML,
            label: 'Pro forma print URL',
        });
        holder.defaultValue = `<input type="hidden" id="${exports.PRINT_URL_FIELD_ID}" value="${(0, proForma_1.htmlAttr)(suiteletUrl)}" />`;
        context.form.clientScriptModulePath = './cen_jlo_so_proforma_cs.js';
        context.form.addButton({
            id: 'custpage_cen_jlo_print_proforma',
            label: 'Print Pro Forma',
            functionName: 'printProForma',
        });
    };
    exports.beforeLoad = beforeLoad;
});
