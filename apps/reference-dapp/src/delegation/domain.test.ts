// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { BASE_SEPOLIA } from '../domain/public-testnet-swap.ts';
import { resolveAuthorityGraph, scopeHash, type GrantView } from './authority.ts';
import { stepCapability } from './capabilities.ts';
import { canonicalJson, domainDigest } from './canonical.ts';
import { authorizationDigest, buildManifest, executionSpend, manifestHash, manifestProblem, universalAuthorization, wideningOf, type DelegatedAuthorizationManifest,
  type LimitsInput } from './manifest.ts';
import { reservationViolation, stepPolicyViolation, type StepPlan, type Usage } from './policy.ts';
import { canMoveExecution, canMoveStep } from './state-machine.ts';
import { workflowRequirement, type WorkflowRequirement } from './steps.ts';

const EVM_OWNER = '0x' + 'a1'.repeat(20), SOL_OWNER = 'Fh4z9PzXvG1MZgB6m5aJ3ESmexpBwZx1WXxgQb3s9Bf8';
const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', DEV_USDC = 'BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k';
const NOW = Date.parse('2026-10-12T09:00:00.000Z');
const SWAP = { action: 'swap', network: 'base-sepolia', inputAsset: 'USDC', outputAsset: 'WETH', amount: '50', slippageBps: 50 } as const;
const SOL_SWAP = { action: 'swap', network: 'solana-devnet', inputAsset: 'devUSDC', outputAsset: 'SOL', amount: '5', slippageBps: 50 } as const;
const req = (strategy: unknown): WorkflowRequirement => { const r = workflowRequirement(strategy); if (!r.ok) throw new Error(r.code); return r.value; };
const USDC_KEY = `eip155:84532/erc20:${BASE_SEPOLIA.usdc}`, DEV_KEY = `${DEVNET}/token:${DEV_USDC}`;

function evmGrant(overrides: Partial<GrantView> = {}, scope: Partial<Extract<GrantView['scope'], { mechanism: 'EVM_ERC7710_METAMASK_V1_3' }>> = {}): GrantView {
  const s = { mechanism: 'EVM_ERC7710_METAMASK_V1_3' as const, chain: 'eip155:84532', router: BASE_SEPOLIA.router, maxCalls: 40,
    pairs: [{ tokenIn: BASE_SEPOLIA.usdc, tokenOut: BASE_SEPOLIA.weth, perCallInputCap: '100000000' }], validFrom: '2026-10-01T00:00:00.000Z', expiresAt: '2026-12-31T00:00:00.000Z', ...scope };
  return { grantId: 'grt_evm', credentialId: 'crd_evm', walletNamespace: 'eip155', walletAddress: EVM_OWNER, chain: 'eip155:84532', mechanism: 'EVM_ERC7710_METAMASK_V1_3',
    state: 'ACTIVE', scope: s, scopeHash: scopeHash(s), sessionAddress: '0x' + 'b2'.repeat(20), commitment: '0x' + 'c3'.repeat(32), passkeyId: 'pk_1', verifiedAt: null, callsUsed: 0, ...overrides };
}
function solGrant(overrides: Partial<GrantView> = {}, amount = '20000000'): GrantView {
  const s = { mechanism: 'SOLANA_SPL_DELEGATE_V1' as const, chain: DEVNET, accounts: [{ mint: DEV_USDC, decimals: 6, tokenAccount: 'Ag8z9PzXvG1MZgB6m5aJ3ESmexpBwZx1WXxgQb3s9Bf8', amount }],
    validFrom: '2026-10-01T00:00:00.000Z', expiresAt: '2026-12-31T00:00:00.000Z' };
  return { grantId: 'grt_sol', credentialId: 'crd_sol', walletNamespace: 'solana', walletAddress: SOL_OWNER, chain: DEVNET, mechanism: 'SOLANA_SPL_DELEGATE_V1',
    state: 'ACTIVE', scope: s, scopeHash: scopeHash(s), sessionAddress: 'Bs8z9PzXvG1MZgB6m5aJ3ESmexpBwZx1WXxgQb3s9Bf8', commitment: '0x' + 'd4'.repeat(32), passkeyId: 'pk_1', verifiedAt: null, callsUsed: 0, ...overrides };
}
const LIMITS: LimitsInput = { assets: [{ asset: USDC_KEY, maxPerExecution: '50000000', budgets: [{ period: 'WEEK', amount: '200000000' }] },
  { asset: DEV_KEY, maxPerExecution: '5000000', budgets: [{ period: 'WEEK', amount: '20000000' }] }], maxExecutionsPerPeriod: { count: 4, period: 'WEEK' },
  cooldownSeconds: 0, maxSlippageBps: 50 };
function manifestOf(r: WorkflowRequirement, limits: LimitsInput = LIMITS, revision = 1): DelegatedAuthorizationManifest {
  const graph = resolveAuthorityGraph(r, [evmGrant(), solGrant()], 'MOCKED_HARNESS', NOW);
  if (!graph.ok) throw new Error(JSON.stringify(graph.failures));
  return buildManifest({ owner: `eip155:${EVM_OWNER}`, authorizationId: 'dau_x', revision, now: new Date(NOW), validFrom: new Date(NOW), expiresAt: new Date('2026-12-31T00:00:00Z'),
    timezone: 'Europe/Lisbon', engineVersion: 'flofi-engine-2', requirement: r, bindings: graph.bindings,
    limits: { ...limits, assets: limits.assets.filter(a => [...executionSpend(r).keys()].includes(a.asset)) } });
}

describe('step requirements come from the canonical IR', () => {
  it('a Base Sepolia swap spends exactly 50 USDC (6 decimals) and returns WETH, through Uniswap v3', () => {
    const r = req(SWAP);
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]).toMatchObject({ chain: 'eip155:84532', namespace: 'eip155', action: 'swap', actionTypes: ['asset.swap.exact-input'], adapterId: 'uniswap.v3', slippageBps: 50,
      inputs: [{ address: BASE_SEPOLIA.usdc, decimals: 6, amount: 50_000_000n, symbol: 'USDC' }], outputs: [{ address: BASE_SEPOLIA.weth, decimals: 18 }] });
  });
  it('a two-domain workflow keeps both chains and the canonical sequence hash', () => {
    const r = req({ version: 2, steps: [SWAP, SOL_SWAP] });
    expect(r.chains).toEqual(['eip155:84532', DEVNET]);
    expect(r.steps.map(s => s.namespace)).toEqual(['eip155', 'solana']);
    expect(r.workflowHash).not.toBe(r.steps[0]!.stepHash);
  });
});

describe('capability matrix is deterministic and honest', () => {
  it.each([
    [SWAP, 'PRODUCTION', { ok: true, mechanism: 'EVM_ERC7710_METAMASK_V1_3' }],
    [SOL_SWAP, 'PRODUCTION', { ok: false, code: 'SOLANA_DELEGATED_BUILDER_NOT_IMPLEMENTED' }],
    [SOL_SWAP, 'MOCKED_HARNESS', { ok: true, mechanism: 'SOLANA_SPL_DELEGATE_V1', evidence: 'MOCKED' }],
    [{ ...SOL_SWAP, inputAsset: 'SOL', outputAsset: 'devUSDC' }, 'MOCKED_HARNESS', { ok: false, code: 'NATIVE_SOL_NOT_DELEGABLE' }],
    [{ action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5' }, 'MOCKED_HARNESS', { ok: false, code: 'DELEGATED_TARGET_SCOPE_UNAVAILABLE' }],
    [{ action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5', routing: 'across' }, 'PRODUCTION', { ok: false, code: 'DELEGATION_TEMPLATE_NOT_IMPLEMENTED' }],
    [{ action: 'supply', network: 'base-sepolia', asset: 'USDC', amount: '5', beneficiary: EVM_OWNER }, 'MOCKED_HARNESS', { ok: false, code: 'DELEGATION_TEMPLATE_NOT_IMPLEMENTED' }],
    [{ ...SWAP, network: 'base' }, 'MOCKED_HARNESS', { ok: false, code: 'MAINNET_DELEGATION_DISABLED' }],
  ] as const)('%j in %s', (strategy, mode, expected) => {
    expect(stepCapability(req(strategy).steps[0]!, mode)).toMatchObject(expected);
  });
});

describe('authority graph: every step resolves to exactly one active grant before anything is authorized', () => {
  const r = req({ version: 2, steps: [SWAP, SOL_SWAP] });
  it('binds the EVM step to the EVM credential and the Solana step to the Solana credential', () => {
    const graph = resolveAuthorityGraph(r, [solGrant(), evmGrant()], 'MOCKED_HARNESS', NOW);
    expect(graph).toMatchObject({ ok: true, bindings: [{ stepIndex: 0, credentialId: 'crd_evm', grantId: 'grt_evm' }, { stepIndex: 1, credentialId: 'crd_sol', grantId: 'grt_sol' }] });
  });
  it.each([
    ['a missing Solana credential', [evmGrant()], { stepIndex: 1, code: 'DELEGATED_AUTHORITY_UNAVAILABLE' }],
    ['a revoked Solana grant', [evmGrant(), solGrant({ state: 'REVOKED' })], { stepIndex: 1, code: 'CREDENTIAL_REVOKED' }],
    ['an unenrolled grant', [evmGrant(), solGrant({ state: 'PENDING_SIGNATURE' })], { stepIndex: 1, code: 'CREDENTIAL_NOT_ENROLLED' }],
    ['an expired EVM grant', [evmGrant({}, { expiresAt: '2026-10-11T00:00:00.000Z' }), solGrant()], { stepIndex: 0, code: 'CREDENTIAL_EXPIRED' }],
    ['an under-scoped amount', [evmGrant({}, { pairs: [{ tokenIn: BASE_SEPOLIA.usdc, tokenOut: BASE_SEPOLIA.weth, perCallInputCap: '49999999' }] }), solGrant()], { stepIndex: 0, code: 'CREDENTIAL_SCOPE_AMOUNT' }],
    ['another pair only', [evmGrant({}, { pairs: [{ tokenIn: BASE_SEPOLIA.weth, tokenOut: BASE_SEPOLIA.usdc, perCallInputCap: '1' }] }), solGrant()], { stepIndex: 0, code: 'CREDENTIAL_SCOPE_ASSET' }],
    ['another router', [evmGrant({}, { router: '0x' + '99'.repeat(20) }), solGrant()], { stepIndex: 0, code: 'CREDENTIAL_SCOPE_TARGET' }],
    ['exhausted calls', [evmGrant({ callsUsed: 39 }), solGrant()], { stepIndex: 0, code: 'CREDENTIAL_CALLS_EXHAUSTED' }],
    ['a too small token delegation', [evmGrant(), solGrant({}, '4999999')], { stepIndex: 1, code: 'CREDENTIAL_SCOPE_AMOUNT' }],
  ] as const)('fails the whole workflow before execution for %s', (_name, grants, failure) => {
    expect(resolveAuthorityGraph(r, grants as readonly GrantView[], 'MOCKED_HARNESS', NOW)).toMatchObject({ ok: false, failures: [failure] });
  });
  it('never switches silently away from a pinned grant', () => {
    const other = evmGrant({ grantId: 'grt_evm2' });
    expect(resolveAuthorityGraph(r, [other, solGrant()], 'MOCKED_HARNESS', NOW, [{ stepIndex: 0, grantId: 'grt_evm' }, { stepIndex: 1, grantId: 'grt_sol' }]))
      .toMatchObject({ ok: false, failures: [{ stepIndex: 0, code: 'CREDENTIAL_NOT_FOUND' }] });
  });
  it('a grant serving several steps must cover them together', () => {
    const twice = req({ version: 2, steps: [SWAP, SWAP] });
    expect(resolveAuthorityGraph(twice, [evmGrant({ callsUsed: 37 })], 'MOCKED_HARNESS', NOW)).toMatchObject({ ok: false, failures: [{ stepIndex: 1, code: 'CREDENTIAL_CALLS_EXHAUSTED' }] });
    expect(resolveAuthorityGraph(twice, [evmGrant({ callsUsed: 36 })], 'MOCKED_HARNESS', NOW).ok).toBe(true);
  });
  it('production mode refuses the Solana step even with an active grant', () => {
    expect(resolveAuthorityGraph(r, [evmGrant(), solGrant()], 'PRODUCTION', NOW)).toMatchObject({ ok: false, failures: [{ stepIndex: 1, code: 'SOLANA_DELEGATED_BUILDER_NOT_IMPLEMENTED' }] });
  });
});

describe('DelegatedAuthorizationManifest', () => {
  const r = req({ version: 2, steps: [SWAP, SOL_SWAP] });
  it('binds the workflow, every grant, both chains and per-asset limits; its hash is canonical', () => {
    const m = manifestOf(r);
    expect(m.workflow).toEqual({ mode: 'EXACT', workflowHash: r.workflowHash, engineVersion: 'flofi-engine-2', stepCount: 2 });
    expect(m.chains).toEqual(['eip155:84532', DEVNET]);
    expect(m.credentials.map(c => [c.stepIndex, c.grantId])).toEqual([[0, 'grt_evm'], [1, 'grt_sol']]);
    expect(m.recipients).toEqual([`eip155:84532:${EVM_OWNER}`, `${DEVNET}:${SOL_OWNER}`]);
    expect(m.assets.filter(a => a.role === 'INPUT').map(a => [a.asset, a.maxPerExecution])).toEqual([[USDC_KEY, '50000000'], [DEV_KEY, '5000000']].sort((a, b) => a[0]! < b[0]! ? -1 : 1));
    expect(m.enforcement['period budgets']).toEqual(['APPLICATION_GATEWAY']);
    expect(m.enforcement['swap recipient = your wallet']).toEqual(['SMART_ACCOUNT_MODULE_OR_GUARD:EVM_ERC7710_METAMASK_V1_3']);
    const reverse = (v: unknown): unknown => Array.isArray(v) ? v.map(reverse) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverse(x)])) : v;
    const reordered = reverse(m) as DelegatedAuthorizationManifest;
    expect(Object.keys(reordered)[0]).toBe('enforcement');
    expect(manifestHash(reordered)).toBe(manifestHash(m));
    expect(manifestProblem(m, r)).toBeNull();
  });
  it.each([
    ['a per-execution limit below the workflow', { ...LIMITS, assets: [{ ...LIMITS.assets[0]!, maxPerExecution: '49999999' }, LIMITS.assets[1]!] }, 'MANIFEST_LIMIT_BELOW_WORKFLOW'],
    ['no cumulative budget', { ...LIMITS, assets: [{ ...LIMITS.assets[0]!, budgets: [] }, LIMITS.assets[1]!] }, 'MANIFEST_BUDGET_REQUIRED'],
    ['a budget below one execution', { ...LIMITS, assets: [{ ...LIMITS.assets[0]!, budgets: [{ period: 'DAY', amount: '1' }] }, LIMITS.assets[1]!] }, 'MANIFEST_BUDGET_BELOW_EXECUTION'],
    ['a slippage cap below the workflow', { ...LIMITS, maxSlippageBps: 49 }, 'MANIFEST_SLIPPAGE_BELOW_WORKFLOW'],
  ] as const)('refuses %s', (_name, limits, code) => { expect(() => manifestOf(r, limits as LimitsInput)).toThrow(code); });
  it('names every widening of a revision', () => {
    const base = manifestOf(r);
    const wider: DelegatedAuthorizationManifest = { ...base, revision: 2, expiresAt: '2027-01-31T00:00:00.000Z', chains: [...base.chains, 'eip155:11155111'],
      limits: { ...base.limits, maxSlippageBps: 100, cooldownSeconds: 0, maxExecutionsPerPeriod: { count: 5, period: 'WEEK' } },
      assets: base.assets.map(a => a.role === 'INPUT' ? { ...a, maxPerExecution: String(BigInt(a.maxPerExecution!) + 1n), budgets: [] } : a),
      recipients: [...base.recipients, 'eip155:84532:0x' + 'ee'.repeat(20)], credentials: base.credentials.map(c => ({ ...c, grantId: c.grantId + 'x' })),
      workflow: { ...base.workflow, workflowHash: '0x' + '0'.repeat(64) } };
    expect(wideningOf(base, wider)).toEqual(['AMOUNT_INCREASED', 'BUDGET_INCREASED', 'CHAIN_ADDED', 'CREDENTIAL_CHANGED', 'EXECUTION_COUNT_INCREASED', 'EXPIRY_EXTENDED',
      'RECIPIENT_ADDED', 'SLIPPAGE_INCREASED', 'WORKFLOW_CHANGED'].sort());
    expect(wideningOf(base, { ...base, revision: 2, limits: { ...base.limits, maxSlippageBps: 50, cooldownSeconds: 60 } })).toEqual([]);
  });
  it('the universal authorization commits to the manifest, credentials, environment and nonce', () => {
    const m = manifestOf(r), env = { origin: 'https://app.flofi.test', rpId: 'app.flofi.test', tenant: 't1', nonce: 'a'.repeat(32), passkeyId: 'pk_1' };
    const uwa = universalAuthorization(m, env), digest = authorizationDigest(uwa);
    expect(uwa).toMatchObject({ workflowHash: r.workflowHash, manifestHash: manifestHash(m), chains: m.chains, passkeyId: 'pk_1' });
    expect(uwa.credentials).toHaveLength(2);
    for (const changed of [{ ...env, nonce: 'b'.repeat(32) }, { ...env, origin: 'https://evil.test' }, { ...env, tenant: 't2' }, { ...env, passkeyId: 'pk_2' }])
      expect(authorizationDigest(universalAuthorization(m, changed))).not.toBe(digest);
    expect(authorizationDigest(universalAuthorization({ ...m, revision: 2 }, env))).not.toBe(digest);
    expect(() => universalAuthorization(m, { ...env, nonce: 'short' })).toThrow('AUTHORIZATION_NONCE_INVALID');
  });
});

describe('reservation and step policy', () => {
  const r = req(SWAP), m = manifestOf(r, { ...LIMITS, assets: [LIMITS.assets[0]!], cooldownSeconds: 3_600 }), spend = executionSpend(r);
  const usage = (used = 0n, executions = 0, last: number | null = null): Usage => ({ amounts: new Map([[USDC_KEY, new Map([['WEEK', used]])]]),
    executions: new Map([['WEEK', executions]]), lastExecutionAt: last });
  it.each([
    ['fits', usage(), NOW, null],
    ['the weekly budget is reached', usage(150_000_001n), NOW, 'LIMIT_PERIOD_AMOUNT'],
    ['exactly at the weekly budget', usage(150_000_000n), NOW, null],
    ['too many executions this week', usage(0n, 4), NOW, 'LIMIT_PERIOD_COUNT'],
    ['inside the cooldown', usage(0n, 1, NOW - 3_599_000), NOW, 'LIMIT_COOLDOWN'],
    ['expired', usage(), Date.parse('2026-12-31T00:00:00Z'), 'AUTHORIZATION_EXPIRED'],
    ['not yet valid', usage(), NOW - 1, 'AUTHORIZATION_NOT_YET_VALID'],
  ] as const)('reservation when %s', (_n, u, now, code) => { expect(reservationViolation(m, spend, u, now)).toBe(code); });
  it('refuses a spend above the per-execution limit', () => {
    expect(reservationViolation(m, new Map([[USDC_KEY, 50_000_001n]]), usage(), NOW)).toBe('LIMIT_AMOUNT_PER_EXECUTION');
    expect(reservationViolation(m, new Map([['eip155:84532/erc20:0x' + '77'.repeat(20), 1n]]), usage(), NOW)).toBe('ASSET_NOT_AUTHORIZED');
  });
  const graph = resolveAuthorityGraph(r, [evmGrant()], 'PRODUCTION', NOW);
  const binding = graph.ok ? graph.bindings[0]! : null!;
  const WETH_KEY = `eip155:84532/erc20:${BASE_SEPOLIA.weth}`;
  const plan: StepPlan = { stepIndex: 0, chain: 'eip155:84532', actionType: 'asset.swap.exact-input', adapterId: 'uniswap.v3', targets: [BASE_SEPOLIA.usdc, BASE_SEPOLIA.router],
    spend: [{ asset: USDC_KEY, amount: 50_000_000n }], expectedReceive: [{ asset: WETH_KEY, amount: 20_000_000_000_000_000n }],
    minimumReceive: [{ asset: WETH_KEY, amount: 19_900_000_000_000_000n }], recipient: `eip155:84532:${EVM_OWNER}`, slippageBps: 50, quotedAt: NOW - 1_000,
    destinationChain: null, healthFactorAfter: null, provenance: 'MOCKED', simulationHash: '0x01' };
  it('accepts the fresh plan that matches the authorization', () => { expect(stepPolicyViolation(m, r.steps[0]!, binding, plan, NOW)).toBeNull(); });
  it.each([
    ['another chain', { chain: 'eip155:11155111' }, 'CHAIN_NOT_AUTHORIZED'],
    ['another action', { actionType: 'supply' }, 'ACTION_NOT_AUTHORIZED'],
    ['another protocol', { adapterId: 'lifi.rest' }, 'PROTOCOL_NOT_AUTHORIZED'],
    ['an unauthorized contract', { targets: [BASE_SEPOLIA.router, '0x' + '55'.repeat(20)] }, 'TARGET_NOT_AUTHORIZED'],
    ['a stale quote', { quotedAt: NOW - 121_000 }, 'QUOTE_EXPIRED'],
    ['a higher slippage', { slippageBps: 51 }, 'SLIPPAGE_ABOVE_CAP'],
    ['a minimum output below the cap', { minimumReceive: [{ asset: WETH_KEY, amount: 19_899_999_999_999_999n }] }, 'SLIPPAGE_ABOVE_CAP'],
    ['another recipient', { recipient: 'eip155:84532:0x' + '66'.repeat(20) }, 'RECIPIENT_NOT_AUTHORIZED'],
    ['a changed amount', { spend: [{ asset: USDC_KEY, amount: 50_000_001n }] }, 'AMOUNT_CHANGED'],
    ['another token', { spend: [{ asset: 'eip155:84532/erc20:0x' + '77'.repeat(20), amount: 50_000_000n }] }, 'ASSET_NOT_AUTHORIZED'],
    ['an unexpected output token', { expectedReceive: [{ asset: 'eip155:84532/erc20:0x' + '88'.repeat(20), amount: 1n }] }, 'ASSET_NOT_AUTHORIZED'],
    ['a destination change', { destinationChain: 'eip155:421614' }, 'BRIDGE_DESTINATION_CHANGED'],
  ] as const)('refuses %s', (_n, patch, code) => { expect(stepPolicyViolation(m, r.steps[0]!, binding, { ...plan, ...patch } as StepPlan, NOW)).toBe(code); });
  it('refuses after the authorization expired', () => { expect(stepPolicyViolation(m, r.steps[0]!, binding, plan, Date.parse(m.expiresAt))).toBe('AUTHORIZATION_EXPIRED'); });
});

describe('state machines and canonical digests', () => {
  it('only allows forward transitions', () => {
    expect(canMoveExecution('QUEUED', 'RESERVED')).toBe(false);
    expect(canMoveExecution('RESERVED', 'RUNNING')).toBe(true);
    expect(canMoveExecution('SETTLED', 'RUNNING')).toBe(false);
    expect(canMoveExecution('UNCERTAIN', 'BLOCKED')).toBe(false);
    expect(canMoveStep('SUBMISSION_PREPARED', 'BLOCKED')).toBe(false);
    expect(canMoveStep('POLICY_VERIFIED', 'SUBMISSION_PREPARED')).toBe(true);
    expect(canMoveStep('RECONCILED', 'SUBMITTED')).toBe(false);
  });
  it('canonical JSON is key-order independent and domain separated', () => {
    expect(canonicalJson({ b: 1, a: [2n, { d: null, c: 'x' }] })).toBe('{"a":["2",{"c":"x","d":null}],"b":1}');
    expect(domainDigest('flofi.x-artifact.v1', { a: 1 })).not.toBe(domainDigest('flofi.y-artifact.v1', { a: 1 }));
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
    expect(() => canonicalJson(new Date())).toThrow();
  });
});
