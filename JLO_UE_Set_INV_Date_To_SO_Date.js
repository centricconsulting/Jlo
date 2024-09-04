/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/log', 'N/search', 'N/runtime'], function (record, log, search, runtime) {
    function beforeSubmit(context) {
        if (context.type === context.UserEventType.CREATE || context.type === context.UserEventType.EDIT) {
            try {
                var orderTypeParam = runtime.getCurrentScript().getParameter({
                    name: 'custscript_order_type'
                });

                var invoiceRecord = context.newRecord;
                var invOrderType = invoiceRecord.getValue('custbody_jlb_order_type'); // Get the Sales Order ID


                if (invOrderType == orderTypeParam) {
                    var salesOrderId = invoiceRecord.getValue('createdfrom'); // Get the Sales Order ID

                    if (salesOrderId) {

                        var salesOrderTrandateLookup = search.lookupFields({
                            type: search.Type.SALES_ORDER,
                            id: salesOrderId,
                            columns: ['trandate']
                        });
                        var salesOrderTrandate = new Date(salesOrderTrandateLookup.trandate)

                        // Set the trandate of the invoice to match the Sales Order
                        invoiceRecord.setValue({
                            fieldId: 'trandate',
                            value: salesOrderTrandate
                        });

                        log.debug({
                            title: 'Updated Invoice Trandate',
                            details: 'Invoice ID: ' + invoiceRecord.id + ', Sales Order Trandate: ' + salesOrderTrandate
                        });
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

    return {
        beforeSubmit: beforeSubmit
    };
});
