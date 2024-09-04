/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/search', 'N/log', 'N/runtime'], function (record, search, log, runtime) {

    function beforeSubmit(context) {
        try {
            if (context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.EDIT) {
                return;
            }

            var orderTypeParam = runtime.getCurrentScript().getParameter({
                name: 'custscript_order_type_related_inv'
            });

            var depositApplication = context.newRecord;
            var lineCount = depositApplication.getLineCount({ sublistId: 'apply' });

            if (lineCount > 0) {
                var firstLineInternalId = depositApplication.getSublistValue({
                    sublistId: 'apply',
                    fieldId: 'internalid',
                    line: 0
                });

                log.debug('First Line Internal ID', firstLineInternalId);

                if (firstLineInternalId) {
                    var lookupFields = search.lookupFields({
                        type: 'transaction',
                        id: firstLineInternalId,
                        columns: ['trandate', 'custbody_jlb_order_type']
                    });

                    var trandate = lookupFields.trandate;
                    var orderType = lookupFields.custbody_jlb_order_type;

                    log.debug('Trandate', trandate);
                    log.debug('Order Type', orderType);

                    if (orderType && orderType[0] && orderType[0].value == orderTypeParam) { // Order type is 1
                        log.debug('Order Type is 1', 'Setting trandate on deposit application');
                        depositApplication.setValue({
                            fieldId: 'trandate',
                            value: new Date(trandate)
                        });
                    }
                }
            }

        } catch (e) {
            log.error('Error in BeforeSubmit', e.toString());
        }
    }

    return {
        beforeSubmit: beforeSubmit
    };

});
