/**
 *@NApiVersion 2.x
 *@NScriptType ScheduledScript
/= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * VER  DATE           AUTHOR               		CHANGES
 * 1.0  Aug 7, 2023   Centric Consulting(Aman)   	Initial Version
 * 
 * This script is used to set a tax rate on a line on a credit memo since we can't
 * exit the field directly
 * 
 * 
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */

define(['N/record', 'N/runtime'], function (record, runtime) {
 

    function execute() {
        try {
            var recordId = runtime.getCurrentScript().getParameter({name: 'custscript_ron_cmid'});
            var lineId = runtime.getCurrentScript().getParameter({name: 'custscript_ron_line_id'});
            var tax = runtime.getCurrentScript().getParameter({name: 'custscript_ron_tax'});
            //log.debug("celigoTaxItem",celigoTaxItem);

            
                // // load the INV record.
                var tranRecord = record.load({
                    type: record.Type.CREDIT_MEMO,
                    id: recordId,
                    isDynamic: false
                });

                var itemCount = tranRecord.getLineCount({ sublistId: 'item' });
                log.debug({ title: 'Item Count', details: itemCount });
                // for (var i = 0; i < itemCount; i++) {
                //     var taxRate = tranRecord.getSublistValue({ sublistId: 'item', fieldId: 'line', line: i });
                //     var taxCode = tranRecord.getSublistValue({ sublistId: 'item', fieldId: 'taxcode', line: i });

                //     // if (taxCode === celigoTaxItem) {
                //     //     log.debug("set tax on line",i  + ":" + taxRate);
                   
                //     // } else {
                //     //     // do nothing
                //     // }
                //     log.debug("line",taxCode + ":" + taxRate);

                // } // end loop 
                tranRecord.setSublistValue({ sublistId: 'item', fieldId: 'taxrate1', line: lineId, value: tax });
                // // save the changes to the INV record
                tranRecord.save({
                    enableSourcing: true,
                    ignoreMandatoryFields: true
                });

        } catch (e) {
            log.error({ title: 'Error on after Submit: ', details: e });
        }
    }


    return {
        execute: execute
    }
});
