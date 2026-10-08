/**
 * cen_jlo_so_proforma_svc.ts
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @NAuthor cary.pruitt@centricconsulting.com
 * @NDescription Renders a sales order on the Pro Forma Invoice template (custtmpl_cen_jlo_so_proforma) as a PDF.
 */

import file = require('N/file');
import log = require('N/log');
import record = require('N/record');
import render = require('N/render');
import runtime = require('N/runtime');
import { buildCompanyHeader, CompanyHeader, parseLogoUrl, proFormaFileName } from './models/proForma';

const TEMPLATE_SCRIPT_ID = 'CUSTTMPL_CEN_JLO_SO_PROFORMA';
const LOGO_URL_PARAM = 'custscript_cen_jlo_proforma_logo_url';

/** Loads the sales order and returns the rendered pro forma PDF. Throws if the order or template cannot be loaded. */
export function renderProForma(salesOrderId: number): file.File {
  const salesOrder = record.load({ type: record.Type.SALES_ORDER, id: salesOrderId });

  const renderer = render.create();
  renderer.setTemplateByScriptId({ scriptId: TEMPLATE_SCRIPT_ID });
  renderer.addRecord({ templateName: 'record', record: salesOrder });
  renderer.addCustomDataSource({ format: render.DataSource.OBJECT, alias: 'proforma', data: loadCompanyHeader(salesOrder) });

  const pdf = renderer.renderAsPdf();
  pdf.name = proFormaFileName(String(salesOrder.getValue({ fieldId: 'tranid' }) || salesOrderId));
  return pdf;
}

/**
 * A custom render has no companyInformation.logoUrl or addressText (native printing computes those).
 * Company Information needs the Set Up Company permission, so the header avoids it: the address comes
 * from the order's subsidiary (Subsidiaries view, held by the roles that print), and the logo URL from
 * a company preference set per account, which needs no permission to read.
 * NetSuite does not escape custom data in the template; the template applies ?html to these values.
 */
function loadCompanyHeader(salesOrder: record.Record): CompanyHeader {
  const logoUrl = parseLogoUrl(runtime.getCurrentScript().getParameter({ name: LOGO_URL_PARAM }));
  let name = String(salesOrder.getText({ fieldId: 'subsidiary' }) || '');
  let addressText = '';
  try {
    const subsidiary = record.load({ type: record.Type.SUBSIDIARY, id: Number(salesOrder.getValue({ fieldId: 'subsidiary' })) });
    name = String(subsidiary.getValue({ fieldId: 'legalname' }) || subsidiary.getValue({ fieldId: 'name' }) || name);
    addressText = String(subsidiary.getValue({ fieldId: 'mainaddress_text' }) || '');
  } catch (e) {
    log.error({ title: 'Pro forma subsidiary address unavailable', details: e });
  }
  return buildCompanyHeader({ name, addressText, logoUrl });
}
