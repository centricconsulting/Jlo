/**
 *@NApiVersion 2.x
 *@NScriptType ScheduledScript
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
 

    function execute(context) {
        try {
            var executionContext = runtime.executionContext;
            log.debug({ title: 'executionContext', details: executionContext });

            var internalId = runtime.getCurrentScript().getParameter({name: 'custscript_ron_internal_id'});
            var tranType = runtime.getCurrentScript().getParameter({name: 'custscript_ron_type'});
            var tranLine = runtime.getCurrentScript().getParameter({name: 'custscript_ron_line'});
            var taxAmt = runtime.getCurrentScript().getParameter({name: 'custscript_ron_tax_amt'});
            
            // // load the INV record.
            var invRecord = record.load({
                type: tranType,
                id: internalId,
                isDynamic: false
            });

            invRecord.setSublistValue({ sublistId: 'item', fieldId: 'taxcode', line: tranLine, value: 7649 });
            invRecord.setSublistValue({ sublistId: 'item', fieldId: 'taxrate1', line: tranLine, value: taxAmt });

            
            // // save the changes to the INV record
            invRecord.save({
                enableSourcing: true,
                ignoreMandatoryFields: true
            });
            
        } catch (e) {
            log.error({ title: 'Error on execute: ', details: e });
        }
    }

    return {
        execute: execute
    };

});
