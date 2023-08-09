/**
 *@NApiVersion 2.x
 *@NScriptType UserEventScript
/= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * Purpose: This script is used to take BOM Component into Json field in PO.
 * VER  DATE           AUTHOR               		CHANGES
 * 1.0  Jul 28, 2023   Centric Consulting(Aman)   	Initial Version
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */

define(['N/record'], function (record) {
    function beforeSubmit(context) {
        var currentRecord = context.newRecord;
        var poID = currentRecord.getValue({ fieldId: 'id' });
        log.debug("PO Int ID: ", poID);
        var itemCount = currentRecord.getLineCount({ sublistId: 'item' });
        for (var i = 0; i < itemCount; i++) {
            var Bom_Revision = currentRecord.getSublistValue({ sublistId: 'item', fieldId: 'custcol_bom_revision', line: i });
            if (Bom_Revision) {
                var recordType = 'bomrevision';
                var jsonResult = saveFieldsToJSON(recordType, Bom_Revision);
                log.debug("jsonResult: ", jsonResult);
                currentRecord.setSublistValue({ sublistId: 'item', fieldId: 'custcol_bom_components', line: i, value: jsonResult });
            }
        }
    }

    /**
   * Save fields from a record into a JSON string
   * @param {string} recordType - The record type (e.g., 'customer', 'salesorder', 'employee')
   * @param {number|string} recordId - The internal ID or external ID of the record
   * @returns {string} - The JSON string containing the selected fields
   */
    function saveFieldsToJSON(recordType, recordId) {
        // Load the record
        var loadedRecord = record.load({ type: recordType, id: recordId, isDynamic: false });

        var lineLevelData = [];
        var componentCount = loadedRecord.getLineCount({ sublistId: 'component' });
        for (var j = 0; j < componentCount; j++) {
            //var item= loadedRecord.getSublistText({ sublistId: 'component', fieldId: 'item', line: j });

            var lineData = {
                item: loadedRecord.getSublistText({ sublistId: 'component', fieldId: 'item', line: j }),
                description: loadedRecord.getSublistValue({ sublistId: 'component', fieldId: 'description', line: j }),
                quantity: loadedRecord.getSublistValue({ sublistId: 'component', fieldId: 'quantity', line: j }),
                units_display: loadedRecord.getSublistValue({ sublistId: 'component', fieldId: 'units_display', line: j })
            };
            lineLevelData.push(lineData);
        }

        // Convert data to JSON string
        var jsonString = JSON.stringify(lineLevelData);

        return jsonString;
    }
    return {
        beforeSubmit: beforeSubmit
    };
});
