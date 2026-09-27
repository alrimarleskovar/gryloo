// SPDX-License-Identifier: AGPL-3.0-only
/** CoW exact-input EIP-712 intent compiler. It never signs or contacts an orderbook. */
import { keccak_256 } from '@noble/hashes/sha3.js';
import { hashArtifactBytes, hashRawBytes, type SemanticWorkflow, type QuoteStateArtifact,
  type ArtifactSet, type SimulationBundle, type AuthorizationPolicy, type StrategyManifest, type ExecutionPlan } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';

const enc = new TextEncoder();
const hex = (bytes: Uint8Array) => '0x' + Buffer.from(bytes).toString('hex');
const bytes = (value: string) => {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) throw new Error('COW_HEX_INVALID');
  return Uint8Array.from(Buffer.from(value.slice(2), 'hex'));
};
const join = (...items: Uint8Array[]) => Uint8Array.from(Buffer.concat(items.map(item => Buffer.from(item))));
const word = (value: bigint) => {
  if (value < 0n || value >= 1n << 256n) throw new Error('COW_WORD_INVALID');
  return bytes('0x' + value.toString(16).padStart(64, '0'));
};
const addressWord = (value: string) => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error('COW_ADDRESS_INVALID');
  return join(new Uint8Array(12), bytes(value));
};
const hash = (value: string) => keccak_256(enc.encode(value));
const digest = (parts: Uint8Array[]) => keccak_256(join(...parts));
const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson((value as Record<string, unknown>)[key])).join(',') + '}';
};
const H = (kind: Parameters<typeof hashArtifactBytes>[0], value: unknown) =>
  hashArtifactBytes(kind, enc.encode(JSON.stringify(value)));

export const COW_SETTLEMENT = '0x9008d19f58aabd9ed0d60971565aa8510560ab41';
export const COW_RELAYER = '0xc92e8bdf79f0507f65a392b0ab4667716bfe0110';
export const COW_ADAPTER = { id: 'cow-protocol.signed-intent', version: '1.0.0' } as const;
export const COW_CHAIN = 'eip155:8453';
const ORDER_TYPE = 'Order(address sellToken,address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,string kind,bool partiallyFillable,string sellTokenBalance,string buyTokenBalance)';
const DOMAIN_TYPE = 'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)';
const CANCEL_TYPE = 'OrderCancellations(bytes[] orderUids)';
export type CowOrder = {
  readonly sellToken: string; readonly buyToken: string; readonly receiver: string;
  readonly sellAmount: string; readonly buyAmount: string; readonly validTo: number;
  readonly appData: string; readonly feeAmount: string; readonly kind: 'sell';
  readonly partiallyFillable: boolean; readonly sellTokenBalance: 'erc20'; readonly buyTokenBalance: 'erc20';
};
export type CowQuote = { readonly quoteId: string; readonly sourceId: string; readonly chainId: typeof COW_CHAIN;
  readonly sellToken: string; readonly buyToken: string; readonly owner: string; readonly receiver: string;
  readonly sellAmount: string; readonly buyAmount: string; readonly feeAmount: string;
  readonly validTo: number; readonly observedAt: string; readonly expiresAt: string;
  readonly sourceBlock: number; readonly sourceHash: string; readonly rawHash: string };
export type CowTypedData = { readonly types: { readonly EIP712Domain: readonly { readonly name: string; readonly type: string }[];
  readonly Order?: readonly { readonly name: string; readonly type: string }[];
  readonly OrderCancellations?: readonly { readonly name: string; readonly type: string }[] };
  readonly primaryType: 'Order' | 'OrderCancellations';
  readonly domain: { readonly name: 'Gnosis Protocol'; readonly version: 'v2'; readonly chainId: 8453; readonly verifyingContract: string };
  readonly message: CowOrder | { readonly orderUids: readonly string[] } };
const domain = { name: 'Gnosis Protocol', version: 'v2', chainId: 8453, verifyingContract: COW_SETTLEMENT } as const;
const domainFields = [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }] as const;
const orderFields = [{ name: 'sellToken', type: 'address' }, { name: 'buyToken', type: 'address' },
  { name: 'receiver', type: 'address' }, { name: 'sellAmount', type: 'uint256' },
  { name: 'buyAmount', type: 'uint256' }, { name: 'validTo', type: 'uint32' },
  { name: 'appData', type: 'bytes32' }, { name: 'feeAmount', type: 'uint256' },
  { name: 'kind', type: 'string' }, { name: 'partiallyFillable', type: 'bool' },
  { name: 'sellTokenBalance', type: 'string' }, { name: 'buyTokenBalance', type: 'string' }] as const;
const cancellationFields = [{ name: 'orderUids', type: 'bytes[]' }] as const;
export const cowOrderTypedData = (order: CowOrder): CowTypedData =>
  ({ types: { EIP712Domain: domainFields, Order: orderFields }, primaryType: 'Order', domain, message: order });
export const cowCancellationTypedData = (uid: string): CowTypedData =>
  ({ types: { EIP712Domain: domainFields, OrderCancellations: cancellationFields },
    primaryType: 'OrderCancellations', domain, message: { orderUids: [uid] } });

function domainHash(): Uint8Array {
  return digest([hash(DOMAIN_TYPE), hash(domain.name), hash(domain.version), word(8453n), addressWord(COW_SETTLEMENT)]);
}
export function cowOrderDigest(order: CowOrder): string {
  if (order.kind !== 'sell' || order.sellTokenBalance !== 'erc20' || order.buyTokenBalance !== 'erc20' ||
    !Number.isInteger(order.validTo) || order.validTo <= 0 || order.validTo > 0xffffffff ||
    BigInt(order.sellAmount) <= 0n || BigInt(order.buyAmount) <= 0n || BigInt(order.feeAmount) !== 0n ||
    order.partiallyFillable) throw new Error('COW_ORDER_INVALID');
  const struct = digest([hash(ORDER_TYPE), addressWord(order.sellToken), addressWord(order.buyToken),
    addressWord(order.receiver), word(BigInt(order.sellAmount)), word(BigInt(order.buyAmount)),
    word(BigInt(order.validTo)), bytes(order.appData), word(0n), hash(order.kind), word(0n),
    hash(order.sellTokenBalance), hash(order.buyTokenBalance)]);
  if (bytes(order.appData).length !== 32) throw new Error('COW_APP_DATA_INVALID');
  return hex(digest([Uint8Array.of(0x19, 0x01), domainHash(), struct]));
}
export function cowOrderUid(order: CowOrder, owner: string): string {
  return cowOrderDigest(order) + owner.toLowerCase().slice(2) + order.validTo.toString(16).padStart(8, '0');
}
export function cowCancellationDigest(uid: string): string {
  if (!/^0x[0-9a-f]{112}$/.test(uid)) throw new Error('COW_UID_INVALID');
  const item = bytes(uid);
  // EIP-712 bytes[]: hash of each bytes element hash, then hash of the array.
  const struct = digest([hash(CANCEL_TYPE), digest([keccak_256(item)])]);
  return hex(digest([Uint8Array.of(0x19, 0x01), domainHash(), struct]));
}
export type CowCompiled = {
  readonly quote: QuoteStateArtifact; readonly artifactSet: ArtifactSet; readonly simulation: SimulationBundle;
  readonly policy: AuthorizationPolicy; readonly manifest: StrategyManifest; readonly plan: ExecutionPlan;
  readonly order: CowOrder; readonly typedData: CowTypedData; readonly orderUid: string; readonly intentHash: string;
  readonly hashes: { readonly workflow: string; readonly quote: string; readonly artifactSet: string;
    readonly simulation: string; readonly policy: string; readonly manifest: string; readonly plan: string };
};
export function compileCow(workflow: SemanticWorkflow, quote: CowQuote, nowMs: number): CowCompiled {
  if (!Number.isSafeInteger(nowMs) || quote.chainId !== COW_CHAIN || !/^0x[0-9a-f]{40}$/.test(quote.owner) ||
    quote.receiver !== quote.owner || !/^0x[0-9a-f]{64}$/.test(quote.sourceHash) ||
    !/^0x[0-9a-f]{64}$/.test(quote.rawHash) || Date.parse(quote.expiresAt) <= nowMs ||
    Date.parse(quote.observedAt) > nowMs || quote.validTo * 1000 <= nowMs ||
    quote.sellToken === quote.buyToken || BigInt(quote.sellAmount) <= 0n || BigInt(quote.buyAmount) <= 0n ||
    quote.feeAmount !== '0') throw new Error('COW_QUOTE_INVALID');
  const swaps = workflow.nodes.filter(node => node.actionType === 'asset.swap.exact-input');
  const others = workflow.nodes.filter(node => node.actionType !== 'asset.swap.exact-input');
  if (swaps.length !== 1 || swaps[0]!.chainId !== COW_CHAIN || swaps[0]!.dependencies.length ||
    others.some(node => !/^mock-[a-z]+$/.test(node.actionType) || node.chainId !== 'mock:local') ||
    workflow.resourceEdges.some(edge => JSON.stringify(edge).includes(swaps[0]!.nodeId))) throw new Error('COW_WORKFLOW_UNSUPPORTED');
  const node = swaps[0]!;
  if (!node.adapterConstraints.protocols.includes('cow-protocol')) throw new Error('COW_PROVIDER_NOT_PREAUTHORIZED');
  const input = node.inputs.find(value => value.name === 'amount-in');
  const output = node.inputs.find(value => value.name === 'asset-out');
  if (input?.kind !== 'QUANTITY' || output?.kind !== 'ASSET' ||
    !('address' in input.value.asset) || !('address' in output.value) ||
    input.value.amount !== quote.sellAmount || input.value.asset.address.toLowerCase() !== quote.sellToken ||
    output.value.address.toLowerCase() !== quote.buyToken)
    throw new Error('COW_QUOTE_WORKFLOW_MISMATCH');
  const workflowHash = H('semantic-workflow', workflow);
  const inputAsset = { chainId: COW_CHAIN, address: quote.sellToken, decimals: input.value.asset.decimals };
  const outputAsset = { chainId: COW_CHAIN, address: quote.buyToken, decimals: output.value.decimals };
  const owner = { chainId: COW_CHAIN, address: quote.owner };
  const amountIn = { asset: inputAsset, amount: quote.sellAmount };
  const amountOut = { asset: outputAsset, amount: quote.buyAmount };
  const freshness = { observedAt: quote.observedAt, expiresAt: quote.expiresAt,
    maximumAgeSeconds: Math.max(0, Math.floor((Date.parse(quote.expiresAt) - Date.parse(quote.observedAt)) / 1000)) };
  const quoteArtifact = validateArtifact('quote-state-artifact', {
    schemaVersion: '1.0.0', artifactId: 'cow.quote.' + quote.quoteId, semanticWorkflowHash: workflowHash,
    nodeId: node.nodeId, sourceId: quote.sourceId, adapter: COW_ADAPTER, chainId: COW_CHAIN,
    chainPosition: { kind: 'BLOCK', height: quote.sourceBlock }, retrievedAt: quote.observedAt,
    freshness, rawResponseHash: quote.rawHash,
    normalizedValues: [{ name: 'amount-in', kind: 'QUANTITY', value: amountIn },
      { name: 'evidence-environment', kind: 'IDENTIFIER', value: 'MOCKED' }],
    providerReference: { kind: 'ROUTE', id: quote.quoteId },
    proposedContracts: [{ chainId: COW_CHAIN, address: COW_SETTLEMENT, version: 'reviewed-docs-2026-09-27' }],
    proposedSpenders: [{ chainId: COW_CHAIN, address: COW_RELAYER }], proposedRecipients: [owner],
    fees: [{ asset: inputAsset, amount: '0' }], gas: [],
    outputBounds: [{ outputId: 'amount-out', expected: amountOut, minimum: amountOut, adverse: amountOut }],
    uncertainty: [{ code: 'SCRIPTED_ORDERBOOK', description: 'Scripted quote and settlement; no public CoW or chain observation.' }],
    registryValidation: { registryVersion: '1.1.0', actionType: node.actionType, result: 'CONTRACT_VALIDATED', enforcement: 'NOT_ENFORCED' },
  });
  const quoteHash = H('quote-state-artifact', quoteArtifact);
  const artifactSet = validateArtifact('artifact-set', { schemaVersion: '1.0.0', artifactSetId: 'cow.artifacts.' + quote.quoteId,
    semanticWorkflowHash: workflowHash, artifacts: [{ artifactId: quoteArtifact.artifactId, nodeId: node.nodeId, artifactHash: quoteHash }] });
  const artifactSetHash = H('artifact-set', artifactSet);
  const simulation = validateArtifact('simulation-bundle', { schemaVersion: '1.0.0', simulationId: 'cow.simulation.' + quote.quoteId,
    semanticWorkflowRevision: workflow.revision, semanticWorkflowHash: workflowHash, artifactSetHash,
    adapters: [COW_ADAPTER], contracts: quoteArtifact.proposedContracts,
    outputs: [{ nodeId: node.nodeId, outputId: 'amount-out', expected: amountOut, minimum: amountOut, adverse: amountOut }],
    propagatedOutputs: [], failurePaths: [{ failedNodeId: node.nodeId, blockedNodeIds: [], residualAssets: [amountIn] }],
    uncertainty: quoteArtifact.uncertainty, unsupportedAssumptions: ['Solver fill, gas, fees, balance changes and timing are not guaranteed by the scripted quote.'],
    freshness });
  const simulationHash = H('simulation-bundle', simulation);
  const policy = validateArtifact('authorization-policy', { schemaVersion: '1.0.0', policyId: 'cow.policy.' + quote.quoteId,
    semanticWorkflowHash: workflowHash, artifactSetHash, simulationHash, requiredAuthorizationClass: 'MODE_A',
    allowlists: { owners: [owner], accounts: [owner], recipients: [owner], chains: [COW_CHAIN], adapters: [COW_ADAPTER],
      protocols: ['cow-protocol'], contracts: quoteArtifact.proposedContracts,
      functions: [] }, budgetReservation: { rule: 'RESERVE_BEFORE_SUBMISSION',
      concurrentConsumption: 'CUMULATIVE_ACROSS_BRANCHES', implementation: 'NOT_IMPLEMENTED' },
    spendLimits: [{ asset: inputAsset, maximumAmount: quote.sellAmount, maximumPerStepAmount: quote.sellAmount,
      maximumCumulativeAmount: quote.sellAmount }], maximumSlippageBps: 0, gasBudgets: [],
    feeBudgets: [{ asset: inputAsset, maximumAmount: '0' }], oracleRules: [], accountRiskRules: [],
    checkpointRules: [{ checkpointId: 'cow-minimum-output', beforeNodeId: node.nodeId,
      maximumSlippageBps: 0, minimumOutputs: [amountOut] }],
    providers: { kind: 'FIXED', providerId: COW_ADAPTER.id }, nonce: '0',
    deadline: new Date(quote.validTo * 1000).toISOString(), revocationEpoch: 0,
    recovery: { failurePolicy: 'CANCEL_IF_AVAILABLE', residualAssetRecipient: owner,
      maximumAttemptsPerStep: 1, requiresHumanReview: true }, enforcement: 'NOT_ENFORCED' });
  const policyHash = H('authorization-policy', policy);
  const manifest = validateArtifact('strategy-manifest', { schemaVersion: '1.0.0', manifestId: 'cow.manifest.' + quote.quoteId,
    semanticWorkflowRevision: workflow.revision, semanticWorkflowHash: workflowHash, artifactSetHash, simulationHash,
    policyHash, authorizationMode: 'MODE_A', owner, executor: null,
    expiresAt: new Date(quote.validTo * 1000).toISOString(), nonce: '0', revocationEpoch: 0,
    spendLimits: policy.spendLimits, maximumSlippageBps: 0, gasBudgets: [], feeBudgets: policy.feeBudgets,
    providers: policy.providers, recovery: policy.recovery, enforcement: 'NOT_ENFORCED' });
  const manifestHash = H('strategy-manifest', manifest);
  // appData commits the exact Manifest. The signed CoW order therefore changes when any reviewed artifact changes.
  const appData = hex(keccak_256(enc.encode(canonicalJson({ manifestHash, quoteHash, workflowHash }))));
  const order: CowOrder = { sellToken: quote.sellToken, buyToken: quote.buyToken, receiver: quote.receiver,
    sellAmount: quote.sellAmount, buyAmount: quote.buyAmount, validTo: quote.validTo, appData,
    feeAmount: '0', kind: 'sell', partiallyFillable: false, sellTokenBalance: 'erc20', buyTokenBalance: 'erc20' };
  const intentHash = hashRawBytes('intent', enc.encode(canonicalJson({ domain, order })));
  const plan = validateArtifact('execution-plan', { schemaVersion: '1.0.0', executionPlanId: 'cow.plan.' + quote.quoteId,
    semanticWorkflowHash: workflowHash, manifestHash,
    segments: [{ segmentId: 'cow.segment.base', chainId: COW_CHAIN, dependencies: [],
      steps: [{ stepId: 'cow.step.swap', nodeId: node.nodeId, chainId: COW_CHAIN, adapter: COW_ADAPTER,
        dependencies: [], requiredAuthorizationClass: 'MODE_A', executionKind: 'SIGNED_INTENT', intentHash }] }],
    checkpointIds: ['cow-minimum-output'], enforcement: 'NOT_ENFORCED' });
  return { quote: quoteArtifact, artifactSet, simulation, policy, manifest, plan, order,
    typedData: cowOrderTypedData(order), orderUid: cowOrderUid(order, quote.owner), intentHash,
    hashes: { workflow: workflowHash, quote: quoteHash, artifactSet: artifactSetHash, simulation: simulationHash,
      policy: policyHash, manifest: manifestHash, plan: H('execution-plan', plan) } };
}
export function verifyCowForPosting(compiled: CowCompiled, quote: CowQuote, nowMs: number): void {
  if (Date.parse(quote.expiresAt) <= nowMs || compiled.order.validTo * 1000 <= nowMs) throw new Error('COW_QUOTE_EXPIRED');
  if (compiled.manifest.providers.kind !== 'FIXED' || compiled.manifest.providers.providerId !== COW_ADAPTER.id ||
    compiled.plan.segments[0]?.steps[0]?.executionKind !== 'SIGNED_INTENT' ||
    compiled.order.sellAmount !== compiled.manifest.spendLimits[0]?.maximumAmount ||
    compiled.order.receiver !== compiled.manifest.owner.address ||
    compiled.order.sellToken !== (compiled.manifest.spendLimits[0]?.asset && 'address' in compiled.manifest.spendLimits[0].asset ? compiled.manifest.spendLimits[0].asset.address : null) ||
    compiled.order.buyAmount !== compiled.simulation.outputs[0]?.minimum.amount ||
    compiled.order.appData !== hex(keccak_256(enc.encode(canonicalJson({
      manifestHash: compiled.hashes.manifest, quoteHash: compiled.hashes.quote, workflowHash: compiled.hashes.workflow
    })))) || compiled.orderUid !== cowOrderUid(compiled.order, compiled.manifest.owner.address) ||
    compiled.intentHash !== hashRawBytes('intent', enc.encode(canonicalJson({ domain, order: compiled.order }))))
    throw new Error('COW_MANIFEST_ORDER_MISMATCH');
}
