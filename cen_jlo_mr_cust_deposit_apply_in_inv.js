/**
 * @NApiVersion 2.x
 * @NScriptType MapReduceScript
/= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * Purpose: To apply customer deposit in invoice based on customer deposit balance.
 * VER  DATE           AUTHOR               		CHANGES
 * 1.0  Sep 19, 2023   Centric Consulting(Pradeep)   	Initial Version
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */

define(['N/search', 'N/record'],
    function (search, record) {
        function getInputData() {
            var customerdepositSearchObj = search.create({
                type: "customerdeposit",
                filters:
                    [
                        ["type", "anyof", "CustDep"],
                        "AND", ["status", "anyof", "CustDep:A"],
                        "AND", ["mainline", "is", "T"],
                        "AND", ["createdfrom.custbody_celigo_etail_order_id", "isnotempty", ""]
                        , "AND", ["internalid", "anyof", "17220"]
                    ],
                columns:
                    [
                        "internalid", "tranid", "entity", "createdfrom", "amount",
                        search.createColumn({ name: "custbody_celigo_etail_order_id", join: "createdFrom" })
                    ]
            });
            return customerdepositSearchObj;
        }
        function map(context) {
            var jsonobj = JSON.parse(context.value);
            log.debug("Json : ", jsonobj);
            var custDepositId = jsonobj["values"]["internalid"]["value"];
            var customerId = jsonobj["values"]["entity"]["value"];
            var soptifyOrderId = jsonobj["values"]["custbody_celigo_etail_order_id.createdFrom"];
            var custDepositBalance = jsonobj["values"]["amount"]; 
            log.debug("Details 1", "custDepositId: " + custDepositId + ", soptifyOrderId: " + soptifyOrderId + ", custDepositBalance: " + custDepositBalance);

            // Invoice to apply
            var invoiceId = findInvoice(soptifyOrderId);
            log.debug("invoiceId : ", invoiceId);
            // Apply customer deposit to Invoice
            if (invoiceId && custDepositId) {
                var createRecord = record.transform({
                    fromType: record.Type.CUSTOMER_DEPOSIT,
                    fromId: custDepositId,
                    toType: record.Type.DEPOSIT_APPLICATION,
                    isDynamic: true,
                });
                var numLines = createRecord.getLineCount({ sublistId: 'apply' });
                log.debug("numLines : ", numLines);
                for (i = 0; i < numLines; i++) {
                    createRecord.selectLine({ sublistId: "apply", line: i });
                    createRecord.setCurrentSublistValue({ sublistId: 'apply', fieldId: 'apply', value: true });
                    createRecord.setCurrentSublistValue({ sublistId: 'apply', fieldId: 'refnum', value: invoiceId });
                    createRecord.setCurrentSublistValue({ sublistId: 'apply', fieldId: 'amount', value: custDepositBalance });
                }

                // Save the deposit record with applied payments
                createRecord.save();
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
        }

        function findInvoice(soptifyOrderId) {
            var invoiceSearchObj = search.create({
                type: "invoice",
                filters:
                    [
                        ["type", "anyof", "CustInvc"],
                        "AND", ["mainline", "is", "T"],
                        "AND", ["custbody_celigo_etail_order_id", "is", soptifyOrderId],
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
            invoiceSearchObj.run().each(function (result) {
                invTran = result.getValue({ name: "internalid" });
                return true;
            });
            return invTran;
        }

        return {
            getInputData: getInputData,
            map: map,
            summarize: summarize
        };
    });