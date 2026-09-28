// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-007 loopback-only Safe/Roles composition service. No public RPC or arbitrary transaction route. */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createReviewContext, validateAuthoringWorkflow, validateCompositionWorkflow } from '@defi-workflow-engine/reference-linter';
import { compileComposition, buildCompositionMintCall, planCompositionMint, modeBCodeHash,
  LIQUIDITY_FACTORY, LIQUIDITY_USDC, LIQUIDITY_WETH, POSITION_MANAGER, FORK_CONTRACTS, BASE_CODE_PINS,
  type CompositionCompiled, type CompositionTerms, type PoolState } from '@defi-workflow-engine/reference-compiler';
import { createCompositionWorker, signModeBLocalTransaction, type CompositionEvent } from '@defi-workflow-engine/reference-executor';
import { reconcileModeB, reconcileCompositionMint, decodeModeBSignedTransaction,
  type CompositionMintEvidence } from '@defi-workflow-engine/reference-reconciler';
import { hashArtifactBytes, hashRawBytes, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
import type { ModeBServerProfile } from './mode-b-service';
import type { ForkCall } from './mode-a-service';

const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]?.id,
  actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });
const HASH = /^0x[0-9a-f]{64}$/;
const word = (n: bigint) => n.toString(16).padStart(64, '0');
const aw = (v: string) => v.slice(2).padStart(64, '0');
const num = (v: unknown): bigint => { if (typeof v !== 'string' || !/^0x[0-9a-f]+$/.test(v)) throw new Error('COMPOSITION_RPC_INVALID'); return BigInt(v); };
const resultWord = (v: unknown, i = 0): bigint => {
  if (typeof v !== 'string' || !/^0x(?:[0-9a-f]{64})+$/.test(v) || v.length < 66 + i * 64) throw new Error('COMPOSITION_RPC_INVALID');
  return BigInt('0x' + v.slice(2 + i * 64, 66 + i * 64));
};
const resultAddress = (v: unknown, i = 0): string => {
  const n = resultWord(v, i); if (n >> 160n) throw new Error('COMPOSITION_RPC_INVALID');
  return '0x' + n.toString(16).padStart(40, '0');
};
const signed24 = (v: bigint) => { const n = v & ((1n << 24n) - 1n); return Number(n >= 1n << 23n ? n - (1n << 24n) : n); };
const codeHash = (v: string) => '0x' + createHash('sha256').update(Buffer.from(v.slice(2), 'hex')).digest('hex');
const iso = (v: number) => new Date(v * 1000).toISOString();
const rawBytes = (v: string) => Uint8Array.from(Buffer.from(v.slice(2), 'hex'));
const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const headHash = (v: unknown) => { if (typeof v !== 'string' || !HASH.test(v)) throw new Error('COMPOSITION_BLOCK_INVALID'); return v; };

export type CompositionServerProfile = Omit<ModeBServerProfile, 'environment'> & {
  readonly environment: 'MOCKED' | 'FORK_REPRODUCED';
  readonly syntheticCodePins?: Partial<Record<keyof typeof BASE_CODE_PINS, string>>;
  readonly liquidity: { readonly pool: string; readonly fee: 500; readonly poolCodeHash: string;
    readonly managerCodeHash: string; readonly factoryCodeHash: string; readonly usdcCodeHash: string; readonly wethCodeHash: string;
    readonly routerCodeHash?: string; readonly quoterCodeHash?: string };
};
export type CompositionPrepared = { readonly format: 'gryloo.composition-prepared.v1'; readonly executionId: string;
  readonly revision: number; readonly workflowHash: string; readonly preparedAt: string; readonly sourceBlockHash: string;
  readonly quoteExpiresAt: number; readonly quoteOut: string; readonly minimumOut: string;
  readonly terms: { readonly swap: { readonly amountIn: string; readonly amountOutMinimum: string; readonly deadline: string };
    readonly tickLower: number; readonly tickUpper: number; readonly maxWETH: string; readonly maxUSDC: string;
    readonly minWETH: string; readonly minUSDC: string; readonly totalUSDCBudget: string; readonly mintDeadline: string };
  readonly compiled: CompositionCompiled;
  readonly artifacts: { readonly quote: unknown; readonly poolState: unknown; readonly artifactSet: unknown; readonly simulation: unknown;
    readonly policy: unknown; readonly manifest: unknown; readonly plan: unknown; readonly matrix: unknown;
    readonly hashes: { readonly artifactSetHash: string; readonly simulationHash: string; readonly policyHash: string;
      readonly manifestHash: string; readonly planHash: string; readonly simulationRawHash: string } };
  readonly installation: readonly { readonly index: number; readonly hash: string }[];
  readonly revocation: readonly { readonly index: number; readonly hash: string }[];
  readonly beforeUSDC: string; readonly beforeWETH: string; readonly beforeUSDCBlock: string;
};
const serializeTerms = (t: CompositionTerms): CompositionPrepared['terms'] => ({ swap: { amountIn: t.swap.amountIn.toString(),
  amountOutMinimum: t.swap.amountOutMinimum.toString(), deadline: t.swap.deadline.toString() }, tickLower: t.tickLower,
  tickUpper: t.tickUpper, maxWETH: t.maxWETH.toString(), maxUSDC: t.maxUSDC.toString(), minWETH: t.minWETH.toString(),
  minUSDC: t.minUSDC.toString(), totalUSDCBudget: t.totalUSDCBudget.toString(), mintDeadline: t.mintDeadline.toString() });
function deserializeTerms(t: CompositionPrepared['terms'], safe: string): CompositionTerms {
  return { swap: { tokenIn: LIQUIDITY_USDC, tokenOut: LIQUIDITY_WETH, fee: 500, recipient: safe,
    amountIn: BigInt(t.swap.amountIn), amountOutMinimum: BigInt(t.swap.amountOutMinimum),
    sqrtPriceLimitX96: 0n, deadline: BigInt(t.swap.deadline) }, poolFee: 500,
    tickLower: t.tickLower, tickUpper: t.tickUpper, maxWETH: BigInt(t.maxWETH), maxUSDC: BigInt(t.maxUSDC),
    minWETH: BigInt(t.minWETH), minUSDC: BigInt(t.minUSDC), totalUSDCBudget: BigInt(t.totalUSDCBudget),
    mintDeadline: BigInt(t.mintDeadline) };
}
export function createCompositionService(profile: CompositionServerProfile, call: ForkCall) {
  if (profile.format !== 'gryloo.mode-b-fork-profile.v1' || profile.chainId !== 31337 ||
      profile.sourceChainId !== 8453 || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(profile.rpcUrl) ||
      !isAbsolute(profile.journalDir) || profile.liquidity.fee !== 500 ||
      !/^0x[0-9a-f]{40}$/.test(profile.liquidity.pool) ||
      [profile.liquidity.poolCodeHash, profile.liquidity.managerCodeHash, profile.liquidity.factoryCodeHash,
        profile.liquidity.usdcCodeHash, profile.liquidity.wethCodeHash].some(v => !HASH.test(v)))
    throw new Error('COMPOSITION_PROFILE_INVALID');
  async function authorityBoundary(hash: string) {
    const [safeCode, rolesCode] = await Promise.all([
      call('eth_getCode', [profile.safe, { blockHash: hash, requireCanonical: true }]),
      call('eth_getCode', [profile.roles, { blockHash: hash, requireCanonical: true }]),
    ]);
    if (modeBCodeHash(String(safeCode)) !== profile.safeCodeHash ||
        modeBCodeHash(String(rolesCode)) !== profile.rolesCodeHash) throw new Error('COMPOSITION_AUTHORITY_CODE_CHANGED');
    const [owner, avatar, target, owners, threshold] = await Promise.all([
      ethCall(profile.roles, '0x8da5cb5b', hash), ethCall(profile.roles, '0x5aef7de6', hash),
      ethCall(profile.roles, '0xd4b83992', hash), ethCall(profile.safe, '0xa0e67e2b', hash),
      ethCall(profile.safe, '0xe75235b8', hash),
    ]);
    if (![profile.owner, profile.safe].includes(resultAddress(owner)) || resultAddress(avatar) !== profile.safe ||
        resultAddress(target) !== profile.safe || resultWord(owners, 1) !== 1n ||
        resultAddress(owners, 2) !== profile.owner || resultWord(threshold) !== 1n)
      throw new Error('COMPOSITION_AUTHORITY_SETUP_CHANGED');
  }
  const path = (id: string) => {
    if (!/^exec-[0-9a-f]{24}$/.test(id)) throw new Error('COMPOSITION_EXECUTION_INVALID');
    return join(profile.journalDir, id, 'composition.json');
  };
  async function read(id: string): Promise<CompositionPrepared> {
    const v = JSON.parse(await readFile(path(id), 'utf8')) as CompositionPrepared;
    if (v?.format !== 'gryloo.composition-prepared.v1' || v.executionId !== id) throw new Error('COMPOSITION_RECORD_INVALID');
    return v;
  }
  async function save(v: CompositionPrepared) {
    const dir = join(profile.journalDir, v.executionId), target = path(v.executionId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = target + '.' + randomBytes(8).toString('hex') + '.tmp';
    const h = await open(temp, 'wx', 0o600);
    try { await h.writeFile(JSON.stringify(v)); await h.sync(); } finally { await h.close(); }
    await rename(temp, target);
    const directory = await open(dir, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
  async function atHead() {
    if (await call('eth_chainId') !== '0x7a69') throw new Error('COMPOSITION_WRONG_CHAIN');
    const meta = await call('anvil_metadata') as { forkedNetwork?: { chainId?: number; forkBlockNumber?: number; forkBlockHash?: string } };
    if (Number(meta?.forkedNetwork?.chainId) !== 8453 || Number(meta?.forkedNetwork?.forkBlockNumber) !== profile.sourceBlockNumber ||
        meta?.forkedNetwork?.forkBlockHash !== profile.sourceBlockHash) throw new Error('COMPOSITION_SOURCE_CHANGED');
    const b = await call('eth_getBlockByNumber', ['latest', false]) as { hash?: string; number?: string; timestamp?: string; baseFeePerGas?: string };
    return { hash: headHash(b.hash), number: Number(num(b.number)), timestamp: Number(num(b.timestamp)), baseFee: num(b.baseFeePerGas) };
  }
  async function ethCall(to: string, data: string, hash: string) {
    return call('eth_call', [{ to, data }, { blockHash: hash, requireCanonical: true }]);
  }
  async function pin(to: string, expected: string, hash: string) {
    const code = await call('eth_getCode', [to, { blockHash: hash, requireCanonical: true }]);
    if (typeof code !== 'string' || codeHash(code) !== expected) throw new Error('COMPOSITION_CODE_PIN_MISMATCH');
  }
  async function poolState(at: Awaited<ReturnType<typeof atHead>>): Promise<PoolState> {
    const b = at.hash, pins = profile.liquidity;
    const pool = resultAddress(await ethCall(LIQUIDITY_FACTORY, `0x1698ee82${aw(LIQUIDITY_WETH)}${aw(LIQUIDITY_USDC)}${word(500n)}`, b));
    if (pool !== pins.pool) throw new Error('COMPOSITION_POOL_MISMATCH');
    for (const [to, digest] of [[pool, pins.poolCodeHash], [POSITION_MANAGER, pins.managerCodeHash],
      [LIQUIDITY_FACTORY, pins.factoryCodeHash], [LIQUIDITY_USDC, pins.usdcCodeHash], [LIQUIDITY_WETH, pins.wethCodeHash]] as const)
      await pin(to, digest, b);
    const [factory, managerFactory, managerWeth, token0, token1, fee, spacing, slot] = await Promise.all([
      ethCall(pool, '0xc45a0155', b), ethCall(POSITION_MANAGER, '0xc45a0155', b), ethCall(POSITION_MANAGER, '0x4aa4a4fc', b),
      ethCall(pool, '0x0dfe1681', b), ethCall(pool, '0xd21220a7', b), ethCall(pool, '0xddca3f43', b),
      ethCall(pool, '0xd0c93a7c', b), ethCall(pool, '0x3850c7bd', b),
    ]);
    if (resultAddress(factory) !== LIQUIDITY_FACTORY || resultAddress(managerFactory) !== LIQUIDITY_FACTORY ||
        resultAddress(managerWeth) !== LIQUIDITY_WETH || resultAddress(token0) !== LIQUIDITY_WETH ||
        resultAddress(token1) !== LIQUIDITY_USDC || resultWord(fee) !== 500n || signed24(resultWord(spacing)) !== 10)
      throw new Error('COMPOSITION_POOL_IDENTITY_INVALID');
    return { sourceChainId: 8453, executionChainId: 31337, sourceBlockHash: profile.sourceBlockHash,
      sourceBlockNumber: profile.sourceBlockNumber, pool, factory: LIQUIDITY_FACTORY, positionManager: POSITION_MANAGER,
      token0: LIQUIDITY_WETH, token1: LIQUIDITY_USDC, fee: 500, tickSpacing: 10, tick: signed24(resultWord(slot, 1)),
      sqrtPriceX96: resultWord(slot), poolCodeHash: pins.poolCodeHash, positionManagerCodeHash: pins.managerCodeHash,
      observedAtMs: at.timestamp * 1000, expiresAtMs: (at.timestamp + 60) * 1000 };
  }
  async function tokenBalance(token: string, owner: string, hash: string) {
    return resultWord(await ethCall(token, '0x70a08231' + aw(owner), hash));
  }
  async function tokenAllowance(token: string, spender: string, hash: string) {
    return resultWord(await ethCall(token, '0xdd62ed3e' + aw(profile.safe) + aw(spender), hash));
  }
  async function rolesRemaining(key: string, hash: string) {
    return resultWord(await ethCall(profile.roles, '0x5e7c9fe8' + key.slice(2), hash), 3);
  }
  async function permissionActive(hash: string) {
    const safe = resultWord(await ethCall(profile.safe, '0x2d9ad53d' + aw(profile.roles), hash)) === 1n;
    const executor = resultWord(await ethCall(profile.roles, '0x2d9ad53d' + aw(profile.executor), hash)) === 1n;
    const owner = resultAddress(await ethCall(profile.roles, '0x8da5cb5b', hash));
    return safe && executor && owner === profile.safe;
  }
  function artifacts(input: { workflow: SemanticWorkflow; executionId: string; workflowHash: string;
    at: Awaited<ReturnType<typeof atHead>>; pool: PoolState; quoteOut: bigint; minimumOut: bigint;
    terms: CompositionTerms; simulated: unknown; simulationRawHash: string;
    swapPayloadHash: string; representativeMintPayloadHash: string }) {
    const { workflow, executionId, workflowHash, at, pool, quoteOut, minimumOut, terms } = input;
    const chain = 'eip155:31337', owner = { chainId: chain, address: profile.safe };
    const usdc = { chainId: chain, address: LIQUIDITY_USDC, decimals: 6 };
    const weth = { chainId: chain, address: LIQUIDITY_WETH, decimals: 18 };
    const nft = { chainId: chain, address: POSITION_MANAGER, decimals: 0 };
    const gas = { chainId: chain, nativeId: 'ETH', decimals: 18 };
    const swapAdapter = { id: 'uniswap.router02', version: '1.0.0' };
    const mintAdapter = { id: 'uniswap-v3.position-manager', version: '1.0.0' };
    const freshness = { observedAt: iso(at.timestamp), expiresAt: iso(at.timestamp + 60), maximumAgeSeconds: 60 };
    const uncertainty = [
      { code: profile.environment === 'MOCKED' ? 'MOCKED_SYNTHETIC_CONTRACTS' : 'FORK_REPRODUCED_NOT_MAINNET',
        description: profile.environment === 'MOCKED' ? 'Synthetic source is engineering rehearsal only.' : 'Recorded Base state runs on local chain 31337; no public-chain effect.' },
      { code: 'PARTIAL_COMPLETION_POSSIBLE', description: 'The swap can succeed while the dependent mint fails; Safe residuals remain.' },
      { code: 'FUTURE_POOL_STATE_UNKNOWN', description: 'Mint amounts are chosen again from the pool state after swap reconciliation.' },
    ];
    const contract = (address: string) => ({ chainId: chain, address, version: 'reviewed-code-pin' });
    const quote = validateArtifact('quote-state-artifact', { schemaVersion: '1.0.0', artifactId: `${executionId}.swap-quote`,
      semanticWorkflowHash: workflowHash, nodeId: workflow.nodes[0]!.nodeId, sourceId: 'fork.anvil-31337', adapter: swapAdapter,
      chainId: chain, chainPosition: { kind: 'BLOCK', height: at.number }, retrievedAt: iso(at.timestamp), freshness,
      rawResponseHash: hashRawBytes('raw-response', encode({ blockHash: at.hash, quoteOut: quoteOut.toString(), fee: 500 })),
      normalizedValues: [{ name: 'fee-tier', kind: 'INTEGER', value: 500 },
        { name: 'swap-input', kind: 'QUANTITY', value: { asset: usdc, amount: terms.swap.amountIn.toString() } },
        { name: 'quoted-weth', kind: 'QUANTITY', value: { asset: weth, amount: quoteOut.toString() } },
        { name: 'minimum-weth', kind: 'QUANTITY', value: { asset: weth, amount: minimumOut.toString() } }],
      providerReference: { kind: 'NONE' }, proposedContracts: [LIQUIDITY_USDC, LIQUIDITY_WETH, FORK_CONTRACTS.router, FORK_CONTRACTS.quoter].map(contract),
      proposedSpenders: [{ chainId: chain, address: FORK_CONTRACTS.router }], proposedRecipients: [owner], fees: [], gas: [],
      outputBounds: [{ outputId: 'amount-out', expected: { asset: weth, amount: quoteOut.toString() },
        minimum: { asset: weth, amount: minimumOut.toString() }, adverse: { asset: weth, amount: minimumOut.toString() } }],
      uncertainty, registryValidation: { registryVersion: referenceRegistry.registryVersion,
        actionType: 'asset.swap.exact-input', result: 'CONTRACT_VALIDATED', enforcement: 'NOT_ENFORCED' } });
    const poolState = validateArtifact('quote-state-artifact', { schemaVersion: '1.0.0', artifactId: `${executionId}.pool-state`,
      semanticWorkflowHash: workflowHash, nodeId: workflow.nodes[1]!.nodeId, sourceId: 'fork.anvil-31337', adapter: mintAdapter,
      chainId: chain, chainPosition: { kind: 'BLOCK', height: at.number }, retrievedAt: iso(at.timestamp), freshness,
      rawResponseHash: hashRawBytes('raw-response', encode({ blockHash: at.hash, pool: pool.pool, tick: pool.tick,
        sqrtPriceX96: pool.sqrtPriceX96.toString() })),
      normalizedValues: [{ name: 'pool', kind: 'IDENTIFIER', value: pool.pool },
        { name: 'tick', kind: 'IDENTIFIER', value: `tick:${pool.tick}` },
        { name: 'sqrt-price-x96', kind: 'IDENTIFIER', value: pool.sqrtPriceX96.toString() },
        { name: 'fee-tier', kind: 'INTEGER', value: 500 }],
      providerReference: { kind: 'NONE' }, proposedContracts: [LIQUIDITY_FACTORY, pool.pool, POSITION_MANAGER, LIQUIDITY_USDC, LIQUIDITY_WETH].map(contract),
      proposedSpenders: [{ chainId: chain, address: POSITION_MANAGER }], proposedRecipients: [owner], fees: [], gas: [],
      outputBounds: [{ outputId: 'position-nft', expected: { asset: nft, amount: '1' },
        minimum: { asset: nft, amount: '1' }, adverse: { asset: nft, amount: '1' } }],
      uncertainty, registryValidation: { registryVersion: referenceRegistry.registryVersion,
        actionType: 'asset.liquidity.uniswap-v3', result: 'CONTRACT_VALIDATED', enforcement: 'NOT_ENFORCED' } });
    const quoteHash = hashArtifactBytes('quote-state-artifact', encode(quote));
    const poolHash = hashArtifactBytes('quote-state-artifact', encode(poolState));
    const artifactSet = validateArtifact('artifact-set', { schemaVersion: '1.0.0', artifactSetId: `${executionId}.set`,
      semanticWorkflowHash: workflowHash, artifacts: [
        { artifactId: quote.artifactId, nodeId: quote.nodeId, artifactHash: quoteHash },
        { artifactId: poolState.artifactId, nodeId: poolState.nodeId, artifactHash: poolHash },
      ] });
    const artifactSetHash = hashArtifactBytes('artifact-set', encode(artifactSet));
    const simulation = validateArtifact('simulation-bundle', { schemaVersion: '1.0.0', simulationId: `${executionId}.simulation`,
      semanticWorkflowRevision: workflow.revision, semanticWorkflowHash: workflowHash, artifactSetHash,
      adapters: [swapAdapter, mintAdapter], contracts: [FORK_CONTRACTS.router, pool.pool, POSITION_MANAGER].map(contract),
      outputs: [{ nodeId: quote.nodeId, outputId: 'amount-out', expected: { asset: weth, amount: quoteOut.toString() },
        minimum: { asset: weth, amount: minimumOut.toString() }, adverse: { asset: weth, amount: minimumOut.toString() } },
        { nodeId: poolState.nodeId, outputId: 'position-nft', expected: { asset: nft, amount: '1' },
          minimum: { asset: nft, amount: '1' }, adverse: { asset: nft, amount: '1' } }],
      propagatedOutputs: [{ fromNodeId: quote.nodeId, outputId: 'amount-out', toNodeId: poolState.nodeId,
        inputName: 'weth-from-swap', quantity: { asset: weth, amount: minimumOut.toString() } }],
      failurePaths: [{ failedNodeId: quote.nodeId, blockedNodeIds: [poolState.nodeId], residualAssets: [] },
        { failedNodeId: poolState.nodeId, blockedNodeIds: [], residualAssets: [
          { asset: weth, amount: minimumOut.toString() }, { asset: usdc, amount: terms.maxUSDC.toString() }] }],
      uncertainty, unsupportedAssumptions: [
        'A later pool state can change the deposit ratio; the worker re-reads it after the swap.',
        'A successful swap is never automatically reversed if mint fails.'], freshness });
    const simulationHash = hashArtifactBytes('simulation-bundle', encode(simulation));
    const spendLimits = [
      { asset: usdc, maximumAmount: terms.totalUSDCBudget.toString(), maximumPerStepAmount: terms.swap.amountIn.toString(),
        maximumCumulativeAmount: terms.totalUSDCBudget.toString() },
      { asset: weth, maximumAmount: terms.maxWETH.toString(), maximumPerStepAmount: terms.maxWETH.toString(),
        maximumCumulativeAmount: terms.maxWETH.toString() },
    ];
    const gasBudgets = [{ asset: gas, maximumAmount: (5_000_000n * (at.baseFee * 2n + 1_000_000n) * 2n).toString() }];
    const provider = { kind: 'FIXED' as const, providerId: 'uniswap-500' };
    const recovery = { failurePolicy: 'ABORT' as const, residualAssetRecipient: owner, maximumAttemptsPerStep: 1,
      requiresHumanReview: true as const };
    const policy = validateArtifact('authorization-policy', { schemaVersion: '1.0.0', policyId: `${executionId}.policy`,
      semanticWorkflowHash: workflowHash, artifactSetHash, simulationHash, requiredAuthorizationClass: 'MODE_B',
      allowlists: { owners: [owner], accounts: [owner], recipients: [owner], chains: [chain], adapters: [swapAdapter, mintAdapter],
        protocols: ['uniswap', 'uniswap-v3'], contracts: [FORK_CONTRACTS.router, POSITION_MANAGER, LIQUIDITY_USDC, LIQUIDITY_WETH].map(contract),
        functions: [{ chainId: chain, contract: FORK_CONTRACTS.router, functionId: '0x5ae401dc' },
          { chainId: chain, contract: POSITION_MANAGER, functionId: '0x88316456' }] },
      budgetReservation: { rule: 'RESERVE_BEFORE_SUBMISSION', concurrentConsumption: 'CUMULATIVE_ACROSS_BRANCHES',
        implementation: 'NOT_IMPLEMENTED' },
      spendLimits, maximumSlippageBps: validateCompositionWorkflow(workflow, context).slippageBps, gasBudgets,
      feeBudgets: [], oracleRules: [], accountRiskRules: [], checkpointRules: [], providers: provider,
      nonce: '0', deadline: iso(Number(terms.mintDeadline)), revocationEpoch: 0, recovery,
      enforcement: 'NOT_ENFORCED' });
    const policyHash = hashArtifactBytes('authorization-policy', encode(policy));
    const manifest = validateArtifact('strategy-manifest', { schemaVersion: '1.0.0', manifestId: `${executionId}.manifest`,
      semanticWorkflowRevision: workflow.revision, semanticWorkflowHash: workflowHash, artifactSetHash, simulationHash, policyHash,
      authorizationMode: 'MODE_B', owner, executor: { chainId: chain, address: profile.executor },
      expiresAt: iso(Number(terms.mintDeadline)), nonce: '0', revocationEpoch: 0, spendLimits,
      maximumSlippageBps: validateCompositionWorkflow(workflow, context).slippageBps, gasBudgets, feeBudgets: [],
      providers: provider, recovery, enforcement: 'NOT_ENFORCED' });
    const manifestHash = hashArtifactBytes('strategy-manifest', encode(manifest));
    const plan = validateArtifact('execution-plan', { schemaVersion: '1.0.0', executionPlanId: `${executionId}.plan`,
      semanticWorkflowHash: workflowHash, manifestHash, segments: [{ segmentId: `${executionId}.segment`, chainId: chain,
        dependencies: [], steps: [
          { stepId: 'swap', nodeId: quote.nodeId, chainId: chain, adapter: swapAdapter, dependencies: [],
            requiredAuthorizationClass: 'MODE_B', executionKind: 'DIRECT_TRANSACTION', payloadHash: input.swapPayloadHash },
          { stepId: 'mint', nodeId: poolState.nodeId, chainId: chain, adapter: mintAdapter, dependencies: ['swap'],
            requiredAuthorizationClass: 'MODE_B', executionKind: 'DIRECT_TRANSACTION', payloadHash: input.representativeMintPayloadHash },
        ] }], checkpointIds: ['swap-reconciled'], enforcement: 'NOT_ENFORCED' });
    const planHash = hashArtifactBytes('execution-plan', encode(plan));
    const matrix = { format: 'gryloo.mode-b-composition-enforcement.v1', executionId, semanticWorkflowHash: workflowHash,
      artifactSetHash, simulationHash, policyHash, manifestHash, planHash, sourceBlockHash: pool.sourceBlockHash,
      limits: [
        { field: 'chain', value: 31337, location: 'SMART_ACCOUNT_MODULE_OR_GUARD' },
        { field: 'swap-target-and-calldata', value: FORK_CONTRACTS.router, location: 'SMART_ACCOUNT_MODULE_OR_GUARD' },
        { field: 'mint-target-and-selector', value: POSITION_MANAGER, location: 'SMART_ACCOUNT_MODULE_OR_GUARD' },
        { field: 'mint-pair-fee-ticks-recipient-and-caps', value: `${terms.tickLower}:${terms.tickUpper}`, location: 'SMART_ACCOUNT_MODULE_OR_GUARD' },
        { field: 'swap-minimum-and-deadline', value: minimumOut.toString(), location: 'PROTOCOL_VERIFIER' },
        { field: 'pool-freshness-and-step-order', value: at.hash, location: 'APPLICATION_GATEWAY' },
        { field: 'gas-cap', value: gasBudgets[0]!.maximumAmount, location: 'APPLICATION_GATEWAY' },
      ], limitations: ['Safe owner retains broader authority.', 'Permission hash alone does not enforce any bound.',
        'Application step order and gas caps are not Roles-enforced.', 'A confirmed swap cannot be rolled back automatically.'] };
    return { quote, poolState, artifactSet, simulation, policy, manifest, plan, matrix,
      hashes: { artifactSetHash, simulationHash, policyHash, manifestHash, planHash, simulationRawHash: input.simulationRawHash } };
  }
  async function prepare(input: SemanticWorkflow): Promise<CompositionPrepared> {
    const boundaryHead = await atHead();
    await authorityBoundary(boundaryHead.hash);
    const workflow = validateArtifact('semantic-workflow', validateAuthoringWorkflow(input, context));
    const details = validateCompositionWorkflow(workflow, context);
    if (details.recipient !== profile.safe) throw new Error('COMPOSITION_SAFE_RECIPIENT_REQUIRED');
    const at = await atHead();
    const pool = await poolState(at);
    for (const [name, address] of Object.entries(FORK_CONTRACTS)) {
      if (name in BASE_CODE_PINS) {
        const code = await call('eth_getCode', [address, { blockHash: at.hash, requireCanonical: true }]);
        if (typeof code !== 'string' || codeHash(code) !== (profile.environment === 'MOCKED'
          ? profile.syntheticCodePins?.[name as keyof typeof BASE_CODE_PINS] : BASE_CODE_PINS[name as keyof typeof BASE_CODE_PINS]))
          throw new Error('COMPOSITION_BASE_CODE_PIN_MISMATCH');
      }
    }
    const quoteRaw = await ethCall(FORK_CONTRACTS.quoter,
      `0xc6a5026a${aw(LIQUIDITY_USDC)}${aw(LIQUIDITY_WETH)}${word(details.inputUSDC)}${word(500n)}${word(0n)}`, at.hash);
    const quoteOut = resultWord(quoteRaw);
    const minimumOut = quoteOut * BigInt(10_000 - details.slippageBps) / 10_000n;
    if (minimumOut < details.minWETH || quoteOut <= 0n) throw new Error('COMPOSITION_QUOTE_BELOW_MINIMUM');
    const [beforeUSDC, beforeWETH] = await Promise.all([
      tokenBalance(LIQUIDITY_USDC, profile.safe, at.hash), tokenBalance(LIQUIDITY_WETH, profile.safe, at.hash),
    ]);
    const totalUSDCBudget = details.inputUSDC + details.maxUSDC;
    if (beforeUSDC < totalUSDCBudget || beforeWETH !== 0n) throw new Error('COMPOSITION_SAFE_BALANCE_INVALID');
    const currentTime = at.timestamp;
    const deadline = BigInt(currentTime + 1800);
    const swap: CompositionTerms['swap'] = { tokenIn: LIQUIDITY_USDC, tokenOut: LIQUIDITY_WETH, fee: 500,
      recipient: profile.safe, amountIn: details.inputUSDC, amountOutMinimum: minimumOut,
      sqrtPriceLimitX96: 0n, deadline };
    const terms: CompositionTerms = { swap, poolFee: 500, tickLower: details.tickLower, tickUpper: details.tickUpper,
      maxWETH: details.maxWETH, maxUSDC: details.maxUSDC, minWETH: details.minWETH,
      minUSDC: details.minUSDC, totalUSDCBudget, mintDeadline: deadline };
    planCompositionMint(terms, minimumOut, details.maxUSDC, pool, at.timestamp * 1000);
    const workflowHash = hashArtifactBytes('semantic-workflow', encode(workflow));
    const quoteHash = hashRawBytes('raw-response', encode({ blockHash: at.hash, out: quoteOut.toString(), fee: 500 }));
    const nonce = num(await call('eth_getTransactionCount', [profile.owner, { blockHash: at.hash, requireCanonical: true }]));
    const executorNonce = num(await call('eth_getTransactionCount', [profile.executor, { blockHash: at.hash, requireCanonical: true }]));
    const enabled = resultWord(await ethCall(profile.safe, '0x2d9ad53d' + aw(profile.roles), at.hash)) === 1n;
    const rolesOwner = resultAddress(await ethCall(profile.roles, '0x8da5cb5b', at.hash));
    if (rolesOwner !== profile.owner && rolesOwner !== profile.safe) throw new Error('COMPOSITION_ROLES_OWNER_INVALID');
    const setup = { rolesOwnerIsSafe: rolesOwner === profile.safe, moduleEnabled: enabled };
    const salt = '0x' + createHash('sha256').update(JSON.stringify({ profile: 'BUILD-007-SALT', workflowHash,
      blockHash: at.hash, ownerNonce: nonce.toString(), executorNonce: executorNonce.toString() })).digest('hex');
    const routerCodeHash = modeBCodeHash(String(await call('eth_getCode', [FORK_CONTRACTS.router, 'latest'])));
    const managerCodeHash = modeBCodeHash(String(await call('eth_getCode', [POSITION_MANAGER, 'latest'])));
    const poolCodeHash = modeBCodeHash(String(await call('eth_getCode', [pool.pool, 'latest'])));
    const initialProfile = { ...profile, semanticWorkflowHash: workflowHash, quoteHash, artifactSetHash: '0x' + '0'.repeat(64),
      simulationHash: '0x' + '0'.repeat(64), policyHash: '0x' + '0'.repeat(64), manifestHash: '0x' + '0'.repeat(64),
      routerCodeHash, managerCodeHash, poolCodeHash };
    const provisional = compileComposition(initialProfile, terms, salt, setup);
    const choice = planCompositionMint(terms, quoteOut, details.maxUSDC, pool, at.timestamp * 1000);
    const mint = buildCompositionMintCall(provisional, choice.desiredWETH, choice.desiredUSDC);
    const maxFee = '0x' + (at.baseFee * 2n + 1_000_000_000n).toString(16);
    const ownerCalls = provisional.installation.map((tx, index) => ({ from: profile.owner, to: tx.to, data: tx.data,
      nonce: '0x' + (nonce + BigInt(index)).toString(16), gas: '0x4c4b40', maxFeePerGas: maxFee,
      maxPriorityFeePerGas: '0x3b9aca00', value: '0x0' }));
    const executorCalls = [provisional.swapCall, mint].map((tx, index) => ({ from: profile.executor, to: tx.to, data: tx.data,
      nonce: '0x' + (executorNonce + BigInt(index)).toString(16), gas: '0x4c4b40', maxFeePerGas: maxFee,
      maxPriorityFeePerGas: '0x3b9aca00', value: '0x0' }));
    const simulation = await call('eth_simulateV1', [{ blockStateCalls: [{ calls: [...ownerCalls, ...executorCalls] }],
      validation: true, traceTransfers: false, returnFullTransactions: false }, { blockHash: at.hash, requireCanonical: true }]);
    const simRows = (simulation as { calls?: { status?: string; gasUsed?: string }[] }[])?.[0]?.calls;
    if (!Array.isArray(simRows) || simRows.length !== ownerCalls.length + 2 || simRows.some(row => row.status !== '0x1'))
      throw new Error('COMPOSITION_CHAINED_SIMULATION_FAILED');
    if ((await atHead()).hash !== at.hash) throw new Error('COMPOSITION_HEAD_MOVED');
    const executionId = 'exec-' + createHash('sha256').update(JSON.stringify({ profile: 'BUILD-007-EXECUTION',
      workflowHash, blockHash: at.hash, ownerNonce: nonce.toString(), executorNonce: executorNonce.toString() })).digest('hex').slice(0, 24);
    const simulationRawHash = hashRawBytes('raw-response', encode(simulation));
    const chain = artifacts({ workflow, executionId, workflowHash, at, pool, quoteOut, minimumOut, terms,
      simulated: simulation, simulationRawHash,
      swapPayloadHash: hashRawBytes('payload', rawBytes(provisional.swapCall.data)),
      representativeMintPayloadHash: hashRawBytes('payload', rawBytes(mint.data)) });
    const compiled = compileComposition({ ...initialProfile, artifactSetHash: chain.hashes.artifactSetHash,
      simulationHash: chain.hashes.simulationHash, policyHash: chain.hashes.policyHash,
      manifestHash: chain.hashes.manifestHash }, terms, salt, setup);
    if (JSON.stringify(compiled.installation) !== JSON.stringify(provisional.installation) ||
        compiled.swapCall.data !== provisional.swapCall.data) throw new Error('COMPOSITION_SIMULATION_BINDING_CHANGED');
    const prepared: CompositionPrepared = { format: 'gryloo.composition-prepared.v1', executionId,
      revision: workflow.revision, workflowHash, preparedAt: iso(at.timestamp), sourceBlockHash: profile.sourceBlockHash,
      quoteExpiresAt: currentTime + 600, quoteOut: quoteOut.toString(), minimumOut: minimumOut.toString(),
      terms: serializeTerms(terms), compiled, artifacts: chain, installation: [], revocation: [],
      beforeUSDC: beforeUSDC.toString(), beforeWETH: beforeWETH.toString(), beforeUSDCBlock: at.hash };
    await save(prepared);
    return prepared;
  }
  async function installationStep(id: string, index: number) {
    const prepared = await read(id);
    if (index !== prepared.installation.length || prepared.revocation.length ||
        !prepared.compiled.installation[index]) throw new Error('COMPOSITION_STEP_ORDER_INVALID');
    if ((await atHead()).timestamp > prepared.quoteExpiresAt) throw new Error('COMPOSITION_QUOTE_EXPIRED');
    await authorityBoundary((await atHead()).hash);
    return prepared.compiled.installation[index]!;
  }
  async function confirm(id: string, phase: 'installation' | 'revocation', index: number, txHash: string) {
    if (!HASH.test(txHash) || !Number.isInteger(index)) throw new Error('COMPOSITION_CONFIRM_INVALID');
    const prepared = await read(id);
    const list = phase === 'installation' ? prepared.compiled.installation : prepared.compiled.revocation;
    const done = phase === 'installation' ? prepared.installation : prepared.revocation;
    if (!list[index] || index !== done.length) throw new Error('COMPOSITION_STEP_ORDER_INVALID');
    const receipt = await call('eth_getTransactionReceipt', [txHash]) as { status?: string } | null;
    const raw = await call('eth_getRawTransactionByHash', [txHash]);
    if (receipt?.status !== '0x1' || typeof raw !== 'string') throw new Error('COMPOSITION_TX_UNCONFIRMED');
    const signed = decodeModeBSignedTransaction(rawBytes(raw), txHash);
    if (signed.signer !== profile.owner || signed.to !== list[index].to || signed.data !== list[index].data)
      throw new Error('COMPOSITION_OWNER_CALL_MISMATCH');
    const next = { ...prepared, [phase]: [...done, { index, hash: txHash }] } as CompositionPrepared;
    await save(next);
    return next;
  }
  async function status(id: string) {
    const prepared = await read(id), at = await atHead();
    const [swapCalls, mintCalls, routerUSDC, managerUSDC, managerWETH, active] = await Promise.all([
      rolesRemaining(prepared.compiled.swapAllowanceKey, at.hash), rolesRemaining(prepared.compiled.mintAllowanceKey, at.hash),
      tokenAllowance(LIQUIDITY_USDC, FORK_CONTRACTS.router, at.hash), tokenAllowance(LIQUIDITY_USDC, POSITION_MANAGER, at.hash),
      tokenAllowance(LIQUIDITY_WETH, POSITION_MANAGER, at.hash), permissionActive(at.hash),
    ]);
    const eventPath = join(profile.journalDir, id, 'composition-events.jsonl');
    let events: readonly CompositionEvent[] = [];
    try { const data = await readFile(eventPath, 'utf8'); events = data.trimEnd().split('\n').map(line => JSON.parse(line) as CompositionEvent); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return { prepared, swapCalls: swapCalls.toString(), mintCalls: mintCalls.toString(),
      routerUSDC: routerUSDC.toString(), managerUSDC: managerUSDC.toString(), managerWETH: managerWETH.toString(),
      active, events };
  }
  async function worker(id: string, keyPath: string, operation: 'run' | 'recoverKnown' = 'run'): Promise<CompositionEvent> {
    const prepared = await read(id), terms = deserializeTerms(prepared.terms, profile.safe);
    if (prepared.installation.length !== prepared.compiled.installation.length || prepared.revocation.length)
      throw new Error('COMPOSITION_PERMISSION_NOT_INSTALLED');
    if (!isAbsolute(keyPath) || !keyPath.startsWith('/tmp/')) throw new Error('COMPOSITION_KEY_PATH_INVALID');
    const keyFile = await stat(keyPath);
    if (!keyFile.isFile() || (keyFile.mode & 0o077) !== 0) throw new Error('COMPOSITION_KEY_PERMISSIONS_INVALID');
    const sendExact = async (step: 'SWAP' | 'MINT', tx: { readonly to: string; readonly data: string; readonly value: '0x0' }) => {
      const mintReservation = step === 'MINT' ? (await readFile(eventPath, 'utf8')).trimEnd().split('\n')
        .map(line => JSON.parse(line) as CompositionEvent).find(e => e.level === 'ATTEMPT' && e.step === 'MINT' && e.state === 'RESERVED') : null;
      if (step === 'MINT' && (!mintReservation?.desiredWETH || !mintReservation.desiredUSDC))
        throw new Error('COMPOSITION_MINT_RESERVATION_MISSING');
      const expected = step === 'SWAP' ? prepared.compiled.swapCall :
        buildCompositionMintCall(prepared.compiled, BigInt(mintReservation!.desiredWETH!), BigInt(mintReservation!.desiredUSDC!));
      if (tx.to !== expected.to || tx.data !== expected.data || tx.value !== '0x0')
        throw new Error('COMPOSITION_WORKER_CALL_CHANGED');
      const raw = JSON.parse(await readFile(keyPath, 'utf8')) as { executor?: unknown };
      if (typeof raw.executor !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(raw.executor))
        throw new Error('COMPOSITION_LOCAL_KEY_INVALID');
      const key = rawBytes(raw.executor);
      let signed: ReturnType<typeof signModeBLocalTransaction>;
      try {
        const nonce = num(await call('eth_getTransactionCount', [profile.executor, 'pending']));
        const at = await atHead();
        signed = signModeBLocalTransaction({ expectedExecutor: profile.executor, to: tx.to, data: tx.data,
          nonce, gasLimit: 5_000_000n, maxFeePerGas: at.baseFee * 2n + 1_000_000n }, key);
      } finally { key.fill(0); }
      const response = await fetch(profile.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: [signed.raw] }),
        signal: AbortSignal.timeout(20_000) });
      const body = await response.json() as { result?: unknown; error?: unknown };
      if (!response.ok || body.error || body.result !== signed.hash) throw new Error('COMPOSITION_SEND_UNKNOWN');
      return signed.hash;
    };
    const eventPath = join(profile.journalDir, id, 'composition-events.jsonl');
    const receipt = async (txHash: string) => {
      const value = await call('eth_getTransactionReceipt', [txHash]) as { status?: string } | null;
      return value ? { status: value.status === '0x1' ? 1 as const : 0 as const } : null;
    };
    const reconcileSwap = async (txHash: string) => {
      const r = await call('eth_getTransactionReceipt', [txHash]) as { status?: string; blockHash?: string } | null;
      const raw = await call('eth_getRawTransactionByHash', [txHash]);
      if (!r || typeof raw !== 'string' || !HASH.test(r.blockHash ?? '')) return { outcome: 'INCONCLUSIVE' as const };
      const signed = decodeModeBSignedTransaction(rawBytes(raw), txHash);
      const bh = r.blockHash!;
      const [afterUSDC, afterWETH, swapCalls, routerAllowance, safeCode, rolesCode, active] = await Promise.all([
        tokenBalance(LIQUIDITY_USDC, profile.safe, bh), tokenBalance(LIQUIDITY_WETH, profile.safe, bh),
        rolesRemaining(prepared.compiled.swapAllowanceKey, bh), tokenAllowance(LIQUIDITY_USDC, FORK_CONTRACTS.router, bh),
        call('eth_getCode', [profile.safe, { blockHash: bh, requireCanonical: true }]),
        call('eth_getCode', [profile.roles, { blockHash: bh, requireCanonical: true }]), permissionActive(bh),
      ]);
      const outcome = reconcileModeB({ chainId: 31337, safe: profile.safe, roles: profile.roles, rolesOwner: profile.safe,
        executor: profile.executor, transactionSigner: signed.signer, target: FORK_CONTRACTS.router, transactionTo: signed.to,
        transactionInput: signed.data, expectedInput: prepared.compiled.swapCall.data,
        safeCodeHash: modeBCodeHash(String(safeCode)), expectedSafeCodeHash: profile.safeCodeHash,
        rolesCodeHash: modeBCodeHash(String(rolesCode)), expectedRolesCodeHash: profile.rolesCodeHash,
        owner: profile.owner, expectedOwner: profile.owner, threshold: 1, moduleEnabled: active, roleAssigned: active,
        allowanceRemaining: swapCalls, transactionReceipt: { status: r.status === '0x1' ? 1 : 0, blockHash: bh },
        inputDebited: BigInt(prepared.beforeUSDC) - afterUSDC, outputCredited: afterWETH - BigInt(prepared.beforeWETH),
        amountIn: terms.swap.amountIn, minimumOut: terms.swap.amountOutMinimum, residualTokenAllowance: routerAllowance });
      if (outcome.outcome !== 'RECONCILED') return { outcome: outcome.outcome === 'DIVERGENT' ? 'DIVERGENT' as const : 'INCONCLUSIVE' as const };
      const pool = await poolState(await atHead());
      return { outcome: 'RECONCILED' as const, actualWETH: afterWETH - BigInt(prepared.beforeWETH), safeUSDC: afterUSDC, pool };
    };
    const reconcileMint = async (txHash: string, desiredWETH: bigint, desiredUSDC: bigint) => {
      const r = await call('eth_getTransactionReceipt', [txHash]) as null | { status?: string; blockHash?: string;
        gasUsed?: string; effectiveGasPrice?: string; logs?: { address: string; topics: string[]; data: string }[] };
      const raw = await call('eth_getRawTransactionByHash', [txHash]);
      if (!r || typeof raw !== 'string' || !HASH.test(r.blockHash ?? '') || !Array.isArray(r.logs))
        return { outcome: 'INCONCLUSIVE' as const };
      const mintLog = r.logs.find(log => log.address.toLowerCase() === POSITION_MANAGER && log.topics.length === 4 &&
        log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' &&
        log.topics[1] === '0x' + '0'.repeat(64) && log.topics[2] === '0x' + aw(profile.safe));
      const tokenId = mintLog ? BigInt(mintLog.topics[3]!) : null;
      const bh = r.blockHash!;
      const swapEvents = await readFile(eventPath, 'utf8');
      const swapHash = swapEvents.trimEnd().split('\n').map(line => JSON.parse(line) as CompositionEvent)
        .findLast(e => e.level === 'ATTEMPT' && e.step === 'SWAP' && e.state === 'RECONCILED')?.transactionHash;
      if (!swapHash) return { outcome: 'INCONCLUSIVE' as const };
      const swapReceipt = await call('eth_getTransactionReceipt', [swapHash]) as { blockHash?: string } | null;
      if (!HASH.test(swapReceipt?.blockHash ?? '')) return { outcome: 'INCONCLUSIVE' as const };
      const beforeBlock = swapReceipt!.blockHash!;
      const [beforeWETH, beforeUSDC, afterWETH, afterUSDC, mintCalls, wethAllowance, usdcAllowance,
        safeCode, rolesCode] = await Promise.all([
        tokenBalance(LIQUIDITY_WETH, profile.safe, beforeBlock), tokenBalance(LIQUIDITY_USDC, profile.safe, beforeBlock),
        tokenBalance(LIQUIDITY_WETH, profile.safe, bh), tokenBalance(LIQUIDITY_USDC, profile.safe, bh),
        rolesRemaining(prepared.compiled.mintAllowanceKey, bh), tokenAllowance(LIQUIDITY_WETH, POSITION_MANAGER, bh),
        tokenAllowance(LIQUIDITY_USDC, POSITION_MANAGER, bh),
        call('eth_getCode', [profile.safe, { blockHash: bh, requireCanonical: true }]),
        call('eth_getCode', [profile.roles, { blockHash: bh, requireCanonical: true }]),
      ]);
      let position: CompositionMintEvidence['position'] = null;
      if (tokenId && tokenId > 0n) {
        const [owner, data] = await Promise.all([
          ethCall(POSITION_MANAGER, '0x6352211e' + word(tokenId), bh),
          ethCall(POSITION_MANAGER, '0x99fbab88' + word(tokenId), bh),
        ]);
        position = { tokenId, owner: resultAddress(owner), token0: resultAddress(data, 2), token1: resultAddress(data, 3),
          fee: Number(resultWord(data, 4)), tickLower: signed24(resultWord(data, 5)), tickUpper: signed24(resultWord(data, 6)),
          liquidity: resultWord(data, 7), owed0: resultWord(data, 10), owed1: resultWord(data, 11) };
      }
      const mintCall = buildCompositionMintCall(prepared.compiled, desiredWETH, desiredUSDC);
      const e: CompositionMintEvidence = { chainId: 31337, transactionHash: txHash, raw: rawBytes(raw),
        roles: profile.roles, safe: profile.safe, pool: profile.liquidity.pool, executor: profile.executor, expectedRoleCall: mintCall.data,
        expectedSafeCodeHash: profile.safeCodeHash, actualSafeCodeHash: modeBCodeHash(String(safeCode)),
        expectedRolesCodeHash: profile.rolesCodeHash, actualRolesCodeHash: modeBCodeHash(String(rolesCode)),
        receipt: { status: r.status === '0x1' ? 1 : 0, blockHash: bh, gasUsed: num(r.gasUsed),
          effectiveGasPrice: num(r.effectiveGasPrice), logs: r.logs.map(log => ({ ...log, address: log.address.toLowerCase() })) },
        stateBlockHash: bh, beforeWETH, afterWETH, beforeUSDC, afterUSDC, remainingMintCalls: mintCalls,
        remainingWETHAllowance: wethAllowance, remainingUSDCAllowance: usdcAllowance,
        maxWETH: terms.maxWETH, maxUSDC: terms.maxUSDC, minWETH: terms.minWETH, minUSDC: terms.minUSDC,
        tickLower: terms.tickLower, tickUpper: terms.tickUpper, desiredWETH, desiredUSDC, position };
      const result = reconcileCompositionMint(e);
      return result.outcome === 'RECONCILED' && tokenId ? { outcome: 'RECONCILED' as const, tokenId } :
        { outcome: result.outcome === 'DIVERGENT' ? 'DIVERGENT' as const : 'INCONCLUSIVE' as const };
    };
    const driver = { chainId: async () => Number(num(await call('eth_chainId'))),
      now: async () => (await atHead()).timestamp,
      permissionActive: async (step: 'SWAP' | 'MINT') => {
        const at = await atHead();
        return (step !== 'SWAP' || at.timestamp <= prepared.quoteExpiresAt) && permissionActive(at.hash);
      },
      allowanceRemaining: async (step: 'SWAP' | 'MINT') => rolesRemaining(
        step === 'SWAP' ? prepared.compiled.swapAllowanceKey : prepared.compiled.mintAllowanceKey, (await atHead()).hash),
      sendExact, receipt, reconcileSwap, reconcileMint };
    const instance = createCompositionWorker(eventPath, { executionId: id, compiled: prepared.compiled, terms,
      executor: profile.executor, expiresAt: Number(terms.mintDeadline) }, driver);
    return operation === 'run' ? instance.run() : instance.recoverKnown();
  }
  async function list() {
    let names: string[];
    try { names = await readdir(profile.journalDir); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const found: { executionId: string; preparedAt: string }[] = [];
    for (const name of names.filter(x => /^exec-[0-9a-f]{24}$/.test(x))) {
      try { const v = await read(name); found.push({ executionId: name, preparedAt: v.preparedAt }); }
      catch { /* Partial or other-build directory. */ }
    }
    return found.sort((a, b) => b.preparedAt.localeCompare(a.preparedAt));
  }
  return { prepare, read, list, status, installationStep, confirm, worker, atHead, poolState };
}
export type CompositionService = ReturnType<typeof createCompositionService>;
