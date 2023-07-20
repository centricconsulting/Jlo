/**
 *@NApiVersion 2.x
 *@NScriptType UserEventScript
/= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * Purpose:  Send email for Effort Supervisor Group when record status update to open/close.
 * VER  DATE            AUTHOR               	 	 CHANGES
 * 1.0  July 14, 2023   Centric Consulting(Aman)     Initial Version
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */

define(['N/search', 'N/record'],
    function (search, record) {
        function myAfterSubmit(context) {
            try {
                var currentRecord = context.newRecord;
                var soIntId = currentRecord.getValue({ fieldId: "id" });
                var customer = currentRecord.getValue({ fieldId: "entity" });
                log.debug({ title: 'so Detail', details: "int ID: " + soIntId + ", Cust: " + customer });

                // checking for B2B Customer
                var fieldLookUp = search.lookupFields({
                    type: search.Type.CUSTOMER,
                    id: customer,
                    columns: ['isperson']
                });
                var isPerson = fieldLookUp.isperson;
                if (isPerson == false) {
                    return;
                }
                var soRecord = record.load({
                    type: record.Type.SALES_ORDER,
                    id: soIntId,
                    isDynamic: false
                });
                var itemCount = soRecord.getLineCount({ sublistId: 'item' });
                log.debug({ title: 'Item Count', details: itemCount });
                var flag;
                for (var i = 0; i < itemCount; i++) {
                    var SO_Item = soRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
                    var SO_Item_type = soRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i });
                    var SO_Item_Quantity = soRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i });

                    //check for avaiable quantity
                    var availableCount;
                    if (SO_Item_type == "Kit") {
                        availableCount = checkAvailableKitItemCount(SO_Item);
                    }
                    if (SO_Item_type == "InvtPart") {
                        availableCount = checkAvailableInvItemCount(SO_Item);
                    }
                    if (availableCount >= SO_Item_Quantity) {
                        flag = true;
                    } else {
                        flag = false;
                    }
                    if (flag == false) { break; }
                }
                log.debug({ title: 'flag: ', details: flag });
                if (flag == false) {
                    soRecord.setValue({ fieldId: 'orderstatus', value: "A" });
                    soRecord.setValue({ fieldId: 'status', value: "Pending Approval" });
                }
                if (flag == true) {
                    soRecord.setValue({ fieldId: 'orderstatus', value: "B" });
                    soRecord.setValue({ fieldId: 'status', value: "Pending Fulfillment" });
                }
                soRecord.save({
                    enableSourcing: true,
                    ignoreMandatoryFields: true
                });
            } catch (e) {
                log.debug({ title: 'Error on action: ', details: e });
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
            afterSubmit: myAfterSubmit
        };
    });