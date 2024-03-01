/**
 * @NApiVersion 2.x
 * @NScriptType MapReduceScript
/= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * Purpose: This script is used to create invoice for digital payment and installment automation. 
 * VER  DATE           AUTHOR               		CHANGES
 * 1.0  Jan 30, 2024   Centric Consulting(Pradeep)   	Initial Version
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */

define(['N/search', 'N/record', 'N/runtime', 'N/email', 'N/url'], function (search, record, runtime, email, url) {
    function getInputData() {
        var salesorderSearchObj = search.create({
            type: "salesorder",
            filters:
                [
                    ["type", "anyof", "SalesOrd"], "AND",
                    ["mainline", "is", "T"], "AND",
                    ["status", "anyof", "SalesOrd:F"], "AND",
                    [["custbody_cen_jlo_digital_pmt_ord", "is", "T"], "OR", ["custbody_cen_jlo_instal_ord", "is", "T"]]
                    //, "AND", ["internalid", "anyof", "51421", "51422", "51423"] // for testing only
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

        // Step 1 where Shopify Order Variances and INS001 item get closed 
        if (installment_Order || dig_Pay_Order) {
            SO_Update(so_Int_Id);
            log.debug("SO Update", "Step 1 SO: " + so_Int_Id);
        }

        // Step 2 Transform SO to Invoice
        Inv_Int_Id = TransformInvoice(so_Int_Id);
        log.debug("Invoice", "Step 2 Invoice: " + Inv_Int_Id);

        // if invoice have digital payment true
        if (dig_Pay_Order && so_Int_Id) {

            Cust_Dep_Int_Id = FindCustDeposit(so_Int_Id); // Found customer deposit
            var Shopify_Order_Id = ShopifyOrderID(so_Int_Id); // Shopify original order ID 
            var Original_Invoice = OriginalInvoiceID(Shopify_Order_Id); // Found open invoice with by shopify original order id

            if (Cust_Dep_Int_Id && Original_Invoice) {
                // apply open deposit to the open invoice
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
                    if (openInvoice == Original_Invoice) {
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

        // get the person to send the summary email to
        var summaryEmail = runtime.getCurrentScript().getParameter({ name: 'custscript_send_employee' });
        //log.debug("summary email", summaryEmail);

        // process anything found in the context
        var list = '';
        context.output.iterator().each(function (key, value) {
            var values = JSON.parse(value);
            //log.debug("Summarize values:", values);
            //log.debug("Summarize result:", values.result);

            var link = url.resolveRecord({
                recordType: 'salesorder',
                recordId: key,
                isEditMode: false
            });
            list += '<a href=' + link + '>' + key + '</a><br>'
            return true;
        });

        // add anything in the map error context
        var mapList = '';
        context.mapSummary.errors.iterator().each(function (key, value) {
            var values = JSON.parse(value);

            var link = url.resolveRecord({
                recordType: 'salesorder',
                recordId: key,
                isEditMode: false
            });
            //log.debug("values", values);
            mapList += '<a href=' + link + '>' + key + '</a>: ' + values.message + '<br>'
            return true;
        });

        var bodyText = 'Installment invoice automation: <br>' + list
            + '<br>Sales Orders that had errors:<br>' + mapList;

        email.send({
            author: summaryEmail,
            recipients: summaryEmail,
            subject: 'Installment Invoice Automation',
            body: bodyText
        });
    }

    function SO_Update(so_Int_Id) {
        var installment_Order_item = runtime.getCurrentScript().getParameter({ name: 'custscript_installment_order_item' });
        var dig_Pay_Order_item = runtime.getCurrentScript().getParameter({ name: 'custscript_digital_payment_item' });

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

    function TransformInvoice(so_Int_Id) {
        var InvoiceRecord = record.transform({
            fromType: record.Type.SALES_ORDER,
            fromId: so_Int_Id,
            toType: record.Type.INVOICE,
            isDynamic: true,
        });

        var soRecord = record.load({ type: record.Type.SALES_ORDER, id: so_Int_Id, isDynamic: false, });
        var Discount_Item = soRecord.getValue({ fieldId: 'discountitem' });
        var Discount_Rate = soRecord.getValue({ fieldId: 'discountrate' });

        InvoiceRecord.setValue({ fieldId: 'discountitem', value: Discount_Item });
        InvoiceRecord.setValue({ fieldId: 'discountrate', value: Discount_Rate });

        var Inv_Int_Id = InvoiceRecord.save({ enableSourcing: true, ignoreMandatoryFields: true });
        return Inv_Int_Id;
    }

    function FindCustDeposit(so_Int_Id) {
        var Cust_Dep_Int_Id;
        var custdepositSearchObj = search.create({
            type: "customerdeposit",
            filters:
                [
                    ["type", "anyof", "CustDep"],
                    "AND", ["mainline", "is", "T"],
                    "AND", ["status", "anyof", "CustDep:B"],
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

    function ShopifyOrderID(so_Int_Id) {
        var salesorderSearchObj = search.create({
            type: "salesorder",
            filters:
                [
                    ["type", "anyof", "SalesOrd"], "AND",
                    ["mainline", "is", "F"], "AND",
                    ["internalid", "anyof", so_Int_Id]
                ],
            columns:
                [
                    "internalid", "custcolcustcol_shpfy_orgnl_order"
                ]
        });
        var Shopify_Order_Id;
        salesorderSearchObj.run().each(function (result) {
            var Shopify_Order = result.getValue({ name: "custcolcustcol_shpfy_orgnl_order" });
            if (Shopify_Order)
                Shopify_Order_Id = Shopify_Order;
            return true;
        });
        return Shopify_Order_Id;
    }

    function OriginalInvoiceID(Shopify_Order_Id) {
        var transactionSearchObj = search.create({
            type: "transaction",
            filters:
                [
                    ["type", "anyof", "CustInvc"], "AND",
                    ["mainline", "is", "T"], "AND",
                    ["status", "anyof", "CustInvc:A"], "AND",
                    ["custbody_celigo_etail_order_id", "startswith", Shopify_Order_Id]
                ],
            columns:
                [
                    "internalid", "custbody_celigo_etail_order_id"
                ]
        });
        var Original_Invoice;
        transactionSearchObj.run().each(function (result) {
            Original_Invoice = result.getValue({ name: "internalid" });
            return true;
        });
        return Original_Invoice;
    }

    return {
        getInputData: getInputData,
        map: map,
        summarize: summarize
    };
});