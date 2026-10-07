// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-001: which existing flow previews a strategy, and the allowlisted view of its result.
 *
 * The preview is the flow's unchanged simulation (`backend/preview.ts`). Its record contains executable material — calldata,
 * unsigned transactions, nonces, the ephemeral run id and the Review commitment — none of which may reach an MCP client: a
 * model holding calldata could route around Review and the owner's wallet. The view is therefore built only from explicit
 * per-flow fact allowlists plus the canonical Simulation Bundle, Authorization Policy and Strategy Manifest validated against
 * their schemas (which carry hashes and 4-byte selectors, never payloads). `assertSafeOutput` is the last line: any key or
 * value shaped like a transaction, calldata, signature or key fails the call closed.
 */
import { hashArtifactBytes } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
import type { FlowName } from '../../backend/flows.ts';
import type { StrategySpec } from '../engine/strategy-spec';

export type PreviewPlan = { readonly flow: FlowName; readonly subject: 'EVM' | 'SOLANA' | 'NONE' };
/** The flow that previews a strategy, or the reason MCP cannot preview it. */
export function previewPlan(spec: StrategySpec): PreviewPlan | { readonly code: string } {
  switch (spec.action) {
    case 'bridge': return { flow: spec.sourceNetwork === 'base' ? 'crosschain-router' : 'crosschain-router-testnet', subject: 'EVM' };
    case 'swap':
      if (spec.network === 'base') return { code: 'SIMULATION_LOCAL_FORK_ONLY' };
      if (spec.network === 'solana') return { flow: 'jupiter-swap', subject: 'SOLANA' };
      if (spec.network === 'solana-devnet') return { flow: 'solana-devnet-swap', subject: 'SOLANA' };
      return { flow: 'base-sepolia-swap', subject: 'NONE' };
    case 'supply': case 'borrow': case 'repay': case 'withdraw': return { flow: 'aave-supply', subject: 'EVM' };
    // Orca positions need a position-mint key generated in the owner's browser; there is nothing to preview without it.
    case 'add_liquidity': return spec.network === 'solana-devnet' ? { code: 'SIMULATION_REQUIRES_OWNER_BROWSER' } : { flow: 'uniswap-liquidity', subject: 'EVM' };
    case 'lending_composition': return { flow: 'lending-composition', subject: 'EVM' };
  }
}
/** The flow enablement that governs a strategy even when MCP cannot preview it (for capability reporting). */
export function strategyFlow(spec: StrategySpec): FlowName | null {
  const plan = previewPlan(spec);
  if ('flow' in plan) return plan.flow;
  return spec.action === 'add_liquidity' ? 'orca-liquidity' : null;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = (): never => { throw new Error('MCP_SIMULATION_PROJECTION_FAILED'); };
const obj = (value: unknown): Record<string, unknown> => isObject(value) ? value : fail();
/** Copies exactly `keys` whose values are scalars (or null); anything else is dropped, never copied by reference. */
function pick(value: unknown, keys: readonly string[]): Record<string, Json> {
  const source = obj(value), out: Record<string, Json> = {};
  for (const key of keys) {
    const v = source[key];
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[key] = v;
  }
  return out;
}
const list = (value: unknown, keys: readonly string[]): Record<string, Json>[] => Array.isArray(value) ? value.slice(0, 64).map(item => pick(item, keys)) : [];
const hash = (kind: 'simulation-bundle' | 'authorization-policy' | 'strategy-manifest', value: unknown) =>
  hashArtifactBytes(kind, new TextEncoder().encode(JSON.stringify(value)));

/** The canonical artifacts of a review, each re-validated against its schema; absent or invalid ones are omitted, never repaired. */
function canonicalArtifacts(source: unknown): Record<string, Json> | null {
  if (!isObject(source)) return null;
  const out: Record<string, Json> = {};
  for (const [field, kind, name] of [['simulation', 'simulation-bundle', 'simulationBundle'], ['policy', 'authorization-policy', 'authorizationPolicy'],
    ['manifest', 'strategy-manifest', 'strategyManifest']] as const) {
    try { const artifact = validateArtifact(kind, source[field]); out[name] = { hash: hash(kind, artifact), artifact: JSON.parse(JSON.stringify(artifact)) as Json }; }
    catch { /* not produced by this flow */ }
  }
  return Object.keys(out).length ? out : null;
}

export type SimulationView = { readonly kind: string; readonly provenance: string; readonly observedAt: string | null; readonly expiresAt: string | null;
  readonly facts: Record<string, Json>; readonly canonicalArtifacts: Record<string, Json> | null };
/** The allowlisted view of a flow's preview result. Throws `MCP_SIMULATION_PROJECTION_FAILED` on an unexpected shape. */
export function projectSimulation(flow: FlowName, value: unknown): SimulationView {
  const record = obj(value);
  switch (flow) {
    case 'crosschain-router': case 'crosschain-router-testnet': {
      const r = obj(record.review), quote = obj(r.quote), route = obj(r.route), simulation = obj(r.simulation);
      return { kind: 'CROSS_CHAIN_ROUTE', provenance: String(record.provenance), observedAt: String(r.observedAt), expiresAt: String(r.expiresAt),
        facts: { recipient: String(r.recipient), recipientKind: String(r.recipientKind),
          quote: { ...pick(quote, ['provider', 'expectedOutput', 'minimumOutput', 'feeTotal', 'estimatedDurationSeconds', 'quotedAt', 'expiresAt']),
            inputAmount: String(route.inputAmount), inputToken: pick(route.inputToken, ['chainId', 'address', 'decimals', 'symbol']),
            outputToken: pick(route.outputToken, ['chainId', 'address', 'decimals', 'symbol']) },
          providersConsidered: list(obj(r.selection).considered, ['provider', 'outcome', 'code', 'minimumOutput', 'feeTotal']),
          transactionSimulation: { ...pick(simulation, ['provenance', 'method', 'chainId', 'block', 'ownerDebit']),
            calls: list(simulation.calls, ['purpose', 'gasUsed']), notSimulated: Array.isArray(simulation.notSimulated) ? simulation.notSimulated.map(String) : [] },
          approvals: list(r.approvals, ['token', 'spender', 'amount', 'currentAllowance', 'required']),
          fees: pick(r.fees, ['maxFeePerGas', 'maxPriorityFeePerGas', 'gasLimitTotal', 'executionFeeUpperBoundWei', 'l1FeeUpperBoundWei', 'totalUpperBoundWei']),
          deadlines: pick(r.deadlines, ['reviewExpiresAt', 'quoteExpiresAt', 'depositMustLandBy', 'fillDeadline']) },
        canonicalArtifacts: canonicalArtifacts(r.artifacts) };
    }
    case 'aave-supply': {
      const r = obj(record.review), operation = r.withdraw ? 'WITHDRAW' : r.repay ? 'REPAY' : r.borrow ? 'BORROW' : 'SUPPLY';
      return { kind: 'AAVE_V3', provenance: String(record.provenance), observedAt: String(obj(r.state).observedAt), expiresAt: String(r.expiresAt),
        facts: { operation, ...pick(r, ['chain', 'pool', 'asset', 'aToken', 'amount', 'beneficiary', 'approvalRequired', 'allowance', 'gasPrice']),
          gasLimits: Array.isArray(r.gasLimits) ? r.gasLimits.map(String) : [],
          state: pick(r.state, ['block', 'balance', 'nativeBalance', 'position', 'allowance']),
          projected: pick(r.withdraw ?? r.repay ?? r.borrow ?? {}, ['expectedPostHealthFactor', 'debtAfter', 'debtAfterBase', 'collateralAfter', 'walletAfter']) },
        canonicalArtifacts: canonicalArtifacts(r) };
    }
    case 'base-sepolia-swap': {
      const q = obj(record.quote);
      return { kind: 'SWAP_QUOTE', provenance: 'PUBLIC_TESTNET', observedAt: String(q.observedAt), expiresAt: String(q.expiresAt),
        facts: pick(q, ['chainId', 'inputToken', 'outputToken', 'inputSymbol', 'outputSymbol', 'amountIn', 'expectedOut', 'minimumOut', 'slippageBps', 'pool', 'fee',
          'blockNumber', 'estimatedGas']), canonicalArtifacts: null };
    }
    case 'uniswap-liquidity': {
      const r = obj(record.review);
      return { kind: 'CONCENTRATED_LIQUIDITY', provenance: String(record.provenance), observedAt: String(r.observedAt), expiresAt: String(r.expiresAt),
        facts: { ...pick(r, ['network', 'chainId', 'recipient', 'deadline']), pool: pick(r.pool, ['fee', 'tickSpacing', 'tick', 'price']),
          range: pick(r.range, ['tickLower', 'tickUpper', 'lowerPrice', 'upperPrice', 'state', 'description']),
          intent: pick(r.intent, ['amount0Max', 'amount1Max', 'slippageBps']), expected: pick(r.expected, ['liquidity', 'amount0', 'amount1']),
          minimums: pick(r.minimums, ['amount0Min', 'amount1Min']), balances: pick(r.balances, ['token0', 'token1', 'native']),
          approvals: list(r.approvals, ['step', 'token', 'symbol', 'spender', 'amount', 'currentAllowance', 'required']),
          fees: pick(r.fees, ['maxFeePerGas', 'maxPriorityFeePerGas', 'gasLimitTotal', 'executionFeeUpperBoundWei', 'l1FeeUpperBoundWei', 'totalUpperBoundWei']) },
        canonicalArtifacts: null };
    }
    case 'jupiter-swap': case 'solana-devnet-swap': {
      const r = obj(record.review), simulation = obj(r.simulationResult);
      return { kind: 'SOLANA_SWAP', provenance: String(record.provenance), observedAt: String(obj(r.quote).fetchedAt), expiresAt: String(r.expiresAt),
        facts: { ...pick(r, ['chain', 'cluster', 'amount', 'slippageBps', 'estimatedFeeLamports']), inputToken: pick(r.input, ['symbol', 'mint', 'decimals']),
          outputToken: pick(r.output, ['symbol', 'mint', 'decimals']), quote: pick(r.quote, ['inAmount', 'outAmount', 'otherAmountThreshold', 'priceImpactPct', 'slippageBps', 'fetchedAt']),
          simulation: pick(simulation, ['slot', 'unitsConsumed', 'inputSpent', 'outputReceived', 'accountCreationLamports', 'feeLamports']) },
        canonicalArtifacts: canonicalArtifacts(r) };
    }
    case 'lending-composition': {
      const r = obj(Array.isArray(record.reviews) ? record.reviews[0] : null), fields = obj(r.fields);
      return { kind: 'LENDING_COMPOSITION', provenance: String(record.provenance), observedAt: null, expiresAt: String(r.expiresAt),
        facts: { ...pick(fields, ['chain', 'supplyAmount', 'borrowAmount', 'slippageBps', 'owner']), ...pick(r, ['gasPrice', 'gasBudget', 'l1FeeUpperBound']),
          steps: Array.isArray(r.calls) ? r.calls.map(c => String(obj(c).id)).slice(0, 16) : [] },
        canonicalArtifacts: canonicalArtifacts(r) };
    }
    default: return fail();
  }
}

/** Keys that only executable material, secrets or wallet internals use. */
const FORBIDDEN_KEY = /^(data|calldata|tx|txs|transaction|transactions|unsignedtransaction|signedtransaction|rawtransaction|serializedtransaction|signature|signatures|privatekey|secret|mnemonic|seed|seedphrase|commitment|apikey|accesstoken|bearer)$/i;
/**
 * Fails closed when an MCP result contains anything executable or secret: forbidden keys, hex payloads longer than a hash
 * (66 chars), or long base64 blobs (serialized transactions). Hashes, addresses, selectors and mints pass.
 */
export function assertSafeOutput(value: unknown, depth = 0): void {
  if (depth > 32) throw new Error('MCP_OUTPUT_GUARD');
  if (typeof value === 'string') {
    if (/0x[0-9a-fA-F]{67,}/.test(value) || /^[A-Za-z0-9+/]{200,}={0,2}$/.test(value)) throw new Error('MCP_OUTPUT_GUARD');
    // BUILD-MCP-002: OAuth access/refresh tokens, codes and consent tokens never appear in a tool result.
    if (/flofi_(at|rt|code|csrf)_[A-Za-z0-9_-]/.test(value)) throw new Error('MCP_OUTPUT_GUARD');
    return;
  }
  if (Array.isArray(value)) { for (const item of value) assertSafeOutput(item, depth + 1); return; }
  if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error('MCP_OUTPUT_GUARD');
    assertSafeOutput(item, depth + 1);
  }
}
