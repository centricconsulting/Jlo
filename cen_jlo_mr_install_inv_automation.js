/**
 * @NApiVersion 2.x
 * @NScriptType MapReduceScript
/= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * Purpose:  A script to automate invoice for installment items.
 * VER  DATE           AUTHOR               		CHANGES
 * 1.0  Dec 04, 2023   Centric Consulting(Aman)   	Initial Version
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */

define(['N/search', 'N/record', 'N/runtime'],
    function (search, record, runtime) {
        var savedSearch = runtime.getCurrentScript().getParameter({ name: 'custscript_sales_order_saved_search' });

        function getInputData() {
            return search.load({ id: savedSearch });
        }

        function map(context) {
            var jsonobj = JSON.parse(context.value);
            //log.debug("Json : ", jsonobj);
            var salesOrderID = jsonobj["values"]["internalid"]["value"];
            var Days = jsonobj["values"]["formulanumeric"];
            parseInt(Days);
            log.debug("Days : ", Days);
            var installmentCount = jsonobj["values"]["custbody_installment_counter"];
            if (!installmentCount) {
                installmentCount = 0;
            }
            installmentCount = parseInt(installmentCount) + 1;// Installation count update
            log.debug("Details 1", "salesOrderID: " + salesOrderID + ", installmentCount: " + installmentCount);
            if (installmentCount > 3) { return; }

            var salesorderSearchObj = search.create({
                type: "salesorder",
                filters:
                    [
                        ["type", "anyof", "SalesOrd"], "AND", ["custbody_cen_jlo_instal_ord", "is", "T"],
                        "AND", ["mainline", "is", "F"], "AND", ["taxline", "is", "F"], "AND", ["closed", "is", "F"],
                        "AND", ["internalidnumber", "equalto", salesOrderID]
                    ],
                columns:
                    [
                        "internalid", "tranid", search.createColumn({ name: "internalid", join: "customerMain" }),
                        "custbody_installment_counter", "subsidiarynohierarchy", "otherrefnum", "classnohierarchy", "locationnohierarchy",
                        "custbody_jlb_sales_channel", "custbody_celigo_etail_order_id", "item", search.createColumn({ name: "type", join: "item" }),
                        "quantity", "rate", "amount", "taxcode", "custcolcustcol_shpfy_inst_prc", "custcolcustcol_shpfy_num_instlmts"
                    ]
            });
            var searchResultCount = salesorderSearchObj.runPaged().count;
            log.debug("salesorderSearchObj result count", searchResultCount);
            var soIntID, docNumber, custIntID, subID, poNum, classID, locID, salesChannel, etailOrderID, item, itemType, quantity, itemRate,
                amount, taxcode, shpfy_inst_price, shpfy_num_instlmts;
            var invRecord;
            salesorderSearchObj.run().each(function (result) {
                soIntID = result.getValue({ name: "internalid" });
                docNumber = result.getValue({ name: "tranid" });
                custIntID = result.getValue({ name: "internalid", join: "customerMain" });
                subID = result.getValue({ name: "subsidiarynohierarchy" });
                poNum = result.getValue({ name: "otherrefnum" });
                classID = result.getValue({ name: "classnohierarchy" });
                locID = result.getValue({ name: "locationnohierarchy" });
                salesChannel = result.getValue({ name: "custbody_jlb_sales_channel" });
                etailOrderID = result.getValue({ name: "custbody_celigo_etail_order_id" });
                item = result.getValue({ name: "item" });
                itemType = result.getValue({ name: "type", join: "item" });
                quantity = result.getValue({ name: "quantity" });
                itemRate = result.getValue({ name: "rate" });
                amount = result.getValue({ name: "amount" });
                taxcode = result.getValue({ name: "taxcode" });
                shpfy_inst_price = result.getValue({ name: "custcolcustcol_shpfy_inst_prc" });
                shpfy_num_instlmts = result.getValue({ name: "custcolcustcol_shpfy_num_instlmts" });

                if ((installmentCount == 1) || (installmentCount == 2 && Days >= 31) || (installmentCount == 3 && Days >= 61)) {
                    // Create invoice
                    if (!invRecord) {
                        invRecord = record.create({
                            type: record.Type.INVOICE,
                            isDynamic: true,
                            defaultValues: {
                                entity: custIntID
                            }
                        });
                        invRecord.setValue({ fieldId: 'otherrefnum', value: poNum });
                        invRecord.setValue({ fieldId: 'class', value: classID });
                        invRecord.setValue({ fieldId: 'location', value: locID });
                        invRecord.setValue({ fieldId: 'custbody_celigo_etail_order_id', value: etailOrderID });
                    }
                    // add line level item
                    if (itemType == "Discount" && installmentCount == 1) {
                        invRecord.setValue({ fieldId: 'discountitem', value: item });
                        invRecord.setValue({ fieldId: 'discountrate', value: itemRate });
                    } else {
                        if (installmentCount == 1) {
                            if (shpfy_num_instlmts) {
                                invRecord.selectNewLine({ sublistId: 'item' });
                                invRecord.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: item });
                                invRecord.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: quantity });
                                invRecord.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: shpfy_inst_price });
                                invRecord.setCurrentSublistValue({ sublistId: 'item', fieldId: 'taxcode', value: taxcode });
                                invRecord.commitLine({ sublistId: 'item' });
                            } else {
                                invRecord.selectNewLine({ sublistId: 'item' });
                                invRecord.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: item });
                                invRecord.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: quantity });
                                if (itemRate) {
                                    invRecord.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: itemRate });
                                } else {
                                    invRecord.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: amount });
                                }
                                invRecord.setCurrentSublistValue({ sublistId: 'item', fieldId: 'taxcode', value: taxcode });
                                invRecord.commitLine({ sublistId: 'item' });
                            }
                        }
                        if ((installmentCount == 2 && Days >= 31) || (installmentCount == 3 && Days >= 61)) {
                            if (shpfy_num_instlmts) {
                                invRecord.selectNewLine({ sublistId: 'item' });
                                invRecord.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: item });
                                invRecord.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: quantity });
                                invRecord.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: shpfy_inst_price });
                                invRecord.setCurrentSublistValue({ sublistId: 'item', fieldId: 'taxcode', value: taxcode });
                                invRecord.commitLine({ sublistId: 'item' });
                            }
                        }
                    }
                }
                return true;
            });
            var id;
            if (invRecord) {
                id = invRecord.save({ enableSourcing: true, ignoreMandatoryFields: true });
                log.debug("Invoice Created", "InvID " + id);
                counterUpdate(soIntID, installmentCount);
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

        function counterUpdate(soIntID, installmentCount) {
            record.submitFields({
                type: record.Type.SALES_ORDER,
                id: soIntID,
                values: {
                    'custbody_installment_counter': installmentCount
                },
                options: { enableSourcing: false, ignoreMandatoryFields: true }
            });
        }

        return {
            getInputData: getInputData,
            map: map,
            summarize: summarize
        };
    });