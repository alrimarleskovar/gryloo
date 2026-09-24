// SPDX-License-Identifier: AGPL-3.0-only
import { Ajv, type ValidateFunction } from 'ajv';
import canonicalize from 'canonicalize';
import workflowSchema from '@defi-workflow-engine/workflow-contracts/schemas/v1/semantic-workflow.schema.json' with { type: 'json' };
import quoteSchema from '@defi-workflow-engine/workflow-contracts/schemas/v1/quote-state-artifact.schema.json' with { type: 'json' };
import setSchema from '@defi-workflow-engine/workflow-contracts/schemas/v1/artifact-set.schema.json' with { type: 'json' };
import simulationSchema from '@defi-workflow-engine/workflow-contracts/schemas/v1/simulation-bundle.schema.json' with { type: 'json' };

/**
 * Browser-safe DWE-HASH v1 digests for the four BUILD-003B artifact kinds and
 * the raw-response domain. It mirrors the frozen Node implementation and may
 * only be stricter. There is deliberately no payload, intent, policy,
 * manifest, plan, journal or evidence domain.
 */
export type DigestKind = 'semantic-workflow' | 'quote-state-artifact' | 'artifact-set' | 'simulation-bundle';

const DOMAINS: Readonly<Record<DigestKind | 'raw-response', string>> = Object.freeze({
  'semantic-workflow': 'defi-workflow-engine/semantic-workflow',
  'quote-state-artifact': 'defi-workflow-engine/quote-state-artifact',
  'artifact-set': 'defi-workflow-engine/artifact-set',
  'simulation-bundle': 'defi-workflow-engine/simulation-bundle',
  'raw-response': 'defi-workflow-engine/raw-response',
});

/** Explicit projections; tests prove each equals the frozen schema properties. */
export const DIGEST_FIELDS: Readonly<Record<DigestKind, readonly string[]>> = Object.freeze({
  'semantic-workflow': Object.freeze(['schemaVersion', 'workflowId', 'revision', 'nodes', 'resourceEdges']),
  'quote-state-artifact': Object.freeze(['schemaVersion', 'artifactId', 'semanticWorkflowHash', 'nodeId', 'sourceId', 'adapter', 'chainId', 'chainPosition', 'retrievedAt', 'freshness', 'rawResponseHash', 'normalizedValues', 'providerReference', 'proposedContracts', 'proposedSpenders', 'proposedRecipients', 'fees', 'gas', 'outputBounds', 'uncertainty', 'registryValidation']),
  'artifact-set': Object.freeze(['schemaVersion', 'artifactSetId', 'semanticWorkflowHash', 'artifacts']),
  'simulation-bundle': Object.freeze(['schemaVersion', 'simulationId', 'semanticWorkflowRevision', 'semanticWorkflowHash', 'artifactSetHash', 'adapters', 'contracts', 'outputs', 'propagatedOutputs', 'failurePaths', 'uncertainty', 'unsupportedAssumptions', 'freshness']),
});

/** Same numeric bounds as the frozen raw-byte ingress profile. */
const LIMITS = Object.freeze({ bytes: 1_048_576, depth: 64, objectKeys: 16_384, keyCodeUnits: 512, tokens: 131_072 });
const MAX_NATIVE_UNITS = (1n << 256n) - 1n;

const ajv = new Ajv({
  strict: true, allErrors: true, coerceTypes: false, useDefaults: false,
  removeAdditional: false, validateFormats: false, ownProperties: true,
});
const validators: Readonly<Record<DigestKind, ValidateFunction>> = Object.freeze({
  'semantic-workflow': ajv.compile(workflowSchema),
  'quote-state-artifact': ajv.compile(quoteSchema),
  'artifact-set': ajv.compile(setSchema),
  'simulation-bundle': ajv.compile(simulationSchema),
});

function fail(code: string): never { throw new Error(code); }

const encoder = new TextEncoder();

/**
 * Bounded JSON-value ingress over an already constructed value. Depth, token,
 * key and compact-byte counts equal what the frozen raw parser would count for
 * the compact serialization, so anything that parser rejects is rejected here.
 */
function jsonIngress(value: unknown): void {
  const seen = new Set<object>();
  let bytes = 0, tokens = 0, keys = 0;
  const add = (size: number) => {
    bytes += size;
    if (bytes > LIMITS.bytes) fail('INPUT_SIZE');
  };
  const token = (count = 1) => {
    tokens += count;
    if (tokens > LIMITS.tokens) fail('TOKEN_LIMIT');
  };
  const string = (text: string) => {
    if (text.length > LIMITS.bytes) fail('INPUT_SIZE');
    if (!text.isWellFormed()) fail('UNPAIRED_SURROGATE');
    add(encoder.encode(JSON.stringify(text)).length);
  };
  const visit = (item: unknown, containers: number): void => {
    if (item === null) { token(); add(4); return; }
    if (typeof item === 'boolean') { token(); add(item ? 4 : 5); return; }
    if (typeof item === 'number') {
      if (!Number.isSafeInteger(item)) fail('UNSAFE_NUMBER');
      token(); add(String(item === 0 ? 0 : item).length); return;
    }
    if (typeof item === 'string') { token(); string(item); return; }
    if (typeof item !== 'object') fail('MALFORMED_OBJECT');
    if (containers + 1 > LIMITS.depth) fail('DEPTH_LIMIT');
    if (seen.has(item)) fail('CYCLIC_OBJECT');
    seen.add(item);
    if (Array.isArray(item)) {
      if (Object.getPrototypeOf(item) !== Array.prototype
          || Reflect.ownKeys(item).length !== item.length + 1) fail('MALFORMED_ARRAY');
      token(2 + Math.max(0, item.length - 1)); add(2 + Math.max(0, item.length - 1));
      for (let index = 0; index < item.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) fail('MALFORMED_ARRAY');
        visit(descriptor.value, containers + 1);
      }
    } else {
      if (Object.getPrototypeOf(item) !== Object.prototype) fail('MALFORMED_OBJECT');
      const names = Reflect.ownKeys(item);
      token(2 + Math.max(0, names.length - 1)); add(2 + Math.max(0, names.length - 1));
      for (const name of names) {
        if (typeof name !== 'string') fail('MALFORMED_OBJECT');
        const descriptor = Object.getOwnPropertyDescriptor(item, name);
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) fail('MALFORMED_OBJECT');
        if (name.length > LIMITS.keyCodeUnits) fail('KEY_SIZE');
        if (++keys > LIMITS.objectKeys) fail('KEY_LIMIT');
        token(2); string(name); add(1);
        visit(descriptor.value, containers + 1);
      }
    }
    seen.delete(item);
  };
  visit(value, 0);
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalize(left) === canonicalize(right);
}

/** Port of the frozen shared invariants, including their exact key coverage. */
function sharedInvariants(value: unknown): void {
  const decimals = new Map<string, number>();
  const walk = (current: unknown, key = ''): void => {
    if (typeof current === 'string') {
      if (/^(?:amount|minimumAmount|maximumAmount|maximumPerStepAmount|maximumCumulativeAmount|nonce|minimumHealthFactorNumerator|minimumHealthFactorDenominator)$/.test(key)) {
        let units: bigint;
        try { units = BigInt(current); } catch { fail('INVARIANT_INVALID'); }
        if (units > MAX_NATIVE_UNITS) fail('INVARIANT_INVALID');
      }
      if (/^(?:observedAt|expiresAt|retrievedAt|deadline|recordedAt)$/.test(key)) {
        const parsed = new Date(current);
        if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== current) fail('INVARIANT_INVALID');
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
      const identity = JSON.stringify([record.chainId, typeof record.address === 'string' ? 'address' : 'native',
        typeof record.address === 'string' ? record.address : record.nativeId]);
      const previous = decimals.get(identity);
      if (previous !== undefined && previous !== record.decimals) fail('INVARIANT_INVALID');
      decimals.set(identity, record.decimals);
    }
    if (typeof record.minimumAmount === 'string' && typeof record.maximumAmount === 'string'
        && BigInt(record.minimumAmount) > BigInt(record.maximumAmount)) fail('INVARIANT_INVALID');
    if (typeof record.maximumAmount === 'string' && typeof record.maximumPerStepAmount === 'string'
        && typeof record.maximumCumulativeAmount === 'string'
        && (BigInt(record.maximumPerStepAmount) > BigInt(record.maximumAmount)
          || BigInt(record.maximumAmount) > BigInt(record.maximumCumulativeAmount))) fail('INVARIANT_INVALID');
    if (typeof record.observedAt === 'string' && typeof record.expiresAt === 'string'
        && record.observedAt > record.expiresAt) fail('INVARIANT_INVALID');
    for (const [childKey, child] of Object.entries(record)) walk(child, childKey);
  };
  walk(value);
}

type Node = {
  nodeId: string; dependencies: string[]; chainId: string;
  inputs: { name: string; kind: string; value: unknown }[];
  expectedOutputs: { outputId: string; asset: { chainId: string } }[];
  lockedParameters: { name: string }[]; editableBounds: { parameterName: string }[];
};
type Workflow = { nodes: Node[]; resourceEdges: { fromNodeId: string; outputId: string; toNodeId: string; inputName: string }[] };

function unique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) fail('INVARIANT_INVALID');
}

/** Port of the frozen whole-workflow semantic checks. */
function workflowInvariants(workflow: Workflow): void {
  unique(workflow.nodes.map(node => node.nodeId));
  const nodes = new Map(workflow.nodes.map(node => [node.nodeId, node]));
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) fail('INVARIANT_INVALID');
    if (visited.has(id)) return;
    const node = nodes.get(id);
    if (!node) fail('INVARIANT_INVALID');
    visiting.add(id);
    for (const dependency of node.dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of nodes.keys()) visit(id);
  for (const node of workflow.nodes) {
    unique(node.inputs.map(input => input.name));
    unique(node.expectedOutputs.map(output => output.outputId));
    unique(node.lockedParameters.map(parameter => parameter.name));
    unique(node.editableBounds.map(bound => bound.parameterName));
    const locked = new Set(node.lockedParameters.map(parameter => parameter.name));
    for (const bound of node.editableBounds) {
      if (locked.has(bound.parameterName) || !node.inputs.some(input => input.name === bound.parameterName)) fail('INVARIANT_INVALID');
    }
    for (const parameter of node.lockedParameters) {
      const input = node.inputs.find(candidate => candidate.name === parameter.name);
      if (!input || !sameJson(input, parameter)) fail('INVARIANT_INVALID');
    }
    for (const input of node.inputs) {
      if (input.kind !== 'OUTPUT_REFERENCE') continue;
      const reference = input.value as { nodeId: string; outputId: string };
      const source = nodes.get(reference.nodeId);
      if (!source || !source.expectedOutputs.some(output => output.outputId === reference.outputId)
          || !node.dependencies.includes(reference.nodeId)) fail('INVARIANT_INVALID');
    }
    for (const output of node.expectedOutputs) if (output.asset.chainId !== node.chainId) fail('INVARIANT_INVALID');
  }
  unique(workflow.resourceEdges.map(edge => JSON.stringify([edge.fromNodeId, edge.outputId, edge.toNodeId, edge.inputName])));
  for (const edge of workflow.resourceEdges) {
    const source = nodes.get(edge.fromNodeId), target = nodes.get(edge.toNodeId);
    if (!source || !target || !source.expectedOutputs.some(output => output.outputId === edge.outputId)) fail('INVARIANT_INVALID');
    const input = target.inputs.find(candidate => candidate.name === edge.inputName);
    const reference = input?.value as { nodeId?: string; outputId?: string } | undefined;
    if (!input || input.kind !== 'OUTPUT_REFERENCE' || reference?.nodeId !== edge.fromNodeId
        || reference.outputId !== edge.outputId) fail('INVARIANT_INVALID');
  }
}

function isDigestKind(kind: unknown): kind is DigestKind {
  return typeof kind === 'string' && Object.hasOwn(DIGEST_FIELDS, kind);
}

/** Bounded ingress, closed schema and frozen invariants; never mutates input. */
export function validateDigestInput(kind: DigestKind, value: unknown): void {
  if (!isDigestKind(kind)) fail('UNSUPPORTED_DIGEST_KIND');
  jsonIngress(value);
  if (!validators[kind](value)) fail('SCHEMA_INVALID');
  sharedInvariants(value);
  if (kind === 'semantic-workflow') workflowInvariants(value as Workflow);
  if (kind === 'artifact-set') {
    const artifacts = (value as { artifacts: { artifactId: string; artifactHash: string }[] }).artifacts;
    unique(artifacts.map(artifact => artifact.artifactId));
    unique(artifacts.map(artifact => artifact.artifactHash));
  }
}

const ascii = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
function bytesCompare(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) if (left[index] !== right[index]) return left[index]! - right[index]!;
  return left.length - right.length;
}
const jsonCompare = (left: unknown, right: unknown) =>
  bytesCompare(encoder.encode(canonicalize(left) ?? ''), encoder.encode(canonicalize(right) ?? ''));

function project(kind: DigestKind, input: unknown): Record<string, unknown> {
  const value = structuredClone(input) as Record<string, unknown>;
  if (kind === 'semantic-workflow') {
    const workflow = value as unknown as Workflow & { nodes: (Node & { requiredCapabilities: string[]; adapterConstraints: { protocols: string[]; adapters: unknown[] } })[] };
    workflow.nodes.sort((a, b) => ascii(a.nodeId, b.nodeId));
    workflow.resourceEdges.sort((a, b) => jsonCompare([a.fromNodeId, a.outputId, a.toNodeId, a.inputName], [b.fromNodeId, b.outputId, b.toNodeId, b.inputName]));
    for (const node of workflow.nodes) {
      node.dependencies.sort(ascii);
      node.requiredCapabilities.sort(ascii);
      node.adapterConstraints.protocols.sort(ascii);
      node.adapterConstraints.adapters.sort(jsonCompare);
      node.inputs.sort((a, b) => ascii(a.name, b.name));
      node.expectedOutputs.sort((a, b) => ascii(a.outputId, b.outputId));
      node.lockedParameters.sort((a, b) => ascii(a.name, b.name));
      node.editableBounds.sort((a, b) => ascii(a.parameterName, b.parameterName));
    }
  }
  if (kind === 'artifact-set') {
    // Fixed-length lowercase hex: string order equals the frozen byte order.
    (value.artifacts as { artifactHash: string }[]).sort((a, b) => ascii(a.artifactHash, b.artifactHash));
  }
  const selected: Record<string, unknown> = {};
  for (const field of DIGEST_FIELDS[kind]) selected[field] = value[field];
  return selected;
}

async function framedDigest(domainKind: DigestKind | 'raw-response', data: Uint8Array): Promise<string> {
  if (data.byteLength > LIMITS.bytes) fail('INPUT_SIZE');
  const domain = encoder.encode(DOMAINS[domainKind]);
  const preimage = new Uint8Array(12 + domain.length + 8 + data.length);
  preimage.set(encoder.encode('DWE-HASH'), 0);
  preimage[8] = 0;
  preimage[9] = 1;
  const view = new DataView(preimage.buffer);
  view.setUint16(10, domain.length, false);
  preimage.set(domain, 12);
  view.setBigUint64(12 + domain.length, BigInt(data.byteLength), false);
  preimage.set(data, 20 + domain.length);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') fail('DIGEST_UNAVAILABLE');
  let digest: ArrayBuffer;
  try { digest = await subtle.digest('SHA-256', preimage); } catch { fail('DIGEST_UNAVAILABLE'); }
  const bytes = new Uint8Array(digest);
  if (bytes.length !== 32) fail('DIGEST_UNAVAILABLE');
  return '0x' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Structured digest; equals frozen hashArtifactBytes for every accepted input. */
export async function digestArtifact(kind: DigestKind, value: unknown): Promise<string> {
  if (!isDigestKind(kind)) fail('UNSUPPORTED_DIGEST_KIND');
  validateDigestInput(kind, value);
  const text = canonicalize(project(kind, value));
  if (typeof text !== 'string') fail('SCHEMA_INVALID');
  return framedDigest(kind, encoder.encode(text));
}

/** Raw-response digest; equals frozen hashRawBytes('raw-response', bytes). */
export async function digestRawResponse(bytes: Uint8Array): Promise<string> {
  if (!(bytes instanceof Uint8Array)) fail('INPUT_SIZE');
  return framedDigest('raw-response', bytes);
}

/** Frozen v1 semantic-workflow hash vector used by the self-check. */
const SELF_CHECK_DIGEST = '0xb0446d65c8341fecbbd5e8bf3f3c75c540064d13c296099361d3a3e57dd0c918';
const selfCheckValue = () => ({
  schemaVersion: '1.0.0', workflowId: 'workflow-001', revision: 0,
  nodes: [{
    nodeId: 'node-001', actionType: 'swap', actionSchemaVersion: '1.0.0', chainId: 'eip155:1',
    requiredCapabilities: [], adapterConstraints: { adapters: [], protocols: [] }, inputs: [],
    expectedOutputs: [], dependencies: [], userConstraints: [], failurePolicy: 'ABORT',
    requiredAuthorizationClass: 'NONE', lockedParameters: [], editableBounds: [],
  }],
  resourceEdges: [],
});

/**
 * Runs before every generation and review. A pass is never cached: a missing,
 * throwing or wrong digest fails closed with DIGEST_UNAVAILABLE.
 */
export async function digestSelfCheck(): Promise<void> {
  let actual: string;
  try { actual = await digestArtifact('semantic-workflow', selfCheckValue()); }
  catch { fail('DIGEST_UNAVAILABLE'); }
  if (actual !== SELF_CHECK_DIGEST) fail('DIGEST_UNAVAILABLE');
}
