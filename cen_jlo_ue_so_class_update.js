/**
 *@NApiVersion 2.x
 *@NScriptType UserEventScript
/= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * Purpose:  
 * VER  DATE            AUTHOR               	 	 CHANGES
 * 1.0  November 6, 2023   Centric Consulting(Pradeep)     Initial Version
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */

// Register the beforeSubmit function
define(['N/record', 'N/runtime', 'N/search'], function (record, runtime, search) {

    function beforeSubmitSetClass(scriptContext) {
        try {


            if (scriptContext.type === scriptContext.UserEventType.CREATE 
                || scriptContext.type === scriptContext.UserEventType.EDIT
                || scriptContext.type === scriptContext.UserEventType.XEDIT) {
        
        
                var continuityClass = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_continuity'});
                var instagramClass = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_insta'});
                var entryClass = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_entry'});
                var shopifyChannel = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_chan'});
                var corporateLocation = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_corp_loc'});
        
                var newRecord = scriptContext.newRecord;
                var lineCount = newRecord.getLineCount({ sublistId: 'item' });
        
                var etailChannel = newRecord.getValue({
                    fieldId: 'custbody_celigo_etail_channel'
                });
        
                var shopifyOrderNotes = newRecord.getValue({
                    fieldId: 'custbody_cen_shpfy_ordr_nts'
                });

                var shopifyOrderSource = newRecord.getValue({
                    fieldId: 'custbodycustbody_shpfy_order_src'
                });

                var custFlag = false;
                var instagramFlag = false;
                var continuityFlag = false;
                var entryFlag = false;

                // get the location from the header, this will be used for defaulting.
                 var locationHeaderId = newRecord.getValue({ fieldId: 'location'});
                 log.debug("location",locationHeaderId);

                // load customer class if it exists
                var customerId = newRecord.getValue({ fieldId: 'entity'});
                log.debug("Customer",customerId);
                var custClass = search.lookupFields({
                    type: search.Type.CUSTOMER,
                    id: customerId,
                    columns: ['custentityjlo_customer_class']
                });
                log.debug("customerClass",custClass);
    
                // only if a class has been assigned at the customer level
                var custClassId = null;
                if (custClass.custentityjlo_customer_class[0]) {
                    custClassId = custClass.custentityjlo_customer_class[0].value;
                    log.debug("Customer Class",custClass.custentityjlo_customer_class[0].value);     
                }           
        
                // loop through the item lines
                for (var i = 0; i < lineCount; i++) {

                    // if the location is not set at the line level, then:
                    // if the item is the shopify discount item, set the location to the corporate address
                    // otherwise default from the header.
                    var locationLine = newRecord.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'location',
                        line: i
                    });
                    log.debug("locatin",locationLine);

                    // this custom field is set on the line level for any lines 
                    // that are actual items. If it is not set, then it is something like 
                    // shopify discount line, shopify shipping cost
                    var orderLineId = newRecord.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_celigo_etail_order_line_id',
                        line: i
                    });

                    // if the location is not set at the line level, then:
                    // if the line has the custcol_celigo_etail_order_line_id set, default the location from the header
                    // otherwise default to the corporate address
                    if (!locationLine) {
                        if (orderLineId) {
                            newRecord.setSublistValue({
                                sublistId: 'item',
                                fieldId: 'location',
                                value: locationHeaderId,
                                ignoreFieldChange: true,
                                line: i
                            });
                        } else {
                            newRecord.setSublistValue({
                                sublistId: 'item',
                                fieldId: 'location',
                                value: corporateLocation,
                                ignoreFieldChange: true,
                                line: i
                            });
                        }
                    }
                    
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

                    // if there is a customer class, use it first
                    if (custClassId) {
                        classValue = custClassId;
                        custFlag = true;
                    
                    // next, check for instagram. if instagram use it
                    } else if(shopifyOrderNotes != null && shopifyOrderNotes.indexOf("Instagram") >= 0) {
                        classValue = instagramClass;
                        instagramFlag = true;

                    // next check for subcription: if subscriptionFlag = Y, eTail Channel = Shopify, and Shopify Order Source = 'subscription_contract'
                    } else if (subscriptionFlag === 'Y' && etailChannel != null && etailChannel.toString() === shopifyChannel 
                        && shopifyOrderSource != null && shopifyOrderSource === 'subscription_contract') {
                        classValue = continuityClass;
                        continuityFlag = true;

                    // otherwise if this is from the shopify channel, make the line Entry
                    } else if (etailChannel != null && etailChannel.toString() === shopifyChannel) {
                        entryFlag = true;
                        classValue = entryClass;
                    }

                    // if class is not set, then set it
                    var lineClass = newRecord.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'class',
                        line: i
                    });

                    // this custom field is set on the line level for any lines 
                    // that are actual items. If it is not set, then it is something like 
                    // shopify discount line, shopify shipping cost
                    var orderLineId = newRecord.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_celigo_etail_order_line_id',
                        line: i
                    });
                    

                    log.debug('classValue: ', classValue);

                    if (!lineClass && orderLineId != null) {
                        // Set the Class value for the line
                        newRecord.setSublistValue({
                            sublistId: 'item',
                            fieldId: 'class',
                            line: i,
                            value: classValue
                        });
                    }

                }

                // determine the class to set at the header level
                // If the customer had a class, use it
                // else if the order is from instagram, use it
                // else if there was a continuity order use it
                // otherwise, if entry level was set use it
                var headerClass = null;
                if (custFlag) {
                    headerClass = custClassId;
                } else if (instagramFlag) {
                    headerClass = instagramClass;
                } else if (continuityFlag) {
                    headerClass = continuityClass;
                } else if (entryFlag) {
                    headerClass = entryClass;
                } 
                
                newRecord.setValue({
                    fieldId: 'class',
                    value: headerClass
                });

                // loop through the item lines a second time, setting any fields
                // where the custcol_celigo_etail_order_line_id field is not set
                // to the class derived for the header
                for (var i = 0; i < lineCount; i++) {
    
                    // this custom field is set on the line level for any lines 
                    // that are actual items. If it is not set, then it is something like 
                    // shopify discount line, shopify shipping cost
                    var orderLineId = newRecord.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_celigo_etail_order_line_id',
                        line: i
                    });                    

                    if (!orderLineId) {
                        log.debug('order line is null', classValue);
                        // Set the Class value for the line
                        newRecord.setSublistValue({
                            sublistId: 'item',
                            fieldId: 'class',
                            line: i,
                            value: headerClass
                        });
                    }
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
