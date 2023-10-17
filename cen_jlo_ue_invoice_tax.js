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

            var mode = context.type;
            var currentRecord = context.newRecord;
            if (mode == 'create') {
                log.debug({ title: 'Mode', details: mode });
                var invoiceId = currentRecord.getValue({ fieldId: "id" });
                var customer = currentRecord.getValue({ fieldId: "entity" });
                var salesOrderId = currentRecord.getValue({ fieldId: "createdfrom" });
                log.debug({ title: 'so Detail', details: "int ID: " + invoiceId + ", Cust: " + customer 
                                   + ", Sales Order: " + salesOrderId });

                // Mazuk - if no SO record, then skip
                
                // load the SO record.
                var soRecord = record.load({
                    type: record.Type.SALES_ORDER,
                    id: salesOrderId,
                    isDynamic: false
                });

                // // load the INV record.
                var invRecord = record.load({
                    type: record.Type.INVOICE,
                    id: invoiceId,
                    isDynamic: false
                });

                var itemCount = soRecord.getLineCount({ sublistId: 'item' });
                log.debug({ title: 'Item Count', details: itemCount });
                for (var i = 0; i < itemCount; i++) {
                    var taxRate = soRecord.getSublistValue({ sublistId: 'item', fieldId: 'taxrate1', line: i });
                    //var taxRate = soRecord.getSublistValue({ sublistId: 'item', fieldId: 'taxrate1', line: i });
                    log.debug("set tax on line",i  + ":" + taxRate);
                    invRecord.setSublistValue({ sublistId: 'item', fieldId: 'taxrate1', line: i, value: taxRate });
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
        afterSubmit: afterSubmit
    };
});
