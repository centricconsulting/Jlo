/**
 * proForma.ts
 * Pure helpers for the sales order pro forma print: request parsing, file naming,
 * the company header handed to the template, and attribute escaping for the UE.
 */

export type SalesOrderIdResult = { ok: true; id: number } | { ok: false; message: string };

export interface CompanyHeader {
  name: string;
  addressLines: string[];
  logoUrl: string;
}

export interface CompanyHeaderInput {
  name: string;
  addressText: string;
  logoUrl: string;
}

/** Accepts only a positive integer internal id; anything else is a request error. */
export function parseSalesOrderId(raw: unknown): SalesOrderIdResult {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d+$/.test(text) || Number(text) <= 0) {
    return { ok: false, message: 'A sales order id is required to print a pro forma.' };
  }
  return { ok: true, id: Number(text) };
}

/** "ProForma_SO0011030.pdf"; characters outside [A-Za-z0-9_-] are dropped. */
export function proFormaFileName(tranId: string): string {
  const safe = tranId.replace(/[^A-Za-z0-9_-]/g, '');
  return `ProForma_${safe || 'SalesOrder'}.pdf`;
}

/** Splits the company's address block into lines; falls back to the name when there is no address. */
export function buildCompanyHeader(input: CompanyHeaderInput): CompanyHeader {
  const addressLines = input.addressText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return {
    name: input.name,
    addressLines: addressLines.length > 0 ? addressLines : [input.name].filter((line) => line.length > 0),
    logoUrl: input.logoUrl,
  };
}

/** Escapes a value for a double-quoted HTML attribute. */
export function htmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
