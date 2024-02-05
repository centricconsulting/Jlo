/**
 *@NApiVersion 2.x
 *@NScriptType ClientScript
/= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * Purpose:  
 * VER  DATE            AUTHOR               	 	 CHANGES
 * 1.0  November 6, 2023   Centric Consulting(Pradeep)     Initial Version
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */

// Register the beforeSubmit function
define(['N/record', 'N/runtime', 'N/search'], function (record, runtime, search) {

    function validateLine(scriptContext) {
        log.debug("validate line");
        try {
            var corporateLocation = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_corp_loc2'});
            //var corporateLocation = 2;
    
            var newRecord = scriptContext.currentRecord;
            var sublistName = scriptContext.sublistId;
            
            // get the location from the header, this will be used for defaulting.
            var locationIdHeader = newRecord.getValue({ fieldId: 'location'});
            log.debug("location",locationIdHeader);

            var locationLine = newRecord.getCurrentSublistValue({
                sublistId: 'item',
                fieldId: 'location'
            });
            log.debug("locatin",locationLine);

            // this custom field is set on the line level for any lines 
            // that are actual items. If it is not set, then it is something like 
            // shopify discount line, shopify shipping cost
            var orderLineId = newRecord.getCurrentSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_celigo_etail_order_line_id'
            });

            // if the location is not set at the line level, then:
            // if the line has the custcol_celigo_etail_order_line_id set, default the location from the header
            // otherwise default to the corporate address
            if (!locationLine) {
                if (orderLineId) {
                    newRecord.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'location',
                        value: locationIdHeader,
                        ignoreFieldChange: true
                    });
                } else {
                    newRecord.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'location',
                        value: corporateLocation,
                        ignoreFieldChange: true
                    });
                }
            }
            
            return true;
        } catch (e) {
            log.error(e,e.message);
        }
    }
    
    return {
        validateLine: validateLine
    };
});
