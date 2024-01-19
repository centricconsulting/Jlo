/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
/= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * Purpose: To apply customer deposit in invoice based on customer deposit balance.
 * VER  DATE           AUTHOR               		CHANGES
 * 1.0  Sep 19, 2023   Centric Consulting(Pradeep)   	Initial Version
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */

define(['N/search', 'N/record', 'N/runtime', 'N/email', 'N/url', 'N/query'],
    function (search, record, runtime, email, url, query) {
        function getInputData() {
            // var customerdepositSearchObj = search.create({
            //     type: "customerdeposit",
            //     filters:
            //         [
            //             ["type", "anyof", "CustDep"],
            //             "AND", ["status", "anyof", "CustDep:A"],
            //             "AND", ["mainline", "is", "T"],
            //             "AND", [["createdfrom.custbody_celigo_etail_order_id", "isnotempty", ""], "OR", ["createdfrom.custbody_shopify_order_id", "isnotempty", ""]]
            //             , "AND", ["internalid", "anyof", "38139","38141","38355"] // for testing
            //         ],
            //     columns:
            //         [
            //             "internalid", "amount",
            //             search.createColumn({ name: "custbody_celigo_etail_order_id", join: "createdFrom" }),
            //             search.createColumn({ name: "custbody_shopify_order_id", join: "createdFrom" })
            //         ]
            // });
            // return customerdepositSearchObj;

            log.audit('<<< START >>>', 'Start of script execution');
            var arAcct = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_aracct'});
            log.debug("ar acct",arAcct);

            //Search custom record vendor bill line where billable = Y and a client is assigned
    
            // it would be nice to eliminate any duplicates by making this distinct
            // Sales Order status:  A = Pending Approval, B = Pending Fulfillment,  F = Pending Billing
            // Deposit Status: A = Not Deposited, B = Deposited
            var suiteQL = `
            select t.id so_id, 
                tl.linesequencenumber, 
                tl.custcolcustcol_shpfy_orgnl_order, 
                tl.item, 
                i.fullname, 
                tl.foreignamount, 
                t.status ord_status, 
                dep.id dep_id, 
                dep.foreigntotal, 
                dep.status dep_status
            from transaction t, 
                transactionline tl, 
                item i, 
                PreviousTransactionLineLink ptll, 
                transaction dep
            where t.type = 'SalesOrd'
                and t.id = tl.transaction
                and t.status in ('A','B', 'F')
                and tl.custcolcustcol_shpfy_orgnl_order is not null
                and tl.item = i.id
                and i.fullname = 'INS001'
                and ptll.previousdoc = t.id
                and linktype = 'OrdDep'
                and ptll.nextdoc = dep.id
                and dep.status in ('A','B')  
            order by t.id desc
            `; 
            
             return {
                type: 'suiteql',
                query: suiteQL
            };
        }

        function map(context) {
            //log.debug("map entered");
            var result = JSON.parse(context.value);

            var installmentItem = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_install_item'});
            var shipmentItem = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_ship_item'});
            log.debug("installment item",installmentItem);
            log.debug("sales order id",result.values[0]);

            var suiteQL = `
                select transaction, 
                    item, 
                    linesequencenumber 
                from transactionline tl
                where tl.transaction = ?
                    and item != ?  -- INS001
                    and mainline = 'F'
                    and taxline = 'F'
                    and itemtype != 'Discount'
                    --and item != ? -- Shopify Shipping Cost 7770
            `; 

            var soLinesList = query.runSuiteQL({
                query: suiteQL,
                params: [result.values[0],  // Sales Order Header Id
                         installmentItem]
            });
            //, shipmentItem]


            log.debug('results',soLinesList);

            // if there are lines for items other than an installment payment or tax lines, throw an error and 
            // do not process the sales order.
            if (soLinesList.results.length > 0) {
                log.debug("map:error",result.values[0]);
                throw new Error("Sales Order " + result.values[0] 
                    + " has line items other than digital instsallment payments");

            // otherwise, write the sales order to the context to be processed
            } else {
                log.debug("map:context",result.values[0]); 
                context.write({
                    key: result.values[0], // sales order internal id
                    value: { deposit_id: result.values[7], // deposit internal id
                             shopify_order_id: result.values[2], // shopify original order id
                             deposit_balance: result.values[8] // deposit amount
                    }
                });                                    
            }

        }

        function reduce(context) {
            log.debug("reduce entered");
            log.debug("context",context.key);

            var arAcct = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_aracct'});
            log.debug("ar acct",arAcct);

            //log.debug("VALUE",context.values);

            for (var v in context.values) {
                var parsedValue = JSON.parse(context.values[v]);
                log.debug("parsed",parsedValue);

                // find invoice to apply payment to
                var applyToInvId = findInvoice(parsedValue.shopify_order_id);
                log.debug("apply to", applyToInvId);

                // if we find an invoice to apply to, then do the following 
                if (applyToInvId) {

                    log.debug("close");

                    // close existing sales order, this allows us to apply the deposit
                    var objRecord = record.load({
                        type: record.Type.SALES_ORDER,
                        id: context.key,
                        isDynamic: false
                    });
                    log.debug("status",objRecord.getValue({ fieldId: 'orderstatus'}));

                    var itemLines = objRecord.getLineCount({ sublistId: 'item' });
                    log.debug("item count", itemLines);
                    for (i = 0; i < itemLines; i++) {
                        log.debug("set value");
                        // objRecord.selectLine({ sublistId: "item", line: i });
                        // objRecord.setCurrentSublistValue({ sublistId: 'item', fieldId: 'isclosed', value: true });
                        //objRecord.selectLine({ sublistId: "item", line: i });
                        objRecord.setSublistValue({ sublistId: 'item', fieldId: 'isclosed', line: i, value: true });                            
                    }

                    objRecord.save();                        
                                        
                    log.debug("close",objRecord.id);

                    // apply deposit to the new invoice
                    var createRecord = record.transform({
                        fromType: record.Type.CUSTOMER_DEPOSIT,
                        fromId: parsedValue.deposit_id,
                        toType: record.Type.DEPOSIT_APPLICATION,
                        isDynamic: true,
                        defaultValues: {
                            aracct: arAcct
                        } 
                    });

                    var numLines = createRecord.getLineCount({ sublistId: 'apply' });
                    log.debug("numLines : ", numLines);
                    for (i = 0; i < numLines; i++) {
                        // look for invoice
                        var openInvoice = createRecord.getSublistValue({ sublistId: 'apply', fieldId: 'internalid', line: i });
                        if (openInvoice == applyToInvId) {
                            log.debug("apply",openInvoice);
                            // Applying customer deposit to invoice
                            createRecord.selectLine({ sublistId: "apply", line: i });
                            createRecord.setCurrentSublistValue({ sublistId: 'apply', fieldId: 'apply', value: true });
                            createRecord.setCurrentSublistValue({ sublistId: 'apply', fieldId: 'amount', value: parsedValue.deposit_balance });
                        }
                    }

                    // Save the deposit record with applied payments
                    createRecord.save();
                } else {
                    // mark that there were no invoices to apply this payment to
                    context.write(context.key,{"result": "No Invoice to Match Against", 
                         "shopifyOrderId": parsedValue.shopify_order_id});
                    log.debug("no invoice found",context.key);
                }
            }
        }

        function summarize(context) {

            // dump any errors from the map or summary stages to the logs
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

            // get the person to send the summary email to
            var summaryEmail = runtime.getCurrentScript().getParameter({name: 'custscript_jlo_result_email'})
            log.debug("summary email",summaryEmail);
        
            // process anything found in the context
            var list = '';
            context.output.iterator().each(function (key, value)
            {
                var values = JSON.parse(value);
                log.debug("Summarize values:",values);
                log.debug("Summarize result:",values.result);
                
                var link = url.resolveRecord({
                    recordType: 'salesorder',
                    recordId: key,
                    isEditMode: false
                });
                list += '<a href='+link+'>'+key+'</a> : ' + values.shopifyOrderId + '<br>'
                return true;
            });

            // add anything in the reduce error context
            var reduceList = '';
            context.reduceSummary.errors.iterator().each(function (key, value)
            {
                var values = JSON.parse(value);
                
                var link = url.resolveRecord({
                    recordType: 'salesorder',
                    recordId: key,
                    isEditMode: false
                });
                log.debug("values",values);
                reduceList += '<a href='+link+'>'+key+'</a>: '+ values.message + '<br>'
                return true;
            });

            var mapList = '';
            context.mapSummary.errors.iterator().each(function (key, value)
            {
                var values = JSON.parse(value);
                
                var link = url.resolveRecord({
                    recordType: 'salesorder',
                    recordId: key,
                    isEditMode: false
                });
                log.debug("values",values);
                mapList += '<a href='+link+'>'+key+'</a>: '+ values.message + '<br>'
                return true;
            });
            
            var bodyText = 'Installment payments with no matching invoices:<br>' + list
                        + '<br>Sales Orders that had errors:<br>' + reduceList
                        + '<br>' + mapList;
          
            email.send({
                author: summaryEmail,
                recipients: summaryEmail,
                subject: 'Installment Payment Application Errors',
                body: bodyText
            });
        }

        function findInvoice(eTailOrderId) {
            var invoiceSearchObj;
            invoiceSearchObj = search.create({
                type: "invoice",
                filters:
                    [
                        ["type", "anyof", "CustInvc"],
                        "AND", ["mainline", "is", "T"],
                        "AND", [["custbody_celigo_etail_order_id", "is", eTailOrderId], "OR", ["custbody_shopify_order_id", "is", eTailOrderId]],
                        "AND", ["status", "anyof", "CustInvc:A"]
                    ],
                columns:
                    [
                        "internalid", "tranid", "amountremaining"
                    ]
            });
            var searchResultCount = invoiceSearchObj.runPaged().count;
            log.debug("invoiceSearchObj result count", searchResultCount);
            var invTran;
            if (searchResultCount > 0) {
                invoiceSearchObj.run().each(function (result) {
                    invTran = result.getValue({ name: "internalid" });
                    return true;
                });
            }
            return invTran;
        }

        return {
            getInputData: getInputData,
            map: map,
            reduce: reduce,
            summarize: summarize
        };
    });