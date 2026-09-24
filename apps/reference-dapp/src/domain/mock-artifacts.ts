// SPDX-License-Identifier: AGPL-3.0-only
import type { ArtifactSet, QuoteStateArtifact, SimulationBundle } from '@defi-workflow-engine/workflow-contracts';
import {
  MOCKED_CHAIN_PROFILE, digestArtifact, digestRawResponse, digestSelfCheck, lintWorkflow, mockedFixtureBytes,
  mockedSwapOutputs, reviewMockedArtifactChain,
  type ChainReview, type MockedArtifactChain, type ReviewContext,
} from '@defi-workflow-engine/reference-linter';
import type { Workflow } from './initial-workflow';
import { SWAP_ACTION, swapDetails } from './swap-authoring';

/** Local, synthetic generation. No network, wallet or chain state is involved. */
export type Eligibility = { readonly eligible: true } | { readonly eligible: false; readonly reason: string };

export function generationEligibility(workflow: Workflow, context: ReviewContext): Eligibility {
  if (!workflow.nodes.some(node => node.actionType === SWAP_ACTION)) {
    return { eligible: false, reason: 'Add a Base swap in Build before generating mocked artifacts.' };
  }
  let findings;
  try { findings = lintWorkflow(workflow, context).findings; }
  catch (cause) {
    return { eligible: false, reason: `Workflow review failed (${cause instanceof Error ? cause.message : 'INVALID_WORKFLOW'}). Fix the workflow in Build first.` };
  }
  const block = findings.find(finding => finding.severity === 'BLOCK' && finding.code !== 'UNQUOTED_EXECUTION_UNAVAILABLE');
  if (block) return { eligible: false, reason: `${block.code} on ${block.nodeId} blocks generation. Resolve it in Build first.` };
  return { eligible: true };
}

export interface GeneratedChain { readonly chain: MockedArtifactChain; readonly review: ChainReview }

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Builds one MOCKED Quote/State Artifact per swap node, the Artifact Set and
 * the Simulation Bundle for exactly this IR revision, then has the linter
 * review recompute every link. The self-check runs before anything is built.
 */
export async function generateMockedChain(
  workflow: Workflow, context: ReviewContext, options: { readonly nowMs: number; readonly generation: number },
): Promise<GeneratedChain> {
  await digestSelfCheck();
  const { nowMs, generation } = options;
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !Number.isSafeInteger(generation) || generation < 1) throw new Error('INVALID_GENERATION_INPUT');
  const eligibility = generationEligibility(workflow, context);
  if (!eligibility.eligible) throw new Error('GENERATION_NOT_ELIGIBLE');
  const prefix = MOCKED_CHAIN_PROFILE.idPrefix, suffix = `r${workflow.revision}.g${generation}`;
  const freshness = {
    observedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + MOCKED_CHAIN_PROFILE.validitySeconds * 1000).toISOString(),
    maximumAgeSeconds: MOCKED_CHAIN_PROFILE.validitySeconds,
  };
  const semanticWorkflowHash = await digestArtifact('semantic-workflow', workflow);
  const rawResponseHash = await digestRawResponse(mockedFixtureBytes(context));
  const swaps = workflow.nodes.filter(node => node.actionType === SWAP_ACTION)
    .sort((a, b) => a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0);
  const hasMockNodes = workflow.nodes.some(node => node.actionType !== SWAP_ACTION);

  const facts = swaps.map(node => {
    const details = swapDetails(node, context);
    const amountIn = node.inputs.find(input => input.name === 'amount-in');
    if (!details || details.slippage === null || amountIn?.kind !== 'QUANTITY') throw new Error('INVALID_SWAP_NODE');
    const outputs = mockedSwapOutputs({ amountIn: details.units, from: details.from, to: details.to, slippageBps: details.slippage }, context);
    return { node, details, amountIn: { asset: { ...amountIn.value.asset }, amount: amountIn.value.amount }, outputs };
  });
  const quotes: QuoteStateArtifact[] = facts.map(({ node, details, amountIn, outputs }) => {
    const output = { ...context.assets[details.to].asset };
    return {
      schemaVersion: '1.0.0',
      artifactId: `${prefix}.quote.${node.nodeId}.${suffix}`,
      semanticWorkflowHash,
      nodeId: node.nodeId,
      sourceId: MOCKED_CHAIN_PROFILE.sourceId,
      adapter: { ...MOCKED_CHAIN_PROFILE.adapter },
      chainId: node.chainId,
      chainPosition: { ...MOCKED_CHAIN_PROFILE.chainPosition },
      retrievedAt: freshness.observedAt,
      freshness: { ...freshness },
      rawResponseHash,
      normalizedValues: [
        { name: 'evidence-environment', kind: 'IDENTIFIER', value: MOCKED_CHAIN_PROFILE.environment },
        { name: 'fixture-id', kind: 'IDENTIFIER', value: MOCKED_CHAIN_PROFILE.fixtureId },
        { name: 'amount-in', kind: 'QUANTITY', value: { asset: { ...amountIn.asset }, amount: amountIn.amount } },
        { name: 'rate-base', kind: 'QUANTITY', value: { asset: { ...context.assets.WETH.asset }, amount: MOCKED_CHAIN_PROFILE.rate.WETH } },
        { name: 'rate-quote', kind: 'QUANTITY', value: { asset: { ...context.assets.USDC.asset }, amount: MOCKED_CHAIN_PROFILE.rate.USDC } },
      ],
      providerReference: { kind: 'NONE' },
      proposedContracts: [], proposedSpenders: [], proposedRecipients: [], fees: [], gas: [],
      outputBounds: [{
        outputId: 'amount-out',
        expected: { asset: { ...output }, amount: outputs.expected },
        minimum: { asset: { ...output }, amount: outputs.minimum },
        adverse: { asset: { ...output }, amount: outputs.adverse },
      }],
      uncertainty: MOCKED_CHAIN_PROFILE.quoteUncertainty.map(entry => ({ ...entry })),
      registryValidation: { ...MOCKED_CHAIN_PROFILE.registryValidation },
    };
  });
  const quoteHashes = await Promise.all(quotes.map(quote => digestArtifact('quote-state-artifact', quote)));
  const artifactSet: ArtifactSet = {
    schemaVersion: '1.0.0',
    artifactSetId: `${prefix}.artifact-set.${suffix}`,
    semanticWorkflowHash,
    artifacts: quotes.map((quote, index) => ({ artifactId: quote.artifactId, nodeId: quote.nodeId, artifactHash: quoteHashes[index]! })),
  };
  const simulation: SimulationBundle = {
    schemaVersion: '1.0.0',
    simulationId: `${prefix}.simulation.${suffix}`,
    semanticWorkflowRevision: workflow.revision,
    semanticWorkflowHash,
    artifactSetHash: await digestArtifact('artifact-set', artifactSet),
    adapters: [{ ...MOCKED_CHAIN_PROFILE.adapter }],
    contracts: [],
    outputs: quotes.map(quote => ({
      nodeId: quote.nodeId, outputId: 'amount-out',
      expected: quote.outputBounds[0]!.expected, minimum: quote.outputBounds[0]!.minimum, adverse: quote.outputBounds[0]!.adverse,
    })),
    propagatedOutputs: [],
    failurePaths: facts.map(({ node, amountIn }) => ({ failedNodeId: node.nodeId, blockedNodeIds: [], residualAssets: [amountIn] })),
    uncertainty: [...MOCKED_CHAIN_PROFILE.quoteUncertainty, ...(hasMockNodes ? [MOCKED_CHAIN_PROFILE.mockNodesUncertainty] : [])].map(entry => ({ ...entry })),
    unsupportedAssumptions: [...MOCKED_CHAIN_PROFILE.notes, ...(hasMockNodes ? [MOCKED_CHAIN_PROFILE.mockNodesNote] : [])],
    freshness: { ...freshness },
  };
  const chain = freeze({ quotes, artifactSet, simulation });
  const review = await reviewMockedArtifactChain({ chain, sourceWorkflow: workflow, currentWorkflow: workflow, nowMs }, context);
  if (review.status !== 'CURRENT') throw new Error('GENERATED_CHAIN_NOT_CURRENT');
  return freeze({ chain, review });
}
