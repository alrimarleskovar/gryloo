import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';
import { validateArtifact, type ArtifactKind, type ArtifactByKind } from './schemas.js';
import type { ExecutionJournal } from './execution-journal.js';

export const HASH_DOMAINS = Object.freeze({
  'semantic-workflow': 'defi-workflow-engine/semantic-workflow',
  'quote-state-artifact': 'defi-workflow-engine/quote-state-artifact',
  'artifact-set': 'defi-workflow-engine/artifact-set',
  'simulation-bundle': 'defi-workflow-engine/simulation-bundle',
  'authorization-policy': 'defi-workflow-engine/authorization-policy',
  'strategy-manifest': 'defi-workflow-engine/strategy-manifest',
  'execution-plan': 'defi-workflow-engine/execution-plan',
  'enforcement-matrix': 'defi-workflow-engine/enforcement-matrix',
  'execution-journal-entry': 'defi-workflow-engine/execution-journal-entry',
  'evidence-bundle': 'defi-workflow-engine/evidence-bundle',
  'raw-response': 'defi-workflow-engine/raw-response',
  payload: 'defi-workflow-engine/payload',
  intent: 'defi-workflow-engine/intent',
  'mode-b-permission': 'defi-workflow-engine/mode-b-permission/v2',
} as const);
export type HashKind = keyof typeof HASH_DOMAINS;
export type StructuredHashKind = Exclude<ArtifactKind, 'execution-journal'>;
export type RawHashKind = 'raw-response' | 'payload' | 'intent';

export const HASH_FIELDS = Object.freeze({
  'semantic-workflow': ['schemaVersion', 'workflowId', 'revision', 'nodes', 'resourceEdges'],
  'quote-state-artifact': ['schemaVersion', 'artifactId', 'semanticWorkflowHash', 'nodeId', 'sourceId', 'adapter', 'chainId', 'chainPosition', 'retrievedAt', 'freshness', 'rawResponseHash', 'normalizedValues', 'providerReference', 'proposedContracts', 'proposedSpenders', 'proposedRecipients', 'fees', 'gas', 'outputBounds', 'uncertainty', 'registryValidation'],
  'artifact-set': ['schemaVersion', 'artifactSetId', 'semanticWorkflowHash', 'artifacts'],
  'simulation-bundle': ['schemaVersion', 'simulationId', 'semanticWorkflowRevision', 'semanticWorkflowHash', 'artifactSetHash', 'adapters', 'contracts', 'outputs', 'propagatedOutputs', 'failurePaths', 'uncertainty', 'unsupportedAssumptions', 'freshness'],
  'authorization-policy': ['schemaVersion', 'policyId', 'semanticWorkflowHash', 'artifactSetHash', 'simulationHash', 'requiredAuthorizationClass', 'allowlists', 'budgetReservation', 'spendLimits', 'maximumSlippageBps', 'gasBudgets', 'feeBudgets', 'oracleRules', 'accountRiskRules', 'checkpointRules', 'providers', 'nonce', 'deadline', 'revocationEpoch', 'recovery', 'enforcement'],
  'strategy-manifest': ['schemaVersion', 'manifestId', 'semanticWorkflowRevision', 'semanticWorkflowHash', 'artifactSetHash', 'simulationHash', 'policyHash', 'authorizationMode', 'owner', 'executor', 'expiresAt', 'nonce', 'revocationEpoch', 'spendLimits', 'maximumSlippageBps', 'gasBudgets', 'feeBudgets', 'providers', 'recovery', 'enforcement'],
  'execution-plan': ['schemaVersion', 'executionPlanId', 'semanticWorkflowHash', 'manifestHash', 'segments', 'checkpointIds', 'enforcement'],
  'enforcement-matrix': ['schemaVersion', 'enforcementMatrixId', 'semanticWorkflowHash', 'artifactSetHash', 'simulationHash', 'policyHash', 'manifestHash', 'executionPlanHash', 'authorizationMode', 'environment', 'payloads', 'limits', 'limitations'],
  'evidence-bundle': ['schemaVersion', 'evidenceBundleId', 'version', 'supersedes', 'semanticWorkflowHash', 'artifactSetHash', 'simulationHash', 'policyHash', 'manifestHash', 'executionPlanHash', 'journalHeadHash', 'observedAt', 'environment', 'outcome', 'receipts', 'differences', 'reconciliation', 'evidence'],
} satisfies Record<StructuredHashKind, readonly string[]>);
for (const fields of Object.values(HASH_FIELDS)) Object.freeze(fields);

function assertJson(value: unknown, seen = new Set<object>(), depth = 0): void {
  if (depth > 64) throw new Error('Canonical nesting limit');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (!value.isWellFormed()) throw new Error('Unpaired surrogate');
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Nonfinite JSON number');
    return;
  }
  if (typeof value !== 'object') throw new Error('Non-JSON value');
  if (seen.has(value)) throw new Error('Cyclic JSON value');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) throw new Error('Non-JSON object');
  if (Object.getOwnPropertySymbols(value).length) throw new Error('Symbol property');
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw new Error('Sparse or extended array');
    for (let index = 0; index < value.length; index++) {
      const property = Object.getOwnPropertyDescriptor(value, String(index));
      if (!property || !('value' in property)) throw new Error('Non-data array property');
      assertJson(property.value, seen, depth + 1);
    }
  } else {
    for (const [key, property] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!key.isWellFormed()) throw new Error('Unpaired surrogate key');
      if (!property.enumerable || !('value' in property)) throw new Error('Non-data JSON property');
      assertJson(property.value, seen, depth + 1);
    }
  }
  seen.delete(value);
}

/** Internal general JCS helper; artifact byte ingress has stricter integer rules. */
export function canonicalJson(value: unknown): string {
  assertJson(value);
  const result = canonicalize(value);
  if (typeof result !== 'string') throw new Error('Canonicalization produced no JSON');
  return result;
}

/** Protocol framing is independently testable without JavaScript JSON behavior. */
export function hashPreimage(kind: HashKind, data: Uint8Array): Uint8Array {
  if (!Object.hasOwn(HASH_DOMAINS, kind)) throw new Error('Unknown hash domain');
  if (!(data instanceof Uint8Array) || data.byteLength > 1_048_576) throw new Error('Hash input size');
  const domain = new TextEncoder().encode(HASH_DOMAINS[kind]);
  if (domain.length > 0xffff) throw new Error('Hash domain length');
  const bytes = new Uint8Array(12 + domain.length + 8 + data.length);
  bytes.set(new TextEncoder().encode('DWE-HASH'), 0);
  bytes[8] = 0;
  bytes[9] = kind === 'mode-b-permission' ? 2 : 1;
  const view = new DataView(bytes.buffer);
  view.setUint16(10, domain.length, false);
  bytes.set(domain, 12);
  view.setBigUint64(12 + domain.length, BigInt(data.byteLength), false);
  bytes.set(data, 20 + domain.length);
  return bytes;
}

export function hashData(kind: HashKind, data: Uint8Array): string {
  return '0x' + createHash('sha256').update(hashPreimage(kind, data)).digest('hex');
}

export function hashRawBytes(kind: RawHashKind, data: Uint8Array): string {
  if (!['raw-response', 'payload', 'intent'].includes(kind)) throw new Error('Not a raw hash domain');
  return hashData(kind, data);
}

const compareAscii = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const compareJson = (left: unknown, right: unknown): number =>
  Buffer.compare(Buffer.from(canonicalJson(left), 'utf8'), Buffer.from(canonicalJson(right), 'utf8'));

export function projectArtifact<K extends StructuredHashKind>(kind: K, input: unknown): ArtifactByKind[K] {
  // Validate JSON shape before invoking either Ajv or structuredClone on objects.
  assertJson(input);
  const value = structuredClone(validateArtifact(kind, input));
  if (kind === 'semantic-workflow') {
    const workflow = value as ArtifactByKind['semantic-workflow'];
    workflow.nodes.sort((a, b) => compareAscii(a.nodeId, b.nodeId));
    workflow.resourceEdges.sort((a, b) => compareJson(
      [a.fromNodeId, a.outputId, a.toNodeId, a.inputName],
      [b.fromNodeId, b.outputId, b.toNodeId, b.inputName],
    ));
    for (const node of workflow.nodes) {
      node.dependencies.sort(compareAscii);
      node.requiredCapabilities.sort(compareAscii);
      node.adapterConstraints.protocols.sort(compareAscii);
      node.adapterConstraints.adapters.sort(compareJson);
      node.inputs.sort((a, b) => compareAscii(a.name, b.name));
      node.expectedOutputs.sort((a, b) => compareAscii(a.outputId, b.outputId));
      node.lockedParameters.sort((a, b) => compareAscii(a.name, b.name));
      node.editableBounds.sort((a, b) => compareAscii(a.parameterName, b.parameterName));
    }
  }
  if (kind === 'artifact-set') {
    (value as ArtifactByKind['artifact-set']).artifacts.sort((a, b) =>
      Buffer.compare(Buffer.from(a.artifactHash.slice(2), 'hex'), Buffer.from(b.artifactHash.slice(2), 'hex')));
  }
  if (kind === 'authorization-policy') {
    const policy = value as ArtifactByKind['authorization-policy'];
    for (const members of Object.values(policy.allowlists)) members.sort(compareJson);
  }
  if (kind === 'authorization-policy' || kind === 'strategy-manifest') {
    const { providers } = value as ArtifactByKind['authorization-policy' | 'strategy-manifest'];
    if (providers.kind === 'AUTHORIZED_SET') providers.providerIds.sort(compareAscii);
  }
  if (kind === 'execution-plan') {
    for (const segment of (value as ArtifactByKind['execution-plan']).segments) {
      segment.dependencies.sort(compareAscii);
      for (const step of segment.steps) step.dependencies.sort(compareAscii);
    }
  }
  if (kind === 'enforcement-matrix') {
    const matrix = value as ArtifactByKind['enforcement-matrix'];
    matrix.payloads.sort((a, b) => compareAscii(a.stepId, b.stepId));
    matrix.limits.sort((a, b) => compareAscii(a.limitId, b.limitId));
    for (const limit of matrix.limits) {
      limit.locations.sort(compareAscii);
      limit.payloadBindings.sort((a, b) => compareJson([a.stepId, a.field], [b.stepId, b.field]));
    }
    matrix.limitations.sort(compareAscii);
  }
  // Field coverage is explicit. Unknown/self-hash/signature/runtime properties
  // have already failed closed-object validation and are never silently omitted.
  const selected: Record<string, unknown> = {};
  for (const field of HASH_FIELDS[kind]) selected[field] = (value as Record<string, unknown>)[field];
  return selected as ArtifactByKind[K];
}

export function hashArtifactValue<K extends StructuredHashKind>(kind: K, value: unknown): string {
  return hashData(kind, new TextEncoder().encode(canonicalJson(projectArtifact(kind, value))));
}

export function projectJournalEntry(journal: ExecutionJournal, index: number): unknown {
  const entry = journal.entries[index];
  if (!entry) throw new Error('Unknown journal entry');
  return {
    schemaVersion: journal.schemaVersion,
    journalId: journal.journalId,
    workflowId: journal.workflowId,
    executionPlanHash: journal.executionPlanHash,
    manifestHash: journal.manifestHash,
    entry,
  };
}

/** Checks hash links in addition to schema, identity, ordering and transitions. */
export function hashJournalEntries(input: unknown): readonly string[] {
  assertJson(input);
  const journal = validateArtifact('execution-journal', input);
  const result: string[] = [];
  for (const [index, entry] of journal.entries.entries()) {
    const previous = index === 0 ? null : result[index - 1];
    if (entry.previousEntryHash !== previous) throw new Error('Journal predecessor hash mismatch');
    result.push(hashData('execution-journal-entry', new TextEncoder().encode(canonicalJson(projectJournalEntry(journal, index)))));
  }
  return Object.freeze(result);
}

/** The v2 binding is separate from every frozen v1 artifact domain. */
export function hashModeBPermission(value: unknown): string {
  assertJson(value);
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('MODE_B_PERMISSION_INVALID');
  const fields = ['format','chainId','safe','roles','owner','rolesOwner','threshold','executor','roleKey','router','selector','callData','tokenIn','tokenOut','recipient','amountIn','amountOutMinimum','cumulativeBudget','allowanceKey','deadline','safeCodeHash','rolesCodeHash','semanticWorkflowHash','quoteHash','simulationHash','sourceBlockHash','revocationMethod'] as const;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join() !== [...fields].sort().join() || record.format !== 'gryloo.mode-b-permission.v1' || record.chainId !== 31337 || record.threshold !== 1 || record.rolesOwner !== record.safe) throw new Error('MODE_B_PERMISSION_INVALID');
  for (const field of ['safe','roles','owner','rolesOwner','executor','router','tokenIn','tokenOut','recipient'] as const) if (typeof record[field] !== 'string' || !/^0x[0-9a-f]{40}$/.test(record[field])) throw new Error('MODE_B_PERMISSION_INVALID');
  for (const field of ['roleKey','allowanceKey','safeCodeHash','rolesCodeHash','semanticWorkflowHash','quoteHash','simulationHash','sourceBlockHash'] as const) if (typeof record[field] !== 'string' || !/^0x[0-9a-f]{64}$/.test(record[field])) throw new Error('MODE_B_PERMISSION_INVALID');
  if (record.selector !== '0x5ae401dc' || typeof record.callData !== 'string' || !/^0x(?:[0-9a-f]{2})+$/.test(record.callData)) throw new Error('MODE_B_PERMISSION_INVALID');
  for (const field of ['amountIn','amountOutMinimum','cumulativeBudget','deadline'] as const) if (typeof record[field] !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(record[field])) throw new Error('MODE_B_PERMISSION_INVALID');
  if (BigInt(record.amountIn as string) <= 0n || BigInt(record.cumulativeBudget as string) !== BigInt(record.amountIn as string) || record.revocationMethod !== 'ROLES_REMOVE_AND_SAFE_DISABLE') throw new Error('MODE_B_PERMISSION_INVALID');
  return hashData('mode-b-permission', new TextEncoder().encode(canonicalJson(record)));
}
