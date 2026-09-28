// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createReviewContext } from '@defi-workflow-engine/reference-linter';
import { Q96, decodeUnsignedPayload, fromHex, toHex } from '@defi-workflow-engine/reference-compiler';
import { signModeBLocalTransaction } from '@defi-workflow-engine/reference-executor';
import { initialWorkflow } from '../domain/initial-workflow';
import { createLiquidityNode } from '../domain/liquidity-authoring';
import { createLiquidityService, parseLiquidityProfile } from './liquidity-service';
const owner = '0x1111111111111111111111111111111111111111';
const pool = '0x2222222222222222222222222222222222222222';
const block = `0x${'a'.repeat(64)}`;
const source = `0x${'b'.repeat(64)}`;
const h = (n: string) => `0x${n.repeat(64)}`;
const w = (n: bigint) => n.toString(16).padStart(64, '0');
const addr = (a: string) => `0x${a.slice(2).padStart(64, '0')}`;
const code = '0x6001';
const codeHash = `0x${createHash('sha256').update(Buffer.from(code.slice(2), 'hex')).digest('hex')}`;
const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]?.id,
  actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });
const workflow = (recipient = owner) => { const original = structuredClone(initialWorkflow()) as unknown as SemanticWorkflow; original.nodes.push(createLiquidityNode('node-002',
  { weth: '0.1', usdc: '200', minimumWeth: '0', minimumUsdc: '0', tickLower: '-100', tickUpper: '100', recipient }, context));
  original.revision = 1; return original; };
const profile = parseLiquidityProfile({ format: 'gryloo.mode-a-fork-profile.v1', environment: 'MOCKED', rpcUrl: 'http://127.0.0.1:8545',
  sourceChainId: 8453, sourceBlockNumber: 1, sourceBlockHash: source, stateSourceHash: h('c'), owner,
  syntheticCodePins: { usdc: h('1'), weth: h('2'), factory: h('3'), quoter: h('4') },
  liquidity: { pool, fee: 500, poolCodeHash: codeHash, managerCodeHash: codeHash, factoryCodeHash: codeHash,
    usdcCodeHash: codeHash, wethCodeHash: codeHash } });
function transport(mutate: (method: string) => unknown | undefined = () => undefined) {
  const methods: string[] = [];
  const call = async (method: string, params: readonly unknown[] = []): Promise<unknown> => {
    methods.push(method);
    const override = mutate(method); if (override !== undefined) return override;
    if (method === 'eth_chainId') return '0x7a69';
    if (method === 'anvil_metadata') return { forkedNetwork: { chainId: 8453, forkBlockNumber: 1, forkBlockHash: source } };
    if (method === 'eth_getBlockByNumber') return { hash: block, number: '0x2', timestamp: '0x6ab717cd', baseFeePerGas: '0xf4240', transactions: [] };
    if (method === 'eth_getCode') return code;
    if (method === 'eth_getBalance') return '0xde0b6b3a7640000';
    if (method === 'eth_getTransactionCount') return '0x0';
    if (method === 'txpool_content') return { pending: {}, queued: {} };
    if (method === 'eth_simulateV1') return [{ calls: [{ status: '0x1', gasUsed: '0xc350' }] }];
    if (method === 'eth_call') {
      const request = params[0] as { to: string; data: string };
      const selector = request.data.slice(0, 10);
      if (selector === '0x1698ee82') return addr(pool);
      if (selector === '0xc45a0155') return addr('0x33128a8fc17869897dce68ed026d694621f6fdfd');
      if (selector === '0x4aa4a4fc' || selector === '0x0dfe1681') return addr('0x4200000000000000000000000000000000000006');
      if (selector === '0xd21220a7') return addr('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
      if (selector === '0xddca3f43') return `0x${w(500n)}`;
      if (selector === '0xd0c93a7c') return `0x${w(10n)}`;
      if (selector === '0x3850c7bd') return `0x${w(Q96)}${w(0n)}${w(0n)}${w(0n)}${w(0n)}${w(0n)}${w(1n)}`;
      if (selector === '0x70a08231') return `0x${w(request.to === '0x4200000000000000000000000000000000000006' ? 10n ** 18n : 1000n * 10n ** 6n)}`;
      if (selector === '0xdd62ed3e') return `0x${w(0n)}`;
    }
    throw new Error(`UNEXPECTED_LOCAL_RPC:${method}`);
  };
  return { call, methods };
}
describe('local liquidity service boundary', () => {
  it('prepares exact reviewed approval with canonical artifacts and durably freezes an unknown result', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gryloo-liquidity-test-'));
    try {
      const source = transport(); const service = createLiquidityService({ call: source.call, profile, journalDir: directory });
      const prepared = await service.prepare({ workflow: workflow(), operation: 'APPROVE_WETH' });
      expect(prepared.operation).toBe('APPROVE_WETH'); expect(prepared.payloadHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(prepared.artifacts.hashes.manifestHash).toMatch(/^0x[0-9a-f]{64}$/);
      const begun = await service.begin(prepared.executionId, 'approve-weth-1', workflow());
      expect(begun.attemptId).toContain('approve-weth');
      const after = await service.submission(prepared.executionId, begun.attemptId, { kind: 'UNKNOWN' });
      expect(after.journal?.frozen).toBe(true);
      await expect(service.prepare({ workflow: workflow(), operation: 'APPROVE_WETH' })).rejects.toThrow('LIQUIDITY_RECOVERY_REQUIRED');
      expect((await service.recoverUnknown(prepared.executionId)).journal?.frozen).toBe(true);
      expect(source.methods).toContain('txpool_content');
      expect(source.methods).not.toContain('eth_sendTransaction');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('projects a signed approval and independent readback into a canonical journal and MOCKED Evidence Bundle', async () => {
    // Public test vector: the address of the all-0x01 disposable key; the declared executor helper re-derives it.
    const key = new Uint8Array(32).fill(1);
    const signer = '0x1a642f0e3c3af545e7acbd38b07251b3990914f1';
    const forkProfile = parseLiquidityProfile({ ...profile, owner: signer });
    const receiptBlock = h('d');
    const approvalTopic = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';
    let mined = false, raw = '', transactionHash = '';
    const source = transport(method => {
      if (method === 'eth_getBalance') return mined ? '0xde0b6a803288c00' : '0xde0b6b3a7640000';
      if (method === 'eth_getTransactionCount') return mined ? '0x1' : '0x0';
      if (method === 'eth_getRawTransactionByHash') return raw;
      if (method === 'eth_getTransactionReceipt') return { transactionHash, blockHash: receiptBlock,
        status: '0x1', gasUsed: '0xc350', effectiveGasPrice: '0xf4240', l1Fee: '0x0',
        logs: [{ address: '0x4200000000000000000000000000000000000006',
          topics: [approvalTopic, `0x${signer.slice(2).padStart(64, '0')}`,
            `0x${'03a520b32c04bf3beef7beb72e919cf822ed34f1'.padStart(64, '0')}`],
          data: `0x${(10n ** 17n).toString(16).padStart(64, '0')}` }] };
      if (method === 'eth_getStorageAt') return `0x${w(0n)}`;
      if (method === 'eth_getBlockByHash') return { hash: receiptBlock, timestamp: '0x6ab717ce' };
      return undefined;
    });
    const call = async (method: string, params: readonly unknown[] = []) => {
      if (method === 'eth_call') {
        const request = params[0] as { to: string; data: string };
        if (request.data.startsWith('0xdd62ed3e') && request.to === '0x4200000000000000000000000000000000000006')
          return `0x${w(mined ? 10n ** 17n : 0n)}`;
      }
      return source.call(method, params);
    };
    const directory = await mkdtemp(join(tmpdir(), 'gryloo-liquidity-evidence-'));
    try {
      const service = createLiquidityService({ call, profile: forkProfile, journalDir: directory });
      const draft = workflow(signer);
      const prepared = await service.prepare({ workflow: draft, operation: 'APPROVE_WETH' });
      const started = await service.begin(prepared.executionId, 'approve-weth-evidence-1', draft);
      const unsigned = decodeUnsignedPayload(fromHex(prepared.bytes));
      const signed = signModeBLocalTransaction({ expectedExecutor: signer, to: unsigned.to, data: toHex(unsigned.data),
        nonce: unsigned.nonce, gasLimit: unsigned.gasLimit, maxFeePerGas: unsigned.maxFeePerGas }, key);
      raw = signed.raw; transactionHash = signed.hash; mined = true;
      await service.submission(prepared.executionId, started.attemptId, { kind: 'HASH', transactionHash });
      const result = await service.observe(prepared.executionId);
      expect(result.reconciliation).toMatchObject({ outcome: 'RECONCILED', code: 'EXACT_APPROVAL' });
      expect(result.evidence?.bundle).toMatchObject({ environment: 'MOCKED', outcome: 'RECONCILED',
        semanticWorkflowHash: prepared.workflowHash });
      expect(result.evidence?.evidenceBundleHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(result.canonicalJournal?.entries.length).toBeGreaterThan(10);
      expect(result.journal?.attempts.at(-1)?.state).toBe('CONFIRMED');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('fails before simulation on changed code and wrong fork chain', async () => {
    for (const mutate of [
      (method: string) => method === 'eth_getCode' ? '0x6002' : undefined,
      (method: string) => method === 'eth_chainId' ? '0x2105' : undefined,
    ]) {
      const directory = await mkdtemp(join(tmpdir(), 'gryloo-liquidity-test-'));
      try { const source = transport(mutate); const service = createLiquidityService({ call: source.call, profile, journalDir: directory });
        await expect(service.prepare({ workflow: workflow(), operation: 'APPROVE_WETH' })).rejects.toThrow();
        expect(source.methods).not.toContain('eth_simulateV1');
      } finally { await rm(directory, { recursive: true, force: true }); }
    }
  });
});
