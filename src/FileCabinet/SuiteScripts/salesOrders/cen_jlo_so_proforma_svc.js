/**
 * cen_jlo_so_proforma_svc.ts
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @NAuthor cary.pruitt@centricconsulting.com
 * @NDescription Renders a sales order on the Pro Forma Invoice template (custtmpl_cen_jlo_so_proforma) as a PDF.
 */
define(["require", "exports", "N/file", "N/log", "N/record", "N/render", "N/runtime", "./models/proForma"], function (require, exports, file, log, record, render, runtime, proForma_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.renderProForma = renderProForma;
    const TEMPLATE_SCRIPT_ID = 'CUSTTMPL_CEN_JLO_SO_PROFORMA';
    const LOGO_URL_PARAM = 'custscript_cen_jlo_proforma_logo_url';
    /** Loads the sales order and returns the rendered pro forma PDF. Throws if the order or template cannot be loaded. */
    function renderProForma(salesOrderId) {
        const salesOrder = record.load({ type: record.Type.SALES_ORDER, id: salesOrderId });
        const renderer = render.create();
        renderer.setTemplateByScriptId({ scriptId: TEMPLATE_SCRIPT_ID });
        renderer.addRecord({ templateName: 'record', record: salesOrder });
        renderer.addCustomDataSource({ format: render.DataSource.OBJECT, alias: 'proforma', data: loadCompanyHeader(salesOrder) });
        const pdf = renderer.renderAsPdf();
        pdf.name = (0, proForma_1.proFormaFileName)(String(salesOrder.getValue({ fieldId: 'tranid' }) || salesOrderId));
        return pdf;
    }
    /**
     * A custom render has no companyInformation.logoUrl or addressText (native printing computes those).
     * Company Information needs the Set Up Company permission, so the header avoids it: the address comes
     * from the order's subsidiary (Subsidiaries view, held by the roles that print), and the logo from
     * a company preference set per account, which needs no permission to read. The logo is embedded as a
     * data URI (Documents and Files view) because the renderer's fetch of its URL failed under a non-admin role;
     * the URL itself is the fallback.
     * NetSuite does not escape custom data in the template; the template applies ?html to these values.
     */
    function loadCompanyHeader(salesOrder) {
        const logoUrl = (0, proForma_1.parseLogoUrl)(runtime.getCurrentScript().getParameter({ name: LOGO_URL_PARAM }));
        const logo = embedLogo(logoUrl) || logoUrl;
        let name = String(salesOrder.getText({ fieldId: 'subsidiary' }) || '');
        let addressText = '';
        try {
            const subsidiary = record.load({ type: record.Type.SUBSIDIARY, id: Number(salesOrder.getValue({ fieldId: 'subsidiary' })) });
            name = String(subsidiary.getValue({ fieldId: 'legalname' }) || subsidiary.getValue({ fieldId: 'name' }) || name);
            addressText = String(subsidiary.getValue({ fieldId: 'mainaddress_text' }) || '');
        }
        catch (e) {
            log.error({ title: 'Pro forma subsidiary address unavailable', details: e });
        }
        return (0, proForma_1.buildCompanyHeader)({ name, addressText, logoUrl: logo });
    }
    /** The logo file's contents as a data URI, or '' when the URL names no file or the file cannot be read. */
    function embedLogo(logoUrl) {
        const id = (0, proForma_1.logoFileId)(logoUrl);
        if (!id) {
            return '';
        }
        try {
            const logoFile = file.load({ id });
            return (0, proForma_1.logoDataUri)(String(logoFile.fileType), logoFile.getContents());
        }
        catch (e) {
            log.error({ title: 'Pro forma logo file unavailable', details: e });
            return '';
        }
    }
});
