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
                select distinct t.id tranid, t.recordtype, t.trandate
                from transaction t, transactionline tl
                where 
                t.id > 41000 and 
                t.recordtype = 'itemfulfillment'
                and tl.transaction = t.id
                and tl.class is null
                and trandate => to_date('11/26/2023','MM/DD/YYYY')
                order by tranid desc
            `; 
            
             return {
                type: 'suiteql',
                query: suiteQL
            };
        }

        function map(context) {
            //log.debug("map entered");
            var result = JSON.parse(context.value);

            var tran = record.load({
                type: result.values[1],
                id: result.values[0],
                isDynamic: false
            });
            tran.save();
            log.debug('tran id',result.values[0]);
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

        }


        return {
            getInputData: getInputData,
            map: map,
            summarize: summarize
        };
    });