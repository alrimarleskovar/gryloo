import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseJsonBytes, parseArtifactBytes, RAW_JSON_LIMITS, RawJsonError } from '../src/raw-json.js';

const bytes = (input: string) => new TextEncoder().encode(input);
const fixture = (name: string) =>
  readFileSync(new URL('../../../tests/compatibility/v1/raw-json/' + name, import.meta.url));

describe('serialized UTF-8 ingress before object validation', () => {
  it.each([
    'valid-distinct-nested-keys.json',
    'valid-escaped-string-value.json',
  ])('accepts positive fixture %s', (name) => {
    expect(parseJsonBytes(fixture(name))).toEqual(JSON.parse(fixture(name).toString('utf8')));
  });

  it.each([
    'invalid-duplicate-root.json.txt',
    'invalid-duplicate-nested.json.txt',
    'invalid-escaped-equivalent-key.json.txt',
  ])('rejects duplicate source keys in %s', (name) => {
    expect(() => parseJsonBytes(fixture(name))).toThrow('DUPLICATE_KEY');
    // These are not valid artifacts. A duplicate error proves the raw guard
    // rejected input before Ajv could emit a missing-schema-property error.
    expect(() => parseArtifactBytes(fixture(name), 'semantic-workflow')).toThrow('DUPLICATE_KEY');
  });

  it('rejects concatenated documents', () => {
    expect(() => parseJsonBytes(fixture('invalid-trailing-document.json.txt'))).toThrow('TRAILING_DOCUMENT');
  });

  it('rejects invalid UTF-8 before tokenization', () => {
    const hex = fixture('invalid-utf8.hex').toString('ascii').trim();
    expect(() => parseJsonBytes(Buffer.from(hex, 'hex'))).toThrow('INVALID_UTF8');
    for (const hexBytes of ['c0af', 'eda080', 'f4908080', 'e282', '80']) {
      expect(() => parseJsonBytes(Buffer.from('22' + hexBytes + '22', 'hex'))).toThrow('INVALID_UTF8');
    }
  });

  it.each([
    String.raw`{"value":"\uD800"}`,
    String.raw`{"value":"\uDC00"}`,
    String.raw`{"value":"\uD800x"}`,
    String.raw`{"value":"\uDC00\uD800"}`,
    String.raw`{"\uD800":1}`,
    String.raw`{"\uDC00":1}`,
  ])('rejects escaped lone surrogates in raw bytes: %s', (input) => {
    expect(() => parseJsonBytes(bytes(input))).toThrow('UNPAIRED_SURROGATE');
    expect(() => parseArtifactBytes(bytes(input), 'semantic-workflow')).toThrow('UNPAIRED_SURROGATE');
  });

  it('accepts valid escaped surrogate pairs and preserves normalization distinctions', () => {
    expect(parseJsonBytes(bytes(String.raw`{"value":"\uD83D\uDE00"}`))).toEqual({ value: '😀' });
    expect(parseJsonBytes(bytes('{"é":1,"é":2}'))).toEqual({ 'é': 1, 'é': 2 });
  });

  it.each(['', '{', '{"a":}', '{"a":1,}', '[1,]', '{"a" 1}', '/*x*/{}', '{"a":NaN}', '{"a":01}', '{"a":"\n"}'])(
    'rejects malformed JSON %j', (input) => expect(() => parseJsonBytes(bytes(input))).toThrow(RawJsonError),
  );

  it('permits JSON whitespace only and rejects BOM', () => {
    expect(parseJsonBytes(bytes(' \n\t{}\r\n'))).toEqual({});
    expect(() => parseJsonBytes(bytes('\ufeff{}'))).toThrow('UTF8_BOM');
    expect(() => parseJsonBytes(bytes('{}\u00a0'))).toThrow(RawJsonError);
  });

  it('enforces safe integer lexemes before conversion', () => {
    expect(parseJsonBytes(bytes('[9007199254740991,-9007199254740991]'))).toEqual([9007199254740991, -9007199254740991]);
    for (const input of ['9007199254740992', '9007199254740993', '-9007199254740992']) {
      expect(() => parseJsonBytes(bytes(input))).toThrow('UNSAFE_INTEGER');
    }
    for (const input of ['1.5', '1.000000000000000001', '1e0', '1e999']) {
      expect(() => parseJsonBytes(bytes(input))).toThrow('NON_INTEGER_NUMBER');
    }
    expect(parseJsonBytes(bytes('"9007199254740993"'))).toBe('9007199254740993');
  });

  it('keeps duplicate detection scoped to each object including arrays', () => {
    expect(parseJsonBytes(bytes('[{"a":1},{"a":2}]'))).toEqual([{ a: 1 }, { a: 2 }]);
    expect(() => parseJsonBytes(bytes('[{"a":1,"a":2}]'))).toThrow('DUPLICATE_KEY');
    expect(parseJsonBytes(bytes('{"a":"a","nested":{"a":2}}'))).toEqual({ a: 'a', nested: { a: 2 } });
  });

  it('preserves dangerous-looking keys as own data without prototype mutation', () => {
    const value = parseJsonBytes(bytes('{"__proto__":{"polluted":true},"constructor":1}')) as Record<string, unknown>;
    expect(Object.hasOwn(value, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
  });

  it('enforces byte and nesting bounds with accepted boundary cases', () => {
    expect(parseJsonBytes(bytes(' '.repeat(RAW_JSON_LIMITS.bytes - 2) + '{}'))).toEqual({});
    expect(() => parseJsonBytes(new Uint8Array(RAW_JSON_LIMITS.bytes + 1))).toThrow('INPUT_SIZE');
    const input = '['.repeat(RAW_JSON_LIMITS.depth) + '0' + ']'.repeat(RAW_JSON_LIMITS.depth);
    expect(parseJsonBytes(bytes(input))).toBeDefined();
    expect(() => parseJsonBytes(bytes('[' + input + ']'))).toThrow('DEPTH_LIMIT');
  });

  it('enforces key length and aggregate key count before building oversized objects', () => {
    expect(() => parseJsonBytes(bytes(JSON.stringify({ ['a'.repeat(513)]: 1 })))).toThrow('KEY_SIZE');
    const fields = Array.from({ length: RAW_JSON_LIMITS.objectKeys + 1 }, (_, i) => JSON.stringify('k' + i) + ':0');
    expect(() => parseJsonBytes(bytes('{' + fields.join(',') + '}'))).toThrow('KEY_LIMIT');
  });
});
