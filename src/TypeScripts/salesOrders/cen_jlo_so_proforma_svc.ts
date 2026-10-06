/**
 * cen_jlo_so_proforma_svc.ts
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @NAuthor cary.pruitt@centricconsulting.com
 * @NDescription Renders a sales order on the Pro Forma Invoice template (custtmpl_cen_jlo_so_proforma) as a PDF.
 */

import config = require('N/config');
import file = require('N/file');
import record = require('N/record');
import render = require('N/render');
import url = require('N/url');
import { buildCompanyHeader, CompanyHeader, proFormaFileName } from './models/proForma';

const TEMPLATE_SCRIPT_ID = 'CUSTTMPL_CEN_JLO_SO_PROFORMA';

/** Loads the sales order and returns the rendered pro forma PDF. Throws if the order or template cannot be loaded. */
export function renderProForma(salesOrderId: number): file.File {
  const salesOrder = record.load({ type: record.Type.SALES_ORDER, id: salesOrderId });

  const renderer = render.create();
  renderer.setTemplateByScriptId({ scriptId: TEMPLATE_SCRIPT_ID });
  renderer.addRecord({ templateName: 'record', record: salesOrder });
  renderer.addCustomDataSource({ format: render.DataSource.OBJECT, alias: 'proforma', data: loadCompanyHeader() });

  const pdf = renderer.renderAsPdf();
  pdf.name = proFormaFileName(String(salesOrder.getValue({ fieldId: 'tranid' }) || salesOrderId));
  return pdf;
}

/**
 * A custom render has no companyInformation.logoUrl or addressText (native printing computes those),
 * so the header comes from Company Information: the forms logo and the main address block.
 * NetSuite does not escape custom data in the template; the template applies ?html to these values.
 */
function loadCompanyHeader(): CompanyHeader {
  const company = config.load({ type: config.Type.COMPANY_INFORMATION });
  const logoId = Number(company.getValue({ fieldId: 'formlogo' }) || 0);
  let logoUrl = '';
  if (logoId) {
    const domain = url.resolveDomain({ hostType: url.HostType.APPLICATION });
    logoUrl = `https://${domain}${file.load({ id: logoId }).url}`;
  }
  return buildCompanyHeader({
    name: String(company.getValue({ fieldId: 'companyname' }) || ''),
    addressText: String(company.getValue({ fieldId: 'mainaddress_text' }) || ''),
    logoUrl,
  });
}
