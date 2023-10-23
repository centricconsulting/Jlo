/**
 *@NApiVersion 2.x
 *@NScriptType UserEventScript
/**= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * Purpose: This script is to copy a new line from existing line.
 * VER  DATE           AUTHOR               		    CHANGES    
 * 1.0  Aug 24, 2023   Centric Consulting(Pradeep)   	Initial Version
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */
define(['N/record', 'N/search'], function (record, search) {



    function processSalesOrder(context) {
        if (context.type !== context.UserEventType.CREATE)
            return;

        var newRecord = context.newRecord;
        var salesOrderId = context.newRecord.id;
        // Load the Sales Order record 
        var newRecord = record.load({ type: record.Type.SALES_ORDER, id: salesOrderId });
        var lineCount = newRecord.getLineCount({ sublistId: 'item' });
        log.debug('lineCount', lineCount);
        var jloLocation = newRecord.getValue({
            fieldId: 'location'
        });

        for (var i = 0; i < lineCount; i++) {
            log.debug('lineCount1', lineCount + ' , i: ' + i);
            var itemId = newRecord.getSublistValue({
                sublistId: 'item',
                fieldId: 'item',
                line: i
            });

            var itemline = newRecord.getSublistSubrecord({
                sublistId: 'item',
                fieldId: 'inventorydetail',
                line: i
            });

            var isKitOrAssembly = newRecord.getSublistValue({
                sublistId: 'item',
                fieldId: 'itemtype',
                line: i
            });

            var hasInstallmentFlag = newRecord.getSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_shpfy_subscrptn_flg',
                line: i
            });

            var hasOriginalPrice = newRecord.getSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_shpfy_orgnl_prc',
                line: i
            });

            var isclosed = newRecord.getSublistValue({
                sublistId: 'item',
                fieldId: 'isclosed',
                line: i
            });

            var taxCode = newRecord.getSublistValue({
                sublistId: 'item',
                fieldId: 'taxcode',
                line: i
            });

            var location = newRecord.getSublistValue({
                sublistId: 'item',
                fieldId: 'location',
                line: i
            });

            



            log.debug('Processing line ' + (i + 1), 'isKitOrAssembly: ' + isKitOrAssembly + ', hasInstallmentFlag: ' + hasInstallmentFlag + ', hasOriginalPrice: ' + hasOriginalPrice + ', isclosed: ' + isclosed, 'taxCode : ' + taxCode);


            if (
                (isKitOrAssembly === 'Kit' || isKitOrAssembly === 'Assembly') &&
                hasInstallmentFlag === 'Y' &&
                hasOriginalPrice !== null &&
                !isclosed
            ) {
                // Perform the necessary actions based on criteria
                var closedLineId = newRecord.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'id',
                    line: i
                });
                log.debug('Processing line ' + (i + 1), 'Closed Line ID: ' + closedLineId);


                // Close the original line
                
                // newRecord.setSublistValue({
                //     sublistId: 'item',
                //     fieldId: false,
                //     line: i,
                //     value: true
                // });

                // Calculate the "Amount" as Quantity * Rate
                var quantity = newRecord.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantity',
                    line: i
                });
                var rate = newRecord.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_shpfy_orgnl_prc',
                    line: i
                });

                var etail = newRecord.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_celigo_etail_order_line_id',
                    line: i
                });

                var amount = quantity * rate;

                log.debug('Quantity: ' + quantity);

                log.debug('Rate: ' + rate);
                log.debug('Calculated Amount: ' + amount);

                var taxrate1 = newRecord.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'taxrate1',
                    line: i
                });

                newRecord.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'isclosed',
                    line: i, 
                    value: true
                });


                // Create a new line
                var j = i;
                j = j + 1;
                var newLine = newRecord.insertLine({
                    sublistId: 'item',
                    line: j // Insert after the current line
                });

                newLine.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'item',
                    line: j,
                    value: itemId
                });

                newLine.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'rate',
                    line: j,
                    value: rate
                });

                newLine.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'amount',
                    line: j,
                    value: amount
                });
                newLine.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_celigo_etail_order_line_id',
                    line: j,
                    value: etail
                });
                newRecord.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'taxcode',
                    line: j, // Use newLine here instead of i
                    value: taxCode
                });

                newRecord.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'location',
                    line: j, // Use newLine here instead of i
                    value: location
                });

                newRecord.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantity',
                    line: j, // Use newLine here instead of i
                    value: quantity
                });

                newRecord.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'taxrate1',
                    line: j, // Use newLine here instead of i
                    value: taxrate1
                });

                log.debug('Processing line ' + (j), 'New Line created at index: ' + newLine);

                i = i +1;
               lineCount = lineCount +1;
                
            }

        }

        newRecord.setValue({
            fieldId: 'location',
            value: jloLocation
        });


        // Save the Sales Order record
        var savedOrderId = newRecord.save();
        log.debug('Saved Sales Order', 'Order ID: ' + savedOrderId);
    }



    return {
        afterSubmit: processSalesOrder
    };
});