// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { editorReducer, initialEditor } from '../domain/editor';
import { savedWorkflowHash, validateSavedWorkflow } from '../domain/saved-workflow';
import { BASE_SEPOLIA, ETHEREUM_SEPOLIA_SWAP, type PublicSwapProfile } from '../domain/public-testnet-swap';
import { createEthereumSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { createMockedSolanaJupiter, createMockedSolanaDevnetOrca, createMockedSolanaWallet } from '@defi-workflow-engine/reference-compiler';
import { createSolanaSwapNode, type SolanaSwapInput } from '../domain/jupiter-authoring';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { readBuildEstimate } from './build-estimate';
import { readBaseQuoteOnServer, referenceContext } from './base-rpc';
import { fileURLToPath } from 'node:url';
const now = new Date('2026-10-08T12:00:00Z');
const word = (value: bigint) => '0x' + value.toString(16).padStart(64, '0');
const address = (value: string) => '0x' + value.slice(2).padStart(64, '0');
function authored(kind: 'ADD_SWAP' | 'ADD_TESTNET_SWAP' | 'ADD_ETHEREUM_SEPOLIA_SWAP' = 'ADD_TESTNET_SWAP') {
  return validateSavedWorkflow(editorReducer(initialEditor(), { type: kind, direction: kind === 'ADD_SWAP' ? 'WETH_TO_USDC' : 'USDC_TO_WETH', amount: kind === 'ADD_SWAP' ? '1' : '2', slippage: '50', source: 'CANVAS', baseRevision: 0 }, kind === 'ADD_SWAP' ? referenceContext() : kind === 'ADD_ETHEREUM_SEPOLIA_SWAP' ? createEthereumSepoliaReviewContext() : createBaseSepoliaReviewContext()).workflow);
}
function rpc(profile: PublicSwapProfile = BASE_SEPOLIA, chain = profile.chainHex) {
  return vi.fn(async (method: string, args: readonly unknown[]) => {
    if (method === 'eth_chainId') return chain;
    if (method === 'eth_getBlockByNumber') return { number: '0x64', hash: '0x' + 'a'.repeat(64), timestamp: '0x' + (now.getTime() / 1000).toString(16) };
    if (method === 'eth_getCode') return '0x6000';
    if (method === 'eth_call') {
      const call = args[0] as { to: string; data: string }, selector = call.data.slice(0, 10);
      const addresses: Record<string, string> = { '0xc45a0155': profile.factory, '0x4aa4a4fc': profile.weth, '0x1698ee82': profile.pool, '0x0dfe1681': profile.usdc, '0xd21220a7': profile.weth };
      if (addresses[selector]) return address(addresses[selector]);
      if (selector === '0x313ce567') return word(call.to === profile.usdc ? 6n : 18n);
      if (selector === '0xddca3f43') return word(BigInt(profile.fee));
      if (selector === '0x1a686502' || selector === '0x3850c7bd') return word(1n);
      if (selector === '0xc6a5026a') return word(1_000_000_000_000_000n);
    }
    throw Error('UNEXPECTED_READ');
  });
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('read-only Build estimates', () => {
  it('uses the existing public quote reader and binds output, chain, provider and workflow hash', async () => {
    const workflow = authored(), reader = rpc();
    expect(await readBuildEstimate({ workflow, nodeId: 'node-002' }, { NODE_ENV: 'production' }, { rpc: reader, now: () => now })).toEqual({ ok: true, estimate: {
      workflowHash: savedWorkflowHash(workflow), nodeId: 'node-002', chain: BASE_SEPOLIA.chainRef, provider: 'Uniswap V3', expected: '0.001', minimum: '0.000995', symbol: 'WETH', slippageBps: 50, expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    } });
    expect(reader.mock.calls.every(([method]) => ['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call'].includes(method))).toBe(true);
  });
  it('quotes Ethereum Sepolia through its own verified pool and chain profile', async () => {
    const workflow = authored('ADD_ETHEREUM_SEPOLIA_SWAP'), reader = rpc(ETHEREUM_SEPOLIA_SWAP);
    expect(await readBuildEstimate({ workflow, nodeId: 'node-002' }, {}, { rpc: reader, now: () => now })).toMatchObject({ ok: true, estimate: {
      chain: ETHEREUM_SEPOLIA_SWAP.chainRef, provider: 'Uniswap V3', workflowHash: savedWorkflowHash(workflow), expected: '0.001', minimum: '0.000995', symbol: 'WETH',
    } });
    expect(reader.mock.calls.filter(([method]) => method === 'eth_call').every(([, args]) => !JSON.stringify(args).includes(BASE_SEPOLIA.pool))).toBe(true);
  });
  it.each(['Solana', 'Solana Devnet'] as const)('reads the existing %s runtime without signing, submitting or creating durable authority', async network => {
    const wallet = createMockedSolanaWallet(), harness = network === 'Solana' ? createMockedSolanaJupiter() : createMockedSolanaDevnetOrca();
    if (network === 'Solana') (harness as ReturnType<typeof createMockedSolanaJupiter>).fund(wallet.owner, 3_000_000_000n, { USDC: 100_000_000n });
    else (harness as ReturnType<typeof createMockedSolanaDevnetOrca>).fund(wallet.owner, 3_000_000_000n, 100_000_000n);
    const input: SolanaSwapInput = { network, from: 'SOL', to: network === 'Solana' ? 'USDC' : 'devUSDC', amount: '0.01', slippage: '50' };
    const workflow: SemanticWorkflow = { schemaVersion: '1.0.0', workflowId: 'read-only-swap', revision: 1, resourceEdges: [], nodes: [createSolanaSwapNode('swap', input)] };
    const methods: string[] = [];
    const result = await readBuildEstimate({ workflow, nodeId: 'swap', owner: wallet.owner }, {}, {
      rpc: (method, args) => { methods.push(method); return harness.rpc(method, args); },
      ...network === 'Solana' ? { http: (harness as ReturnType<typeof createMockedSolanaJupiter>).http } : {}, now: () => now,
    });
    expect(result).toMatchObject({ ok: true, estimate: { workflowHash: savedWorkflowHash(workflow), chain: workflow.nodes[0]!.chainId,
      provider: network === 'Solana' ? 'Jupiter' : 'Orca Whirlpools', symbol: input.to, slippageBps: 50 } });
    if (!result.ok) throw Error(result.code);
    expect(Number(result.estimate.expected)).toBeGreaterThan(0); expect(Number(result.estimate.minimum)).toBeLessThan(Number(result.estimate.expected));
    for (const key of ['authorization', 'review', 'manifest', 'unsignedTransaction', 'attempt']) expect(result.estimate).not.toHaveProperty(key);
    expect(methods).not.toContain('sendTransaction'); expect(harness.state.sent).toEqual([]);
    expect(await readBuildEstimate({ workflow, nodeId: 'swap' }, {})).toEqual({ ok: false, code: 'ESTIMATE_UNSUPPORTED' });
  });
  it('rejects the wrong provider network without publishing financial values', async () => {
    expect(await readBuildEstimate({ workflow: authored(), nodeId: 'node-002' }, {}, { rpc: rpc(BASE_SEPOLIA, ETHEREUM_SEPOLIA_SWAP.chainHex), now: () => now })).toEqual({ ok: false, code: 'ESTIMATE_UNAVAILABLE' });
  });
  it('returns honest unavailability for RPC failure and unsupported nodes', async () => {
    expect(await readBuildEstimate({ workflow: authored(), nodeId: 'node-002' }, {}, { rpc: async () => { throw Error('offline'); } })).toEqual({ ok: false, code: 'ESTIMATE_UNAVAILABLE' });
    expect(await readBuildEstimate({ workflow: authored(), nodeId: 'node-404' }, {})).toEqual({ ok: false, code: 'ESTIMATE_UNAVAILABLE' });
  });
  it('honors the supplied production restriction before any Base mainnet live read', async () => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('GRYLOO_BASE_OBSERVATION', 'live'); vi.stubEnv('GRYLOO_ALCHEMY_API_KEY', 'synthetic-test-key');
    const transport = vi.fn().mockRejectedValue(Error('No network in this test')); vi.stubGlobal('fetch', transport);
    expect(await readBuildEstimate({ workflow: authored('ADD_SWAP'), nodeId: 'node-002' }, { NODE_ENV: 'production', GRYLOO_BASE_OBSERVATION: 'live' })).toEqual({ ok: false, code: 'ESTIMATE_UNAVAILABLE' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('does not present a recorded replay as a live Build estimate', async () => {
    const transport = vi.fn(); vi.stubGlobal('fetch', transport);
    vi.spyOn(process, 'cwd').mockReturnValue(fileURLToPath(new URL('../../', import.meta.url)));
    const input = { workflow: authored('ADD_SWAP'), nodeId: 'node-002' }, env = { NODE_ENV: 'production', GRYLOO_BASE_OBSERVATION: 'replay' };
    expect(await readBaseQuoteOnServer(input, { env })).toMatchObject({ ok: true });
    expect(await readBuildEstimate(input, env)).toEqual({ ok: false, code: 'ESTIMATE_UNAVAILABLE' });
    expect(transport).not.toHaveBeenCalled();
  });
});
