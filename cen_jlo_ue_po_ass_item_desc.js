/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/record'], function (record) {

  function beforeSubmit(context) {
    if (context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.EDIT) {
      return;
    }

    try {
      // Get the current purchase order record being saved
      var currentRecord = context.newRecord;

      // Get the total number of line items on the purchase order
      var lineCount = currentRecord.getLineCount({ sublistId: 'item' });

      for (var i = 0; i < lineCount; i++) {
        // Get the assembly item ID for each line item
        var assemblyItemId = currentRecord.getSublistValue({
          sublistId: 'item',
          fieldId: 'assembly',
          line: i
        });
        log.debug({ title: 'assemblyItemId', details: assemblyItemId });
        // Retrieve the purchase description from the assembly item
        var assemblyItemRecord = record.load({
          type: record.Type.ASSEMBLY_ITEM,
          id: assemblyItemId
        });
        
        var assemblyItemPurchaseDescription = assemblyItemRecord.getValue({
          fieldId: 'purchasedescription'
        });

        // Set the purchase description on the purchase order line item
        currentRecord.setSublistValue({
          sublistId: 'item',
          fieldId: 'custcol_ass_desc',
          line: i,
          value: assemblyItemPurchaseDescription
        });
      }

    } catch (e) {
      log.error('Error', 'An error occurred: ' + e.message);
      throw e;
    }
  }

  return {
    beforeSubmit: beforeSubmit
  };

});
