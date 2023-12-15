/**
 *@NApiVersion 2.1
 *@NScriptType UserEventScript
/= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * Purpose:  Cycle count approval process automation
 * VER  DATE            AUTHOR               	 	 CHANGES
 * 1.0  November 6, 2023   Centric Consulting(Pradeep)     Initial Version
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */



define(['N/record','N/search', 'N/query', 'N/runtime'], function (record, search, query, runtime) {

    function afterSubmitSetClass(scriptContext) {
        try {
            log.debug("enter before submit",scriptContext.type);
            var continuityClass = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_continuity2'});
            var instagramClass = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_insta2'});
            var entryClass = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_entry2'});
            var shopifyChannel = runtime.getCurrentScript().getParameter({name: 'custscript_cen_jlo_channel'});

            //var continuityClass = 106;
            //var instagramClass = 134;
            //var entryClass = 130;
            //var shopifyChannel = 1 + "";

            //scriptContext.type === scriptContext.UserEventType.CREATE 
            // only run for EDIT and In Line Edit (XEDIT - MASS UPDATE)
            if (scriptContext.type === scriptContext.UserEventType.EDIT ||
                scriptContext.type === scriptContext.UserEventType.XEDIT ) {
                var newRecord = scriptContext.newRecord;

                var newRecord = record.load({
                    type: record.Type.ITEM_FULFILLMENT,
                    id: scriptContext.newRecord.id,
                    isDynamic: false
                });
                //log.debug("new rec",newRecord);

                // temporary for now. If the IF is before Nov 26, 2023, then do not set the class
                var targetDate = new Date(2023,10,26);
                var tranDate = newRecord.getValue({ fieldId: 'trandate'});
                log.debug("tranDate",tranDate + ":" + typeof tranDate);
                log.debug("targetDate",targetDate);
                if (tranDate > targetDate) {
                    log.debug("date after target date");
                    return;
                }
    
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
                    
        
                    var lineCount = newRecord.getLineCount({ sublistId: 'item' });
           
                    for (var i = 0; i < lineCount; i++) {
        
                        log.debug('i: ', i);
                        var lineClass = newRecord.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'class',
                            line: i
                        });
                        log.debug("line class",lineClass);

                        // only set the class if it is not set - meaning it 
                        // was defaulted in from the sales order or set manually
                        if (!lineClass) {
                            log.debug("line class empty");
        
                            // Set the Class value for the line
                            newRecord.setSublistValue({
                                sublistId: 'item',
                                fieldId: 'class',
                                line: i,
                                value: custClassId
                            });
                        }
                    }
                } else { // this is not a B2B customer, so run the instagram/shopify checks
                    
                    var suiteQL = `
                            select 
                            iftl.transaction, 
                            iftl.id ifid,  
                            sotl.transaction,  
                            sotl.id soid, 
                            sotl.custcolcustcol_shpfy_num_instlmts, 
                            sot.custbody_celigo_etail_channel, 
                            sot.custbody_cen_shpfy_ordr_nts
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
                                custbody_cen_shpfy_ordr_nts: results.results[i].values[6]
                            });
                        }                        
                    }

                    var lineCount = newRecord.getLineCount({ sublistId: 'item' });
                    for (var i = 0; i < lineCount; i++) {
                        //log.debug('i: ', i);

                        var lineId = newRecord.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'line',
                            line: i
                        });
                        //log.debug("lineid",typeof lineId);

                        // get corresponding result based on line id
                        var result = resultMap.get(lineId);
                        //log.debug("result",result);

                        var subscriptionFlag = 'N';
                        if (result.custcolcustcol_shpfy_num_instlmts) {
                            subscriptionFlag = 'Y';
                        };
                        var etailChannel = result.custbody_celigo_etail_channel;
                        var shopifyOrderNotes = result.custbody_cen_shpfy_ordr_nts;

                        log.debug("test values",i + ":" + subscriptionFlag + ":" + etailChannel + ":" + shopifyOrderNotes);
                        log.debug("test sub",subscriptionFlag === 'Y');
                        //log.debug("test etail",etailChannel.toString() === shopifyChannel);
                        //log.debug("test shop",typeof shopifyChannel);
                        //log.debug("test et2",typeof etailChannel);

                        var classValue = null;

                        // simple logic for Nov clode
                        if (etailChannel && etailChannel.toString() === shopifyChannel
                            && shopifyOrderNotes != null && shopifyOrderNotes.indexOf("Instagram") >= 0) {
                            //classValue = '134'; // Instagram
                            log.debug("instagram");
                            classValue = instagramClass;
                    
                        } else if (etailChannel && etailChannel.toString() === shopifyChannel) {
                            //classValue = '130'; // Entry/One-Shot
                            log.debug("entry");
                            classValue = entryClass;
                        }
                        log.debug("classValue",classValue);

                        // logic once we get subscription figured out
/*
                        // If subscriptionFlag = Y, eTail Channel = Shopify, and Order Notes Contains Instagram
                        if (subscriptionFlag === 'Y' && etailChannel && etailChannel.toString() === shopifyChannel
                            && shopifyOrderNotes != null && shopifyOrderNotes.indexOf("Instagram") >= 0) {
                            //classValue = '134'; // Instagram
                            classValue = instagramClass;
                    
                        // If subscriptionFlag = Y, eTail Channel = Shopify, and Order Notes does not contain Instagram
                        } else if (subscriptionFlag === 'Y' && etailChannel && etailChannel.toString() === shopifyChannel) {
                            //classValue = '106'; // Continuity
                            classValue = continuityClass;

                        // If subscriptionFlag = N, eTail Channel = Shopify, and Order Notes contains Instagram    
                        } else if ((subscriptionFlag === 'N' || !subscriptionFlag) && etailChannel && etailChannel.toString() === shopifyChannel
                            && shopifyOrderNotes != null && shopifyOrderNotes.indexOf("Instagram") >= 0) {            
                            //classValue = '134'; // Instagram
                            classValue = instagramClass;
                    
                        // If subscriptionFlag = N, eTail Channel = Shopify, and Order Notes does not contain Instagram
                        } else if ((subscriptionFlag === 'N' || !subscriptionFlag) && etailChannel && etailChannel.toString() === shopifyChannel) {
                            //classValue = '130'; // Entry/One-Shot
                            classValue = entryClass;
                        }
                        */

                        var lineClass = newRecord.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'class',
                            line: i
                        });

                        log.debug("line class",lineClass);
                        
                        // only set the class if it is not set - meaning it 
                        // was defaulted in from the sales order or set manually
                        if (!lineClass) {
                            log.debug("line class empty");
        
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
