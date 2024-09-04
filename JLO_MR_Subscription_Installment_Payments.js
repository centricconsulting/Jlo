/**
 * @NApiVersion 2.x
 * @NScriptType MapReduceScript
 */
define(['N/runtime', 'N/record', 'N/search', 'N/log', 'N/email', 'N/url'], function (runtime, record, search, log, email, url) {

    function getInputData() {

        var dateParameter = runtime.getCurrentScript().getParameter('custscript_transaction_date');
        dateParameter = formatISODateToMMDDYYYY(dateParameter.toString())
        log.debug('dateParameter', dateParameter);


        //Define the search to get invoice IDs
        var salesorderSearchObj = search.create({
            type: "salesorder",
            settings: [{ "name": "consolidationtype", "value": "ACCTTYPE" }, { "name": "includeperiodendtransactions", "value": "F" }],
            filters:
                [
                    ["mainline", "is", "T"],
                    "AND",
                    ["type", "anyof", "SalesOrd"],
                    "AND",
                    ["customermain.isperson", "is", "T"],
                    "AND",
                    // removed for Ron testing - need to add back
                    //["datecreated", "onorafter", "01/08/2024 12:00 am"], //CHANGE
                    //"AND",
                    ["trandate", "onorafter", dateParameter],
                    "AND",
                    [[["custbody_cen_jlo_digital_pmt_ord", "is", "T"], "OR", ["custbody_cen_jlo_instal_ord", "is", "T"], "OR", ["custbody_cen_jlo_choice", "is", "T"]], "AND", ["custcol_jlo_inv_1", "anyof", "@NONE@"]],
                    "AND",
                    //["internalid", "anyof", "1807133"],
                        ["internalid", "anyof", "2156143"],
                    // ["internalid", "anyof", "459421", "809546", "1209981", "1242494", "1665360", "2000019", "775696", "1132017", "1537880"],
                    "AND",

                    ["custbody_sub_install_processed", "is", "F"]
                ],
            columns:
                [
                    search.createColumn({ name: "internalid", label: "Internal ID" }),
                    search.createColumn({ name: "custbody_cen_jlo_choice", label: "Choice Bundle" }),
                    search.createColumn({ name: "custbody_cen_jlo_instal_ord", label: "Installment Order" }),
                    search.createColumn({ name: "custbody_cen_jlo_digital_pmt_ord", label: "Digital Payment Order" }),
                    search.createColumn({ name: "total", label: "Amount (Transaction Total)" }),
                    search.createColumn({ name: "postingperiod", label: "Period" }),
                    search.createColumn({ name: "trandate", label: "Date" }),

                ]
        });

        return salesorderSearchObj;

    }

    function map(context) {

        var searchResult = JSON.parse(context.value);
        log.debug('searchResult', searchResult);

        context.write({
            key: searchResult.values.internalid.value,
            value: {
                choiceBundle: searchResult.values.custbody_cen_jlo_choice,
                subscription: searchResult.values.custbody_cen_jlo_instal_ord,
                digitalPayment: searchResult.values.custbody_cen_jlo_digital_pmt_ord,
                soTotal: searchResult.values.total,
                postingPeriod: searchResult.values.postingperiod,
                tranDate: searchResult.values.trandate
            }
        });


    }

    function reduce(context) {
        var result = {
            errors: []
        };


        try {
            var emailAuthorParam = runtime.getCurrentScript().getParameter('custscript_jlo_email_author');
            var emailSendParam = runtime.getCurrentScript().getParameter('custscript_jlo_email_send');
            var installmentPaymentItemParam = runtime.getCurrentScript().getParameter('custscript_jlo_install_payment_item');
            var shippingItemParam = runtime.getCurrentScript().getParameter('custscript_jlo_shipping_item');
            var choiceBundleItemParam = runtime.getCurrentScript().getParameter('custscript_jlo_choice_bundle');
            var invoiceTwoTerms = runtime.getCurrentScript().getParameter('custscript_jlo_invoice_two_terms');
            var invoiceThreeTerms = runtime.getCurrentScript().getParameter('custscript_jlo_invoice_three_terms');
            var dateParameter = runtime.getCurrentScript().getParameter('custscript_transaction_date');
            dateParameter = formatISODateToMMDDYYYY(dateParameter.toString());

            log.audit('SO Details', 'emailAuthorParam: ' + emailAuthorParam +
                ', emailSendParam: ' + emailSendParam +
                ', installmentPaymentItemParam: ' + installmentPaymentItemParam +
                ', shippingItemParam: ' + shippingItemParam +
                ', choiceBundleItemParam: ' + choiceBundleItemParam +
                ', invoiceTwoTerms: ' + invoiceTwoTerms +
                ', invoiceThreeTerms: ' + invoiceThreeTerms +
                ', dateParameter: ' + dateParameter
            );

            var soID = context.key;
            log.debug('soID', soID)

            // Check for server restart
            if (context.isRestarted) {
                result.errors.push({
                    error: 'A restart occurred on this Sales Order. Please double check for duplicates.',
                    soID: soID
                });
            }

            for (var v in context.values) {
                var dataObj = JSON.parse(context.values[v]);
                log.debug(context.key, dataObj);
                var choiceBundleSO = dataObj.choiceBundle;
                var subscriptionSO = dataObj.subscription;
                var digitalPaymentSO = dataObj.digitalPayment;
                var totalSO = dataObj.soTotal;
                var postingPeriodSO = dataObj.postingPeriod;
                var tranDateSO = dataObj.tranDate;
                tranDateSO = parseDate(tranDateSO)
                log.debug('SO Details', 'choiceBundleSO: ' + choiceBundleSO + ', subscriptionSO: ' + subscriptionSO + ', digitalPaymentSO: ' + digitalPaymentSO + ', totalSO: ' + totalSO, + ', postingPeriodSO: ' + postingPeriodSO + ', tranDateSO: ' + tranDateSO);

                // Load the original SO
                var loadedSO = record.load({ type: record.Type.SALES_ORDER, id: soID });
                var lineCount = loadedSO.getLineCount({ sublistId: 'item' });

                //Find the Invoice attached to the current Sales Order
                var invoiceOneId = findInvoiceOne(soID, totalSO, context)
                log.debug('invoiceOneId', invoiceOneId)

                if (!invoiceOneId) {
                    result.errors.push({ error: 'Original Invoice ID is blank or null', soID: soID });
                    continue; // Skip to the next context key
                }

                if (subscriptionSO == 'T' || choiceBundleSO == 'T') {
                    // Determine what forecasts need to be created
                    var forecastResult = checkExistingForecast(loadedSO, lineCount);
                    log.debug('forecastResult', forecastResult);

                    var invoiceForecastedTwo = forecastResult.invoiceForecastedTwo;
                    var invoiceForecastedThree = forecastResult.invoiceForecastedThree;

                    if (forecastResult.createInvoiceTwo) {
                        invoiceForecastedTwo = copyAndModifyInvoice(invoiceOneId, invoiceTwoTerms, shippingItemParam);
                        log.audit('Created Forecasted Invoice #2', invoiceForecastedTwo);
                    } else {
                        log.audit('Forecasted Invoice #2 already exists!', invoiceForecastedTwo);
                    }

                    if (forecastResult.createInvoiceThree) {
                        invoiceForecastedThree = copyAndModifyInvoice(invoiceOneId, invoiceThreeTerms, shippingItemParam);
                        log.audit('Created Forecasted Invoice #3', invoiceForecastedThree);
                    } else {
                        log.audit('Forecasted Invoice #3 already exists!', invoiceForecastedThree);
                    }

                    var updateOriginalInvoice = setForecastsOnOriginalInvoice(invoiceOneId, invoiceForecastedTwo, invoiceForecastedThree);
                    log.debug('updateOriginalInvoice', updateOriginalInvoice);

                    if (!updateOriginalInvoice) {
                        result.errors.push({
                            error: 'Error setting Forecasted Invoices on Original Invoice.',
                            soID: soID
                        });
                    }

                    // Link newly created forecasts to current SO
                    for (var i = 0; i < lineCount; i++) {
                        // Get the item value
                        var item = loadedSO.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
                        var subscriptionFlagLineSO = loadedSO.getSublistValue({ sublistId: 'item', fieldId: 'custcol_shpfy_subscrptn_flg', line: i });
                        var choiceBundleLineSO = loadedSO.getSublistValue({ sublistId: 'item', fieldId: 'custcolshpfy_bndl_id', line: i });
                        log.debug(soID + ' Line ' + (i + 1), 'Item: ' + item + ', Subscription Flag: ' + subscriptionFlagLineSO + ', Choice Bundle: ' + choiceBundleLineSO);

                        if (subscriptionFlagLineSO == 'Y' || choiceBundleLineSO) {
                            log.debug('subscriptionFlagLineSO', subscriptionFlagLineSO);

                            // Only update the fields if they haven't been set already
                            if (invoiceOneId && !loadedSO.getSublistValue({ sublistId: 'item', fieldId: 'custcol_jlo_inv_1', line: i })) {
                                loadedSO.setSublistValue({ sublistId: 'item', fieldId: 'custcol_jlo_inv_1', line: i, value: invoiceOneId });
                            }

                            if (!loadedSO.getSublistValue({ sublistId: 'item', fieldId: 'custcol_jlo_inv_2_fore', line: i })) {
                                loadedSO.setSublistValue({ sublistId: 'item', fieldId: 'custcol_jlo_inv_2_fore', line: i, value: invoiceForecastedTwo });
                            }

                            if (!loadedSO.getSublistValue({ sublistId: 'item', fieldId: 'custcol_jlo_inv_3_fore', line: i })) {
                                loadedSO.setSublistValue({ sublistId: 'item', fieldId: 'custcol_jlo_inv_3_fore', line: i, value: invoiceForecastedThree });
                            }
                        }
                    }
                    if (invoiceForecastedTwo && invoiceForecastedThree && updateOriginalInvoice) {
                        loadedSO.setValue({ fieldId: 'custbody_sub_install_processed', value: true, ignoreFieldChange: true });
                    }
                    loadedSO.save();
                }


                // If SO is a digital payment...
                if (digitalPaymentSO == 'T') {
                    log.debug('digitalPaymentSO', digitalPaymentSO)
                    var shippingProcessed = false

                    for (var i = 0; i < lineCount; i++) {
                        // Get the item value
                        var shopifyOrigOrderId = loadedSO.getSublistValue({ sublistId: 'item', fieldId: 'custcolcustcol_shpfy_orgnl_order', line: i });
                        log.debug('shopifyOrigOrderId', shopifyOrigOrderId)

                        if (shopifyOrigOrderId) {
                            //Find Original SO with shopifyInstallNum
                            var originalSOData = findOriginalSO(shopifyOrigOrderId)
                            log.debug('originalSOData', originalSOData)
                            var originalSO = originalSOData.matchingSOID
                            var soIdDate = originalSOData.soIDDate

                            if (new Date(soIdDate) >= new Date(dateParameter)) {

                                var shopifyInstallNum = loadedSO.getSublistValue({ sublistId: 'item', fieldId: 'custcolcustcol_shpfy_inst_num', line: i });
                                var digitalPaymentRate = loadedSO.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: i });
                                var forecastFieldToTransform = 'custcol_jlo_inv_' + shopifyInstallNum + '_fore';

                                log.debug('shopifyInstallNum', shopifyInstallNum)
                                log.debug('digitalPaymentRate', digitalPaymentRate)
                                log.debug('forecastFieldToTransform', forecastFieldToTransform)

                                // Find the Forecasted Invoice that we will be Converting to a Credit Memo on the Original Order
                                var forecastedInvoiceToConvertData = forecastedInvoicetoConvert(originalSO, forecastFieldToTransform, digitalPaymentRate)
                                var forecastedInvoiceToConvert = forecastedInvoiceToConvertData.forecastedInvoice;
                                var originalInvoiceOne = forecastedInvoiceToConvertData.originalInvoiceOne;

                                log.debug('forecastedInvoiceToConvertData', forecastedInvoiceToConvertData)
                                log.debug('forecastedInvoiceToConvert', forecastedInvoiceToConvert)
                                log.debug('originalInvoiceOne', originalInvoiceOne)

                                if (!originalInvoiceOne) {
                                    result.errors.push({
                                        error: 'Original SO for Digital Payment does not have a link Invoice #1 on the matching line.',
                                        soID: soID
                                    });
                                    continue;
                                }

                                var existingCreditMemoField = loadedSO.getSublistValue({ sublistId: 'item', fieldId: 'custcol_jlo_cm_' + shopifyInstallNum + '_fore', line: i });
                                var creditMemoCreationResults = null
                                var creditMemoFieldId = 'custcol_jlo_cm_' + shopifyInstallNum + '_fore'
                                var currentSOInvoiceFieldID = 'custcol_jlo_inv_' + shopifyInstallNum
                                var forecastedInvoiceToConvertSet = 'custcol_jlo_inv_' + shopifyInstallNum + '_fore'
                                var newCreditMemo = null

                                if (!existingCreditMemoField) {
                                    // Create Credit Memo
                                    if (forecastedInvoiceToConvert) {
                                        creditMemoCreationResults = loadAndTransformInvoice(forecastedInvoiceToConvert, postingPeriodSO, forecastFieldToTransform, originalInvoiceOne, installmentPaymentItemParam, invoiceOneId, digitalPaymentRate, shippingItemParam, shippingProcessed);
                                        newCreditMemo = creditMemoCreationResults.newCreditMemo
                                        shippingProcessed = creditMemoCreationResults.shippingProcessed
                                    }
                                    log.debug('newCreditMemo', newCreditMemo);
                                    log.debug('shippingProcessed', shippingProcessed);

                                    if (newCreditMemo) {
                                        // Set the link fields on the Digital Install SO
                                        loadedSO.setSublistValue({ sublistId: 'item', fieldId: 'custcol_jlo_inv_1', line: i, value: originalInvoiceOne });
                                        loadedSO.setSublistValue({ sublistId: 'item', fieldId: 'custcol_jlo_inv_' + shopifyInstallNum, line: i, value: invoiceOneId });
                                        loadedSO.setSublistValue({ sublistId: 'item', fieldId: forecastFieldToTransform, line: i, value: forecastedInvoiceToConvert });
                                        loadedSO.setSublistValue({ sublistId: 'item', fieldId: creditMemoFieldId, line: i, value: newCreditMemo });
                                    }
                                } else {
                                    log.audit('Credit Memo already exists!', existingCreditMemoField);
                                    newCreditMemo = existingCreditMemoField
                                }
                                // Update this current Sales Order's Invoice with Credit Memo and Current Sales Order's Invoice
                                var currentInvoiceParams = ['invoice', invoiceOneId, digitalPaymentRate, creditMemoFieldId, newCreditMemo, currentSOInvoiceFieldID, invoiceOneId, 'custcol_jlo_inv_1', originalInvoiceOne, forecastedInvoiceToConvert, forecastedInvoiceToConvertSet]
                                var currentInvoiceUpdated = attemptWithRetry(updateOriginalRecord, 2, currentInvoiceParams);
                                log.debug('currentInvoiceUpdated', currentInvoiceUpdated);

                                //update Original Sales Order with Credit Memo and Current Sales Order's Invoice
                                var originalSOParams = ['salesorder', originalSO, digitalPaymentRate, creditMemoFieldId, newCreditMemo, currentSOInvoiceFieldID, invoiceOneId]
                                var originalSOUpdated = attemptWithRetry(updateOriginalRecord, 2, originalSOParams);
                                log.debug('originalSOUpdated', originalSOUpdated);

                                //update the Original Saless Order's Invoice with Credit Memo and Current Sales Order's Invoice
                                var originalSOInvoiceParams = ['invoice', originalInvoiceOne, digitalPaymentRate, creditMemoFieldId, newCreditMemo, currentSOInvoiceFieldID, invoiceOneId]
                                var originalSOInvoiceUpdated = attemptWithRetry(updateOriginalRecord, 2, originalSOInvoiceParams);
                                log.debug('originalSOInvoiceUpdated', originalSOInvoiceUpdated);

                                var settingErrorDetails = [];

                                if (!currentInvoiceUpdated) { settingErrorDetails.push('the Current SO Invoice: ' + invoiceOneId); }
                                if (!originalSOUpdated) { settingErrorDetails.push('the Original SO: ' + originalSO); }
                                if (!originalSOInvoiceUpdated) { settingErrorDetails.push('the Original SO Invoice: ' + originalInvoiceOne); }

                                if (settingErrorDetails.length > 0) {
                                    result.errors.push({
                                        error: 'Credit Memo created from ' + soID + ' was not linked to ' + settingErrorDetails.join(', '),
                                        soID: soID
                                    });
                                }

                            } else {
                                result.errors.push({
                                    error: 'Original SO for Digital Payment is Prior to Date Parameter. Original SO: ' + new Date(soIdDate) + ', Digital Payment Date: ' + new Date(dateParameter),
                                    soID: soID
                                });
                                continue;
                            }

                        }
                    }
                    if (settingErrorDetails.length < 1 && newCreditMemo) {
                        loadedSO.setValue({ fieldId: 'custbody_sub_install_processed', value: true, ignoreFieldChange: true });
                    }
                    loadedSO.save();
                }
            }
        } catch (e) {
            // Log the error and write it to the context
            result.errors.push({
                error: e.message,
                stack: e.stack,
                soID: context.key
            });
        } finally {
            // Write all results to context in one call
            context.write({
                key: context.key,
                value: JSON.stringify(result)
            });
        }
    }

    function summarize(summary) {
        try {
            var errorList = [];
            var restartKeys = [];

            summary.output.iterator().each(function (key, value) {
                try {
                    var result = JSON.parse(value);
                    if (result.errors && result.errors.length > 0) {
                        result.errors.forEach(function (errorObj) {
                            errorList.push({
                                error: errorObj.error,
                                stack: errorObj.stack,
                                soID: errorObj.soID,
                                link: url.resolveRecord({
                                    recordType: 'salesorder',
                                    recordId: errorObj.soID,
                                    isEditMode: false
                                })
                            });
                        });
                    }

                } catch (e) {
                    log.error({
                        title: 'Error parsing result in summarize phase',
                        details: e
                    });
                }
                return true;
            });

            // Process the errors collected
            if (errorList.length > 0) {
                log.debug('errorList', errorList);
                sendErrorReport(errorList, restartKeys);
            } else {
                log.audit({
                    title: 'Summarize Phase',
                    details: 'No errors found'
                });
            }

        } catch (e) {
            log.error({
                title: 'Error in summarize phase',
                details: e
            });
        }
    }


    //HELPER FUNCTIONS

    /**
     * Finds the related Invoice to the current Sales Order.
     * @param {string} salesOrderId - The current Sales Order ID.
     * @param {string} salesOrderTotal - The total of the Current Sales Order.
     * @param {number} context - The context.
     * @returns {number} The related Invoice that was found.
     */
    function findInvoiceOne(salesOrderId, salesOrderTotal, context) {
        //    try {
        log.debug('salesOrderId', salesOrderId)
        var invoiceSearchObj = search.create({
            type: "invoice",
            settings: [{ "name": "consolidationtype", "value": "ACCTTYPE" }, { "name": "includeperiodendtransactions", "value": "F" }],
            filters:
                [
                    ["type", "anyof", "CustInvc"],
                    "AND",
                    ["mainline", "is", "T"],
                    "AND",
                    ["createdfrom", "anyof", salesOrderId],
                    "AND",
                    ["status", "anyof", "CustInvc:B"]
                ],
            columns:
                [
                    search.createColumn({ name: "internalid", label: "Internal ID" })
                ]
        });
        var searchResultCount = invoiceSearchObj.runPaged().count;
        log.debug('searchResultCount', searchResultCount)


        var invoiceId = null;
        invoiceSearchObj.run().each(function (result) {
            invoiceId = result.getValue({
                name: 'internalid'
            });

        })
        log.debug('invoiceId', invoiceId)

        if (!invoiceId) {
            throw new Error('Invoice not found for SO ID: ' + salesOrderId);
        }


        return invoiceId;

        // } catch (e) {
        //     logError('findInvoiceOne', e, context);
        //     throw e;
        // }
    }



    /**
     * Checks existing forecast values on a Sales Order and determines if new invoices should be created.
     * 
     * Iterates through the item lines of the provided Sales Order to check for forecast values in specific fields. Based on the
     * presence of these values, it sets flags to indicate whether new invoices for the forecasted amounts should be created.
     * 
     * @param {Object} loadedSO - The Sales Order record loaded for inspection.
     * @param {number} soLineCount - The number of item lines in the Sales Order.
     * @returns {Object} - An object containing flags (`createInvoiceTwo`, `createInvoiceThree`) and forecast values (`invoiceForecastedTwo`, `invoiceForecastedThree`).
     */
    function checkExistingForecast(loadedSO, soLineCount) {
        var createInvoiceTwo = true;
        var createInvoiceThree = true;
        var invoiceForecastedTwo = null;
        var invoiceForecastedThree = null;

        for (var i = 0; i < soLineCount; i++) {
            var invoiceTwo = loadedSO.getSublistValue({ sublistId: 'item', fieldId: 'custcol_jlo_inv_2_fore', line: i });
            var invoiceThree = loadedSO.getSublistValue({ sublistId: 'item', fieldId: 'custcol_jlo_inv_3_fore', line: i });

            if (invoiceTwo && invoiceThree) {
                createInvoiceTwo = false;
                createInvoiceThree = false;
                break;
            }
            if (invoiceTwo) {
                createInvoiceTwo = false;
                invoiceForecastedTwo = invoiceTwo;
            }
            if (invoiceThree) {
                createInvoiceThree = false;
                invoiceForecastedThree = invoiceThree;
            }
        }

        return {
            createInvoiceTwo: createInvoiceTwo,
            createInvoiceThree: createInvoiceThree,
            invoiceForecastedTwo: invoiceForecastedTwo,
            invoiceForecastedThree: invoiceForecastedThree
        };
    }


    /**
    * Copies and modifies an existing invoice to create a forecasted invoice.
    * 
    * This function duplicates the provided invoice, marks it as "Forecasted Invoice", and performs several modifications:
    * - Stores the original eTail Order Id in a custom field and clears the original field.
    * - Updates the terms field to the specified value.
    * - Removes non-subscription, non-choice bundle, and non-shipping item lines.
    * - Sets the quantity of retained items to 0 while keeping the amount unchanged.
    * - Sets the original invoice reference on subscription and choice bundle lines.
    * 
    * @param {number} originalInvoice - The internal ID of the original invoice to copy.
    * @param {number} netValue - The value to set for the terms field in the forecasted invoice.
    * @param {number} shippingItemParam - The shipping item that carries into newly created records. This is a parameter in the main function.
    * @returns {number|null} - The internal ID of the created forecasted invoice, or null if an error occurs.
    */
    function copyAndModifyInvoice(originalInvoice, netValue, shippingItemParam) {

        try {
            // Copy the original invoice
            var forecastedInvoice = record.copy({
                type: record.Type.INVOICE,
                id: originalInvoice,
                isDynamic: true
            });

            log.debug('forecastedInvoice', forecastedInvoice);

            forecastedInvoice.setValue({
                fieldId: 'custbody_jlo_forecasted_inv',
                value: true
            });

            // Remove eTail Order Id and store in a custom field
            var eTailOrderId = forecastedInvoice.getValue({ fieldId: 'custbody_celigo_etail_order_id' });
            log.debug('eTailOrderId', eTailOrderId);

            forecastedInvoice.setValue({
                fieldId: 'custbody_jlo_etail_order_id',
                value: eTailOrderId
            });

            forecastedInvoice.setValue({
                fieldId: 'custbody_celigo_etail_order_id',
                value: ''
            });

            forecastedInvoice.setValue({
                fieldId: 'terms',
                value: netValue
            });

            var lineCount = forecastedInvoice.getLineCount({ sublistId: 'item' });
            log.debug('lineCount copyAndModifyInvoice', lineCount);

            for (var k = lineCount - 1; k >= 0; k--) {

                var item = forecastedInvoice.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'item',
                    line: k
                });


                var isShipping = (String(item).trim() === String(shippingItemParam).trim());

                var isSubscription = forecastedInvoice.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_shpfy_subscrptn_flg',
                    line: k
                }) === 'Y';

                var isChoiceBundle = forecastedInvoice.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcolshpfy_bndl_id',
                    line: k
                });

                log.debug('Line ' + (k + 1), 'Item: ' + item + ', isSubscription: ' + isSubscription + ', isChoiceBundle: ' + isChoiceBundle + ', isShipping: ' + isShipping);


                if (!isSubscription && !isChoiceBundle && !isShipping) {
                    log.debug('Removing Line ' + (k + 1), 'Item: ' + item + ', isSubscription: ' + isSubscription + ', isChoiceBundle: ' + isChoiceBundle + ', isShipping: ' + isShipping);
                    forecastedInvoice.removeLine({ sublistId: 'item', line: k });
                } else {
                    // Keep the original items, set quantity to 0, keep amount same

                    var lineAmt = forecastedInvoice.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'amount',
                        line: k
                    });


                    forecastedInvoice.selectLine({
                        sublistId: 'item',
                        line: k
                    });


                    forecastedInvoice.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'quantity',
                        line: k,
                        value: 0
                    });

                    forecastedInvoice.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'amount',
                        line: k,
                        value: lineAmt
                    });


                    forecastedInvoice.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_jlo_inv_1',
                        line: k,
                        value: originalInvoice
                    });

                    forecastedInvoice.commitLine({
                        sublistId: 'item'
                    });

                    //  Set Invoice #1 on subscription lines
                    if (isSubscription || isChoiceBundle) {

                        forecastedInvoice.selectLine({
                            sublistId: 'item',
                            line: k
                        });

                        forecastedInvoice.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'custcol_invoice_1',
                            line: k,
                            value: originalInvoice
                        });

                        forecastedInvoice.commitLine({
                            sublistId: 'item'
                        });
                    }
                }
            }

            // Save the modified forecasted invoice
            var forecastedInvoiceId = forecastedInvoice.save();
            log.debug('Forecasted Invoice Created', 'ID: ' + forecastedInvoiceId);
            return forecastedInvoiceId;

        } catch (e) {
            log.error('Error Copying and Modifying Invoice', e.toString());
        }
    }

    function findOriginalSO(matchingOrderID) {

        // Find the matching Sales Order ID
        var salesOrderSearchObj = search.create({
            type: "salesorder",
            settings: [{ "name": "consolidationtype", "value": "ACCTTYPE" }, { "name": "includeperiodendtransactions", "value": "F" }],
            filters: [
                ["mainline", "is", "T"],
                "AND",
                ["type", "anyof", "SalesOrd"],
                "AND",
                ["custbody_celigo_etail_order_id", "is", matchingOrderID]
            ],
            columns: [
                search.createColumn({ name: "internalid", label: "Internal ID" }),
                search.createColumn({ name: "trandate", label: "Date" })
            ]
        });

        var matchingSOID = null;

        salesOrderSearchObj.run().each(function (result) {
            matchingSOID = result.getValue('internalid');
            soIDDate = result.getValue('trandate')
            return false; // Exit the loop after the first result
        });

        if (!matchingSOID) {
            log.debug("No matching Sales Order found");
            return null;
        }

        log.debug("matchingSOID", matchingSOID);
        return {
            matchingSOID: matchingSOID,
            soIDDate: soIDDate
        }
    }


    /**
     * Reusable function. Parses a date string into a JavaScript Date object based on multiple date formats.
     * 
     * Supports the following date formats:
     * - YYYY-MM-DD
     * - MM/DD/YYYY
     * - DD-MM-YYYY
     * 
     * Tries each format in sequence until it finds a match. If no format matches, returns null.
     * 
     * @param {string} dateStr - The date string to parse.
     * @returns {Date|null} - The corresponding Date object if a format matches, or null if no formats match.
     */
    // function parseDate(dateStr) {
    //     var dateFormats = [
    //         {
    //             regex: /^\d{4}-\d{2}-\d{2}$/,
    //             parse: function (str) {
    //                 return new Date(str);
    //             }
    //         },
    //         {
    //             regex: /^\d{2}\/\d{2}\/\d{4}$/,
    //             parse: function (str) {
    //                 var parts = str.split('/');
    //                 return new Date(parts[2], parts[0] - 1, parts[1]);
    //             }
    //         },
    //         {
    //             regex: /^\d{2}-\d{2}-\d{4}$/,
    //             parse: function (str) {
    //                 var parts = str.split('-');
    //                 return new Date(parts[2], parts[1] - 1, parts[0]);
    //             }
    //         }
    //     ];

    //     for (var i = 0; i < dateFormats.length; i++) {
    //         if (dateFormats[i].regex.test(dateStr)) {
    //             return dateFormats[i].parse(dateStr);
    //         }
    //     }

    //     return null;
    // }
    function parseDate(dateStr) {
        var dateFormats = [
            {
                // Handle ISO format: 2024-07-05T07:00:00.000Z
                regex: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
                parse: function (str) {
                    var date = new Date(str);
                    var month = ('0' + (date.getUTCMonth() + 1)).slice(-2); // Adding leading zero
                    var day = ('0' + date.getUTCDate()).slice(-2); // Adding leading zero
                    var year = date.getUTCFullYear();
                    return month + '/' + day + '/' + year;
                }
            },
            {
                // Handle YYYY-MM-DD
                regex: /^\d{4}-\d{2}-\d{2}$/,
                parse: function (str) {
                    return new Date(str);
                }
            },
            {
                // Handle MM/DD/YYYY
                regex: /^\d{2}\/\d{2}\/\d{4}$/,
                parse: function (str) {
                    var parts = str.split('/');
                    return new Date(parts[2], parts[0] - 1, parts[1]);
                }
            },
            {
                // Handle MM-DD-YYYY
                regex: /^\d{2}-\d{2}-\d{4}$/,
                parse: function (str) {
                    var parts = str.split('-');
                    return new Date(parts[2], parts[1] - 1, parts[0]);
                }
            },
            {
                // Handle M-D-YYYY (e.g., 7-05-2024)
                regex: /^\d{1,2}-\d{1,2}-\d{4}$/,
                parse: function (str) {
                    var parts = str.split('-');
                    return new Date(parts[2], parts[0] - 1, parts[1]);
                }
            }
        ];

        for (var i = 0; i < dateFormats.length; i++) {
            if (dateFormats[i].regex.test(dateStr)) {
                return dateFormats[i].parse(dateStr);
            }
        }

        return null;
    }


    /**
     * Retrieves forecast values and related information from a Sales Order based on a matching order ID and digital payment rate.
     * 
     * Performs a search for a Sales Order with the specified `matchingOrderID`. If found, loads the Sales Order and iterates through
     * its item lines to find one where the line rate matches the `digitalPaymentRate`. Extracts and returns forecast values from
     * the line that matches the criteria, along with the original invoice ID and Sales Order ID.
     * 
     * @param {string} matchingOrderID - The order ID to match in the Sales Order.
     * @param {string} forecastFieldToTransform - The field ID for the forecast value to retrieve.
     * @param {number} digitalPaymentRate - The rate to match against Sales Order line rates.
     * @returns {Object} - An object containing the `forecastedInvoice`, `originalInvoiceOne`, `digitalPaymentRate`, and `matchingSOID`.
     */
    function forecastedInvoicetoConvert(matchingOrderID, forecastFieldToTransform, digitalPaymentRate) {

        var matchingSO = record.load({
            type: record.Type.SALES_ORDER,
            id: matchingOrderID
        });

        var lineCount = matchingSO.getLineCount({ sublistId: 'item' });
        var forecastedInvoice = null;
        var originalInvoiceOne = null;

        for (var i = 0; i < lineCount; i++) {
            var linerate = matchingSO.getSublistValue({
                sublistId: 'item',
                fieldId: 'rate',
                line: i
            });
            log.debug("linerate", linerate);
            log.debug("digitalPaymentRate", digitalPaymentRate);

            if (parseFloat(linerate) === parseFloat(digitalPaymentRate)) {
                log.debug("linerate and digital payment rate match Found");
                log.debug("forecastFieldToTransform", forecastFieldToTransform.toString());


                forecastedInvoice = matchingSO.getSublistValue({
                    sublistId: 'item',
                    fieldId: forecastFieldToTransform.toString(),
                    line: i
                });
                log.debug("forecastedInvoice", forecastedInvoice);


                originalInvoiceOne = matchingSO.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_jlo_inv_1',
                    line: i
                });

                break;
            }
        }

        if (!forecastedInvoice) {
            log.debug("No matching rate found in Original Sales Order lines.");
        }

        return {
            forecastedInvoice: forecastedInvoice,
            originalInvoiceOne: originalInvoiceOne,
            digitalPaymentRate: digitalPaymentRate,
            matchingSOID: matchingOrderID
        };
    }

    /**
     * Transforms an invoice into a credit memo and updates it based on specified criteria.
     * 
     * This function performs the following actions:
     * - Transforms the specified invoice into a credit memo.
     * - Iterates through the credit memo lines, removing lines that do not match the digital payment rate or are not shipping items.
     * - Updates matching lines with new values, including item, quantity, rate, amount, and custom fields.
     * - Sets additional fields on the credit memo, including marking it as a forecasted invoice and setting the transaction date.
     * - Saves and returns the ID of the newly created credit memo.
     * 
     * @param {number} invoiceId - The internal ID of the invoice to transform.
     * @param {string} postingPeriod - The posting period for the credit memo (commented out in code).
     * @param {string} forecastFieldToTransform - The field ID to update with the original invoice ID.
     * @param {number} originalInvoice - The original invoice ID to set on the credit memo.
     * @param {number} installPaymentItem - The item to set on the credit memo lines that match the digital payment rate.
     * @param {number} digitalPaymentRate - The rate to match against lines in the credit memo.
     * @param {number} shippingItemParam - The shipping item that carries into newly created records. This is a parameter in the main function.
     * @returns {number} The internal ID of the created credit memo.
     */
    function loadAndTransformInvoice(invoiceId, postingPeriod, forecastFieldToTransform, originalInvoice, installPaymentItem, invoiceOneId, digitalPaymentRate, shippingItemParam, shippingProcessed) {
        log.debug('loadAndTransformInvoice Params', 'invoiceId: ' + invoiceId + ', forecastFieldToTransform: ' + forecastFieldToTransform + ', postingPeriod: ' + postingPeriod + ', originalInvoice: ' + originalInvoice + ', installPaymentItem: ' + installPaymentItem + ',invoiceOneId: ' + invoiceOneId + ', digitalPaymentRate: ' + digitalPaymentRate + ', shippingProcessed: ' + shippingProcessed);

        var creditMemo = record.transform({
            fromType: record.Type.INVOICE,
            fromId: invoiceId,
            toType: record.Type.CREDIT_MEMO
        });



        var creditMemoLineCount = creditMemo.getLineCount({ sublistId: 'item' });
        log.debug("creditMemoLineCount", creditMemoLineCount);

        for (var x = creditMemoLineCount - 1; x >= 0; x--) {

            var item = creditMemo.getSublistValue({
                sublistId: 'item',
                fieldId: 'item',
                line: x
            });


            var cmRate = creditMemo.getSublistValue({
                sublistId: 'item',
                fieldId: 'rate',
                line: x
            });

            var cmQuantity = creditMemo.getSublistValue({
                sublistId: 'item',
                fieldId: 'quantity',
                line: x
            });

            var cmAmount = creditMemo.getSublistValue({
                sublistId: 'item',
                fieldId: 'amount',
                line: x
            });

            var cmTaxCode = creditMemo.getSublistValue({
                sublistId: 'item',
                fieldId: 'taxcode',
                line: x
            });


            var cmTaxRate = creditMemo.getSublistValue({
                sublistId: 'item',
                fieldId: 'taxrate1',
                line: x
            });


            var matchingRate = (cmRate && String(cmRate).trim() === String(digitalPaymentRate).trim());
            var isShipping = (String(item).trim() === String(shippingItemParam).trim());

            log.debug("matchingRate", matchingRate);
            log.debug('Line ' + (x - 1), 'Item: ' + item + ', matchingRate: ' + matchingRate + ', isShipping: ' + isShipping + ', cmTaxRate: ' + cmTaxRate + ', shippingProcessed: ' + shippingProcessed);


            if ((!matchingRate && !isShipping) || (isShipping && shippingProcessed)) {
                log.debug('Removing Line ' + (x + 1), 'Item: ' + item + ', matchingRate: ' + matchingRate + ', isShipping: ' + isShipping + ', shippingProcessed: ' + shippingProcessed);
                isShipping = false
                creditMemo.removeLine({ sublistId: 'item', line: x });
            } else {
                if (matchingRate) {
                    creditMemo.setSublistValue({ sublistId: 'item', fieldId: 'item', line: x, value: installPaymentItem });
                    creditMemo.setSublistValue({ sublistId: 'item', fieldId: 'custcol_jlo_inv_1	', line: x, value: originalInvoice });
                    creditMemo.setSublistValue({ sublistId: 'item', fieldId: forecastFieldToTransform.toString(), line: x, value: invoiceId });
                    creditMemo.setSublistValue({ sublistId: 'item', fieldId: 'quantity', line: x, value: cmQuantity });
                    creditMemo.setSublistValue({ sublistId: 'item', fieldId: 'rate', line: x, value: digitalPaymentRate });
                    creditMemo.setSublistValue({ sublistId: 'item', fieldId: 'amount', line: x, value: cmAmount });
                    creditMemo.setSublistValue({ sublistId: 'item', fieldId: 'taxcode', line: x, value: cmTaxCode });
                    creditMemo.setSublistValue({ sublistId: 'item', fieldId: 'taxrate1', line: x, value: cmTaxRate });

                }
                if (isShipping) {
                    creditMemo.setSublistValue({ sublistId: 'item', fieldId: forecastFieldToTransform.toString(), line: x, value: invoiceId });
                    shippingProcessed = true
                }
            }
        }

        refreshCMApplication(creditMemo, invoiceId);


        var invoiceDateLookup = search.lookupFields({
            type: search.Type.INVOICE,
            id: invoiceOneId,
            columns: ['trandate']
        });
        log.debug("invoiceDateLookup", invoiceDateLookup.trandate);


        creditMemo.setValue({ fieldId: 'custbody_jlo_forecasted_inv', value: true });
        creditMemo.setValue({ fieldId: 'trandate', value: parseDate(invoiceDateLookup.trandate) });
        //  creditMemo.setValue({ fieldId: 'postingperiod', value: postingPeriod });

        var creditMemoSave = creditMemo.save();
        log.audit('Credit Memo Created', 'ID: ' + creditMemoSave);

        return {
            newCreditMemo: creditMemoSave,
            shippingProcessed: shippingProcessed
        };
    }


    /**
     * Refreshes the application status of a specific invoice on a credit memo.
     * 
     * This function iterates through the "apply" sublist of the provided credit memo to find
     * the line that matches the given invoice ID. It then unchecks/checks the "apply" checkbox for that
     * invoice to refresh its application status.
     * 
     * @param {Record} creditMemo - The credit memo record to be updated. This is a Record object.
     * @param {string} invoiceId - The internal ID of the invoice to be refreshed. This value is compared
     *                             with the "internalid" field on the credit memo's "apply" sublist.
     * 
     * @returns {void}
     */
    function refreshCMApplication(creditMemo, invoiceId) {
        var creditMemoApplyLineCount = creditMemo.getLineCount({ sublistId: 'apply' });
        log.debug('creditMemoApplyLineCount', creditMemoApplyLineCount)


        for (var t = creditMemoApplyLineCount - 1; t >= 0; t--) {
            var applyInternalId = creditMemo.getSublistValue({
                sublistId: 'apply',
                fieldId: 'internalid',
                line: t
            });

            if (String(applyInternalId).trim() === String(invoiceId).trim()) {
                log.debug("applyInternalId", applyInternalId);
                var apply = creditMemo.getSublistValue({
                    sublistId: 'apply',
                    fieldId: 'apply',
                    line: t
                });
                var applyTotal = creditMemo.getSublistValue({
                    sublistId: 'apply',
                    fieldId: 'total',
                    line: t
                });

                if (apply) {
                    creditMemo.setSublistValue({
                        sublistId: 'apply',
                        fieldId: 'apply',
                        line: t,
                        value: false
                    });
                    creditMemo.setSublistValue({
                        sublistId: 'apply',
                        fieldId: 'apply',
                        line: t,
                        value: true
                    });
                }
            }
        }
    }


    /**
     * Updates the original invoice with forecasted invoice references.
     * 
     * This function loads an invoice record and iterates through its lines. For each line
     * with a subscription or choice bundle flag, it sets forecasted invoice references on
     * the corresponding fields.
     * 
     * @param {string} internalID - The internal ID of the original invoice to be updated.
     * @param {string} forecastTwo - The ID of the first forecasted invoice.
     * @param {string} forecastThree - The ID of the second forecasted invoice.
     * 
     * @returns {Record} The updated invoice record.
     */

    function setForecastsOnOriginalInvoice(internalID, forecastTwo, forecastThree) {

        // Load the original Invoice
        var loadedInvoice = record.load({
            type: record.Type.INVOICE,
            id: internalID
        });

        var lineCount = loadedInvoice.getLineCount({ sublistId: 'item' });
        log.debug('lineCount', lineCount)

        for (var i = 0; i < lineCount; i++) {
            // Get the item value
            var item = loadedInvoice.getSublistValue({
                sublistId: 'item',
                fieldId: 'item',
                line: i
            });

            var subscriptionFlagLineInv = loadedInvoice.getSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_shpfy_subscrptn_flg',
                line: i
            });

            var choiceBundleLineInv = loadedInvoice.getSublistValue({
                sublistId: 'item',
                fieldId: 'custcolshpfy_bndl_id',
                line: i
            });


            // Log the values
            log.debug(internalID + ' Line Original Inv' + (i + 1), 'Item Original Inv: ' + item + ', Subscription Flag Original Inv: ' + subscriptionFlagLineInv + ', Choice Bundle Original Inv: ' + choiceBundleLineInv);


            if (subscriptionFlagLineInv == 'Y' || choiceBundleLineInv == 'Y') {
                log.debug('subscriptionFlagLineInv', subscriptionFlagLineInv)


                if (internalID) {
                    var currentID = loadedInvoice.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_jlo_inv_1',
                        line: i
                    });

                    if (!currentID) {
                        // If no current value, set the field
                        loadedInvoice.setSublistValue({
                            sublistId: 'item',
                            fieldId: 'custcol_jlo_inv_1',
                            line: i,
                            value: internalID
                        });
                    } else if (currentID !== internalID) {
                        // If populated and does not match, return false
                        return false;
                    }
                }

                // Check and set 'custcol_jlo_inv_2_fore' field
                var currentForecastTwo = loadedInvoice.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_jlo_inv_2_fore',
                    line: i
                });

                if (!currentForecastTwo) {
                    // If no current value, set the field
                    loadedInvoice.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_jlo_inv_2_fore',
                        line: i,
                        value: forecastTwo
                    });
                } else if (currentForecastTwo !== forecastTwo) {
                    // If populated and does not match, return false
                    return false;
                }

                // Check and set 'custcol_jlo_inv_3_fore' field
                var currentForecastThree = loadedInvoice.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_jlo_inv_3_fore',
                    line: i
                });

                if (!currentForecastThree) {
                    // If no current value, set the field
                    loadedInvoice.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_jlo_inv_3_fore',
                        line: i,
                        value: forecastThree
                    });
                } else if (currentForecastThree !== forecastThree) {
                    // If populated and does not match, return false
                    return false;
                }
            }

        }
        loadedInvoice.save();

        return loadedInvoice;

    }


    /**
     * Updates a record by setting values on lines that match a specified rate.
     * 
     * This function performs the following actions:
     * - Loads the specified record type and ID.
     * - Iterates through the lines of the record, checking if the rate matches the provided digital payment rate.
     * - For matching lines, updates fields with the provided values, including a new credit memo, current sales order invoice ID, and optionally, the original sales order invoice ID.
     * - Saves the updated record.
     * 
     * @param {string} recordType - The type of the record to load (e.g., 'invoice', 'creditmemo').
     * @param {number} originalrecordLoadOne - The internal ID of the record to load and update.
     * @param {number} digitalPaymentRate - The rate used to match lines in the record.
     * @param {string} creditMemoFieldId - The field ID where the new credit memo should be set.
     * @param {number} newCreditMemo - The new credit memo value to set.
     * @param {string} currentSOInvoiceFieldId - The field ID where the current sales order invoice ID should be set.
     * @param {number} currentSOInvoiceId - The value to set for the current sales order invoice field.
     * @param {string} originalSOInvoiceField - The field ID where the original sales order invoice ID should be set.
     * @param {number} [originalSOInvoiceID] - The value to set for the original sales order invoice field (optional).
     */
    function updateOriginalRecord(recordType, originalrecordLoadOne, digitalPaymentRate, creditMemoFieldId, newCreditMemo, currentSOInvoiceFieldId, currentSOInvoiceId, originalSOInvoiceField, originalSOInvoiceID, forecastedInvoiceToConvert, forecastedInvoiceToConvertSet) {
        try {
            var recordLoad = record.load({
                type: recordType,
                id: originalrecordLoadOne
            });

            var recordLoadLineCount = recordLoad.getLineCount({ sublistId: 'item' });
            log.debug('recordLoadLineCount', recordLoadLineCount);

            var updated = false;

            for (var h = 0; h < recordLoadLineCount; h++) {
                var recordLoadRate = recordLoad.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'rate',
                    line: h
                });

                log.debug('recordLoadRate', recordLoadRate);
                log.debug('digitalPaymentRate', digitalPaymentRate);

                if (recordLoadRate && String(recordLoadRate).trim() === String(digitalPaymentRate).trim()) {
                    log.debug('inside if', digitalPaymentRate);

                    recordLoad.setSublistValue({ sublistId: 'item', fieldId: creditMemoFieldId, line: h, value: newCreditMemo });
                    recordLoad.setSublistValue({ sublistId: 'item', fieldId: currentSOInvoiceFieldId, line: h, value: currentSOInvoiceId });

                    if (originalSOInvoiceID) {
                        recordLoad.setSublistValue({ sublistId: 'item', fieldId: originalSOInvoiceField, line: h, value: originalSOInvoiceID });
                    }

                    if (forecastedInvoiceToConvert) {
                        recordLoad.setSublistValue({ sublistId: 'item', fieldId: forecastedInvoiceToConvertSet, line: h, value: forecastedInvoiceToConvert });
                    }

                    updated = true; // Indicate that at least one line was updated
                }
            }

            if (updated) {
                recordLoad.save();
                log.debug('Original recordLoad Updated with Credit Memo', originalrecordLoadOne);
            }

            return { success: updated, id: originalrecordLoadOne }; // Return an object indicating success and the ID of the updated record

        } catch (e) {
            log.error('Update Failed', 'Error updating record ' + originalrecordLoadOne + ': ' + e.message);
            return { success: false, id: originalrecordLoadOne, error: e.message }; // Return an object indicating failure and the error message
        }
    }


    /**
     * Sends an email containing error details and restart keys.
     * 
     * Retrieves the email recipient and sender details from script parameters, 
     * constructs the email body with error information including restart keys, 
     * and sends the email report. Logs success or failure of the email.
     * 
     * @param {Array} errorList - List of errors to include in the email.
     * 
     * @returns {void}
     */
    function sendErrorReport(errorList) {
        try {
            var emailRecipient = runtime.getCurrentScript().getParameter('custscript_jlo_email_send');
            var emailSubject = 'Map/Reduce Script Errors Report';
            var emailBody = generateEmailBody(errorList);

            if (emailRecipient) {
                email.send({
                    author: runtime.getCurrentScript().getParameter('custscript_jlo_email_author'),
                    recipients: emailRecipient,
                    subject: emailSubject,
                    body: emailBody
                });
                log.audit({
                    title: 'Error Report Sent',
                    details: 'Error report email has been sent successfully.'
                });
            } else {
                log.error({
                    title: 'Email Recipient Not Configured',
                    details: 'No recipient configured for sending error reports.'
                });
            }
        } catch (e) {
            log.error({
                title: 'Error Sending Error Report',
                details: e
            });
        }
    }


     /**
     * Generates the body of the error report email.
     * 
     * Constructs an email body containing details of each error in the list, including
     * error messages, stack traces, Sales Order IDs, and record links.
     * 
     * @param {Array} errorList - List of error objects to include in the email body.
     * 
     * @returns {string} The formatted email body.
     */
    function generateEmailBody(errorList) {
        var body = 'Dear Team,\n\nThe following errors occurred during the execution of the Map/Reduce script:\n\n';
        errorList.forEach(function (error) {
            body += 'Error: ' + error.error + '\n';
            body += 'Stack Trace: ' + error.stack + '\n';
            body += 'Sales Order ID: ' + error.soID + '\n';
            body += 'Record Link: ' + error.link + '\n\n';
        });

        body += '\nBest Regards,\nYour Automation System';
        return body;
    }


    /**
     * Attempts to execute a given operation function with retries.
     * 
     * This function will try to run the provided `operation` up to `maxRetries` times. 
     * The function receives the `operation` and any parameters needed to execute it via the `params` array.
     * 
     * - If the `operation` succeeds (indicated by `result.success` being `true`), the loop ends, and the result is returned.
     * - If the operation fails, the function will retry until the maximum number of attempts (`maxRetries`) is reached.
     * - If the operation continues to fail after the maximum number of retries, an error is logged, and `false` is returned.
     * 
     * @param {Function} operation - The function to be executed. It is expected to return an object with a `success` property.
     * @param {number} maxRetries - The maximum number of times to retry the operation in case of failure.
     * @param {Array} params - An array of parameters to be passed to the `operation` function.
     * @returns {Object|boolean} - Returns the result of the operation if successful, or `false` if all retries fail.
     * 
     */

    function attemptWithRetry(operation, maxRetries, params) {
        var attempt = 0;
        var result;
        var success = false;

        while (attempt < maxRetries && !success) {
            try {
                result = operation.apply(null, params);
                if (result && result.success) {
                    success = true; // Set success to true if the operation succeeded
                } else {
                    attempt++;
                    log.error('Retry Error', 'Attempt ' + attempt + ' failed: Operation did not succeed.');
                }
            } catch (e) {
                log.error('Retry Error', 'Attempt ' + (attempt + 1) + ' failed: ' + e.message);
                attempt++;
            }

            if (attempt < maxRetries && !success) {
                log.audit('Retrying...', 'Retry attempt ' + (attempt + 1));
            }
        }

        if (!success) {
            log.error('Failed after retries', 'Operation could not be completed.');
            return false; // Return false if all retries failed
        }

        return result;
    }


    /**
     * Converts an ISO 8601 date string to a formatted date string in "MM/DD/YYYY" format.
     *
     * @param {string} isoDateStr - A date string in ISO 8601 format (e.g., "2024-07-05T07:00:00.000Z").
     * @returns {string} The formatted date string in "MM/DD/YYYY" format.
     *
     */
    function formatISODateToMMDDYYYY(isoDateStr) {
        // Create a new Date object from the ISO date string
        var date = new Date(isoDateStr);

        // Extract the month, day, and year
        var month = ('0' + (date.getUTCMonth() + 1)).slice(-2); // Add leading zero if needed
        var day = ('0' + date.getUTCDate()).slice(-2);          // Add leading zero if needed
        var year = date.getUTCFullYear();

        // Return the formatted date as "MM/DD/YYYY"
        return month + '/' + day + '/' + year;
    }



    //     /**
    //  * Logs an error message with detailed context information.
    //  * 
    //  * Logs an error entry with the phase in which the error occurred, the error message,
    //  * stack trace, and additional context for troubleshooting.
    //  * 
    //  * @param {string} phase - The phase where the error occurred.
    //  * @param {Error} e - The error object containing the message and stack trace.
    //  * @param {Object} context - Additional context or data related to the error.
    //  * 
    //  * @returns {void}
    //  */
    //     function logError(phase, e, context) {
    //         log.error({
    //             title: 'Error in ' + phase + ' phase',
    //             details: 'Error Message: ' + e.message + '\nStack Trace: ' + e.stack + '\nContext: ' + JSON.stringify(context)
    //         });
    //     }


    //     function logStageErrors(summary) {

    //         if (summary.inputSummary.error) {
    //             log.error('Input Stage Error', summary.inputSummary.error);
    //         }
    //         summary.mapSummary.errors.iterator().each(function (key, error) {
    //             log.error('Map Stage Error', 'Key: ' + key + ' Error: ' + error);
    //             return true;
    //         });
    //         summary.reduceSummary.errors.iterator().each(function (key, error) {
    //             log.error('Reduce Stage Error', 'Key: ' + key + ' Error: ' + error);
    //             return true;
    //         });

    //     }

    //     function calculateFutureDate(dateStr, daysIntoFuture) {
    //         var startDate = parseDate(dateStr);
    //         if (!startDate) {
    //             throw new Error('Invalid date format');
    //         }

    //         var futureDate = new Date(startDate);
    //         futureDate.setDate(startDate.getDate() + daysIntoFuture);

    //         return futureDate;
    //     }



    return {
        getInputData: getInputData,
        map: map,
        reduce: reduce,
        summarize: summarize
    };
});
