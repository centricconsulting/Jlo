/**
 *@NApiVersion 2.x
 *@NScriptType UserEventScript
/= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * Purpose:  Send email for Effort Supervisor Group when record status update to open/close.
 * VER  DATE            AUTHOR               	 	 CHANGES
 * 1.0  July 14, 2023   Centric Consulting(Aman)     Initial Version
 * For B2B users, force approval
 * - B2B is checked based on the customer attribute
	
 * For B2C users:
 * 	- if any line is a subscription and does not have a original price, then force an approval
 * 	- if there is not enough quantity for any line, then force approval
 *  - For B2C users if there is enough quantity for all lines, auto approve
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */

define(['N/search', 'N/record', 'N/runtime'],
    function (search, record, runtime) {
        function beforeLoad(context) {

            // Mazuk - what does this do?
            // get approve button
            var mode = context.type;
            //log.debug({ title: 'Mode', details: mode });
            if (mode == 'view') {                
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

                // Mazuk - removed the context because we need to handle CSV and WebServices contexts - to 
                // cover any B2B csv loads and for any Amazon or Shopify orders
                //if (executionContext == 'USERINTERFACE') {
                var mode = context.type;
                var currentRecord = context.newRecord;
                if (mode == 'create') {
                    log.debug({ title: 'Mode', details: mode });
                    var soIntId = currentRecord.getValue({ fieldId: "id" });
                    var customer = currentRecord.getValue({ fieldId: "entity" });
                    log.debug({ title: 'so Detail', details: "int ID: " + soIntId + ", Cust: " + customer });

                    // load the SO record.
                    var soRecord = record.load({
                        type: record.Type.SALES_ORDER,
                        id: soIntId,
                        isDynamic: true
                    });

                    // checking for B2B Customer
                    var customer = currentRecord.getValue({ fieldId: "entity" });
                    var fieldLookUp = search.lookupFields({
                        type: search.Type.CUSTOMER,
                        id: customer,
                        columns: ['isperson']
                    });
                    var isPerson = fieldLookUp.isperson;

                    // for B2B customers, we want to force an approval
                    if (!isPerson) {
                        log.debug('B2B Order', flag);
                        soRecord.setValue({ fieldId: 'orderstatus', value: "A" });
                        soRecord.setValue({ fieldId: 'status', value: "Pending Approval" });
                        soRecord.setValue({ fieldId: 'custbody_so_approval', value: true });  
                    }
                    else // handle B2C customers
                    {

                        // loop through the item list, checking for the following:
                        // 1) If the quantity requested is more than the available quantity, force an approval
                        // 2) if the line item is a subscription, but there is no Shopify Original Proce, force an approval
                        var itemCount = soRecord.getLineCount({ sublistId: 'item' });
                        log.debug({ title: 'Item Count', details: itemCount });
                        var flag = false;
                        for (var i = 0; i < itemCount && !flag; i++) {
                            var SO_Item = soRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
                            var SO_Item_type = soRecord.getSublistValue({ sublistId: 'item', fieldId: 'itemtype', line: i });
                            var SO_Item_Quantity = soRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i });
                            var SO_Item_Sopify_Org_prize = soRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_shpfy_orgnl_prc', line: i });
                            var SO_Item_Shopify_Sub = soRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_shpfy_subscrptn_flg', line: i });

                            log.debug('SO_Item_Sopify_Org_prize', SO_Item_Sopify_Org_prize);

                            //check for avaiable quantity
                            log.debug("type",SO_Item_type);
                            var availableCount;
                            if (SO_Item_type == "Kit") {
                                availableCount = checkAvailableKitItemCount(SO_Item);
                            } else if (SO_Item_type == "InvtPart" || SO_Item_type == "Assembly") {
                                availableCount = checkAvailableInvItemCount(SO_Item);
                            }
                            else {
                                log.debug("invalid type",SO_Item_type);
                                availableCount = 0;
                            }
                            log.debug("quantities:avail:item",availableCount+":"+SO_Item_Quantity);
                            if (availableCount < SO_Item_Quantity) {
                                flag = true;
                                log.debug('not enough quantity', flag);
                            }

                            // if this is a subscription item, and no original price was supplied, force an approval
                            if (SO_Item_Shopify_Sub && SO_Item_Shopify_Sub == 'Y' && SO_Item_Sopify_Org_prize == '') {
                                flag = true;
                                log.debug('no shopify price', flag);
                            }
                        } // end loop 

                        log.debug({ title: 'flag: ', details: flag });
                        if ((flag == true)) {
                            soRecord.setValue({ fieldId: 'orderstatus', value: "A" });
                            soRecord.setValue({ fieldId: 'status', value: "Pending Approval" });
                            soRecord.setValue({ fieldId: 'custbody_so_approval', value: true });
                            ///soRecord.setValue({ fieldId: 'memo', value: 'TEST222' });
                            //soRecord.setValue({ fieldId: 'custbody_so_approval', value: true });
                            log.debug('mark for pending approval - B2C', flag);
                            //log.debug('SO_Item_Sopify_Org_prize new 0', SO_Item_Sopify_Org_prize);
                        }
                        else {
                            log.debug("mark approved");
                            soRecord.setValue({ fieldId: 'orderstatus', value: "B" });
                            soRecord.setValue({ fieldId: 'status', value: "Pending Fulfillment" });
                            //log.debug('SO_Item_Sopify_Org_prize new 1', SO_Item_Sopify_Org_prize);
                        }
                    } // end B2B check

                    // save the changes to the SO record
                    soRecord.save({
                        enableSourcing: true,
                        ignoreMandatoryFields: true
                    });
                } // end Create Mode Check
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