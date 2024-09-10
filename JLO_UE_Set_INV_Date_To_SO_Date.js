/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/log', 'N/search', 'N/runtime'], function (record, log, search, runtime) {
    function beforeSubmit(context) {
        var cutoffDate = runtime.getCurrentScript().getParameter({name: 'custscript_cutoff_date'});
        log.debug("date",cutoffDate);

        if (context.type === context.UserEventType.CREATE || context.type === context.UserEventType.EDIT) {
            try {
                var orderTypeParam = runtime.getCurrentScript().getParameter({
                    name: 'custscript_order_type'
                });

                var invoiceRecord = context.newRecord;


                var invOrderType = invoiceRecord.getValue('custbody_jlb_order_type'); // Get the Sales Order ID


                if (invOrderType == orderTypeParam) {
                    var salesOrderId = invoiceRecord.getValue('createdfrom'); // Get the Sales Order ID
                    log.debug("salesOrderId",salesOrderId);
                    if (salesOrderId) {

                        var salesOrderTrandateLookup = search.lookupFields({
                            type: search.Type.SALES_ORDER,
                            id: salesOrderId,
                            columns: ['trandate']
                        });
                        var salesOrderTrandate = new Date(salesOrderTrandateLookup.trandate)

                        var ifTranDateStr = getIFTranDate(salesOrderId);
                        log.debug("IF Date",ifTranDateStr);
                        if (ifTranDateStr) {
                            var ifTranDate = new Date(ifTranDateStr);
                            if (ifTranDate < cutoffDate) {
                                invoiceRecord.setValue({
                                    fieldId: 'trandate',
                                    value: ifTranDate
                                });
    
                                log.debug({
                                    title: 'Updated Invoice Trandate',
                                    details: 'Invoice ID: ' + invoiceRecord.id + ', Sales Order Trandate: ' + ifTranDate
                                });
                            }
                        } else if (salesOrderTrandate < cutoffDate) {
                            log.debug("enter check");

                            // Set the trandate of the invoice to match the Sales Order
                            invoiceRecord.setValue({
                                fieldId: 'trandate',
                                value: salesOrderTrandate
                            });

                            log.debug({
                                title: 'Updated Invoice Trandate',
                                details: 'Invoice ID: ' + invoiceRecord.id + ', Sales Order Trandate: ' + salesOrderTrandate
                            });
                        }
                    } else {
                        log.debug({
                            title: 'No Sales Order Found',
                            details: 'No Sales Order ID found on invoice ID: ' + invoiceRecord.id
                        });
                    }
                } else {
                    log.debug({
                        title: 'Invoice Type Does not Match',
                        details: 'Invoice Type is not: ' + orderTypeParam
                    });
                }
            } catch (e) {
                log.error({
                    title: 'Error in Before Submit Script',
                    details: e.message
                });
            }
        }
    }

    function getIFTranDate(salesOrderId) {
        var transactionSearchObj = search.create({
            type: search.Type.ITEM_FULFILLMENT,
            filters:
            [
                ["createdfrom","anyof",salesOrderId],
                "AND",
                ["mainline","is","T"]

                //, 
                //"AND", 
                //["type","anyof","itemship"]
            ],
            columns:
            [
                search.createColumn({name: "internalid", label: "Internal ID"}),
                search.createColumn({name: "type", label: "Type"}),
                search.createColumn({name: "trandate", label: "Tran Date"})
            ]
        });

        var searchResultCount = transactionSearchObj.runPaged().count;
        log.debug("transactionSearchObj result count",searchResultCount);
        var tranDate = null;
        transactionSearchObj.run().each(function(result){
            // .run().each has a limit of 4,000 results
            log.debug("result",result);
            tranDate = result.getValue({ name: "trandate" });
            return true;
        });
        log.debug("createdDate",tranDate);
        return tranDate;
    }

    return {
        beforeSubmit: beforeSubmit
    };
});
