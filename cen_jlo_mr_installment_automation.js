/**
 * @NApiVersion 2.x
 * @NScriptType MapReduceScript
/= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * Purpose: 
 * VER  DATE           AUTHOR               		CHANGES
 * 1.0  Jan 30, 2024   Centric Consulting(Pradeep)   	Initial Version
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */

define(['N/search', 'N/record', 'N/runtime'], function (search, record, runtime) {
        function getInputData() {
            var salesorderSearchObj = search.create({
                type: "salesorder",
                filters:
                    [
                        ["type", "anyof", "SalesOrd"], "AND",
                        ["mainline", "is", "T"], "AND",
                        ["status", "anyof", "SalesOrd:F"], "AND",
                        [["custbody_cen_jlo_digital_pmt_ord", "is", "T"], "OR", ["custbody_cen_jlo_instal_ord", "is", "T"]]
                        , "AND", ["internalid", "anyof", "49873"] // for testing only
                    ],
                columns:
                    [
                        "internalid", "tranid", "custbody_cen_jlo_instal_ord", "custbody_cen_jlo_digital_pmt_ord", "statusref", "memomain"
                    ]
            });
            return salesorderSearchObj;
        }
        function map(context) {
            var jsonobj = JSON.parse(context.value);
            //log.debug("Json : ", jsonobj);
            var so_Int_Id = jsonobj["values"]["internalid"]["value"];
            var installment_Order = jsonobj["values"]["custbody_cen_jlo_instal_ord"];
            var dig_Pay_Order = jsonobj["values"]["custbody_cen_jlo_digital_pmt_ord"];
            log.debug("Start >>", "so_Int_Id: " + so_Int_Id + ", installment_Order: " + installment_Order +
                ", dig_Pay_Order: " + dig_Pay_Order);

            var Inv_Int_Id;
            var Cust_Dep_Int_Id;

            // // Step 1 where Shopify Order Variances and INS001 item get closed 
            if (installment_Order || dig_Pay_Order) {
                SO_Update(so_Int_Id);
                log.debug("SO Update", "Step 1 SO: " + so_Int_Id);
            }

            // Step 2 find customer deposit of sales order
            Cust_Dep_Int_Id = CustDeposit(so_Int_Id);
            log.debug("Cust Dep", "Step 2 Deposit: " + Cust_Dep_Int_Id);

            // Step 3 Transform SO to Invoice
            Inv_Int_Id = TransformInvoice(so_Int_Id);
            log.debug("Invoice", "Step 3 Invoice: " + Cust_Dep_Int_Id);

            // Step 4 apply invoice to customer deposit
            if (Inv_Int_Id && Cust_Dep_Int_Id) {
                // apply deposit to the new invoice
                var createRecord = record.transform({
                    fromType: record.Type.CUSTOMER_DEPOSIT,
                    fromId: Cust_Dep_Int_Id,
                    toType: record.Type.DEPOSIT_APPLICATION,
                    isDynamic: true
                });
                var numLines = createRecord.getLineCount({ sublistId: 'apply' });
                for (var i = 0; i < numLines; i++) {
                    // look for invoice in deposit application
                    var openInvoice = createRecord.getSublistValue({ sublistId: 'apply', fieldId: 'internalid', line: i });
                    if (openInvoice == Inv_Int_Id) {
                        // Applying customer deposit to invoice
                        createRecord.selectLine({ sublistId: "apply", line: i });
                        createRecord.setCurrentSublistValue({ sublistId: 'apply', fieldId: 'apply', value: true });
                        //createRecord.setCurrentSublistValue({ sublistId: 'apply', fieldId: 'amount', value: parsedValue.deposit_balance });
                    }
                }

                // Save the deposit record with applied payments
                var Dep_App_Int_Id = createRecord.save({ enableSourcing: true, ignoreMandatoryFields: true });
                log.debug("Final Step : ", "Deposit Application: " + Dep_App_Int_Id);
            }
        }
        function summarize(context) {
            context.mapSummary.errors.iterator().each(
                function (key, error, executionNo) {
                    log.error({
                        title: 'Map error for key: ' + key + ', execution no.  ' + executionNo,
                        details: error
                    });
                    return true;
                }
            );
        }

        function SO_Update(so_Int_Id) {
            var installment_Order_item = runtime.getCurrentScript().getParameter({name: 'custscript_installment_order_item'});
            var dig_Pay_Order_item = runtime.getCurrentScript().getParameter({name: 'custscript_digital_payment_item'});
    
            // load Sales order
            var SO_Record = record.load({
                type: record.Type.SALES_ORDER,
                id: so_Int_Id,
                isDynamic: false,
            });
    
            var line_count = SO_Record.getLineCount({ sublistId: 'item' });
            for (var i = 0; i < line_count; i++) {
                var item = SO_Record.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
    
                if (item == installment_Order_item || item == dig_Pay_Order_item) {
                    var isClosed = SO_Record.getSublistValue({ sublistId: 'item', fieldId: 'isclosed', line: i });
                    if (!isClosed)
                        SO_Record.setSublistValue({ sublistId: 'item', fieldId: 'isclosed', line: i, value: true });
                }
            }
            SO_Record.save({ enableSourcing: true, ignoreMandatoryFields: true });
        }
    
        function CustDeposit(so_Int_Id) {
            var Cust_Dep_Int_Id;
            var custdepositSearchObj = search.create({
                type: "customerdeposit",
                filters:
                    [
                        ["type", "anyof", "CustDep"],
                        "AND", ["mainline", "is", "T"],
                        "AND", ["createdfrom.internalid", "anyof", so_Int_Id]
                    ],
                columns:
                    [
                        "internalid", "tranid", "amount"
                    ]
            });
            custdepositSearchObj.run().each(function (result) {
                Cust_Dep_Int_Id = result.getValue({ name: "internalid" });
                return true
            });
            return Cust_Dep_Int_Id;
        }
        
        function TransformInvoice(so_Int_Id) {
            var InvoiceRecord = record.transform({
                fromType: record.Type.SALES_ORDER,
                fromId: so_Int_Id,
                toType: record.Type.INVOICE,
                isDynamic: false,
            });
            var Inv_Int_Id = InvoiceRecord.save({ enableSourcing: true, ignoreMandatoryFields: true });
            return Inv_Int_Id;
        }

        return {
            getInputData: getInputData,
            map: map,
            summarize: summarize
        };
    });