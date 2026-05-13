/**
 *@NApiVersion 2.x
 *@NScriptType UserEventScript

 /= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * Purpose: This Script is use to update order id of shofipy on sales order and invoice.
 * VER  DATE           AUTHOR               		      CHANGES
 * 1.0  Sep 29, 2023   Centric Consulting(Aman)           Initial Version
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */

define(['N/record', 'N/search'], function (record, search) {

    function myAfterSubmit(context) {
        if (context.type !== context.UserEventType.CREATE)
            return;
        try {
            var newRecord = context.newRecord;
            var tranID = newRecord.id;
            var tranType = newRecord.type;
            // To update sales order
            if (tranType == "salesorder") {
                var eTailOrderID = newRecord.getValue({ fieldId: 'custbody_celigo_etail_order_id' }); // old field
                var shofipyOrderID = newRecord.getValue({ fieldId: 'custbody_shopify_order_id' }); // new field
                log.debug("Detail", "Type: " + tranType + ", ID: " + tranID + ", eTailOrderID: " + eTailOrderID)
                var shopify_Original_Order_ID;
                if (!shofipyOrderID && eTailOrderID) {
                    record.submitFields({
                        type: record.Type.SALES_ORDER,
                        id: 1,
                        values: {
                            'custbody_shopify_order_id': eTailOrderID
                        },
                        options: {
                            enableSourcing: false,
                            ignoreMandatoryFields: true
                        }
                    });
                }

                if (!shofipyOrderID && !eTailOrderID) {
                    var SORecord = record.load({ type: record.Type.SALES_ORDER, id: tranID, isDynamic: true });
                    var itemCount = SORecord.getLineCount({ sublistId: 'item' });
                    for (var i = 0; i < itemCount; i++) {
                        shopify_Original_Order_ID = SORecord.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'custcolcustcol_shpfy_orgnl_order',
                            line: i
                        });
                        if (shopify_Original_Order_ID) {
                            break;
                        }
                    }
                    if (shopify_Original_Order_ID) {
                        SORecord.setValue({ fieldId: 'custbody_shopify_order_id', value: shopify_Original_Order_ID });
                    }
                    SORecord.save({ enableSourcing: true, ignoreMandatoryFields: true });
                }
            }
            // To update Invoice
            if (tranType == "invoice") {
                var eTailOrderID = newRecord.getValue({ fieldId: 'custbody_celigo_etail_order_id' }); // old field
                var shofipyOrderID = newRecord.getValue({ fieldId: 'custbody_shopify_order_id' }); // new field
                log.debug("Detail", "Type: " + tranType + ", ID: " + tranID + ", eTailOrderID: " + eTailOrderID)
                var shopify_Original_Order_ID;
                if (!shofipyOrderID) {
                    var invRecord = record.load({ type: record.Type.INVOICE, id: tranID, isDynamic: true });
                    var createdForm = invRecord.getValue({ fieldId: 'createdfrom' });
                    if (createdForm) {
                        var soFlds = search.lookupFields({
                            type: record.Type.SALES_ORDER,
                            id: createdForm,
                            columns: ["custbody_shopify_order_id"],
                        });
                        shopify_Original_Order_ID = soFlds.custbody_shopify_order_id;
                    }
                    if (shopify_Original_Order_ID) {
                        invRecord.setValue({ fieldId: 'custbody_shopify_order_id', value: shopify_Original_Order_ID });
                    }
                    invRecord.save({ enableSourcing: true, ignoreMandatoryFields: true });
                }
            }
        } catch (e) {
            log.debug("Error", "ID: " + tranID + ", Rec Type: " + tranType + ", error: " + e);
        }
    }
    return {
        afterSubmit: myAfterSubmit
    }

});


