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

    var savedEntity = '';
    var linecount = standardLines.getCount();
    nlapiLogExecution('DEBUG', 'standardLines linecount', linecount);

    for (var i = 0; i < standardLines.getCount(); i++)
    {
        var currLine = standardLines.getLine(i);
        nlapiLogExecution('DEBUG', 'standardLines entity', currLine.getEntityId());

        // if this is the credit GL line, save the associated entity
        if (currLine.getEntityId()) {
            savedEntity = currLine.getEntityId();
            break;
        }
    }

    // check to see if an entity was associated on the credit line
    try 
    {
        if (savedEntity) {
            for (var i = 0; i < standardLines.getCount(); i++)
            {
                var currLine = standardLines.getLine(i);

                nlapiLogExecution('DEBUG', 'VB Line mod:', recid 
                    + ":" + currLine.getAccountId() 
                    + ":" + savedEntity
                    + ":" + currLine.getClassId() 
                    + ":" + currLine.getDebitAmount()
                    + ":" + currLine.getCreditAmount()
                    + ":" + currLine.getDepartmentId()
                    + ":" + currLine.getLocationId()
                    + ":" + currLine.getMemo()
                );
                //nlapiLogExecution('DEBUG', 'standardLines entity', currLine.getEntityId());
    
                // if this is a debit GL line, and there is no existing entity, then add the 
                // entity from the credit line
                if (currLine.getDebitAmount() != 0 && !currLine.getEntityId()) {
                    nlapiLogExecution('DEBUG', 'standardLines debit', savedEntity);
                    
                    var line = customLines.addNewLine();
                    line.setAccountId(currLine.getAccountId());
                    line.setClassId(currLine.getClassId());
                    line.setCreditAmount(currLine.getDebitAmount());
                    line.setDepartmentId(currLine.getDepartmentId());
                    line.setLocationId(currLine.getLocationId());
                    line.setMemo(currLine.getMemo());
    
                    var line = customLines.addNewLine();
                    line.setAccountId(currLine.getAccountId());
                    line.setClassId(currLine.getClassId());
                    line.setDebitAmount(currLine.getDebitAmount());
                    line.setDepartmentId(currLine.getDepartmentId());
                    line.setEntityId(savedEntity);
                    line.setLocationId(currLine.getLocationId());
                    line.setMemo(currLine.getMemo());

                    //throw new Error("ron test");
                }

                if (currLine.getCreditAmount() != 0 && !currLine.getEntityId()) {
                    nlapiLogExecution('DEBUG', 'credit', savedEntity);
                    
                    var line = customLines.addNewLine();
                    line.setAccountId(currLine.getAccountId());
                    line.setClassId(currLine.getClassId());
                    line.setDebitAmount(currLine.getCreditAmount());
                    line.setDepartmentId(currLine.getDepartmentId());
                    line.setLocationId(currLine.getLocationId());
                    line.setMemo(currLine.getMemo());

                    var line = customLines.addNewLine();
                    line.setAccountId(currLine.getAccountId());
                    line.setClassId(currLine.getClassId());
                    line.setCreditAmount(currLine.getCreditAmount());
                    line.setDepartmentId(currLine.getDepartmentId());
                    line.setLocationId(currLine.getLocationId());
                    line.setMemo(currLine.getMemo());
                    line.setEntityId(savedEntity);
    


                    //throw new Error("ron test");
                }
            }
        }
    } catch (e) {
        nlapiLogExecution('ERROR', 'Error during Vendor Bill mod:', recid 
            + ":" + currLine.getAccountId() 
            + ":" + savedEntity
            + ":" + currLine.getClassId() 
            + ":" + currLine.getDebitAmount()
            + ":" + currLine.getDepartmentId()
            + ":" + currLine.getLocationId()
            + ":" + currLine.getMemo()
            + ":" + e
        );
    }

	
} 
   

