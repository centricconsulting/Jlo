/**
 * @NApiVersion 2.1
 * @NScriptType usereventscript
 * @NModuleScope public
 *
 * Created by Centric Consulting
 * Authors: Ron Mazuk
 *
 * Description: Code to set the memo field a the line Level on a Journal Entry to manadatory 
 */
   define(['N/runtime', 'N/record'],
   function(runtime, record){
    
     function beforeLoad(scriptContext) {
        log.debug({
            title: 'Start beforeLoad Script',
            details: 'scriptContext type = ' + scriptContext.type + '  execution context = ' + runtime.executionContext
        });
        var myForm = scriptContext.form;
        var mySublistobj = myForm.getSublist({id: 'line'});
        var myMemofield = mySublistobj.getField({id: 'memo'});
        myMemofield.isMandatory = true;
     }

     return {
        beforeLoad: beforeLoad
     }

});