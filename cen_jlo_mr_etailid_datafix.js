/**
 * @NApiVersion 2.x
 * @NScriptType MapReduceScript
 */
define(['N/search', 'N/record', 'N/runtime', 'N/format', 'N/error'], function(search, record, runtime, format, error) {
    
    function getInputData() {
        try {
            const scriptObj = runtime.getCurrentScript();
            const startDate = scriptObj.getParameter({name: 'custscript_start_date'});
            const endDate = scriptObj.getParameter({name: 'custscript_end_date'});
            
            // Format start date
            var startDateObj = new Date(startDate);
            var formattedStartDate = (startDateObj.getMonth() + 1) + '/' + startDateObj.getDate() + '/' + startDateObj.getFullYear();
            
            // Format end date
            var endDateObj = new Date(endDate);
            var formattedEndDate = (endDateObj.getMonth() + 1) + '/' + endDateObj.getDate() + '/' + endDateObj.getFullYear();
            
            log.debug('Date Parameters', {
                rawStartDate: startDate,
                formattedStartDate: formattedStartDate,
                rawEndDate: endDate,
                formattedEndDate: formattedEndDate
            });

            if (!formattedStartDate || !formattedEndDate) {
                throw error.create({
                    name: 'MISSING_PARAMETER',
                    message: 'Both start and end date parameters are required'
                });
            }
            
            var soSearchObj = search.create({
                type: "salesorder",
                settings:[{"name":"consolidationtype","value":"ACCTTYPE"},{"name":"includeperiodendtransactions","value":"F"}],
                filters:
                [
                   ["type","anyof","SalesOrd"], 
                   'AND',    
                    ['mainline', 'is', 'T'],
                    'AND',
                    ['trandate', 'onorafter', formattedStartDate],
                    'AND',
                    ['trandate', 'onorbefore', formattedEndDate]
                ],
                columns: [
                    search.createColumn({name: 'internalid'}),
                    search.createColumn({name: 'custbody_celigo_etail_order_id'}),
                    search.createColumn({name: 'trandate'})
                ]
            });
            
            log.debug('soSearchObj', soSearchObj);
            
            return soSearchObj;
            
        } catch (e) {
            log.error('getInputData Error', {
                message: e.message,
                stack: e.stack,
                params: {
                    startDate: startDate,
                    endDate: endDate
                }
            });
            throw e;
        }
    }

    function map(context) {
        try {
            const searchResult = JSON.parse(context.value);
            const soId = searchResult.values.internalid.value;
            const etailId = searchResult.values.custbody_celigo_etail_order_id;
            
            context.write({
                key: soId,
                value: {
                    soId: soId,
                    etailId: etailId || ''
                }
            });
        } catch (e) {
            log.error('Map Error', {
                message: e.message,
                stack: e.stack,
                context: context.value
            });
        }
    }

    function reduce(context) {
        try {
            const data = JSON.parse(context.values[0]);
            
            // Load and update the sales order in chunks to handle governance
            if (runtime.getCurrentScript().getRemainingUsage() < 100) {
                return;
            }
            
            record.submitFields({
                type: record.Type.SALES_ORDER,
                id: data.soId,
                values: {
                    'custbody_jlo_etail_order_id': data.etailId
                },
                options: {
                    enableSourcing: false,
                    ignoreMandatoryFields: true
                }
            });
            
        } catch (e) {
            log.error('Reduce Error', {
                message: e.message,
                stack: e.stack,
                key: context.key,
                values: context.values
            });
        }
    }

    function summarize(summary) {
        try {
            log.audit('Script Summary', {
                'Total Records Processed': summary.reduceSummary.reducedKeys.length,
                'Total Records with Errors': summary.reduceSummary.errors.length
            });

            // Log all errors
            summary.reduceSummary.errors.iterator().each(function(key, error) {
                log.error('Reduce Error for Sales Order ' + key, error);
                return true;
            });
        } catch (e) {
            log.error('Summarize Error', {
                message: e.message,
                stack: e.stack
            });
        }
    }

    return {
        getInputData: getInputData,
        map: map,
        reduce: reduce,
        summarize: summarize
    };
});
