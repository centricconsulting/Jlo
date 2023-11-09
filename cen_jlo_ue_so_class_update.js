/**
 *@NApiVersion 2.x
 *@NScriptType UserEventScript
/= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * Purpose:  Cycle count approval process automation
 * VER  DATE            AUTHOR               	 	 CHANGES
 * 1.0  November 6, 2023   Centric Consulting(Pradeep)     Initial Version
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */
function beforeSubmitSetClass(scriptContext) {
    if (scriptContext.type === scriptContext.UserEventType.CREATE || scriptContext.type === scriptContext.UserEventType.EDIT) {
        var newRecord = scriptContext.newRecord;
        var lineCount = newRecord.getLineCount({ sublistId: 'item' });

        for (var i = 0; i < lineCount; i++) {
            var subscriptionFlag = newRecord.getSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_shpfy_subscrptn_flg',
                line: i
            });

            var etailChannel = newRecord.getText({
                fieldId: 'custbody_celigo_etail_channel'
            });
            log.debug('subscriptionFlag: ', subscriptionFlag);
          log.debug('etailChannel: ', etailChannel);
          log.debug('i: ', i);
          
            var classValue = '';

            if (subscriptionFlag === 'Y' && etailChannel === 'Shopify') {
                classValue = '106'; // Continuity
            
            } else if ((subscriptionFlag === 'N' || !subscriptionFlag) && etailChannel === 'Shopify') {
                classValue = '130'; // Entry/One-Shot
            }
               log.debug('classValue: ', classValue);
            // Set the Class value for the line
            newRecord.setSublistValue({
                sublistId: 'item',
                fieldId: 'class',
                line: i,
                value: classValue
            });
        }
    }
}

// Register the beforeSubmit function
define(['N/record'], function (record) {
    return {
        beforeSubmit: beforeSubmitSetClass
    };
});
