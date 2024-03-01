/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
/= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * Purpose:  A script to automate invoice for installment items.
 * VER  DATE           AUTHOR               		CHANGES
 * 1.0  Dec 04, 2023   Centric Consulting(Aman)   	Initial Version
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */

define(['N/search', 'N/record', 'N/runtime', 'N/url', 'N/email'],
    function (search, record, runtime, url, email) {
        //var savedSearch = runtime.getCurrentScript().getParameter({ name: 'custscript_sales_order_saved_search' });

        function getInputData() {
            log.debug("get input data");
            //return search.load({ id: savedSearch });

            var suiteQL = `
                select 
                    t.id, 
                    t.entity, 
                    t.type, 
                    t.status, 
                    t.custbody_cen_jlo_instal_ord
                from transaction t
                where 
                     t.id >= 47724 and 
                    t.custbody_cen_jlo_instal_ord = 'T'
                    and t.recordtype = 'salesorder'
                    and t.status = 'F' -- pending billing only
            `; 
            
             return {
                type: 'suiteql',
                query: suiteQL
            };
        }

        function map(context) {
            var jsonobj = JSON.parse(context.value);
            log.debug("Json : ", jsonobj);
            log.debug("Json values:",jsonobj.values[0]);

            var varianceItem = runtime.getCurrentScript().getParameter({ name: 'custscript_jlo_variance_item' });
            var arAccount = runtime.getCurrentScript().getParameter({ name: 'custscript_jlo_ar_acct' });
            var terms = runtime.getCurrentScript().getParameter({ name: 'custscript_jlo_terms' });
            log.debug("varianceItem",varianceItem);

            // load the sales order and then close the variance line
            var salesRec = record.load({
                type: record.Type.SALES_ORDER,
                id: jsonobj.values[0],
                isDynamic: false
            });

            var lineSOCount = salesRec.getLineCount({ sublistId: 'item' });
            log.debug("line count",lineSOCount);
            // loop through the item lines
            for (var i = 0; i < lineSOCount; i++) {
                var item = salesRec.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'item',
                    line: i
                });

                log.debug("item",item);
                if (item == varianceItem) {
                    log.debug("remove item");
                    salesRec.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'isclosed',
                        line: i, 
                        value: true
                    });
                }
            }

            salesRec.save({
                enableSourcing: true,
                ignoreMandatoryFields: true
            });

            // now create the invoice
            var invoiceOne = record.transform({
                fromType:'salesorder',
                fromId: jsonobj.values[0],
                toType: 'invoice'
                //,
                //defaultValues: {
                //billdate: '01/01/2019'} 
            });

            // set the AR Account
            invoiceOne.setValue({fieldId: 'account', value: arAccount, ignoreFieldChange: false});
            invoiceOne.setValue({fieldId: 'terms', value: terms, ignoreFieldChange: false});

            /// need to process lines
            //  - remove any shopify order variances
            //  - fix any subscription lines to be only 1 payment
            //  - eventually handle shipping when we get the rules
            var lineCount = invoiceOne.getLineCount({ sublistId: 'item' });
            log.debug("line count",lineCount);
            // loop through the item lines
            for (var i = 0; i < lineCount; i++) {
                var line = invoiceOne.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'line',
                    line: i
                });
                log.debug("line",line);
                var item = invoiceOne.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'item',
                    line: i
                });

                log.debug("item",item);
                if (item == varianceItem) {
                    log.debug("remove item");
                    invoiceOne.removeLine({
                        sublistId: 'item',
                        line: i,
                        ignoreRecalc: true
                    });
                }
            }

            var invoiceId = invoiceOne.save({
                enableSourcing: true,
                ignoreMandatoryFields: true
            });

            context.write({
                key: invoiceId,
                value:  {   
                        salesOrderId: jsonobj.values[0]
                    }
                });

            log.debug("invoice id",invoiceId);
        }

        function summarize(context) {
            context.mapSummary.errors.iterator().each(
                function (key, error, executionNo) {
                    log.error({
                        title: 'Map error for key: ' + key + ', execution no.  ' + executionNo,
                        details: error
                    });
                    return true;
                }
            );

            sendSummaryEmail(context);

            log.debug("summarize complete");
        }

        function sendSummaryEmail (summary) {
            log.debug("enter sendSummaryEmail");
            var recordsList = '';
            var errorList = '';
            var exceptionList = '';


            // make this work like the reduce errors below
            summary.mapSummary.errors.iterator().each(function(key, error) {
                log.error('Map Stage Error', 'Key: ' + key + ' Error: ' + error);
                exceptionList +=  //'<a href='+link+'>' + 
                    'Map : ' 
                    + key
                    + ":"
                    + error
                    +'</a><br>'
                return true;
            });

            summary.reduceSummary.errors.iterator().each(function(key, error) {
                //log.error('Reduce Stage Error', 'Key: ' + key + ' Error: ' + error);
                var parsedError = JSON.parse(error);
                log.debug("parsed",parsedError);
                exceptionList +=  
                    'Reduce : Sales Order Id: '
                    + key
                    + ", Error:"
                    + error
                    +'</a><br>'
                return true;
            });


            // go through the output 
            summary.output.iterator().each(function (key, value) {
                log.debug("key:value",key+":"+value);
                var data = JSON.parse(value);
                
                var invLink = url.resolveRecord({
                    recordType: 'invoice',
                    recordId: key,
                    isEditMode: false
                });

                var soLink = url.resolveRecord({
                    recordType: 'salesorder',
                    recordId: data.salesOrderId,
                    isEditMode: false
                });

                recordsList += '<a href='+invLink+'>' 
                + key
                + '</a>'
                + ' created from <a href=' + soLink + '> '+ data.salesOrderId + '</a><br>';

                return true;
            });

            // get these as parameters
            var authorEmail = runtime.getCurrentScript().getParameter('custscript_jlo_sub_inv_author');
            var recipientEmail = runtime.getCurrentScript().getParameter('custscript_jlo_sub_inv_receive');

            log.debug('params', 'authorEmail = '+authorEmail+',  recipientEmail = '+recipientEmail)

            var bodyText =  'Subscription Invoice process has completed.<br><br><b>List of Invoice records created:</b><br>' + recordsList + '';
            if (errorList) {
                bodyText += '<br /><br /><b>Errors encountered while creating invoices:</b><br />' + errorList + '';
            }
            if (exceptionList) {
                bodyText += '<br /><br /><b>Exceptions encountered:</b><br />' + exceptionList + '';
            }
            log.debug("test",bodyText);

            email.send({
                author: authorEmail,
                recipients: recipientEmail,
                subject: 'Subscription Invoice process has completed',
                body: bodyText,
            })
            log.debug("exit sendSummaryEmail");
        }

        return {
            getInputData: getInputData,
            map: map,
            //reduce: reduce,
            summarize: summarize
        };
    });