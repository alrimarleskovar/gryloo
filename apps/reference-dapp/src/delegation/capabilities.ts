// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: which workflow steps FloFi can execute through delegated authority, by which mechanism and on-chain call template —
 * a deterministic function of the step requirement (action, chain, adapter, assets), never a hand-written claim and never a UI label.
 *
 * Two modes. PRODUCTION reports what the real adapters can do on public networks. MOCKED_HARNESS (loopback tests only, refused on hosted
 * deployments) additionally lets the fixture step driver execute a Solana token-input swap against the loopback chain double, so the
 * whole cross-domain architecture can be exercised; it never turns a refusal into production support.
 */
import { splDelegation } from '@defi-workflow-engine/reference-compiler';
import { publicSwapProfile } from '../domain/public-testnet-swap.ts';
import { MOCKED_SWAP_PROGRAM } from './harness/constants.ts';
import type { StepRequirement } from './steps.ts';

export const MECHANISMS = ['EVM_ERC7710_METAMASK_V1_3', 'SOLANA_SPL_DELEGATE_V1'] as const;
export type Mechanism = (typeof MECHANISMS)[number];
export type CapabilityMode = 'PRODUCTION' | 'MOCKED_HARNESS';
/** The on-chain call class a step needs from its grant (what the grant's caveats/approvals must cover). */
export type TemplateNeed =
  | { readonly kind: 'EVM_UNISWAP_V3_EXACT_INPUT_SINGLE'; readonly router: string; readonly tokenIn: string; readonly tokenOut: string; readonly amountIn: bigint }
  | { readonly kind: 'SOLANA_SPL_SPEND'; readonly mint: string; readonly decimals: number; readonly amount: bigint; readonly programs: readonly string[] };
export type StepCapability = { readonly ok: true; readonly mechanism: Mechanism; readonly need: TemplateNeed; readonly evidence: 'MOCKED' | 'IMPLEMENTED' }
  | { readonly ok: false; readonly code: string; readonly mechanism: Mechanism | null };

const WSOL = 'So11111111111111111111111111111111111111112';
const MAINNET = new Set(['eip155:8453', 'eip155:42161', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp']);

/** The delegated execution capability of one step. */
export function stepCapability(step: StepRequirement, mode: CapabilityMode): StepCapability {
  const evm = step.namespace === 'eip155';
  const refuse = (code: string, mechanism: Mechanism | null = evm ? 'EVM_ERC7710_METAMASK_V1_3' : 'SOLANA_SPL_DELEGATE_V1'): StepCapability => ({ ok: false, code, mechanism });
  if (step.action === 'bridge') {
    if (step.destinationChain?.startsWith('solana:')) return refuse('BRIDGE_ROUTE_UNAVAILABLE', null);
    // LI.FI calldata is opaque (no fixed-offset recipient); direct Across depositV3 is designable but not compiled yet.
    return refuse(step.strategy.action === 'bridge' && step.strategy.routing === 'across' ? 'DELEGATION_TEMPLATE_NOT_IMPLEMENTED' : 'DELEGATED_TARGET_SCOPE_UNAVAILABLE');
  }
  if (MAINNET.has(step.chain)) return refuse('MAINNET_DELEGATION_DISABLED');
  if (step.action !== 'swap') return refuse(step.action === 'add_liquidity' && !evm ? 'OWNER_SIGNER_REQUIRED' : 'DELEGATION_TEMPLATE_NOT_IMPLEMENTED');
  const input = step.inputs[0], output = step.outputs[0];
  if (step.inputs.length !== 1 || step.outputs.length !== 1 || !input || !output) return refuse('DELEGATION_STEP_SHAPE_UNSUPPORTED');
  if (evm) {
    const profile = publicSwapProfile(step.chain);
    if (!profile || step.adapterId !== 'uniswap.v3') return refuse('DELEGATION_TEMPLATE_NOT_IMPLEMENTED');
    const tokens = [profile.usdc, profile.weth];
    if (!tokens.includes(input.address) || !tokens.includes(output.address) || input.address === output.address) return refuse('DELEGATION_ASSET_NOT_SUPPORTED');
    return { ok: true, mechanism: 'EVM_ERC7710_METAMASK_V1_3', evidence: 'IMPLEMENTED',
      need: { kind: 'EVM_UNISWAP_V3_EXACT_INPUT_SINGLE', router: profile.router, tokenIn: input.address, tokenOut: output.address, amountIn: input.amount } };
  }
  // Solana: an SPL delegate can spend a token account; native SOL cannot be delegated at all.
  if (input.address === WSOL || input.symbol === 'SOL') return refuse('NATIVE_SOL_NOT_DELEGABLE');
  if (mode !== 'MOCKED_HARNESS') return refuse('SOLANA_DELEGATED_BUILDER_NOT_IMPLEMENTED');
  // MOCKED harness only: the delegated debit is real SPL Token semantics; the swap itself is the harness's fixture program, never Orca.
  return { ok: true, mechanism: 'SOLANA_SPL_DELEGATE_V1', evidence: 'MOCKED', need: { kind: 'SOLANA_SPL_SPEND', mint: input.address, decimals: input.decimals, amount: input.amount,
    programs: [splDelegation.TOKEN_PROGRAM, MOCKED_SWAP_PROGRAM] } };
}

/** The capability matrix shown to owners and in docs: one row per supported action × network × protocol, as `stepCapability` decides. */
export type MatrixRow = { readonly action: string; readonly network: string; readonly protocol: string; readonly delegated: boolean;
  readonly mechanism: Mechanism | null; readonly reason: string | null; readonly onChain: readonly string[]; readonly application: readonly string[] };
export const ENFORCEMENT: Readonly<Record<Mechanism, { readonly onChain: readonly string[]; readonly application: readonly string[] }>> = Object.freeze({
  EVM_ERC7710_METAMASK_V1_3: {
    onChain: ['redeemer = this credential\'s session signer', 'validity window', 'total number of calls', 'no native value', 'target contracts',
      'function selectors', 'swap recipient = your wallet', 'input and output tokens', 'approval spender', 'maximum input per call'],
    application: ['period budgets', 'executions per period', 'cooldown', 'slippage cap (beyond the signed minimum output)', 'exact workflow hash',
      'approval amount', 'fee ceiling'],
  },
  SOLANA_SPL_DELEGATE_V1: {
    onChain: ['delegate = this credential\'s session key', 'total delegated amount per token account'],
    application: ['recipient', 'program', 'period budgets', 'executions per period', 'cooldown', 'slippage', 'exact workflow hash', 'expiry'],
  },
});
