/**
 *@NApiVersion 2.x
 *@NScriptType UserEventScript
/= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * VER  DATE           AUTHOR               		CHANGES
 * 1.0  Aug 7, 2023   Centric Consulting(Aman)   	Initial Version
 * 
 * This script is needed to ensure tax calculated by Shopify and supplied to the sales order
 * is carried over from the Sales Order to the corresponding invoice.
 * 
 * We moved this from after submit to beforeLoad since the tax was not showing up when 
 * an invoice was first saved. This led some instances of an invoice to be negative
 * which prevented saving. By moving to beforeLoad - the tax is calculated prior 
 * to the invoice being saved and the invoice now has a positive balance and can be saved.
 * 
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */

define(['N/record', 'N/runtime'], function (record, runtime) {
    function beforeLoad(context) {
        try {
            var executionContext = runtime.executionContext;
            log.debug({ title: 'executionContext', details: executionContext });

            var celigoTaxItem = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_celigo_tax_item2'});
            log.debug("celigoTaxItem",celigoTaxItem);

            var mode = context.type;
            var currentRecord = context.newRecord;
            if (mode == 'create') {
                log.debug({ title: 'Mode', details: mode });
                var invoiceId = currentRecord.getValue({ fieldId: "id" });
                var customer = currentRecord.getValue({ fieldId: "entity" });
                var salesOrderId = currentRecord.getValue({ fieldId: "createdfrom" });
                log.debug({ title: 'so Detail', details: "int ID: " + invoiceId + ", Cust: " + customer 
                                   + ", Sales Order: " + salesOrderId });

                var itemCount = currentRecord.getLineCount({ sublistId: 'item' });
                log.debug({ title: 'Item Count', details: itemCount });
                for (var i = 0; i < itemCount; i++) {
                    var taxRate = currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_jlb_stored_tax_rate', line: i });
                    var taxCode = currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'taxcode', line: i });

                    if (taxCode === celigoTaxItem) {
                        log.debug("set tax on line",i  + ":" + taxRate);
                        currentRecord.setSublistValue({ sublistId: 'item', fieldId: 'taxrate1', line: i, value: taxRate });
                    } else {
                        // do nothing
                    }

                } // end loop 

            } // end Create Mode Check
        } catch (e) {
            log.error({ title: 'Error on before Load: ', details: e });
        }
    }

    function afterSubmit(context) {
        try {
            var executionContext = runtime.executionContext;
            log.debug({ title: 'executionContext', details: executionContext });

            var celigoTaxItem = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_celigo_tax_item2'});
            log.debug("celigoTaxItem",celigoTaxItem);

            var mode = context.type;
            var currentRecord = context.newRecord;
            if (mode == 'create') {
                log.debug({ title: 'Mode', details: mode });
                var invoiceId = currentRecord.getValue({ fieldId: "id" });
                var customer = currentRecord.getValue({ fieldId: "entity" });
                var salesOrderId = currentRecord.getValue({ fieldId: "createdfrom" });
                log.debug({ title: 'so Detail', details: "int ID: " + invoiceId + ", Cust: " + customer 
                                   + ", Sales Order: " + salesOrderId });

                // // load the INV record.
                var invRecord = record.load({
                    type: record.Type.INVOICE,
                    id: invoiceId,
                    isDynamic: false
                });

                var itemCount = invRecord.getLineCount({ sublistId: 'item' });
                log.debug({ title: 'Item Count', details: itemCount });
                for (var i = 0; i < itemCount; i++) {
                    var taxRate = invRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_jlb_stored_tax_rate', line: i });
                    var taxCode = invRecord.getSublistValue({ sublistId: 'item', fieldId: 'taxcode', line: i });

                    if (taxCode === celigoTaxItem) {
                        log.debug("set tax on line",i  + ":" + taxRate);
                        invRecord.setSublistValue({ sublistId: 'item', fieldId: 'taxrate1', line: i, value: taxRate });
                    } else {
                        // do nothing
                    }

                } // end loop 

                // // save the changes to the INV record
                invRecord.save({
                    enableSourcing: true,
                    ignoreMandatoryFields: true
                });
            } // end Create Mode Check
        } catch (e) {
            log.error({ title: 'Error on after Submit: ', details: e });
        }
    }

    return {
        beforeLoad: beforeLoad
        //afterSubmit: afterSubmit
    };
});
