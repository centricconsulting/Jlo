/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/search', 'N/record', 'N/email', 'N/runtime', 'N/log'], (search, record, email, runtime, log) => {


    function getInputData() {
        log.audit('<<< START >>>', 'Start of script execution');
        log.debug('in getInputData')
        var dateParameter = runtime.getCurrentScript().getParameter('custscript_cm_tran_date');
        dateParameter = formatISODateToMMDDYYYY(dateParameter.toString())
        var oldInstallmentItem = runtime.getCurrentScript().getParameter('custscript_old_installment_item');
        var adjustmnentItem = runtime.getCurrentScript().getParameter('custscript_amount_adjust_item');
        log.audit('parameters', oldInstallmentItem + ":" + adjustmnentItem + ":" + dateParameter);

        //     var suiteQL = `
        //         SELECT tran.id,
        //         tran.status
        //         FROM transaction AS tran
        //         JOIN transactionline AS line ON tran.id = line.transaction
        //         WHERE tran.recordType = 'creditmemo'
        //         AND tran.status = 'CustCred:B'
        //         AND tran.custbody_jlo_forecasted_inv = 'F'
        //  --       AND line.item NOT IN (discountReplacementItem, discountReplacementItemLine, invkitReplacementItemLine, shippingReplacementItemLine)
        //     `;

        var suiteQL = `
            SELECT distinct tran.id
            FROM transaction AS tran
            JOIN transactionline AS line ON tran.id = line.transaction
            WHERE tran.recordType = 'creditmemo'
                AND nvl(tran.custbody_jlo_forecasted_inv, 'F') = 'F'
                AND nvl(tran.custbody_cancellation_cm, 'F') = 'F'
                AND nvl(tran.custbody_gl_update_script_processed,'F') = 'F'
                --AND tran.id=2160325
                --AND tran.id=3196027
                and tran.trandate >= to_date(?,'MM/DD/YYYY')
            minus
            select distinct t.id
            from transaction t, transactionline tl
            where t.id = tl.transaction
                --and tl.item in ( 7891,7894)  -- ACCT_ADJUSTMENTS/REFUNDS, INS001
                and tl.item in (?,?)
                and t.recordtype = 'creditmemo'
            order by 1 desc
        `;

        var paramsList = [dateParameter,adjustmnentItem,oldInstallmentItem];

        return {
            type: 'suiteql',
            query: suiteQL,
            params: paramsList
        };


    }

    function map(context) {
        log.debug('in Map')
        var value = JSON.parse(context.value);
        log.debug('value', value);
        var key = value.values[0];
        context.write({
            key: key,
            value: JSON.stringify(value)
        });
    }

    function reduce(context) {
        log.debug('in Reduce')
        return;

        var discountReplacementItem = runtime.getCurrentScript().getParameter({name: 'custscript_discount_item'});
        var discountReplacementItemLine = runtime.getCurrentScript().getParameter({name: 'custscript_line_discount_item'});
        var discountOriginalItemLine = runtime.getCurrentScript().getParameter({name: 'custscript_original_line_discount_item'});
        var invkitReplacementItemLine = runtime.getCurrentScript().getParameter({name: 'custscript_inv_kit_item'});
        var shippingReplacementItemLine = runtime.getCurrentScript().getParameter({name: 'custscript_shipping_item'});
        var shippingOriginalItemLine = runtime.getCurrentScript().getParameter({name: 'custscript_original_shipping_item'});


        var creditMemoId = context.key; //Credit Memo Internal ID
        log.audit('creditMemoId', creditMemoId);

        var logMessages = [];

        try {

            //Load the Credit Memo
            var creditMemo = record.load({ type: record.Type.CREDIT_MEMO, id: creditMemoId });

            //Check the Credit Memo Type
            var isSubscriptionOrChoiceBundle = creditMemo.getValue('custbody_cen_jlo_instal_ord') || creditMemo.getValue('custbody_cen_jlo_choice');
            var isDigitalPaymentOrder = creditMemo.getValue('custbody_cen_jlo_digital_pmt_ord');
            log.debug('CM Type', 'isSubscriptionOrChoiceBundle: ' + isSubscriptionOrChoiceBundle + ', isDigitalPaymentOrder: ' + isDigitalPaymentOrder);


            var lineCount = creditMemo.getLineCount({ sublistId: 'item' });


            var processCreditMemo = true;
            if (isSubscriptionOrChoiceBundle || isDigitalPaymentOrder) {

                var cmCreatedFrom = creditMemo.getValue('createdfrom');
                var relatedInvoice = record.load({ type: record.Type.INVOICE, id: cmCreatedFrom });
                var cmCreatedFromLineCount = relatedInvoice.getLineCount({ sublistId: 'item' });
                var hasNonEmptyInvoice1 = false;

                for (var i = 0; i < cmCreatedFromLineCount; i++) {
                    var invoice1 = relatedInvoice.getSublistValue({ sublistId: 'item', fieldId: 'custcol_jlo_inv_1', line: i });
                    log.debug('invoice1', invoice1);

                    // Check if the current line has a non-empty invoice1
                    if (invoice1) {
                        hasNonEmptyInvoice1 = true;
                        break; // Exit loop early if at least one non-empty invoice1 is found
                    }
                }
                // Set processCreditMemo based on whether any line had a non-empty invoice1
                if (!hasNonEmptyInvoice1) {
                    log.audit('Invoice Line Empty', 'Related Invcoie: ' + cmCreatedFrom + ', All lines had empty Invoice #1');
                    logMessages.push('Skipped Credit Memo: ' + creditMemoId + ', due to all lines having empty Invoice #1.');
                    processCreditMemo = false;
                }
            }

            if (processCreditMemo) {
                // Handle Header Level Discount using the helper function
                handleHeaderDiscount(creditMemo, discountReplacementItem);

                //for (var i = lineCount - 1; i >= 0; i--) {
                for (var i = 0; i < lineCount; i++) {
                    var item = creditMemo.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'item',
                        line: i
                    });
                    log.debug('item', item);

                    if (item == shippingOriginalItemLine) { // Shopify Shipping Cost
                        updateCreditMemoLine(creditMemo, i, shippingReplacementItemLine, null, null, null, false);
                    } else if (item == discountOriginalItemLine) { // Shopify Line Discount - New
                        updateCreditMemoLine(creditMemo, i, discountReplacementItemLine, null, null, null, true);
                    } else if (isInventoryOrKitItem(item)) {
                        updateCreditMemoLine(creditMemo, i, invkitReplacementItemLine, null, null, null, false);
                    }
                }

                creditMemo.setValue('custbody_gl_update_script_processed', true);
                creditMemo.save();
                logMessages.push('Processed Credit Memo ' + creditMemoId);

                if (isSubscriptionOrChoiceBundle || isDigitalPaymentOrder) {
                    var processCreditMemoResults = processCreditMemoForSpecialCases(creditMemo, creditMemoId, relatedInvoice, 
                        cmCreatedFrom, isSubscriptionOrChoiceBundle, isDigitalPaymentOrder);
                    log.debug('processCreditMemoResults', processCreditMemoResults);
                    processCreditMemoResults.errors.forEach(function (errorMessage) {
                        logMessages.push(errorMessage);
                    });
                }
            }
        } catch (e) {
            logMessages.push('Error processing Credit Memo ' + creditMemoId + ': ' + e.message);
        }

        context.write({ key: creditMemoId, value: logMessages });
    }

    function summarize(summary) {
        var EMAIL_SEND_LIST = runtime.getCurrentScript().getParameter('custscript_email_send_list');
        var EMAIL_AUTHOR = runtime.getCurrentScript().getParameter('custscript_email_author');

        var logMessages = [];

        summary.mapSummary.errors.iterator().each(function (key, error, executionNo) {
            logMessages.push('Map Error: ' + key + ' - ' + error);
            return true;
        });

        summary.reduceSummary.errors.iterator().each(function (key, error, executionNo) {
            logMessages.push('Reduce Error: ' + key + ' - ' + error);
            return true;
        });

        summary.output.iterator().each(function (key, value) {
            logMessages = logMessages.concat(JSON.parse(value));
            return true;
        });

        var emailBody = 'Map/Reduce Script Summary:\n\n';
        emailBody += 'Processed Credit Memos:\n' + logMessages.join('\n') + '\n';

        log.debug('emailBody', emailBody);

        email.send({
            author: EMAIL_AUTHOR,
            recipients: EMAIL_SEND_LIST,
            subject: 'Credit Memo Processing Summary',
            body: emailBody
        });
    }



    //HELPER FUNCTIONS

    /**
 * Handles the Header Level Discount for a given credit memo.
 * 
 * This function checks if a header-level discount is applied to the credit memo. 
 * If a discount exists, it replaces the discount item with the predefined 
 * 'ACCT_SHOPIFY_CART_DISCOUNT_CREDIT' item and retains the original discount rate.
 * 
 * @param {Record} creditMemo - The credit memo record being processed.
 * @returns {void}
 */

    function handleHeaderDiscount(creditMemo, discountReplacementItem) {
        // Retrieve Header Level Discount
        var headerDiscount = creditMemo.getValue('discountitem');
        log.debug('headerDiscount', headerDiscount);

        // If a Header Level Discount exists, replace the discount item with ACCT_SHOPIFY_CART_DISCOUNT_CREDIT.
        if (headerDiscount) {
            var headerDiscountRate = creditMemo.getValue('discountrate');
            log.debug('headerDiscountRate', headerDiscountRate);

            // Set the discount item and rate
            creditMemo.setValue({
                fieldId: 'discountitem',
                value: discountReplacementItem // 'ACCT_SHOPIFY_CART_DISCOUNT_CREDIT'
            });
            creditMemo.setValue({
                fieldId: 'discountrate',
                value: headerDiscountRate
            });
        }
    }



    /**
* Processes a credit memo to handle special cases such as subscription orders, choice bundles, and digital installment payments.
* 
* @param {Object} creditMemo - The credit memo record being processed.
* 
* The function first retrieves the related invoice from which the credit memo was created. 
* It then iterates over each line item in the credit memo, checking the rate for each line.
* For each line, it attempts to find a corresponding line in the related invoice using the provided rate.
* 
* If a match is found, the function handles specific scenarios based on custom body fields:
* 1. If the credit memo is related to a subscription or choice bundle, it creates additional credit memos for forecasted invoices.
* 2. If the credit memo is for a digital installment payment, it processes the payment accordingly.
* 
* This function is used to ensure that credit memos are processed correctly in cases where special handling is required.
*/

    function processCreditMemoForSpecialCases(creditMemo, creditMemoId, relatedInvoice, relatedInvoiceId, isSubscriptionOrChoiceBundle, isDigitalPaymentOrder) {
        var result = {
            errors: [],
            successes: []
        };

        //  var relatedInvoiceId = creditMemo.getValue('createdfrom');
        //log.debug('relatedInvoiceId', relatedInvoiceId);
        // var installOrder = creditMemo.getValue('custbody_cen_jlo_instal_ord')
        // var choiceBundle = creditMemo.getValue('custbody_cen_jlo_choice')
        // var digitalPayment = creditMemo.getValue('custbody_cen_jlo_digital_pmt_ord')

        var matchingLines = [];

        var lineCount = creditMemo.getLineCount({ sublistId: 'item' });
        for (var i = 0; i < lineCount; i++) {

            var rate = creditMemo.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: i });
            var invOne = creditMemo.getSublistValue({ sublistId: 'item', fieldId: 'custcol_jlo_inv_1', line: i });
            //var item = creditMemo.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i});
            var subscriptionFlag = creditMemo.getSublistValue({ sublistId: 'item', fieldId: 'custcol_shpfy_subscrptn_flg', line: i });
            var eTailLineId = creditMemo.getSublistValue({ sublistId: 'item', fieldId: 'custcol_celigo_etail_order_line_id', line: i });
            
            log.debug('line','CM Rate: ' + rate + ', invOne: ' + invOne + ', subscriptionFlag: ' + subscriptionFlag
                + ", eTailLineId: " + eTailLineId);

            // Mazuk - check if subscription flag is set - this covers choice, subscription, and installment payments. if set, skip this record
            //log.debug("shipping item check",item + ":" + shippingLineItem);
            //if (item === shippingLineItem ) {
            if (!subscriptionFlag) {
                log.debug("skipping non subscription item",subscriptionFlag);
                // skip this line
            } else if (rate != 0) {

                if (isSubscriptionOrChoiceBundle) {
                    // Find the corresponding line in the invoice
                    var invoiceLine = findMatchingInvoiceLineNoItem(relatedInvoice, rate);
                    log.debug('matching invoiceLine', invoiceLine);

                    if (invoiceLine !== -1) {

                        var invoiceLineSubCheck = relatedInvoice.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'custcol_shpfy_subscrptn_flg',
                            line: invoiceLine
                        }) === 'Y';
                        log.debug('invoiceLineSubCheck', invoiceLineSubCheck)

                        var invoiceLineChoiceCheck = relatedInvoice.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'custcolshpfy_bndl_id',
                            line: invoiceLine
                        });
                        log.debug('invoiceLineChoiceCheck', invoiceLineChoiceCheck)

                        if (invoiceLineSubCheck || invoiceLineChoiceCheck) {
                            matchingLines.push({ creditMemoLine: i, invoiceLine: invoiceLine, rate: rate });
                        }
                    }
                }

                if (isDigitalPaymentOrder) {
                    // Find the corresponding line in the invoice
                    var invoiceLine = findMatchingInvoiceLine(relatedInvoice, eTailLineId);
                    log.debug('matching invoiceLine', invoiceLine);

                    if (invoiceLine !== -1) {
                        matchingLines.push({ creditMemoLine: i, invoiceLine: invoiceLine, rate: rate });
                    }
                }
            }
        }

        log.debug('matchingLines', matchingLines);
        // Only proceed if there are matching lines
        if (matchingLines.length > 0) {
            // Handle subscription or choice bundle
            if (isSubscriptionOrChoiceBundle) {
                var forecastResult = createCreditMemosForForecastedInvoices(creditMemo, relatedInvoice, matchingLines, creditMemoId, relatedInvoiceId);
                result.errors = result.errors.concat(forecastResult.errors);
                result.successes = result.successes.concat(forecastResult.successes);
            }

            // Handle digital installment payment
            if (isDigitalPaymentOrder) {
                var digitalResult = handleDigitalInstallmentPayment(creditMemo, relatedInvoice, matchingLines, creditMemoId, relatedInvoiceId);
                result.errors = result.errors.concat(digitalResult.errors);
                result.successes = result.successes.concat(digitalResult.successes);
            }

        } else {
            result.errors.push('No matching lines found to process credit memos. CM: ' + creditMemoId + ', INV: ' + relatedInvoiceId);
        }

        // Save the updated invoice
        relatedInvoice.save();

        // Log or handle the final result
        log.debug('Processing Result', result);

        return result;
    }

    /**
 * Finds the line on an invoice where the rate matches the specified rate.
 *
 * @param {Record} invoice - The NetSuite invoice record.
 * @param {number|string} rate - The rate to search for within the invoice lines.
 * @returns {number} - The index of the matching line, or -1 if no match is found.
 *
 * The function loops through all the lines in the 'item' sublist of the provided invoice record.
 * For each line, it retrieves the rate and compares it to the given rate.
 * If a match is found, the index of the line is returned.
 * If no match is found after checking all lines, the function returns -1.
 */
    function findMatchingInvoiceLineNoItem(invoice, rate) {
        var lineCount = invoice.getLineCount({ sublistId: 'item' });
        for (var p = 0; p < lineCount; p++) {
            var invoiceRate = invoice.getSublistValue({
                sublistId: 'item',
                fieldId: 'rate',
                line: p
            });
            log.debug('invoiceRate', invoiceRate)

            if (invoiceRate === rate) {
                return p;
            }
        }
        return -1;
    }

    /**
 * Finds the line on an invoice where the rate matches the specified rate.
 *
 * @param {Record} invoice - The NetSuite invoice record.
 * @param {number|string} rate - The rate to search for within the invoice lines.
 * @returns {number} - The index of the matching line, or -1 if no match is found.
 *
 * The function loops through all the lines in the 'item' sublist of the provided invoice record.
 * For each line, it retrieves the rate and compares it to the given rate.
 * If a match is found, the index of the line is returned.
 * If no match is found after checking all lines, the function returns -1.
 */
    function findMatchingInvoiceLine(invoice, rate, invOne) {
        var lineCount = invoice.getLineCount({ sublistId: 'item' });
        for (var i = 0; i < lineCount; i++) {
            var invoiceRate = invoice.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: i });

            var invoiceOneValue = invoice.getSublistValue({ sublistId: 'item', fieldId: 'custcol_jlo_inv_1', line: i });

            if (invoiceRate === rate && invoiceOneValue === invOne) {
                return i;
            }
        }
        return -1;
    }

    // using this since we can't count on invoice #1 being populated on the credit memo
    function findMatchingInvoiceLine(invoice, eTailLineId) {
        var lineCount = invoice.getLineCount({ sublistId: 'item' });
        for (var i = 0; i < lineCount; i++) {
            var lineEtailLineId = invoice.getSublistValue({ sublistId: 'item', fieldId: 'custcol_celigo_etail_order_line_id', line: i });

            if (lineEtailLineId === eTailLineId) {
                return i;
            }
        }
        return -1;
    }


    /**
* Creates credit memos for forecasted invoices based on the provided credit memo and the related invoice.
* 
* @param {Object} creditMemo - The credit memo record being processed.
* @param {Object} invoice - The related invoice record from which the credit memo was generated.
* @param {number} invoiceLine - The line number in the invoice that corresponds to the credit memo line.
* 
* The function checks if there are any forecasted invoices linked to the specific line in the invoice.
* It retrieves the IDs of the forecasted invoices from custom fields (`custcol_jlo_inv_2_fore` and `custcol_jlo_inv_3_fore`).
* 
* If forecasted invoice IDs are found, the function calls `createCreditMemoFromInvoice` to create new credit memos
* based on these forecasted invoices and links them to the original credit memo.
* 
* This ensures that any forecasted invoices related to the original transaction are properly credited.
*/

    function createCreditMemosForForecastedInvoices(creditMemo, invoice, matchingLines, creditMemoId, relatedInvoiceId) {
        var result = {
            errors: [],
            successes: []
        };

        // If forecasted invoices exist, process them using the matching lines
        if (matchingLines.length > 0) {
            // Get forecasted invoice IDs from the first matching line (assuming all relevant lines are linked to the same forecasted invoices)
            var invoiceLine = matchingLines[0].invoiceLine;
            var forecastedInvoice2Id = invoice.getSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_jlo_inv_2_fore',
                line: invoiceLine
            });

            var forecastedInvoice3Id = invoice.getSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_jlo_inv_3_fore',
                line: invoiceLine
            });

            // Process Forecasted Invoice #2
            if (forecastedInvoice2Id) {
                try {
                    var createResult = createCreditMemoFromInvoice(forecastedInvoice2Id, creditMemo, invoice, matchingLines, creditMemoId, relatedInvoiceId, 2);
                    result.errors = result.errors.concat(createResult.errors);
                    result.successes = result.successes.concat(createResult.successes);
                } catch (error) {
                    result.errors.push('Failed to create credit memo for Forecasted Invoice #2. CM: ' + creditMemoId + ', INV: ' + relatedInvoiceId + ', Error: ' + error.message);
                }
            } else {
                result.errors.push('Forecasted Invoice #2 does not exist. CM: ' + creditMemoId + ', INV: ' + relatedInvoiceId);
            }

            // Process Forecasted Invoice #3
            if (forecastedInvoice3Id) {
                try {
                    var createResult = createCreditMemoFromInvoice(forecastedInvoice3Id, creditMemo, invoice, matchingLines, creditMemoId, relatedInvoiceId, 3);
                    result.errors = result.errors.concat(createResult.errors);
                    result.successes = result.successes.concat(createResult.successes);
                } catch (error) {
                    result.errors.push('Failed to create credit memo for Forecasted Invoice #3. CM: ' + creditMemoId + ', INV: ' + relatedInvoiceId + ', Error: ' + error.message);
                }
            } else {
                result.errors.push('Forecasted Invoice #3 does not exist. CM: ' + creditMemoId + ', INV: ' + relatedInvoiceId);
            }
        } else {
            result.errors.push('No matching lines found to process credit memos. CM: ' + creditMemoId + ', INV: ' + relatedInvoiceId);
        }

        return result;
    }

    /**
* Handles digital installment payments by creating credit memos for forecasted invoices based on payment information.
* 
* @param {Object} creditMemo - The credit memo record being processed.
* @param {Object} invoice - The related invoice record from which the credit memo was generated.
* @param {number} invoiceLine - The line number in the invoice that corresponds to the credit memo line.
* 
* The function first retrieves the payment number from the specified line in the invoice using a custom field (`custcolcustcol_shpfy_inst_num`).
* 
* If the payment number is 2, it then checks for the presence of a forecasted invoice ID linked to that line (`custcol_forecasted_invoice_3`).
* 
* If the forecasted invoice ID is found, the function calls `createCreditMemoFromInvoice` to generate a credit memo based on this forecasted invoice,
* linking it to the original credit memo.
* 
* This function ensures that digital installment payments are appropriately accounted for by creating the necessary credit memos for forecasted invoices.
*/
    function handleDigitalInstallmentPayment(creditMemo, invoice, matchingLines, creditMemoId, relatedInvoiceId) {
        var result = {
            errors: [],
            successes: []
        };

        // A dictionary to group matching lines by `invoiceOne`
        var groupedLinesByInvoiceOne = {};

        // Group matching lines by `invoiceOne`
        matchingLines.forEach(function (linePair) {
            var invoiceLine = linePair.invoiceLine;

            // Retrieve the invoiceOne value for each line
            var invoiceOne = invoice.getSublistValue({ sublistId: 'item', fieldId: 'custcol_jlo_inv_1', line: invoiceLine });
            log.debug('invoiceOne', invoiceOne);

            // Add `invoiceOne` to the linePair object
            linePair.invoiceOne = invoiceOne;

            var installNum = invoice.getSublistValue({ sublistId: 'item', fieldId: 'custcolcustcol_shpfy_inst_num', line: invoiceLine });
            log.debug('installNum', installNum);

            // Group lines by `invoiceOne`
            if (invoiceOne && installNum == 2) {
                if (!groupedLinesByInvoiceOne[invoiceOne]) {
                    groupedLinesByInvoiceOne[invoiceOne] = [];
                }
                groupedLinesByInvoiceOne[invoiceOne].push(linePair);
            } else {
                result.errors.push('Invoice One with Install Num 2 does not exist on the current Invoice and line. CM: ' + creditMemoId + ', INV: ' + relatedInvoiceId + ', Line: ' + invoiceLine);
            }
        });

        log.debug('groupedLinesByInvoiceOne', groupedLinesByInvoiceOne);

        // Iterate over each group of matching lines with the same `invoiceOne`
        Object.keys(groupedLinesByInvoiceOne).forEach(function (invoiceOne) {
            try {
                log.debug('invoiceOne', invoiceOne);

                var invoiceOneLoaded = record.load({ type: record.Type.INVOICE, id: invoiceOne });

                // Flag to track if a credit memo has been created for this group
                var creditMemoCreated = false;

                // Get all matching lines for this `invoiceOne`
                var groupedLines = groupedLinesByInvoiceOne[invoiceOne];
                log.debug('groupedLines', groupedLines);

                // Iterate over the grouped lines to find the `forecastedInvoice3Id`
                groupedLines.forEach(function (linePair, index) {

                    log.debug({
                        title: 'Iteration Info',
                        details: 'Index: ' + index + ', Rate: ' + linePair.rate
                    });

                    var invoiceLine = linePair.invoiceLine;
                    log.debug('invoiceLine', invoiceLine);

                    var invoiceOneLineCount = invoiceOneLoaded.getLineCount({ sublistId: 'item' });
                    log.debug('invoiceOneLineCount', invoiceOneLineCount);

                    for (var d = 0; d < invoiceOneLineCount; d++) {

                        var invoiceOneRate = invoiceOneLoaded.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'rate',
                            line: d
                        });

                        if (invoiceOneRate == linePair.rate) {
                            log.debug('d', d)
                            var forecastedInvoice3Id = invoiceOneLoaded.getSublistValue({
                                sublistId: 'item',
                                fieldId: 'custcol_jlo_inv_3_fore',
                                line: d
                            });
                            log.debug('forecastedInvoice3Id', forecastedInvoice3Id);

                            if (forecastedInvoice3Id) {
                                // Create the credit memo only once per group
                                if (!creditMemoCreated) {
                                    try {
                                        log.debug('about to create');
                                        var createResult = createCreditMemoFromInvoice(forecastedInvoice3Id, creditMemo, invoice, groupedLines, creditMemoId, relatedInvoiceId, 3, invoiceOneLoaded);
                                        result.errors = result.errors.concat(createResult.errors);
                                        result.successes = result.successes.concat(createResult.successes);
                                        creditMemoCreated = true; // Set the flag to true once the credit memo is created
                                    } catch (error) {
                                        result.errors.push('Failed to create credit memo for digital installment payment: CM: ' + creditMemoId + ', INV: ' + relatedInvoiceId + ', Line: ' + invoiceLine + ', Error: ' + error.message);
                                    }
                                }
                            } else {
                                result.errors.push('Forecasted Invoice #3 does not exist for Invoice One on the current Invoice and line. CM: ' + creditMemoId + ', INV: ' + relatedInvoiceId + ', Line: ' + invoiceLine);
                            }
                        }
                    }

                });
            } catch (error) {
                result.errors.push('Failed to load Invoice One: ' + invoiceOne + '. Error: ' + error.message);
            }
        });

        return result;
    }

    /**
* Creates a credit memo from a forecasted invoice based on the provided forecasted invoice ID and original credit memo.
* 
* @param {number} forecastedInvoiceId - The ID of the forecasted invoice from which the credit memo will be created.
* @param {Object} originalCreditMemo - The original credit memo record used to derive certain field values.
* 
* The function first loads the forecasted invoice record using the given ID.
* It then transforms the invoice into a credit memo record.
* 
* The credit memo is populated with specific values:
* - The transaction date (`trandate`) is set to match the date of the original credit memo.
* - The account is set based on predefined logic or requirements
* 
* Finally, the newly created credit memo is saved.
* 
* This function ensures that credit memos are correctly generated and associated with forecasted invoices while adhering to accounting requirements.
*/
    function createCreditMemoFromInvoice(forecastedInvoiceId, originalCreditMemo, invoice, matchingLines, creditMemoId, relatedInvoiceId, cmNumber, digitalPaymentInvoiceOne) {
        var result = {
            errors: [],
            successes: []
        };

        var discountReplacementItem = runtime.getCurrentScript().getParameter({name: 'custscript_discount_item'});
        var discountReplacementItemLine = runtime.getCurrentScript().getParameter({name: 'custscript_line_discount_item'});
        var discountOriginalItemLine = runtime.getCurrentScript().getParameter({name: 'custscript_original_line_discount_item'});
        var invkitReplacementItemLine = runtime.getCurrentScript().getParameter({name: 'custscript_inv_kit_item'});
        var shippingReplacementItemLine = runtime.getCurrentScript().getParameter({name: 'custscript_shipping_item'});
        var shippingOriginalItemLine = runtime.getCurrentScript().getParameter({name: 'custscript_original_shipping_item'});

        try {
            log.debug('matchingLines', matchingLines);
            // Transform the forecasted invoice into a credit memo
            var creditMemo = record.transform({
                fromType: record.Type.INVOICE,
                fromId: forecastedInvoiceId,
                toType: record.Type.CREDIT_MEMO
            });

            // Set the transaction date to match the original credit memo
            creditMemo.setValue({ fieldId: 'trandate', value: originalCreditMemo.getValue('trandate') });
            creditMemo.setValue({ fieldId: 'custbody_cancellation_cm', value: true });

            var headerDiscount = creditMemo.getValue('discountitem');
            //If a Header Level Discount exists, replace the discount item with ACCT_SHOPIFY_CART_DISCOUNT_CREDIT. 
            if (headerDiscount) {
                var headerDiscountRate = creditMemo.getValue('discountrate');
                creditMemo.setValue({
                    fieldId: 'discountitem',
                    value: discountReplacementItem // 'ACCT_SHOPIFY_CART_DISCOUNT_CREDIT'
                });
                creditMemo.setValue({
                    fieldId: 'discountrate',
                    value: headerDiscountRate
                });
            }

            log.debug('matchingLines', matchingLines)
            // Remove all lines that are not in matchingLines
            var lineCount = creditMemo.getLineCount({ sublistId: 'item' });
            for (var n = lineCount - 1; n >= 0; n--) {
                // Get the invoiceLine for the current line
                var currentInvoiceLine = creditMemo.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: n });
                var currentInvoiceLineIsShipping = creditMemo.getSublistValue({ sublistId: 'item', fieldId: 'item', line: n }) == shippingOriginalItemLine;
                log.debug('currentInvoiceLineIsShipping', currentInvoiceLineIsShipping)


                // Initialize flag for matching line
                var isMatchingLine = false;
                // Check if the current line exists in matchingLines
                for (var x = 0; x < matchingLines.length; x++) {
                    if (matchingLines[x].rate === currentInvoiceLine) {
                        isMatchingLine = true;
                        break;
                    }
                }

                // Remove line if it does not match
                if (!isMatchingLine && !currentInvoiceLineIsShipping) {
                    log.debug('Removing line: ' + n);
                    creditMemo.removeLine({ sublistId: 'item', line: n });
                } else {
                    var cmLine = 'custcol_jlo_inv_' + cmNumber + '_fore'
                    creditMemo.setSublistValue({ sublistId: 'item', fieldId: cmLine, line: n, value: forecastedInvoiceId });
                }
            }

            var lineCountNew = creditMemo.getLineCount({ sublistId: 'item' });
            log.debug('lineCountNew', lineCountNew);

            for (var w = 0; w < lineCountNew; w++) {
                var item = creditMemo.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'item',
                    line: w
                });

                if (item == shippingOriginalItemLine) { //Shopify Shipping Cost
                    updateCreditMemoLine(creditMemo, w, shippingReplacementItemLine, forecastedInvoiceId, null, cmNumber, false);
                } else if (item == discountOriginalItemLine) { //Shopify Line Discount - New
                    updateCreditMemoLine(creditMemo, w, discountReplacementItemLine, forecastedInvoiceId, null, cmNumber, false);
                } else if (isInventoryOrKitItem(item)) {
                    updateCreditMemoLine(creditMemo, w, invkitReplacementItemLine, forecastedInvoiceId, null, cmNumber, false);
                }
            }

            refreshCMApplication(creditMemo, forecastedInvoiceId)

            // Save the credit memo

            var cmCreated = creditMemo.save();
            log.debug('cmCreated', cmCreated);

            result.successes.push('Credit memo created from forecasted invoice ID: ' + forecastedInvoiceId);

            if (cmCreated) {
                log.audit('Credit Memo Created:', cmCreated);
                var cmField = 'custcol_jlo_cm_' + cmNumber + '_fore';

                // Set the reference to the newly created credit memo on the Created From invoice. In the case of subscription Invoice, this is also Invoice #1
                matchingLines.forEach(function (linePair) {
                    invoice.setSublistValue({ sublistId: 'item', fieldId: cmField, line: linePair.invoiceLine, value: cmCreated });
                });


                // Set the reference to the newly created credit memo on the Forecasted invoice(s)
                var forecastedInvoice = record.load({
                    type: record.Type.INVOICE,
                    id: forecastedInvoiceId
                });
                var lineCountForecastedInvoice = forecastedInvoice.getLineCount({ sublistId: 'item' });
                var isMatchingLineRate = false;

                matchingLines.forEach(function (linePair) {
                    log.debug('linePair', linePair)

                    for (var y = 0; y < lineCountForecastedInvoice; y++) {
                        var forecastedInvoiceLineRate = forecastedInvoice.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: y });
                        log.debug('forecastedInvoiceLineRate', forecastedInvoiceLineRate)

                        if (linePair.rate === forecastedInvoiceLineRate) {
                            isMatchingLineRate = true;
                            break;
                        }
                    }

                    if (isMatchingLineRate) {
                        forecastedInvoice.setSublistValue({ sublistId: 'item', fieldId: cmField, line: y, value: cmCreated });
                    }
                });



                var foreCastedInvoiceUpdated = forecastedInvoice.save();
                log.audit('Forecasted Invoice Updated with Cancellation CM Link', foreCastedInvoiceUpdated);


                // Set the reference to the newly created credit memo on Invoice One. This is for Digital Payments only

                if (digitalPaymentInvoiceOne) {
                    var lineCountInvoiceOne = digitalPaymentInvoiceOne.getLineCount({ sublistId: 'item' });
                    var isMatchingLineRateInvoiceOne = false;
                    var invoiceOneCreatedFromSO = digitalPaymentInvoiceOne.getValue('createdfrom');

                    var salesOrderOne = record.load({
                        type: record.Type.SALES_ORDER,
                        id: invoiceOneCreatedFromSO
                    });
                    var invoiceOneSOLineCount = salesOrderOne.getLineCount({ sublistId: 'item' });
                    var isMatchingInvoiceOneCreatedFromSO = false;


                    matchingLines.forEach(function (linePair) {
                        log.debug('linePair', linePair)

                        for (var e = 0; e < lineCountInvoiceOne; e++) {
                            var digitalPaymentInvoiceOneLineRate = digitalPaymentInvoiceOne.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: e });
                            log.debug('digitalPaymentInvoiceOneLineRate', digitalPaymentInvoiceOneLineRate)

                            if (linePair.rate === digitalPaymentInvoiceOneLineRate) {
                                isMatchingLineRateInvoiceOne = true;
                                break;
                            }
                        }

                        if (isMatchingLineRateInvoiceOne) {
                            digitalPaymentInvoiceOne.setSublistValue({
                                sublistId: 'item', fieldId: cmField, line: e, value: cmCreated
                            });
                        }

                        if (salesOrderOne) {
                            for (var c = 0; c < invoiceOneSOLineCount; c++) {
                                var invoiceOneSOLineRate = salesOrderOne.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: c });
                                log.debug('invoiceOneSOLineRate', invoiceOneSOLineRate)

                                if (linePair.rate === invoiceOneSOLineRate) {
                                    isMatchingInvoiceOneCreatedFromSO = true;
                                    break;
                                }
                            }

                            if (isMatchingInvoiceOneCreatedFromSO) {
                                salesOrderOne.setSublistValue({
                                    sublistId: 'item', fieldId: cmField, line: c, value: cmCreated
                                });

                            }
                        }
                    });
                    var digitalPaymentInvoiceOneUpdated = digitalPaymentInvoiceOne.save();
                    log.audit('Invoice One Updated with Cancellation CM Link', digitalPaymentInvoiceOneUpdated);
                    var salesOrderOneUpdated = salesOrderOne.save();
                    log.audit('Original Sales Order Updated with Cancellation CM Link', salesOrderOneUpdated);

                } else {

                    var originalSO = invoice.getValue('createdfrom');
                    var salesOrderOne = record.load({
                        type: record.Type.SALES_ORDER,
                        id: originalSO
                    });
                    var invoiceOneSOLineCount = salesOrderOne.getLineCount({ sublistId: 'item' });
                    var isMatchingInvoiceOneCreatedFromSO = false;
                    if (salesOrderOne) {
                        matchingLines.forEach(function (linePair) {
                            log.debug('linePair', linePair)

                            for (var c = 0; c < invoiceOneSOLineCount; c++) {
                                var invoiceOneSOLineRate = salesOrderOne.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: c });
                                log.debug('invoiceOneSOLineRate', invoiceOneSOLineRate)

                                if (linePair.rate === invoiceOneSOLineRate) {
                                    isMatchingInvoiceOneCreatedFromSO = true;
                                    break;
                                }
                            }

                            if (isMatchingInvoiceOneCreatedFromSO) {
                                salesOrderOne.setSublistValue({
                                    sublistId: 'item', fieldId: cmField, line: c, value: cmCreated
                                });

                            }

                        });
                        var salesOrderOneUpdated = salesOrderOne.save();
                        log.audit('Original Sales Order Updated with Cancellation CM Link', salesOrderOneUpdated);
                    }


                }

            }

        } catch (error) {
            result.errors.push('Failed to create credit memo from forecasted invoice ID ' + forecastedInvoiceId + ': ' + error.message);
        }

        return result;
    }


    /**
     * Updates a specific line in a credit memo and adds a new line with modified details.
     * 
     * This function is used within a NetSuite Map/Reduce script to handle credit memo lines. 
     * It first retrieves the existing values (quantity, rate, tax rate, and amount) from the line 
     * specified by the `lineIndex` parameter. The function then performs the following actions:
     * 
     * 1. **Zero out the Existing Line:** 
     *    - Sets the `quantity` and `amount` to 0 for the existing line at `lineIndex`, effectively 
     *      removing its financial impact while retaining a record of the line.
     * 
     * 2. **Create a New Line:** 
     *    - A new line is added to the credit memo with the same values as the original line, except 
     *      it uses the `newItem` provided as an argument to this function. This maintains the integrity 
     *      of the credit memo while reflecting the necessary changes.
     * 
     * @param {Object} creditMemo - The credit memo record being processed.
     * @param {number} lineIndex - The index of the line to be updated.
     * @param {number} newItem - The internal ID of the new item to be added to the credit memo.
     */
    function updateCreditMemoLine(creditMemo, lineIndex, newItem, invoiceID, cmID, cmNumber, processAsRate) {
        // Retrieve existing values from the line at lineIndex
        var quantity = creditMemo.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: lineIndex });
        var rate = creditMemo.getSublistValue({ sublistId: 'item', fieldId: 'rate', line: lineIndex });
        var taxRate = creditMemo.getSublistValue({ sublistId: 'item', fieldId: 'taxrate1', line: lineIndex });
        var amount = creditMemo.getSublistValue({ sublistId: 'item', fieldId: 'amount', line: lineIndex });
        var taxcode = creditMemo.getSublistValue({ sublistId: 'item', fieldId: 'taxcode', line: lineIndex });
        var installmentFlag = creditMemo.getSublistValue({ sublistId: 'item', fieldId: 'custcol_shpfy_subscrptn_flg', line: lineIndex });
        var bundleID = creditMemo.getSublistValue({ sublistId: 'item', fieldId: 'custcolshpfy_bndl_id', line: lineIndex });
        var invOne = creditMemo.getSublistValue({ sublistId: 'item', fieldId: 'custcol_jlo_inv_1', line: lineIndex });
        var priceLevel = creditMemo.getSublistValue({ sublistId: 'item', fieldId: 'price', line: lineIndex });


        if (invoiceID && cmNumber) {
            var linktoUpdate = creditMemo.getSublistValue({ sublistId: 'item', fieldId: 'custcol_jlo_inv_' + cmNumber + '_fore', line: lineIndex });
        }

        if (cmID && cmNumber) {
            var linktoUpdate2 = creditMemo.getSublistValue({ sublistId: 'item', fieldId: 'custcol_jlo_cm_' + cmNumber + '_fore', line: lineIndex });
        }


        log.debug('CM Details', 'quantity: ' + quantity + ', rate: ' + rate + ', taxRate: ' 
                        + taxRate + ', amount: ' + amount + ', price level: ' + priceLevel);

        // Set quantity and amount to 0 for the existing line
        creditMemo.setSublistValue({
            sublistId: 'item',
            fieldId: 'quantity',
            line: lineIndex,
            value: 0
        });

        creditMemo.setSublistValue({
            sublistId: 'item',
            fieldId: 'amount',
            line: lineIndex,
            value: 0
        });

        creditMemo.setSublistValue({
            sublistId: 'item',
            fieldId: 'rate',
            line: lineIndex,
            value: 0
        });

        creditMemo.setSublistValue({
            sublistId: 'item',
            fieldId: 'custcol_shpfy_subscrptn_flg',
            line: lineIndex,
            value: ''
        });

        creditMemo.setSublistValue({
            sublistId: 'item',
            fieldId: 'custcolshpfy_bndl_id',
            line: lineIndex,
            value: ''
        });


        // Get the total number of lines in the sublist
        var totalLines = creditMemo.getLineCount({ sublistId: 'item' });

        // Insert a new line at the end of the sublist 
        creditMemo.insertLine({
            sublistId: 'item',
            line: totalLines
        });

        // Set the new line values
        creditMemo.setSublistValue({
            sublistId: 'item',
            fieldId: 'item',
            line: totalLines,
            value: newItem
        });

        creditMemo.setSublistValue({
            sublistId: 'item',
            fieldId: 'quantity',
            line: totalLines,
            value: quantity
        });

        creditMemo.setSublistValue({
            sublistId: 'item',
            fieldId: 'price',
            line: totalLines,
            value: priceLevel
        });

        if (processAsRate) {
            creditMemo.setSublistText({
                sublistId: 'item',
                fieldId: 'rate',
                line: totalLines,
                value: rate + '%'
            });
        } else {
            creditMemo.setSublistValue({
                sublistId: 'item',
                fieldId: 'rate',
                line: totalLines,
                value: rate
            });
        }


        creditMemo.setSublistValue({
            sublistId: 'item',
            fieldId: 'taxcode',
            line: totalLines,
            value: taxcode
        });

        creditMemo.setSublistValue({
            sublistId: 'item',
            fieldId: 'taxrate1',
            line: totalLines,
            value: taxRate
        });

        // for some things - like discounts, just process the rate as opposed to the amount
        //if (!processAsRate) {
        //    log.debug("set amount");
            creditMemo.setSublistValue({
                sublistId: 'item',
                fieldId: 'amount',
                line: totalLines,
                value: amount
            });
       // } else {
        //    log.debug("skip amount");
        //}
        
        creditMemo.setSublistValue({
            sublistId: 'item',
            fieldId: 'custcol_shpfy_subscrptn_flg',
            line: totalLines,
            value: installmentFlag
        });

        creditMemo.setSublistValue({
            sublistId: 'item',
            fieldId: 'custcolshpfy_bndl_id',
            line: totalLines,
            value: bundleID
        });

        // creditMemo.setSublistValue({
        //     sublistId: 'item',
        //     fieldId: 'custcolshpfy_bndl_id',
        //     line: totalLines,
        //     value: bundleID
        // });

        creditMemo.setSublistValue({
            sublistId: 'item',
            fieldId: 'custcol_jlo_inv_1',
            line: totalLines,
            value: invOne
        });

        if (invoiceID && cmNumber) {
            creditMemo.setSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_jlo_inv_' + cmNumber + '_fore',
                line: totalLines,
                value: linktoUpdate
            });
        }

        if (cmID && cmNumber) {
            creditMemo.setSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_jlo_cm_' + cmNumber + '_fore',
                line: totalLines,
                value: linktoUpdate2
            });
        }
    }



    /**
     * Checks if the provided item ID corresponds to an inventory item or a kit item.
     * 
     * @param {number} itemId - The ID of the item to be checked.
     * @returns {boolean} - Returns `true` if the item is either an inventory item or a kit item; otherwise, returns `false`.
     * 
     * The function loads the item record using the provided ID and retrieves the value of the 'type' field.
     * It then checks if the item type is either 'InvtPart' (inventory item) or 'Kit'.
     * 
     * This function helps in determining if an item is of a specific type (inventory or kit) based on its record type.
     */

    function isInventoryOrKitItem(itemId) {
        var isKitOrInventory = false;

        try {
            // Create a saved search to find the item and its type
            var itemSearch = search.create({
                type: search.Type.ITEM,
                filters: [
                    ['internalid', 'is', itemId]
                ],
                columns: [
                    search.createColumn({ name: "type", label: "Type" })
                ]
            });

            // Run the search and get the first result
            var searchResult = itemSearch.run().getRange({
                start: 0,
                end: 1
            });

            if (searchResult.length > 0) {
                var itemType = searchResult[0].getValue('type');
                log.debug('itemType', itemType)
                if (itemType === 'Kit' || itemType === 'InvtPart' || itemType === 'Assembly') {
                    isKitOrInventory = true;
                }
            }
        } catch (error) {
            log.error('Error checking item type', error.message);
        }

        return isKitOrInventory;
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

    return {
        getInputData: getInputData,
        map: map,
        reduce: reduce,
        summarize: summarize
    };

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
});
