// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASE_CODE_PINS, buildModeAPair, decodeUnsignedPayload, payloadIdentity, toHex } from '@defi-workflow-engine/reference-compiler';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createReviewContext } from '@defi-workflow-engine/reference-linter';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createMockNode } from '../domain/mock-actions';
import { createSwapNode } from '../domain/swap-authoring';
import { createModeAService, decodePayloadView, flzCompressLen, modeASwapFromWorkflow, opStackFee, parseModeAProfile, profileHash, walletRequestFor } from './mode-a-service';

const OWNER = '0x8ef12e4e2fd397c227492019f626b5d1c5e41b3b';
const HASH = `0x${'ab'.repeat(32)}`;
const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]?.id,
  actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });
const profile = (overrides: Record<string, unknown> = {}) => ({ format: 'gryloo.mode-a-fork-profile.v1', environment: 'FORK_REPRODUCED',
  rpcUrl: 'http://127.0.0.1:8545', sourceChainId: 8453, sourceBlockNumber: 36_000_000, sourceBlockHash: HASH,
  stateSourceHash: `0x${'cd'.repeat(32)}`, owner: OWNER, syntheticCodePins: null, ...overrides });
const pins = { usdc: `0x${'01'.repeat(32)}`, weth: `0x${'02'.repeat(32)}`, factory: `0x${'03'.repeat(32)}`, quoter: `0x${'04'.repeat(32)}` };
const workflow = (nodes: SemanticWorkflow['nodes'], edges: SemanticWorkflow['resourceEdges'] = []): SemanticWorkflow =>
  ({ schemaVersion: '1.0.0', workflowId: 'workflow-local', revision: 3, nodes, resourceEdges: edges });

describe('Mode A fork profile boundary', () => {
  it('accepts an exact loopback FORK_REPRODUCED profile without substitute pins', () => {
    const parsed = parseModeAProfile(profile());
    expect(parsed.environment).toBe('FORK_REPRODUCED');
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(profileHash(parsed)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(profileHash(parseModeAProfile(profile({ sourceBlockNumber: 36_000_001 })))).not.toBe(profileHash(parsed));
  });
  it('refuses provider URLs, extra fields, default accounts and any pin substitution outside MOCKED', () => {
    for (const bad of [profile({ rpcUrl: 'https://base-mainnet.g.alchemy.com/v2' }), profile({ rpcUrl: 'http://localhost:8545' }),
      profile({ sourceChainId: 1 }), profile({ syntheticCodePins: pins }), profile({ extra: true }), profile({ owner: OWNER.toUpperCase() }),
      profile({ environment: 'MAINNET_EXECUTED' }), profile({ environment: 'MOCKED', syntheticCodePins: null }),
      profile({ environment: 'MOCKED', syntheticCodePins: { ...pins, usdc: BASE_CODE_PINS.usdc } })]) {
      expect(() => parseModeAProfile(bad), JSON.stringify(bad).slice(0, 90)).toThrow(/^MODE_A_PROFILE_INVALID$/);
    }
    expect(() => parseModeAProfile(profile({ owner: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' }))).toThrow(/^MODE_A_DEFAULT_ACCOUNT_REFUSED$/);
    expect(parseModeAProfile(profile({ environment: 'MOCKED', syntheticCodePins: pins, owner: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' })).environment).toBe('MOCKED');
  });
});

describe('Mode A workflow eligibility', () => {
  const swap = createSwapNode('node-002', 'WETH_TO_USDC', '1', '100', context);
  it('executes exactly one USDC/WETH swap and discloses excluded mock nodes', () => {
    expect(modeASwapFromWorkflow(workflow([swap]))).toMatchObject({ nodeId: 'node-002', direction: 'WETH_TO_USDC', amountIn: 10n ** 18n, slippageBps: 100, excludedMockNodes: [] });
    expect(modeASwapFromWorkflow(workflow([createMockNode('node-001', 'read'), swap])).excludedMockNodes).toEqual(['node-001']);
    expect(modeASwapFromWorkflow(workflow([createSwapNode('node-003', 'USDC_TO_WETH', '2500', '0', context)]))).toMatchObject({ direction: 'USDC_TO_WETH', amountIn: 2_500_000_000n, slippageBps: 0 });
  });
  it('refuses zero or several swaps, connected mocks and slippage above the reviewed ceiling', () => {
    expect(() => modeASwapFromWorkflow(workflow([createMockNode('node-001', 'read')]))).toThrow(/^WORKFLOW_NOT_ELIGIBLE$/);
    expect(() => modeASwapFromWorkflow(workflow([swap, { ...swap, nodeId: 'node-004' }]))).toThrow(/^WORKFLOW_NOT_ELIGIBLE$/);
    const dependent = { ...createMockNode('node-001', 'read'), dependencies: ['node-002'] };
    expect(() => modeASwapFromWorkflow(workflow([dependent, swap]))).toThrow(/^WORKFLOW_NOT_ELIGIBLE$/);
    expect(() => modeASwapFromWorkflow(workflow([{ ...swap, chainId: 'eip155:1' }]))).toThrow(/^WORKFLOW_NOT_ELIGIBLE$/);
    expect(() => modeASwapFromWorkflow(workflow([createSwapNode('node-005', 'WETH_TO_USDC', '1', '301', context)]))).toThrow(/^SLIPPAGE_NOT_ELIGIBLE$/);
  });
});

describe('Mode A payload views and durable journal', () => {
  const { approveBytes, swapBytes } = buildModeAPair({ owner: OWNER, tokenIn: '0x4200000000000000000000000000000000000006',
    tokenOut: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', amountIn: 10n ** 18n, amountOutMinimum: 1n, fee: 3000,
    deadline: 1_790_000_180n, nonce: 0n, approveGasLimit: 57_294n, swapGasLimit: 69_364n, maxFeePerGas: 1_796_246_614n });
  it('derives the wallet request field by field from the exact reviewed bytes', () => {
    const swap = decodeUnsignedPayload(swapBytes);
    expect(walletRequestFor(swapBytes, OWNER)).toEqual({ from: OWNER, to: swap.to, nonce: '0x1', gas: '0x10ef4', maxFeePerGas: '0x6b108c56',
      maxPriorityFeePerGas: '0xf4240', value: '0x0', data: toHex(swap.data), chainId: '0x7a69', type: '0x2' });
    expect(decodePayloadView(approveBytes)).toMatchObject({ functionSelector: '0x095ea7b3', approve: { spender: '0x2626664c2603336e57b271c5c0b26f421741e481', amount: '1000000000000000000' }, swap: null });
    expect(decodePayloadView(swapBytes).swap).toMatchObject({ recipient: OWNER, fee: 3000, amountOutMinimum: '1' });
    expect(payloadIdentity(approveBytes).payloadHash).not.toBe(payloadIdentity(swapBytes).payloadHash);
  });
  it('freezes a missing or corrupt journal before any chain read or wallet request', async () => {
    let reads = 0;
    const journalDir = mkdtempSync(join(tmpdir(), 'gryloo-mode-a-journal-'));
    const service = createModeAService({ call: async () => { reads++; throw new Error('NO_CHAIN'); }, profile: parseModeAProfile(profile()),
      journalDir, clock: async () => '2026-09-25T00:00:00.000Z' });
    await expect(service.beginStep('exec-000000000000000000000000', 'step-approve', 'key-approve-1')).rejects.toThrow(/^JOURNAL_CORRUPT$/);
    mkdirSync(join(journalDir, 'exec-111111111111111111111111'), { recursive: true });
    writeFileSync(join(journalDir, 'exec-111111111111111111111111', 'prepared.json'), '{"format":"gryloo.mode-a-prepared.v1"');
    await expect(service.status('exec-111111111111111111111111')).rejects.toThrow(/^JOURNAL_CORRUPT$/);
    await expect(service.beginStep('exec-111111111111111111111111', 'step-approve', 'key-approve-1')).rejects.toThrow(/^JOURNAL_CORRUPT$/);
    await expect(service.beginStep('../escape', 'step-approve', 'key-approve-1')).rejects.toThrow(/^EXECUTION_ID_INVALID$/);
    await expect(service.beginStep('exec-111111111111111111111111', 'step-approve', 'bad key')).rejects.toThrow(/^IDEMPOTENCY_KEY_INVALID$/);
    expect(await service.list()).toEqual(['exec-111111111111111111111111']);
    expect(reads).toBe(0);
  });
});

describe('OP-stack fee derivation used by independent reconciliation', () => {
  it('computes FastLZ lengths for literal-only and repetitive inputs', () => {
    expect(flzCompressLen(new Uint8Array())).toBe(0);
    expect(flzCompressLen(Uint8Array.from({ length: 12 }, (_, i) => i))).toBe(13);
    expect(flzCompressLen(Uint8Array.from({ length: 32 }, (_, i) => i))).toBe(33);
    expect(flzCompressLen(Uint8Array.from({ length: 33 }, (_, i) => i))).toBe(35);
    const repetitive = new Uint8Array(1_000);
    expect(flzCompressLen(repetitive)).toBeLessThan(40);
    expect(flzCompressLen(Uint8Array.from({ length: 1_000 }, (_, i) => (i * 7919) & 0xff))).toBeGreaterThan(flzCompressLen(repetitive));
  });
  it('applies the Fjord size floor, the scalars and the operator fee exactly', () => {
    const l1Block = { slot1: 1_000_000_000n, slot3: (2269n << 96n) | (1_055_931n << 64n) | 1n, slot7: 1n, slot8: 0n };
    // Measured on the pinned Anvil: a 100-byte-floor transaction costs 3,630,400,105 wei of L1 data fee.
    expect(opStackFee(new Uint8Array(10), 45_835n, l1Block)).toBe(3_630_400_105n);
    expect(opStackFee(new Uint8Array(10), 45_835n, { ...l1Block, slot8: (1_000_000_000n << 64n) | 1_000_000_000n }))
      .toBe(3_630_400_105n + 45_835n * 1_000_000_000n * 100n + 1_000_000_000n);
    expect(opStackFee(new Uint8Array(10), 1n, { slot1: 0n, slot3: 0n, slot7: 0n, slot8: 0n })).toBe(0n);
  });
});
