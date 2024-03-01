/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
/= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * Purpose: To apply customer deposit in invoice based on customer deposit balance.
 * VER  DATE           AUTHOR               		CHANGES
 * 1.0  Sep 19, 2023   Centric Consulting(Pradeep)   	Initial Version
 * 
 * There are situations where Celigo is applying a customer refund to a sales order, but the 
 * sales order is not being cleared out. In this situation, the sales order needs to be cancelled.
 * Note that fulfillment may have happened already, but given we've refunded the 
 * customer deposit invoicing does not make any sense.
 * 
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */

define(['N/search', 'N/record', 'N/runtime', 'N/email', 'N/url', 'N/query'],
    function (search, record, runtime, email, url, query) {
        function getInputData() {
            log.audit('<<< START >>>', 'Start of script execution');

            // Sales Order status:  A = Pending Approval, B = Pending Fulfillment,  F = Pending Billing
            var suiteQL = `
                select t.id crid, 
                    t.custbody_celigo_etail_order_id, 
                    t.foreigntotal crtotal, 
                    t.status crstatus, 
                    t.trandisplayname crname, 
                    so.id soid, 
                    so.recordtype sotype, 
                    so.foreigntotal sototal, 
                    so.status sostatus, 
                    so.custbody_cen_jlo_digital_pmt_ord, 
                    so.trandisplayname soname, 
                    so.trandate,
                    t.foreigntotal + so.foreigntotal sum
                from transaction t,
                    transaction so
                where 
                    t.recordtype = 'customerrefund'
                    and so.custbody_celigo_etail_order_id = t.custbody_celigo_etail_order_id
                    and so.recordtype  != 'customerrefund'
                    --and t.foreigntotal = (-1) * so.foreigntotal
                    and so.status = 'F'  -- Pending Billing
                    and so.id = 776290
                    order by t.id desc
            `; 
            
             return {
                type: 'suiteql',
                query: suiteQL
            };
        }

        function reduce(context) {
            log.debug("reduce context",context.key);
            
            for (var v in context.values) {
                var parsedValue = JSON.parse(context.values[v]);

                log.debug("sales order id",parsedValue.values[5]);
                var soId = parsedValue.values[5];
                var total = parsedValue.values[12];
                log.debug("total",total);

                if (parseInt(total,10) == 0) {
                    // close existing sales order, this allows us to apply the deposit
                    var objRecord = record.load({
                        type: record.Type.SALES_ORDER,
                        id: soId,
                        isDynamic: false
                    });
                    //     log.debug("status",objRecord.getValue({ fieldId: 'orderstatus'}));

                    var itemLines = objRecord.getLineCount({ sublistId: 'item' });
                    log.debug("item count", itemLines);
                    for (i = 0; i < itemLines; i++) {
                        log.debug("set value");
                        objRecord.setSublistValue({ sublistId: 'item', fieldId: 'isclosed', line: i, value: true });                            
                    }
                    
                    try {
                        objRecord.save();                        

                        // mark that this invoice was processed
                        context.write(soId,{
                            "result": "Closed", 
                            "salesOrderId": soId
                        });
                    }
                    catch (e) {
                        context.write(soId,{
                            "result": e.message, 
                            "salesOrderId": soId
                        });
                    }
                } else {
                    context.write(soId,{
                        "result": "This is not a full refund - this will have to be processed manually", 
                        "salesOrderId": soId
                    });
                }
            }
        }

        function summarize(context) {

            //Log any error data encountered during the execution
            logStageErrors(context);

            // get the person to send the summary email to
            var summaryEmail = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_author'});
            log.debug("summary email",summaryEmail);
            var emailRecipients = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_recipients2'});
            log.debug("recipients",emailRecipients);
            var emailRecipientsArray = emailRecipients.split(";").map(function(item) {
                return item.trim();
            });  
            log.debug("recipient array",emailRecipientsArray);

        
            // // process anything found in the context
            var list = '';
            var errorList = '';
            context.output.iterator().each(function (key, value)
            {
                var values = JSON.parse(value);
                //log.debug("Summarize values:",values);
                log.debug("Summarize result:",values.result);
                
                var link = url.resolveRecord({
                    recordType: 'salesorder',
                    recordId: key,
                    isEditMode: false
                });

                if (values.result === "Closed") {
                    list += 'Sales Order: <a href='+link+'>'+key+'</a> : Closed <br>'
                } else {
                    errorList += 'Sales Order: <a href='+link+'>'+key+'</a> : ' + values.result + '<br>'
                }
                
                return true;
            });

            // // add anything in the reduce error context
            var reduceList = '';
            context.reduceSummary.errors.iterator().each(function (key, value)
            {
                reduceList += value + '<br>'
                return true;
            });
            
            var bodyText = 'Sales Orders closed due to customer refunds:<br>' + list
                        + '<br>Sales Orders that had errors while trying to close:<br>' + errorList
                        + '<br>The following exceptions were encountered during the processing:<br>' + reduceList;
          
            email.send({
                author: summaryEmail,
                recipients: summaryEmail,
                cc: emailRecipientsArray,
                subject: 'Sales Orders Closed due to Customer Refunds summary',
                body: bodyText
            });
        }

        function logStageErrors(summary) {
            if (summary.inputSummary.error) {
                log.error('Input Stage Error', summary.inputSummary.error);
            }
            summary.mapSummary.errors.iterator().each(function(key, error) {
                log.error('Map Stage Error', 'Key: ' + key + ' Error: ' + error);
                return true;
            });
            summary.reduceSummary.errors.iterator().each(function(key, error) {
                log.error('Reduce Stage Error', 'Key: ' + key + ' Error: ' + error);
                return true;
            });
        }

        return {
            getInputData: getInputData,
            reduce: reduce,
            summarize: summarize
        };
    });