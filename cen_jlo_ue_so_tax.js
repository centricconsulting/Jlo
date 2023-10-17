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
 * 
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */

define(['N/record', 'N/runtime'], function (record, runtime) {
 

    function afterSubmit(context) {
        try {
            var executionContext = runtime.executionContext;
            log.debug({ title: 'executionContext', details: executionContext });

            var celigoTaxItem = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_celigo_tax_item'});
            log.debug("celigoTaxItem",celigoTaxItem);

            var mode = context.type;
            var currentRecord = context.newRecord;

            log.debug({ title: 'Mode', details: mode });
            var salesOrderId = currentRecord.getValue({ fieldId: "id" });
            var customer = currentRecord.getValue({ fieldId: "entity" });
            log.debug({ title: 'so Detail', details: "int ID: " + salesOrderId + ", Cust: " + customer  });
            
            // load the SO record.
            var soRecord = record.load({
                type: record.Type.SALES_ORDER,
                id: salesOrderId,
                isDynamic: false
            });

            var itemCount = soRecord.getLineCount({ sublistId: 'item' });
            log.debug({ title: 'Item Count', details: itemCount });
            for (var i = 0; i < itemCount; i++) {
                var taxRate = soRecord.getSublistValue({ sublistId: 'item', fieldId: 'taxrate1', line: i });
                var taxCode = soRecord.getSublistValue({ sublistId: 'item', fieldId: 'taxcode', line: i });
                if (taxCode === celigoTaxItem) {
                    log.debug("set tax on line",i  + ":" + taxRate);
                    soRecord.setSublistValue({ sublistId: 'item', fieldId: 'custcol_jlb_stored_tax_rate', line: i, value: taxRate });
                } else {
                    soRecord.setSublistValue({ sublistId: 'item', fieldId: 'custcol_jlb_stored_tax_rate', line: i, value: 0 });
                }
            } // end loop 

            // // save the changes to the SO record
            soRecord.save({
                enableSourcing: true,
                ignoreMandatoryFields: true
            });

        } catch (e) {
            log.error({ title: 'Error on after Submit: ', details: e });
        }
    }

    return {
        afterSubmit: afterSubmit
    };
});
