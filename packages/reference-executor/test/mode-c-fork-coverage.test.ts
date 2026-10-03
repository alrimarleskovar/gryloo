// SPDX-License-Identifier: AGPL-3.0-only
/** Credential-free integrity checks for the failed genuine-fork preflight.
 * Passing these checks proves the blocker, never a financial execution. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { describe, it, expect } from 'vitest';
import { canonical } from '../../../apps/reference-dapp/e2e/fork/replay-upstream.mjs';
import { inventoryBuild016Recordings, probeBuild016Fork } from '../../../apps/reference-dapp/e2e/fork/build016-fork-preflight.mjs';

const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const read = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const evidencePath = 'docs/builds/BUILD-016-FORK-PREFLIGHT.json';
describe('BUILD-016 genuine fork coverage blocker (NOT_EXECUTION_EVIDENCE)', () => {
  it('verifies all available recordings and keeps their distinct source blocks', async () => {
    const inventory = await inventoryBuild016Recordings();
    expect(inventory.map(i => i.sourceBlockNumber)).toEqual([51797365, 51880679, 51906032]);
    expect(new Set(inventory.map(i => i.sourceBlockHash)).size).toBe(3);
    // The older BUILD-003 recording contains this slot at a DIFFERENT block; it is not a valid patch for BUILD-007.
    expect(inventory.map(i => i.wethDecimalsSlotRecorded)).toEqual([true, false, false]);
    expect((await read(evidencePath)).availableRecordings).toEqual(inventory);
  });
  it('independently verifies artifact and real protocol code commitments against source bytes', async () => {
    const evidence = await read(evidencePath);
    const { canonicalDocumentSha256, ...document } = evidence;
    expect(sha(canonical(document))).toBe(canonicalDocumentSha256);
    const sourceBytes = await readFile(evidence.source.path);
    expect(sha(sourceBytes)).toBe(evidence.source.sha256);
    const source = JSON.parse(sourceBytes.toString());
    for (const [address, hashes] of Object.entries(evidence.protocol.codeHashes)) {
      const entry = source.exchanges.find((e: {anvilRequest: string}) => {
        const request = JSON.parse(e.anvilRequest);
        return request.method === 'eth_getCode' && request.params[0] === address;
      });
      expect(entry).toBeDefined();
      const code = JSON.parse(entry.providerResponse).result;
      const bytes = Buffer.from(code.slice(2), 'hex');
      expect(hashes).toEqual({ bytesSha256: sha(bytes), evmKeccak256: '0x' + Buffer.from(keccak_256(bytes)).toString('hex') });
    }
    expect(evidence.financialMaturityAchieved).toBeNull();
    expect(evidence.financialTransactions).toEqual([]);
    expect(evidence.executionEvidenceBundle).toBeNull();
    expect(evidence.classification).toBe('NOT_EXECUTION_EVIDENCE');
    expect(evidence.reads.every((r: {request: {method: string}}) =>
      ['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'anvil_metadata'].includes(r.request.method))).toBe(true);
  });
  it('shows the unchanged authorizing collector actually failed closed on unrecorded state', async () => {
    const evidence = await read(evidencePath);
    expect(evidence.status).toBe('BLOCKED_MISSING_PINNED_STATE');
    expect(evidence.collector.status).toBe('BLOCKED');
    expect(evidence.collector.error).toContain('at 2:');
    expect(evidence.collector.error).toContain('FORK_STATE_UNRECORDED');
    expect(evidence.decimals[evidence.protocol.usdc].error).toContain('at 6:');
    const failed = evidence.reads.filter((r: {response: {error?: unknown}}) => r.response.error);
    expect(failed.length).toBe(5);
    for (const r of failed) expect(sha(canonical(r.response))).toBe(r.wireResponseCanonicalSha256);
  });
  it('checks the exact 5% boundary and necessary missing tick words without fabricating liquidity', async () => {
    const evidence = await read(evidencePath), p = evidence.priceTransitionCoverage;
    const ref = BigInt(p.referenceSqrtPriceX96), target = BigInt(p.maximumEligibleSqrtPriceX96);
    expect(target * target * 100n <= ref * ref * 95n).toBe(true);
    expect((target + 1n) * (target + 1n) * 100n > ref * ref * 95n).toBe(true);
    expect(p.initializedTicksToCross).toBe(51);
    expect(p.crossed[0].tick).toBe(-197370);
    expect(p.crossed.at(-1).tick).toBe(-197870);
    const recorded = new Set(evidence.source.poolStorageSlots.map((s: {slot: string}) => BigInt(s.slot).toString()));
    let missing = 0;
    for (const tick of p.crossed) {
      const word = (v: bigint) => BigInt.asUintN(256, v).toString(16).padStart(64, '0');
      const base = BigInt('0x' + Buffer.from(keccak_256(Buffer.from(word(BigInt(tick.tick)) + word(5n), 'hex'))).toString('hex'));
      const slots = Array.from({length: 4}, (_, i) => '0x' + word(base + BigInt(i)));
      expect(tick.slots).toEqual(slots);
      expect(tick.missingSlots).toEqual(slots.filter(s => !recorded.has(BigInt(s).toString())));
      missing += tick.missingSlots.length;
    }
    expect(missing).toBe(201);
    expect(p.missingTickStorageWords).toBe(missing);
    expect(p.tickProbes.every((t: {error: string}) => t.error.includes('FORK_STATE_UNRECORDED'))).toBe(true);
  });
  it('rejects public RPC and mismatched source pins before making any RPC read', async () => {
    const provenance = {upstream: 'CLOSED_REPLAY_ONLY', transcriptSha256: '337da42d5a89f504a37ea795703b52a340a27cfbac2ccbf6793de532c30a496d'};
    await expect(probeBuild016Fork({rpcUrl: 'https://mainnet.base.org', chainId: 31337, provenance})).rejects.toThrow('BUILD016_CLOSED_PROFILE_REQUIRED');
    await expect(probeBuild016Fork({rpcUrl: 'http://127.0.0.1:18545', chainId: 31337, provenance,
      sourceBlockNumber: 51906032, sourceBlockHash: '0x' + '0'.repeat(64)})).rejects.toThrow('BUILD016_SOURCE_PIN_MISMATCH');
  });
});
