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
            var salesorderSearchObj = search.create({
                type: "salesorder",
                filters:
                    [
                        ["type", "anyof", "SalesOrd"],
                        "AND", ["mainline", "is", "F"],
                        "AND", ["item.type", "anyof", "NonInvtPart"],
                        "AND", ["custcol_shpfy_subscrptn_flg", "is", "Y"],
                        "AND", ["customermain.depositbalance", "greaterthan", "0.00"]
                        , "AND", ["internalid", "anyof", "17008"] // for testing only
                    ],
                columns:
                    [
                        "trandate", "tranid", "entity", "amount", "item",
                        search.createColumn({ name: "line", sort: search.Sort.ASC }),
                        search.createColumn({ name: "tranid", join: "applyingTransaction" }),
                        search.createColumn({ name: "internalid", join: "applyingTransaction" }),
                        search.createColumn({ name: "tranid", join: "appliedToTransaction" }),
                        search.createColumn({ name: "internalid", join: "appliedToTransaction" }),
                        search.createColumn({ name: "depositbalance", join: "customerMain" })
                    ]
            });
            return salesorderSearchObj;
        }
        function map(context) {
            var jsonobj = JSON.parse(context.value);
            log.debug("Json : ", jsonobj);
            //var tranID = jsonobj["values"]["GROUP(internalid)"]["value"];
            var customerID = jsonobj["values"]["entity"]["value"];
            var custDepositBalance = jsonobj["values"]["depositbalance.customerMain"];
            log.debug("Details 1 : ", "cust name" + customerID + ", balance: " + custDepositBalance);

            // Find invoice of same amount of deposit balance
            var invType = "CustInvc";
            var invStatus = "CustInvc:A";
            var invoiceID = findTransaction(customerID, custDepositBalance, invType, invStatus);

            // Find customer deposit of same amount of deposit balance
            var cdType = "CustDep";
            var cdStatus = "CustDep:B";
            var custDepositID = findTransaction(customerID, custDepositBalance, cdType, cdStatus);

            // Apply the deposit to the invoice (assuming full payment for simplicity)
            if (custDepositBalance > 0 && (invoiceID && custDepositID)) {
                var createRecord = record.transform({
                    fromType: record.Type.CUSTOMER_DEPOSIT,
                    fromId: custDepositID,
                    toType: record.Type.DEPOSIT_APPLICATION,
                    isDynamic: true,
                });
                var numLines = createRecord.getLineCount({ sublistId: 'apply' });
                for (i = 0; i < numLines; i++) {
                    createRecord.selectLine({ sublistId: "apply", line: i });
                    createRecord.setCurrentSublistValue({ sublistId: 'apply', fieldId: 'apply', value: true });
                    createRecord.setCurrentSublistValue({ sublistId: 'apply', fieldId: 'refnum', value: invoiceID });
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

        function findTransaction(customerID, custDepositBalance, tranType, tranStatus) {
            var invoiceSearchObj = search.create({
                type: "transaction",
                filters:
                    [
                        ["type", "anyof", tranType],
                        "AND",
                        ["status", "anyof", tranStatus],
                        "AND",
                        ["mainline", "is", "T"],
                        "AND",
                        ["name", "anyof", customerID],
                        "AND",
                        ["amount", "equalto", custDepositBalance],
                    ],
                columns:
                    [
                        "internalid"
                    ]
            });
            var searchResultCount = invoiceSearchObj.runPaged().count;
            log.debug("invoiceSearchObj result count", searchResultCount);
            var transaction;
            if (searchResultCount > 0) {
                invoiceSearchObj.run().each(function (result) {
                    transaction = result.getValue({ name: "internalid" });
                    return true;
                });
            }
            return transaction;
        }

        return {
            getInputData: getInputData,
            map: map,
            summarize: summarize
        };
    });