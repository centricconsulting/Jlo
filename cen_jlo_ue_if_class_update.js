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
            
            // only run for EDIT and In Line Edit (XEDIT - MASS UPDATE), create should default from the
            // Sales Order
            if (scriptContext.type === scriptContext.UserEventType.EDIT ||
                scriptContext.type === scriptContext.UserEventType.XEDIT ) {
            
                var newRecord = record.load({
                    type: record.Type.ITEM_FULFILLMENT,
                    id: scriptContext.newRecord.id,
                    isDynamic: false
                });
                log.debug("new rec",newRecord);

                var customerId = newRecord.getValue({ fieldId: 'entity'});
                log.debug("Customer",customerId);

                if (customerId) {

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
                        select distinct
                        iftl.transaction if_tran_id, 
                        sotl.transaction so_tran_id,  
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

                    // check to make sure we returned rows
                    if (results.results.length == 0) {
                        throw new Error ("Results not found for transaction: " + newRecord.id);
                    }

                    var classValue = '';
                    var etailChannel = results.results[0].values[2];
                    var shopifyOrderNotes = results.results[0].values[3];
                    var shopifyOrderSource = results.results[0].values[4];

                    log.debug('etailChannel: ', etailChannel);
                    log.debug('shpifyOrderNotes: ', shopifyOrderNotes);

                    // determine the correct class to use based on the sales order transaction header attributes
                    //if there is a customer class, use it first
                    if (custClassId) {
                        log.debug("customer class");
                        classValue = custClassId;
                        
                    // next, check for instagram. if instagram use it
                    } else if(shopifyOrderNotes != null && shopifyOrderNotes.indexOf("Instagram") >= 0) {
                        log.debug("instagram class");
                        classValue = instagramClass;
                        
                    // next check for subcription: if eTail Channel = Shopify, and Shopify Order Source = 'subscription_contract'
                    } else if (etailChannel != null && etailChannel.toString() === shopifyChannel 
                            && shopifyOrderSource != null && shopifyOrderSource === 'subscription_contract') {
                        log.debug("continuity class");
                        classValue = continuityClass;
                        
                    // otherwise if this is from the shopify channel, make the line Entry
                    } else if (etailChannel != null && etailChannel.toString() === shopifyChannel) {
                        log.debug("entry class");
                        classValue = entryClass;
                    }
                    log.debug('classValue: ', classValue);

                    // process the lines
                    var lineCount = newRecord.getLineCount({ sublistId: 'item' });
                    for (var i = 0; i < lineCount; i++) {
                        
                        newRecord.setSublistValue({
                            sublistId: 'item',
                            fieldId: 'class',
                            line: i,
                            value: classValue
                        });
                    }
                    
                    newRecord.save();
                }
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
