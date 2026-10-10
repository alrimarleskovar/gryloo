// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: execution Credentials, their grants, and the authority graph of a workflow.
 *
 * A Credential is one of the owner's wallets registered for delegated execution; a grant is one on-chain delegated authority of that
 * wallet on one chain (an ERC-7710 delegation, or SPL token delegations) to a session signer dedicated to that grant. Grant scopes are
 * capability CLASSES (pairs, router, per-call cap, number of calls, validity) so one enrollment serves many workflows. The authority graph
 * maps EVERY step of a workflow to exactly one active grant — deterministically — before anything is authorized or executed; any step
 * without one fails the whole workflow with the step and the reason. Pure.
 */
import { stepCapability, type CapabilityMode, type Mechanism, type TemplateNeed } from './capabilities.ts';
import { domainDigest } from './canonical.ts';
import type { Namespace, StepRequirement, WorkflowRequirement } from './steps.ts';

export type EvmPairScope = { readonly tokenIn: string; readonly tokenOut: string; readonly perCallInputCap: string };
export type GrantScope =
  | { readonly mechanism: 'EVM_ERC7710_METAMASK_V1_3'; readonly chain: string; readonly router: string; readonly pairs: readonly EvmPairScope[];
      readonly maxCalls: number; readonly validFrom: string; readonly expiresAt: string }
  | { readonly mechanism: 'SOLANA_SPL_DELEGATE_V1'; readonly chain: string;
      readonly accounts: readonly { readonly mint: string; readonly decimals: number; readonly tokenAccount: string; readonly amount: string }[];
      readonly validFrom: string; readonly expiresAt: string };
export type GrantState = 'PENDING_SIGNATURE' | 'ACTIVE' | 'REVOCATION_REQUESTED' | 'REVOKED' | 'EXPIRED' | 'UNCERTAIN' | 'FAILED';
/** What authorization and execution read of a grant (never key material). */
export type GrantView = {
  readonly grantId: string; readonly credentialId: string; readonly walletNamespace: Namespace; readonly walletAddress: string;
  readonly chain: string; readonly mechanism: Mechanism; readonly state: GrantState; readonly scope: GrantScope; readonly scopeHash: string;
  readonly sessionAddress: string; readonly commitment: string | null; readonly passkeyId: string; readonly verifiedAt: string | null;
  readonly callsUsed: number;
};
export const scopeHash = (scope: GrantScope): string => domainDigest('flofi.credential-grant-scope.v1', scope);

export type StepBinding = { readonly stepIndex: number; readonly credentialId: string; readonly grantId: string; readonly mechanism: Mechanism;
  readonly chain: string; readonly walletAddress: string; readonly grantCommitment: string; readonly need: TemplateNeed };
export type GraphFailure = { readonly stepIndex: number; readonly code: string };
/** On failure, `bindings` lists the steps that did resolve (for the owner's view only: a partial graph authorizes nothing). */
export type AuthorityGraph = { readonly ok: true; readonly bindings: readonly StepBinding[] }
  | { readonly ok: false; readonly failures: readonly GraphFailure[]; readonly bindings: readonly StepBinding[] };

const ms = (iso: string) => Date.parse(iso);
/** Why `grant` cannot serve `need` now, or null. */
export function grantCoverage(grant: GrantView, step: StepRequirement, need: TemplateNeed, now: number): string | null {
  if (grant.state !== 'ACTIVE') return grant.state === 'PENDING_SIGNATURE' ? 'CREDENTIAL_NOT_ENROLLED' : `CREDENTIAL_${grant.state}`;
  if (!grant.commitment) return 'CREDENTIAL_NOT_ENROLLED';
  if (now < ms(grant.scope.validFrom)) return 'CREDENTIAL_NOT_YET_VALID';
  if (now >= ms(grant.scope.expiresAt)) return 'CREDENTIAL_EXPIRED';
  if (grant.chain !== step.chain || grant.walletNamespace !== step.namespace) return 'CREDENTIAL_CHAIN_MISMATCH';
  const scope = grant.scope;
  if (need.kind === 'EVM_UNISWAP_V3_EXACT_INPUT_SINGLE') {
    if (scope.mechanism !== 'EVM_ERC7710_METAMASK_V1_3') return 'CREDENTIAL_MECHANISM_MISMATCH';
    if (scope.router !== need.router) return 'CREDENTIAL_SCOPE_TARGET';
    const pair = scope.pairs.find(p => p.tokenIn === need.tokenIn && p.tokenOut === need.tokenOut);
    if (!pair) return 'CREDENTIAL_SCOPE_ASSET';
    if (BigInt(pair.perCallInputCap) < need.amountIn) return 'CREDENTIAL_SCOPE_AMOUNT';
    // Each execution of this step spends two calls (exact approval, then the swap).
    if (grant.callsUsed + 2 > scope.maxCalls) return 'CREDENTIAL_CALLS_EXHAUSTED';
    return null;
  }
  if (scope.mechanism !== 'SOLANA_SPL_DELEGATE_V1') return 'CREDENTIAL_MECHANISM_MISMATCH';
  const account = scope.accounts.find(a => a.mint === need.mint);
  if (!account) return 'CREDENTIAL_SCOPE_ASSET';
  if (account.decimals !== need.decimals) return 'CREDENTIAL_SCOPE_DECIMALS';
  if (BigInt(account.amount) < need.amount) return 'CREDENTIAL_SCOPE_AMOUNT';
  return null;
}

/**
 * Resolves the whole authority graph: each step → its capability → the owner's grants that cover it. The choice is deterministic (the
 * covering grant with the latest expiry, then the smallest id) and is recorded in the authorization; execution never re-chooses.
 * `preferred` pins earlier choices (an authorization's own bindings): a pinned grant that no longer covers its step is a failure, never a
 * silent switch to another grant.
 */
export function resolveAuthorityGraph(requirement: WorkflowRequirement, grants: readonly GrantView[], mode: CapabilityMode, now: number,
  preferred?: readonly Pick<StepBinding, 'stepIndex' | 'grantId'>[]): AuthorityGraph {
  const bindings: StepBinding[] = [], failures: GraphFailure[] = [];
  for (const step of requirement.steps) {
    const capability = stepCapability(step, mode);
    if (!capability.ok) { failures.push({ stepIndex: step.index, code: capability.code }); continue; }
    const pinned = preferred?.find(p => p.stepIndex === step.index);
    const candidates = grants.filter(g => g.mechanism === capability.mechanism && (!pinned || g.grantId === pinned.grantId));
    if (pinned && !candidates.length) { failures.push({ stepIndex: step.index, code: 'CREDENTIAL_NOT_FOUND' }); continue; }
    const reasons = candidates.map(g => ({ g, why: grantCoverage(g, step, capability.need, now) }));
    const covering = reasons.filter(r => r.why === null).map(r => r.g)
      .sort((a, b) => ms(b.scope.expiresAt) - ms(a.scope.expiresAt) || (a.grantId < b.grantId ? -1 : 1));
    const chosen = covering[0];
    if (!chosen) { failures.push({ stepIndex: step.index, code: reasons[0]?.why ?? 'DELEGATED_AUTHORITY_UNAVAILABLE' }); continue; }
    bindings.push({ stepIndex: step.index, credentialId: chosen.credentialId, grantId: chosen.grantId, mechanism: chosen.mechanism, chain: chosen.chain,
      walletAddress: chosen.walletAddress, grantCommitment: chosen.commitment!, need: capability.need });
  }
  // Several steps on one grant consume it together: its call count (EVM) or delegated amount per mint (Solana) must cover all of them.
  for (const grant of grants) {
    const mine = bindings.filter(b => b.grantId === grant.grantId);
    if (mine.length < 2) continue;
    const scope = grant.scope;
    const exceeded = scope.mechanism === 'EVM_ERC7710_METAMASK_V1_3' ? grant.callsUsed + 2 * mine.length > scope.maxCalls
      : scope.accounts.some(a => mine.reduce((sum, b) => b.need.kind === 'SOLANA_SPL_SPEND' && b.need.mint === a.mint ? sum + b.need.amount : sum, 0n) > BigInt(a.amount));
    if (exceeded) failures.push({ stepIndex: mine.at(-1)!.stepIndex, code: scope.mechanism === 'EVM_ERC7710_METAMASK_V1_3' ? 'CREDENTIAL_CALLS_EXHAUSTED' : 'CREDENTIAL_SCOPE_AMOUNT' });
  }
  return failures.length ? { ok: false, failures: failures.sort((a, b) => a.stepIndex - b.stepIndex), bindings } : { ok: true, bindings };
}
