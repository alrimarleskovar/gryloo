// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: the owner's delegated-execution operations. Every call names the owner whose wallet session the caller verified;
 * every query is scoped to that owner. Nothing here signs or submits a transaction (owner operations hold only `SignerAdmin`: they can create
 * a session key for a new grant and destroy it on revocation, never sign with it):
 *
 *   passkeys          register (single-use challenge, fresh wallet sign-in checked by the BFF) / revoke
 *   credentials       prepare a grant enrollment for a wallet THIS request proved → the wallet signs it → verify (signature + chain
 *                     state) → ACTIVE; revoke: unusable by FloFi at once, then the wallet's own on-chain revocation, verified by readback
 *   automations       preview (authority graph over every step: which Credentials cover it, which are missing and why) → create
 *                     (rule PAUSED + authorization revision 1) → review (the Universal Workflow Authorization envelope, a fresh nonce,
 *                     single-use challenge = its digest) → sign (ONE passkey assertion; the rule becomes ACTIVE) → revoke / re-authorize
 *   executions        detail, and the owner's resume of a HALTED execution (re-verified by the executor; no signature)
 */
import { createHash, randomBytes } from 'node:crypto';
import { SOLANA_DEVNET_TOKENS } from '@defi-workflow-engine/action-registry';
import { associatedTokenAddress, splDelegation } from '@defi-workflow-engine/reference-compiler';
import type { Database } from '@defi-workflow-engine/cloud-runtime';
import { routeStrategy } from '../automations/assets.ts';
import { AMOUNT_SCALE, formatScaled, parseScaled } from '../automations/decimal.ts';
import { assertLimits } from '../automations/limits.ts';
import { DELEGATION_EXECUTE_KIND } from '../automations/pg-store.ts';
import { assertSchedule, nextSlotAfter, validTimeZone, type Schedule } from '../automations/schedule.ts';
import type { AutomationStore, Owner, RuleRecord } from '../automations/store.ts';
import { conditionThreshold, type PriceCondition } from '../automations/trigger.ts';
import { publicSwapProfile } from '../domain/public-testnet-swap.ts';
import { NETWORKS, composeWorkflowBound } from '../engine/strategy-engine';
import { NETWORK_CHAINS } from '../engine/capability-catalog';
import type { NetworkId, StrategyInput, StrategySpec } from '../engine/strategy-spec';
import { ENGINE_VERSION } from '../platform/index.ts';
import { b64url, fromB64url, rpIdOf, verifyAssertion, verifyRegistration } from '../passkeys/webauthn.ts';
import { ADAPTERS, passkeyAnchor } from './adapters.ts';
import { resolveAuthorityGraph, scopeHash, type GrantScope, type StepBinding } from './authority.ts';
import { ENFORCEMENT, stepCapability } from './capabilities.ts';
import { digestBytes } from './canonical.ts';
import type { ChainTransport } from './chains.ts';
import type { DelegationConfig } from './config.ts';
import { executionAvailability } from './config.ts';
import { isCredentialInput, isDelegatedAutomationInput, type CredentialInput, type DelegatedAutomationInput } from './definition.ts';
import { authorizationDigest, buildManifest, executionSpend, manifestHash, universalAuthorization, wideningOf, type DelegatedAuthorizationManifest,
  type LimitsInput } from './manifest.ts';
import type { DelegationStore, ExecutionRecord, GrantRecord, PasskeyRecord } from './pg-store.ts';
import { periodStarts } from './policy.ts';
import type { SignerAdmin } from './runtime.ts';
import { assetKey, requirementOf, type WorkflowRequirement } from './steps.ts';
import type { AuthorizationView, BudgetView, CapabilityRowView, CreatedView, DelegationOverviewView, ExecutionView, GrantView, ManifestView, PasskeyOptionsView,
  PasskeyView, PreviewView, ReviewView } from './views.ts';

export type DelegationServiceDeps = {
  readonly config: DelegationConfig; readonly db: Database; readonly store: DelegationStore; readonly automations: AutomationStore;
  readonly signer: SignerAdmin | null; readonly transport: (chain: string, purpose: 'read' | 'owner') => ChainTransport | null;
  readonly now: () => Date; readonly newId: (prefix: string) => string;
  readonly log: (event: string, fields: Readonly<Record<string, string | number | boolean | null>>) => void;
};
const refuse = (code: string): never => { throw new Error(code); };
const ownerKey = (o: Owner) => `${o.namespace}:${o.address}`;
const CHALLENGE_MS = 5 * 60_000, MAX_EXPIRY_MS = 366 * 86_400_000;
const NETWORK_OF: Readonly<Record<string, NetworkId>> = Object.freeze(Object.fromEntries(Object.entries(NETWORK_CHAINS).map(([id, chain]) => [chain, id as NetworkId])));
const networkLabel = (chain: string) => NETWORK_OF[chain] ? NETWORKS[NETWORK_OF[chain]!].label : chain;
const display = (amount: bigint | string, decimals: number) => formatScaled(BigInt(amount) * 10n ** BigInt(AMOUNT_SCALE - decimals), AMOUNT_SCALE);
function nativeUnits(value: string, decimals: number, code: string): bigint {
  const scaled = parseScaled(value, decimals);
  return scaled === null || scaled <= 0n ? refuse(code) : scaled;
}
/** Language-neutral (symbols and network names only), so the browser can show it in any locale. */
const stepLabel = (s: StrategySpec) => s.action === 'swap' ? `${s.amount} ${s.inputAsset} → ${s.outputAsset} · ${NETWORKS[s.network].label}` : s.action;

export function createDelegationService(deps: DelegationServiceDeps) {
  const { store, config } = deps;
  const rpId = rpIdOf(config.passkeyOrigin);

  // ── Views ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const passkeyView = (p: PasskeyRecord): PasskeyView => ({ passkeyId: p.passkeyId, label: p.label, credentialId: p.credentialId, createdAt: p.createdAt.toISOString(),
    lastUsedAt: p.lastUsedAt?.toISOString() ?? null, revoked: p.revokedAt !== null });
  function grantView(g: GrantRecord): GrantView {
    const s = g.scope, decimals = (mint: string) => s.mechanism === 'SOLANA_SPL_DELEGATE_V1' ? s.accounts.find(a => a.mint === mint)?.decimals ?? 0 : 0;
    const profile = publicSwapProfile(g.chain), symbol = (token: string) => profile ? token === profile.usdc ? 'USDC' : token === profile.weth ? 'WETH' : token : token;
    const scope = s.mechanism === 'EVM_ERC7710_METAMASK_V1_3'
      ? { kind: 'EVM' as const, router: s.router, maxCalls: s.maxCalls, pairs: s.pairs.map(p => ({ input: symbol(p.tokenIn), output: symbol(p.tokenOut),
          perCallCap: display(p.perCallInputCap, symbol(p.tokenIn) === 'USDC' ? 6 : 18) })) }
      : { kind: 'SOLANA' as const, tokens: s.accounts.map(a => ({ symbol: Object.values(SOLANA_DEVNET_TOKENS).find(t => t.mint === a.mint)?.symbol ?? a.mint,
          amount: display(a.amount, decimals(a.mint)), tokenAccount: a.tokenAccount })) };
    return { grantId: g.grantId, credentialId: g.credentialId, walletNamespace: g.walletNamespace, walletAddress: g.walletAddress, chain: g.chain, network: networkLabel(g.chain),
      mechanism: g.mechanism, state: g.state, scope, sessionAddress: g.sessionAddress, commitment: g.commitment, passkeyId: g.passkeyId, verifiedAt: g.verifiedAt,
      validFrom: s.validFrom, expiresAt: s.expiresAt, callsUsed: g.callsUsed, enrollment: g.state === 'PENDING_SIGNATURE' ? g.enrollment : null,
      revocation: g.state === 'REVOCATION_REQUESTED' ? g.revocation : null, onChain: ENFORCEMENT[g.mechanism].onChain, application: ENFORCEMENT[g.mechanism].application };
  }
  function manifestView(m: DelegatedAuthorizationManifest, requirement: WorkflowRequirement | null, setupSignatures = 0): ManifestView {
    return { authorizationId: m.authorizationId, revision: m.revision, manifestHash: manifestHash(m), workflowHash: m.workflow.workflowHash, chains: m.chains,
      networks: m.chains.map(networkLabel), actions: m.actions,
      steps: m.credentials.map(c => ({ stepIndex: c.stepIndex, label: requirement ? stepLabel(requirement.steps[c.stepIndex]!.strategy) : `Step ${c.stepIndex + 1}`, chain: c.chain,
        network: networkLabel(c.chain), credentialId: c.credentialId, grantId: c.grantId, walletAddress: c.walletAddress, mechanism: c.mechanism })),
      assets: m.assets.map(a => ({ asset: a.asset, symbol: a.symbol, chain: a.chain, role: a.role, maxPerExecution: a.maxPerExecution === null ? null : display(a.maxPerExecution, a.decimals),
        budgets: a.budgets.map(b => ({ period: b.period, amount: display(b.amount, a.decimals) })) })),
      recipients: m.recipients, maxExecutionsPerPeriod: m.limits.maxExecutionsPerPeriod, cooldownSeconds: m.limits.cooldownSeconds, maxSlippageBps: m.limits.maxSlippageBps,
      validFrom: m.validFrom, expiresAt: m.expiresAt, enforcement: m.enforcement, setupSignatures };
  }
  async function budgetView(m: DelegatedAuthorizationManifest): Promise<BudgetView[]> {
    const starts = periodStarts(m, deps.now().getTime());
    const usage = await store.usageOf(m.authorizationId, { DAY: new Date(starts.DAY), WEEK: new Date(starts.WEEK), MONTH: new Date(starts.MONTH) });
    const entries = await store.budget(m.authorizationId);
    return m.assets.filter(a => a.role === 'INPUT').map(a => ({ asset: a.asset, symbol: a.symbol, chain: a.chain, maxPerExecution: display(a.maxPerExecution ?? '0', a.decimals),
      periods: a.budgets.map(b => {
        const start = new Date(starts[b.period]).getTime();
        const inPeriod = entries.filter(e => e.asset === a.asset && e.starts[b.period].getTime() === start);
        const spent = inPeriod.filter(e => e.state === 'SPENT').reduce((s, e) => s + (e.spent ?? 0n), 0n);
        const reserved = inPeriod.filter(e => e.state === 'RESERVED').reduce((s, e) => s + e.reserved, 0n);
        const used = usage.amounts.get(a.asset)?.get(b.period) ?? 0n, remaining = BigInt(b.amount) - used;
        return { period: b.period, limit: display(b.amount, a.decimals), spent: display(spent, a.decimals), reserved: display(reserved, a.decimals),
          remaining: display(remaining > 0n ? remaining : 0n, a.decimals) };
      }) }));
  }
  async function executionView(e: ExecutionRecord): Promise<ExecutionView> {
    const steps = await store.steps(e.executionId), manifest = (await store.revision(e.authorizationId, e.revision))?.manifest;
    const amounts = (xs: unknown) => ((xs ?? []) as { asset: string; amount: string }[]).map(x => {
      const a = manifest?.assets.find(y => y.asset === x.asset);
      return { asset: x.asset, symbol: a?.symbol ?? x.asset.split(':').at(-1)!, chain: x.asset.split('/')[0]!, amount: a ? display(x.amount, a.decimals) : x.amount };
    });
    return { executionId: e.executionId, authorizationId: e.authorizationId, revision: e.revision, ruleId: e.ruleId, occurrenceId: e.occurrenceId, state: e.state, code: e.code,
      attention: e.attention, currentStep: e.currentStep, stepCount: e.stepCount, createdAt: e.createdAt.toISOString(), updatedAt: e.updatedAt.toISOString(),
      settledAt: e.settledAt?.toISOString() ?? null, evidenceLevel: (e.evidence?.evidenceLevel as string | undefined) ?? null,
      steps: steps.map(s => ({ step: s.stepIndex, state: s.state, chain: s.chain, network: networkLabel(s.chain), credentialId: s.credentialId, grantId: s.grantId, mechanism: s.mechanism,
        grantCommitment: s.grantCommitment, submissions: ((s.submission?.hashes ?? []) as string[]), spent: amounts(s.reconciliation?.spent), received: amounts(s.reconciliation?.received),
        code: s.code, provenance: (s.reconciliation?.evidence as { provenance?: string } | undefined)?.provenance ?? null })) };
  }
  async function liveGrants(owner: Owner) { return (await store.grants(owner)); }
  function capabilityRows(): CapabilityRowView[] {
    const rows: CapabilityRowView[] = [];
    const examples: readonly StrategySpec[] = [
      { action: 'swap', network: 'base-sepolia', inputAsset: 'USDC', outputAsset: 'WETH', amount: '1' }, { action: 'swap', network: 'ethereum-sepolia', inputAsset: 'USDC', outputAsset: 'WETH', amount: '1' },
      { action: 'swap', network: 'base', inputAsset: 'USDC', outputAsset: 'WETH', amount: '1' }, { action: 'swap', network: 'solana-devnet', inputAsset: 'devUSDC', outputAsset: 'SOL', amount: '1' },
      { action: 'swap', network: 'solana-devnet', inputAsset: 'SOL', outputAsset: 'devUSDC', amount: '1' },
      { action: 'supply', network: 'base-sepolia', asset: 'USDC', amount: '1', beneficiary: '0x' + '1'.repeat(40) },
      { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '1' },
      { action: 'add_liquidity', network: 'solana-devnet', maxAmounts: { SOL: '1', devUSDC: '1' }, range: { unit: 'price', lower: '100', upper: '200' } },
    ];
    for (const s of examples) {
      const composed = composeWorkflowBound(s, undefined);
      const req = composed.ok ? requirementOf(composed) : null;
      const step = req?.ok ? req.value.steps[0] : null;
      if (!step) continue;
      const c = stepCapability(step, config.mode);
      rows.push({ action: step.action, network: networkLabel(step.chain), protocol: step.adapterId ?? 'unknown', delegated: c.ok, mechanism: c.mechanism, reason: c.ok ? null : c.code });
    }
    rows.push({ action: 'bridge', network: 'EVM → Solana', protocol: '—', delegated: false, mechanism: null, reason: 'BRIDGE_ROUTE_UNAVAILABLE' });
    return rows;
  }

  // ── Workflow → requirement → graph → manifest ─────────────────────────────────────────────────────────────────────────────
  function strategyOf(input: DelegatedAutomationInput): StrategyInput {
    const steps = input.steps.map(step => {
      const r = routeStrategy({ asset: step.asset, side: step.side, network: step.network, amount: step.amount, slippageBps: step.slippageBps });
      return r.ok ? r.strategy : refuse(r.code);
    });
    return steps.length === 1 ? steps[0]! : { version: 2, steps };
  }
  function validated(input: unknown): { input: DelegatedAutomationInput; strategy: StrategyInput; requirement: WorkflowRequirement; expiresAt: Date } {
    if (!isDelegatedAutomationInput(input)) return refuse('DELEGATION_INPUT_INVALID');
    const now = deps.now().getTime(), expiresAt = Date.parse(input.expiresAt);
    if (Number.isNaN(expiresAt) || expiresAt <= now || expiresAt - now > MAX_EXPIRY_MS) refuse('DELEGATION_EXPIRY_INVALID');
    if (input.trigger.kind === 'SCHEDULE') assertSchedule({ ...input.trigger.schedule });
    else { if (!validTimeZone(input.trigger.timezone)) refuse('AUTOMATION_SCHEDULE_INVALID'); conditionThreshold({ ...input.trigger.condition } as PriceCondition); }
    const strategy = strategyOf(input), composed = composeWorkflowBound(strategy, undefined);
    if (!composed.ok) return refuse(composed.code);
    const req = requirementOf(composed);
    if (!req.ok) return refuse(req.code);
    return { input, strategy: composed.strategy, requirement: req.value, expiresAt: new Date(expiresAt) };
  }
  function limitsOf(input: DelegatedAutomationInput, requirement: WorkflowRequirement): LimitsInput {
    const decimals = new Map(requirement.steps.flatMap(s => s.inputs).map(i => [assetKey(i), i.decimals]));
    const spent = executionSpend(requirement);
    for (const key of spent.keys()) if (!input.limits.assets.some(a => a.asset === key)) refuse('MANIFEST_ASSET_LIMIT_REQUIRED');
    return { assets: input.limits.assets.map(a => {
      const d = decimals.get(a.asset) ?? refuse('MANIFEST_ASSET_NOT_IN_WORKFLOW');
      return { asset: a.asset, maxPerExecution: nativeUnits(a.maxPerExecution, d, 'MANIFEST_LIMIT_INVALID').toString(),
        budgets: a.budgets.map(b => ({ period: b.period, amount: nativeUnits(b.amount, d, 'MANIFEST_BUDGET_INVALID').toString() })) };
    }), maxExecutionsPerPeriod: input.limits.maxExecutionsPerPeriod, cooldownSeconds: input.limits.cooldownMinutes * 60, maxSlippageBps: input.limits.maxSlippageBps };
  }
  async function preview(owner: Owner, raw: unknown, authorizationId = 'dau_preview' + 'a'.repeat(15), revision = 1): Promise<{ view: PreviewView; manifest: DelegatedAuthorizationManifest | null;
    v: ReturnType<typeof validated>; bindings: readonly StepBinding[] }> {
    const v = validated(raw), now = deps.now();
    const grants = (await liveGrants(owner)).filter(g => g.owner.namespace === owner.namespace && g.owner.address === owner.address);
    const graph = resolveAuthorityGraph(v.requirement, grants, config.mode, now.getTime());
    const steps = v.requirement.steps.map(s => {
      const c = stepCapability(s, config.mode), b = graph.bindings.find(x => x.stepIndex === s.index) ?? null;
      const failure = graph.ok ? null : graph.failures.find(f => f.stepIndex === s.index)?.code ?? null;
      return { index: s.index, network: networkLabel(s.chain), chain: s.chain, label: stepLabel(s.strategy),
        inputs: s.inputs.map(i => ({ asset: assetKey(i), symbol: i.symbol, chain: i.chain, amount: display(i.amount, i.decimals) })),
        capability: { delegated: c.ok, mechanism: c.mechanism, code: c.ok ? null : c.code },
        binding: b ? { credentialId: b.credentialId, grantId: b.grantId, walletAddress: b.walletAddress } : null, failure };
    });
    const required = graph.ok ? [] : graph.failures.map(f => { const s = v.requirement.steps[f.stepIndex]!, c = stepCapability(s, config.mode);
      return { stepIndex: f.stepIndex, namespace: s.namespace, network: networkLabel(s.chain), mechanism: c.mechanism, reason: f.code }; });
    let manifest: DelegatedAuthorizationManifest | null = null, problem: string | null = graph.ok ? null : 'DELEGATED_AUTHORITY_UNAVAILABLE';
    if (graph.ok) {
      try {
        manifest = buildManifest({ owner: ownerKey(owner), authorizationId, revision, now, validFrom: now, expiresAt: v.expiresAt,
          timezone: v.input.trigger.kind === 'SCHEDULE' ? v.input.trigger.schedule.timezone : v.input.trigger.timezone, engineVersion: ENGINE_VERSION,
          requirement: v.requirement, bindings: graph.bindings, limits: limitsOf(v.input, v.requirement) });
        // Every grant a workflow uses must anchor ONE passkey: the one the owner will sign the workflow with.
        if (new Set(graph.bindings.map(b => grants.find(g => g.grantId === b.grantId)!.passkeyId)).size !== 1) { manifest = null; problem = 'CREDENTIALS_USE_DIFFERENT_PASSKEYS'; }
      } catch (cause) { problem = cause instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(cause.message) ? cause.message : 'MANIFEST_INVALID'; }
    }
    return { v, manifest, bindings: graph.ok ? graph.bindings : [], view: { ok: manifest !== null, workflowHash: v.requirement.workflowHash, steps, requiredEnrollments: required,
      manifest: manifest ? manifestView(manifest, v.requirement) : null, problem } };
  }

  return {
    async overview(owner: Owner): Promise<DelegationOverviewView> {
      const [passkeys, credentials, grants, authorizations, executions] = await Promise.all([store.listPasskeys(owner), store.credentials(owner), store.grants(owner),
        store.authorizations(owner), store.executions(owner, { limit: 30 })]);
      const authViews: AuthorizationView[] = [];
      for (const a of authorizations) {
        const rev = await store.revision(a.authorizationId, a.activeRevision ?? a.latestRevision), rule = await deps.automations.getRule(owner, a.ruleId);
        if (!rev) continue;
        const mine = executions.filter(e => e.authorizationId === a.authorizationId);
        const composed = composeWorkflowBound(rev.strategy, rev.workflowHash), req = composed.ok ? requirementOf(composed) : null;
        authViews.push({ authorizationId: a.authorizationId, ruleId: a.ruleId, ruleName: rule?.name ?? '', state: a.state, latestRevision: a.latestRevision, activeRevision: a.activeRevision,
          manifest: manifestView(rev.manifest, req?.ok ? req.value : null), widening: rev.widening, signedAt: rev.signedAt?.toISOString() ?? null,
          revokedAt: a.revokedAt?.toISOString() ?? null, budget: await budgetView(rev.manifest), executions: mine.length,
          lastExecution: mine[0] ? await executionView(mine[0]) : null });
      }
      return { availability: { enabled: true, mode: config.mode, executor: executionAvailability(config), enrollment: deps.signer ? null : 'DELEGATED_SIGNER_UNAVAILABLE' },
        passkeys: passkeys.map(passkeyView), authorizations: authViews, executions: await Promise.all(executions.map(executionView)), capabilities: capabilityRows(),
        credentials: credentials.map(c => ({ credentialId: c.credentialId, walletNamespace: c.walletNamespace, walletAddress: c.walletAddress, label: c.label,
          grants: grants.filter(g => g.credentialId === c.credentialId).map(grantView) })) };
    },

    // ── Passkeys ──────────────────────────────────────────────────────────────────────────────────────────────────────────
    async passkeyOptions(owner: Owner): Promise<PasskeyOptionsView> {
      const challenge = randomBytes(32), now = deps.now();
      await store.createChallenge(owner, 'REGISTER', challenge, null, new Date(now.getTime() + CHALLENGE_MS), now);
      return { challenge: b64url(challenge), rpId, rpName: 'FloFi', userId: b64url(digestBytes(manifestSafeId(owner))), userName: `${owner.address.slice(0, 6)}…${owner.address.slice(-4)}`,
        excludeCredentials: (await store.listPasskeys(owner)).filter(p => !p.revokedAt).map(p => p.credentialId), timeoutMs: CHALLENGE_MS };
    },
    async passkeyRegister(owner: Owner, response: unknown): Promise<PasskeyView> {
      const r = response as { challenge?: unknown; credentialId?: unknown; clientDataJSON?: unknown; authenticatorData?: unknown; publicKeyAlgorithm?: unknown; label?: unknown } | null;
      if (!r || typeof r.challenge !== 'string' || typeof r.credentialId !== 'string' || typeof r.clientDataJSON !== 'string' || typeof r.authenticatorData !== 'string'
        || typeof r.publicKeyAlgorithm !== 'number' || typeof r.label !== 'string' || !r.label.trim() || r.label.length > 40) refuse('PASSKEY_INPUT_INVALID');
      const challenge = fromB64url(r!.challenge, 64);
      const verified = verifyRegistration({ credentialId: r!.credentialId as string, clientDataJSON: r!.clientDataJSON as string, authenticatorData: r!.authenticatorData as string,
        publicKeyAlgorithm: r!.publicKeyAlgorithm as number }, { challenge, origin: config.passkeyOrigin, rpId });
      const passkey = await store.insertPasskey(owner, { passkeyId: deps.newId('psk'), credentialId: verified.credentialId, publicKeySpki: verified.publicKeySpki, rpId,
        origin: config.passkeyOrigin, signCount: verified.signCount, label: (r!.label as string).trim() }, challenge, deps.now());
      deps.log('delegation.passkey_registered', { passkey: passkey.passkeyId });
      return passkeyView(passkey);
    },
    async passkeyRevoke(owner: Owner, passkeyId: string): Promise<PasskeyView> { return passkeyView(await store.revokePasskey(owner, passkeyId, deps.now())); },

    // ── Credentials ───────────────────────────────────────────────────────────────────────────────────────────────────────
    async credentialPrepare(owner: Owner, proven: readonly Owner[], raw: unknown): Promise<GrantView> {
      if (!deps.signer) refuse('DELEGATED_SIGNER_UNAVAILABLE');
      if (!isCredentialInput(raw)) refuse('CREDENTIAL_INPUT_INVALID');
      const input = raw as CredentialInput, now = deps.now(), expires = Date.parse(input.expiresAt);
      const namespace = input.mechanism === 'EVM_ERC7710_METAMASK_V1_3' ? 'eip155' : 'solana';
      // Only a wallet THIS request proved can become an execution Credential of this owner.
      if (!proven.some(p => p.namespace === namespace && p.address === input.walletAddress)) refuse('WALLET_SESSION_REQUIRED');
      if (Number.isNaN(expires) || expires <= now.getTime() || expires - now.getTime() > MAX_EXPIRY_MS) refuse('CREDENTIAL_EXPIRY_INVALID');
      const passkey = await store.passkey(owner, input.passkeyId);
      if (!passkey || passkey.revokedAt) refuse('PASSKEY_REQUIRED');
      const chain = NETWORK_CHAINS[input.network], validFrom = now.toISOString(), expiresAt = new Date(expires).toISOString();
      let scope: GrantScope;
      if (input.mechanism === 'EVM_ERC7710_METAMASK_V1_3') {
        const profile = publicSwapProfile(chain) ?? refuse('CREDENTIAL_NETWORK_UNSUPPORTED');
        const token = (s: 'USDC' | 'WETH') => s === 'USDC' ? profile.usdc : profile.weth;
        if (input.pairs.some(p => p.input === p.output) || new Set(input.pairs.map(p => `${p.input}>${p.output}`)).size !== input.pairs.length) refuse('CREDENTIAL_SCOPE_INVALID');
        scope = { mechanism: input.mechanism, chain, router: profile.router, maxCalls: input.maxCalls, validFrom, expiresAt,
          pairs: input.pairs.map(p => ({ tokenIn: token(p.input), tokenOut: token(p.output), perCallInputCap: nativeUnits(p.perCallCap, p.input === 'USDC' ? 6 : 18, 'CREDENTIAL_SCOPE_INVALID').toString() })) };
      } else {
        const t = SOLANA_DEVNET_TOKENS.devUSDC;
        scope = { mechanism: input.mechanism, chain, validFrom, expiresAt, accounts: input.tokens.map(tok => ({ mint: t.mint, decimals: t.decimals,
          tokenAccount: associatedTokenAddress(input.walletAddress, t.mint, splDelegation.TOKEN_PROGRAM, 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
          amount: nativeUnits(tok.amount, t.decimals, 'CREDENTIAL_SCOPE_INVALID').toString() })) };
      }
      const transport = deps.transport(chain, 'owner') ?? refuse('DELEGATION_CHAIN_UNAVAILABLE');
      const credential = await store.credential(owner, { namespace, address: input.walletAddress }, input.label.trim(), () => deps.newId('crd'), now);
      const grantId = deps.newId('grt'), session = await deps.signer!.create(namespace);
      const anchor = passkeyAnchor({ owner: ownerKey(owner), grantId, chain, walletAddress: input.walletAddress, passkeyId: passkey!.passkeyId, publicKeySpki: passkey!.publicKeySpki });
      let enrollment: Readonly<Record<string, unknown>>;
      try { enrollment = await ADAPTERS[input.mechanism].prepareEnrollment({ grantId, walletAddress: input.walletAddress, chain, scope, sessionAddress: session.address, anchor }, transport); }
      catch (cause) { await deps.signer!.destroy(session.ref).catch(() => undefined); throw cause; }
      const grant = await store.insertGrant(owner, { grantId, credentialId: credential.credentialId, chain, mechanism: input.mechanism, scope, scopeHash: scopeHash(scope),
        passkeyId: passkey!.passkeyId, sessionKeyRef: session.ref, sessionAddress: session.address, enrollment, expiresAt: new Date(expires) }, now);
      deps.log('delegation.credential_prepared', { grant: grantId, mechanism: input.mechanism });
      return grantView(grant);
    },
    async credentialComplete(owner: Owner, grantId: string, response: unknown): Promise<GrantView> {
      const grant = await store.grant(owner, grantId) ?? refuse('CREDENTIAL_NOT_FOUND');
      if (grant.state !== 'PENDING_SIGNATURE') refuse(`CREDENTIAL_${grant.state}`);
      const transport = deps.transport(grant.chain, 'owner') ?? refuse('DELEGATION_CHAIN_UNAVAILABLE');
      const verified = await ADAPTERS[grant.mechanism].verifyEnrollment(grant, response, transport);
      // A retryable failure (not yet visible on-chain, account not upgraded yet) leaves the enrollment pending; anything else fails it.
      if (!verified.ok && verified.retryable) refuse(verified.code);
      const settled = await store.settleEnrollment(owner, grantId, grant.version, verified, deps.now());
      if (!verified.ok) { await deps.signer?.destroy(grant.sessionKeyRef).catch(() => undefined); refuse(verified.code); }
      deps.log('delegation.credential_enrolled', { grant: grantId });
      return grantView(settled);
    },
    async credentialReverify(owner: Owner, grantId: string): Promise<GrantView> {
      const grant = await store.grant(owner, grantId) ?? refuse('CREDENTIAL_NOT_FOUND');
      if (!['ACTIVE', 'UNCERTAIN'].includes(grant.state)) return grantView(grant);
      const transport = deps.transport(grant.chain, 'read') ?? refuse('DELEGATION_CHAIN_UNAVAILABLE');
      const state = await ADAPTERS[grant.mechanism].reconcileAuthorityState(grant, transport, deps.now());
      await store.reverify(grantId, state, deps.now());
      return grantView((await store.grant(owner, grantId))!);
    },
    /** Revoke credential: FloFi stops using it at once and destroys the session key; the wallet's own on-chain revocation follows. */
    async credentialRevoke(owner: Owner, grantId: string): Promise<GrantView> {
      const grant = await store.grant(owner, grantId) ?? refuse('CREDENTIAL_NOT_FOUND');
      const transport = deps.transport(grant.chain, 'owner') ?? refuse('DELEGATION_CHAIN_UNAVAILABLE');
      const revocation = await ADAPTERS[grant.mechanism].prepareRevocation(grant, transport);
      const requested = await store.requestRevocation(owner, grantId, revocation, deps.now());
      await deps.signer?.destroy(grant.sessionKeyRef).catch(() => undefined);
      deps.log('delegation.credential_revocation_requested', { grant: grantId });
      return grantView(requested);
    },
    async credentialRevocationComplete(owner: Owner, grantId: string, response: unknown): Promise<GrantView> {
      const grant = await store.grant(owner, grantId) ?? refuse('CREDENTIAL_NOT_FOUND');
      if (grant.state !== 'REVOCATION_REQUESTED' && grant.state !== 'UNCERTAIN') refuse('CREDENTIAL_REVOCATION_NOT_REQUESTED');
      const transport = deps.transport(grant.chain, 'owner') ?? refuse('DELEGATION_CHAIN_UNAVAILABLE');
      const outcome = await ADAPTERS[grant.mechanism].verifyRevocation(grant, response, transport);
      return grantView(await store.confirmRevocation(owner, grantId, outcome.state === 'REVOKED' ? 'REVOKED' : 'UNCERTAIN', outcome.verification, deps.now()));
    },

    // ── Delegated automations and their one authorization ─────────────────────────────────────────────────────────────────
    async automationPreview(owner: Owner, input: unknown): Promise<PreviewView> { return (await preview(owner, input)).view; },
    async automationCreate(owner: Owner, input: unknown): Promise<CreatedView> {
      const authorizationId = deps.newId('dau'), p = await preview(owner, input, authorizationId);
      if (!p.manifest) refuse(p.view.problem ?? 'DELEGATED_AUTHORITY_UNAVAILABLE');
      const { v } = p, now = deps.now(), m = p.manifest!;
      const trigger = v.input.trigger, schedule: Schedule | null = trigger.kind === 'SCHEDULE' ? { ...trigger.schedule } : null;
      const condition = trigger.kind === 'PRICE' ? { ...trigger.condition } as PriceCondition & { checkEveryMinutes: number } : null;
      if (condition && v.input.steps[0]!.asset !== condition.asset) refuse('AUTOMATION_ACTION_ASSET_MISMATCH');
      const limits = { maxAmountPerExecution: null, maxAmountPerPeriod: null, maxOccurrencesPerPeriod: v.input.limits.maxExecutionsPerPeriod,
        cooldownMinutes: v.input.limits.cooldownMinutes, maxSlippageBps: v.input.limits.maxSlippageBps };
      assertLimits(limits);
      const name = v.input.name.trim();
      if (!name || [...name].some(c => c.charCodeAt(0) < 32)) refuse('AUTOMATION_NAME_INVALID');
      const rule = await deps.automations.createRule({ ruleId: deps.newId('aut'), owner, name, kind: schedule ? 'SCHEDULED_DCA' : 'PRICE_TRIGGER',
        definition: { schedule, condition, watch: null, limits }, binding: { strategy: v.strategy, workflowHash: v.requirement.workflowHash, engineVersion: ENGINE_VERSION, source: null },
        timezone: schedule?.timezone ?? (trigger.kind === 'PRICE' ? trigger.timezone : 'UTC'), expiresAt: v.expiresAt,
        nextEvaluationAt: schedule ? new Date(nextSlotAfter(schedule, now.getTime()).at) : now, scheduleCursor: schedule ? now : null, delegated: { authorizationId } },
      now, 25, (tx, created) => store.createAuthorization(tx, owner, { authorizationId, ruleId: created.ruleId, strategy: v.strategy, manifest: m, manifestHash: manifestHash(m) }, now));
      deps.log('delegation.automation_created', { rule: rule.ruleId, authorization: authorizationId, steps: v.requirement.steps.length });
      return { ruleId: rule.ruleId, authorizationId, manifest: manifestView(m, v.requirement) };
    },
    /** The Universal Workflow Authorization Review: a fresh envelope (new nonce) whose digest is the single-use WebAuthn challenge. */
    async authorizationReview(owner: Owner, authorizationId: string): Promise<ReviewView> {
      const a = await store.authorization(owner, authorizationId) ?? refuse('AUTHORIZATION_NOT_FOUND');
      if (a.state !== 'PENDING_SIGNATURE') refuse(`AUTHORIZATION_${a.state}`);
      const rev = await store.revision(authorizationId, a.latestRevision) ?? refuse('AUTHORIZATION_NOT_FOUND');
      const composed = composeWorkflowBound(rev.strategy, rev.workflowHash);
      const req = composed.ok ? requirementOf(composed) : null;
      if (!req?.ok) return refuse('AUTHORIZATION_WORKFLOW_MISMATCH');
      // Re-resolve the whole graph now: a grant that lapsed since creation fails here, before the owner signs anything.
      const grants = await store.grants(owner), now = deps.now();
      const graph = resolveAuthorityGraph(req.value, grants, config.mode, now.getTime(), rev.manifest.credentials);
      if (!graph.ok) return refuse(graph.failures[0]!.code);
      const passkeyIds = [...new Set(rev.manifest.credentials.map(c => grants.find(g => g.grantId === c.grantId)!.passkeyId))];
      if (passkeyIds.length !== 1) refuse('CREDENTIALS_USE_DIFFERENT_PASSKEYS');
      const passkey = await store.passkey(owner, passkeyIds[0]!);
      if (!passkey || passkey.revokedAt) refuse('PASSKEY_REVOKED');
      const envelope = universalAuthorization(rev.manifest, { origin: config.passkeyOrigin, rpId, tenant: config.tenantId, nonce: randomBytes(16).toString('hex'),
        passkeyId: passkey!.passkeyId });
      const digest = authorizationDigest(envelope);
      await store.prepareReview(owner, authorizationId, rev.revision, envelope, digest, now);
      await store.createChallenge(owner, 'AUTHORIZE', digestBytes(digest), `${authorizationId}:${rev.revision}`, new Date(now.getTime() + CHALLENGE_MS), now);
      const setup = new Set(rev.manifest.credentials.map(c => c.grantId)).size;
      return { authorizationId, revision: rev.revision, challenge: b64url(digestBytes(digest)), envelopeDigest: digest,
        passkey: { passkeyId: passkey!.passkeyId, credentialId: passkey!.credentialId, rpId }, manifest: manifestView(rev.manifest, req.value, setup),
        widening: rev.widening };
    },
    /** The owner's ONE signature: verifies the passkey assertion over the envelope digest and activates the authorization and its rule. */
    async authorizationSign(owner: Owner, authorizationId: string, revision: number, assertion: unknown): Promise<AuthorizationView> {
      const a = await store.authorization(owner, authorizationId) ?? refuse('AUTHORIZATION_NOT_FOUND');
      const rev = await store.revision(authorizationId, revision) ?? refuse('AUTHORIZATION_NOT_FOUND');
      if (!rev.envelope || !rev.envelopeDigest || a.latestRevision !== revision) refuse('AUTHORIZATION_NOT_PENDING');
      const passkey = await store.passkey(owner, rev.envelope!.passkeyId);
      if (!passkey || passkey.revokedAt) refuse('PASSKEY_REVOKED');
      const r = assertion as { credentialId?: unknown; clientDataJSON?: unknown; authenticatorData?: unknown; signature?: unknown } | null;
      if (!r || typeof r.credentialId !== 'string' || typeof r.clientDataJSON !== 'string' || typeof r.authenticatorData !== 'string' || typeof r.signature !== 'string')
        refuse('AUTHORIZATION_ASSERTION_INVALID');
      const clean = { credentialId: r!.credentialId as string, clientDataJSON: r!.clientDataJSON as string, authenticatorData: r!.authenticatorData as string, signature: r!.signature as string };
      const verified = verifyAssertion(clean, { challenge: digestBytes(rev.envelopeDigest!), origin: config.passkeyOrigin, rpId: passkey!.rpId, credentialId: passkey!.credentialId,
        publicKeySpki: passkey!.publicKeySpki, signCount: passkey!.signCount });
      const rule = await deps.automations.getRule(owner, a.ruleId) ?? refuse('AUTOMATION_NOT_FOUND');
      const now = deps.now(), schedule = rule.definition.schedule;
      await store.activate(owner, { authorizationId, revision, digest: rev.envelopeDigest!, passkeyId: passkey!.passkeyId, signCount: verified.signCount, assertion: clean,
        ruleResume: { nextEvaluationAt: schedule ? new Date(nextSlotAfter(schedule, now.getTime()).at) : now, scheduleCursor: schedule ? now : null } }, now);
      deps.log('delegation.authorization_signed', { authorization: authorizationId, revision });
      return (await this.overview(owner)).authorizations.find(x => x.authorizationId === authorizationId)!;
    },
    async authorizationRevoke(owner: Owner, authorizationId: string): Promise<AuthorizationView> {
      await store.revoke(owner, authorizationId, 'OWNER_REVOKED', deps.now());
      deps.log('delegation.authorization_revoked', { authorization: authorizationId });
      return (await this.overview(owner)).authorizations.find(x => x.authorizationId === authorizationId)!;
    },
    /** A new revision from the rule's current workflow and the owner's current Credentials; nothing runs until it is signed again. */
    async authorizationReauthorize(owner: Owner, authorizationId: string): Promise<ReviewView> {
      const a = await store.authorization(owner, authorizationId) ?? refuse('AUTHORIZATION_NOT_FOUND');
      if (a.state === 'REVOKED' || a.state === 'EXPIRED') refuse(`AUTHORIZATION_${a.state}`);
      const previous = await store.revision(authorizationId, a.latestRevision) ?? refuse('AUTHORIZATION_NOT_FOUND');
      const rule = await deps.automations.getRule(owner, a.ruleId) ?? refuse('AUTOMATION_NOT_FOUND');
      if (!rule.binding) refuse('AUTOMATION_ACTION_UNSUPPORTED');
      const composed = composeWorkflowBound(rule.binding!.strategy, rule.binding!.workflowHash);
      const req = composed.ok ? requirementOf(composed) : null;
      if (!req?.ok) return refuse('STRATEGY_STALE');
      const now = deps.now(), graph = resolveAuthorityGraph(req.value, await store.grants(owner), config.mode, now.getTime());
      if (!graph.ok) return refuse(graph.failures[0]!.code);
      const pm = previous.manifest;
      const manifest = buildManifest({ owner: pm.owner, authorizationId, revision: a.latestRevision + 1, now, validFrom: now, expiresAt: new Date(pm.expiresAt), timezone: pm.timezone,
        engineVersion: ENGINE_VERSION, requirement: req.value, bindings: graph.bindings,
        limits: { assets: pm.assets.filter(x => x.role === 'INPUT').map(x => ({ asset: x.asset, maxPerExecution: x.maxPerExecution!, budgets: x.budgets })),
          maxExecutionsPerPeriod: pm.limits.maxExecutionsPerPeriod, cooldownSeconds: pm.limits.cooldownSeconds, maxSlippageBps: pm.limits.maxSlippageBps } });
      await store.newRevision(owner, { authorizationId, strategy: rule.binding!.strategy, manifest, manifestHash: manifestHash(manifest), widening: wideningOf(pm, manifest) }, now);
      return this.authorizationReview(owner, authorizationId);
    },

    // ── Executions ────────────────────────────────────────────────────────────────────────────────────────────────────────
    async executionDetail(owner: Owner, executionId: string) {
      const e = await store.executionById(executionId);
      if (!e || e.owner.namespace !== owner.namespace || e.owner.address !== owner.address) return refuse('EXECUTION_NOT_FOUND');
      return { execution: await executionView(e), events: (await store.events(owner, { executionId, limit: 100 })).map(x => ({ kind: x.kind, at: x.at.toISOString(), code: x.code })) };
    },
    /** The owner's explicit resume of a HALTED execution (no signature: the executor re-verifies the whole authority chain first). */
    async executionResume(owner: Owner, executionId: string): Promise<ExecutionView> {
      const e = await store.executionById(executionId);
      if (!e || e.owner.namespace !== owner.namespace || e.owner.address !== owner.address) return refuse('EXECUTION_NOT_FOUND');
      if (e.state !== 'HALTED') refuse(`EXECUTION_${e.state}`);
      const resumed = await store.transition(executionId, { version: e.version, from: ['HALTED'] }, 'RUNNING', { attention: false, code: null }, deps.now()) ?? refuse('EXECUTION_CHANGED');
      await deps.db.query(`INSERT INTO work_items (tenant_id, kind, dedupe_key, run_id, payload, state, available_at) VALUES ($1, $2, $3, NULL, $4::jsonb, 'READY', now())
        ON CONFLICT (tenant_id, kind, dedupe_key) WHERE state IN ('READY', 'LEASED') DO NOTHING`,
      [config.tenantId, DELEGATION_EXECUTE_KIND, e.occurrenceId, JSON.stringify({ occurrenceId: e.occurrenceId, authorizationId: e.authorizationId })]);
      return executionView(resumed);
    },
    /** Used by the automation service: a delegated rule may resume only while its authorization is ACTIVE. */
    async resumeGuard(rule: RuleRecord): Promise<string | null> {
      if (!rule.authorizationId) return 'DELEGATED_AUTHORIZATION_REQUIRED';
      const a = await store.authorization(rule.owner, rule.authorizationId);
      return a?.state === 'ACTIVE' ? null : 'DELEGATED_AUTHORIZATION_REQUIRED';
    },
  };
}
/** A stable, non-identifying WebAuthn user handle for an owner (a digest, never the address itself). */
function manifestSafeId(owner: Owner): string {
  return '0x' + createHash('sha256').update(`flofi.passkey-user.v1:${owner.namespace}:${owner.address}`).digest('hex');
}
export type DelegationService = ReturnType<typeof createDelegationService>;
