import { isDeepStrictEqual } from 'node:util';
import { assertTransition } from './state-transitions.js';
import { Ajv, type ValidateFunction } from 'ajv';
import { type Static } from '@sinclair/typebox';
import {
  deepFreeze, MAX_NATIVE_UNITS, type Asset,
} from './common.js';
import {
  SemanticWorkflowSchema, type SemanticWorkflow,
} from './semantic-workflow.js';
import { QuoteStateArtifactSchema } from './quote-state.js';
import { ArtifactSetSchema } from './artifact-set.js';
import { SimulationBundleSchema } from './simulation.js';
import { AuthorizationPolicySchema } from './authorization-policy.js';
import { StrategyManifestSchema } from './strategy-manifest.js';
import { ExecutionPlanSchema, type ExecutionPlan } from './execution-plan.js';
import {
  ExecutionJournalSchema, type ExecutionJournal,
} from './execution-journal.js';
import { EvidenceBundleSchema } from './evidence-bundle.js';
import { BRIDGE_ACTION, BRIDGE_SOURCE, BRIDGE_DESTINATION } from './bridge.js';
import { EnforcementMatrixSchema, type EnforcementMatrix } from './enforcement-matrix.js';

export {
  SemanticWorkflowSchema,
  QuoteStateArtifactSchema,
  ArtifactSetSchema,
  SimulationBundleSchema,
  AuthorizationPolicySchema,
  StrategyManifestSchema,
  ExecutionPlanSchema,
  ExecutionJournalSchema,
  EvidenceBundleSchema,
  EnforcementMatrixSchema,
};

export const artifactSchemas = deepFreeze({
  'semantic-workflow': SemanticWorkflowSchema,
  'quote-state-artifact': QuoteStateArtifactSchema,
  'artifact-set': ArtifactSetSchema,
  'simulation-bundle': SimulationBundleSchema,
  'authorization-policy': AuthorizationPolicySchema,
  'strategy-manifest': StrategyManifestSchema,
  'execution-plan': ExecutionPlanSchema,
  'execution-journal': ExecutionJournalSchema,
  'evidence-bundle': EvidenceBundleSchema,
  'enforcement-matrix': EnforcementMatrixSchema,
});
export type ArtifactKind = keyof typeof artifactSchemas;
export type ArtifactByKind = {
  [K in ArtifactKind]: Static<(typeof artifactSchemas)[K]>;
};

const ajv = new Ajv({
  strict: true,
  allErrors: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
  validateFormats: false,
  ownProperties: true,
});
const validators = new Map<ArtifactKind, ValidateFunction>();
for (const kind of Object.keys(artifactSchemas) as ArtifactKind[]) {
  validators.set(kind, ajv.compile(artifactSchemas[kind]));
}

function fail(message: string): never {
  throw new Error(`Invalid artifact: ${message}`);
}

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) fail(`duplicate ${label}`);
}

function assetKey(asset: Asset): string {
  return JSON.stringify([
    asset.chainId,
    'address' in asset ? 'address' : 'native',
    'address' in asset ? asset.address : asset.nativeId,
  ]);
}

function assertAcyclic(
  dependencies: ReadonlyMap<string, readonly string[]>,
  label: string,
): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) fail(`${label} contains a cycle`);
    if (visited.has(id)) return;
    const deps = dependencies.get(id);
    if (!deps) fail(`${label} references unknown id`);
    visiting.add(id);
    for (const dependency of deps) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of dependencies.keys()) visit(id);
}

function checkWorkflow(value: SemanticWorkflow): void {
  unique(value.nodes.map(n => n.nodeId), 'node ID');
  const nodes = new Map(value.nodes.map(n => [n.nodeId, n]));
  assertAcyclic(new Map(value.nodes.map(n => [n.nodeId, n.dependencies])), 'workflow');
  for (const node of value.nodes) {
    unique(node.inputs.map(input => input.name), 'input name');
    unique(node.expectedOutputs.map(output => output.outputId), 'output ID');
    unique(node.lockedParameters.map(parameter => parameter.name), 'locked parameter');
    unique(node.editableBounds.map(bound => bound.parameterName), 'editable bound');
    const locked = new Set(node.lockedParameters.map(parameter => parameter.name));
    for (const bound of node.editableBounds) {
      if (locked.has(bound.parameterName)) fail('parameter is both locked and editable');
      if (!node.inputs.some(input => input.name === bound.parameterName)) {
        fail('editable bound references unknown parameter');
      }
    }
    for (const lockedParameter of node.lockedParameters) {
      if (!node.inputs.some(input => input.name === lockedParameter.name)) {
        fail('locked parameter references unknown parameter');
      }
      const input = node.inputs.find(candidate => candidate.name === lockedParameter.name);
      if (!isDeepStrictEqual(input, lockedParameter)) fail('locked parameter value differs from input');
    }
    for (const input of node.inputs) {
      if (input.kind !== 'OUTPUT_REFERENCE') continue;
      const source = nodes.get(input.value.nodeId);
      if (!source || !source.expectedOutputs.some(
        output => output.outputId === input.value.outputId,
      )) fail('input references unknown output');
      if (!node.dependencies.includes(input.value.nodeId)) {
        fail('output reference must declare dependency');
      }
    }
    for (const output of node.expectedOutputs) {
      if (output.asset.chainId !== node.chainId
        && !(node.actionType === BRIDGE_ACTION && node.chainId === BRIDGE_SOURCE
          && (output.asset.chainId === BRIDGE_DESTINATION
            || (output.asset.chainId === 'eip155:42161'
              && node.adapterConstraints.adapters.length === 1
              && ['across.direct', 'lifi.rest'].includes(node.adapterConstraints.adapters[0]?.id ?? '')
              && node.adapterConstraints.protocols.length === 1
              && node.adapterConstraints.protocols[0] === (node.adapterConstraints.adapters[0]?.id === 'across.direct' ? 'across' : 'lifi'))))) {
        fail('expected output chain differs from node chain');
      }
    }
  }
  unique(value.resourceEdges.map(edge => JSON.stringify([
    edge.fromNodeId, edge.outputId, edge.toNodeId, edge.inputName,
  ])), 'resource edge');
  for (const edge of value.resourceEdges) {
    const source = nodes.get(edge.fromNodeId);
    const target = nodes.get(edge.toNodeId);
    if (!source || !target) fail('resource edge references unknown node');
    if (!source.expectedOutputs.some(output => output.outputId === edge.outputId)) {
      fail('resource edge references unknown output');
    }
    const input = target.inputs.find(candidate => candidate.name === edge.inputName);
    if (!input || input.kind !== 'OUTPUT_REFERENCE'
      || input.value.nodeId !== edge.fromNodeId
      || input.value.outputId !== edge.outputId) {
      fail('resource edge does not match target input reference');
    }
  }
}

function checkPlan(value: ExecutionPlan): void {
  unique(value.segments.map(segment => segment.segmentId), 'segment ID');
  assertAcyclic(new Map(value.segments.map(segment => [
    segment.segmentId, segment.dependencies,
  ])), 'segments');
  const steps = value.segments.flatMap(segment => segment.steps);
  unique(steps.map(step => step.stepId), 'step ID');
  assertAcyclic(new Map(steps.map(step => [
    step.stepId, step.dependencies,
  ])), 'steps');
  for (const segment of value.segments) {
    for (const step of segment.steps) {
      if (step.chainId !== segment.chainId) fail('step chain differs from segment chain');
    }
  }
}

function checkJournal(value: ExecutionJournal): void {
  unique(value.entries.map(entry => entry.entryId), 'journal entry ID');
  const preparedAttempts = new Set<string>();
  const lastStates = new Map<string, string>();
  const parents = new Map<string, string>();
  for (const [index, entry] of value.entries.entries()) {
    if (entry.sequence !== index) fail('journal sequence must start at zero and be contiguous');
    if ((index === 0) !== (entry.previousEntryHash === null)) {
      fail('journal previous-entry link presence is invalid');
    }
    if (entry.workflowId !== value.workflowId) fail('journal workflow mismatch');
    if (entry.level === 'workflow') {
      if (entry.entityId !== entry.workflowId
        || entry.segmentId !== null || entry.stepId !== null
        || entry.executionAttemptId !== null) fail('invalid workflow event identity');
    } else if (entry.level === 'segment') {
      if (entry.segmentId === null || entry.entityId !== entry.segmentId
        || entry.stepId !== null || entry.executionAttemptId !== null) {
        fail('invalid segment event identity');
      }
    } else if (entry.level === 'step') {
      if (entry.segmentId === null || entry.stepId === null
        || entry.entityId !== entry.stepId || entry.executionAttemptId !== null) {
        fail('invalid step event identity');
      }
    } else {
      if (entry.segmentId === null || entry.stepId === null
        || entry.executionAttemptId === null
        || entry.entityId !== entry.executionAttemptId) {
        fail('invalid attempt event identity');
      }
    }
    if (entry.toState === 'SUBMITTING') {
      if (entry.level !== 'attempt'
        || entry.executionAttemptId === null
        || !preparedAttempts.has(entry.executionAttemptId)) {
        fail('submission requires an earlier prepared attempt');
      }
    }
    if (entry.level === 'attempt' && entry.toState === 'PREPARED'
      && entry.executionAttemptId !== null) {
      preparedAttempts.add(entry.executionAttemptId);
    }
    assertTransition(entry.level, entry.fromState, entry.toState);
    const stateKey = JSON.stringify([entry.level, entry.entityId]);
    const parent = JSON.stringify([entry.workflowId, entry.segmentId, entry.stepId]);
    if (parents.has(stateKey) && parents.get(stateKey) !== parent) fail('journal entity reparented');
    if (entry.level === 'segment' && !lastStates.has(JSON.stringify(['workflow', entry.workflowId]))) fail('missing workflow parent');
    if (entry.level === 'step' && !lastStates.has(JSON.stringify(['segment', entry.segmentId]))) fail('missing segment parent');
    if (entry.level === 'attempt' && !lastStates.has(JSON.stringify(['step', entry.stepId]))) fail('missing step parent');
    parents.set(stateKey, parent);
    const priorState = lastStates.get(stateKey);
    if ((priorState ?? null) !== entry.fromState) fail('journal state history mismatch');
    lastStates.set(stateKey, entry.toState);
  }
}

function checkSharedInvariants(value: unknown, kind: ArtifactKind): void {
  const assetDecimals = new Map<string, number>();
  const walk = (current: unknown, key = ''): void => {
    if (typeof current === 'string') {
      if (kind === 'enforcement-matrix' && key === 'deadline') {
        if (BigInt(current) > MAX_NATIVE_UNITS) fail('deadline exceeds uint256 bound');
        return;
      }
      if (/^(?:amount|minimumAmount|maximumAmount|maximumPerStepAmount|maximumCumulativeAmount|nonce|minimumHealthFactorNumerator|minimumHealthFactorDenominator)$/.test(key)) {
        if (BigInt(current) > MAX_NATIVE_UNITS) fail(`${key} exceeds uint256 bound`);
      }
      if (/^(?:observedAt|expiresAt|retrievedAt|deadline|recordedAt)$/.test(key)) {
        const parsed = new Date(current);
        if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== current) {
          fail('invalid UTC timestamp');
        }
      }
      return;
    }
    if (current === null || typeof current !== 'object') return;
    if (Array.isArray(current)) {
      for (const item of current) walk(item);
      return;
    }
    const record = current as Record<string, unknown>;
    if (typeof record.chainId === 'string' && typeof record.decimals === 'number'
      && (typeof record.address === 'string' || typeof record.nativeId === 'string')) {
      const asset = record as Asset;
      const identity = assetKey(asset);
      const previous = assetDecimals.get(identity);
      if (previous !== undefined && previous !== asset.decimals) {
        fail('same asset has inconsistent decimals');
      }
      assetDecimals.set(identity, asset.decimals);
    }
    if (typeof record.minimumAmount === 'string'
      && typeof record.maximumAmount === 'string'
      && BigInt(record.minimumAmount) > BigInt(record.maximumAmount)) {
      fail('minimum amount exceeds maximum amount');
    }
    if (typeof record.maximumAmount === 'string'
      && typeof record.maximumPerStepAmount === 'string'
      && typeof record.maximumCumulativeAmount === 'string') {
      if (BigInt(record.maximumPerStepAmount) > BigInt(record.maximumAmount)
        || BigInt(record.maximumAmount) > BigInt(record.maximumCumulativeAmount)) {
        fail('spend limits are inconsistent');
      }
    }
    if (typeof record.observedAt === 'string' && typeof record.expiresAt === 'string'
      && record.observedAt > record.expiresAt) {
      fail('freshness expires before observation');
    }
    for (const [childKey, child] of Object.entries(record)) walk(child, childKey);
  };
  walk(value);
}

export function validateArtifact<K extends ArtifactKind>(
  kind: K,
  value: unknown,
): ArtifactByKind[K] {
  const validator = validators.get(kind);
  if (!validator) fail('unknown artifact kind');
  if (!validator(value)) {
    fail(ajv.errorsText(validator.errors, { separator: '; ' }));
  }
  checkSharedInvariants(value, kind);
  if (kind === 'semantic-workflow') checkWorkflow(value as SemanticWorkflow);
  if (kind === 'execution-plan') checkPlan(value as ExecutionPlan);
  if (kind === 'execution-journal') checkJournal(value as ExecutionJournal);
  if (kind === 'artifact-set') {
    const set = value as ArtifactByKind['artifact-set'];
    unique(set.artifacts.map(artifact => artifact.artifactId), 'artifact ID');
    unique(set.artifacts.map(artifact => artifact.artifactHash), 'artifact hash');
  }
  if (kind === 'enforcement-matrix') {
    const matrix = value as EnforcementMatrix;
    unique(matrix.payloads.map(payload => payload.stepId), 'matrix step ID');
    unique(matrix.payloads.map(payload => payload.payloadHash), 'matrix payload hash');
    unique(matrix.limits.map(limit => limit.limitId), 'matrix limit ID');
    const steps = new Set(matrix.payloads.map(payload => payload.stepId));
    for (const payload of matrix.payloads) {
      if ((payload.arguments.kind === 'APPROVE') !== (payload.functionId === '0x095ea7b3')) fail('matrix approve selector mismatch');
      if ((payload.arguments.kind === 'EXACT_INPUT_SINGLE') !== (payload.functionId === '0x5ae401dc')) fail('matrix swap selector mismatch');
      if (BigInt(payload.maxPriorityFeePerGas) > BigInt(payload.maxFeePerGas)) fail('matrix priority fee exceeds max fee');
    }
    for (const limit of matrix.limits) {
      unique(limit.payloadBindings.map(binding => JSON.stringify([binding.stepId, binding.field])), 'matrix payload binding');
      for (const binding of limit.payloadBindings) if (!steps.has(binding.stepId)) fail('matrix binding references unknown step');
    }
  }
  if (kind === 'evidence-bundle') {
    const evidence = value as ArtifactByKind['evidence-bundle'];
    if ((evidence.version === 1) !== (evidence.supersedes === null)) {
      fail('evidence supersession is inconsistent with version');
    }
    unique(evidence.evidence.map(item => item.evidenceId), 'evidence ID');
  }
  return value as ArtifactByKind[K];
}
