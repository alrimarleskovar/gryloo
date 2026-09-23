import { hashJournalEntries } from './canonical.js';
import { Tokenizer, TokenParser, TokenType } from '@streamparser/json';
import { validateArtifact, type ArtifactKind, type ArtifactByKind } from './schemas.js';

/** Bounds are part of the v1 serialized-input compatibility profile. */
export const RAW_JSON_LIMITS = Object.freeze({
  bytes: 1_048_576,
  depth: 64,
  objectKeys: 16_384,
  keyCodeUnits: 512,
  tokens: 131_072,
});

export class RawJsonError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'RawJsonError';
  }
}

class IntegerTokenizer extends Tokenizer {
  protected override parseNumber(lexeme: string): number {
    // Monetary values are strings. Metadata numbers have one interoperable
    // integer representation; reject rounding before it can hide invalid input.
    if (!/^-?(?:0|[1-9][0-9]*)$/.test(lexeme)) {
      throw new RawJsonError('NON_INTEGER_NUMBER');
    }
    const value = BigInt(lexeme);
    if (value < -9_007_199_254_740_991n || value > 9_007_199_254_740_991n) {
      throw new RawJsonError('UNSAFE_INTEGER');
    }
    return Number(lexeme);
  }
}

type Container =
  | { kind: 'object'; expectKey: boolean; keys: Set<string> }
  | { kind: 'array' };

/**
 * The only generic serialized JSON ingress. Validates original UTF-8 bytes,
 * then guards decoded keys BEFORE forwarding tokens to the object builder.
 * This does not claim that an already-parsed JavaScript object had unique keys.
 */
export function parseJsonBytes(bytes: Uint8Array): unknown {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 ||
      bytes.byteLength > RAW_JSON_LIMITS.bytes) {
    throw new RawJsonError('INPUT_SIZE');
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new RawJsonError('UTF8_BOM');
  }
  let input: string;
  try {
    input = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new RawJsonError('INVALID_UTF8');
  }
  const tokenizer = new IntegerTokenizer();
  const parser = new TokenParser({ paths: ['$'], keepStack: true });
  const containers: Container[] = [];
  let keys = 0;
  let tokens = 0;
  let complete = false;
  let result: unknown;
  parser.onValue = ({ value, stack }) => {
    if (stack.length === 0) {
      if (complete) throw new RawJsonError('TRAILING_DOCUMENT');
      result = value;
      complete = true;
    }
  };
  tokenizer.onToken = (info) => {
    if (parser.isEnded) throw new RawJsonError('TRAILING_DOCUMENT');
    if (++tokens > RAW_JSON_LIMITS.tokens) throw new RawJsonError('TOKEN_LIMIT');
    const current = containers.at(-1);
    if (info.token === TokenType.STRING) {
      if (typeof info.value !== 'string' || !info.value.isWellFormed()) {
        throw new RawJsonError('UNPAIRED_SURROGATE');
      }
      if (current?.kind === 'object' && current.expectKey) {
        if (info.value.length > RAW_JSON_LIMITS.keyCodeUnits) {
          throw new RawJsonError('KEY_SIZE');
        }
        if (++keys > RAW_JSON_LIMITS.objectKeys) throw new RawJsonError('KEY_LIMIT');
        if (current.keys.has(info.value)) throw new RawJsonError('DUPLICATE_KEY');
        current.keys.add(info.value);
        current.expectKey = false;
      }
    }
    if (info.token === TokenType.LEFT_BRACE || info.token === TokenType.LEFT_BRACKET) {
      if (containers.length >= RAW_JSON_LIMITS.depth) throw new RawJsonError('DEPTH_LIMIT');
      containers.push(info.token === TokenType.LEFT_BRACE
        ? { kind: 'object', expectKey: true, keys: new Set() }
        : { kind: 'array' });
    } else if (info.token === TokenType.RIGHT_BRACE || info.token === TokenType.RIGHT_BRACKET) {
      containers.pop();
    } else if (info.token === TokenType.COMMA && current?.kind === 'object') {
      current.expectKey = true;
    }
    // Duplicate detection above runs before any assignment of this key/value.
    parser.write(info);
  };
  try {
    tokenizer.write(input);
    if (!tokenizer.isEnded) tokenizer.end();
    if (!parser.isEnded) parser.end();
    if (!complete || containers.length !== 0) throw new RawJsonError('INCOMPLETE_DOCUMENT');
  } catch (error) {
    if (error instanceof RawJsonError) throw error;
    // Parser errors may contain untrusted input. Keep public diagnostics bounded.
    throw new RawJsonError('MALFORMED_JSON');
  }
  return result;
}

/** Raw duplicate-key/Unicode checks precede schema and semantic validation. */
export function parseArtifactBytes<K extends ArtifactKind>(
  bytes: Uint8Array,
  artifactKind: K,
): ArtifactByKind[K] {
  const value = parseJsonBytes(bytes);
  const artifact = validateArtifact(artifactKind, value);
  if (artifactKind === 'execution-journal') hashJournalEntries(artifact);
  return artifact;
}
