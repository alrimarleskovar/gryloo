// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: an automation occurrence on FloFi's ONE approval model (`src/platform`, migrations 0006 and 0010). The rule is a
 * first-class `AUTOMATION_RULE` requester — never an owner, never authority — that brings only what the shared model asks of a surface:
 *
 *   requester     `{ kind: AUTOMATION_RULE, ref: <rule id>, context: { owner, occurrenceId } }`
 *   link scheme   `flofi_auhs_` + 256 bits, digested with the automation key (HKDF of FLOFI_AUTOMATION_SECRET); only the digest is stored
 *   rules         15-minute window, at most 3 open requests and 30 per hour per rule, no automatic supersession (the owner's reopen
 *                 withdraws the previous handoff of the occurrence itself)
 *   claim policy  only the automation OWNER's proven wallet may claim, and only while the rule is ACTIVE with no attention flag and the
 *                 occurrence is still open with exactly this handoff
 *
 * The approval link is minted only when the owner — in their own FloFi session — opens an occurrence; no scheduler, notification or
 * channel message ever carries one. Claiming it is the start of FloFi's unchanged flow: the re-composed strategy must reproduce its
 * workflow hash, then the owner runs a fresh simulation, reviews the Strategy Manifest, approves and signs with their own wallet.
 */
import { approvalLinkScheme, HANDOFF_SECONDS, type ApprovalContributor, type ApprovalLinkScheme, type ApprovalRequester, type ClaimPolicy, type HandoffRules,
  type RequesterScope, type WalletRef } from '../platform/index.ts';
import type { AutomationConfig, AutomationKeys } from './config.ts';
import { readAutomationConfig } from './config.ts';
import { AUTOMATION_LINK_PREFIX } from './link-format.ts';
import { createPgAutomationStore } from './pg-store.ts';
import type { AutomationStore, OccurrenceRecord, Owner, RuleRecord } from './store.ts';

type Env = Readonly<Record<string, string | undefined>>;
export const AUTOMATION_APPROVAL_PREFIX = AUTOMATION_LINK_PREFIX;
export const AUTOMATION_CLIENT_ID = 'flofi-automations';
export const AUTOMATION_DISPLAY_NAME = 'FloFi Automations';
export const AUTOMATION_HANDOFF_RULES: HandoffRules = Object.freeze({ handoffSeconds: HANDOFF_SECONDS, maxPending: 3, rate: Object.freeze([30, 3_600] as const),
  supersedeSameWorkflow: false });
export const automationApprovalScheme = (keys: AutomationKeys): ApprovalLinkScheme => approvalLinkScheme(AUTOMATION_APPROVAL_PREFIX, keys.approval, ['AUTOMATION_RULE']);
export const ruleScope = (ruleId: string): RequesterScope => ({ kind: 'AUTOMATION_RULE', ref: ruleId });
/** The requester of one occurrence's approval: the rule; its owner and occurrence are immutable, non-secret claim context. */
export function automationRequester(rule: RuleRecord, occurrence: OccurrenceRecord): ApprovalRequester {
  return { kind: 'AUTOMATION_RULE', ref: rule.ruleId, clientId: AUTOMATION_CLIENT_ID, displayName: AUTOMATION_DISPLAY_NAME,
    context: { owner: { namespace: rule.owner.namespace, address: rule.owner.address }, occurrenceId: occurrence.occurrenceId } };
}
export const sameOwner = (owner: Owner | WalletRef | undefined, wallet: WalletRef) => !!owner && owner.namespace === wallet.namespace
  && (wallet.namespace === 'eip155' ? owner.address.toLowerCase() === wallet.address.toLowerCase() : owner.address === wallet.address);

/** The automation claim rule (see the module comment), read from the handoff's immutable context and the durable rule and occurrence. */
export function automationClaimPolicy(store: Pick<AutomationStore, 'ruleById' | 'occurrenceById'>, now: () => Date = () => new Date()): ClaimPolicy {
  return async (handoff, wallet) => {
    const context = handoff.requesterContext as { owner?: Owner; occurrenceId?: unknown };
    if (!sameOwner(context.owner, wallet)) return { ok: false, code: 'AUTOMATION_OWNER_MISMATCH' };
    const occurrence = typeof context.occurrenceId === 'string' ? await store.occurrenceById(context.occurrenceId) : null;
    if (!occurrence || occurrence.ruleId !== handoff.requesterRef || occurrence.handoffId !== handoff.handoffId || !sameOwner(occurrence.owner, wallet))
      return { ok: false, code: 'AUTOMATION_OCCURRENCE_NOT_OPEN' };
    if (occurrence.state !== 'APPROVAL_CREATED' || occurrence.expiresAt <= now()) return { ok: false, code: 'AUTOMATION_OCCURRENCE_NOT_OPEN' };
    const rule = await store.ruleById(occurrence.ruleId);
    if (!rule || !sameOwner(rule.owner, wallet)) return { ok: false, code: 'AUTOMATION_OWNER_MISMATCH' };
    if (rule.state !== 'ACTIVE') return { ok: false, code: rule.state === 'PAUSED' ? 'AUTOMATION_PAUSED' : `AUTOMATION_${rule.state}` };
    if (rule.attention) return { ok: false, code: `AUTOMATION_${rule.attention}` };
    if (rule.expiresAt && rule.expiresAt <= now()) return { ok: false, code: 'AUTOMATION_EXPIRED' };
    return { ok: true };
  };
}

/** Automations' contribution to /approve, or null while they are not enabled on this deployment. No viewer requester: sharing stays the owner's choice. */
export function automationApprovalContributor(env: Env, config: AutomationConfig | null = null): ApprovalContributor | null {
  const resolved = config ?? readAutomationConfig(env);
  if (!resolved.enabled) return null;
  return host => ({ scheme: automationApprovalScheme(resolved.keys),
    profiles: { AUTOMATION_RULE: { policy: resolved.policy, claimPolicy: automationClaimPolicy(createPgAutomationStore(host.db, host.tenantId)) } } });
}
