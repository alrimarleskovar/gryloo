// SPDX-License-Identifier: AGPL-3.0-only
/** Shared artifact/Manifest compiler for an already normalized LI.FI or direct Across bridge. */
import { hashArtifactBytes, hashRawBytes, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
import { ARBITRUM_LIQUIDITY, type PoolState } from './liquidity.js';
import { planCrossChainPreparation, type CrossChainCosts } from './cross-chain-liquidity.js';
const enc = new TextEncoder();
const artifactHash = (kind: Parameters<typeof hashArtifactBytes>[0], value: unknown) => hashArtifactBytes(kind, enc.encode(JSON.stringify(value)));
const rawHash = (value: unknown) => hashRawBytes('raw-response', enc.encode(JSON.stringify(value)));
const A = 'eip155:42161', B = 'eip155:8453';
const sourceUsdc = { chainId: B, address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6 };
const usdc = { chainId: A, address: ARBITRUM_LIQUIDITY.usdc, decimals: 6 };
const weth = { chainId: A, address: ARBITRUM_LIQUIDITY.weth, decimals: 18 };
const nft = { chainId: A, address: ARBITRUM_LIQUIDITY.positionManager, decimals: 0 };
const sourceEth = { chainId: B, nativeId: 'ETH', decimals: 18 };
const destinationEth = { chainId: A, nativeId: 'ETH', decimals: 18 };
const quantity = (asset: typeof usdc | typeof weth | typeof nft | typeof sourceUsdc | typeof sourceEth | typeof destinationEth, amount: bigint) => ({ asset, amount: amount.toString() });
export type CrossChainArtifactInput = {
  readonly nowMs: number; readonly owner: string; readonly provider: 'lifi.rest' | 'across.direct'; readonly bridgeTarget: string;
  readonly sourceBlockNumber: number;
  readonly bridgePayloadHash: string; readonly bridgeFunctionId: string; readonly bridgeQuoteHash: string; readonly sourceUsdcAmount: bigint;
  readonly bridgeExpectedUsdc: bigint; readonly bridgeMinimumUsdc: bigint; readonly actualBridgeUsdc: bigint | null;
  readonly pool: PoolState; readonly tickLower: number; readonly tickUpper: number;
  readonly destinationEthBalance: bigint; readonly existingDestinationWeth: bigint;
  readonly swapTarget: string | null; readonly swapPayloadHash: string | null; readonly swapFunctionId: string | null;
  readonly swapQuoteHash: string | null; readonly swapInputUsdc: bigint | null; readonly swapExpectedWeth: bigint | null; readonly swapMinimumWeth: bigint | null;
  readonly liquidityPayloadHash: string; readonly costs: CrossChainCosts;
  readonly observedAt: string; readonly expiresAt: string;
};
export function compileCrossChainLiquidityArtifacts(workflow: SemanticWorkflow, input: CrossChainArtifactInput) {
  const expectedProvider = workflow.nodes.find(n => n.actionType === 'asset.bridge')?.adapterConstraints.adapters[0]?.id;
  const bridge = workflow.nodes.find(n => n.actionType === 'asset.bridge');
  const prep = workflow.nodes.find(n => n.actionType === 'asset.liquidity.prepare');
  const swap = workflow.nodes.find(n => n.actionType === 'asset.swap.exact-input');
  const mint = workflow.nodes.find(n => n.actionType === 'asset.liquidity.uniswap-v3');
  const hex = (v: string | null) => !!v && /^0x[0-9a-f]{64}$/.test(v);
  const addr = (v: string | null) => !!v && /^0x[0-9a-f]{40}$/.test(v);
  const functionId = (v: string | null) => !!v && /^0x[0-9a-f]{8}$/.test(v);
  const observedMs = Date.parse(input.observedAt), expiresMs = Date.parse(input.expiresAt);
  if (!bridge || !prep || !mint || expectedProvider !== input.provider || !addr(input.owner) ||
      !addr(input.bridgeTarget) || !hex(input.bridgePayloadHash) || !functionId(input.bridgeFunctionId) || !hex(input.bridgeQuoteHash) ||
      !hex(input.liquidityPayloadHash) || !Number.isSafeInteger(input.sourceBlockNumber) || input.sourceBlockNumber < 0 ||
      !Number.isFinite(observedMs) || !Number.isFinite(expiresMs) ||
      expiresMs <= observedMs || expiresMs - observedMs > 60_000 ||
      !Number.isSafeInteger(input.nowMs) || input.nowMs < observedMs || input.nowMs >= expiresMs ||
      input.bridgeMinimumUsdc <= 0n || input.bridgeMinimumUsdc > input.bridgeExpectedUsdc ||
      input.bridgeExpectedUsdc > input.sourceUsdcAmount ||
      input.actualBridgeUsdc !== null && (input.actualBridgeUsdc < input.bridgeMinimumUsdc || input.actualBridgeUsdc > input.sourceUsdcAmount))
    throw new Error('CROSS_CHAIN_ARTIFACT_INPUT_INVALID');
  const plan = planCrossChainPreparation({ expectedBridgeUsdc: input.bridgeExpectedUsdc,
    actualBridgeUsdc: input.actualBridgeUsdc ?? input.bridgeExpectedUsdc,
    maximumAuthorizedSourceUsdc: input.sourceUsdcAmount, destinationEthBalance: input.destinationEthBalance,
    existingDestinationWeth: input.existingDestinationWeth, tickLower: input.tickLower, tickUpper: input.tickUpper,
    pool: input.pool, nowMs: input.nowMs, costs: input.costs });
  if (plan.swapRequired !== Boolean(swap) || (swap && (!addr(input.swapTarget) || !hex(input.swapPayloadHash) ||
      !hex(input.swapQuoteHash) || !functionId(input.swapFunctionId) || input.swapInputUsdc !== plan.swapInputUsdc || input.swapExpectedWeth === null || input.swapMinimumWeth === null ||
      input.swapMinimumWeth <= 0n || input.swapMinimumWeth > input.swapExpectedWeth)))
    throw new Error('CROSS_CHAIN_EXECUTION_PATH_CHANGED');
  const workflowHash = artifactHash('semantic-workflow', validateArtifact('semantic-workflow', workflow));
  const sourceOwner = { chainId: B, address: input.owner }, destinationOwner = { chainId: A, address: input.owner };
  const bridgeAdapter = { id: input.provider, version: '1.0.0' };
  const swapAdapter = { id: 'lifi.rest', version: '1.0.0' };
  const liquidityAdapter = { id: 'uniswap-v3.position', version: '1.0.0' };
  const freshness = { observedAt: input.observedAt, expiresAt: input.expiresAt,
    maximumAgeSeconds: Math.ceil((expiresMs - observedMs) / 1000) };
  const uncertainty = [{ code: 'CROSS_CHAIN_SETTLEMENT_ESTIMATE', description: 'Bridge and swap quotes are estimates. Actual destination balances require independent reconciliation.' },
    { code: 'MOCKED_FINANCIAL_EXECUTION', description: 'This composed financial execution is a deterministic MOCKED rehearsal, not a public-chain transaction.' }];
  const ref = (chainId: string, address: string) => ({ chainId, address, version: 'reviewed-configuration' });
  const contracts = [ref(B, input.bridgeTarget), ref(A, ARBITRUM_LIQUIDITY.factory),
    ref(A, ARBITRUM_LIQUIDITY.positionManager), ref(A, input.pool.pool),
    ref(A, ARBITRUM_LIQUIDITY.usdc), ref(A, ARBITRUM_LIQUIDITY.weth),
    ...(swap ? [ref(A, input.swapTarget!)] : [])];
  const quote = (nodeId: string, sourceId: string, adapter: { readonly id: string; readonly version: string }, chainId: string,
    responseHash: string, outputBounds: { outputId: string; expected: ReturnType<typeof quantity>;
      minimum: ReturnType<typeof quantity>; adverse: ReturnType<typeof quantity> }[],
    normalizedValues: { name: string; kind: 'IDENTIFIER'; value: string }[]) =>
    validateArtifact('quote-state-artifact', { schemaVersion: '1.0.0', artifactId: `${nodeId}.quote`,
      semanticWorkflowHash: workflowHash, nodeId, sourceId, adapter, chainId,
      chainPosition: { kind: 'BLOCK', height: chainId === B ? input.sourceBlockNumber : input.pool.sourceBlockNumber },
      retrievedAt: input.observedAt,
      freshness, rawResponseHash: responseHash, normalizedValues,
      providerReference: nodeId === mint.nodeId ? { kind: 'NONE' } : { kind: 'ROUTE', id: `${nodeId}.route` }, proposedContracts: contracts,
      proposedSpenders: [sourceOwner, destinationOwner], proposedRecipients: [destinationOwner],
      fees: nodeId === bridge.nodeId ? [quantity(sourceUsdc, input.costs.bridgeProviderFeeUsdc)] :
        nodeId === swap?.nodeId ? [quantity(usdc, plan.swapPoolFeeUsdc)] : [],
      gas: nodeId === bridge.nodeId ? [quantity(sourceEth, input.costs.sourceGasEth)] :
        nodeId === swap?.nodeId ? [quantity(destinationEth, input.costs.destinationSwapGasEth)] :
          [quantity(destinationEth, input.costs.liquidityGasEth)],
      outputBounds, uncertainty, registryValidation: { registryVersion: '1.1.0',
        actionType: nodeId === bridge.nodeId ? 'asset.bridge' : nodeId === swap?.nodeId ? 'asset.swap.exact-input' : 'asset.liquidity.uniswap-v3',
        result: 'CONTRACT_VALIDATED', enforcement: 'NOT_ENFORCED' } });
  const bridgeQuote = quote(bridge.nodeId, `${input.provider}.reviewed-route`, bridgeAdapter, B, input.bridgeQuoteHash,
    [{ outputId: 'amount-out', expected: quantity(usdc, input.bridgeExpectedUsdc),
      minimum: quantity(usdc, input.bridgeMinimumUsdc), adverse: quantity(usdc, input.bridgeMinimumUsdc) }],
    [{ name: 'bridge-provider', kind: 'IDENTIFIER', value: input.provider },
      { name: 'bridge-target', kind: 'IDENTIFIER', value: input.bridgeTarget }]);
  const poolHash = rawHash({ pool: input.pool.pool, sourceBlockHash: input.pool.sourceBlockHash,
    sqrtPriceX96: input.pool.sqrtPriceX96.toString(), tick: input.pool.tick, fee: input.pool.fee });
  const poolQuote = quote(mint.nodeId, 'uniswap-v3.pool-state', liquidityAdapter, A, poolHash,
    [{ outputId: 'position-nft', expected: quantity(nft, 1n), minimum: quantity(nft, 1n), adverse: quantity(nft, 0n) },
      { outputId: 'residual-weth', expected: quantity(weth, plan.residualWeth), minimum: quantity(weth, 0n), adverse: quantity(weth, 0n) },
      { outputId: 'residual-usdc', expected: quantity(usdc, plan.residualUsdc), minimum: quantity(usdc, 0n), adverse: quantity(usdc, 0n) }],
    [{ name: 'pool-address', kind: 'IDENTIFIER', value: input.pool.pool },
      { name: 'pool-block', kind: 'IDENTIFIER', value: input.pool.sourceBlockHash }]);
  const swapQuote = swap ? quote(swap.nodeId, 'lifi.reviewed-destination-quote', swapAdapter, A, input.swapQuoteHash!,
    [{ outputId: 'amount-out', expected: quantity(weth, input.swapExpectedWeth!),
      minimum: quantity(weth, input.swapMinimumWeth!), adverse: quantity(weth, input.swapMinimumWeth!) }],
    [{ name: 'swap-target', kind: 'IDENTIFIER', value: input.swapTarget! }]) : null;
  const quotes = [bridgeQuote, ...(swapQuote ? [swapQuote] : []), poolQuote];
  const artifactSet = validateArtifact('artifact-set', { schemaVersion: '1.0.0', artifactSetId: `${workflow.workflowId}.set`,
    semanticWorkflowHash: workflowHash, artifacts: quotes.map(q => ({ artifactId: q.artifactId, nodeId: q.nodeId,
      artifactHash: artifactHash('quote-state-artifact', q) })) });
  const artifactSetHash = artifactHash('artifact-set', artifactSet);
  const simulatedSwapWeth = input.swapExpectedWeth ?? 0n;
  const outputs = [{ nodeId: bridge.nodeId, outputId: 'amount-out', expected: quantity(usdc, input.bridgeExpectedUsdc),
    minimum: quantity(usdc, input.bridgeMinimumUsdc), adverse: quantity(usdc, input.bridgeMinimumUsdc) },
    { nodeId: prep.nodeId, outputId: 'swap-input', expected: quantity(usdc, plan.swapInputUsdc),
      minimum: quantity(usdc, 0n), adverse: quantity(usdc, 0n) },
    { nodeId: prep.nodeId, outputId: 'liquidity-usdc', expected: quantity(usdc, plan.liquidityUsdcBeforeMint),
      minimum: quantity(usdc, 0n), adverse: quantity(usdc, 0n) },
    ...(swap ? [{ nodeId: swap.nodeId, outputId: 'amount-out', expected: quantity(weth, simulatedSwapWeth),
      minimum: quantity(weth, input.swapMinimumWeth!), adverse: quantity(weth, input.swapMinimumWeth!) }] :
      [{ nodeId: prep.nodeId, outputId: 'liquidity-weth', expected: quantity(weth, input.existingDestinationWeth),
        minimum: quantity(weth, input.existingDestinationWeth), adverse: quantity(weth, input.existingDestinationWeth) }]),
    { nodeId: mint.nodeId, outputId: 'position-nft', expected: quantity(nft, 1n), minimum: quantity(nft, 0n), adverse: quantity(nft, 0n) },
    { nodeId: mint.nodeId, outputId: 'residual-weth', expected: quantity(weth, plan.residualWeth), minimum: quantity(weth, 0n), adverse: quantity(weth, 0n) },
    { nodeId: mint.nodeId, outputId: 'residual-usdc', expected: quantity(usdc, plan.residualUsdc), minimum: quantity(usdc, 0n), adverse: quantity(usdc, 0n) }];
  const amountByRef = new Map(outputs.map(o => [`${o.nodeId}:${o.outputId}`, o.expected]));
  const simulation = validateArtifact('simulation-bundle', { schemaVersion: '1.0.0',
    simulationId: `${workflow.workflowId}.simulation`, semanticWorkflowRevision: workflow.revision,
    semanticWorkflowHash: workflowHash, artifactSetHash,
    adapters: [bridgeAdapter, ...(swap ? [swapAdapter] : []), liquidityAdapter], contracts,
    outputs, propagatedOutputs: workflow.resourceEdges.map(e => ({ ...e,
      quantity: amountByRef.get(`${e.fromNodeId}:${e.outputId}`)! })), failurePaths: [], uncertainty,
    unsupportedAssumptions: ['The bridge and destination swap cannot settle atomically with the liquidity transaction.',
      'Simulation estimates are not final settlement guarantees.'], freshness });
  const simulationHash = artifactHash('simulation-bundle', simulation);
  const spendLimits = [{ asset: sourceUsdc, maximumAmount: input.sourceUsdcAmount.toString(),
    maximumPerStepAmount: input.sourceUsdcAmount.toString(), maximumCumulativeAmount: input.sourceUsdcAmount.toString() },
    { asset: usdc, maximumAmount: plan.actualBridgeUsdc.toString(),
      maximumPerStepAmount: plan.actualBridgeUsdc.toString(), maximumCumulativeAmount: plan.actualBridgeUsdc.toString() }];
  const gasBudgets = [{ asset: sourceEth, maximumAmount: input.costs.sourceGasEth.toString() },
    { asset: destinationEth, maximumAmount: input.costs.destinationGasReserveEth.toString() }];
  const feeBudgets = [{ asset: sourceUsdc, maximumAmount: input.costs.bridgeProviderFeeUsdc.toString() }];
  const providerPolicy = input.provider === 'lifi.rest' ? { kind: 'FIXED' as const, providerId: 'lifi.rest' } :
    { kind: 'AUTHORIZED_SET' as const, providerIds: ['across.direct', 'lifi.rest'] };
  const recovery = { failurePolicy: 'PAUSE_FOR_APPROVAL' as const, residualAssetRecipient: destinationOwner,
    maximumAttemptsPerStep: 1, requiresHumanReview: true as const };
  const allowlists = { owners: [sourceOwner], accounts: [sourceOwner, destinationOwner], recipients: [destinationOwner],
    chains: [B, A], adapters: [bridgeAdapter, ...(swap ? [swapAdapter] : []), liquidityAdapter],
    protocols: input.provider === 'lifi.rest' ? ['lifi', 'uniswap-v3'] : ['across', 'lifi', 'uniswap-v3'], contracts,
    functions: [{ chainId: B, contract: input.bridgeTarget, functionId: input.bridgeFunctionId },
      ...(swap ? [{ chainId: A, contract: input.swapTarget!, functionId: input.swapFunctionId! }] : []),
      { chainId: A, contract: ARBITRUM_LIQUIDITY.positionManager, functionId: '0x88316456' }] };
  const policy = validateArtifact('authorization-policy', { schemaVersion: '1.0.0',
    policyId: `${workflow.workflowId}.policy`, semanticWorkflowHash: workflowHash, artifactSetHash,
    simulationHash, requiredAuthorizationClass: 'MODE_A', allowlists,
    budgetReservation: { rule: 'RESERVE_BEFORE_SUBMISSION', concurrentConsumption: 'CUMULATIVE_ACROSS_BRANCHES',
      implementation: 'NOT_IMPLEMENTED' }, spendLimits,
    maximumSlippageBps: Math.max(...workflow.nodes.flatMap(n => n.userConstraints.filter(c => c.kind === 'MAXIMUM_SLIPPAGE_BPS').map(c => c.maximumBps))),
    gasBudgets, feeBudgets, oracleRules: [], accountRiskRules: [], checkpointRules: [], providers: providerPolicy,
    nonce: '0', deadline: input.expiresAt, revocationEpoch: 0, recovery, enforcement: 'NOT_ENFORCED' });
  const policyHash = artifactHash('authorization-policy', policy);
  const manifest = validateArtifact('strategy-manifest', { schemaVersion: '1.0.0',
    manifestId: `${workflow.workflowId}.manifest`, semanticWorkflowRevision: workflow.revision,
    semanticWorkflowHash: workflowHash, artifactSetHash, simulationHash, policyHash,
    authorizationMode: 'MODE_A', owner: sourceOwner, executor: null, expiresAt: input.expiresAt,
    nonce: '0', revocationEpoch: 0, spendLimits, maximumSlippageBps: policy.maximumSlippageBps,
    gasBudgets, feeBudgets, providers: providerPolicy, recovery, enforcement: 'NOT_ENFORCED' });
  const manifestHash = artifactHash('strategy-manifest', manifest);
  const executionPlan = validateArtifact('execution-plan', { schemaVersion: '1.0.0',
    executionPlanId: `${workflow.workflowId}.plan`, semanticWorkflowHash: workflowHash, manifestHash,
    segments: [{ segmentId: 'source', chainId: B, dependencies: [],
      steps: [{ stepId: 'bridge-submission', nodeId: bridge.nodeId, chainId: B, adapter: bridgeAdapter,
        dependencies: [], requiredAuthorizationClass: 'MODE_A', executionKind: 'DIRECT_TRANSACTION', payloadHash: input.bridgePayloadHash }] },
    ...(swap ? [{ segmentId: 'destination', chainId: A, dependencies: ['source'],
      steps: [{ stepId: 'destination-swap', nodeId: swap.nodeId, chainId: A, adapter: swapAdapter,
        dependencies: ['bridge-submission'], requiredAuthorizationClass: 'MODE_A' as const, executionKind: 'DIRECT_TRANSACTION' as const,
        payloadHash: input.swapPayloadHash! }] }] : []),
    { segmentId: 'liquidity', chainId: A, dependencies: [swap ? 'destination' : 'source'],
      steps: [{ stepId: 'liquidity-mint', nodeId: mint.nodeId, chainId: A, adapter: liquidityAdapter,
        dependencies: [swap ? 'destination-swap' : 'bridge-submission'], requiredAuthorizationClass: 'MODE_A',
        executionKind: 'DIRECT_TRANSACTION', payloadHash: input.liquidityPayloadHash }] }],
    checkpointIds: ['destination-reconciliation', 'swap-reconciliation', 'final-position-reconciliation'], enforcement: 'NOT_ENFORCED' });
  return { quotes, artifactSet, simulation, policy, manifest, executionPlan, preparation: plan,
    hashes: { workflow: workflowHash, artifactSet: artifactSetHash, simulation: simulationHash,
      policy: policyHash, manifest: manifestHash, executionPlan: artifactHash('execution-plan', executionPlan) } };
}
