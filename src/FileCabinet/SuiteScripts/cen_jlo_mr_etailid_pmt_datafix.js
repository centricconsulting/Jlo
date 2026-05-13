/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/search', 'N/record', 'N/runtime', 'N/format', 'N/error'], function(search, record, runtime, format, error) {
    
    function getInputData() {
        try {
            const scriptObj = runtime.getCurrentScript();
            const startDate = scriptObj.getParameter({name: 'custscript_etail_pmt_start'});
            const endDate = scriptObj.getParameter({name: 'custscript_etail_pmt_end'});
            
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
            
            var suiteQL = `
                select t.id, tl.custcolcustcol_shpfy_orgnl_order,  t.custbody_jlo_etail_link_pmt, t.custbody_cen_jlo_digital_pmt_ord
                from transaction t, transactionline tl
                where t.custbody_jlo_etail_link_pmt is null
                    and trandate >= to_date(?,'MM/DD/YYYY')
                    and trandate <= to_date(?,'MM/DD/YYYY')
                    and recordtype = 'invoice'
                    and t.id = tl.transaction
                    and tl.custcolcustcol_shpfy_orgnl_order is not null
                    --and t.id = 4067139
                order by t.id desc
            `; 

            return {
                type: 'suiteql',
                query: suiteQL,
                params: [formattedStartDate,formattedEndDate]
            };
            
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
            //log.debug("map",searchResult);
            const invId = searchResult.values[0];
            const originalOrder = searchResult.values[1];
            log.debug("map2",invId + ":" + originalOrder);
            
            context.write({
                key: invId,
                value: {
                    invId: invId,
                    etailId: originalOrder
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
            
            log.debug("tran",data.invId+":"+data.etailId);
            // var recType = null;
            // if (data.tranType === "SalesOrd") {
            //     recType = record.Type.SALES_ORDER; 
            // } else if (data.tranType === 'CustInvc') {
            //     recType = record.Type.INVOICE;
            // }
            record.submitFields({
                //type: record.Type.SALES_ORDER,
                type: record.Type.INVOICE,
                id: data.invId,
                values: {
                    'custbody_jlo_etail_link_pmt': data.etailId
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
            log.audit('Script Summary', 
                'Total Records Processed:' + summary.reduceSummary.keys.length +
                ', Total Records with Errors:' + summary.reduceSummary.errors.length
            );

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
