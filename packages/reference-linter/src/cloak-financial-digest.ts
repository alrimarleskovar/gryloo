// SPDX-License-Identifier: AGPL-3.0-only
/** Browser hashes for Cloak's existing v1 financial artifacts. No signing or execution authority is granted here. */
import { Ajv } from 'ajv';
import { jsonIngress, sharedInvariants } from './artifact-digest.js';
import canonicalize from 'canonicalize';
import policySchema from '@defi-workflow-engine/workflow-contracts/schemas/v1/authorization-policy.schema.json' with { type: 'json' };
import manifestSchema from '@defi-workflow-engine/workflow-contracts/schemas/v1/strategy-manifest.schema.json' with { type: 'json' };
import planSchema from '@defi-workflow-engine/workflow-contracts/schemas/v1/execution-plan.schema.json' with { type: 'json' };
import journalSchema from '@defi-workflow-engine/workflow-contracts/schemas/v1/execution-journal.schema.json' with { type: 'json' };
import { assertTransition, type ExecutionJournal } from '@defi-workflow-engine/workflow-contracts';
type Kind = 'authorization-policy' | 'strategy-manifest' | 'execution-plan';
const ajv = new Ajv({ strict: true, allErrors: false });
const validators = { 'authorization-policy': ajv.compile(policySchema), 'strategy-manifest': ajv.compile(manifestSchema), 'execution-plan': ajv.compile(planSchema) };
const validateJournal = ajv.compile(journalSchema);
const fail = (): never => { throw new Error('CLOAK_FINANCIAL_ARTIFACT_INVALID'); };
const compare = (a: unknown, b: unknown): number => {
  const left = new TextEncoder().encode(canonicalize(a)!), right = new TextEncoder().encode(canonicalize(b)!);
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i]! - right[i]!;
  return left.length - right.length;
};
/** Frozen Node projectArtifact normalization and DWE-HASH framing; fail-closed schema ingress. */
export async function digestCloakFinancialArtifact(kind: Kind, input: unknown): Promise<string> {
  if (!Object.hasOwn(validators, kind)) fail(); jsonIngress(input);
  if (!validators[kind](input)) fail();
  const value = structuredClone(input) as Record<string, unknown>;
  sharedInvariants(value);
  // Narrow scope: fixed Cloak, Mode A, one independent step. This is not a new general financial compiler.
  if (kind !== 'execution-plan') {
    if ((value.providers as { kind: string; providerId?: string }).kind !== 'FIXED' ||
        (value.providers as { providerId?: string }).providerId !== 'cloak' ||
        (kind === 'strategy-manifest' ? value.authorizationMode : value.requiredAuthorizationClass) !== 'MODE_A' ||
        (kind === 'strategy-manifest' && value.executor !== null)) fail();
  } else {
    const segments = value.segments as { dependencies: string[]; steps: { dependencies: string[]; requiredAuthorizationClass: string; adapter: { id: string; version: string } }[] }[];
    if (segments.length !== 1 || segments[0]!.dependencies.length || segments[0]!.steps.length !== 1 ||
        segments[0]!.steps[0]!.dependencies.length || segments[0]!.steps[0]!.requiredAuthorizationClass !== 'MODE_A' ||
        segments[0]!.steps[0]!.adapter.id !== 'cloak.solana' || segments[0]!.steps[0]!.adapter.version !== '0.2.5') fail();
  }
  if (kind === 'authorization-policy') for (const members of Object.values(value.allowlists as Record<string, unknown[]>)) members.sort(compare);
  if (kind !== 'execution-plan') {
    const providers = value.providers as { kind: string; providerIds?: string[] };
    if (providers.kind === 'AUTHORIZED_SET') providers.providerIds!.sort();
  } else for (const segment of value.segments as { dependencies: string[]; steps: { dependencies: string[] }[] }[]) {
    segment.dependencies.sort(); for (const step of segment.steps) step.dependencies.sort();
  }
  // The closed frozen schemas include exactly the hash-covered fields; no self-hash/signature/extra keys are allowed.
  const data = new TextEncoder().encode(canonicalize(value)!);
  if (data.length > 1_048_576) fail();
  return frameHash(kind, data);
}
async function frameHash(kind: string, data: Uint8Array): Promise<string> {
  const domain = new TextEncoder().encode('defi-workflow-engine/' + kind), bytes = new Uint8Array(20 + domain.length + data.length);
  bytes.set(new TextEncoder().encode('DWE-HASH')); bytes[9] = 1;
  const view = new DataView(bytes.buffer); view.setUint16(10, domain.length, false); bytes.set(domain, 12);
  view.setBigUint64(12 + domain.length, BigInt(data.length), false); bytes.set(data, 20 + domain.length);
  return '0x' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}

/** Existing execution-journal-entry domain, identity/parent/transition checks and immutable hash links. */
export async function digestCloakJournal(input: ExecutionJournal): Promise<string[]> {
  jsonIngress(input); if (!validateJournal(input)) fail();
  const journal = structuredClone(input), hashes: string[] = [], states = new Map<string, string>();
  sharedInvariants(journal);
  const parents = new Map<string, string>(), attempts = new Set<string>(), ids = new Set<string>();
  for (let i = 0; i < journal.entries.length; i++) {
    const e = journal.entries[i]!;
    if (ids.has(e.entryId) || e.sequence !== i || e.workflowId !== journal.workflowId || e.previousEntryHash !== (hashes.at(-1) ?? null)) fail(); ids.add(e.entryId);
    if (e.level === 'workflow' && (e.entityId !== e.workflowId || e.segmentId !== null || e.stepId !== null || e.executionAttemptId !== null) ||
        e.level === 'segment' && (e.segmentId !== e.entityId || e.stepId !== null || e.executionAttemptId !== null) ||
        e.level === 'step' && (e.stepId !== e.entityId || e.segmentId === null || e.executionAttemptId !== null) ||
        e.level === 'attempt' && (e.executionAttemptId !== e.entityId || e.segmentId === null || e.stepId === null)) fail();
    const key = JSON.stringify([e.level, e.entityId]), parent = JSON.stringify([e.workflowId, e.segmentId, e.stepId]);
    if (parents.has(key) && parents.get(key) !== parent || e.fromState !== (states.get(key) ?? null)) fail();
    if (e.level === 'segment' && !states.has(JSON.stringify(['workflow', e.workflowId])) ||
        e.level === 'step' && !states.has(JSON.stringify(['segment', e.segmentId])) ||
        e.level === 'attempt' && !states.has(JSON.stringify(['step', e.stepId]))) fail();
    if (e.level === 'attempt' && e.fromState === null) { if (attempts.has(e.entityId)) fail(); attempts.add(e.entityId); }
    assertTransition(e.level, e.fromState, e.toState); states.set(key, e.toState); parents.set(key, parent);
    const data = new TextEncoder().encode(canonicalize({ schemaVersion: journal.schemaVersion, journalId: journal.journalId,
      workflowId: journal.workflowId, executionPlanHash: journal.executionPlanHash, manifestHash: journal.manifestHash, entry: e })!);
    hashes.push(await frameHash('execution-journal-entry', data));
  }
  return hashes;
}
