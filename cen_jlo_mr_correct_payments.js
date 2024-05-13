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
            select id, 
                custrecord_install_line_id,         -- SO eTail line id where the incorrect payment was made
                custrecord_correct_parent_order_id, -- this should have been the correct order to apply payment against
                custrecord_install_order_id,        -- etail order id of the installment payment sales order
                custrecord_incorrect_invoice,       -- NS internal id of the invoice the payment was incorrectly applied to
                custrecord_correct_invoice,         -- NS internal id of the invoice the payment should have been applied to
                custrecord_install_so               -- NS Internal Id of the installment payment SO
            from customrecord_jlo_correct
            where (custrecord_install_rec_processed = 'F' or custrecord_install_rec_processed is null) 
                and id in (1, 37, 99, 281)
            order by id
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
            log.debug("map:sales order",result.values[1]); 

            // grouped by custrecord_install_so so that we process an installment payment sales order exactly once
            if (result.values[6]) {
                context.write({
                    key: result.values[6], // installment payment sales order id
                    value: { 
                        custrecord_install_line_id : result.values[1],         // SO eTail line id where the incorrect payment was made
                        custrecord_correct_parent_order_id : result.values[2], // this should have been the correct order to apply payment against
                        custrecord_install_order_id : result.values[3],        // etail order id of the installment payment sales order
                        custrecord_incorrect_invoice: result.values[4],        // NS internal id of the invoice the payment was incorrectly applied to
                        custrecord_correct_invoice : result.values[5],          // NS internal id of the invoice the payment should have been applied to
                        id : result.values[0]                                   // internal id of the custom record
                    }
                });
            } else {
                throw new Error ("No installment payment sales order found for installment line:" + result.values[1]);
            }

        }

        function reduce(context) {

            //log.debug("reduce context",context.key);
            var errors = '';
            var skipProcessing = false;

            // get the installment payment sales order - custrecord_install_so
            var installmentSO = context.key;  // custrecord_install_so
            var installmentInv = getInstallmentInv(installmentSO);

            // get the  deposit associated with the SO
            var installmentDeposit = getInstallmentDeposit(installmentSO);

            log.audit("reduce: SO: INV: DEP:", installmentSO + ":" + installmentInv + ":" + installmentDeposit);

            // if a credit was applied to a digital installment payment, log an error and do not process 
            // the payment.
            if (customerRefundsExist(installmentSO)) {
                errors += 'Customer Refund Exists for Sales Order\n';
                skipProcessing = true;
            } else {
                // we do have some transactions without deposits
                if (installmentDeposit) {
                    // remove any deposit applications for that deposit
                    removeDepositApplications(installmentDeposit);
                } else {
                    errors += 'No customer deposit found\n';
                    skipProcessing = true;
                }

                // we do have some transactions without invoices. this may not be a problem if we have just 
                // one line - a digital payment line - on the sales order.
                if (installmentInv) {
                    // remove invoice tied to the sales order
                    record.delete({
                        type: record.Type.INVOICE,
                        id: installmentInv
                    });
                } 
            }



            // loop through the context
                // were eTail line ids match, replace existing Shopify Original Order Id with correct one
            // unclose any lines on the SO that are installment payments
            if (!skipProcessing) {
            
                var installmentSORec = record.load({
                    type: record.Type.SALES_ORDER,
                    id: installmentSO,
                    isDynamic: false
                });
                for (var v in context.values) {
                    var jsonobj = JSON.parse(context.values[v]);
                    log.debug("Json : ", jsonobj);

                    // loop through the item lines
                    var lineSOCount = installmentSORec.getLineCount({ sublistId: 'item' });
                    var match = false;
                    for (var i = 0; i < lineSOCount; i++) {
                        var etailLineId = installmentSORec.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'custcol_celigo_etail_order_line_id',
                            line: i
                        });

                        // if match, correct the etail order id 
                        if (etailLineId === jsonobj.custrecord_install_line_id) {
                            log.debug("match found for eTail Line Id", jsonobj.custrecord_install_line_id);
                            installmentSORec.setSublistValue({
                                sublistId: 'item',
                                fieldId: 'custcolcustcol_shpfy_orgnl_order',
                                line: i, 
                                value: jsonobj.custrecord_correct_parent_order_id
                            });
                            
                            match = true;
                        } 
                    }
                    if (!match) {
                        // should never happen - should be filtered out before we get here
                        log.error("No match found for eTail Line Id", jsonobj.custrecord_install_line_id);
                        errors += 'No match found for eTail Lilne Id: ' + jsonobj.custrecord_install_line_id + '\n'
                    } 
                }

                // unclose all digital payment lines
                // custcol_shpfy_subscrptn_flg = Y and Item = 7894 (Installment Payment)
                var lineSOCount = installmentSORec.getLineCount({ sublistId: 'item' });
                var match = false;
                for (var i = 0; i < lineSOCount; i++) {
                    var itemId = installmentSORec.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'item',
                        line: i
                    });

                    // if digital payment, unclose the line
                    if (itemId == 7894) {
                        log.debug("unclosing line", installmentSO + ":" + i);
                        installmentSORec.setSublistValue({
                            sublistId: 'item',
                            fieldId: 'isclosed',
                            line: i, 
                            value: false
                        });
                    } 
                }

                // save the SO
                try {
                    installmentSORec.save();
                } catch (e) {
                    errors += e.message;
                }
            }

            // update all records as processed. update any error messages as well.
            for (var v in context.values) {
                var jsonobj = JSON.parse(context.values[v]);
                var custRecord = record.load({
                    type: 'customrecord_jlo_correct',
                    id: jsonobj.id,
                    isDynamic: false
                });
                if (errors) {
                    custRecord.setValue({fieldId: 'custrecord_install_error', value: errors});
                } else {
                    custRecord.setValue({fieldId: 'custrecord_install_rec_processed', value: true});
                }
                               
                custRecord.save();
            }
        }

        function getInstallmentInv(soId) {
            var suiteQL = `
                SELECT nextdoc
                from previoustransactionlink
                where previousdoc = ?
                and linktype = 'OrdBill'
            `;
    
            var results = query.runSuiteQL({
                query: suiteQL,
                params: [soId]
            });
    
            //log.debug('results',results.results.length);
            if (results.results.length === 0) {
                log.error("no Invoice found",soId);
                return null;
            } else {
                log.debug('Invoice found',results.results[0].values[3]);
                return results.results[0].values[0];
            }
        }

        function getInstallmentDeposit(soId) {
            var suiteQL = `
                SELECT nextdoc, linktype
                from previoustransactionlink
                where previousdoc = ?
                and linktype = 'OrdDep'
            `;
    
            var results = query.runSuiteQL({
                query: suiteQL,
                params: [soId]
            });
    
            //log.debug('results',results.results.length);
            if (results.results.length === 0) {
                log.error("no Deposit found",soId);
                return null;
            } else {
                log.debug('Deposit found',results.results[0].values[0]);
                return results.results[0].values[0];
            }
        }

        function removeDepositApplications(deposit) {
            var suiteQL = `
                SELECT
                    Transaction.ID,
                    Transaction.TranDate,
                    Transaction.TranID,
                    Transaction.ForeignTotal AS PaymentAmount,
                    Transaction.ForeignPaymentAmountUsed AS AmountApplied
                FROM
                    Transaction
                    INNER JOIN TransactionLine ON
                        ( TransactionLine.Transaction = Transaction.ID )
                        AND ( TransactionLine.Mainline = 'T' )
                WHERE
                    ( Transaction.Type = 'DepAppl' )
                    AND ( TransactionLine.CreatedFrom = ?)
            `;

            var results = query.runSuiteQL({
                query: suiteQL,
                params: [deposit]
            });

            //log.debug('results',results.results.length);
            if (results.results.length === 0) {
                log.debug("no Deposit applications found",deposit);
                return true;
            } else {
                log.debug('Deposit Applications found');
                for (var i = 0; i < results.results.length; i++ ) {
                    log.debug("Deposit Application: ",results.results[i].values[0]);
                    record.delete ({
                        type: record.Type.DEPOSIT_APPLICATION,
                        id: results.results[i].values[0]
                    });
                }
                return true;
            }
        }

        function customerRefundsExist(soId) {
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
                and dal.mainline = 'T'
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
                log.debug("no customer refund");
                return false;
            } else {
                log.debug('customer refund found: SO, DEPOSIT, REFUND',results.results[0].values[0]
                    + ", " + results.results[0].values[3]
                    + ", " + results.results[0].values[7]
                );
                return true;
            }
    
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

            log.debug("summarize complete");
        }

        return {
            getInputData: getInputData,
            map: map,
            reduce: reduce,
            summarize: summarize
        };
    });