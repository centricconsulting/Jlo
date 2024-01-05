/**
 *@NApiVersion 2.1
 *@NScriptType UserEventScript
/= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * Purpose:  
 * VER  DATE            AUTHOR               	 	 CHANGES
 * 1.0  November 6, 2023   Centric Consulting(Pradeep)     Initial Version
 * 
 * This should only be needed to update historical records, new IFs should pick up 
 * these values from the sales order.
 * 
 * Also note: none of the Shopify items (Shopify Line Discount, etc) come through to the IF, since they 
 * are not fulfilled. Location is also set so that the items can be picked/shipped.
 * 
 * Class is also not available at the header level on an IF.
 * 
 * Based on the above points, we only need to set class at the line level for fulfilled items.
 * 
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */



define(['N/record','N/search', 'N/query', 'N/runtime'], function (record, search, query, runtime) {

    function afterSubmitSetClass(scriptContext) {
        try {
            log.debug("enter before submit",scriptContext.type);
            var continuityClass = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_continuity2'});
            var instagramClass = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_insta2'});
            var entryClass = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_entry2'});
            var shopifyChannel = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_channel'});
            var corporateLocation = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_corp_loc3'});

            var custFlag = false;
            var instagramFlag = false;
            var continuityFlag = false;
            var entryFlag = false;

            // only run for EDIT and In Line Edit (XEDIT - MASS UPDATE), create should default from the
            // Sales Order
            if (scriptContext.type === scriptContext.UserEventType.EDIT ||
                scriptContext.type === scriptContext.UserEventType.XEDIT ) {
               // var newRecordContext = scriptContext.newRecord;

                var newRecord = record.load({
                    type: record.Type.ITEM_FULFILLMENT,
                    id: scriptContext.newRecord.id,
                    isDynamic: false
                });
                //log.debug("new rec",newRecord);

                var customerId = newRecord.getValue({ fieldId: 'entity'});
                log.debug("Customer",customerId);
                var custClass = search.lookupFields({
                    type: search.Type.CUSTOMER,
                    id: customerId,
                    columns: ['custentityjlo_customer_class']
                });
                log.debug("customerClass",custClass);
    
                // only if a class has been assigned at the customer level
                if (custClass.custentityjlo_customer_class[0]) {
                    var custClassId = custClass.custentityjlo_customer_class[0].value;
                    log.debug("Customer Class",custClass.custentityjlo_customer_class[0].value);
                }
                    
                // load fields from the sales order
                var suiteQL = `
                        select 
                        iftl.transaction, 
                        iftl.id ifid,  
                        sotl.transaction,  
                        sotl.id soid, 
                        sotl.custcolcustcol_shpfy_num_instlmts, 
                        sot.custbody_celigo_etail_channel, 
                        sot.custbody_cen_shpfy_ordr_nts,
                        sot.custbodycustbody_shpfy_order_src
                    from PreviousTransactionLineLink ptll
                        ,transactionline iftl
                        ,transactionline sotl
                        ,transaction sot
                    where 
                        iftl.transaction = ?
                        and iftl.transaction = ptll.nextdoc
                        and iftl.id = ptll.nextline
                        and sotl.transaction = ptll.previousdoc
                        and sotl.id = ptll.previousline
                        and sotl.transaction = sot.id
                `; 

                var results = query.runSuiteQL({
                    query: suiteQL,
                    params: [newRecord.id]
                });
                log.debug('results',results);

                var resultMap = new Map();

                // check to make sure we returned rows
                if (results.results.length > 0) {
                    
                    // process the results into a hashmap based on the line
                    for (var i = 0; i < results.results.length; i++ ) {
                        // key is the IF line id
                        //log.debug(typeof results.results[i].values[1]);
                        resultMap.set(results.results[i].values[1].toString(), {  // IF line id
                            custcolcustcol_shpfy_num_instlmts:  results.results[i].values[4],
                            custbody_celigo_etail_channel: results.results[i].values[5],
                            custbody_cen_shpfy_ordr_nts: results.results[i].values[6],
                            custbodycustbody_shpfy_order_src : results.results[i].values[7]
                        });
                    }                        
                } else {
                    throw new Error ("Results not found for transaction: " + newRecord.id);
                }

                // process the lines
                var lineCount = newRecord.getLineCount({ sublistId: 'item' });
                for (var i = 0; i < lineCount; i++) {
                    
                    // this custom field is set on the line level for any lines 
                    // that are actual items. If it is not set, then it is something like 
                    // shopify discount line, shopify shipping cost
                    var orderLineId = newRecord.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_celigo_etail_order_line_id',
                        line: i
                    });

                    var lineId = newRecord.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'line',
                        line: i
                    });
                    log.debug("lineid",lineId);

                    // get corresponding result based on line id
                    var result = resultMap.get(lineId);
                    log.debug("result",result != null);

                    // cogs lines will not be in the result map - skip any cogs lines
                    if (result != null) {
                        var subscriptionFlag = 'N';
                        log.debug("num installments",result.custcolcustcol_shpfy_num_instlmts);
                        if (result != null && result.custcolcustcol_shpfy_num_instlmts
                            && result.custcolcustcol_shpfy_num_instlmts != '') {
                            subscriptionFlag = 'Y';
                        };
                        var etailChannel = result.custbody_celigo_etail_channel;
                        var shopifyOrderNotes = result.custbody_cen_shpfy_ordr_nts;
                        var shopifyOrderSource = result.custbodycustbody_shpfy_order_src;

                        log.debug("test values",i + ":" + subscriptionFlag + ":" + etailChannel + ":" + shopifyOrderNotes);
                        log.debug("test sub",subscriptionFlag === 'Y');
                            
                        // logic once we get subscription figured out
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
    
                        
                        var lineClass = newRecord.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'class',
                            line: i
                        });

                        log.debug("line class",lineClass);
                        

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
                }
                
                newRecord.save();
            }

        } catch (e) {
            log.error(e,e.message);
        }
 
    }

    // Register the beforeSubmit function
    return {
        afterSubmit: afterSubmitSetClass
    };
});
