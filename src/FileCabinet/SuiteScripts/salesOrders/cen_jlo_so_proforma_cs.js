/**
 * cen_jlo_so_proforma_cs.ts
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 * @NAuthor cary.pruitt@centricconsulting.com
 * @NDescription Button handler for Print Pro Forma; attached by customscript_cen_jlo_so_proforma_ue through clientScriptModulePath, so it has no script record.
 */
define(["require", "exports", "N/ui/dialog"], function (require, exports, dialog) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.pageInit = void 0;
    exports.printProForma = printProForma;
    const PRINT_URL_FIELD_ID = 'custpage_cen_jlo_proforma_url';
    const pageInit = () => { };
    exports.pageInit = pageInit;
    /** Opens the pro forma PDF in a new tab, like the native Print button. */
    function printProForma() {
        const holder = document.getElementById(PRINT_URL_FIELD_ID);
        if (!holder || !holder.value) {
            dialog.alert({ title: 'Print Pro Forma', message: 'The pro forma link is missing. Reload the sales order and try again.' });
            return;
        }
        window.open(holder.value, '_blank');
    }
});
