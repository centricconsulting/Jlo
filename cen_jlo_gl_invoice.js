/**
/= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =\
 * Purpose: This script is used to 
 * VER  DATE           AUTHOR               		CHANGES
 * 1.0  Aug 7, 2023   Centric Consulting(Aman)   	Initial Version
 * https://blog.prolecto.com/2015/09/27/netsuite-up-close-custom-gl-lines-plug-in-to-reclass-general-ledger-postings/
\= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = */

function customizeGlImpact(record, standardLines, customLines, book)
{
    var rectype = record.getRecordType();
	var recid   = record.getId();
    nlapiLogExecution('DEBUG', 'customizeGlImpact starting', rectype + ':' + recid);

    // get the replacement item from a parameter
    // no parameters, is there a better way?
    var replacementItem = "21799";
    nlapiLogExecution('DEBUG',"replacementItem",replacementItem);

    // get the discountitem from the transaction/invoice header
    var discountItem = record.getFieldValue("discountitem");
    nlapiLogExecution('DEBUG', 'discountItem', discountItem);
    
    // if this discount item is "Shopify Replacement Discount", then execute this logic
    if (discountItem && discountItem === replacementItem) {
        nlapiLogExecution('DEBUG', 'replacementItem');
        var linecount = standardLines.getCount();
        nlapiLogExecution('DEBUG', 'standardLines linecount', linecount);

        for (var i = 0; i < standardLines.getCount(); i++)
        {
           var currLine = standardLines.getLine(i);
           
           // if this is the 41100 account, then debit this account and credit 45601
           // another hardcoded value to figure out
           if (currLine.getAccountId() == 108) {

                // credit the new account
                var line = customLines.addNewLine();
                line.setAccountId(777);
                line.setCreditAmount(currLine.getCreditAmount());
                line.setEntityId(currLine.getEntityId());
                
                // debit the old account
                var line = customLines.addNewLine();
                line.setAccountId(108);
                line.setDebitAmount(currLine.getCreditAmount());
                line.setEntityId(currLine.getEntityId());
           }

        }
    }

	
    // find the standard GL lines with account 41100 Revenue : Product Sales

    // for each standard GL line, create a cusotm line to debit 41100 Revenue : Product Sales and then credit 45601 Product Sale - Replacement


    //var entityId = standardLines.getLine(1).getEntityId();
    //var line = customLines.addNewLine();
    //line.setAccountId(6);
    //line.setDebitAmount(100);
    //line.setEntityId(entityId);
    
    //line = customLines.addNewLine();
    //line.setAccountId(7);
    //line.setCreditAmount(100);
} 
   

