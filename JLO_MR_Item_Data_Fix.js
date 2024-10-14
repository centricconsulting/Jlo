/**
 * @NApiVersion 2.x
 * @NScriptType MapReduceScript
 */
define(['N/record', 'N/search', 'N/runtime', 'N/email', 'N/url'], function (record, search, runtime, email, url) {

    function getInputData() {

        var originalItem = runtime.getCurrentScript().getParameter({ name: 'custscript_original_item' });
        var replacementItem = runtime.getCurrentScript().getParameter({ name: 'custscript_replacement_item' });
        var transactionDate = runtime.getCurrentScript().getParameter({ name: 'custscript_tran_date' });

        transactionDate = formatISODateToMMDDYYYY(transactionDate)
        log.debug('transactionDate', transactionDate);


        return invoiceSearchObj = search.create({
            type: "invoice",
            settings: [{ "name": "consolidationtype", "value": "ACCTTYPE" }, { "name": "includeperiodendtransactions", "value": "F" }],
            filters:
                [
                    ["type", "anyof", "CustInvc"],
                    "AND",
                    ["item", "anyof", originalItem],
                    "AND",
                    ["internalidnumber", "equalto", "2165596"], //Remove once done testing
                    "AND",
                    ["item", "noneof", replacementItem],
                    "AND",
                    ["trandate", "after", transactionDate]
                ],
            columns:
                [
                    search.createColumn({
                        name: "internalid",
                        summary: "GROUP",
                        label: "Internal ID"
                    }),
                    search.createColumn({
                        name: "type",
                        summary: "GROUP",
                        label: "Type"
                    })
                ]
        });
    }

    function map(context) {
        var contextValues = JSON.parse(context.value)
        log.debug('contextValues', contextValues);

        var recordId = contextValues.values["GROUP(internalid)"].value;
        log.debug('recordId', recordId);
        var recordType = contextValues.values["GROUP(type)"].value;
        log.debug('recordType', recordType);

        context.write({
            key: recordId, 
            value: { 
                recordType : recordType
            }
        });
    }

    function reduce(context) {
        log.debug("reduce entered",context.key);

        //var contextValues = JSON.parse(context.value)
        //log.debug('contextValues', contextValues);

        //var recordId = contextValues.values["GROUP(internalid)"].value;
        var recordId = context.key;
        log.debug('recordId', recordId);

        //var recordType = contextValues.values["GROUP(type)"].value;
        log.debug("context value",context.values[0]);
        var recordType = JSON.parse(context.values[0]).recordType;
        log.debug('recordType', recordType);

        var stType;
        switch (recordType) {
            case 'SalesOrd':
                stType = record.Type.SALES_ORDER
                break;
            case 'CustInvc':
                stType = record.Type.INVOICE
                break;
            case 'CustCred':
                stType =
                    record.Type.CREDIT_MEMO
                break;
        }


        try {
            var rec = record.load({
                type: stType,
                id: recordId,
                isDynamic: false
            });

            // context.write({
            //     key: recordId,
            //     value:  {   
            //         status : "No Associated Sales Order"    
            //     }
            // });
            // return;
            //throw new Error ("Ron Error");

            var createdFromId = rec.getValue('createdfrom');

            if (hasRelatedCreditMemo(recordId)) {
                log.debug('Skipping Invoice', 'Invoice ID: ' + recordId + ' has a related Credit Memo.');
                context.write({
                    key: recordId,
                    value:  {   
                        status : "Credit Memo Exists"    
                    }
                });
                return; // Skip this iteration
            }

            //Delete Related Payment Record
            deletePaymentApplication(recordId);

            log.debug("delete deposit application");

            // Delete the invoice record
            record.delete({
                type: record.Type.INVOICE,
                id: recordId
            });
            
            log.debug('Deleted Invoice', 'Invoice ID: ' + recordId + ' has been deleted.');

            if (createdFromId) {
                //Update the Item on the Related Sales Order
                var soUpdatedDate = updateRelatedSalesOrder(createdFromId)

                if (soUpdatedDate) {
                    var newInvoice = record.transform({
                        fromType: record.Type.SALES_ORDER,
                        fromId: createdFromId,
                        toType: record.Type.INVOICE
                    });
                    //Potentially need to set AR Account on Newly Created Invoice
                    var account = runtime.getCurrentScript().getParameter({ name: 'custscript_new_account' });
                    newInvoice.setValue('account', account); //Might beed to look into this
                    newInvoice.setValue('trandate', soUpdatedDate);
                    var newInvoiceSaved = newInvoice.save();
                    if (newInvoiceSaved) {
                        log.audit('Invoice Recreated successfully', 'Invoice ID: ' + createdFromId);

                        //Do we need this?
                        // var newInvoice = record.transform({
                        //     fromType: record.Type.INVOICE,
                        //     fromId: newInvoiceSaved,
                        //     toType: record.Type.CUSTOMER_PAYMENT
                        context.write({
                            key: createdFromId,
                            value:  {   
                                status : "Sales Order Processed"    
                            }
                        });
                    } else {
                        context.write({
                            key: createdFromId,
                            value:  {   
                                status : "Invoice Not Created"    
                            }
                        });
                    }
                }
            } else {
                context.write({
                    key: recordId,
                    value:  {   
                        status : "No Associated Sales Order"    
                    }
                });
            }

        } catch (e) {
            log.error('Error processing Invoice', e.message);
            throw e;
        }

    }

    function summarize(summary) {
        summary.mapSummary.errors.iterator().each(function (key, error) {
            log.error('Map Error for Key:' + key, 'Error: ' + error);
            return true;
        });

        summary.reduceSummary.errors.iterator().each(function (key, error) {
            log.error('Reduce Error for Key:' + key,'Error: ' + error);
            return true;
        });

        sendSummaryEmail(summary);
    }


    function sendSummaryEmail (summary) {
        log.debug("enter sendSummaryEmail");
        var recordsList = '';
        var errorList = '';
        var exceptionList = '';
        var refundList = '';


        // make this work like the reduce errors below
        summary.mapSummary.errors.iterator().each(function(key, error) {
            //log.error('Map Stage Error', 'Key: ' + key + ' Error: ' + error);
            exceptionList +=  //'<a href='+link+'>' + 
                'Invoice Internal Id (Map) : ' 
                + key
                + ":"
                + error
                +'</a><br>'
            return true;
        });

        summary.reduceSummary.errors.iterator().each(function(key, error) {
            //log.error('Map Stage Error', 'Key: ' + key + ' Error: ' + error);
            exceptionList +=  //'<a href='+link+'>' + 
                'Invoice Internal Id (Reduce) : ' 
                + key
                + ":"
                + error
                +'</a><br>'
            return true;
        });

        // go through the output 
        summary.output.iterator().each(function (key, value) {
            log.debug("key:value",key+":"+value);
            var data = JSON.parse(value);

            // var soLink = url.resolveRecord({
            //     recordType: 'salesorder',
            //     recordId: key,
            //     isEditMode: false
            // });



            // no problems applying digital payments
            // if (data.status === "Success" && 
            //     (data.lineStatus === null || data.lineStatus.length === 0)) {
            //     var invLink = url.resolveRecord({
            //         recordType: 'invoice',
            //         recordId: data.invoiceId,
            //         isEditMode: false
            //     });

            //     recordsList += '<a href='+invLink+'>' 
            //     + data.invoiceId
            //     + '</a>'
            //     + ' created from <a href=' + soLink + '> '+ key + '</a><br>';

            // // problems applying the installment payments
            // } else if (data.status === "Success") {
            //     for (i=0; i < data.lineStatus.length; i++) {
            //         errorList += '<a href='+soLink+'>' 
            //         + key
            //         + '</a> encountered the following errors: ' 
            //         + JSON.stringify(data.lineStatus[i]) 
            //         + '<BR>';
            //     }

            // skipping due to a customer refund
            //} else 
            if (data.status === "Credit Memo Exists") {
                var invLink = url.resolveRecord({
                    recordType: 'invoice',
                    recordId: key,
                    isEditMode: false
                });
                refundList += '<a href='+invLink+'>' 
                + key
                + '</a>'
                + ' was skipped due to a credit memo<br>';
            }
            else if (data.status === "Sales Order Processed") {
                var invLink = url.resolveRecord({
                    recordType: 'salesorder',
                    recordId: key,
                    isEditMode: false
                });
                recordsList += '<a href='+invLink+'>' 
                     + key
                     + '</a><br>';

            // other
            } else {
                exceptionList += '<a href='+invLink+'>' 
                + key
                + '</a>'
                + ' was skipped due to an exception: ' 
                + data.status 
                + '<br>';
            }
            
            return true;
        });

        // get these as parameters
        //var authorEmail = runtime.getCurrentScript().getParameter('custscript_jlo_sub_inv_author2');
        //var recipientEmail = runtime.getCurrentScript().getParameter('custscript_jlo_sub_inv_receive2');
        var authorEmail = 1474;
        var recipientEmail = 1474;

        log.debug('params', 'authorEmail = '+authorEmail+',  recipientEmail = '+recipientEmail)

        var bodyText =  'Invoice Item Fix process has completed.<br><br><b>List of Sales Order records with a new invoice:</b><br>' + recordsList + '';
        if (refundList) {
            bodyText += '<br /><br /><b>These invoices have a refund attached and were not processed:</b><br />' + refundList + '';
        }
        if (exceptionList) {
            bodyText += '<br /><br /><b>Exceptions encountered:</b><br />' + exceptionList + '';
        }
        log.debug("test",bodyText);

        email.send({
            author: authorEmail,
            recipients: recipientEmail,
            subject: 'Invoice Item Fix process has completed',
            body: bodyText,
        })
        log.debug("exit sendSummaryEmail");
    }

    /**
 * Converts a date string to a formatted date string in "MM/DD/YYYY" format.
 *
 * @param {string} isoDateStr - A date string (e.g., "2024-07-05T07:00:00.000Z").
 * @returns {string} The formatted date string in "MM/DD/YYYY" format.
 *
 */
    function formatISODateToMMDDYYYY(isoDateStr) {
        // Create a new Date object from the ISO date string
        var date = new Date(isoDateStr);

        // Extract the month, day, and year
        var month = ('0' + (date.getUTCMonth() + 1)).slice(-2); // Add leading zero if needed
        var day = ('0' + date.getUTCDate()).slice(-2);          // Add leading zero if needed
        var year = date.getUTCFullYear();

        // Return the formatted date as "MM/DD/YYYY"
        return month + '/' + day + '/' + year;
    }

    /**
 * Check if the invoice has a related credit memo
 * @param {string} invoiceId - ID of the invoice
 * @returns {boolean} - True if there is a related credit memo, false otherwise
 */
    function hasRelatedCreditMemo(invoiceId) {
        var creditMemoSearch = search.create({
            type: search.Type.CREDIT_MEMO,
            filters: [
                ['createdfrom', search.Operator.ANYOF, invoiceId] // Check if the credit memo was created from the invoice
            ],
            columns: ['internalid']
        });

        var creditMemoResults = creditMemoSearch.run().getRange({
            start: 0,
            end: 1
        });
        creditMemoResults.forEach(function (creditMemo) {
            log.debug("credit memo",creditMemo.getValue({ name: 'internalid' }));
        });       
        log.debug("credit memo number",creditMemoResults.length);

        return creditMemoResults.length > 0;
    }

    /**
    * Delete the payment application related to an invoice
    * @param {string} invoiceId - ID of the invoice for which to delete the payment application
    */
    function deletePaymentApplication(invoiceId) {
        var paymentAppSearch = search.create({
            type: search.Type.DEPOSIT_APPLICATION,
            settings: [{ "name": "consolidationtype", "value": "ACCTTYPE" }, { "name": "includeperiodendtransactions", "value": "F" }],
            filters:
                [
                    //["type", "anyof", "CustPymt"],
                    //"AND",
                    ["appliedtotransaction", "anyof", invoiceId]
                ],
            columns:
                [
                    search.createColumn({ name: "internalid", label: "Internal ID" })
                ]
        });

        var paymentAppResults = paymentAppSearch.run().getRange({
            start: 0,
            end: 1000
        });

        paymentAppResults.forEach(function (paymentApp) {
            try {
                log.debug("try deposit app",paymentApp.getValue({ name: 'internalid' }));
                record.delete({
                    type: record.Type.DEPOSIT_APPLICATION,
                    id: paymentApp.getValue({ name: 'internalid' })
                });
                log.debug('Deleted Payment Application', 'Payment ID: ' + paymentApp.getValue({ name: 'internalid' }));
            } catch (e) {
                log.error('Error deleting payment application', 'Payment ID: ' + paymentApp.getValue({ name: 'internalid' }) + ' - ' + e.message);
            }
        });
    }


    /**
     * Updates the Sales Order record based on the original item and replacement item.
     * @param {string} createdFromId - ID of the Sales Order to update.
     * @returns {boolean} - Returns true if the update was successful, false otherwise.
     */
    function updateRelatedSalesOrder(createdFromId) {
        try {
            // Get script parameters for original and replacement items
            var originalItem = runtime.getCurrentScript().getParameter({ name: 'custscript_original_item' });
            var replacementItem = runtime.getCurrentScript().getParameter({ name: 'custscript_replacement_item' });

            // Load the Sales Order record
            var salesOrderRecord = record.load({
                type: record.Type.SALES_ORDER,
                id: createdFromId,
                isDynamic: false
            });

            var soDate = salesOrderRecord.getValue('trandate')
            var lineCount = salesOrderRecord.getLineCount({ sublistId: 'item' });

            for (var i = 0; i < lineCount; i++) {
                var itemId = salesOrderRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
                log.debug('itemId', itemId);
                log.debug('originalItem', originalItem);

                // Check if this is the line we need to update
                if (itemId == originalItem) {
                    // Get existing values from the line
                    var rate = salesOrderRecord.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: i });
                    var quantity = salesOrderRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i });
                    var amount = salesOrderRecord.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: i });
                    var taxCode = salesOrderRecord.getSublistValue({ sublistId: 'item', fieldId: 'taxcode', line: i });
                    var tax = salesOrderRecord.getSublistValue({ sublistId: 'item', fieldId: 'taxrate1', line: i });

                    log.debug('Original Values', {
                        rate: rate,
                        quantity: quantity,
                        amount: amount,
                        taxCode: taxCode,
                        tax: tax
                    });

                    // Update the item with the replacement item
                    salesOrderRecord.setSublistValue({ sublistId: 'item', fieldId: 'item', value: replacementItem, line: i });
                    salesOrderRecord.setSublistValue({ sublistId: 'item', fieldId: 'rate', value: rate, line: i });
                    salesOrderRecord.setSublistValue({ sublistId: 'item', fieldId: 'quantity', value: quantity, line: i });
                    salesOrderRecord.setSublistValue({ sublistId: 'item', fieldId: 'amount', value: amount, line: i });
                    salesOrderRecord.setSublistValue({ sublistId: 'item', fieldId: 'taxcode', value: taxCode, line: i });
                    salesOrderRecord.setSublistValue({ sublistId: 'item', fieldId: 'taxrate1', value: tax, line: i });

                }
            }

            // Save the record to commit changes
            salesOrderRecord.save();
            log.debug('Sales Order updated successfully', 'Sales Order ID: ' + createdFromId);

            return soDate;
        } catch (e) {
            log.error('Error updating Sales Order', 'Sales Order ID: ' + createdFromId + ' - ' + e.message);
            return false;
        }
    }



    return {
        getInputData: getInputData,
        map: map,
        reduce: reduce,
        summarize: summarize
    };
});


//TO ZERO OUT CURRENT LINE, AND CREATE NEW LINE
// Zero out the current line
// rec.setSublistValue({ sublistId: 'item', fieldId: 'rate', value: 0, line: i });
// rec.setSublistValue({ sublistId: 'item', fieldId: 'quantity', value: 0, line: i });
// rec.setSublistValue({ sublistId: 'item', fieldId: 'amount', value: 0, line: i });
// rec.setSublistValue({ sublistId: 'item', fieldId: 'taxcode', value: '', line: i });
// rec.setSublistValue({ sublistId: 'item', fieldId: 'taxamount', value: 0, line: i });

// // Add a new line with the replacement item and original values
// rec.insertLine({ sublistId: 'item', line: i + 1 });

// rec.setSublistValue({ sublistId: 'item', fieldId: 'item', value: replacementItem, line: i + 1 });
// rec.setSublistValue({ sublistId: 'item', fieldId: 'rate', value: rate, line: i + 1 });
// rec.setSublistValue({ sublistId: 'item', fieldId: 'quantity', value: quantity, line: i + 1 });
// rec.setSublistValue({ sublistId: 'item', fieldId: 'amount', value: amount, line: i + 1 });
// rec.setSublistValue({ sublistId: 'item', fieldId: 'taxcode', value: taxCode, line: i + 1 });
// rec.setSublistValue({ sublistId: 'item', fieldId: 'taxamount', value: tax, line: i + 1 });