/**
 * proForma.ts
 * Pure helpers for the sales order pro forma print: request parsing, file naming,
 * the company header handed to the template, and attribute escaping for the UE.
 */
define(["require", "exports"], function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.parseSalesOrderId = parseSalesOrderId;
    exports.proFormaFileName = proFormaFileName;
    exports.buildCompanyHeader = buildCompanyHeader;
    exports.parseLogoUrl = parseLogoUrl;
    exports.logoFileId = logoFileId;
    exports.logoDataUri = logoDataUri;
    exports.htmlAttr = htmlAttr;
    /** Accepts only a positive integer internal id; anything else is a request error. */
    function parseSalesOrderId(raw) {
        const text = typeof raw === 'string' ? raw.trim() : '';
        if (!/^\d+$/.test(text) || Number(text) <= 0) {
            return { ok: false, message: 'A sales order id is required to print a pro forma.' };
        }
        return { ok: true, id: Number(text) };
    }
    /** "ProForma_SO0011030.pdf"; characters outside [A-Za-z0-9_-] are dropped. */
    function proFormaFileName(tranId) {
        const safe = tranId.replace(/[^A-Za-z0-9_-]/g, '');
        return `ProForma_${safe || 'SalesOrder'}.pdf`;
    }
    /**
     * Splits the company's address block into lines; falls back to the name when there is no address.
     * The subsidiary returns the block with newlines for some roles and `<br>` tags for others, so both separate lines.
     */
    function buildCompanyHeader(input) {
        const addressLines = input.addressText
            .split(/\r?\n|<br\s*\/?>/i)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        return {
            name: input.name,
            addressLines: addressLines.length > 0 ? addressLines : [input.name].filter((line) => line.length > 0),
            logoUrl: input.logoUrl,
        };
    }
    /** Keeps the logo parameter only when it is an absolute http(s) URL; anything else prints no logo. */
    function parseLogoUrl(raw) {
        const text = typeof raw === 'string' ? raw.trim() : '';
        return /^https?:\/\/\S+$/i.test(text) ? text : '';
    }
    /** The File Cabinet id in a media URL's `id=` parameter, or 0 when there is none. */
    function logoFileId(logoUrl) {
        const match = /[?&]id=(\d+)(?:&|$)/.exec(logoUrl);
        return match ? Number(match[1]) : 0;
    }
    const IMAGE_MIME_TYPES = {
        PNGIMAGE: 'image/png',
        JPGIMAGE: 'image/jpeg',
        GIFIMAGE: 'image/gif',
    };
    /**
     * A data URI for an image file's base64 contents, so the PDF carries the logo instead of fetching it
     * (a fetch under a non-admin role printed a placeholder). '' for a file type that is not an image.
     */
    function logoDataUri(fileType, base64Contents) {
        const mime = IMAGE_MIME_TYPES[fileType];
        return mime && base64Contents ? `data:${mime};base64,${base64Contents}` : '';
    }
    /** Escapes a value for a double-quoted HTML attribute. */
    function htmlAttr(value) {
        return value
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
});
