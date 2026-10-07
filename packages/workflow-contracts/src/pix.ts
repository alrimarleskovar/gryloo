// SPDX-License-Identifier: Apache-2.0
/**
 * Local, offline validation of Pix "Copia e Cola" payloads (BR Code, the Banco Central do Brasil profile of EMV QRCPS
 * merchant-presented mode). Only what the payload actually contains is reported: a static code with no amount has no
 * amount here, and a dynamic code's amount lives at the PSP location URL, which only a payment provider can resolve.
 * Anything malformed fails closed with a stable code; nothing is repaired or inferred.
 */
export class PixPayloadError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'PixPayloadError'; }
}
const fail = (code: string): never => { throw new PixPayloadError(code); };

export type PixKeyType = 'CPF' | 'CNPJ' | 'PHONE' | 'EMAIL' | 'EVP';
export type PixPayload = {
  readonly initiation: 'STATIC' | 'DYNAMIC' | 'UNSPECIFIED';
  /** The receiver's Pix key (static codes). */
  readonly key: { readonly type: PixKeyType; readonly value: string } | null;
  /** The PSP location without scheme (dynamic codes). Its amount and recipient are known only after provider resolution. */
  readonly locationUrl: string | null;
  /** Present only when the payload encodes field 54. */
  readonly amount: { readonly cents: string; readonly text: string } | null;
  readonly currency: 'BRL';
  readonly merchantName: string;
  readonly merchantCity: string;
  readonly postalCode: string | null;
  /** Reference label (txid); `***` (none) is reported as null. */
  readonly txid: string | null;
  readonly description: string | null;
  /** The validated payload exactly as received (outer whitespace removed). */
  readonly payload: string;
};

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), as BR Code field 63 requires. */
export function crc16Ccitt(text: string): string {
  let crc = 0xffff;
  for (let index = 0; index < text.length; index++) {
    crc ^= text.charCodeAt(index) << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

type Field = { readonly id: string; readonly value: string; readonly start: number };
function tlv(text: string, offset = 0): Field[] {
  const fields: Field[] = [];
  const seen = new Set<string>();
  for (let at = 0; at < text.length;) {
    const head = text.slice(at, at + 4);
    if (!/^\d{4}$/.test(head)) fail('PIX_TLV_MALFORMED');
    const id = head.slice(0, 2), length = Number(head.slice(2));
    if (length < 1 || at + 4 + length > text.length) fail('PIX_TLV_MALFORMED');
    if (seen.has(id)) fail('PIX_TLV_DUPLICATE');
    seen.add(id);
    fields.push({ id, value: text.slice(at + 4, at + 4 + length), start: offset + at });
    at += 4 + length;
  }
  return fields;
}
const field = (fields: readonly Field[], id: string) => fields.find(entry => entry.id === id)?.value ?? null;

function cpfValid(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  const check = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index++) sum += Number(digits[index]) * (length + 1 - index);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(digits[9]) && check(10) === Number(digits[10]);
}
function cnpjValid(digits: string): boolean {
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;
  const check = (length: number) => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => total + weight * Number(digits[index]), 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check(12) === Number(digits[12]) && check(13) === Number(digits[13]);
}
/** Classifies a Pix key by the DICT formats; CPF and CNPJ check digits are verified. Unknown formats fail closed. */
export function classifyPixKey(value: string): PixKeyType {
  if (/^\d{11}$/.test(value)) return cpfValid(value) ? 'CPF' : fail('PIX_KEY_INVALID');
  if (/^\d{14}$/.test(value)) return cnpjValid(value) ? 'CNPJ' : fail('PIX_KEY_INVALID');
  if (/^\+[1-9]\d{10,14}$/.test(value)) return 'PHONE';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return 'EVP';
  if (value.length <= 77 && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value)) return 'EMAIL';
  return fail('PIX_KEY_INVALID');
}
/** Decimal BRL text (`12`, `12.5`, `12.50`) to integer cents, exactly. */
function cents(text: string): string {
  const match = /^(0|[1-9]\d{0,9})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) fail('PIX_AMOUNT_INVALID');
  const value = BigInt(match![1]!) * 100n + BigInt((match![2] ?? '').padEnd(2, '0') || '0');
  if (value <= 0n) fail('PIX_AMOUNT_INVALID');
  return value.toString();
}

export function parsePixPayload(input: unknown): PixPayload {
  if (typeof input !== 'string') fail('PIX_PAYLOAD_EMPTY');
  const payload = (input as string).trim();
  if (!payload) fail('PIX_PAYLOAD_EMPTY');
  if (payload.length > 512) fail('PIX_PAYLOAD_TOO_LONG');
  // Printable ASCII only: TLV lengths and the CRC are unambiguous, and nothing is transliterated.
  if (!/^[\x20-\x7e]+$/.test(payload)) fail('PIX_PAYLOAD_CHARSET');
  const fields = tlv(payload);
  const last = fields.at(-1);
  if (!last || last.id !== '63') fail(fields.some(entry => entry.id === '63') ? 'PIX_CRC_POSITION' : 'PIX_CRC_MISSING');
  if (!/^[0-9A-Fa-f]{4}$/.test(last!.value)) fail('PIX_CRC_MISMATCH');
  if (crc16Ccitt(payload.slice(0, last!.start + 4)) !== last!.value.toUpperCase()) fail('PIX_CRC_MISMATCH');
  if (fields[0]?.id !== '00' || fields[0].value !== '01') fail('PIX_FORMAT_INDICATOR_INVALID');
  const initiation = field(fields, '01');
  if (initiation !== null && initiation !== '11' && initiation !== '12') fail('PIX_INITIATION_INVALID');
  const accounts = fields.filter(entry => Number(entry.id) >= 26 && Number(entry.id) <= 51).map(entry => tlv(entry.value))
    .filter(sub => field(sub, '00')?.toLowerCase() === 'br.gov.bcb.pix');
  if (accounts.length !== 1) fail(accounts.length ? 'PIX_MERCHANT_ACCOUNT_AMBIGUOUS' : 'PIX_MERCHANT_ACCOUNT_MISSING');
  const account = accounts[0]!;
  const keyText = field(account, '01'), url = field(account, '25'), description = field(account, '02');
  if (keyText && url) fail('PIX_KEY_AND_LOCATION_CONFLICT');
  if (!keyText && !url) fail('PIX_KEY_OR_LOCATION_MISSING');
  if (url && !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::\d{1,5})?\/[\x21-\x7e]*$/.test(url)) fail('PIX_LOCATION_INVALID');
  if (!/^\d{4}$/.test(field(fields, '52') ?? '')) fail('PIX_MCC_INVALID');
  if (field(fields, '53') !== '986') fail('PIX_CURRENCY_NOT_BRL');
  const amountText = field(fields, '54');
  if (field(fields, '58') !== 'BR') fail('PIX_COUNTRY_INVALID');
  const merchantName = field(fields, '59'), merchantCity = field(fields, '60');
  if (!merchantName || merchantName.length > 25 || !merchantName.trim()) fail('PIX_MERCHANT_NAME_INVALID');
  if (!merchantCity || merchantCity.length > 15 || !merchantCity.trim()) fail('PIX_MERCHANT_CITY_INVALID');
  const postalCode = field(fields, '61');
  if (postalCode !== null && !/^\d{8}$/.test(postalCode)) fail('PIX_POSTAL_CODE_INVALID');
  const additional = field(fields, '62');
  if (additional === null) fail('PIX_TXID_MISSING');
  const txid = field(tlv(additional!), '05');
  if (txid === null) fail('PIX_TXID_MISSING');
  if (txid !== '***' && !/^[A-Za-z0-9]{1,35}$/.test(txid!)) fail('PIX_TXID_INVALID');
  return {
    initiation: initiation === '11' ? 'STATIC' : initiation === '12' ? 'DYNAMIC' : 'UNSPECIFIED',
    key: keyText ? { type: classifyPixKey(keyText), value: keyText } : null,
    locationUrl: url,
    amount: amountText === null ? null : { cents: cents(amountText), text: amountText },
    currency: 'BRL', merchantName: merchantName!, merchantCity: merchantCity!, postalCode,
    txid: txid === '***' ? null : txid, description, payload,
  };
}
