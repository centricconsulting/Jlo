/**
 *@NApiVersion 2.x
 *@NScriptType UserEventScript
/**= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * Purpose: This script is to copy a new line from existing line.
 * VER  DATE           AUTHOR               		    CHANGES    
 * 1.0  Aug 24, 2023   Centric Consulting(Pradeep)   	Initial Version
 * 
 * If any line on the sales order has 'custcol_shpfy_subscrptn_flg' = 'Y', then set the 
 * 'custbody_cen_jlo_instal_ord' field at the Sales Order header level. This allows 
 * 2 things to happen: 1) we can pick up the sales order to be invoiced via a custom
 * process and 2) we can filter the order to be skipped from the standard "Process 
 * Billing Operations"
 * 
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */

define(['N/record', 'N/search', 'N/runtime'], function (record, search, runtime) {



    function processSalesOrder(context) {
        if (context.type !== context.UserEventType.CREATE)
            return;

        var digitalPaymentItem = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_digital_pmt'});
        var choiceBundleItem = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_choice'});
        var cutoffDate = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_cutoff'});

        var newRecord = context.newRecord;
        var salesOrderId = context.newRecord.id;
        // Load the Sales Order record 
        var newRecord = record.load({ type: record.Type.SALES_ORDER, id: salesOrderId });
        var lineCount = newRecord.getLineCount({ sublistId: 'item' });
        log.debug('lineCount', lineCount);

        var jloLocation = newRecord.getValue({fieldId: 'location' });
        var creationDate = newRecord.getValue({fieldId: 'createddate' });
        
        var etailID = newRecord.getValue({fieldId: 'custbody_celigo_etail_order_id' });


        var setInstallOrderFlag = false;
        var setDigitalPmtFlag = false;
        var setChoiceBundle = false;

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

            var lineClass = newRecord.getSublistValue({
                sublistId: 'item',
                fieldId: 'class',
                line: i
            });            

             var shpfyPrc = newRecord.getSublistValue({
                sublistId: 'item',
                fieldId: 'custcolcustcol_shpfy_inst_prc',
                line: i
            });      

             var shpfyInstmts = newRecord.getSublistValue({
                sublistId: 'item',
                fieldId: 'custcolcustcol_shpfy_num_instlmts',
                line: i
            });      



            log.debug('Processing line ' + (i + 1), 'isKitOrAssembly: ' + isKitOrAssembly + ', hasInstallmentFlag: ' + hasInstallmentFlag + ', hasOriginalPrice: ' + hasOriginalPrice + ', isclosed: ' + isclosed, 'taxCode : ' + taxCode);

            if (itemId == digitalPaymentItem) {
                log.debug("digital payment item","true");
                setDigitalPmtFlag = true;
            }

            if (itemId == choiceBundleItem) {
                log.debug("choice bundle item","true");
                setChoiceBundle = true;
            }

            if (
                (isKitOrAssembly === 'Kit' || isKitOrAssembly === 'Assembly') &&
                hasInstallmentFlag === 'Y' &&
                hasOriginalPrice !== null &&
                !isclosed
            ) {

                // set this flag to true so that the field can be set at the header level
                setInstallOrderFlag = true;

                log.debug("date type",typeof cutoffDate + ":" + typeof creationDate);
                log.debug("date check",cutoffDate + ":" + creationDate );
                log.debug("date check2", cutoffDate.getTime() > creationDate.getTime());

                if (cutoffDate.getTime() > creationDate.getTime()) {

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
                        fieldId: 'class',
                        line: j, // Use newLine here instead of i
                        value: lineClass
                    });                

                    newRecord.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'quantity',
                        line: j, // Use newLine here instead of i
                        value: quantity
                    });

                    newRecord.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcolcustcol_shpfy_inst_prc',
                        line: j, // Use newLine here instead of i
                        value: shpfyPrc
                    });

                    newRecord.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcolcustcol_shpfy_num_instlmts',
                        line: j, // Use newLine here instead of i
                        value: shpfyInstmts
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

        }

        newRecord.setValue({
            fieldId: 'location',
            value: jloLocation
        });

        // if any line was a subscription line, flag the Sales Order at the header level.
        newRecord.setValue({
            fieldId: 'custbody_cen_jlo_instal_ord',
            value: setInstallOrderFlag
        });

        newRecord.setValue({
            fieldId: 'custbody_cen_jlo_digital_pmt_ord',
            value: setDigitalPmtFlag
        });

        newRecord.setValue({
            fieldId: 'custbody_cen_jlo_choice',
            value: setChoiceBundle
        });

        newRecord.setValue({
            fieldId: 'custbody_jlo_etail_order_id',
            value: etailID || '' // set empty string if etailID is null
        });

        // Save the Sales Order record
        var savedOrderId = newRecord.save();
        log.debug('Saved Sales Order', 'Order ID: ' + savedOrderId);
    }



    return {
        afterSubmit: processSalesOrder
    };
});