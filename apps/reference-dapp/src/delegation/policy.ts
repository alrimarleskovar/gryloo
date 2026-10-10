// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: the deterministic decisions of delegated execution. Pure; every refusal is a closed code.
 *
 *   reservationViolation   may one more execution start now? validity, cooldown, per-execution and per-period amounts per asset,
 *                          executions per period — evaluated inside the authorization's row lock with the ledger's usage
 *   stepPolicyViolation    does the FRESH simulation of a step still fit the authorization? chain, action, protocol/targets, assets, exact
 *                          amount, recipient, slippage, minimum output, quote age, destination, grant scope — immediately before signing
 *
 * AI is never an input here. A violation stops the occurrence before anything is signed.
 */
import { periodStart } from '../automations/schedule.ts';
import type { StepBinding } from './authority.ts';
import type { DelegatedAuthorizationManifest, Period } from './manifest.ts';
import { assetKey, type StepRequirement } from './steps.ts';

export type Usage = { readonly amounts: ReadonlyMap<string, ReadonlyMap<Period, bigint>>; readonly executions: ReadonlyMap<Period, number>;
  readonly lastExecutionAt: number | null };
export const periodStarts = (m: Pick<DelegatedAuthorizationManifest, 'timezone'>, now: number): Readonly<Record<Period, number>> =>
  ({ DAY: periodStart('DAY', now, m.timezone), WEEK: periodStart('WEEK', now, m.timezone), MONTH: periodStart('MONTH', now, m.timezone) });

export function reservationViolation(m: DelegatedAuthorizationManifest, spend: ReadonlyMap<string, bigint>, usage: Usage, now: number): string | null {
  if (now < Date.parse(m.validFrom)) return 'AUTHORIZATION_NOT_YET_VALID';
  if (now >= Date.parse(m.expiresAt)) return 'AUTHORIZATION_EXPIRED';
  if (m.limits.cooldownSeconds > 0 && usage.lastExecutionAt !== null && now - usage.lastExecutionAt < m.limits.cooldownSeconds * 1000) return 'LIMIT_COOLDOWN';
  const count = m.limits.maxExecutionsPerPeriod;
  if (count && (usage.executions.get(count.period) ?? 0) + 1 > count.count) return 'LIMIT_PERIOD_COUNT';
  for (const [key, amount] of spend) {
    const asset = m.assets.find(a => a.asset === key && a.role === 'INPUT');
    if (!asset || asset.maxPerExecution === null) return 'ASSET_NOT_AUTHORIZED';
    if (amount > BigInt(asset.maxPerExecution)) return 'LIMIT_AMOUNT_PER_EXECUTION';
    for (const budget of asset.budgets) if ((usage.amounts.get(key)?.get(budget.period) ?? 0n) + amount > BigInt(budget.amount)) return 'LIMIT_PERIOD_AMOUNT';
  }
  return null;
}

/** What a step driver's fresh simulation establishes, immediately before signing. Every field is a measured fact, not an echo. */
export type StepPlan = {
  readonly stepIndex: number; readonly chain: string; readonly actionType: string; readonly adapterId: string;
  /** Contracts / programs the prepared submission touches. */
  readonly targets: readonly string[];
  /** What the owner's account pays (gross) and the minimum it must receive, in native units by asset key. */
  readonly spend: readonly { readonly asset: string; readonly amount: bigint }[];
  readonly minimumReceive: readonly { readonly asset: string; readonly amount: bigint }[];
  readonly expectedReceive: readonly { readonly asset: string; readonly amount: bigint }[];
  /** Where the outputs go (`<chain>:<address>`). */
  readonly recipient: string;
  readonly slippageBps: number; readonly quotedAt: number; readonly destinationChain: string | null;
  readonly healthFactorAfter: string | null; readonly provenance: 'MOCKED' | 'PUBLIC_READ_ONLY'; readonly simulationHash: string;
};

export function stepPolicyViolation(m: DelegatedAuthorizationManifest, step: StepRequirement, binding: StepBinding, plan: StepPlan, now: number): string | null {
  if (now >= Date.parse(m.expiresAt)) return 'AUTHORIZATION_EXPIRED';
  if (plan.stepIndex !== step.index || binding.stepIndex !== step.index) return 'STEP_ORDER_INVALID';
  if (plan.chain !== step.chain || !m.chains.includes(plan.chain)) return 'CHAIN_NOT_AUTHORIZED';
  if (!step.actionTypes.includes(plan.actionType) || !m.actions.includes(plan.actionType)) return 'ACTION_NOT_AUTHORIZED';
  const protocol = m.protocols.find(p => p.chain === plan.chain && p.adapterId === plan.adapterId);
  if (!protocol || plan.adapterId !== step.adapterId) return 'PROTOCOL_NOT_AUTHORIZED';
  if (!plan.targets.length || plan.targets.some(t => !protocol.targets.includes(t))) return 'TARGET_NOT_AUTHORIZED';
  if (now - plan.quotedAt > m.limits.quoteMaxAgeSeconds * 1000 || plan.quotedAt > now + 5_000) return 'QUOTE_EXPIRED';
  if (plan.slippageBps > m.limits.maxSlippageBps || (step.slippageBps !== null && plan.slippageBps > step.slippageBps)) return 'SLIPPAGE_ABOVE_CAP';
  if (`${plan.chain}:${binding.walletAddress}` !== plan.recipient || !m.recipients.includes(plan.recipient)) return 'RECIPIENT_NOT_AUTHORIZED';
  if ((plan.destinationChain ?? null) !== step.destinationChain) return 'BRIDGE_DESTINATION_CHANGED';
  // The spend is exactly the workflow's step inputs: no other asset, no other amount.
  const expected = new Map(step.inputs.map(i => [assetKey(i), i.amount]));
  if (plan.spend.length !== expected.size) return 'AMOUNT_CHANGED';
  for (const s of plan.spend) {
    if (!m.assets.some(a => a.asset === s.asset && a.role === 'INPUT')) return 'ASSET_NOT_AUTHORIZED';
    if (expected.get(s.asset) !== s.amount) return 'AMOUNT_CHANGED';
  }
  const outputs = new Set(step.outputs.map(assetKey));
  if (plan.minimumReceive.some(r => !outputs.has(r.asset)) || plan.expectedReceive.some(r => !outputs.has(r.asset))) return 'ASSET_NOT_AUTHORIZED';
  // The minimum output must honour the slippage cap against the measured expected output (integer arithmetic, rounding up).
  for (const r of plan.expectedReceive) {
    const minimum = plan.minimumReceive.find(x => x.asset === r.asset);
    if (!minimum || minimum.amount <= 0n || minimum.amount > r.amount) return 'MINIMUM_OUTPUT_INVALID';
    const floor = (r.amount * BigInt(10_000 - m.limits.maxSlippageBps) + 9_999n) / 10_000n;
    if (minimum.amount < floor) return 'SLIPPAGE_ABOVE_CAP';
  }
  if (m.limits.minHealthFactor !== null && (plan.healthFactorAfter === null || Number(plan.healthFactorAfter) < Number(m.limits.minHealthFactor)))
    return 'HEALTH_FACTOR_BELOW_FLOOR';
  // The grant itself must cover what this plan asks of it (the on-chain ceiling, re-checked off-chain before signing).
  const need = binding.need;
  if (need.kind === 'EVM_UNISWAP_V3_EXACT_INPUT_SINGLE') {
    const s = plan.spend[0];
    if (!plan.targets.includes(need.router) || !s || s.asset !== `${plan.chain}/erc20:${need.tokenIn}` || s.amount > need.amountIn) return 'GRANT_SCOPE_EXCEEDED';
  } else {
    const s = plan.spend[0];
    if (!s || s.asset !== `${plan.chain}/token:${need.mint}` || s.amount > need.amount) return 'GRANT_SCOPE_EXCEEDED';
  }
  return null;
}
