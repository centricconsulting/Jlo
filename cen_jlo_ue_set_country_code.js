/**
 *@NApiVersion 2.x
 *@NScriptType UserEventScript

 /= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * Purpose: This Script is use to update order id of shofipy on sales order and invoice.
 * VER  DATE           AUTHOR               		      CHANGES
 * 1.0  Sep 29, 2023   Centric Consulting(Aman)           Initial Version
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */

define(['N/record', 'N/search'], function (record, search) {

    function beforeSubmit(context) {
        log.debug("cen_jlo_ue_set_country_code","start");
        try {
            var newRecord = context.newRecord;
            var tranID = newRecord.id;
            var tranType = newRecord.type;
        //    var eTailOrderID = newRecord.getValue({ fieldId: 'custbody_celigo_etail_order_id'});
            var shippingaddress = newRecord.getValue({ fieldId: 'shippingaddress'});
            var shipRec = newRecord.getSubrecord({ fieldId: 'shippingaddress'});
            

            log.debug("shippingaddress",shippingaddress);
            log.debug('country',shipRec.getValue({ fieldId: 'country'}));
            //log.debug("shippingaddress",newRecord.getValue({ fieldId: 'shipto'}));
            // var countryCode = search.lookupFields({‌
            //     type: search.Type.CUSTOMER,
            //     id: customer_id,
            //     columns: cust_fields
            //    });
            if (shipRec) {
                newRecord.setValue({ fieldId: 'custbody_ocx_country_code', value: shipRec.getValue({ fieldId: 'country'}) });
            }
            
        
        } catch (e) {
            log.debug("Error", "ID: " + tranID + ", Rec Type: " + tranType + ", error: " + e);
        }
    }
    return {
        beforeSubmit: beforeSubmit
    }

});


