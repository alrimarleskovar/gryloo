import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashArtifactBytes, hashRawBytes } from '../src/index.js';
import { hashArtifactValue, canonicalJson, hashPreimage, projectArtifact } from '../src/canonical.js';
import { parseArtifactBytes } from '../src/raw-json.js';
import { validateArtifact } from '../src/schemas.js';

const schemaBytes = readFileSync(new URL('../schemas/v1/enforcement-matrix.schema.json', import.meta.url));
const fixtureBytes = readFileSync(new URL('../../../tests/compatibility/v1/enforcement-matrix.json', import.meta.url));
const vectorBytes = readFileSync(new URL('../../../tests/compatibility/v1/mode-a-payload-vectors.json', import.meta.url));
const fixture = () => JSON.parse(fixtureBytes.toString('utf8')) as Record<string, unknown>;
const vectors = JSON.parse(vectorBytes.toString('utf8')) as {
  approve: { unsignedHex: string; payloadHash: string };
  swap: { unsignedHex: string; payloadHash: string };
};
const clone = <T>(value: T): T => structuredClone(value);
type MutableMatrix = Record<string, unknown> & {
  environment: Record<string, unknown>;
  payloads: Array<Record<string, unknown> & { arguments: Record<string, unknown> }>;
  limits: Array<Record<string, unknown> & {
    payloadBindings: Array<Record<string, unknown>>;
  }>;
};

describe('additive Mode A enforcement-matrix v1 contract', () => {
  it('freezes the additive schema and synthetic compatibility bytes', () => {
    const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    expect(digest(schemaBytes)).toBe('eaa5cb51b9d1b44c17eec7f6eb0c12e09d8d599e3d51a1f1a711470feab00930');
    expect(digest(fixtureBytes)).toBe('947177e134bc44b6ed1d8d461ccca80994638a9b614718e6382bd437fd8dbe5d');
    expect(digest(vectorBytes)).toBe('8d0483d739c4f65949cdc8f904bc1f74f7309d0e5a84467b94c520656e560d18');
  });

  it('accepts raw ingress and links synthetic payload bytes with the frozen payload hash domain', () => {
    const parsed = parseArtifactBytes(fixtureBytes, 'enforcement-matrix');
    expect(validateArtifact('enforcement-matrix', parsed)).toEqual(fixture());
    const payloads = (parsed as { payloads: { payloadHash: string }[] }).payloads;
    for (const [index, vector] of [vectors.approve, vectors.swap].entries()) {
      const bytes = Buffer.from(vector.unsignedHex.slice(2), 'hex');
      expect(hashRawBytes('payload', bytes)).toBe(vector.payloadHash);
      expect(payloads[index]?.payloadHash).toBe(vector.payloadHash);
      expect(vector.unsignedHex).toMatch(/^0x02[0-9a-f]+$/);
    }
    const digest = hashArtifactBytes('enforcement-matrix', fixtureBytes);
    expect(digest).toBe(hashArtifactValue('enforcement-matrix', parsed));
    const payload = new TextEncoder().encode(canonicalJson(projectArtifact('enforcement-matrix', parsed)));
    const independent = createHash('sha256').update(hashPreimage('enforcement-matrix', payload)).digest('hex');
    expect(digest).toBe('0x' + independent);
  });

  it('canonicalizes unordered rows and never omits a matrix field', () => {
    const original = fixture();
    const reversed = clone(original);
    (reversed.payloads as unknown[]).reverse();
    (reversed.limits as unknown[]).reverse();
    (reversed.limitations as unknown[]).reverse();
    expect(hashArtifactValue('enforcement-matrix', reversed)).toBe(hashArtifactValue('enforcement-matrix', original));
    const mutated = clone(original);
    mutated.runtimeSignature = 'unapproved';
    expect(() => validateArtifact('enforcement-matrix', mutated)).toThrow('additional properties');
  });

  it('rejects wrong environment, selector, fee caps, duplicate identities and dangling bindings', () => {
    const mutate = (change: (matrix: MutableMatrix) => void) => {
      const matrix = fixture() as MutableMatrix;
      change(matrix);
      expect(() => validateArtifact('enforcement-matrix', matrix)).toThrow();
    };
    mutate(matrix => { matrix.environment.executionChainId = 'eip155:8453'; });
    mutate(matrix => { matrix.environment.sourceBlock.hash = 'latest'; });
    mutate(matrix => { matrix.payloads[0].payloadProfile = 'UNKNOWN'; });
    mutate(matrix => { matrix.payloads[0].functionId = '0x5ae401dc'; });
    mutate(matrix => { matrix.payloads[0].maxPriorityFeePerGas = '3000001'; });
    mutate(matrix => { matrix.payloads[1].stepId = matrix.payloads[0].stepId; });
    mutate(matrix => { matrix.limits[0].payloadBindings[0].stepId = 'missing'; });
    mutate(matrix => { matrix.limits[0].locations = ['EXACT_SIGNED_PAYLOAD', 'EXACT_SIGNED_PAYLOAD']; });
    mutate(matrix => { matrix.payloads[1].arguments.recipient = '0x0000000000000000000000000000000000000001'; matrix.payloads[1].arguments.extra = true; });
  });
});
