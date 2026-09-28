import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  canonicalJson, hashArtifactValue, hashData, hashPreimage, HASH_FIELDS,
  hashRawBytes, hashJournalEntries, projectArtifact, HASH_DOMAINS,
  type HashKind, type StructuredHashKind,
} from '../src/canonical.js';
import { hashArtifactBytes, hashModeBPermission, hashModeBCompositionPermission } from '../src/index.js';
import { artifactSchemas } from '../src/schemas.js';

type Vector = {
  domain: HashKind;
  value?: unknown;
  rawHex?: string;
  payloadHex: string;
  preimageHex: string;
  digest: string;
};
const read = (name: string) =>
  JSON.parse(readFileSync(new URL('../../../tests/compatibility/v1/' + name, import.meta.url), 'utf8'));
const vectors = read('hash-vectors.json') as { profile: string; vectors: Vector[] };
const bytes = (hex: string) => Buffer.from(hex, 'hex');

describe('DWE-HASH v1 byte compatibility', () => {
  it('covers every exact domain with lowercase 0x-prefixed SHA-256', () => {
    expect(vectors.profile).toBe('DWE-HASH-v1');
    expect(new Set(vectors.vectors.map(vector => vector.domain))).toEqual(
      new Set(Object.keys(HASH_DOMAINS).filter(domain => domain !== 'enforcement-matrix' && domain !== 'mode-b-permission' && domain !== 'mode-b-composition-permission')),
    );
    for (const vector of vectors.vectors) {
      expect(vector.digest).toMatch(/^0x[0-9a-f]{64}$/);
      expect(vector.payloadHex).toMatch(/^(?:[0-9a-f]{2})*$/);
      expect(vector.preimageHex).toMatch(/^(?:[0-9a-f]{2})*$/);
      expect(Buffer.from(hashPreimage(vector.domain, bytes(vector.payloadHex))).toString('hex'))
        .toBe(vector.preimageHex);
      expect(hashData(vector.domain, bytes(vector.payloadHex))).toBe(vector.digest);
      if (vector.rawHex !== undefined) {
        expect(vector.payloadHex).toBe(vector.rawHex);
        expect(hashRawBytes(vector.domain as 'raw-response' | 'payload' | 'intent', bytes(vector.rawHex)))
          .toBe(vector.digest);
      } else if (vector.domain !== 'execution-journal-entry') {
        expect(vector.value).toBeDefined();
        const kind = vector.domain as StructuredHashKind;
        expect(Buffer.from(canonicalJson(projectArtifact(kind, vector.value)), 'utf8').toString('hex'))
          .toBe(vector.payloadHex);
        expect(hashArtifactValue(kind, vector.value)).toBe(vector.digest);
      }
    }
  });


  it('keeps the additive Mode B v2 domain separate from frozen v1 vectors', () => {
    const vector = read('mode-b-permission-vectors.json') as { profile: string; permission: Record<string, unknown>; digest: string };
    expect(vector.profile).toBe('DWE-HASH-v2-mode-b');
    expect(hashModeBPermission(vector.permission)).toBe(vector.digest);
    const changed = { ...vector.permission, amountIn: (BigInt(vector.permission.amountIn as string) + 1n).toString(),
      cumulativeBudget: (BigInt(vector.permission.cumulativeBudget as string) + 1n).toString() };
    expect(hashModeBPermission(changed)).not.toBe(vector.digest);
    const script = [
      'import json,hashlib,sys',
      'v=json.load(open(sys.argv[1],encoding="utf-8"))',
      'p=json.dumps(v["permission"],sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()',
      'd=b"defi-workflow-engine/mode-b-permission/v2"',
      'frame=b"DWE-HASH"+bytes([0,2])+len(d).to_bytes(2,"big")+d+len(p).to_bytes(8,"big")+p',
      'assert "0x"+hashlib.sha256(frame).hexdigest()==v["digest"]',
    ].join('\n');
    expect(() => execFileSync('python3', ['-c', script, new URL('../../../tests/compatibility/v1/mode-b-permission-vectors.json', import.meta.url).pathname])).not.toThrow();
  });

  it('keeps BUILD-007 composition v3 separate from frozen v1 and Mode B v2 vectors', () => {
    const path = new URL('../../../tests/compatibility/v2/mode-b-composition-vectors.json', import.meta.url).pathname;
    const vector = JSON.parse(readFileSync(path, 'utf8')) as { profile: string; permission: Record<string, unknown>; digest: string };
    expect(vector.profile).toBe('DWE-HASH-v3-mode-b-composition');
    expect(hashModeBCompositionPermission(vector.permission)).toBe(vector.digest);
    expect(hashModeBCompositionPermission({ ...vector.permission, maxWETH: (BigInt(vector.permission.maxWETH as string) + 1n).toString() })).not.toBe(vector.digest);
    const script = [
      'import json,hashlib,sys',
      'v=json.load(open(sys.argv[1],encoding="utf-8"))',
      'p=json.dumps(v["permission"],sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()',
      'd=b"defi-workflow-engine/mode-b-composition-permission/v3"',
      'frame=b"DWE-HASH"+bytes([0,3])+len(d).to_bytes(2,"big")+d+len(p).to_bytes(8,"big")+p',
      'assert "0x"+hashlib.sha256(frame).hexdigest()==v["digest"]',
    ].join('\n');
    expect(() => execFileSync('python3', ['-c', script, path])).not.toThrow();
  });

  it('classifies every structured schema field in the canonical projection', () => {
    for (const kind of Object.keys(HASH_FIELDS) as StructuredHashKind[]) {
      expect([...HASH_FIELDS[kind]].sort()).toEqual(Object.keys(artifactSchemas[kind].properties).sort());
    }
  });

  it('recomputes every vector independently using runner Python standard library', () => {
    const script = [
      'import json,hashlib,sys',
      'doc=json.load(open(sys.argv[1],encoding="utf-8"))',
      'assert doc["profile"]=="DWE-HASH-v1"',
      'for v in doc["vectors"]:',
      ' domain=("defi-workflow-engine/"+v["domain"]).encode("ascii")',
      ' data=bytes.fromhex(v["payloadHex"])',
      ' frame=b"DWE-HASH"+bytes([0,1])+len(domain).to_bytes(2,"big")+domain+len(data).to_bytes(8,"big")+data',
      ' assert frame.hex()==v["preimageHex"]',
      ' assert "0x"+hashlib.sha256(frame).hexdigest()==v["digest"]',
      ' if "value" in v:',
      '  canonical=json.dumps(v["value"],sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False).encode("utf-8")',
      '  assert canonical==data',
      ' else: assert bytes.fromhex(v["rawHex"])==data',
      'print(len(doc["vectors"]))',
    ].join('\n');
    const path = new URL('../../../tests/compatibility/v1/hash-vectors.json', import.meta.url);
    expect(execFileSync('python3', ['-c', script, path.pathname], { encoding: 'utf8' }).trim())
      .toBe('12');
  });

  it('changes material field hashes and canonicalizes set-valued graph order', () => {
    const original = read('semantic-workflow.json');
    const modified = structuredClone(original);
    modified.revision += 1;
    expect(hashArtifactValue('semantic-workflow', modified))
      .not.toBe(hashArtifactValue('semantic-workflow', original));
    const policy = read('authorization-policy.json');
    const reordered = structuredClone(policy);
    reordered.allowlists.chains = ['eip155:2', 'eip155:1'];
    const sorted = structuredClone(reordered);
    sorted.allowlists.chains.reverse();
    expect(hashArtifactValue('authorization-policy', reordered))
      .toBe(hashArtifactValue('authorization-policy', sorted));
    expect(hashArtifactValue('authorization-policy', reordered))
      .not.toBe(hashArtifactValue('authorization-policy', policy));
  });

  it('binds every journal entry to its predecessor and rejects broken links', () => {
    const journal = read('execution-journal.json');
    const hashes = hashJournalEntries(journal);
    expect(hashes).toHaveLength(4);
    expect(journal.entries[1].previousEntryHash).toBe(hashes[0]);
    const broken = structuredClone(journal);
    broken.entries[2].previousEntryHash = '0x' + '0'.repeat(64);
    expect(() => hashJournalEntries(broken)).toThrow('predecessor');
    expect(() => hashArtifactBytes('execution-journal' as StructuredHashKind, new TextEncoder().encode(JSON.stringify(journal))))
      .toThrow();
  });

  it('rejects ambiguous or non-JSON canonical values', () => {
    expect(() => canonicalJson({ amount: Number.NaN })).toThrow();
    expect(() => canonicalJson({ amount: undefined })).toThrow();
    expect(() => canonicalJson({ value: '\ud800' })).toThrow('surrogate');
    expect(() => hashData('unknown' as HashKind, new Uint8Array())).toThrow('domain');
    expect(() => hashRawBytes('semantic-workflow' as 'payload', new Uint8Array())).toThrow();
  });
});
