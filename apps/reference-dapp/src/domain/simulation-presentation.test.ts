// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { hashArtifactBytes } from '@defi-workflow-engine/workflow-contracts';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { editorReducer, initialEditor } from './editor';
import { canvasAddCommand } from './canvas-authoring';
import { projectSimulation, simulationStatusPresentation, simulationAmount, simulationPriceImpact, simulationError, type SimulationSource } from './simulation-presentation';
const context = createBaseSepoliaReviewContext(), now = Date.parse('2026-10-06T12:00:00Z');
const expiry = new Date(now + 120_000).toISOString();
const swap = editorReducer(initialEditor(), { type: 'ADD_SWAP', direction: 'USDC_TO_WETH', amount: '100', slippage: '50', source: 'CHAT', baseRevision: 0 }, context).workflow;
const hash = (workflow: typeof swap) => hashArtifactBytes('semantic-workflow', new TextEncoder().encode(JSON.stringify(workflow)));
// Focused snapshots contain only fields read by the projection; no transport or signing is invoked.
const snapshot = (kind: SimulationSource['kind'], state: object): SimulationSource => ({ kind, state: { busy: false, error: null, retired: false, ...state } }) as SimulationSource;
const quote = { workflowHash: hash(swap), revision: swap.revision, nodeId: swap.nodes.at(-1)!.nodeId, inputSymbol: 'USDC', outputSymbol: 'WETH', amountIn: '100000000', expectedOut: '25000000000000000', minimumOut: '24875000000000000', slippageBps: 50, expiresAt: expiry };
const publicSource = () => snapshot('public', { run: { workflow: swap, quote, attempts: [], outcome: null } });
const project = (source?: SimulationSource, time = now, workflow = swap) => projectSimulation(workflow, context, source, time);
describe('simulation financial presentation', () => {
  it('formats exact quantities without rounding small fees or large balances', () => {
    expect(simulationAmount('1', 18, 'ETH')).toBe('0.000000000000000001 ETH');
    expect(simulationAmount('123456789123456789123456789', 6)).toBe('123456789123456789123.456789');
    expect(simulationAmount('0', 6, 'USDC')).toBe('0 USDC');
    for (const value of [null, undefined, 'NaN', '0x10', '-1', '']) expect(simulationAmount(value, 6)).toBeNull();
  });
  it('normalizes the actual provider-specific price-impact units without rounding away a real value', () => {
    expect(simulationPriceImpact('0.0008', true)).toBe('0.08%');
    expect(simulationPriceImpact('0.08', false)).toBe('0.08%');
    expect(simulationPriceImpact('0.1', true)).toBe('10%');
    expect(simulationPriceImpact('0.00000001', true)).toBe('0.000001%');
    expect(simulationPriceImpact('0', true)).toBe('0%');
    expect(simulationPriceImpact('undefined', true)).toBeNull();
  });
  it('renders a real public quote, distinguishes its minimum and never uses old receipt costs as simulated fees', () => {
    const source = publicSource();
    if (source.kind !== 'public') throw Error('fixture');
    Object.assign(source.state, { run: { ...source.state.run!, outcome: { gasCostWei: '999999999999999999' } as NonNullable<typeof source.state.run>['outcome'] } });
    const result = project(source);
    expect(result.steps[0]).toMatchObject({ input: '100 USDC', result: '0.025 WETH', minimum: '0.024875 WETH', provider: 'Uniswap V3', slippage: '0.50%', priceImpact: null, resultLabel: 'Quoted output' });
    expect(result.fees).toEqual([]);
    expect(result.status).toBe('attention');
    expect(result.warnings[0]?.message).toContain('pool quote');
  });
  it('keeps unknown values absent and configured slippage clearly identified', () => {
    const result = project();
    expect(result.steps[0]).toMatchObject({ result: null, provider: null, minimum: null, priceImpact: null, slippage: null, configuredSlippage: '0.50%' });
    expect(result.fees).toEqual([]); expect(result.status).toBe('attention');
  });
  it('hides expired and differently bound quotes', () => {
    const expired = project(publicSource(), now + 120_000);
    expect(expired.status).toBe('blocked'); expect(expired.steps[0]?.result).toBeNull(); expect(expired.fees).toEqual([]);
    const edited = { ...swap, revision: swap.revision + 1 };
    expect(project(publicSource(), now, edited).status).toBe('blocked');
    const wrongHash = publicSource(); if (wrongHash.kind !== 'public') throw Error('fixture');
    Object.assign(wrongHash.state, { run: { ...wrongHash.state.run!, quote: { ...wrongHash.state.run!.quote, workflowHash: '0x' + '0'.repeat(64) } } });
    expect(project(wrongHash).steps[0]?.result).toBeNull();
  });
  it('does not revive prior results while busy, retired, or in recovery', () => {
    for (const flag of [{ busy: true }, { retired: true }, { recoveryOnly: true }]) {
      const source = publicSource(); Object.assign(source.state, flag);
      const result = project(source); expect(result.steps[0]?.result).toBeNull(); expect(result.status).not.toBe('ready');
    }
  });
  it('projects actual simulated Solana deltas, quote minimum, impact and separate account rent', () => {
    const source = snapshot('solana-swap', { record: { provenance: 'PUBLIC_MAINNET', error: null, verdict: 'PENDING', review: {
      format: 'gryloo.jupiter-review.v1', workflow: swap, expiresAt: expiry, cluster: 'mainnet-beta', input: { symbol: 'USDC', decimals: 6 }, output: { symbol: 'SOL', decimals: 9 }, slippageBps: 75,
      quote: { otherAmountThreshold: '95000000', outAmount: '110000000', priceImpactPct: '0.0008', routePlan: [{ label: 'Raydium' }, { label: 'internal.adapter.v1' }] }, estimatedFeeLamports: '5000',
      simulationResult: { inputSpent: '100000000', outputReceived: '100000000', accountCreationLamports: '2039280', feeLamports: '5000' },
    } } });
    const result = project(source);
    expect(result.steps[0]).toMatchObject({ result: '0.1 SOL', resultLabel: 'Simulated output', minimum: '0.095 SOL', slippage: '0.75%', configuredSlippage: '0.50%', priceImpact: '0.08%', provider: 'Jupiter' });
    expect(result.steps[0]?.details).toContainEqual({ label: 'Route pools', value: 'Raydium' });
    expect(result.fees.map(f => f.value)).toEqual(['0.000005 SOL', '0.00203928 SOL']);
    expect(result.fees.some(f => /total/i.test(f.label))).toBe(false); expect(result.status).toBe('ready');
    expect(JSON.stringify(result)).not.toContain('internal.adapter');
  });
  it('excludes mocked financial results and failed records even if an output was recorded', () => {
    for (const fields of [{ provenance: 'MOCKED', verdict: 'PENDING' }, { provenance: 'PUBLIC_MAINNET', verdict: 'DIVERGENT' }]) {
      const result = project(snapshot('solana-swap', { record: { ...fields, review: { workflow: swap, expiresAt: expiry }, error: null } }));
      expect(result.steps[0]?.result).toBeNull(); expect(result.fees).toEqual([]); expect(result.status).not.toBe('ready');
    }
  });
  it('shows a composed lending result per step and uses the recorded workflow fee ceiling once', () => {
    const workflow = editorReducer(initialEditor(), canvasAddCommand('lending', 0, '0x1111111111111111111111111111111111111111', '100'), context).workflow;
    const source = snapshot('lending', { record: { provenance: 'PUBLIC_TESTNET', status: 'SIMULATED', error: null, reviews: [{
      workflow, expiresAt: expiry, fields: { supplyAmount: '100000000', borrowAmount: '20000000', slippageBps: 50 },
      route: { expectedOut: '5000000000000000', minimumOut: '4975000000000000' }, projected: { afterBorrow: { aave: { borrow: { healthFactor: '4000000000000000000' } } } },
      completed: [], simulation: { uncertainty: [{ code: 'NON_ATOMIC_LENDING' }, { code: 'VARIABLE_INTEREST_AND_L1_FEES' }] }, calls: [{ id: 'POOL_APPROVAL' }], l1FeeUpperBound: '10000000000', manifest: { gasBudgets: [{ asset: { nativeId: 'ETH', decimals: 18 }, maximumAmount: '420000000000000' }] },
    }] } });
    const result = project(source, now, workflow);
    expect(result.steps.map(s => [s.action, s.result, s.provider])).toEqual([
      ['Supply', 'Supply 100 USDC', 'Aave V3'], ['Borrow', 'Borrow 20 USDC', 'Aave V3'], ['Swap', '0.005 WETH', 'Uniswap V3'],
    ]);
    expect(result.steps[1]?.details).toContainEqual({ label: 'Health factor after', value: '4' });
    expect(result.fees).toHaveLength(1); expect(result.fees[0]?.value).toBe('0.00042 ETH');
    expect(result.status).toBe('attention'); expect(result.warnings.some(w => w.message.includes('approval'))).toBe(true);
  });
  it('keeps a partially covered workflow in attention with absent results for the other steps', () => {
    const workflow = editorReducer(initialEditor(), canvasAddCommand('lending', 0, '0x1111111111111111111111111111111111111111', '100'), context).workflow;
    const source = snapshot('public', { run: { workflow, quote: { ...quote, workflowHash: hash(workflow), revision: workflow.revision, nodeId: workflow.nodes.find(n => n.actionType === 'asset.swap.exact-input')!.nodeId } } });
    const result = project(source, now, workflow);
    expect(result.steps.filter(s => s.result)).toHaveLength(1); expect(result.status).toBe('attention');
  });
  it('does not invent prices, fee totals or health factors for Supply', () => {
    const result = project(snapshot('supply', { record: { provenance: 'PUBLIC_TESTNET', verdict: 'PENDING', error: null, review: { workflow: swap, expiresAt: expiry, amount: '100000000', approvalRequired: false, manifest: { gasBudgets: [] } } } }));
    expect(result.fees).toEqual([]); expect(result.steps[0]?.details).toEqual([]); expect(result.steps[0]?.priceImpact).toBeNull();
  });
  it('translates real errors to product warnings and preserves blockers without leaking raw responses', () => {
    for (const error of ['SUPPLY_INSUFFICIENT_USDC', 'BORROW_UNSAFE_HEALTH_FACTOR', 'ROUTER_NO_ROUTE', 'JUPITER_TRANSACTION_EXPIRED', 'Error: rpc invalid at review.state.foo\nstack:0xdeadbeef']) {
      const result = project(snapshot('unavailable', { error }));
      expect(result.status).toBe('blocked'); expect(result.warnings[0]?.severity).toBe('blocking');
      expect(JSON.stringify(result.warnings)).not.toMatch(/SUPPLY_|BORROW_|ROUTER_|JUPITER_|state.foo|0xdeadbeef|stack/);
    }
    expect(simulationError('BORROW_UNSAFE_HEALTH_FACTOR')).toContain('safety limit');
    expect(simulationError('UNISWAP_LIQUIDITY_SIMULATION_FAILED')).toBe('Simulation could not be completed. Try again before continuing.');
    expect(simulationError('SUPPLY_STORAGE_NOT_CONFIGURED')).toContain('currently unavailable');
  });
});


describe('router and liquidity records', () => {
  const bridge = editorReducer(initialEditor(), { type: 'ADD_ROUTER_BRIDGE', input: { source: 'Base', destination: 'Arbitrum', token: 'USDC', amount: '5', recipient: '', slippage: '50', routing: 'AUTO' }, source: 'CANVAS', baseRevision: 0 }, context).workflow;
  const token = { chainId: bridge.nodes[0]!.chainId, address: '0x1111111111111111111111111111111111111111', symbol: 'USDC', decimals: 6 };
  const router = (total: string | null = '420000000000000') => snapshot('router', { record: {
    workflow: bridge, provenance: 'PUBLIC_TESTNET', verdict: 'PENDING', error: null, requote: false, review: {
      workflowHash: hash(bridge), revision: bridge.revision, nodeId: bridge.nodes[0]!.nodeId, expiresAt: expiry,
      selection: { selected: 'lifi' }, route: { inputToken: token, outputToken: token, inputAmount: '5000000', underlyingProtocol: 'across', slippageBps: 50,
        fees: [{ kind: 'INTEGRATOR', amount: '100000', chainId: token.chainId, token: token.address }, { kind: 'BRIDGE_RELAYER_CAPITAL', amount: '500000', chainId: token.chainId, token: token.address }] },
      quote: { expectedOutput: '4400000', minimumOutput: '4300000', feeTotal: '600000', expiresAt: expiry },
      deadlines: { depositMustLandBy: (now + 60_000) / 1000 }, approvals: [{ required: true }],
      fees: { executionFeeUpperBoundWei: '320000000000000', l1FeeUpperBoundWei: '100000000000000', totalUpperBoundWei: total },
    },
  } });
  it('shows the selected provider, actual bridge fees and recorded network total without summing them', () => {
    const result = project(router(), now, bridge);
    expect(result.steps[0]).toMatchObject({ provider: 'LI.FI · Across', result: '4.4 USDC', resultLabel: 'Quoted destination output', slippage: '0.50%' });
    expect(result.fees.map(f => [f.label, f.value])).toEqual([['Maximum network fee', '0.00042 ETH'], ['Provider fee', '0.1 USDC'], ['Bridge relayer fee', '0.5 USDC'], ['Route fee total', '0.6 USDC']]);
    expect(result.fees.some(f => f.label === 'Estimated total')).toBe(false);
    expect(result.warnings.some(w => w.message.includes('delivery and refunds are not simulated'))).toBe(true);
    expect(result.expiresAt).toBe(now + 60_000); expect(result.status).toBe('attention');
  });
  it('does not substitute execution fees for a missing complete network total', () => {
    const result = project(router(null), now, bridge);
    expect(result.fees[0]?.label).toBe('Maximum execution fee');
    expect(result.fees.some(f => f.label === 'Maximum network fee')).toBe(false);
    expect(result.warnings.some(w => w.message.includes('total is incomplete'))).toBe(true);
  });
  it('clears route values at the earliest actual deposit deadline', () => {
    const result = project(router(), now + 60_000, bridge);
    expect(result.status).toBe('blocked'); expect(result.steps[0]?.result).toBeNull(); expect(result.fees).toEqual([]);
  });
  it('shows the actual pool mint instead of local estimates or configured maxima, with real range context', () => {
    const workflow = editorReducer(initialEditor(), { type: 'ADD_UNISWAP_LIQUIDITY', input: { network: 'Base Sepolia', maxUsdc: '100', maxWeth: '0.1', rangeUnit: 'TICK', lower: '-200000', upper: '-190000', slippage: '50' }, source: 'CANVAS', baseRevision: 0 }, context).workflow;
    const source = snapshot('uniswap-pool', { record: { workflow, provenance: 'PUBLIC_TESTNET', verdict: 'PENDING', error: null, review: {
      workflowHash: hash(workflow), revision: workflow.revision, nodeId: workflow.nodes.find(n => !n.actionType.startsWith('mock-'))!.nodeId, expiresAt: expiry, deadline: String((now + 60_000) / 1000),
      token0: { symbol: 'USDC', decimals: 6 }, token1: { symbol: 'WETH', decimals: 18 }, intent: { slippageBps: 50 },
      simulation: { mint: { amount0: '75000000', amount1: '12500000000000000' }, localEstimate: { amount0: '999000000', amount1: '999000000000000000' } },
      range: { lowerPrice: '2000', upperPrice: '4000', state: 'BELOW_RANGE' }, approvals: [],
      fees: { executionFeeUpperBoundWei: '420000000000000', l1FeeUpperBoundWei: null, totalUpperBoundWei: null },
    } } });
    const result = project(source, now, workflow);
    expect(result.steps).toHaveLength(1); expect(result.steps[0]?.result).toBe('75 USDC + 0.0125 WETH');
    expect(result.steps[0]?.details).toContainEqual({ label: 'Price range', value: '2000–4000 USDC per WETH' });
    expect(result.warnings.some(w => w.message.includes('outside the active price range'))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('999');
  });
});


describe('fork validity and live-quote boundaries', () => {
  it('does not compare local fork block time to wall time or claim fork validity without a current block read', () => {
    const source = snapshot('fork-swap', { verifyError: null, verified: { 'step-approve': {}, 'step-swap': {} }, prepared: {
      workflow: swap, environment: 'FORK_REPRODUCED', nodeId: swap.nodes.at(-1)!.nodeId, quoteExpiresAt: '1700000120', deadline: '1700000180',
      symbolIn: 'USDC', symbolOut: 'WETH', decimalsIn: 6, decimalsOut: 18, amountIn: '100000000', quotedOut: '25000000000000000', minimumOut: '24875000000000000', slippageBps: 50,
      artifacts: { manifest: { gasBudgets: [] } }, findings: [],
    } });
    const result = project(source);
    expect(result.steps[0]?.result).toBe('0.025 WETH'); expect(result.expiresAt).toBeNull();
    expect(result.status).toBe('attention'); expect(result.warnings.some(w => w.message.includes('current local-fork block'))).toBe(true);
  });
  it('uses only a real Across quote and never the rehearsal delivery balance', () => {
    const source = snapshot('across', { run: { workflow: swap, received: '999999999', quote: {
      provenance: 'LIVE_READ_ONLY', quoteExpiresAt: expiry, inputAmount: '100000000', expectedOutput: '99400000', minimumOutput: '99000000', feeMaximum: '600000', maximumGasCostWei: '420000000000000',
    } } });
    const result = project(source);
    expect(result.steps[0]?.result).toBe('99.4 USDC'); expect(JSON.stringify(result)).not.toContain('999999999'); expect(result.status).toBe('attention');
    if (source.kind !== 'across') throw Error('fixture');
    const fixture = snapshot('across', { run: { ...source.state.run, quote: { ...source.state.run!.quote, provenance: 'DETERMINISTIC_FIXTURE' } } });
    expect(project(fixture).steps[0]?.result).toBeNull(); expect(project(fixture).fees).toEqual([]);
  });
});


describe('Orca recorded protocol costs', () => {
  it('renders real protocol fee components as already included, preserving percentage units and omitting zero categories', () => {
    const workflow = editorReducer(initialEditor(), { type: 'ADD_SOLANA_SWAP', input: { network: 'Solana Devnet', from: 'devUSDC', to: 'SOL', amount: '100', slippage: '50' }, source: 'CANVAS', baseRevision: 0 }, context).workflow;
    const result = project(snapshot('solana-swap', { record: { provenance: 'PUBLIC_DEVNET', verdict: 'PENDING', error: null, review: {
      format: 'gryloo.orca-devnet-review.v1', workflow, cluster: 'devnet', expiresAt: expiry,
      input: { symbol: 'USDC', decimals: 6 }, output: { symbol: 'SOL', decimals: 9 }, slippageBps: 50,
      quote: { otherAmountThreshold: '99500000', priceImpactPct: '0.08', routePlan: [{ label: 'Orca Whirlpool' }] }, estimatedFeeLamports: '5000',
      simulationResult: { inputSpent: '100000000', outputReceived: '100000000', accountCreationLamports: '0' },
      simulatedTrade: { lpFee: '270000', protocolFee: '30000', inputTransferFee: '0', outputTransferFee: '0' },
    } } }), now, workflow);
    expect(result.steps[0]).toMatchObject({ provider: 'Orca Whirlpools', input: '100 devUSDC', result: '0.1 SOL', priceImpact: '0.08%' });
    expect(result.fees.map(f => [f.label, f.value])).toEqual([['Estimated network fee', '0.000005 SOL'], ['Liquidity provider fee', '0.27 devUSDC'], ['Protocol fee', '0.03 devUSDC']]);
    expect(result.fees.slice(1).every(f => f.note === 'Already reflected in the simulated output.')).toBe(true);
    expect(result.fees.some(f => f.label.includes('total') || f.label.includes('transfer'))).toBe(false);
  });
});

describe('UX-004D state language', () => {
  it('projects empty and loading labels without changing the readiness result', () => {
    const empty = project(undefined, now, initialEditor().workflow);
    expect(simulationStatusPresentation(empty)).toMatchObject({ label: 'No workflow', tone: 'neutral' });
    const unrun = project(); expect(simulationStatusPresentation(unrun)).toMatchObject({ label: 'No simulation yet', tone: 'neutral' });
    const loading = project(snapshot('unavailable', { busy: 'Generating artifact payload:internal' }));
    expect(simulationStatusPresentation(loading, false, 'Generating artifact payload:internal')).toMatchObject({ label: 'Simulating workflow…', tone: 'neutral' });
    expect(simulationStatusPresentation(loading, false, 'Reviewing swap')).toMatchObject({ label: 'Preparing authorization…', tone: 'neutral' });
    expect(loading.status).toBe('attention'); expect(loading.steps.every(step => step.result === null)).toBe(true);
  });
  it('gives expired, stale, balance and route blockers specific product labels and remains fail closed', () => {
    for (const [source, label, time] of [
      [publicSource(), 'Simulation expired', now + 120_000],
      [snapshot('unavailable', { retired: true }), 'Review required again', now],
      [snapshot('unavailable', { error: 'SUPPLY_INSUFFICIENT_USDC' }), 'Insufficient balance', now],
      [snapshot('unavailable', { error: 'ROUTER_NO_ROUTE' }), 'Route unavailable', now],
    ] as const) {
      const view = project(source, time); expect(view.status).toBe('blocked');
      expect(simulationStatusPresentation(view)).toMatchObject({ label, tone: 'blocked' });
      expect(view.steps.every(step => step.result === null)).toBe(true);
    }
  });
});
