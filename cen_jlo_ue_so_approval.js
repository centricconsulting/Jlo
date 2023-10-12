/**
 *@NApiVersion 2.x
 *@NScriptType UserEventScript
/= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * Purpose:  Send email for Effort Supervisor Group when record status update to open/close.
 * VER  DATE            AUTHOR               	 	 CHANGES
 * 1.0  July 14, 2023   Centric Consulting(Pradeep)     Initial Version
 * 1.1  Oct 12, 2023    Centric Consulting(Pradeep)     Update script for new requirements
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */

define(['N/search', 'N/record', 'N/runtime'],
    function (search, record, runtime) {
        function beforeLoad(context) {
            // get approve button
            var mode = context.type;
            if (mode == 'view') {
                log.debug({ title: 'Mode', details: mode });
                var objForm = context.form;
                var billButton = objForm.getButton({ id: 'approve' });
                if (billButton) {
                    billButton.isHidden = true;
                }
            }
        }
        function myAfterSubmit(context) {
            try {
                var executionContext = runtime.executionContext;
                log.debug({ title: 'executionContext', details: executionContext });
                if (executionContext == 'USERINTERFACE') {
                    var mode = context.type;
                    var currentRecord = context.newRecord;
                    if (mode == 'create' || mode == 'edit') {
                        log.debug({ title: 'Mode', details: mode });
                        var soIntId = currentRecord.getValue({ fieldId: "id" });
                        var orderType = currentRecord.getValue({ fieldId: "custbody_jlb_order_type" });
                        log.debug({ title: 'SO Detail', details: "Int ID: " + soIntId + ", Order Type: " + orderType });

                        // IF order type is B2B Customer
                        if (orderType == 2) {
                            record.submitFields({
                                type: record.Type.SALES_ORDER,
                                id: soIntId,
                                values: {
                                    'orderstatus': "A",
                                    'custbody_so_approval': true
                                },
                                options: { enableSourcing: false, ignoreMandatoryFields: true }
                            });
                        }

                        // IF order type is B2C/DTC Customer
                        if (orderType == 1) {
                            var soRecord = record.load({
                                type: record.Type.SALES_ORDER,
                                id: soIntId,
                                isDynamic: true
                            });
                            var itemCount = soRecord.getLineCount({ sublistId: 'item' });
                            log.debug({ title: 'Item Count', details: itemCount });
                            var Final_result;

                            for (var i = 0; i < itemCount; i++) {
                                var SO_Item = soRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
                                var SO_Item_type = soRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i });
                                var SO_Item_Quantity = soRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i });
                                var SO_Item_Sub_status = soRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_shpfy_subscrptn_flg', line: i });
                                var SO_Item_Sopify_Org_prize = soRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_shpfy_orgnl_prc', line: i });
                                var First_validation, Second_validation;

                                // First validation
                                if ((SO_Item_Sub_status == 'Y') && !SO_Item_Sopify_Org_prize) {
                                    First_validation = false; // first validation failed
                                } else {
                                    First_validation = true; // first validation passed
                                }

                                //check for avaiable quantity
                                var availableCount;
                                if (SO_Item_type == "Kit") {
                                    availableCount = checkAvailableKitItemCount(SO_Item);
                                }
                                if (SO_Item_type == "InvtPart") {
                                    availableCount = checkAvailableInvItemCount(SO_Item);
                                }
                                if (availableCount >= SO_Item_Quantity) {
                                    Second_validation = true; // Quantity validation passed
                                    log.debug('Second_validation', flag);
                                } else {
                                    Second_validation = false; // Quantity validation failed
                                    log.debug('Second_validation', flag);
                                }

                                if (First_validation == true && Second_validation == true) {
                                    Final_result = "pass";
                                } else {
                                    Final_result = "fail";
                                    break;
                                }
                            }
                            if (Final_result == "pass") {
                                soRecord.setValue({ fieldId: 'orderstatus', value: "B" }); // pending fulfillment
                                soRecord.setValue({ fieldId: 'custbody_so_approval', value: false });
                            }
                            if (Final_result == "fail") {
                                soRecord.setValue({ fieldId: 'orderstatus', value: "A" }); // pending approval
                                soRecord.setValue({ fieldId: 'custbody_so_approval', value: true });
                            }
                            soRecord.save({
                                enableSourcing: true,
                                ignoreMandatoryFields: true
                            });
                        }
                    }
                }
                soRecord.save({
                    enableSourcing: true,
                    ignoreMandatoryFields: true
                });
            } catch (e) {
                log.debug({ title: 'Error on after Submit: ', details: e });
            }
        }

        function checkAvailableKitItemCount(kitItemId) {
            try {
                var itemSearchObj = search.create({
                    type: "item",
                    filters:
                        [["internalid", "anyof", kitItemId]],
                    columns:
                        [
                            search.createColumn({
                                name: "formulanumeric",
                                summary: "MIN",
                                formula: "nvl(({memberitem.quantityavailable}/{memberquantity}),0)"
                            })
                        ]
                });
                var searchResultCount = itemSearchObj.run();
                var srenge = searchResultCount.getRange({ start: 0, end: 1 });
                var avaiableQty;
                if (srenge.length > 0) {
                    for (var i = 0; i < srenge.length; i++) {
                        avaiableQty = srenge[i].getValue(searchResultCount.columns[0]);
                    }
                }
                if (!avaiableQty) {
                    return avaiableQty = 0;
                } else {
                    return avaiableQty;
                }
            } catch (e) {
                log.debug({ title: 'Error on Kit Item: ', details: e });
            }
        }

        function checkAvailableInvItemCount(itemId) {
            try {
                var avaiableQty;
                var itemSearchObj = search.create({
                    type: "item",
                    filters:
                        [["internalid", "anyof", itemId]],
                    columns:
                        [search.createColumn({ name: "totalquantityonhand", summary: "MIN" })]
                });
                var searchResultCount = itemSearchObj.runPaged().count;
                var avaiableQty;
                itemSearchObj.run().each(function (ercRslt) {
                    avaiableQty = ercRslt.getValue({ name: "totalquantityonhand", summary: "MIN" });
                    return true;
                });
                if (!avaiableQty) {
                    return avaiableQty = 0;
                } else {
                    return avaiableQty;
                }
            } catch (e) {
                log.debug({ title: 'Error on Inv Item: ', details: e });
            }
        }
        return {
            beforeLoad: beforeLoad,
            afterSubmit: myAfterSubmit
        };
    });