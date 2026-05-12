/**
 *@NApiVersion 2.x
 *@NScriptType UserEventScript
/= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * Purpose:  
 * VER  DATE            AUTHOR               	 	 CHANGES
 * 1.0  November 6, 2023   Centric Consulting(Pradeep)     Initial Version
 * 
 * The logic will work top/down, meaning once a class has been determined no further checking will be done. For example, if the logic determines that the class should be "Instagram", it will not check for "Continuity" or "One-Shot".
 * 
 * Criteria                                             Class to be Set
 * If customer has a class assigned                     Customer Class
 * If Shopify Order Notes contains "Instagram"          Venues : Entry/One-Shot : Entry: Social Media - Facebook, Twitter, etc : Instagram
 * If Order was dropped from recharge                   Venues : Continuity
 *   (etail Channel = "Shopify" and 
 *   Shopify Order Source = "subscription_contract")
 * If this came from Shopify                            Venues : Entry/One-Shot
 *   (eTail channel = "Shopify")
 * 
 * A few important notes:
 *   - Based on the logic above, the header level class and the class on all lines will be set to the same value. This is because all fields used to determine the correct class are set on the Order header as opposed to the order line
 *   - Shipping and Discount lines will be set with the same class as the rest of the order.
 * 
 * 
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */

// Register the beforeSubmit function
define(['N/record', 'N/runtime', 'N/search'], function (record, runtime, search) {

    function beforeSubmitSetClass(scriptContext) {
        try {

            if (scriptContext.type === scriptContext.UserEventType.CREATE 
                || scriptContext.type === scriptContext.UserEventType.EDIT
                || scriptContext.type === scriptContext.UserEventType.XEDIT) {

                var salesOrderId = scriptContext.newRecord.id;
                // Load the Sales Order record 
                var newRecord = record.load({ type: record.Type.SALES_ORDER, id: salesOrderId });
        
                var continuityClass = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_continuity'});
                var instagramClass = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_insta'});
                var entryClass = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_entry'});
                var shopifyChannel = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_chan'});
                var corporateLocation = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_corp_loc'});
        
                //var newRecord = scriptContext.newRecord;
                log.debug("enter after submit",newRecord.getValue({ fieldId: 'id'}));
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

                log.debug('etailChannel: ', etailChannel);
                log.debug('shpifyOrderNotes: ', shopifyOrderNotes);
                
                var classValue = '';

                //var custFlag = false;
                //var instagramFlag = false;
                //var continuityFlag = false;
                //var entryFlag = false;

                // get the location from the header, this will be used for defaulting.
                 var locationHeaderId = newRecord.getValue({ fieldId: 'location'});
                 log.debug("location",locationHeaderId);

                // load customer class if it exists
                var customerId = newRecord.getValue({ fieldId: 'entity'});
                var custClassId = null;
                if (customerId) {
                    log.debug("Customer",customerId);
                    var custClass = search.lookupFields({
                        type: search.Type.CUSTOMER,
                        id: customerId,
                        columns: ['custentityjlo_customer_class']
                    });
                    log.debug("customerClass",custClass);
        
                    // only if a class has been assigned at the customer level
                    if (custClass.custentityjlo_customer_class[0]) {
                        custClassId = custClass.custentityjlo_customer_class[0].value;
                        log.debug("Customer Class",custClass.custentityjlo_customer_class[0].value);     
                    }   
                } else {
                    log.debug("Customer","Skip Customer Check");
                }

                // determine the correct class to use based on the transaction header attributes
                //if there is a customer class, use it first
                if (custClassId) {
                    log.debug("customer class");
                    classValue = custClassId;
                    // custFlag = true;
                
                // next, check for instagram. if instagram use it
                } else if(shopifyOrderNotes != null && shopifyOrderNotes.indexOf("Instagram") >= 0) {
                    log.debug("instagram class");
                    classValue = instagramClass;
                    //instagramFlag = true;

                // next check for subcription: if eTail Channel = Shopify, and Shopify Order Source = 'subscription_contract'
                } else if (etailChannel != null && etailChannel.toString() === shopifyChannel 
                        && shopifyOrderSource != null && shopifyOrderSource === 'subscription_contract') {
                    log.debug("continuity class");
                    classValue = continuityClass;
                    //continuityFlag = true;

                // otherwise if this is from the shopify channel, make the line Entry
                } else if (etailChannel != null && etailChannel.toString() === shopifyChannel) {
                    log.debug("entry class");
                    //entryFlag = true;
                    classValue = entryClass;
                }
                log.debug('classValue: ', classValue);

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
                    // if (!locationLine) {
                    //     if (orderLineId) {
                    //         newRecord.setSublistValue({
                    //             sublistId: 'item',
                    //             fieldId: 'location',
                    //             value: locationHeaderId,
                    //             ignoreFieldChange: true,
                    //             line: i
                    //         });
                    //     } else {
                    //         newRecord.setSublistValue({
                    //             sublistId: 'item',
                    //             fieldId: 'location',
                    //             value: corporateLocation,
                    //             ignoreFieldChange: true,
                    //             line: i
                    //         });
                    //     }
                    // }
                    


                    // if class is not set, then set it
                    // var lineClass = newRecord.getSublistValue({
                    //     sublistId: 'item',
                    //     fieldId: 'class',
                    //     line: i
                    // });

                    // // this custom field is set on the line level for any lines 
                    // // that are actual items. If it is not set, then it is something like 
                    // // shopify discount line, shopify shipping cost
                    // var orderLineId = newRecord.getSublistValue({
                    //     sublistId: 'item',
                    //     fieldId: 'custcol_celigo_etail_order_line_id',
                    //     line: i
                    // });
                    log.debug("before class set",newRecord.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'class',
                        line: i
                    }));

                    //if (!lineClass && orderLineId != null) {
                        // Set the Class value for the line
                        newRecord.setSublistValue({
                            sublistId: 'item',
                            fieldId: 'class',
                            line: i,
                            value: classValue,
                            ignoreFieldChange: true
                        });

                    log.debug("after class set",newRecord.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'class',
                            line: i
                        }));
                    //}

                }

                // determine the class to set at the header level
                // If the customer had a class, use it
                // else if the order is from instagram, use it
                // else if there was a continuity order use it
                // otherwise, if entry level was set use it
                // var headerClass = null;
                // if (custFlag) {
                //     headerClass = custClassId;
                // } else if (instagramFlag) {
                //     headerClass = instagramClass;
                // } else if (continuityFlag) {
                //     headerClass = continuityClass;
                // } else if (entryFlag) {
                //     headerClass = entryClass;
                // } 
                
                newRecord.setValue({
                    fieldId: 'class',
                    value: classValue
                });

                // loop through the item lines a second time, setting any fields
                // where the custcol_celigo_etail_order_line_id field is not set
                // to the class derived for the header
                // for (var i = 0; i < lineCount; i++) {
    
                //     // this custom field is set on the line level for any lines 
                //     // that are actual items. If it is not set, then it is something like 
                //     // shopify discount line, shopify shipping cost
                //     var orderLineId = newRecord.getSublistValue({
                //         sublistId: 'item',
                //         fieldId: 'custcol_celigo_etail_order_line_id',
                //         line: i
                //     });                    

                //     if (!orderLineId) {
                //         log.debug('order line is null', classValue);
                //         // Set the Class value for the line
                //         newRecord.setSublistValue({
                //             sublistId: 'item',
                //             fieldId: 'class',
                //             line: i,
                //             value: headerClass
                //         });
                //     }
                // }
            }
            var savedOrderId = newRecord.save();
        } catch (e) {
            log.error(scriptContext.newRecord.getValue({ fieldId: 'id'}),e + ":" + e.message);
        }
    }

    
    return {
        afterSubmit: beforeSubmitSetClass
    };
});
