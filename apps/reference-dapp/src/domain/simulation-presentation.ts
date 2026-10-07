// SPDX-License-Identifier: AGPL-3.0-only
/** Product projections of existing records. No quoting, fee aggregation or execution decisions. */
import { hashArtifactBytes, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import type { ReviewContext } from '@defi-workflow-engine/reference-linter';
import type { useSupply } from '../state/supply-store';
import type { useLending } from '../state/lending-store';
import type { useRouter } from '../state/router-store';
import type { usePublicTestnet } from '../state/public-testnet-store';
import type { useJupiter } from '../state/jupiter-store';
import type { useSolanaLiquidity } from '../state/solana-liquidity-store';
import type { useUniswapLiquidity } from '../state/uniswap-liquidity-store';
import type { useRobinhoodTransfer } from '../state/robinhood-transfer-store';
import type { useModeA } from '../state/mode-a-store';
import type { useModeB } from '../state/mode-b-store';
import type { useComposition } from '../state/composition-store';
import type { useLiquidity } from '../state/liquidity-store';
import type { useAcross } from '../state/across-store';
import type { Workflow } from './initial-workflow';
import { composerActions, composerSummary } from './composer-presentation';

type Snapshot<T> = Pick<T, Extract<keyof T, 'record' | 'run' | 'prepared' | 'status' | 'info' | 'retired' | 'recoveryOnly' | 'busy' | 'error' | 'available' | 'verifyError' | 'verified' | 'quoteExpired'>>;
export type SimulationSource =
  | { kind: 'supply'; state: Snapshot<ReturnType<typeof useSupply>> }
  | { kind: 'lending'; state: Snapshot<ReturnType<typeof useLending>> }
  | { kind: 'router'; state: Snapshot<ReturnType<typeof useRouter>> }
  | { kind: 'public'; state: Snapshot<ReturnType<typeof usePublicTestnet>> }
  | { kind: 'solana-swap'; state: Snapshot<ReturnType<typeof useJupiter>> }
  | { kind: 'solana-pool'; state: Snapshot<ReturnType<typeof useSolanaLiquidity>> }
  | { kind: 'uniswap-pool'; state: Snapshot<ReturnType<typeof useUniswapLiquidity>> }
  | { kind: 'transfer'; state: Snapshot<ReturnType<typeof useRobinhoodTransfer>> }
  | { kind: 'fork-swap'; state: Snapshot<ReturnType<typeof useModeA>> }
  | { kind: 'delegated-swap'; state: Snapshot<ReturnType<typeof useModeB>> }
  | { kind: 'composition'; state: Snapshot<ReturnType<typeof useComposition>> }
  | { kind: 'fork-pool'; state: Snapshot<ReturnType<typeof useLiquidity>> }
  | { kind: 'across'; state: Snapshot<ReturnType<typeof useAcross>> }
  | { kind: 'unavailable'; state: { error: string | null; busy: boolean | string | null } };
export type SimulationLine = { label: string; value: string; note?: string };
export type SimulationWarning = { severity: 'info' | 'attention' | 'blocking'; message: string };
export type SimulationStep = {
  id: string; number: number; action: string; input: string; networks: string[]; pair: string | null;
  result: string | null; resultLabel: string; provider: string | null; minimum: string | null;
  configuredSlippage: string | null; slippage: string | null; priceImpact: string | null; details: SimulationLine[];
};
export type SimulationPresentation = {
  status: 'ready' | 'attention' | 'blocked'; message: string; expiresAt: number | null;
  steps: SimulationStep[]; fees: SimulationLine[]; warnings: SimulationWarning[];
};

/** Labels and visual emphasis only. The existing projection remains the readiness source. */
export function simulationStatusPresentation(view: SimulationPresentation, invalidWorkflow = false, busy?: boolean | string | null) {
  if (invalidWorkflow) return { label: 'Check workflow', message: 'Check the workflow configuration in Build before continuing.', tone: 'blocked' };
  if (!view.steps.length && view.status !== 'blocked') return { label: 'No workflow', message: 'Create a workflow in Build first.', tone: 'neutral' };
  if (view.message === 'Updating the simulation…') return { label: typeof busy === 'string' && /review/i.test(busy) ? 'Preparing authorization…' : 'Simulating workflow…', message: 'Checking the current workflow before continuing.', tone: 'neutral' };
  if (view.message === 'Run a simulation to see the expected result.') return { label: 'No simulation yet', message: 'Run a simulation to see expected execution.', tone: 'neutral' };
  if (/expired/i.test(view.message)) return { label: 'Simulation expired', message: 'Simulate again to refresh the result before authorization.', tone: 'blocked' };
  if (/changed/i.test(view.message)) return { label: 'Review required again', message: view.message, tone: 'blocked' };
  if (/balance.*low|Add funds for the network fee/i.test(view.message)) return { label: 'Insufficient balance', message: view.message, tone: 'blocked' };
  if (/Simulation is (?:currently unavailable|not available)/i.test(view.message)) return { label: 'Simulation unavailable', message: view.message, tone: 'blocked' };
  if (/Simulation could not be completed/i.test(view.message)) return { label: 'Simulation failed', message: view.message, tone: 'blocked' };
  if (/route is not available/i.test(view.message)) return { label: 'Route unavailable', message: view.message, tone: 'blocked' };
  return { label: view.status === 'ready' ? 'Ready' : view.status === 'blocked' ? 'Cannot proceed' : 'Needs attention', message: view.message, tone: view.status };
}

/** Preserve token precision and very small fees; unknown and invalid quantities stay absent. */
export function simulationAmount(units: string | null | undefined, decimals: number, symbol = ''): string | null {
  if (typeof units !== 'string' || !/^(0|[1-9][0-9]*)$/.test(units) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  const padded = units.padStart(decimals + 1, '0');
  const whole = decimals ? padded.slice(0, -decimals) : padded;
  const fraction = decimals ? padded.slice(-decimals).replace(/0+$/, '') : '';
  return `${whole}${fraction ? `.${fraction}` : ''}${symbol ? ` ${symbol}` : ''}`;
}
const bps = (value: number) => Number.isSafeInteger(value) && value >= 0 ? `${(value / 100).toFixed(2)}%` : null;
/** Jupiter stores a fraction; Orca stores a percentage. Shift decimal digits without rounding to zero. */
export function simulationPriceImpact(value: string, fractional: boolean): string | null {
  if (!/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) return null;
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = value.replace(/^-/, '').split('.');
  const digits = `${whole}${fraction.padEnd(2, '0')}`;
  const scaled = fractional ? simulationAmount(digits.replace(/^0+(?=\d)/, ''), Math.max(0, fraction.length - 2)) : value.replace(/^-/, '');
  return scaled === null ? null : `${negative ? '-' : ''}${scaled}%`;
}
const providerNames: Record<string, string> = {
  lifi: 'LI.FI', 'lifi.rest': 'LI.FI', across: 'Across', 'across.direct': 'Across',
  'across-v3': 'Across', ACROSS: 'Across', UNISWAP_V3: 'Uniswap V3', 'uniswap-v3': 'Uniswap V3',
  'Uniswap V3': 'Uniswap V3', 'Orca Whirlpools': 'Orca Whirlpools', 'Orca Whirlpool': 'Orca Whirlpools', Orca: 'Orca',
  Raydium: 'Raydium', 'Raydium CLMM': 'Raydium CLMM', Meteora: 'Meteora', 'Meteora DLMM': 'Meteora DLMM', Phoenix: 'Phoenix', Lifinity: 'Lifinity',
};
export const simulationProvider = (id: string) => providerNames[id] ?? null;
/** Only known error meanings reach the primary UI; never echo provider responses or validation paths. */
export function simulationError(error: string): string {
  if (/INSUFFICIENT.*(ETH|SOL|NATIVE|GAS)|INSUFFICIENT_GAS/i.test(error)) return 'Add funds for the network fee, then simulate again.';
  if (/INSUFFICIENT|BALANCE_TOO_LOW|exceeds.*balance/i.test(error)) return 'Your available balance is too low for this workflow.';
  if (/HEALTH_FACTOR|UNSAFE_HEALTH|UNSAFE_POSITION/i.test(error)) return 'This action would leave the lending position below its required safety limit.';
  if (/EXPIRED|STALE|REQUOTE|quote.*expired/i.test(error)) return 'This result has expired. Refresh the simulation before continuing.';
  if (/SERVICE_UNAVAILABLE|STORAGE_NOT_CONFIGURED|RPC_(?:ERROR|RATE_LIMITED|UNAVAILABLE)|_OFF$/i.test(error)) return 'Simulation is currently unavailable. Try again before continuing.';
  if (/NO_ROUTE|ROUTE_UNAVAILABLE|ROUTE_REFUSED|UNSUPPORTED/i.test(error)) return 'A route is not available for this workflow. Check its tokens and networks in Build.';
  if (/APPROVAL|ALLOWANCE/i.test(error)) return 'The required token approval could not be verified. Simulate again before continuing.';
  if (/CAPACITY_EXCEEDED|INSUFFICIENT_COLLATERAL|NO_COLLATERAL|BORROW_CAPACITY|COLLATERAL_REQUIRED|RESERVE_(PAUSED|INACTIVE|FROZEN|UNAVAILABLE)|LIQUIDITY_(UNAVAILABLE|INSUFFICIENT)|INSUFFICIENT_LIQUIDITY/i.test(error)) return 'The available collateral or liquidity cannot support this action.';
  if (/WRONG_CHAIN|WRONG_CLUSTER|WRONG_WALLET|WALLET_MISMATCH/i.test(error)) return 'Reconnect the wallet used for this workflow and simulate again.';
  if (/REJECTED|CANCELLED|USER_REFUSAL/i.test(error)) return 'The wallet request was cancelled. Try again when ready.';
  return 'Simulation could not be completed. Try again before continuing.';
}
const iso = (value: string) => Date.parse(value);
const seconds = (value: string | number) => Number(value) * 1000;
const live = (provenance: string) => ['PUBLIC_MAINNET', 'PUBLIC_TESTNET', 'PUBLIC_DEVNET', 'FORK_REPRODUCED', 'LIVE_READ_ONLY'].includes(provenance);
const decimals = (symbol: string) => symbol === 'USDC' ? 6 : 18;
const solanaSymbol = (symbol: string, cluster: string) => cluster === 'devnet' && symbol === 'USDC' ? 'devUSDC' : symbol;

export function projectSimulation(workflow: Workflow, context: ReviewContext, source?: SimulationSource, now = Date.now()): SimulationPresentation {
  const steps: SimulationStep[] = composerActions(workflow).map((node, index) => {
    const card = composerSummary(workflow, node, context);
    const constraint = node.userConstraints.find(c => c.kind === 'MAXIMUM_SLIPPAGE_BPS');
    return { id: node.nodeId, number: index + 1, action: card.action,
      input: card.amount === 'Amount not available' ? '—' : card.amount, networks: card.chain.split(' → ').filter(name => !/^(eip155:|solana:|mock:)/.test(name) && !/mock/i.test(name)), pair: card.bridgePair ?? card.detail ?? null,
      result: null, resultLabel: 'Expected output', provider: null, minimum: null,
      configuredSlippage: constraint?.kind === 'MAXIMUM_SLIPPAGE_BPS' ? bps(constraint.maximumBps) : null,
      slippage: null, priceImpact: null, details: [] };
  });
  const view: SimulationPresentation = { status: 'attention', message: 'Run a simulation to see the expected result.', expiresAt: null, steps, fees: [], warnings: [] };
  if (!source) return view;
  const warn = (severity: SimulationWarning['severity'], message: string) => view.warnings.push({ severity, message });
  const stop = (message: string) => { view.status = 'blocked'; view.message = message; warn('blocking', message); return view; };
  if (source.state.busy) { view.message = 'Updating the simulation…'; return view; }
  if (source.state.error) return stop(simulationError(source.state.error));
  if ('retired' in source.state && source.state.retired) return stop('The workflow or wallet has changed. Simulate again before continuing.');
  if ('recoveryOnly' in source.state && source.state.recoveryOnly) return stop('A previous run needs attention before a new simulation can proceed.');
  if (steps.length && (('available' in source.state && source.state.available === false) ||
    ('info' in source.state && source.state.info?.available === false))) return stop('Simulation is not available for this workflow on the current network.');
  if ('record' in source.state && source.state.record) {
    const record = source.state.record;
    if ('verdict' in record && ['DIVERGENT', 'FAILED', 'INCONCLUSIVE', 'NOT_EXECUTED', 'REFUNDED'].includes(record.verdict)) return stop('The previous result cannot be used to continue. Simulate again before continuing.');
    if ('status' in record && ['FAILED', 'RECOVERY_REQUIRED', 'PAUSED', 'PARTIALLY_COMPLETED'].includes(record.status)) return stop('The previous run needs attention before continuing.');
  }
  if (source.kind === 'unavailable') return view;
  const same = (saved: SemanticWorkflow) => JSON.stringify(saved) === JSON.stringify(workflow);
  const boundHash = (hash: string, revision: number) => {
    try { return revision === workflow.revision && hash === hashArtifactBytes('semantic-workflow', new TextEncoder().encode(JSON.stringify(workflow))); }
    catch { return false; }
  };
  const guard = (bound: boolean, provenance: string, expiry: number, error?: string | null, chainTime = false): boolean => {
    if (!bound) { stop('The workflow has changed. Simulate again before continuing.'); return false; }
    if (error) { stop(simulationError(error)); return false; }
    if (!live(provenance)) return false;
    view.expiresAt = !chainTime && Number.isFinite(expiry) ? expiry : null;
    if (!Number.isFinite(expiry) || !chainTime && now >= expiry) { stop('This result has expired. Refresh the simulation before continuing.'); return false; }
    view.status = 'ready'; view.message = 'Current simulation. Checks run again before continuing.';
    if (chainTime) warn('attention', 'Validity is checked against the current local-fork block before continuing.');
    return true;
  };
  const step = (id?: string) => id ? steps.find(s => s.id === id) : steps.length === 1 ? steps[0] : undefined;
  const result = (s: SimulationStep | undefined, input: string | null, output: string | null, provider: string, minimum?: string | null, slippage?: number) => {
    if (!s) return;
    s.input = input ?? s.input; s.result = output; s.provider = provider; s.minimum = minimum ?? null;
    if (slippage !== undefined) s.slippage = bps(slippage);
  };
  const fee = (label: string, units: string | null, decimalPlaces: number, symbol: string, note?: string) => {
    const value = simulationAmount(units, decimalPlaces, symbol);
    if (value !== null) view.fees.push({ label, value, ...(note ? { note } : {}) });
  };
  const approvals = (required: boolean) => { if (required) warn('info', 'Token approval is required before execution.'); };
  const networkFees = (f: { totalUpperBoundWei: string | null; executionFeeUpperBoundWei: string; l1FeeUpperBoundWei: string | null }) => {
    if (f.totalUpperBoundWei !== null) fee('Maximum network fee', f.totalUpperBoundWei, 18, 'ETH', 'Includes execution and L1 data fees.');
    else { fee('Maximum execution fee', f.executionFeeUpperBoundWei, 18, 'ETH'); warn('attention', 'The L1 data fee is not available; the network fee total is incomplete.'); }
  };
  const health = (s: SimulationStep | undefined, value: string | undefined) => {
    if (!s || value === undefined) return;
    const formatted = value === ((1n << 256n) - 1n).toString() ? '∞' : simulationAmount(value, 18);
    if (formatted !== null) s.details.push({ label: 'Health factor after', value: formatted });
  };
  const range = (s: SimulationStep | undefined, r: { lowerPrice: string; upperPrice: string; state: string }, unit: string) => {
    if (!s) return;
    if (/^\d+(\.\d+)?$/.test(r.lowerPrice) && /^\d+(\.\d+)?$/.test(r.upperPrice)) s.details.push({ label: 'Price range', value: `${r.lowerPrice}–${r.upperPrice} ${unit}` });
    if (r.state !== 'IN_RANGE') warn('attention', 'The position starts outside the active price range.');
  };
  switch (source.kind) {
    case 'supply': {
      const r = source.state.record; if (!r) break;
      const q = r.review;
      if (!guard(same(q.workflow), r.provenance, iso(q.expiresAt), r.error)) break;
      const s = step(), amount = simulationAmount(q.amount, 6, 'USDC');
      result(s, amount, amount ? `${s?.action ?? 'Supply'} ${amount}` : null, 'Aave V3');
      if (s) s.resultLabel = 'Expected action';
      for (const budget of q.manifest.gasBudgets) if ('nativeId' in budget.asset && budget.asset.nativeId === 'ETH') fee('Maximum network fee', budget.maximumAmount, budget.asset.decimals, 'ETH');
      health(s, q.borrow?.expectedPostHealthFactor ?? q.repay?.expectedPostHealthFactor ?? q.withdraw?.expectedPostHealthFactor);
      approvals(q.approvalRequired);
      if (q.borrow) warn('attention', 'Borrowing creates variable-rate debt and changes your collateral risk.');
      break;
    }
    case 'lending': {
      const r = source.state.record, q = r?.reviews.at(-1); if (!r || !q) break;
      if (!guard(same(q.workflow), r.provenance, iso(q.expiresAt), r.error)) break;
      const supply = steps.find(s => s.action === 'Supply'), borrow = steps.find(s => s.action === 'Borrow'), swap = steps.find(s => s.action === 'Swap');
      const supplied = simulationAmount(q.fields.supplyAmount, 6, 'USDC'), borrowed = simulationAmount(q.fields.borrowAmount, 6, 'USDC');
      result(supply, supplied, supplied ? `Supply ${supplied}` : null, 'Aave V3');
      result(borrow, borrowed, borrowed ? `Borrow ${borrowed}` : null, 'Aave V3');
      if (supply) supply.resultLabel = 'Expected action'; if (borrow) borrow.resultLabel = 'Expected action';
      result(swap, borrowed, simulationAmount(q.route.expectedOut, 18, 'WETH'), 'Uniswap V3', simulationAmount(q.route.minimumOut, 18, 'WETH'), q.fields.slippageBps);
      health(borrow, q.projected.afterBorrow.aave.borrow?.healthFactor);
      for (const [s, id] of [[supply, 'SUPPLY'], [borrow, 'BORROW'], [swap, 'SWAP']] as const) {
        if (s && q.completed.includes(id)) s.details.push({ label: 'Step status', value: 'Already completed' });
      }
      for (const budget of q.manifest.gasBudgets) if ('nativeId' in budget.asset && budget.asset.nativeId === 'ETH') fee('Maximum network fee', budget.maximumAmount, budget.asset.decimals, 'ETH', 'Workflow ceiling, including L1 data fees.');
      approvals(q.calls.some(c => c.id === 'POOL_APPROVAL' || c.id === 'ROUTER_APPROVAL'));
      warn('attention', 'Borrowing creates variable-rate debt. Completed steps are not automatically reversed if a later step fails.');
      for (const uncertainty of q.simulation.uncertainty) {
        if (uncertainty.code === 'NON_ATOMIC_LENDING') warn('attention', 'Debt remains if the swap fails. The simulated health factor does not protect against future liquidation.');
        if (uncertainty.code === 'VARIABLE_INTEREST_AND_L1_FEES') warn('attention', 'Future borrowing interest is not capped. Network fees may differ from these estimates.');
      }
      break;
    }
    case 'router': {
      const r = source.state.record; if (!r) break; const q = r.review;
      if (!guard(same(r.workflow) && boundHash(q.workflowHash, q.revision), r.provenance, Math.min(iso(q.expiresAt), iso(q.quote.expiresAt), q.deadlines.depositMustLandBy * 1000), r.error ?? (r.requote ? 'REQUOTE' : null))) break;
      const route = q.route, s = step(q.nodeId);
      const chosen = [simulationProvider(q.selection.selected), simulationProvider(route.underlyingProtocol)].filter((name, i, all) => name && all.indexOf(name) === i).join(' · ');
      result(s, simulationAmount(route.inputAmount, route.inputToken.decimals, route.inputToken.symbol), simulationAmount(q.quote.expectedOutput, route.outputToken.decimals, route.outputToken.symbol), chosen || '—', simulationAmount(q.quote.minimumOutput, route.outputToken.decimals, route.outputToken.symbol), route.slippageBps);
      if (s) s.resultLabel = 'Quoted destination output';
      networkFees(q.fees);
      const feeLabels = { INTEGRATOR: 'Provider fee', BRIDGE_RELAYER_CAPITAL: 'Bridge relayer fee', BRIDGE_DESTINATION_GAS: 'Destination delivery fee', BRIDGE_LP: 'Bridge liquidity fee', BRIDGE_OTHER: 'Bridge fee' };
      for (const f of route.fees) if (f.chainId === route.inputToken.chainId && f.token.toLowerCase() === route.inputToken.address.toLowerCase() && BigInt(f.amount) > 0n) {
        fee(feeLabels[f.kind], f.amount, route.inputToken.decimals, route.inputToken.symbol, 'Included in the route fee total.');
      }
      fee('Route fee total', q.quote.feeTotal, route.inputToken.decimals, route.inputToken.symbol, 'Included in the quoted output; network fees are separate.'); approvals(q.approvals.some(a => a.required));
      warn('attention', 'Destination delivery is quoted. The simulation checks the source transactions; delivery and refunds are not simulated.');
      break;
    }
    case 'public': {
      const r = source.state.run; if (!r) break; const q = r.quote;
      if (!guard(same(r.workflow) && boundHash(q.workflowHash, q.revision), 'PUBLIC_TESTNET', iso(q.expiresAt))) break;
      const s = step(q.nodeId);
      result(s, simulationAmount(q.amountIn, decimals(q.inputSymbol), q.inputSymbol), simulationAmount(q.expectedOut, decimals(q.outputSymbol), q.outputSymbol), 'Uniswap V3', simulationAmount(q.minimumOut, decimals(q.outputSymbol), q.outputSymbol), q.slippageBps);
      if (s) s.resultLabel = 'Quoted output';
      warn('attention', 'This is a pool quote. Network fees and exact transaction simulation are not available yet.');
      break;
    }
    case 'solana-swap': {
      const r = source.state.record; if (!r) break; const q = r.review;
      if (!guard(same(q.workflow), r.provenance, iso(q.expiresAt), r.error)) break;
      const s = step(), tokenIn = solanaSymbol(q.input.symbol, q.cluster), tokenOut = solanaSymbol(q.output.symbol, q.cluster);
      result(s, simulationAmount(q.simulationResult.inputSpent, q.input.decimals, tokenIn), simulationAmount(q.simulationResult.outputReceived, q.output.decimals, tokenOut), q.format === 'gryloo.jupiter-review.v1' ? 'Jupiter' : 'Orca Whirlpools', simulationAmount(q.quote.otherAmountThreshold, q.output.decimals, tokenOut), q.slippageBps);
      if (s) {
        s.resultLabel = 'Simulated output'; s.priceImpact = simulationPriceImpact(q.quote.priceImpactPct, q.format === 'gryloo.jupiter-review.v1');
        const providers = [...new Set(q.quote.routePlan.map(p => simulationProvider(p.label)).filter(Boolean))];
        if (providers.length) s.details.push({ label: 'Route pools', value: providers.join(' → ') });
      }
      fee('Estimated network fee', q.estimatedFeeLamports, 9, 'SOL');
      if (BigInt(q.simulationResult.accountCreationLamports) > 0n) fee('Account deposits', q.simulationResult.accountCreationLamports, 9, 'SOL', 'Account rent, separate from network fees.');
      if (q.format === 'gryloo.orca-devnet-review.v1') {
        const trade = q.simulatedTrade;
        for (const [label, amount] of [['Liquidity provider fee', trade.lpFee], ['Protocol fee', trade.protocolFee], ['Input transfer fee', trade.inputTransferFee]] as const) {
          if (BigInt(amount) > 0n) fee(label, amount, q.input.decimals, tokenIn, 'Already reflected in the simulated output.');
        }
        if (BigInt(trade.outputTransferFee) > 0n) fee('Output transfer fee', trade.outputTransferFee, q.output.decimals, tokenOut, 'Already reflected in the simulated output.');
      }
      break;
    }
    case 'uniswap-pool': {
      const r = source.state.record; if (!r) break; const q = r.review;
      if (!guard(same(r.workflow) && boundHash(q.workflowHash, q.revision), r.provenance, Math.min(iso(q.expiresAt), seconds(q.deadline)), r.error)) break;
      const s = step(q.nodeId);
      const amounts = [simulationAmount(q.simulation.mint.amount0, q.token0.decimals, q.token0.symbol), simulationAmount(q.simulation.mint.amount1, q.token1.decimals, q.token1.symbol)];
      result(s, null, amounts.every(Boolean) ? amounts.join(' + ') : null, 'Uniswap V3', null, q.intent.slippageBps);
      if (s) s.resultLabel = 'Expected pool contribution';
      range(s, q.range, 'USDC per WETH'); networkFees(q.fees); approvals(q.approvals.some(a => a.required));
      break;
    }
    case 'solana-pool': {
      const r = source.state.record; if (!r) break; const q = r.review;
      if (!guard(same(q.workflow), r.provenance, iso(q.expiresAt), r.error)) break;
      const s = step(q.nodeId), sim = q.simulationResult, opening = q.operation === 'OPEN';
      const amounts = [simulationAmount(opening ? sim.depositedA : sim.withdrawnPrincipalA, q.token0.decimals, solanaSymbol(q.token0.symbol, q.cluster)), simulationAmount(opening ? sim.depositedB : sim.withdrawnPrincipalB, q.token1.decimals, solanaSymbol(q.token1.symbol, q.cluster))];
      result(s, null, amounts.every(Boolean) ? amounts.join(' + ') : null, 'Orca Whirlpools', null, q.intent.slippageBps);
      if (s) s.resultLabel = opening ? 'Expected pool contribution' : 'Expected withdrawal';
      range(s, q.range, 'devUSDC per SOL'); fee('Estimated network fee', q.estimatedFeeLamports, 9, 'SOL');
      if (BigInt(sim.rentPaidLamports) > 0n) fee('Account deposits', sim.rentPaidLamports, 9, 'SOL', 'Account rent, separate from network fees.');
      break;
    }
    case 'transfer': {
      const r = source.state.record; if (!r) break; const q = r.review;
      if (!guard(same(q.workflow), r.provenance, iso(q.expiresAt), r.error)) break;
      const amount = simulationAmount(q.value, 18, 'ETH'), s = step();
      result(s, amount, amount ? `Transfer ${amount} to your wallet` : null, 'Wallet transfer');
      if (s) s.resultLabel = 'Expected action';
      fee('Estimated network fee', q.expectedFee, 18, 'ETH'); fee('Maximum network fee', q.feeBudget, 18, 'ETH', 'Fee ceiling, not an additional charge.');
      warn('info', 'This transfer returns funds to the same wallet; only the network fee is spent.'); break;
    }
    case 'fork-swap': {
      const q = source.state.prepared; if (!q) break;
      if (!guard(same(q.workflow), q.environment, Math.min(seconds(q.quoteExpiresAt), seconds(q.deadline)), source.state.verifyError, true)) break;
      result(step(q.nodeId), simulationAmount(q.amountIn, q.decimalsIn, q.symbolIn), simulationAmount(q.quotedOut, q.decimalsOut, q.symbolOut), 'Uniswap V3', simulationAmount(q.minimumOut, q.decimalsOut, q.symbolOut), q.slippageBps);
      for (const budget of q.artifacts.manifest.gasBudgets) if ('nativeId' in budget.asset && budget.asset.nativeId === 'ETH') fee('Maximum network fee', budget.maximumAmount, budget.asset.decimals, 'ETH');
      warn('info', 'Results come from the current local-fork simulation.');
      for (const finding of q.findings) warn(finding.severity === 'BLOCK' ? 'blocking' : 'attention', ['ZERO_SLIPPAGE', 'ELEVATED_SLIPPAGE', 'SLIPPAGE_ABOVE_REVIEW_LIMIT'].includes(finding.code) ? 'Review the configured slippage limit before continuing.' : 'Check the simulation before continuing.');
      if (!source.state.verified['step-approve'] || !source.state.verified['step-swap']) warn('blocking', 'The simulation transactions could not be verified. Simulate again before continuing.');
      break;
    }
    case 'delegated-swap': {
      const q = source.state.status?.prepared; if (!q) break;
      if (!guard(boundHash(q.workflowHash, q.revision), 'FORK_REPRODUCED', seconds(q.quoteExpiresAt), source.state.quoteExpired ? 'QUOTE_EXPIRED' : null, true)) break;
      const tokenIn = q.direction === 'USDC_TO_WETH' ? 'USDC' : 'WETH', tokenOut = tokenIn === 'USDC' ? 'WETH' : 'USDC';
      result(step(), simulationAmount(q.amountIn, decimals(tokenIn), tokenIn), simulationAmount(q.quotedOut, decimals(tokenOut), tokenOut), 'Uniswap V3', simulationAmount(q.minimumOut, decimals(tokenOut), tokenOut));
      warn('info', 'Results come from the current local-fork simulation.'); break;
    }
    case 'composition': {
      const q = source.state.status?.prepared; if (!q) break;
      if (!guard(boundHash(q.workflowHash, q.revision), source.state.info?.environment ?? 'MOCKED', Math.min(seconds(q.quoteExpiresAt), seconds(q.terms.mintDeadline)), null, true)) break;
      const swap = steps.find(s => s.action === 'Swap'), pool = steps.find(s => s.action === 'Pool / Liquidity');
      result(swap, simulationAmount(q.terms.swap.amountIn, 6, 'USDC'), simulationAmount(q.quoteOut, 18, 'WETH'), 'Uniswap V3', simulationAmount(q.minimumOut, 18, 'WETH'));
      if (pool) { pool.provider = 'Uniswap V3'; pool.details.push({ label: 'Tick range', value: `${q.terms.tickLower}–${q.terms.tickUpper}` }); }
      warn('attention', 'Pool contribution amounts are not available. A successful swap is not automatically reversed if the pool step fails.');
      warn('info', 'Results come from the current local-fork simulation.'); break;
    }
    case 'fork-pool': {
      const q = source.state.prepared; if (!q) break;
      if (!guard(boundHash(q.workflowHash, q.revision), source.state.info?.available ? source.state.info.environment : 'MOCKED', seconds(q.deadline), null, true)) break;
      const a = simulationAmount(q.composition.amount0, 18, 'WETH'), b = simulationAmount(q.composition.amount1, 6, 'USDC');
      const s = step();
      result(s, null, q.operation === 'MINT' || q.operation === 'INCREASE' ? a && b ? `${a} + ${b}` : null : null, 'Uniswap V3');
      if (s) s.resultLabel = 'Expected pool contribution';
      if (q.operation !== 'MINT' && q.operation !== 'INCREASE') warn('attention', 'The current simulation covers one position transaction. A full position result is not available.');
      if (!source.state.verified) warn('blocking', 'The simulation transaction could not be verified. Simulate again before continuing.');
      warn('info', 'Results come from the current local-fork simulation.'); break;
    }
    case 'across': {
      const r = source.state.run; if (!r) break; const q = r.quote;
      if (!guard(same(r.workflow), q.provenance, iso(q.quoteExpiresAt))) break;
      const s = step();
      result(s, simulationAmount(q.inputAmount, 6, 'USDC'), simulationAmount(q.expectedOutput, 6, 'USDC'), 'Across', simulationAmount(q.minimumOutput, 6, 'USDC'));
      if (s) s.resultLabel = 'Quoted destination output';
      fee('Maximum bridge fee', q.feeMaximum, 6, 'USDC'); fee('Maximum network fee', q.maximumGasCostWei, 18, 'ETH');
      warn('attention', 'A route quote is available. Exact transaction and destination delivery simulation are not available.'); break;
    }
  }
  if (view.warnings.some(w => w.severity === 'blocking')) view.status = 'blocked';
  else if (view.warnings.some(w => w.severity === 'attention') || !steps.length || steps.some(s => s.result === null)) view.status = 'attention';
  if (view.status === 'attention' && steps.some(s => s.result !== null)) view.message = 'Review the attention items before continuing.';
  if (view.status === 'blocked' && !view.warnings.some(w => w.message === view.message)) view.message = 'Resolve the blocking items before continuing.';
  return view;
}
