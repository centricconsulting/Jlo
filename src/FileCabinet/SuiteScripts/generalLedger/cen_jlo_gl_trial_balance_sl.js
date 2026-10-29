/**
 * cen_jlo_gl_trial_balance_sl.ts
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 * @NAuthor cary.pruitt@centricconsulting.com
 * @NDescription Trial balance with a column per subsidiary plus Consolidated, for a chosen period, on screen or as CSV. See docs/developers/trial-balance-by-subsidiary.md.
 * @Id customscript_cen_jlo_gl_trial_balance_sl
 * @NName JLo - Trial Balance by Subsidiary
 */
define(["require", "exports", "N/file", "N/log", "N/ui/serverWidget", "./models/trialBalance", "./cen_jlo_gl_trial_balance_svc"], function (require, exports, file, log, serverWidget, trialBalance_1, cen_jlo_gl_trial_balance_svc_1) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.onRequest = void 0;
    exports.formatAmount = formatAmount;
    exports.escapeHtml = escapeHtml;
    const TITLE = 'Trial Balance by Subsidiary';
    const FIELD = {
        period: 'custpage_period',
        showZeros: 'custpage_showzeros',
        action: 'custpage_action',
        message: 'custpage_message',
        script: 'custpage_export_script',
    };
    const EXPORT_FUNCTION = 'cenJloTbExportCsv';
    const onRequest = (context) => {
        const request = (0, trialBalance_1.parseRequest)(requestParams(context.request.method, context.request.parameters));
        try {
            if (request.action === 'csv' && request.periodId !== null) {
                const { period, tb } = (0, cen_jlo_gl_trial_balance_svc_1.runTrialBalance)(request.periodId, request.showZeros);
                writeCsv(context.response, tb, period);
                return;
            }
            const periods = (0, cen_jlo_gl_trial_balance_svc_1.listPeriods)();
            const form = buildForm(periods, request);
            if (request.action === 'view' && request.periodId !== null) {
                const { period, tb } = (0, cen_jlo_gl_trial_balance_svc_1.runTrialBalance)(request.periodId, request.showZeros);
                addResults(form, tb, period);
            }
            context.response.writePage(form);
        }
        catch (e) {
            log.error({ title: 'Trial balance failed', details: `${e.message}\n${e.stack || ''}` });
            writeError(context.response, request);
        }
    };
    exports.onRequest = onRequest;
    /** The form posts custpage_* fields; GET links may use the model's own parameter names. */
    function requestParams(method, params) {
        if (String(method).toUpperCase() !== 'POST') {
            return params;
        }
        return {
            periodid: params[FIELD.period],
            showzeros: params[FIELD.showZeros] === 'T' ? 'T' : 'F',
            action: params[FIELD.action] === 'csv' ? 'csv' : 'view',
        };
    }
    function buildForm(periods, request) {
        const form = serverWidget.createForm({ title: TITLE });
        const periodField = form.addField({ id: FIELD.period, type: serverWidget.FieldType.SELECT, label: 'Period' });
        periodField.isMandatory = true;
        const selectedId = request.periodId ?? (0, trialBalance_1.defaultPeriod)(periods, todayIso())?.id ?? null;
        periods.forEach((p) => {
            periodField.addSelectOption({ value: String(p.id), text: p.name, isSelected: p.id === selectedId });
        });
        const showZerosField = form.addField({ id: FIELD.showZeros, type: serverWidget.FieldType.CHECKBOX, label: 'Show zero balances' });
        showZerosField.defaultValue = request.showZeros ? 'T' : 'F';
        const actionField = form.addField({ id: FIELD.action, type: serverWidget.FieldType.TEXT, label: 'Action' });
        actionField.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });
        actionField.defaultValue = 'view';
        // No client script file: the Export CSV button calls a global function defined here. It flips the hidden
        // action to csv, submits, then flips it back so a later Run still renders on screen.
        const scriptField = form.addField({ id: FIELD.script, type: serverWidget.FieldType.INLINEHTML, label: ' ' });
        scriptField.defaultValue =
            `<script>function ${EXPORT_FUNCTION}(){var f=document.forms['main_form'];` +
                `var a=f.elements['${FIELD.action}'];a.value='csv';f.submit();a.value='view';}</script>`;
        form.addSubmitButton({ label: 'Run' });
        form.addButton({ id: 'custpage_export', label: 'Export CSV', functionName: EXPORT_FUNCTION });
        return form;
    }
    function addResults(form, tb, period) {
        const heading = form.addField({ id: FIELD.message, type: serverWidget.FieldType.INLINEHTML, label: ' ' });
        heading.updateLayoutType({ layoutType: serverWidget.FieldLayoutType.OUTSIDEBELOW });
        heading.updateBreakType({ breakType: serverWidget.FieldBreakType.STARTROW });
        heading.defaultValue =
            `<p style="font-size:14px;font-weight:bold;margin:12px 0 4px">` +
                `${escapeHtml(TITLE)}: ${escapeHtml(period.name)} (${escapeHtml(period.startDate)} to ${escapeHtml(period.endDate)})</p>`;
        const sublist = form.addSublist({ id: 'custpage_tb', type: serverWidget.SublistType.LIST, label: `Trial Balance, ${period.name}` });
        sublist.addField({ id: 'custpage_acct', type: serverWidget.FieldType.TEXT, label: 'Account' });
        tb.subsidiaries.forEach((s, i) => {
            sublist.addField({ id: `custpage_sub_${i}`, type: serverWidget.FieldType.TEXT, label: s.name });
        });
        sublist.addField({ id: 'custpage_consol', type: serverWidget.FieldType.TEXT, label: 'Consolidated' });
        const lines = [
            ...tb.rows.map((r) => ({ label: r.label, amounts: r.amounts, consolidated: r.consolidated })),
            { label: 'TOTAL', amounts: tb.totals.amounts, consolidated: tb.totals.consolidated },
        ];
        lines.forEach((line, lineIndex) => {
            sublist.setSublistValue({ id: 'custpage_acct', line: lineIndex, value: line.label || ' ' });
            line.amounts.forEach((amount, i) => {
                sublist.setSublistValue({ id: `custpage_sub_${i}`, line: lineIndex, value: formatAmount(amount) });
            });
            sublist.setSublistValue({ id: 'custpage_consol', line: lineIndex, value: formatAmount(line.consolidated) });
        });
    }
    function writeCsv(response, tb, period) {
        const csv = file.create({
            name: (0, trialBalance_1.csvFileName)(period.name),
            fileType: file.Type.CSV,
            contents: (0, trialBalance_1.toCsv)(tb, period.name),
        });
        response.writeFile({ file: csv, isInline: false });
    }
    /** Re-renders the form with an error line; falls back to plain text if even the periods cannot load. */
    function writeError(response, request) {
        const message = 'The trial balance could not be run. Please try again, or contact your NetSuite administrator.';
        try {
            const form = buildForm((0, cen_jlo_gl_trial_balance_svc_1.listPeriods)(), request);
            const field = form.addField({ id: FIELD.message, type: serverWidget.FieldType.INLINEHTML, label: ' ' });
            field.defaultValue = `<p style="color:#b00020;font-weight:bold;margin:12px 0">${escapeHtml(message)}</p>`;
            response.writePage(form);
        }
        catch (e) {
            log.error({ title: 'Trial balance error page failed', details: `${e.message}\n${e.stack || ''}` });
            response.setHeader({ name: 'Content-Type', value: 'text/plain; charset=utf-8' });
            response.write({ output: message });
        }
    }
    /** 1234567.8 -> "1,234,567.80"; negatives keep a leading minus. */
    function formatAmount(amount) {
        const rounded = Math.round((Number(amount) || 0) * 100) / 100;
        const [whole, cents] = Math.abs(rounded).toFixed(2).split('.');
        const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return `${rounded < 0 ? '-' : ''}${grouped}.${cents}`;
    }
    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    /** Today in the server's local time as YYYY-MM-DD. */
    function todayIso() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
});
