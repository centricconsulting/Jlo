/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
/= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * Purpose:  A script to automate invoice for installment items.
 * VER  DATE           AUTHOR               		CHANGES
 * 1.0  Dec 04, 2023   Centric Consulting(Aman)   	Initial Version
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */

define(['N/search', 'N/record', 'N/runtime', 'N/url', 'N/email', 'N/query'],
    function (search, record, runtime, url, email, query) {
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
                    t.custbody_cen_jlo_instal_ord,
                    t.custbody_cen_jlo_digital_pmt_ord,
                    t.trandate
                from transaction t
                where 
                    --t.id >= 47724 and 
                    --t.id = 796985 and
                    --t.id <= 1054695 and
                    t.id >= 51868 and
                    (t.custbody_cen_jlo_instal_ord = 'T' or
                    t.custbody_cen_jlo_digital_pmt_ord = 'T')
                    and t.recordtype = 'salesorder'
                    and t.status = 'F' -- pending billing only
            `; 
            
             return {
                type: 'suiteql',
                query: suiteQL
            };
        }

        // even though we don't need this - we could just let reduce do all the work - if there
        // is an error during the reduce phase, we will now get the id of the customer where
        // the create grouped invoice was attempted. This is valuable for troubleshooting.
        function map(context) {
            //log.debug("map entered");
            var result = JSON.parse(context.value);
            log.debug("map:sales order",result.values[0]); 

            // check for a customer refund on the originating Sales order, if so, skip for now

            context.write({
                key: result.values[0], // sales order id
                value: { 
                    salesOrderId : result.values[0],
                    custbody_cen_jlo_instal_ord : result.values[4],
                    custbody_cen_jlo_digital_pmt_ord : result.values[5],
                    trandate : result.values[6],
                }
            });
        }

        function reduce(context) {

            log.debug("reduce context",context.key);
            var varianceItem = runtime.getCurrentScript().getParameter({ name: 'custscript_jlo_variance_item2' });
            var paymentItem = runtime.getCurrentScript().getParameter({ name: 'custscript_jlo_payment_item2' });
            var arAccount = runtime.getCurrentScript().getParameter({ name: 'custscript_jlo_ar_acct2' });
            var terms = runtime.getCurrentScript().getParameter({ name: 'custscript_jlo_terms2' });
            //log.debug("varianceItem",varianceItem);

            for (var v in context.values) {
                var jsonobj = JSON.parse(context.values[v]);
                log.debug("Json : ", jsonobj);

                var isInstallment = jsonobj.custbody_cen_jlo_instal_ord;
                var isDigitalPayment = jsonobj.custbody_cen_jlo_digital_pmt_ord;
                var tranDate = jsonobj.trandate;
                log.debug("install or digital",isInstallment + ":" + isDigitalPayment);


                var invoiceId = null;
                var lineStatus = null;
                try {

                    // check for a customer refund. If one exists related to the customer deposit on the 
                    // sales order, skip processing this item
                    if (customerRefundsExist(context.key)) {
                        log.debug("customer refunds exist");
                        context.write({
                            key: context.key,
                            value:  {   
                                status : "Customer Refund Exists",
                                lineStatus : null,
                                invoiceId : null       
                            }
                        });
                    } else {
                        // load the sales order and then close the variance line and any digital installment payments
                        var orderStatus = processOrder(context.key, varianceItem, paymentItem, isDigitalPayment, isInstallment);

                        if (orderStatus != "Closed") {
                            // if the sales order was not closed, create the invoice from the sales order, automatically apply the customer payment
                            invoiceId = processInvoice(context.key, tranDate, varianceItem, arAccount, terms); 
                            log.debug("invoice id",invoiceId);
                        }
                            
                        // if this is a digital installment payment, then find all the digital installment lines
                        // and apply payments to the original orders
                        if (isDigitalPayment === 'T') {
                            log.debug("digital Installment payment");
                            lineStatus = processDigitalPayments(context.key, paymentItem, arAccount);
                        }

                        context.write({
                            key: context.key,
                            value:  {   
                                status : "Success",
                                lineStatus : lineStatus,
                                invoiceId : invoiceId       
                            }
                        });
                    }

                } catch (exception) {
                    log.error("Reduce Exception",context.key + ":" + exception.message);
                    context.write({
                        key: context.key,
                        value:  {   
                            status : exception.message,
                            lineStatus : null,
                            invoiceId : invoiceId       
                        }
                    });
                }



            }
        }

        function processOrder(salesOrderId, varianceItem, paymentItem, isDigitalPayment, isInstallment) {
            
            var salesRec = record.load({
                type: record.Type.SALES_ORDER,
                id: salesOrderId,
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
                if ((isInstallment === 'T' && item == varianceItem) || item == paymentItem) {
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

            // reload to check if SO was closed
            var salesRec = record.load({
                type: record.Type.SALES_ORDER,
                id: salesOrderId,
                isDynamic: false
            });
            log.debug("sales rec",salesRec.getText({ fieldId: "status" }));
            return salesRec.getText({ fieldId: "status" });
        }

        function processInvoice(salesOrderId, soTranDate, varianceItem, arAccount, terms) {

            // now create the invoice
            var invoiceOne = record.transform({
                fromType:'salesorder',
                fromId: salesOrderId,
                toType: 'invoice'
            });

            // set the tran date
            var tranDate = getIFTranDate(salesOrderId);
            if (tranDate) {
                log.debug("if date",tranDate + ":" + typeof tranDate);
                invoiceOne.setValue({fieldId: 'trandate', value: new Date(tranDate), ignoreFieldChange: false});
            } else {
                log.debug("so date",soTranDate + ":" + typeof soTranDate);
                invoiceOne.setValue({fieldId: 'trandate', value: new Date(soTranDate), ignoreFieldChange: false});
            }

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

                // handled in the sales order - we close the line when needed
                // log.debug("item",item);
                // if (item == varianceItem) {
                //     log.debug("remove item");
                //     invoiceOne.removeLine({
                //         sublistId: 'item',
                //         line: i,
                //         ignoreRecalc: true
                //     });
                // }
            }

            var invoiceId = invoiceOne.save({
                enableSourcing: true,
                ignoreMandatoryFields: true
            });

            return invoiceId;
        }

        //check for errors
        // i)	When the invoice does not exists, provide the Digital Installment Sales Order, the eTail Order Id, and 
        //      a message “Target Subscription Invoice does not exist”. No further processing of the deposit is possible.
        // ii)	When the invoice exists but is not open, provide the Digital Installment Sales Order, the eTail Order Id, 
        //      the target Subscription Invoice, and a message “Target Subscription Invoice is not Open”. Do not process 
        //      the payment. No further processing of the deposit is possible.
        // iii)	When the invoice exists and is open, but does not have enough left to apply payment, apply the payment 
        //      and then provide the Digital Installment Sales Order, the eTail Order Id, the target Subscription Invoice, 
        //      and a message “Deposit has funds remaining”
        function processDigitalPayments(salesOrderId, paymentItem, arAccount) {
            log.debug("processDigitalPayments");
            var errorMessages = [];
            var suiteQL = `
                select t.id so_id, 
                    t.tranid,
                    tl.linesequencenumber, 
                    tl.custcolcustcol_shpfy_orgnl_order, 
                    tl.item, 
                    i.fullname, 
                    tl.foreignamount, 
                    t.status ord_status, 
                    dep.id dep_id, 
                    dep.foreigntotal, 
                    dep.status dep_status,
                    inv.id,
                    inv.type,
                    inv.foreignamountunpaid,
                    dep.foreignpaymentamountunused,
                    case when inv.foreignamountunpaid >= dep.foreignpaymentamountunused then 'true' else 'false' end covered,
                    -1 * tl.foreignamount paymentamount,
                    inv.status invoicestatus,
                    tl.custcol_celigo_etail_order_line_id
                from transaction t, 
                    transactionline tl, 
                    item i, 
                    PreviousTransactionLineLink ptll, 
                    transaction dep,
                    transaction inv
                where t.type = 'SalesOrd'
                    and t.id = tl.transaction
                    and tl.item = i.id
                    and i.id = ?
                    and ptll.previousdoc = t.id
                    and linktype = 'OrdDep'
                    and ptll.nextdoc = dep.id
                    and t.id = ?
                    and tl.custcolcustcol_shpfy_orgnl_order = inv.custbody_celigo_etail_order_id (+)
                    and inv.type (+) = 'CustInvc'
                order by t.id desc
            `; 

            var soLinesList = query.runSuiteQL({
                query: suiteQL,
                params: [paymentItem,  
                         salesOrderId]
            });
            log.debug('results',soLinesList);

            if (soLinesList.results.length > 0) {

                // process the results 
                for (var i = 0; i < soLinesList.results.length; i++ ) {
                    log.debug("digital payment line",i + ":" + soLinesList.results[i].values);

                    // check for matching invoice
                    if (soLinesList.results[i].values[11] === null) {
                        log.error("Target Subscription Invoice does not exist","SO: " + soLinesList.results[i].values[0] 
                            + " SO Line: " + soLinesList.results[i].values[2] 
                            + " Shopify Original Order:" + soLinesList.results[i].values[3]
                            + " Item: " + soLinesList.results[i].values[4]);
                        errorMessages.push({
                            lineSequenceNumber : soLinesList.results[i].values[2],
                            etailOrderId : soLinesList.results[i].values[3],
                            amount : soLinesList.results[i].values[16],
                            message : "Target Subscription Invoice does not exist",
                            invoiceId : null,
                            invoiceStatus : null
                        });

                    // check target invoice still open
                    } else if (soLinesList.results[i].values[17] != "A") {
                        log.error("Target Subscription Invoice is not Open","SO: " + soLinesList.results[i].values[0] 
                            + " SO Line: " + soLinesList.results[i].values[2] 
                            + " Shopify Original Order:" + soLinesList.results[i].values[3]
                            + " Item: " + soLinesList.results[i].values[4]
                            + " Target Invoice: " + soLinesList.results[i].values[11]
                            + " Invoice Status: " + soLinesList.results[i].values[17]);
                        errorMessages.push({
                            lineSequenceNumber : soLinesList.results[i].values[2],
                            etailOrderId : soLinesList.results[i].values[3],
                            amount : soLinesList.results[i].values[16],
                            message : "Target Subscription Invoice is not Open",
                            invoiceId : soLinesList.results[i].values[11],
                            invoiceStatus : soLinesList.results[i].values[17]
                        });

                    // process the payment                    
                    } else {

                        // get payment amount via saved search so we can get tax - Ron - Check Tax
                        var paymentAmountWithTax = getPaymentAmountWithTax(soLinesList.results[i].values[0],soLinesList.results[i].values[18]);
                        log.debug("payment with tax",paymentAmountWithTax);

                        // if the amount to be paid is more than the amount remaining on the invoice, only the remaining amount will be applied
                        // if the amount to be paid is more than the amount remaining on the deposit, only the amount remaining on the deposit will be applied
                        var createRecord = record.transform({
                            fromType: record.Type.CUSTOMER_DEPOSIT,
                            fromId: soLinesList.results[i].values[8],
                            toType: record.Type.DEPOSIT_APPLICATION,
                            isDynamic: true,
                            defaultValues: {
                                aracct: arAccount
                            } 
                        });

                        var numLines = createRecord.getLineCount({ sublistId: 'apply' });
                        var applyToInvId = soLinesList.results[i].values[11];
                        //var paymentAmount = soLinesList.results[i].values[16];

                        log.debug("numLines : ", numLines);
                        for (cnt = 0; cnt < numLines; cnt++) {
                            // look for invoice
                            var openInvoice = createRecord.getSublistValue({ sublistId: 'apply', fieldId: 'internalid', line: cnt });
                            if (openInvoice == applyToInvId) {
                                log.debug("apply",openInvoice + ":" + paymentAmountWithTax);
                                // Applying customer deposit to invoice
                                createRecord.selectLine({ sublistId: "apply", line: cnt });
                                createRecord.setCurrentSublistValue({ sublistId: 'apply', fieldId: 'apply', value: true });
                                createRecord.setCurrentSublistValue({ sublistId: 'apply', fieldId: 'amount', value: paymentAmountWithTax });
                            }
                        }

                        // Save the deposit record with applied payments
                        createRecord.save();
                    }
                }      

                // once all done, update the deposit if any errors. Also, if done, and there is an amount remaining, mark that as well.
                var depRecord = record.load({
                    type: record.Type.CUSTOMER_DEPOSIT,
                    id: soLinesList.results[0].values[8],
                    isDynamic: false
                });

                var depStatus = depRecord.getText({ fieldId: 'status'});
                log.debug("deposit status",depStatus);

                if (depStatus != "Fully Applied") {
                    log.error("Deposit was not fully applied","SO: " + salesOrderId 
                    + " Item: " + paymentItem);
                    errorMessages.push({
                        lineSequenceNumber : null,
                        etailOrderId : null,
                        amount : null,
                        message : "Deposit was not fully applied",
                        invoiceId : null,
                        invoiceStatus : null
                    });
                } else {
                    // do nothing, nothing to report error wise
                }

                // update deposit with any error messages
                log.debug("error messages",errorMessages);
                depRecord.setText({
                    fieldId: 'custbody_jlo_deposit_app_errors',
                    text: JSON.stringify(errorMessages),
                    ignoreFieldChange: true
                });
                depRecord.save();
            
            // if not results were found, then there was no deposit, just print a message
            } else {
                log.error("No Deposit found to apply","SO: " + salesOrderId 
                    + " Item: " + paymentItem);
                errorMessages.push({
                    lineSequenceNumber : null,
                    etailOrderId : null,
                    amount : null,
                    message : "No Deposit found to apply",
                    invoiceId : null,
                    invoiceStatus : null
                });
            }

            return errorMessages;
        }




        function customerRefundsExist(soId) {
            // var suiteQL = `
            //     select so.previousdoc salesorderid, 
            //         so.linktype, 
            //         so.nexttype, 
            //         dep.id customerdepositid, 
            //         dep.trandisplayname, 
            //         da.transaction depositapplictionid, 
            //         cr.previousdoc customerrefundid
            //         --, da.*
            //     from nexttransactionlinelink so,
            //         transaction dep,
            //         transactionline da,
            //         nexttransactionlinelink cr
            //     where so.previousdoc = ?
            //         and so.nexttype = 'CustDep'
            //         and so.nextdoc = dep.id
            //         and da.createdfrom = dep.id
            //         and cr.nextdoc = da.transaction
            // `;

            //     where so.previousdoc = 1196552
            var suiteQL = `
                select so.previousdoc salesorderid, 
                    so.linktype, 
                    so.nexttype, 
                    dep.id customerdepositid, 
                    dep.trandisplayname, 
                    dal.createdfrom,
                    dal.transaction depositapplictionid, 
                    cr.previousdoc customerrefundid
                from nexttransactionlinelink so,
                    transaction dep,
                    transactionline dal,
                    transaction da,
                    nexttransactionlinelink cr
                where so.previousdoc = ?
                    and so.nexttype = 'CustDep'
                    and so.nextdoc = dep.id
                    and dal.createdfrom = dep.id
                    and dal.transaction = cr.nextdoc 
                    and da.id = dal.transaction
                    and da.recordtype = 'depositapplication'
                    and cr.previoustype = 'CustRfnd'
            `;
    
            var results = query.runSuiteQL({
                query: suiteQL,
                params: [soId]
            });
    
            log.debug('results',results.results.length);
            if (results.results.length === 0) {
                log.debug("check missed invoices","zero");
                return false;
            } else {
                log.debug("check missed invoices","not zero");
                log.debug('value',results.results[0].values[0]);
                return true;
            }
    
        }

        
        function getIFTranDate(soId) {
            var suiteQL = `
                select 
                    sot.trandate SO_Date,
                    sot.type SO_Type,
                    ift.id,
                    ift.trandate IF_Date,
                    ift.type IF_Type
                from 
                    PreviousTransactionLineLink ptll
                    ,transaction sot
                    , transaction ift
                where 
                    sot.id = ptll.previousdoc
                    and sot.id = ?
                    and ptll.nexttype = 'ItemShip'
                    and ptll.nextdoc = ift.id
            `;
    
            var results = query.runSuiteQL({
                query: suiteQL,
                params: [soId]
            });
    
            log.debug('results',results.results.length);
            if (results.results.length === 0) {
                log.debug("no IF found",soId);
                return null;
            } else {
                log.debug('if found',results.results[0].values[3]);
                return results.results[0].values[3];
            }
    
        }

        function getPaymentAmountWithTax(orderId,etailLineId) {
            var transactionSearchObj = search.create({
                type: "transaction",
                filters:
                [
                ["internalid","anyof",orderId], 
                "AND", 
                ["custcol_celigo_etail_order_line_id","startswith",etailLineId]
                ],
                columns:
                [
                search.createColumn({name: "internalid", label: "Internal ID"}),
                search.createColumn({name: "type", label: "Type"}),
                search.createColumn({name: "tranid", label: "Document Number"}),
                search.createColumn({name: "entity", label: "Name"}),
                search.createColumn({name: "amount", label: "Amount"}),
                search.createColumn({name: "taxamount", label: "Amount (Tax)"}),
                search.createColumn({name: "item", label: "Item"}),
                search.createColumn({name: "custcol_celigo_etail_order_line_id", label: "eTail Order Line Id"}),
                search.createColumn({
                    name: "formulacurrency",
                    formula: "{amount}+{taxamount}",
                    label: "Total"
                })
                ]
            });

            var totalAmount = null;
            var searchResultCount = transactionSearchObj.runPaged().count;
            log.debug("transactionSearchObj result count",searchResultCount);
            transactionSearchObj.run().each(function(result){
                // .run().each has a limit of 4,000 results
                log.debug("result",result);
                totalAmount = result.getValue({ name: "formulacurrency" });
                return true;
            });
            log.debug("getPaymentAmountWithTax",totalAmount);
            return totalAmount;
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

            context.reduceSummary.errors.iterator().each(
                function (key, error, executionNo) {
                    log.error({
                        title: 'Reduce error for key: ' + key + ', execution no.  ' + executionNo,
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
            var refundList = '';


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

                var soLink = url.resolveRecord({
                    recordType: 'salesorder',
                    recordId: key,
                    isEditMode: false
                });

                // no problems applying digital payments
                if (data.status === "Success" && 
                    (data.lineStatus === null || data.lineStatus.length === 0)) {
                    var invLink = url.resolveRecord({
                        recordType: 'invoice',
                        recordId: data.invoiceId,
                        isEditMode: false
                    });

                    recordsList += '<a href='+invLink+'>' 
                    + data.invoiceId
                    + '</a>'
                    + ' created from <a href=' + soLink + '> '+ key + '</a><br>';

                // problems applying the installment payments
                } else if (data.status === "Success") {
                    for (i=0; i < data.lineStatus.length; i++) {
                        errorList += '<a href='+soLink+'>' 
                        + key
                        + '</a> encountered the following errors: ' 
                        + JSON.stringify(data.lineStatus[i]) 
                        + '<BR>';
                    }

                // skipping due to a customer refund
                } else if (data.status === "Customer Refund Exists") {
                    refundList += '<a href='+soLink+'>' 
                    + key
                    + '</a>'
                    + ' was skipped due to a customer refund<br>'               
                
                // other
                } else {
                    exceptionList += '<a href='+soLink+'>' 
                    + key
                    + '</a>'
                    + ' was skipped due to an exception: ' 
                    + data.status 
                    + '<br>'
                }
                
                return true;
            });

            // get these as parameters
            var authorEmail = runtime.getCurrentScript().getParameter('custscript_jlo_sub_inv_author2');
            var recipientEmail = runtime.getCurrentScript().getParameter('custscript_jlo_sub_inv_receive2');

            log.debug('params', 'authorEmail = '+authorEmail+',  recipientEmail = '+recipientEmail)

            var bodyText =  'Subscription Invoice process has completed.<br><br><b>List of Invoice records created:</b><br>' + recordsList + '';
            if (refundList) {
                bodyText += '<br /><br /><b>These sales orders have a refund attached and were not processed:</b><br />' + refundList + '';
            }
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
            reduce: reduce,
            summarize: summarize
        };
    });