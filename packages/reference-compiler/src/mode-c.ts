// SPDX-License-Identifier: AGPL-3.0-only
import { hashArtifactBytes, hashRawBytes, serializeModeC as canonicalJson, readExactInputSwap, validateModeCPolicy, hashModeCPolicy,
  readModeCPoolObservation, MODE_C_SOURCE, MODE_C_USDC, MODE_C_WETH, MODE_C_FACTORY, MODE_C_ROUTER,
  hashModeCManifest, validateModeCManifest, validateModeCExecutionPlan, modeCCommitment,
  type ModeCPolicy, type SemanticWorkflow, type QuoteStateArtifact, type ArtifactSet, type SimulationBundle } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
import { compileModeB, modeBCodeHash, type ModeBProfile } from './mode-b.js';
import { encodeSwap } from './abi.js';
import { sqrtRatioAtTick } from './liquidity.js';

const bytes = new TextEncoder();
const digest = (kind: 'semantic-workflow' | 'artifact-set' | 'simulation-bundle' | 'strategy-manifest' | 'execution-plan', value: unknown) =>
  hashArtifactBytes(kind, bytes.encode(canonicalJson(value)));
export type ModeCCompileInput = {
  readonly workflow: SemanticWorkflow; readonly reference: QuoteStateArtifact;
  readonly artifactSet: ArtifactSet; readonly simulation: SimulationBundle;
  readonly profile: ModeBProfile; readonly salt: string;
  readonly source: ModeCPolicy['source']; readonly verifier: ModeCPolicy['verifier'];
  readonly startsAt: number; readonly expiresAt: number; readonly maximumSlippageBps: number;
  readonly minimumOut: string; readonly totalBudget: string; readonly perPeriodBudget: string;
  readonly periodSeconds: number; readonly frequencySeconds: number; readonly cooldownSeconds: number;
};
export function compileModeC(input: ModeCCompileInput) {
  const workflow = validateArtifact('semantic-workflow', input.workflow);
  if (workflow.nodes.length !== 1 || workflow.resourceEdges.length !== 0) throw new Error('MODE_C_WORKFLOW_INVALID');
  const node = workflow.nodes[0]!;
  const swap = readExactInputSwap(node);
  const workflowHash = digest('semantic-workflow', workflow);
  const set = validateArtifact('artifact-set', input.artifactSet), simulation = validateArtifact('simulation-bundle', input.simulation);
  const artifactSetHash = digest('artifact-set', set), simulationHash = digest('simulation-bundle', simulation);
  const referenceHash = hashArtifactBytes('quote-state-artifact', bytes.encode(canonicalJson(input.reference)));
  if (node.requiredAuthorizationClass !== 'MODE_C' || swap.chain !== 'eip155:31337' || swap.input.address !== MODE_C_USDC ||
    swap.input.decimals !== 6 || swap.output.address !== MODE_C_WETH || swap.output.decimals !== 18 ||
    swap.slippageBps !== input.maximumSlippageBps || swap.protocols.length !== 1 || swap.protocols[0] !== 'uniswap-v3' ||
    set.semanticWorkflowHash !== workflowHash || simulation.semanticWorkflowHash !== workflowHash ||
    simulation.artifactSetHash !== artifactSetHash || simulation.semanticWorkflowRevision !== workflow.revision ||
    input.reference.nodeId !== node.nodeId || !set.artifacts.some(a => a.artifactHash === referenceHash && a.artifactId === input.reference.artifactId) ||
    input.profile.semanticWorkflowHash !== workflowHash || input.profile.simulationHash !== simulationHash)
    throw new Error('MODE_C_ARTIFACT_BINDING_INVALID');
  const output=simulation.outputs.find(o=>o.nodeId===node.nodeId);
  if(!output || simulation.outputs.length!==1 || output.minimum.amount!==input.minimumOut ||
    ![output.expected,output.minimum,output.adverse].every(o=>o.asset.chainId==='eip155:31337'&&'address' in o.asset&&o.asset.address===MODE_C_WETH&&o.asset.decimals===18) ||
    BigInt(output.expected.amount)<=0n || BigInt(input.minimumOut)<BigInt(output.expected.amount)*BigInt(10000-input.maximumSlippageBps)/10000n ||
    BigInt(input.minimumOut)>BigInt(output.expected.amount) || Date.parse(simulation.freshness.expiresAt)<=input.startsAt*1000 ||
    Date.parse(simulation.freshness.observedAt)>input.startsAt*1000)throw new Error('MODE_C_SIMULATION_INVALID');
  const swapArgs = { tokenIn: MODE_C_USDC, tokenOut: MODE_C_WETH, fee: 500 as const, recipient: input.profile.safe,
    amountIn: BigInt(swap.amount), amountOutMinimum: BigInt(input.minimumOut), sqrtPriceLimitX96: 0n as const,
    deadline: BigInt(input.expiresAt - 1) }; // exclusive policy expiry, inclusive router deadline
  const base = compileModeB(input.profile, swapArgs, input.salt);
  const policy = validateModeCPolicy({ format: 'gryloo.mode-c-buy-dip.v1', chainId: 31337,
    semanticWorkflowHash: workflowHash, artifactSetHash, simulationHash, permissionHash: base.permissionHash,
    owner: input.profile.owner, executor: input.profile.executor, safe: input.profile.safe, roles: input.profile.roles,
    roleKey: base.roleKey, allowanceKey: base.allowanceKey, tokenIn: MODE_C_USDC, tokenOut: MODE_C_WETH,
    router: MODE_C_ROUTER, functionId: '0x5ae401dc', recipient: input.profile.safe,
    swapCalldata: '0x' + Buffer.from(encodeSwap(swapArgs)).toString('hex'), executorCalldata: base.executorCall.data,
    maximumSwapAmount: swap.amount, totalBudget: input.totalBudget, perPeriodBudget: input.perPeriodBudget,
    minimumOut: input.minimumOut, maximumSlippageBps: input.maximumSlippageBps,
    triggerDropBps: 500, maximumExecutions: 1, maximumPerPeriod: 1, periodSeconds: input.periodSeconds,
    frequencySeconds: input.frequencySeconds, cooldownSeconds: input.cooldownSeconds,
    startsAt: input.startsAt, expiresAt: input.expiresAt, revocationEpoch: 0, revocation: 'ROLES_REMOVE_AND_SAFE_DISABLE',
    source: input.source, reference: input.reference, referenceHash, verifier: input.verifier });
  const reference = readModeCPoolObservation(policy.reference, policy);
  if (input.startsAt >= reference.expiresAt) throw new Error('MODE_C_REFERENCE_STALE_AT_REVIEW');
  const policyHash = hashModeCPolicy(policy);
  const owner = { chainId: 'eip155:31337', address: policy.owner };
  const spendLimits = [{ asset: { chainId: 'eip155:31337', address: MODE_C_USDC, decimals: 6 },
    maximumAmount: policy.totalBudget, maximumPerStepAmount: policy.maximumSwapAmount, maximumCumulativeAmount: policy.totalBudget }];
  const manifest = validateModeCManifest(policy, { schemaVersion: '2.0.0', manifestId: `mode-c-${policyHash.slice(2,26)}`,
    semanticWorkflowRevision: workflow.revision, semanticWorkflowHash: workflowHash, artifactSetHash, simulationHash, policyHash,
    authorizationMode: 'MODE_C', owner, executor: { chainId: 'eip155:31337', address: policy.executor },
    expiresAt: new Date(policy.expiresAt * 1000).toISOString(), nonce: '0', revocationEpoch: 0, spendLimits,
    maximumSlippageBps: policy.maximumSlippageBps, gasBudgets: [], feeBudgets: [],
    providers: { kind: 'FIXED', providerId: MODE_C_SOURCE },
    recovery: { failurePolicy: 'ABORT', residualAssetRecipient: { chainId: 'eip155:31337', address: policy.safe },
      maximumAttemptsPerStep: 1, requiresHumanReview: true }, enforcement: 'SMART_ACCOUNT_MODULE_OR_GUARD' });
  const manifestHash = hashModeCManifest(policy, manifest);
  const compiled = compileModeB(input.profile, swapArgs, input.salt, {
    conditionalVerifier: { address: policy.verifier.address, tag: policyHash.slice(0,26) } });
  const executionPlan = validateModeCExecutionPlan(policy, manifest, { schemaVersion: '2.0.0', executionPlanId: `${manifest.manifestId}.plan`,
    semanticWorkflowHash: workflowHash, manifestHash, segments: [{ segmentId: 'dip-segment', chainId: 'eip155:31337', dependencies: [],
      steps: [{ stepId: 'dip-swap', nodeId: node.nodeId, chainId: 'eip155:31337', adapter: { id: 'uniswap-v3.swap-router-02', version: '1.0.0' },
        dependencies: [], requiredAuthorizationClass: 'MODE_C', executionKind: 'DIRECT_TRANSACTION',
        payloadHash: hashRawBytes('payload', Buffer.from(policy.executorCalldata.slice(2), 'hex')) }] }],
    checkpointIds: [], enforcement: 'SMART_ACCOUNT_MODULE_OR_GUARD' });
  return { workflow, artifactSet:set, simulation, policy, policyHash, manifest, manifestHash, compiled, executionPlan,
    executionPlanHash: modeCCommitment('execution-plan', executionPlan) };
}
export type ModeCCompiled = ReturnType<typeof compileModeC>;

export type ModeCRead = (method: string, params?: readonly unknown[]) => Promise<unknown>;
/** Same fixed factory/pair/fee/slot0 mechanism as existing liquidity reads, with a separate authorizing profile. */
export async function collectModeCObservation(call: ModeCRead, p: Pick<ModeCPolicy, 'source' | 'semanticWorkflowHash'>,
  nodeId: string, now: number): Promise<{ artifact: QuoteStateArtifact; raw: string }> {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('MODE_C_CLOCK_INVALID');
  const transcript: unknown[] = [];
  const read = async (method: string, params: readonly unknown[] = []) => {
    const result = await call(method, params); transcript.push({ method, params, result }); return result;
  };
  if (await read('eth_chainId') !== '0x7a69') throw new Error('MODE_C_WRONG_CHAIN');
  const head = await read('eth_getBlockByNumber', ['latest', false]) as { hash?: string; number?: string; timestamp?: string };
  const quantity = (v: unknown): bigint => { if (typeof v !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(v)) throw new Error('MODE_C_OBSERVATION_INVALID'); return BigInt(v); };
  if (!head || !/^0x[0-9a-f]{64}$/.test(head.hash ?? '')) throw new Error('MODE_C_OBSERVATION_INVALID');
  const block = Number(quantity(head.number)), observedAt = Number(quantity(head.timestamp));
  if (!Number.isSafeInteger(block) || !Number.isSafeInteger(observedAt) || now < observedAt ||
    now >= observedAt + p.source.maximumAgeSeconds) throw new Error('MODE_C_STALE_OBSERVATION');
  const at = { blockHash: head.hash, requireCanonical: true };
  const word = (v: string) => v.slice(2).padStart(64,'0');
  const rpc = (to: string, data: string) => read('eth_call', [{ to, data }, at]);
  const scalar = (v: unknown): bigint => { if (typeof v !== 'string' || !/^0x[0-9a-f]{64}$/.test(v)) throw new Error('MODE_C_OBSERVATION_INVALID'); return BigInt(v); };
  if (scalar(await rpc(MODE_C_FACTORY, '0x1698ee82' + word(MODE_C_WETH) + word(MODE_C_USDC) + (500n).toString(16).padStart(64,'0'))) !== BigInt(p.source.pool))
    throw new Error('MODE_C_POOL_MISMATCH');
  const code = await read('eth_getCode', [p.source.pool, at]);
  if (typeof code !== 'string' || !/^0x(?:[0-9a-f]{2})+$/.test(code) || modeBCodeHash(code) !== p.source.poolCodeHash)
    throw new Error('MODE_C_UNVERIFIABLE_STATE');
  for (const [selector, expected] of [['0xc45a0155',BigInt(MODE_C_FACTORY)],['0x0dfe1681',BigInt(MODE_C_WETH)],
    ['0xd21220a7',BigInt(MODE_C_USDC)],['0xddca3f43',500n]] as const)
    if (scalar(await rpc(p.source.pool, selector)) !== expected) throw new Error('MODE_C_POOL_MISMATCH');
  for (const [token, decimals] of [[MODE_C_WETH,18n],[MODE_C_USDC,6n]] as const)
    if (scalar(await rpc(token,'0x313ce567')) !== decimals) throw new Error('MODE_C_POOL_MISMATCH');
  const slot = await rpc(p.source.pool, '0x3850c7bd');
  if (typeof slot !== 'string' || !/^0x[0-9a-f]{448}$/.test(slot)) throw new Error('MODE_C_OBSERVATION_INVALID');
  const words = Array.from({length:7},(_,i) => BigInt('0x'+slot.slice(2+i*64,66+i*64)));
  const sqrt = words[0]!, signedTick = words[1]!;
  const tick = Number(signedTick >= (1n<<255n) ? signedTick - (1n<<256n) : signedTick);
  if (!Number.isSafeInteger(tick) || tick < -887272 || tick > 887272 || words[6] !== 1n || words[2]! > 65535n || words[3]! > 65535n || words[4]! > 65535n || words[5]! > 255n ||
    sqrt < sqrtRatioAtTick(tick) || (tick < 887272 && sqrt >= sqrtRatioAtTick(tick+1))) throw new Error('MODE_C_OBSERVATION_INVALID');
  const tail = await read('eth_getBlockByNumber', ['0x'+block.toString(16),false]) as {hash?:string;timestamp?:string};
  if (!tail || tail.hash !== head.hash || tail.timestamp !== head.timestamp) throw new Error('MODE_C_UNVERIFIABLE_STATE');
  const raw = canonicalJson(transcript);
  const artifact = validateArtifact('quote-state-artifact', { schemaVersion:'1.0.0', artifactId:`dip-observation-${block}-${head.hash!.slice(2,10)}`,
    semanticWorkflowHash:p.semanticWorkflowHash,nodeId,sourceId:MODE_C_SOURCE,adapter:{id:'uniswap-v3.pool-state.build016',version:'1.0.0'},
    chainId:'eip155:31337',chainPosition:{kind:'BLOCK',height:block},retrievedAt:new Date(now*1000).toISOString(),
    freshness:{observedAt:new Date(observedAt*1000).toISOString(),expiresAt:new Date((observedAt+p.source.maximumAgeSeconds)*1000).toISOString(),maximumAgeSeconds:p.source.maximumAgeSeconds},
    rawResponseHash:hashRawBytes('raw-response',bytes.encode(raw)),normalizedValues:[
      ...Object.entries({'pool':p.source.pool,'pool-code-hash':p.source.poolCodeHash,'factory':MODE_C_FACTORY,
        token0:MODE_C_WETH,token1:MODE_C_USDC,'sqrt-price-x96':sqrt.toString(),'block-hash':head.hash!})
        .map(([name,value])=>({name,kind:'IDENTIFIER',value})),{name:'fee',kind:'INTEGER',value:500}],
    providerReference:{kind:'NONE'},proposedContracts:[],proposedSpenders:[],proposedRecipients:[],fees:[],gas:[],outputBounds:[],
    uncertainty:[{code:'SPOT_PRICE',description:'Local-only pool spot price; manipulation is not prevented by this source.'}],
    registryValidation:{registryVersion:'1.0.0',actionType:'asset.swap.exact-input',result:'CONTRACT_VALIDATED',enforcement:'NOT_ENFORCED'} });
  readModeCPoolObservation(artifact,p);
  return {artifact,raw};
}

/** Constructor payload for the read-only verifier. Signed owner deployment binds both commitments. */
export function modeCVerifierArguments(c: ModeCCompiled): string {
  const p = c.policy, r = readModeCPoolObservation(p.reference,p);
  const values = [BigInt(p.roles),BigInt(p.source.pool),BigInt(p.source.poolCodeHash),BigInt(c.policyHash),BigInt(c.manifestHash),
    BigInt(p.referenceHash),BigInt(r.blockHash),BigInt(r.blockNumber),r.sqrt,BigInt(r.observedAt),BigInt(p.startsAt),BigInt(p.expiresAt),
    BigInt(p.source.maximumAgeSeconds),BigInt(modeBCodeHash(p.swapCalldata))];
  return values.map(v=>v.toString(16).padStart(64,'0')).join('');
}
