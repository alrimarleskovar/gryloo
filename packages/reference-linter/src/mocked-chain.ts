// SPDX-License-Identifier: AGPL-3.0-only
import canonicalize from 'canonicalize';
import type { ArtifactSet, QuoteStateArtifact, SemanticWorkflow, SimulationBundle } from '@defi-workflow-engine/workflow-contracts';
import { assetSymbol, createReviewContext, hasKeys, isRecord, type ReviewContext, type Symbol } from './context.js';
import { validateAuthoringWorkflow } from './validation.js';
import { lintWorkflow, type ReviewFinding } from './rules.js';
import { digestArtifact, digestRawResponse, digestSelfCheck, validateDigestInput, type DigestKind } from './artifact-digest.js';

const SWAP = 'asset.swap.exact-input';
const UINT256 = (1n << 256n) - 1n;
const VALIDITY_SECONDS = 60;

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * The BUILD-003B mocked chain profile. Values are synthetic fixture data, not
 * market data, and every marker below is carried in hashed artifact fields.
 */
export const MOCKED_CHAIN_PROFILE = freeze({
  environment: 'MOCKED',
  idPrefix: 'MOCKED',
  sourceId: 'mock.synthetic-fixture',
  adapter: { id: 'mock.fixture-quote', version: '1.0.0' },
  fixtureId: 'build-003b.synthetic-rate.v1',
  rateLabel: 'synthetic rate 1 WETH = 1,000 USDC',
  rate: { WETH: '1000000000000000000', USDC: '1000000000' },
  validitySeconds: VALIDITY_SECONDS,
  maximumEligibleSlippageBps: 300,
  chainPosition: { kind: 'BLOCK', height: 0 },
  registryValidation: { registryVersion: '1.0.0', actionType: SWAP, result: 'CONTRACT_VALIDATED', enforcement: 'NOT_ENFORCED' },
  quoteUncertainty: [
    { code: 'MOCKED_SYNTHETIC_DATA', description: 'MOCKED: synthetic fixture data. Not a live quote and not a financial simulation.' },
    { code: 'SYNTHETIC_RATE', description: 'Fixed synthetic rate 1 WETH = 1,000 USDC in both directions, with no spread. Not market data.' },
    { code: 'NO_CHAIN_STATE_READ', description: 'Block height 0 is a sentinel. No RPC, balance, allowance or pool state was read.' },
    { code: 'GAS_NOT_MODELED', description: 'Gas is not modeled.' },
    { code: 'FEES_NOT_MODELED', description: 'Protocol, pool and platform fees are not modeled.' },
    { code: 'PRICE_IMPACT_NOT_MODELED', description: 'Price impact, liquidity and MEV are not modeled.' },
  ],
  mockNodesUncertainty: { code: 'MOCK_NODES_EXCLUDED', description: 'Mock actions have no financial meaning and are not simulated.' },
  notes: [
    'MOCKED synthetic fixture; not a live quote and not a financial simulation.',
    'No RPC, balance, allowance, pool, gas, fee, price-impact, liquidity or MEV state is read or modeled.',
    'Adverse equals the slippage minimum; any output below it is modeled as a revert that retains the input.',
  ],
  mockNodesNote: 'Mock nodes have no financial meaning and are not simulated.',
} as const);

export interface MockedArtifactChain {
  readonly quotes: readonly QuoteStateArtifact[];
  readonly artifactSet: ArtifactSet;
  readonly simulation: SimulationBundle;
}
export interface MockedSwapOutputs { readonly expected: string; readonly minimum: string; readonly adverse: string }
export interface ChainReview {
  readonly revision: number;
  readonly generation: number;
  readonly semanticWorkflowHash: string;
  readonly quoteHashes: Readonly<Record<string, string>>;
  readonly artifactSetHash: string;
  readonly simulationHash: string;
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly status: 'CURRENT' | 'INVALIDATED' | 'EXPIRED';
  readonly findings: readonly ReviewFinding[];
  readonly environment: 'MOCKED';
  readonly executable: false;
  readonly authorization: 'NONE';
  readonly enforcement: 'NOT_ENFORCED';
}

function fail(code: string): never { throw new Error(code); }
const same = (left: unknown, right: unknown) => canonicalize(left) === canonicalize(right);

/** Canonical fixture bytes; their raw-response digest is each quote's rawResponseHash. */
export function mockedFixtureBytes(context: unknown): Uint8Array {
  const trusted = createReviewContext(context);
  return new TextEncoder().encode(canonicalize({
    fixtureId: MOCKED_CHAIN_PROFILE.fixtureId,
    version: '1.0.0',
    environment: MOCKED_CHAIN_PROFILE.environment,
    rate: {
      base: { asset: trusted.assets.WETH.asset, amount: MOCKED_CHAIN_PROFILE.rate.WETH },
      quote: { asset: trusted.assets.USDC.asset, amount: MOCKED_CHAIN_PROFILE.rate.USDC },
    },
    note: 'Synthetic BUILD-003B fixture. Not market data.',
  }) ?? fail('FIXTURE_INVALID'));
}

/**
 * Exact integer arithmetic in native units. Conversion and minimum both round
 * down; the minimum is computed from the rounded expected value; adverse equals
 * the minimum. Amounts never pass through floating point.
 */
export function mockedSwapOutputs(input: unknown, context: unknown): MockedSwapOutputs {
  const trusted = createReviewContext(context);
  if (!isRecord(input) || !hasKeys(input, ['amountIn', 'from', 'to', 'slippageBps'])) fail('INVALID_ARITHMETIC_INPUT');
  const { amountIn, from, to, slippageBps } = input;
  if ((from !== 'USDC' && from !== 'WETH') || (to !== 'USDC' && to !== 'WETH') || from === to) fail('INVALID_ASSET_PAIR');
  if (typeof amountIn !== 'string' || !/^[1-9][0-9]{0,77}$/.test(amountIn)) fail('INVALID_AMOUNT');
  const units = BigInt(amountIn);
  if (units > BigInt(trusted.assets[from].maximumAmountUnits) || units > UINT256) fail('AMOUNT_OUT_OF_RANGE');
  if (typeof slippageBps !== 'number' || !Number.isSafeInteger(slippageBps) || slippageBps < 0
      || slippageBps > MOCKED_CHAIN_PROFILE.maximumEligibleSlippageBps) fail('SLIPPAGE_NOT_ELIGIBLE');
  const expected = units * BigInt(MOCKED_CHAIN_PROFILE.rate[to]) / BigInt(MOCKED_CHAIN_PROFILE.rate[from]);
  const minimum = expected * BigInt(10_000 - slippageBps) / 10_000n;
  if (expected > UINT256) fail('AMOUNT_OUT_OF_RANGE');
  return Object.freeze({ expected: expected.toString(), minimum: minimum.toString(), adverse: minimum.toString() });
}

function validated(kind: DigestKind, value: unknown, code: string): void {
  try { validateDigestInput(kind, value); } catch { fail(code); }
}

type WorkflowNode = SemanticWorkflow['nodes'][number];
type Quantity = { asset: { chainId: string; address?: string; nativeId?: string; decimals: number }; amount: string };

interface SwapFacts { node: WorkflowNode; from: Symbol; to: Symbol; amountIn: Quantity; bps: number; outputs: MockedSwapOutputs }

function swapFacts(node: WorkflowNode, context: ReviewContext): SwapFacts {
  const amount = node.inputs.find(input => input.name === 'amount-in');
  const assetOut = node.inputs.find(input => input.name === 'asset-out');
  const slippage = node.userConstraints.filter(constraint => constraint.kind === 'MAXIMUM_SLIPPAGE_BPS');
  if (amount?.kind !== 'QUANTITY' || assetOut?.kind !== 'ASSET' || slippage.length !== 1
      || slippage[0]?.kind !== 'MAXIMUM_SLIPPAGE_BPS') fail('SOURCE_WORKFLOW_NOT_ELIGIBLE');
  const from = assetSymbol(amount.value.asset, context), to = assetSymbol(assetOut.value, context);
  if (!from || !to || from === to) fail('SOURCE_WORKFLOW_NOT_ELIGIBLE');
  const bps = slippage[0].maximumBps;
  let outputs: MockedSwapOutputs;
  try { outputs = mockedSwapOutputs({ amountIn: amount.value.amount, from, to, slippageBps: bps }, context); }
  catch { fail('SOURCE_WORKFLOW_NOT_ELIGIBLE'); }
  return { node, from, to, amountIn: amount.value as Quantity, bps, outputs };
}

const ID = /^MOCKED\.(quote\.(.+)|artifact-set|simulation)\.r(0|[1-9][0-9]*)\.g([1-9][0-9]*)$/;
function parseId(id: string): { kind: string; nodeId: string | null; revision: number; generation: number } {
  const match = ID.exec(id);
  if (!match) fail('NODE_COVERAGE_MISMATCH');
  const revision = Number(match[3]), generation = Number(match[4]);
  if (!Number.isSafeInteger(revision) || !Number.isSafeInteger(generation)) fail('NODE_COVERAGE_MISMATCH');
  return { kind: match[2] === undefined ? match[1]! : 'quote', nodeId: match[2] ?? null, revision, generation };
}

/**
 * Deterministic application review of one mocked chain. It recomputes every
 * cross-artifact reference with the self-checked digest and fails closed on
 * tampering or mislinking. It is not an enforcement boundary and never makes
 * anything executable.
 */
export async function reviewMockedArtifactChain(input: unknown, context: unknown): Promise<ChainReview> {
  const trusted = createReviewContext(context);
  await digestSelfCheck();
  if (!isRecord(input) || !hasKeys(input, ['chain', 'sourceWorkflow', 'currentWorkflow', 'nowMs'])
      || typeof input.nowMs !== 'number' || !Number.isSafeInteger(input.nowMs) || input.nowMs < 0) fail('MALFORMED_ARTIFACT_CHAIN');
  const { chain, nowMs } = input;
  if (!isRecord(chain) || !hasKeys(chain, ['quotes', 'artifactSet', 'simulation']) || !Array.isArray(chain.quotes)
      || chain.quotes.length === 0 || chain.quotes.length > 1024) fail('MALFORMED_ARTIFACT_CHAIN');

  let source: SemanticWorkflow;
  try { source = validateAuthoringWorkflow(input.sourceWorkflow, trusted); } catch { fail('SOURCE_WORKFLOW_NOT_ELIGIBLE'); }
  if (lintWorkflow(source, trusted).findings.some(finding => finding.severity === 'BLOCK'
      && finding.code !== 'UNQUOTED_EXECUTION_UNAVAILABLE')) fail('SOURCE_WORKFLOW_NOT_ELIGIBLE');
  const swaps = source.nodes.filter(node => node.actionType === SWAP)
    .sort((a, b) => a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0).map(node => swapFacts(node, trusted));
  if (swaps.length === 0) fail('SOURCE_WORKFLOW_NOT_ELIGIBLE');
  const hasMockNodes = source.nodes.some(node => node.actionType !== SWAP);

  for (const quote of chain.quotes) validated('quote-state-artifact', quote, 'INVALID_QUOTE_STATE_ARTIFACT');
  validated('artifact-set', chain.artifactSet, 'INVALID_ARTIFACT_SET');
  validated('simulation-bundle', chain.simulation, 'INVALID_SIMULATION_BUNDLE');
  const quotes = chain.quotes as QuoteStateArtifact[];
  const set = chain.artifactSet as ArtifactSet;
  const simulation = chain.simulation as SimulationBundle;

  // Coverage, revision binding and generation consistency.
  if (quotes.length !== swaps.length || quotes.some((quote, index) => quote.nodeId !== swaps[index]!.node.nodeId)) fail('NODE_COVERAGE_MISMATCH');
  const ids = [...quotes.map(quote => parseId(quote.artifactId)), parseId(set.artifactSetId), parseId(simulation.simulationId)];
  if (ids.slice(0, quotes.length).some((id, index) => id.kind !== 'quote' || id.nodeId !== quotes[index]!.nodeId)
      || ids.at(-2)?.kind !== 'artifact-set' || ids.at(-1)?.kind !== 'simulation') fail('NODE_COVERAGE_MISMATCH');
  if (simulation.semanticWorkflowRevision !== source.revision || ids.some(id => id.revision !== source.revision)) fail('REVISION_LINK_MISMATCH');
  const generation = ids[0]!.generation;
  if (ids.some(id => id.generation !== generation)) fail('NODE_COVERAGE_MISMATCH');

  // Freshness: one 60-second window shared by every artifact.
  const freshness = quotes[0]!.freshness;
  const observedMs = Date.parse(freshness.observedAt), expiresMs = Date.parse(freshness.expiresAt);
  if (!Number.isFinite(observedMs) || new Date(observedMs).toISOString() !== freshness.observedAt
      || expiresMs !== observedMs + VALIDITY_SECONDS * 1000 || freshness.maximumAgeSeconds !== VALIDITY_SECONDS
      || quotes.some(quote => !same(quote.freshness, freshness) || quote.retrievedAt !== freshness.observedAt)
      || !same(simulation.freshness, freshness)) fail('FRESHNESS_INVALID');

  // Per-quote profile.
  for (const [index, quote] of quotes.entries()) {
    const facts = swaps[index]!;
    const values = quote.normalizedValues;
    if (values.length !== 5 || !same(values[0], { name: 'evidence-environment', kind: 'IDENTIFIER', value: MOCKED_CHAIN_PROFILE.environment })
        || !same(values[1], { name: 'fixture-id', kind: 'IDENTIFIER', value: MOCKED_CHAIN_PROFILE.fixtureId })
        || !same(quote.chainPosition, MOCKED_CHAIN_PROFILE.chainPosition)
        || !same(quote.uncertainty, MOCKED_CHAIN_PROFILE.quoteUncertainty)
        || !same(quote.registryValidation, MOCKED_CHAIN_PROFILE.registryValidation)) fail('MOCK_MARKER_REQUIRED');
    if (quote.sourceId !== MOCKED_CHAIN_PROFILE.sourceId || !same(quote.adapter, MOCKED_CHAIN_PROFILE.adapter)
        || !same(quote.providerReference, { kind: 'NONE' })) fail('LIVE_SOURCE_NOT_APPROVED');
    if (quote.proposedContracts.length || quote.proposedSpenders.length || quote.proposedRecipients.length) fail('AUTHORITY_FIELDS_FORBIDDEN');
    if (quote.fees.length || quote.gas.length) fail('UNMODELED_VALUE_FORBIDDEN');
    if (quote.chainId !== facts.node.chainId) fail('ASSET_MISMATCH');
    const input = values[2]!;
    if (input.name !== 'amount-in' || input.kind !== 'QUANTITY' || !same(input.value.asset, facts.amountIn.asset)) fail('ASSET_MISMATCH');
    if (input.value.amount !== facts.amountIn.amount) fail('OUTPUT_MISMATCH');
    if (!same(values[3], { name: 'rate-base', kind: 'QUANTITY', value: { asset: trusted.assets.WETH.asset, amount: MOCKED_CHAIN_PROFILE.rate.WETH } })
        || !same(values[4], { name: 'rate-quote', kind: 'QUANTITY', value: { asset: trusted.assets.USDC.asset, amount: MOCKED_CHAIN_PROFILE.rate.USDC } })) fail('OUTPUT_MISMATCH');
    const outputAsset = trusted.assets[facts.to].asset;
    const bound = quote.outputBounds[0];
    if (quote.outputBounds.length !== 1 || bound?.outputId !== 'amount-out') fail('OUTPUT_MISMATCH');
    if (![bound.expected, bound.minimum, bound.adverse].every(quantity => same(quantity.asset, outputAsset))) fail('ASSET_MISMATCH');
    if (bound.expected.amount !== facts.outputs.expected || bound.minimum.amount !== facts.outputs.minimum
        || bound.adverse.amount !== facts.outputs.adverse) fail('OUTPUT_MISMATCH');
  }

  // Artifact Set and Simulation Bundle profile.
  if (set.artifacts.length !== quotes.length || set.artifacts.some((entry, index) =>
    entry.artifactId !== quotes[index]!.artifactId || entry.nodeId !== quotes[index]!.nodeId)) fail('NODE_COVERAGE_MISMATCH');
  if (!same(simulation.adapters, [MOCKED_CHAIN_PROFILE.adapter])) fail('LIVE_SOURCE_NOT_APPROVED');
  if (simulation.contracts.length) fail('AUTHORITY_FIELDS_FORBIDDEN');
  if (simulation.outputs.length !== swaps.length || simulation.outputs.some((output, index) => output.nodeId !== swaps[index]!.node.nodeId)) fail('NODE_COVERAGE_MISMATCH');
  if (simulation.outputs.some((output, index) => !same(output, {
    nodeId: swaps[index]!.node.nodeId, outputId: 'amount-out',
    expected: quotes[index]!.outputBounds[0]!.expected, minimum: quotes[index]!.outputBounds[0]!.minimum,
    adverse: quotes[index]!.outputBounds[0]!.adverse,
  }))) fail('OUTPUT_MISMATCH');
  if (simulation.propagatedOutputs.length) fail('UNSUPPORTED_PROPAGATION');
  if (!same(simulation.failurePaths, swaps.map(facts => ({
    failedNodeId: facts.node.nodeId, blockedNodeIds: [], residualAssets: [facts.amountIn],
  })))) fail('FAILURE_PATH_MISMATCH');
  if (!same(simulation.uncertainty, [...MOCKED_CHAIN_PROFILE.quoteUncertainty, ...(hasMockNodes ? [MOCKED_CHAIN_PROFILE.mockNodesUncertainty] : [])])
      || !same(simulation.unsupportedAssumptions, [...MOCKED_CHAIN_PROFILE.notes, ...(hasMockNodes ? [MOCKED_CHAIN_PROFILE.mockNodesNote] : [])])) fail('MOCK_MARKER_REQUIRED');

  // Cross-artifact hash references, recomputed with the self-checked digest.
  const semanticWorkflowHash = await digestArtifact('semantic-workflow', source);
  const rawResponseHash = await digestRawResponse(mockedFixtureBytes(trusted));
  const quoteHashes: Record<string, string> = {};
  for (const [index, quote] of quotes.entries()) {
    if (quote.semanticWorkflowHash !== semanticWorkflowHash || quote.rawResponseHash !== rawResponseHash) fail('HASH_LINK_MISMATCH');
    const digest = await digestArtifact('quote-state-artifact', quote);
    if (set.artifacts[index]!.artifactHash !== digest) fail('HASH_LINK_MISMATCH');
    quoteHashes[quote.nodeId] = digest;
  }
  if (set.semanticWorkflowHash !== semanticWorkflowHash || simulation.semanticWorkflowHash !== semanticWorkflowHash) fail('HASH_LINK_MISMATCH');
  const artifactSetHash = await digestArtifact('artifact-set', set);
  if (simulation.artifactSetHash !== artifactSetHash) fail('HASH_LINK_MISMATCH');
  const simulationHash = await digestArtifact('simulation-bundle', simulation);

  // Findings: always non-executable; stale, expired and zero outputs block.
  const findings: ReviewFinding[] = [{ code: 'MOCKED_ARTIFACTS_NOT_EXECUTABLE', severity: 'BLOCK', nodeId: 'artifact-chain', field: 'chain', message: 'Mocked artifacts are synthetic and can never authorize or enable execution.' }];
  let currentHash: string | null;
  try { currentHash = await digestArtifact('semantic-workflow', input.currentWorkflow); } catch { currentHash = null; }
  const invalidated = currentHash !== semanticWorkflowHash || !isRecord(input.currentWorkflow)
    || input.currentWorkflow.revision !== source.revision;
  if (invalidated) findings.push({ code: 'ARTIFACTS_INVALIDATED_BY_SEMANTIC_EDIT', severity: 'BLOCK', nodeId: 'artifact-chain', field: 'semanticWorkflowHash', message: 'The workflow changed after generation. Generate new mocked artifacts.' });
  const expired = nowMs >= expiresMs || nowMs < observedMs;
  if (expired) findings.push({ code: 'ARTIFACTS_EXPIRED', severity: 'BLOCK', nodeId: 'artifact-chain', field: 'freshness', message: 'The 60-second mock validity window has ended or the clock moved backwards.' });
  for (const facts of swaps) {
    if (facts.outputs.expected === '0' || facts.outputs.minimum === '0') findings.push({ code: 'MOCKED_OUTPUT_ZERO', severity: 'BLOCK', nodeId: facts.node.nodeId, field: 'amount-out', message: 'The mocked output rounds down to zero native units.' });
  }
  findings.sort((a, b) => a.nodeId.localeCompare(b.nodeId) || a.field.localeCompare(b.field) || a.code.localeCompare(b.code));
  return freeze({
    revision: source.revision, generation, semanticWorkflowHash, quoteHashes, artifactSetHash, simulationHash,
    observedAt: freshness.observedAt, expiresAt: freshness.expiresAt,
    status: invalidated ? 'INVALIDATED' : expired ? 'EXPIRED' : 'CURRENT',
    findings, environment: 'MOCKED', executable: false, authorization: 'NONE', enforcement: 'NOT_ENFORCED',
  });
}
