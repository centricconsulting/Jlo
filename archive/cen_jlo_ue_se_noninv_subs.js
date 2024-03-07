/**
 *@NApiVersion 2.x
 *@NScriptType UserEventScript
/**= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * Purpose: This script is to copy a new line from existing line.
 * VER  DATE           AUTHOR               		    CHANGES    
 * 1.0  Aug 24, 2023   Centric Consulting(Pradeep)   	Initial Version
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */
define(['N/record', 'N/search'], function(record, search) {

 

  function processSalesOrder(context) {
    if (context.type !== context.UserEventType.CREATE)
      return;

    var newRecord = context.newRecord;
    var salesOrderId = context.newRecord.id;
    // Load the Sales Order record 
    var newRecord = record.load({ type: record.Type.SALES_ORDER, id: salesOrderId });
    var lineCount = newRecord.getLineCount({ sublistId: 'item' });

    var jloLocation = newRecord.getValue({
                fieldId: 'location'
            });

    var itemType = newRecord.getValue({
                       fieldId: 'itemtype'});
		log.debug('itemType: ', itemType);

    for (var i = 0; i < lineCount; i++) {

       var itemId = newRecord.getSublistValue({ 
        sublistId: 'item', 
        fieldId: 'item', 
        line: i });
      
      var itemline = newRecord.getSublistSubrecord({
        sublistId: 'item',
        fieldId: 'inventorydetail',
        line: i
      });

 

      var isKitOrAssembly = newRecord.getSublistValue({
        sublistId: 'item',
        fieldId: 'itemtype',
        line: i
      });

      var isclosed = newRecord.getSublistValue({
        sublistId: 'item',
        fieldId: 'isclosed',
        line: i
      });
         var custcol_shpfy_subscrptn_flg = newRecord.getSublistValue({
        sublistId: 'item',
        fieldId: 'custcol_shpfy_subscrptn_flg',
        line: i
      });
     

      if (
        (isKitOrAssembly === 'NonInvtPart' ) &&
        custcol_shpfy_subscrptn_flg === 'Y'
      ) {
        // Perform the necessary actions based on criteria
        var closedLineId = newRecord.getSublistValue({
          sublistId: 'item',
          fieldId: 'id',
          line: i
        });
        log.debug('Processing line ' + (i + 1), 'Closed Line ID: ' + closedLineId);

 

        // Close the original line
        newRecord.setSublistValue({
          sublistId: 'item',
          fieldId: false,
          line: i,
          value: true
        });

  
        newRecord.setSublistValue({
          sublistId: 'item',
          fieldId: 'isclosed',
          line: i, // Use newLine here instead of i
          value: true
        });


      }
    }

    newRecord.setValue({
                        fieldId: 'location',
                        value: jloLocation
                    });
     

    // Save the Sales Order record
    var savedOrderId = newRecord.save();
    log.debug('Saved Sales Order', 'Order ID: ' + savedOrderId);
  }

 

  return {
    afterSubmit: processSalesOrder
  };
});