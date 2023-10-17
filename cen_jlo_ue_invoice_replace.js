/**
 *@NApiVersion 2.x
 *@NScriptType UserEventScript
/= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * VER  DATE           AUTHOR               		CHANGES
 * 1.0  Aug 7, 2023   Centric Consulting(Aman)   	Initial Version
 * 
 * This script is needed to ensure proper accounting for replacement orders. A 
 * replacement order from Shopify will be indicated on the Celigo Shopify Discount Code
 * field with a text value of "replacement" (note this will need to be case in-sensitive).
 * 
 * When this value is present, replace the discount item with the discount item passed
 * in as a parameter. Also, set the checkbox "Replacement Item". 
 * 
 * If the value is not present, then unset the checkbox "Replacement Item" and leave the 
 * existing discount item alone.
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */

define(['N/record', 'N/runtime'], function (record, runtime) {
    function beforeSubmit(context) {
        var currentRecord = context.newRecord;
        var invID = currentRecord.getValue({ fieldId: 'id' });
        log.debug("Invoice ID: ", invID);

        // get the replacement discount item from a parameter
        var repDiscountItem = runtime.getCurrentScript().getParameter({name: 'custscript_jlo_replacement_discount_item'})
        log.debug("discountItem",repDiscountItem);
                
        //check to see if the invoice has a shopify discount code
        var shopDiscountCode = currentRecord.getValue({ fieldId: 'custbody_celigo_shopify_discountcode' });
        var discountItem = currentRecord.getValue({ fieldId: 'discountitem' });
        
        log.debug("Shop Discount Code", shopDiscountCode.toUpperCase());
        log.debug("type",typeof shopDiscountCode);

        // if there is an existing discount item and the  shopify discount code 
        // contains 'replacement', then set the discount item to Shopify Replacement Item
        if (discountItem && shopDiscountCode && shopDiscountCode.toUpperCase().indexOf("REPLACEMENT") != -1) {
            log.debug("Found replacement discount code");

            // get the rate to reapply
            var discountRate = currentRecord.getValue({ fieldId: 'discountrate' });

            // set discountitem to 'Shopify Replacement Discount'
            //currentRecord.setValue({ fieldId: 'discountitem', value: 21799});
            log.debug("set item & rate",repDiscountItem +":" + discountRate);
            currentRecord.setValue({ fieldId: 'discountitem', value: repDiscountItem });
            currentRecord.setValue({ fieldId: 'discountrate', value: discountRate });
            currentRecord.setValue({ fieldId: 'custbody_replacement_order', value: true });
        }
        else {
            currentRecord.setValue({ fieldId: 'custbody_replacement_order', value: false });
        }
    }


    return {
        beforeSubmit: beforeSubmit
    };
});
