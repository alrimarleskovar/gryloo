// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createLogger, type Database } from '@defi-workflow-engine/cloud-runtime';
import { CROSSCHAIN_ROUTER_BASE_SEPOLIA_ARBITRUM_SEPOLIA as TESTNET } from '@defi-workflow-engine/action-registry';
import { createMockedSolanaDevnetOrca, createMockedSolanaWallet } from '@defi-workflow-engine/reference-compiler';
import { createBackend } from '../../backend/app.ts';
import type { FlowName, Rpc } from '../../backend/flows.ts';
import { createRouterHarness, ROUTER_OWNER } from '../../e2e/router-harness.ts';
import { supplyModel, SUPPLY_OWNER } from '../../e2e/supply-fixtures';
import { createUniswapLiquidityChain, UNI_OWNER } from '../../e2e/uniswap-liquidity-harness.ts';
import { composeStrategy } from '../engine/strategy-engine';
import { credential, gatewayEnv, session } from './gateway.test-harness';
import { embeddedMcpRuntime, type McpRuntime } from './runtime';
import { assertSafeOutput, previewPlan, projectSimulation } from './simulation';

const quiet = createLogger({ service: 'test', sink: () => undefined });
const SEND = ['eth_sendTransaction', 'eth_sendRawTransaction', 'sendTransaction'];
/** A database that fails the test if anything reads or writes it: previews must persist nothing. */
const untouchable = { query: async () => { throw new Error('DB_TOUCHED'); }, close: async () => undefined } as unknown as Database;
const alice = { principal: 'dev-alice', token: credential() };
const env = gatewayEnv([alice]);

type Seams = Parameters<typeof createBackend>[0];
function previewRuntime(flowEnv: Record<string, string>, seams: Pick<Seams, 'rpc' | 'routers' | 'http'>) {
  const backend = createBackend({ db: untouchable, env: flowEnv, logger: quiet, tenantId: 'default', holderId: 'test', evidenceStore: null, busyRetries: 1, ...seams });
  const runtime: McpRuntime = embeddedMcpRuntime({ backend, run: async () => null, journal: async () => null });
  return { backend, runtime, client: session({ env, token: alice.token, runtime }) };
}
const recording = (rpc: Rpc, methods: string[]): Rpc => (method, params) => { methods.push(method); return rpc(method, params); };
async function simulate(client: ReturnType<typeof session>, strategy: Record<string, unknown>, subject: string) {
  const composed = (await client.callTool('compose_strategy', { strategy })).output;
  return client.callTool('simulate_strategy', { strategy, workflowHash: composed.workflowHash, simulationSubject: subject });
}
/** Every executable string of a raw preview record (calldata, unsigned transactions, commitments, ids) must be absent from the MCP output. */
function secretsOf(raw: unknown): string[] {
  const out: string[] = [];
  const walk = (value: unknown, key = '') => {
    if (typeof value === 'string') {
      if (/^(data|unsignedTransaction|message|commitment)$/.test(key) && value.length >= 10 || key === 'id' && /^(xroute|supply|unilp|orca|jupiter|lending|pub)-/.test(value)) out.push(value);
      return;
    }
    if (Array.isArray(value)) { value.forEach(v => walk(v, key)); return; }
    if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, k);
  };
  walk(raw);
  return out;
}

describe('BUILD-MCP-001 simulate_strategy: the flows\' own simulation as a read-only preview', () => {
  it('Router testnet: live-shaped quote and transaction simulation, nothing persisted, no send method, no calldata in the output', async () => {
    const h = createRouterHarness({ profile: TESTNET }), methods: string[] = [];
    const { backend, client } = previewRuntime({ GRYLOO_ROUTER_TESTNET_HARNESS: 'MOCKED_LOOPBACK_ONLY' }, {
      rpc: { 'crosschain-router-testnet': recording(h.baseRpc, methods) }, routers: { 'crosschain-router-testnet': { destinationRpc: recording(h.arbitrumRpc, methods), providers: h.providers } } });
    const strategy = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5', routing: 'auto' };
    const result = await simulate(client, strategy, ROUTER_OWNER);
    expect(result.isError, result.text).toBe(false);
    expect(result.output).toMatchObject({ ok: true, flow: 'crosschain-router-testnet', kind: 'CROSS_CHAIN_ROUTE', provenance: 'MOCKED', preview: true, persisted: false,
      authorizable: false, evidenceLevel: 'MOCKED_SIMULATION_PREVIEW', simulationSubject: ROUTER_OWNER, subjectRole: 'SIMULATION_SUBJECT_ONLY_NOT_AN_OWNER_OR_AUTHORIZATION' });
    const facts = result.output.facts as Record<string, Record<string, unknown>>;
    expect(facts.quote).toMatchObject({ provider: 'lifi', inputAmount: '5000000' });
    expect(facts.transactionSimulation).toMatchObject({ method: 'eth_simulateV1' });
    const artifacts = result.output.canonicalArtifacts as { simulationBundle: { hash: string }; strategyManifest: { artifact: { owner: unknown } } };
    expect(artifacts.simulationBundle.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(artifacts.strategyManifest.artifact.owner).toEqual({ chainId: 'eip155:84532', address: ROUTER_OWNER });
    expect(methods.filter(m => SEND.includes(m))).toEqual([]);
    expect(h.counters.sends).toBe(0);
    // The raw preview (server-side only) holds calldata, a commitment and an ephemeral run id; none reaches the client.
    const composed = composeStrategy(strategy);
    if (!composed.ok) throw new Error(composed.code);
    const raw = await backend.previewFlow('crosschain-router-testnet', [composed.workflow, ROUTER_OWNER]);
    if (!raw.ok) throw new Error(raw.code);
    const secrets = secretsOf(raw.value);
    expect(secrets.length).toBeGreaterThan(3);
    for (const secret of secrets) expect(result.text).not.toContain(secret);
    // The ephemeral run exists nowhere durable: any flow call that would load it reaches storage and fails (zero rows: PostgreSQL suite).
    const id = (raw.value as { id: string }).id;
    expect((await backend.callFlow('crosschain-router-testnet', 'status', [id], 'default', ROUTER_OWNER)).ok).toBe(false);
  });

  it('Router mainnet preview is read-only and marked as such; a disabled flow fails closed with its own code', async () => {
    const h = createRouterHarness();
    const { client } = previewRuntime({ GRYLOO_ROUTER_HARNESS: 'MOCKED_LOOPBACK_ONLY' }, { rpc: { 'crosschain-router': h.baseRpc }, routers: { 'crosschain-router': { destinationRpc: h.arbitrumRpc, providers: h.providers } } });
    const strategy = { action: 'bridge', sourceNetwork: 'base', destinationNetwork: 'arbitrum-one', asset: 'USDC', amount: '10' };
    expect((await simulate(client, strategy, ROUTER_OWNER)).output).toMatchObject({ ok: true, flow: 'crosschain-router', persisted: false });
    const off = previewRuntime({}, { rpc: { 'crosschain-router': h.baseRpc }, routers: { 'crosschain-router': { destinationRpc: h.arbitrumRpc, providers: h.providers } } });
    expect((await simulate(off.client, strategy, ROUTER_OWNER)).output).toEqual({ ok: false, code: 'ROUTER_NOT_ENABLED' });
  });

  it('Aave V3 supply preview on the MOCKED Base Sepolia reserve', async () => {
    const model = supplyModel(), methods: string[] = [];
    const { client } = previewRuntime({ GRYLOO_SUPPLY_HARNESS: 'MOCKED_LOOPBACK_ONLY' }, { rpc: { 'aave-supply': recording(model.rpc as Rpc, methods) } });
    const result = await simulate(client, { action: 'supply', network: 'base-sepolia', asset: 'USDC', amount: '10', beneficiary: SUPPLY_OWNER }, SUPPLY_OWNER);
    expect(result.output, result.text).toMatchObject({ ok: true, flow: 'aave-supply', kind: 'AAVE_V3', provenance: 'MOCKED', facts: { operation: 'SUPPLY', amount: '10000000' } });
    expect(Object.keys(result.output.canonicalArtifacts as object).sort()).toEqual(['authorizationPolicy', 'simulationBundle', 'strategyManifest']);
    expect(methods.filter(m => SEND.includes(m))).toEqual([]);
  });

  it('Uniswap v3 liquidity preview on the MOCKED Base Sepolia pool', async () => {
    const chain = createUniswapLiquidityChain();
    const { client } = previewRuntime({ GRYLOO_UNISWAP_LIQUIDITY_HARNESS: 'MOCKED_LOOPBACK_ONLY' }, { rpc: { 'uniswap-liquidity': chain.rpc as Rpc } });
    const result = await simulate(client, { action: 'add_liquidity', network: 'base-sepolia', maxAmounts: { USDC: '10', WETH: '0.005' },
      range: { unit: 'tick', lower: '220000', upper: '230000' } }, UNI_OWNER);
    expect(result.output, result.text).toMatchObject({ ok: true, flow: 'uniswap-liquidity', kind: 'CONCENTRATED_LIQUIDITY', provenance: 'MOCKED', canonicalArtifacts: null });
    expect((result.output.facts as { range: { tickLower: number } }).range.tickLower).toBe(220000);
  });

  it('Solana Devnet Orca swap preview with a Solana simulation subject', async () => {
    const chain = createMockedSolanaDevnetOrca(), wallet = createMockedSolanaWallet();
    chain.fund(wallet.owner, 3_000_000_000n, 50_000_000n);
    const { client } = previewRuntime({ GRYLOO_SOLANA_DEVNET_HARNESS: 'MOCKED_LOOPBACK_ONLY' }, { rpc: { 'solana-devnet-swap': chain.rpc as Rpc } });
    const strategy = { action: 'swap', network: 'solana-devnet', inputAsset: 'SOL', outputAsset: 'devUSDC', amount: '0.1' };
    const result = await simulate(client, strategy, wallet.owner);
    expect(result.output, result.text).toMatchObject({ ok: true, flow: 'solana-devnet-swap', kind: 'SOLANA_SWAP', provenance: 'MOCKED' });
    expect(chain.state.sent).toHaveLength(0);
    expect((await simulate(client, strategy, ROUTER_OWNER)).output).toEqual({ ok: false, code: 'SIMULATION_SUBJECT_INVALID' });
  });

  it('refuses what MCP cannot preview, stale hashes and non-cloud runtimes, without reaching any flow', async () => {
    const { client } = previewRuntime({}, {});
    expect((await simulate(client, { action: 'swap', network: 'base', inputAsset: 'USDC', outputAsset: 'WETH', amount: '1' }, ROUTER_OWNER)).output)
      .toEqual({ ok: false, code: 'SIMULATION_LOCAL_FORK_ONLY' });
    expect((await simulate(client, { action: 'add_liquidity', network: 'solana-devnet', maxAmounts: { SOL: '0.01', devUSDC: '0.3' },
      range: { unit: 'tick', lower: '-29952', upper: '-25600' } }, ROUTER_OWNER)).output).toEqual({ ok: false, code: 'SIMULATION_REQUIRES_OWNER_BROWSER' });
    const bridge = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5' };
    expect((await client.callTool('simulate_strategy', { strategy: bridge, workflowHash: '0x' + '1'.repeat(64), simulationSubject: ROUTER_OWNER })).output)
      .toEqual({ ok: false, code: 'STRATEGY_WORKFLOW_HASH_MISMATCH', issues: [] });
    const local = session({ env, token: alice.token });
    expect((await simulate(local, bridge, ROUTER_OWNER)).output).toEqual({ ok: false, code: 'MCP_CLOUD_RUNTIME_REQUIRED' });
    const hosted = session({ env: { ...env, VERCEL: '1' }, token: alice.token });
    expect((await simulate(hosted, bridge, ROUTER_OWNER)).output).toEqual({ ok: false, code: 'CLOUD_RUNTIME_NOT_CONFIGURED' });
  });

  it('caps concurrent previews per instance (best effort) and releases the slot afterwards', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const slow: McpRuntime = { kind: 'embedded', mode: async () => 'harness', run: async () => ({ ok: true, value: null }), journal: async () => ({ ok: true, value: null }),
      evidence: async () => ({ ok: true, value: null }), preview: async () => { await gate; return { ok: false, code: 'ROUTER_NO_EXECUTABLE_ROUTE' }; } };
    const client = session({ env, token: alice.token, runtime: slow });
    const bridge = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5' };
    const running = [simulate(client, bridge, ROUTER_OWNER), simulate(client, bridge, ROUTER_OWNER)];
    await new Promise(resolve => setTimeout(resolve, 50));
    expect((await simulate(client, bridge, ROUTER_OWNER)).output).toEqual({ ok: false, code: 'MCP_SIMULATION_BUSY' });
    release();
    for (const result of await Promise.all(running)) expect(result.output).toEqual({ ok: false, code: 'ROUTER_NO_EXECUTABLE_ROUTE' });
    expect((await simulate(client, bridge, ROUTER_OWNER)).output).toEqual({ ok: false, code: 'ROUTER_NO_EXECUTABLE_ROUTE' });
  });
});

describe('BUILD-MCP-001 preview planning and the output guard', () => {
  it('maps every strategy to its existing flow or to an explicit reason', () => {
    const plan = (s: Record<string, unknown>) => previewPlan(s as never);
    expect(plan({ action: 'bridge', sourceNetwork: 'base-sepolia' })).toEqual({ flow: 'crosschain-router-testnet', subject: 'EVM' });
    expect(plan({ action: 'swap', network: 'ethereum-sepolia' })).toEqual({ flow: 'base-sepolia-swap', subject: 'NONE' });
    expect(plan({ action: 'swap', network: 'solana' })).toEqual({ flow: 'jupiter-swap', subject: 'SOLANA' });
    expect(plan({ action: 'withdraw', network: 'ethereum-sepolia' })).toEqual({ flow: 'aave-supply', subject: 'EVM' });
    expect(plan({ action: 'lending_composition' })).toEqual({ flow: 'lending-composition', subject: 'EVM' });
  });

  it('projects a swap quote by allowlist and drops everything else', () => {
    const view = projectSimulation('base-sepolia-swap' as FlowName, { quote: { executionId: 'pub-0123456789abcdef01234567', chainId: 'eip155:84532', amountIn: '1000000',
      expectedOut: '400000000000000', minimumOut: '398000000000000', manifestHash: '0x' + 'a'.repeat(64), observedAt: '2026-10-06T00:00:00.000Z', expiresAt: '2026-10-06T00:01:00.000Z' },
      attempts: [{ tx: { data: '0x' + 'ab'.repeat(100) } }], workflow: {} });
    expect(view).toMatchObject({ kind: 'SWAP_QUOTE', facts: { chainId: 'eip155:84532', amountIn: '1000000', minimumOut: '398000000000000' } });
    expect(JSON.stringify(view)).not.toMatch(/pub-|ababab|manifestHash/);
    expect(() => projectSimulation('robinhood-transfer' as FlowName, {})).toThrow('MCP_SIMULATION_PROJECTION_FAILED');
  });

  it('fails any output carrying executable material or secrets', () => {
    for (const bad of [{ data: '0x095ea7b3' }, { nested: [{ calldata: '0x' }] }, { tx: {} }, { unsignedTransaction: 'AQAB' }, { privateKey: 'x' }, { mnemonic: 'x' },
      { signature: 'x' }, { commitment: '0x' + '1'.repeat(64) }, { note: '0x' + 'ab'.repeat(40) }, { blob: 'A'.repeat(240) }])
      expect(() => assertSafeOutput(bad), JSON.stringify(bad).slice(0, 40)).toThrow('MCP_OUTPUT_GUARD');
    assertSafeOutput({ workflowHash: '0x' + 'f'.repeat(64), spender: '0x' + '2'.repeat(40), functionId: '0x095ea7b3', mint: 'So11111111111111111111111111111111111111112',
      nonce: '0', token: '0x' + '3'.repeat(40), message: 'Review the route.' });
  });
});
