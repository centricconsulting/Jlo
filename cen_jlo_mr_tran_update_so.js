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

            log.audit('<<< START >>>', 'Start of script execution');
            //var arAcct = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_aracct'});
            //log.debug("ar acct",arAcct);

            var suiteQL = `
                select  distinct t.id tranid, t.recordtype, t.trandate, t.postingperiod
                from transaction t
                where 
                    --t.id = 2002463 and 
                    t.recordtype = 'salesorder'
                    and trandate => to_date('1/1/2024','MM/DD/YYYY')
                    and postingperiod > 90
                    and t.id <= 2130928
                    --and t.id >= 761425
                    and t.id >= 972771
                order by tranid asc
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