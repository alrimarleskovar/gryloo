// SPDX-License-Identifier: Apache-2.0
/**
 * Local, offline validation of Brazilian boletos (FEBRABAN layouts): bank collection boletos (44-digit barcode or 47-digit
 * linha digitável) and collection agreements / arrecadação (44-digit barcode or 48-digit linha digitável starting with 8).
 * Every check digit is verified. Formatting separators (spaces, dots, hyphens) are the only thing removed; a wrong digit is
 * never corrected. Only encoded facts are reported: a zero amount or a zero due-date factor means "not encoded".
 */
export class BoletoError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'BoletoError'; }
}
const fail = (code: string): never => { throw new BoletoError(code); };

export type Boleto = {
  readonly kind: 'BANK' | 'CONVENIO';
  /** Canonical 44-digit barcode. */
  readonly barcode: string;
  /** Canonical linha digitável (47 digits for BANK, 48 for CONVENIO). */
  readonly digitableLine: string;
  /** Bank code (BANK only). */
  readonly bankCode: string | null;
  /** Segment and value identifier (CONVENIO only). */
  readonly segment: string | null;
  readonly valueIdentifier: string | null;
  readonly amount: { readonly cents: string; readonly kind: 'EFFECTIVE' } | { readonly units: string; readonly kind: 'REFERENCE' } | null;
  /** ISO date resolved from the due-date factor (BANK only), with the factor itself. */
  readonly dueDate: string | null;
  readonly dueDateFactor: string | null;
};

/** FEBRABAN modulo 10: weights 2,1,… from the right; digits of each product are summed. */
export function boletoMod10(digits: string): number {
  let sum = 0;
  for (let index = 0; index < digits.length; index++) {
    let product = Number(digits[digits.length - 1 - index]) * (index % 2 === 0 ? 2 : 1);
    if (product > 9) product = Math.floor(product / 10) + (product % 10);
    sum += product;
  }
  return (10 - (sum % 10)) % 10;
}
function weightedMod11(digits: string): number {
  let sum = 0;
  for (let index = 0; index < digits.length; index++) sum += Number(digits[digits.length - 1 - index]) * (2 + (index % 8));
  return sum % 11;
}
/** Bank boleto general check digit: 11 - rest, where 0, 10 and 11 become 1. */
export function bankBarcodeDigit(digits43: string): number {
  const digit = 11 - weightedMod11(digits43);
  return digit === 0 || digit === 10 || digit === 11 ? 1 : digit;
}
/** Arrecadação modulo 11: rest 0 or 1 gives 0, rest 10 gives 1, otherwise 11 - rest. */
export function convenioMod11(digits: string): number {
  const rest = weightedMod11(digits);
  return rest === 0 || rest === 1 ? 0 : rest === 10 ? 1 : 11 - rest;
}

const DAY = 86_400_000;
/**
 * Resolves a due-date factor. The factor counts days from 1997-10-07 and, after reaching 9999 on 2025-02-21, restarted at
 * 1000 on 2025-02-22 (FEBRABAN). The cycle closest to `now` is chosen, as the standard prescribes.
 */
export function boletoDueDate(factor: string, now: Date): string | null {
  if (!/^\d{4}$/.test(factor)) fail('BOLETO_DUE_FACTOR_INVALID');
  const value = Number(factor);
  if (value === 0) return null;
  if (value < 1000) fail('BOLETO_DUE_FACTOR_INVALID');
  const candidates = [Date.UTC(2000, 6, 3), Date.UTC(2025, 1, 22), Date.UTC(2049, 9, 14)].map(base => base + (value - 1000) * DAY);
  const due = candidates.reduce((best, candidate) => Math.abs(candidate - now.getTime()) < Math.abs(best - now.getTime()) ? candidate : best);
  return new Date(due).toISOString().slice(0, 10);
}

function bank(barcode: string, line: string, now: Date): Boleto {
  if (barcode[3] !== '9') fail('BOLETO_CURRENCY_UNSUPPORTED');
  if (Number(barcode[4]) !== bankBarcodeDigit(barcode.slice(0, 4) + barcode.slice(5))) fail('BOLETO_CHECK_DIGIT_INVALID');
  const amount = barcode.slice(9, 19).replace(/^0+/, '');
  return { kind: 'BANK', barcode, digitableLine: line, bankCode: barcode.slice(0, 3), segment: null, valueIdentifier: null,
    amount: amount ? { cents: amount, kind: 'EFFECTIVE' } : null, dueDate: boletoDueDate(barcode.slice(5, 9), now), dueDateFactor: barcode.slice(5, 9) };
}
function bankLineToBarcode(line: string): string {
  const fields = [line.slice(0, 9), line.slice(10, 20), line.slice(21, 31)];
  const digits = [line[9], line[20], line[31]];
  fields.forEach((field, index) => { if (boletoMod10(field) !== Number(digits[index])) fail('BOLETO_FIELD_CHECK_DIGIT_INVALID'); });
  return line.slice(0, 4) + line[32] + line.slice(33, 47) + line.slice(4, 9) + line.slice(10, 20) + line.slice(21, 31);
}
function convenioModulo(identifier: string): (digits: string) => number {
  if (identifier === '6' || identifier === '7') return boletoMod10;
  if (identifier === '8' || identifier === '9') return convenioMod11;
  return fail('BOLETO_VALUE_IDENTIFIER_INVALID');
}
function convenio(barcode: string, line: string): Boleto {
  const identifier = barcode[2]!, segment = barcode[1]!;
  if (segment === '0') fail('BOLETO_SEGMENT_INVALID');
  const modulo = convenioModulo(identifier);
  if (Number(barcode[3]) !== modulo(barcode.slice(0, 3) + barcode.slice(4))) fail('BOLETO_CHECK_DIGIT_INVALID');
  const value = barcode.slice(4, 15).replace(/^0+/, '');
  const effective = identifier === '6' || identifier === '8';
  return { kind: 'CONVENIO', barcode, digitableLine: line, bankCode: null, segment, valueIdentifier: identifier,
    amount: !value ? null : effective ? { cents: value, kind: 'EFFECTIVE' } : { units: value, kind: 'REFERENCE' }, dueDate: null, dueDateFactor: null };
}
function convenioLineToBarcode(line: string): string {
  const modulo = convenioModulo(line[2]!);
  let barcode = '';
  for (let block = 0; block < 4; block++) {
    const digits = line.slice(block * 12, block * 12 + 11);
    if (modulo(digits) !== Number(line[block * 12 + 11])) fail('BOLETO_FIELD_CHECK_DIGIT_INVALID');
    barcode += digits;
  }
  return barcode;
}
function bankBarcodeToLine(barcode: string): string {
  const free = barcode.slice(19);
  const one = barcode.slice(0, 4) + free.slice(0, 5), two = free.slice(5, 15), three = free.slice(15, 25);
  return one + boletoMod10(one) + two + boletoMod10(two) + three + boletoMod10(three) + barcode[4] + barcode.slice(5, 19);
}
function convenioBarcodeToLine(barcode: string): string {
  const modulo = convenioModulo(barcode[2]!);
  let line = '';
  for (let block = 0; block < 4; block++) { const digits = barcode.slice(block * 11, block * 11 + 11); line += digits + modulo(digits); }
  return line;
}

/** Parses a barcode or linha digitável. `now` selects the due-date factor cycle. */
export function parseBoleto(input: unknown, now: Date = new Date()): Boleto {
  if (typeof input !== 'string' || !input.trim()) fail('BOLETO_EMPTY');
  const text = (input as string).trim();
  if (text.length > 80 || !/^[\d .-]+$/.test(text)) fail('BOLETO_CHARACTERS_INVALID');
  const digits = text.replace(/[ .-]/g, '');
  if (digits.length === 44) {
    if (digits[0] === '8') { const line = convenioBarcodeToLine(digits); return convenio(digits, line); }
    return bank(digits, bankBarcodeToLine(digits), now);
  }
  if (digits.length === 47) { if (digits[0] === '8') fail('BOLETO_LENGTH_INVALID'); return bank(bankLineToBarcode(digits), digits, now); }
  if (digits.length === 48) { if (digits[0] !== '8') fail('BOLETO_LENGTH_INVALID'); return convenio(convenioLineToBarcode(digits), digits); }
  return fail('BOLETO_LENGTH_INVALID');
}
