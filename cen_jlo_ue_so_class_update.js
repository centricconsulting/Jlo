/**
 *@NApiVersion 2.x
 *@NScriptType UserEventScript
/= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * Purpose:  Cycle count approval process automation
 * VER  DATE            AUTHOR               	 	 CHANGES
 * 1.0  November 6, 2023   Centric Consulting(Pradeep)     Initial Version
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */

// Register the beforeSubmit function
define(['N/record', 'N/runtime'], function (record, runtime) {

    function beforeSubmitSetClass(scriptContext) {
        try {


            if (scriptContext.type === scriptContext.UserEventType.CREATE || scriptContext.type === scriptContext.UserEventType.EDIT) {
        
        
                var continuityClass = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_continuity'});
                var instagramClass = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_insta'});
                var entryClass = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_entry'});
                var shopifyChannel = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_chan'});
        
                var newRecord = scriptContext.newRecord;
                var lineCount = newRecord.getLineCount({ sublistId: 'item' });
        
                // var etailChannel = newRecord.getText({
                //     fieldId: 'custbody_celigo_etail_channel'
                // });
                var etailChannel = newRecord.getValue({
                    fieldId: 'custbody_celigo_etail_channel'
                });
        
                var shopifyOrderNotes = newRecord.getValue({
                    fieldId: 'custbody_cen_shpfy_ordr_nts'
                });
        
                for (var i = 0; i < lineCount; i++) {
                    // var subscriptionFlag = newRecord.getSublistValue({
                    //     sublistId: 'item',
                    //     fieldId: 'custcol_shpfy_subscrptn_flg',
                    //     line: i
                    // });

                    var installNum = newRecord.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcolcustcol_shpfy_num_instlmts',
                        line: i
                    });
            
                    var subscriptionFlag = 'N';
                    if (installNum) {
                        subscriptionFlag = 'Y';
                    };
                    
                    log.debug("install num",installNum);
                    log.debug('subscriptionFlag: ', subscriptionFlag);
                    log.debug('etailChannel: ', etailChannel);
                    log.debug('shpifyOrderNotes: ', shopifyOrderNotes);
                    log.debug('i: ', i);
                    log.debug("test etail",etailChannel.toString() === shopifyChannel);
                    log.debug("test shop",typeof shopifyChannel);
                    log.debug("test et2",typeof etailChannel);
                
                    var classValue = '';
        
                    // If subscriptionFlag = Y, eTail Channel = Shopify, and Order Notes Contains Instagram
                    if (subscriptionFlag === 'Y' && etailChannel.toString() === shopifyChannel
                        && shopifyOrderNotes != null && shopifyOrderNotes.indexOf("Instagram") >= 0) {
                        //classValue = '134'; // Instagram
                        classValue = instagramClass;
                    
                    // If subscriptionFlag = Y, eTail Channel = Shopify, and Order Notes does not contain Instagram
                    } else if (subscriptionFlag === 'Y' && etailChannel.toString() === shopifyChannel) {
                        //classValue = '106'; // Continuity
                        classValue = continuityClass;
        
                    // If subscriptionFlag = N, eTail Channel = Shopify, and Order Notes contains Instagram    
                    } else if ((subscriptionFlag === 'N' || !subscriptionFlag) && etailChannel.toString() === shopifyChannel
                        && shopifyOrderNotes != null && shopifyOrderNotes.indexOf("Instagram") >= 0) {            
                        //classValue = '134'; // Instagram
                        classValue = instagramClass;
                    
                    // If subscriptionFlag = N, eTail Channel = Shopify, and Order Notes does not contain Instagram
                    } else if ((subscriptionFlag === 'N' || !subscriptionFlag) && etailChannel.toString() === shopifyChannel) {
                        //classValue = '130'; // Entry/One-Shot
                        classValue = entryClass;
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

        } catch (e) {
            log.error(e,e.message);
        }
    }

    
    return {
        beforeSubmit: beforeSubmitSetClass
    };
});
