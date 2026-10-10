// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: the chain-neutral DelegatedAuthorizationManifest — everything the owner authorizes in advance for one workflow, in
 * integer native units, bound to the canonical workflow hash and to the exact Credential grants each step uses — and the
 * UniversalWorkflowAuthorization envelope the owner signs ONCE with a passkey.
 *
 * Neither is a blockchain signature and neither is on-chain enforcement by itself: the Manifest's `enforcement` map states, limit by limit,
 * whether the grant mechanism enforces it on-chain or FloFi's executor enforces it (APPLICATION_GATEWAY). A revision never mutates: any
 * change produces a new revision that must be signed again; `wideningOf` names every way a revision grants more than its predecessor.
 */
import { ENFORCEMENT, type Mechanism } from './capabilities.ts';
import { canonicalJson, domainDigest } from './canonical.ts';
import type { StepBinding } from './authority.ts';
import { assetKey, type WorkflowRequirement } from './steps.ts';

export type Period = 'DAY' | 'WEEK' | 'MONTH';
export const PERIODS: readonly Period[] = Object.freeze(['DAY', 'WEEK', 'MONTH']);
export type ManifestAsset = { readonly asset: string; readonly chain: string; readonly address: string; readonly symbol: string; readonly decimals: number;
  readonly role: 'INPUT' | 'OUTPUT'; readonly maxPerExecution: string | null; readonly budgets: readonly { readonly period: Period; readonly amount: string }[] };
export type ManifestCredential = { readonly stepIndex: number; readonly credentialId: string; readonly grantId: string; readonly chain: string;
  readonly mechanism: Mechanism; readonly walletAddress: string; readonly grantCommitment: string };
export type DelegatedAuthorizationManifest = {
  readonly type: 'flofi.delegated-authorization-manifest'; readonly version: 1;
  readonly owner: string; readonly authorizationId: string; readonly revision: number; readonly createdAt: string;
  readonly validFrom: string; readonly expiresAt: string; readonly timezone: string;
  readonly workflow: { readonly mode: 'EXACT'; readonly workflowHash: string; readonly engineVersion: string; readonly stepCount: number };
  readonly chains: readonly string[]; readonly actions: readonly string[];
  readonly protocols: readonly { readonly chain: string; readonly adapterId: string; readonly targets: readonly string[] }[];
  readonly assets: readonly ManifestAsset[]; readonly recipients: readonly string[];
  readonly limits: { readonly maxExecutionsPerPeriod: { readonly count: number; readonly period: Period } | null; readonly cooldownSeconds: number;
    readonly maxSlippageBps: number; readonly quoteMaxAgeSeconds: number; readonly minHealthFactor: string | null };
  readonly credentials: readonly ManifestCredential[];
  readonly enforcement: Readonly<Record<string, readonly string[]>>;
};
export const manifestHash = (m: DelegatedAuthorizationManifest): string => domainDigest('flofi.delegated-authorization-manifest.v1', m);

/** The owner's limits in integer native units per input asset key; everything else is derived from the workflow and its grants. */
export type LimitsInput = {
  readonly assets: readonly { readonly asset: string; readonly maxPerExecution: string; readonly budgets: readonly { readonly period: Period; readonly amount: string }[] }[];
  readonly maxExecutionsPerPeriod: { readonly count: number; readonly period: Period } | null;
  readonly cooldownSeconds: number; readonly maxSlippageBps: number;
};
export type ManifestInput = { readonly owner: string; readonly authorizationId: string; readonly revision: number; readonly now: Date; readonly validFrom: Date;
  readonly expiresAt: Date; readonly timezone: string; readonly engineVersion: string; readonly requirement: WorkflowRequirement;
  readonly bindings: readonly StepBinding[]; readonly limits: LimitsInput };
export const QUOTE_MAX_AGE_SECONDS = 120;
export const MAX_AUTHORIZATION_MS = 366 * 86_400_000;
const NATIVE = /^(0|[1-9][0-9]{0,38})$/;
const fail = (code: string): never => { throw new Error(code); };

/** Per input asset key, what one execution of the workflow spends (every step's input, summed). */
export function executionSpend(requirement: WorkflowRequirement): ReadonlyMap<string, bigint> {
  const spend = new Map<string, bigint>();
  for (const step of requirement.steps) for (const input of step.inputs) spend.set(assetKey(input), (spend.get(assetKey(input)) ?? 0n) + input.amount);
  return spend;
}

export function buildManifest(input: ManifestInput): DelegatedAuthorizationManifest {
  const r = input.requirement, spend = executionSpend(r);
  const inputs = new Map(r.steps.flatMap(s => s.inputs).map(a => [assetKey(a), a]));
  const outputs = new Map(r.steps.flatMap(s => s.outputs).map(a => [assetKey(a), a]).filter(([k]) => !inputs.has(k as string)) as [string, typeof r.steps[number]['outputs'][number]][]);
  const assets: ManifestAsset[] = [...[...inputs.entries()].map(([key, a]) => {
    const chosen = input.limits.assets.find(l => l.asset === key) ?? fail('MANIFEST_ASSET_LIMIT_REQUIRED');
    return { asset: key, chain: a.chain, address: a.address, symbol: a.symbol, decimals: a.decimals, role: 'INPUT' as const, maxPerExecution: chosen.maxPerExecution,
      budgets: [...chosen.budgets].sort((x, y) => PERIODS.indexOf(x.period) - PERIODS.indexOf(y.period)) };
  }), ...[...outputs.entries()].map(([key, a]) => ({ asset: key, chain: a.chain, address: a.address, symbol: a.symbol, decimals: a.decimals, role: 'OUTPUT' as const,
    maxPerExecution: null, budgets: [] }))].sort((a, b) => a.asset < b.asset ? -1 : 1);
  if (input.limits.assets.some(l => !inputs.has(l.asset))) fail('MANIFEST_ASSET_NOT_IN_WORKFLOW');
  const protocols = new Map<string, { chain: string; adapterId: string; targets: Set<string> }>();
  for (const b of input.bindings) {
    const step = r.steps[b.stepIndex]!, k = `${step.chain}|${step.adapterId}`;
    const entry = protocols.get(k) ?? protocols.set(k, { chain: step.chain, adapterId: step.adapterId ?? 'unknown', targets: new Set() }).get(k)!;
    if (b.need.kind === 'EVM_UNISWAP_V3_EXACT_INPUT_SINGLE') { entry.targets.add(b.need.router); entry.targets.add(b.need.tokenIn); }
    else { entry.targets.add(b.need.mint); for (const program of b.need.programs) entry.targets.add(program); }
  }
  const mechanisms = [...new Set(input.bindings.map(b => b.mechanism))].sort();
  const enforcement: Record<string, string[]> = {};
  for (const m of mechanisms) {
    for (const rule of ENFORCEMENT[m].onChain) (enforcement[rule] ??= []).push(`SMART_ACCOUNT_MODULE_OR_GUARD:${m}`);
    for (const rule of ENFORCEMENT[m].application) (enforcement[rule] ??= []).push('APPLICATION_GATEWAY');
  }
  for (const rule of Object.keys(enforcement)) enforcement[rule] = [...new Set(enforcement[rule])].sort();
  const manifest: DelegatedAuthorizationManifest = {
    type: 'flofi.delegated-authorization-manifest', version: 1, owner: input.owner, authorizationId: input.authorizationId, revision: input.revision,
    createdAt: input.now.toISOString(), validFrom: input.validFrom.toISOString(), expiresAt: input.expiresAt.toISOString(), timezone: input.timezone,
    workflow: { mode: 'EXACT', workflowHash: r.workflowHash, engineVersion: input.engineVersion, stepCount: r.steps.length },
    chains: [...r.chains].sort(), actions: [...r.actionTypes].sort(),
    protocols: [...protocols.values()].map(p => ({ chain: p.chain, adapterId: p.adapterId, targets: [...p.targets].sort() })).sort((a, b) => a.chain < b.chain ? -1 : a.chain > b.chain ? 1 : 0),
    assets, recipients: [...new Set(input.bindings.map(b => `${b.chain}:${b.walletAddress}`))].sort(),
    limits: { maxExecutionsPerPeriod: input.limits.maxExecutionsPerPeriod, cooldownSeconds: input.limits.cooldownSeconds,
      maxSlippageBps: input.limits.maxSlippageBps, quoteMaxAgeSeconds: QUOTE_MAX_AGE_SECONDS, minHealthFactor: null },
    credentials: input.bindings.map(b => ({ stepIndex: b.stepIndex, credentialId: b.credentialId, grantId: b.grantId, chain: b.chain, mechanism: b.mechanism,
      walletAddress: b.walletAddress, grantCommitment: b.grantCommitment })),
    enforcement,
  };
  const problem = manifestProblem(manifest, r, spend);
  return problem ? fail(problem) : manifest;
}

/** Why a manifest is not a valid authorization of `requirement` (its own workflow must fit its own limits), or null. */
export function manifestProblem(m: DelegatedAuthorizationManifest, requirement: WorkflowRequirement, spend = executionSpend(requirement)): string | null {
  const from = Date.parse(m.validFrom), to = Date.parse(m.expiresAt);
  if (!(from < to) || to - from > MAX_AUTHORIZATION_MS) return 'MANIFEST_VALIDITY_INVALID';
  if (m.workflow.workflowHash !== requirement.workflowHash || m.workflow.stepCount !== requirement.steps.length) return 'MANIFEST_WORKFLOW_MISMATCH';
  if (m.credentials.length !== requirement.steps.length || requirement.steps.some(s => m.credentials.filter(c => c.stepIndex === s.index).length !== 1))
    return 'MANIFEST_CREDENTIALS_INCOMPLETE';
  if (!Number.isInteger(m.limits.maxSlippageBps) || m.limits.maxSlippageBps < 0 || m.limits.maxSlippageBps > 1_000) return 'MANIFEST_SLIPPAGE_INVALID';
  if (requirement.steps.some(s => s.slippageBps !== null && s.slippageBps > m.limits.maxSlippageBps)) return 'MANIFEST_SLIPPAGE_BELOW_WORKFLOW';
  if (!Number.isInteger(m.limits.cooldownSeconds) || m.limits.cooldownSeconds < 0 || m.limits.cooldownSeconds > 31 * 86_400) return 'MANIFEST_COOLDOWN_INVALID';
  const count = m.limits.maxExecutionsPerPeriod;
  if (count && (!Number.isInteger(count.count) || count.count < 1 || count.count > 1_000 || !PERIODS.includes(count.period))) return 'MANIFEST_COUNT_INVALID';
  for (const [key, amount] of spend) {
    const asset = m.assets.find(a => a.asset === key && a.role === 'INPUT');
    if (!asset || asset.maxPerExecution === null || !NATIVE.test(asset.maxPerExecution)) return 'MANIFEST_ASSET_LIMIT_REQUIRED';
    if (BigInt(asset.maxPerExecution) < amount) return 'MANIFEST_LIMIT_BELOW_WORKFLOW';
    for (const b of asset.budgets) {
      if (!PERIODS.includes(b.period) || !NATIVE.test(b.amount)) return 'MANIFEST_BUDGET_INVALID';
      if (BigInt(b.amount) < amount) return 'MANIFEST_BUDGET_BELOW_EXECUTION';
    }
    if (new Set(asset.budgets.map(b => b.period)).size !== asset.budgets.length) return 'MANIFEST_BUDGET_INVALID';
  }
  // A budget for every spent asset is mandatory: delegated execution without a cumulative ceiling is refused.
  if (m.assets.some(a => a.role === 'INPUT' && a.budgets.length === 0)) return 'MANIFEST_BUDGET_REQUIRED';
  return null;
}

/** Every way `next` grants more than `previous` (empty: not wider). Any difference still needs a new signed revision. */
export function wideningOf(previous: DelegatedAuthorizationManifest, next: DelegatedAuthorizationManifest): readonly string[] {
  const out = new Set<string>(), added = (a: readonly string[], b: readonly string[]) => b.some(x => !a.includes(x));
  if (previous.owner !== next.owner) out.add('OWNER_CHANGED');
  if (previous.workflow.workflowHash !== next.workflow.workflowHash) out.add('WORKFLOW_CHANGED');
  if (added(previous.chains, next.chains)) out.add('CHAIN_ADDED');
  if (added(previous.actions, next.actions)) out.add('ACTION_ADDED');
  if (added(previous.protocols.flatMap(p => p.targets.map(t => `${p.chain}:${p.adapterId}:${t}`)), next.protocols.flatMap(p => p.targets.map(t => `${p.chain}:${p.adapterId}:${t}`)))) out.add('PROTOCOL_OR_TARGET_ADDED');
  if (added(previous.recipients, next.recipients)) out.add('RECIPIENT_ADDED');
  if (added(previous.credentials.map(c => c.grantId), next.credentials.map(c => c.grantId))) out.add('CREDENTIAL_CHANGED');
  for (const a of next.assets) {
    const p = previous.assets.find(x => x.asset === a.asset && x.role === a.role);
    if (!p) { out.add(a.role === 'INPUT' ? 'TOKEN_ADDED' : 'OUTPUT_TOKEN_ADDED'); continue; }
    if (a.maxPerExecution !== null && (p.maxPerExecution === null || BigInt(a.maxPerExecution) > BigInt(p.maxPerExecution))) out.add('AMOUNT_INCREASED');
    for (const pb of p.budgets) {
      const nb = a.budgets.find(b => b.period === pb.period);
      if (!nb || BigInt(nb.amount) > BigInt(pb.amount)) out.add('BUDGET_INCREASED');
    }
  }
  const pc = previous.limits.maxExecutionsPerPeriod, nc = next.limits.maxExecutionsPerPeriod;
  if (pc && (!nc || nc.period !== pc.period || nc.count > pc.count)) out.add('EXECUTION_COUNT_INCREASED');
  if (next.limits.cooldownSeconds < previous.limits.cooldownSeconds) out.add('COOLDOWN_DECREASED');
  if (next.limits.maxSlippageBps > previous.limits.maxSlippageBps) out.add('SLIPPAGE_INCREASED');
  if (Date.parse(next.expiresAt) > Date.parse(previous.expiresAt)) out.add('EXPIRY_EXTENDED');
  if (Date.parse(next.validFrom) < Date.parse(previous.validFrom)) out.add('VALIDITY_EXTENDED');
  return [...out].sort();
}

/** The envelope the owner signs ONCE with a passkey; the WebAuthn challenge is `authorizationDigest(envelope)`. */
export type UniversalWorkflowAuthorization = {
  readonly type: 'flofi.universal-workflow-authorization'; readonly version: 1;
  readonly environment: { readonly origin: string; readonly rpId: string; readonly tenant: string };
  readonly owner: string; readonly authorizationId: string; readonly revision: number; readonly nonce: string;
  readonly workflowHash: string; readonly manifestHash: string;
  readonly credentials: readonly Omit<ManifestCredential, 'walletAddress'>[];
  readonly chains: readonly string[]; readonly actions: readonly string[];
  readonly validFrom: string; readonly expiresAt: string; readonly passkeyId: string;
};
export function universalAuthorization(m: DelegatedAuthorizationManifest, input: { readonly origin: string; readonly rpId: string; readonly tenant: string;
  readonly nonce: string; readonly passkeyId: string }): UniversalWorkflowAuthorization {
  if (!/^[0-9a-f]{32}$/.test(input.nonce)) fail('AUTHORIZATION_NONCE_INVALID');
  return { type: 'flofi.universal-workflow-authorization', version: 1, environment: { origin: input.origin, rpId: input.rpId, tenant: input.tenant },
    owner: m.owner, authorizationId: m.authorizationId, revision: m.revision, nonce: input.nonce, workflowHash: m.workflow.workflowHash,
    manifestHash: manifestHash(m), credentials: credentialCommitments(m), chains: m.chains, actions: m.actions,
    validFrom: m.validFrom, expiresAt: m.expiresAt, passkeyId: input.passkeyId };
}
/** The per-step grant commitments the envelope signs (the wallet address is already bound by each grant's own commitment). */
export const credentialCommitments = (m: Pick<DelegatedAuthorizationManifest, 'credentials'>): UniversalWorkflowAuthorization['credentials'] =>
  m.credentials.map(c => ({ stepIndex: c.stepIndex, credentialId: c.credentialId, grantId: c.grantId, chain: c.chain, mechanism: c.mechanism, grantCommitment: c.grantCommitment }));
export const authorizationDigest = (a: UniversalWorkflowAuthorization): string => domainDigest('flofi.universal-workflow-authorization.v1', a);
/** Stable comparison of two plain artifacts (stored JSONB comes back with keys reordered). */
export const sameArtifact = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);
