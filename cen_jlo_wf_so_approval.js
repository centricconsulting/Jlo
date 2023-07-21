/**
 * @NApiVersion 2.x
 * @NScriptType WorkflowActionScript
 *
/= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * Purpose: This is used to set status on SO form workflow.
 * VER  DATE            AUTHOR               	 	 CHANGES
 * 1.0  July 14, 2023   Centric Consulting(Aman)     Initial Version
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */
define(['N/record'], function (record) {
    function onAction(scriptContext) {
        log.debug({ title: 'Start Script' });
        var newRecord = scriptContext.newRecord;
        var soIntId = newRecord.getValue({ name: "id" });
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
        }
        if (flag == true) {
            soRecord.setValue({ fieldId: 'orderstatus', value: "B" });
        }
        soRecord.save({
            enableSourcing: true,
            ignoreMandatoryFields: true
        });
    }

    function checkAvailableKitItemCount(kitItemId) {
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
        var srenge = searchResultCount.getRange({ start: 0, end: 10 });
        var avaiableQty;
        if (srenge.length > 0) {
           for (var i = 0; i < srenge.length; i++) {
              avaiableQty = srenge[i].getValue(searchResultCount.columns[0]);
              return avaiableQty;
           }
        }
     }
  
     function checkAvailableInvItemCount(itemId) {
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
        return avaiableQty;
     }
    return {
        onAction: onAction
    }
}); 