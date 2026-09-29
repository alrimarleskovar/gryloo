// SPDX-License-Identifier: AGPL-3.0-only
/** One opt-in, exact-profile Base Sepolia Uniswap v3 swap. This service never signs or sends. */
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { resolveWorkflowCapability } from '@defi-workflow-engine/action-registry';
import { createBaseSepoliaReviewContext, validateAuthoringWorkflow } from '@defi-workflow-engine/reference-linter';
import { hashArtifactBytes, type EvidenceBundle, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
import { BASE_SEPOLIA } from '../domain/public-testnet-swap';
export { BASE_SEPOLIA } from '../domain/public-testnet-swap';

export type Rpc = (method: string, params: readonly unknown[]) => Promise<unknown>;
type Step = 'approval' | 'swap';
type Tx = { readonly chainId: typeof BASE_SEPOLIA.chainHex; readonly from: string; readonly to: string;
  readonly data: string; readonly value: '0x0'; readonly gas: string };
export type PublicQuote = { readonly executionId: string; readonly revision: number; readonly nodeId: string;
  readonly workflowHash: string; readonly manifestHash: string; readonly chainId: 84532; readonly inputToken: string;
  readonly outputToken: string; readonly inputSymbol: 'USDC' | 'WETH'; readonly outputSymbol: 'USDC' | 'WETH';
  readonly amountIn: string; readonly expectedOut: string; readonly minimumOut: string; readonly slippageBps: number;
  readonly pool: string; readonly fee: 500; readonly blockNumber: number; readonly blockHash: string;
  readonly observedAt: string; readonly expiresAt: string; readonly estimatedGas: string | null };
export type PublicAttempt = { readonly attemptId: string; readonly executionId: string; readonly step: Step;
  readonly state: 'PREPARED' | 'HASH' | 'REJECTED' | 'UNKNOWN' | 'PENDING' | 'REVERTED' | 'CONFIRMED';
  readonly createdAt: string; readonly submittedAt: string | null; readonly account: string; readonly chainId: 84532; readonly environment: 'PUBLIC_TESTNET';
  readonly adapter: 'uniswap.v3'; readonly semanticRevision: number; readonly manifestHash: string;
  readonly tx: Tx; readonly calldataDigest: string; readonly authorizedInput: string; readonly authorizedMinimumOutput: string;
  readonly preBlock: number; readonly nativeBefore: string; readonly inputBefore: string; readonly outputBefore: string;
  readonly allowanceBefore: string; readonly nativeAfter: string | null; readonly txHash: string | null; readonly receipt: PublicReceipt | null };
export type PublicReceipt = { readonly transactionHash: string; readonly status: 0 | 1; readonly blockNumber: number;
  readonly blockHash: string; readonly from: string; readonly to: string; readonly gasUsed: string;
  readonly effectiveGasPrice: string; readonly executionGasCostWei: string; readonly l1FeeWei: string;
  readonly gasCostWei: string; readonly gasPayer: string; readonly nonce: string; readonly value: string;
  readonly submissionKind: 'DIRECT' | 'DELEGATED_SINGLE'; readonly executionTarget: string;
  readonly delegationDepth: number; readonly outerCalldataDigest: string; readonly executionCalldataDigest: string };
export type PublicOutcome = { readonly inputSpent: string; readonly outputReceived: string;
  readonly inputAfter: string; readonly outputAfter: string; readonly allowanceAfter: string; readonly nativeAfter: string;
  readonly gasCostWei: string; readonly explorer: string; readonly evidence: EvidenceBundle;
  readonly evidenceBundleHash: string };
export type PublicRun = { readonly quote: PublicQuote; readonly workflow: SemanticWorkflow; readonly reviewedManifestHash: string | null;
  readonly attempts: readonly PublicAttempt[]; readonly outcome: PublicOutcome | null };
export type PublicBegin = { readonly attempt: PublicAttempt; readonly tx: Tx };
const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH = /^0x[0-9a-f]{64}$/;
// MetaMask Delegation Framework v1.3.0 on Base Sepolia. This is a readback format only;
// Gryloo still prepares one direct exact-call artifact and never constructs a delegation.
const DELEGATION_MANAGER = '0xdb9b1e94b5b69df7e401ddbede43491141047db3';
const DELEGATOR_IMPL = '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b';
const REDEEM_SELECTOR = '0xcef6d209';
const REDEEMED_TOPIC = '0x40dadaa36c6c2e3d7317e24757451ffb2d603d875f0ad5e92c5dd156573b1873';
const APPROVAL_TOPIC = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const SWAP_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';
function fail(code: string): never { throw new Error(code); }
function address(value: unknown): string { if (typeof value !== 'string' || !ADDRESS.test(value.toLowerCase())) fail('ADDRESS_INVALID'); return value.toLowerCase(); }
function hex(value: unknown): string { if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) fail('RPC_RESPONSE_INVALID'); return value.toLowerCase(); }
function quantity(value: unknown): bigint { return BigInt(hex(value)); }
function word(value: bigint): string { if (value < 0n || value >= 1n << 256n) fail('ABI_VALUE_INVALID'); return value.toString(16).padStart(64, '0'); }
function addrWord(value: string): string { return address(value).slice(2).padStart(64, '0'); }
function digest(value: unknown): string { return '0x' + createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }
const blockHex = (n: number) => '0x' + n.toString(16);
const callData = (selector: string, ...words: string[]) => selector + words.join('');
const balanceData = (owner: string) => callData('0x70a08231', addrWord(owner));
const allowanceData = (owner: string) => callData('0xdd62ed3e', addrWord(owner), addrWord(BASE_SEPOLIA.router));
const approveData = (amount: bigint) => callData('0x095ea7b3', addrWord(BASE_SEPOLIA.router), word(amount));
const swapData = (q: PublicQuote, owner: string) => callData('0x04e45aaf', addrWord(q.inputToken), addrWord(q.outputToken),
  word(BigInt(q.fee)), addrWord(owner), word(BigInt(q.amountIn)), word(BigInt(q.minimumOut)), word(0n));
const poolData = (a: string, b: string) => callData('0x1698ee82', addrWord(a), addrWord(b), word(BigInt(BASE_SEPOLIA.fee)));
const quoteData = (a: string, b: string, amount: bigint) => callData('0xc6a5026a', addrWord(a), addrWord(b),
  word(amount), word(BigInt(BASE_SEPOLIA.fee)), word(0n));
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
}
function swapOf(workflow: SemanticWorkflow) {
  validateAuthoringWorkflow(workflow, createBaseSepoliaReviewContext());
  const financial = workflow.nodes.filter(node => !node.actionType.startsWith('mock-'));
  if (financial.length !== 1 || financial[0]?.actionType !== 'asset.swap.exact-input' || financial[0].chainId !== BASE_SEPOLIA.chainRef)
    fail('PUBLIC_WORKFLOW_UNSUPPORTED');
  const cap = resolveWorkflowCapability(workflow, { environment: 'PUBLIC_TESTNET' });
  if (!cap.executionSupported || cap.nodes.find(node => node.nodeId === financial[0]!.nodeId)?.profile?.adapterId !== 'uniswap.v3')
    fail('PUBLIC_WORKFLOW_UNSUPPORTED');
  const node = financial[0];
  const amount = node.inputs.find(p => p.name === 'amount-in');
  const out = node.inputs.find(p => p.name === 'asset-out');
  const slip = node.userConstraints.find(c => c.kind === 'MAXIMUM_SLIPPAGE_BPS');
  if (amount?.kind !== 'QUANTITY' || out?.kind !== 'ASSET' || slip?.kind !== 'MAXIMUM_SLIPPAGE_BPS' ||
      slip.maximumBps < 1 || slip.maximumBps > 300) fail('PUBLIC_SWAP_INVALID');
  const inputToken = address('address' in amount.value.asset ? amount.value.asset.address : '');
  const outputToken = address('address' in out.value ? out.value.address : '');
  if (!(inputToken === BASE_SEPOLIA.usdc || inputToken === BASE_SEPOLIA.weth) ||
      !(outputToken === BASE_SEPOLIA.usdc || outputToken === BASE_SEPOLIA.weth) || inputToken === outputToken)
    fail('PUBLIC_SWAP_INVALID');
  return { node, inputToken, outputToken, inputSymbol: inputToken === BASE_SEPOLIA.usdc ? 'USDC' as const : 'WETH' as const,
    outputSymbol: outputToken === BASE_SEPOLIA.usdc ? 'USDC' as const : 'WETH' as const,
    amountIn: BigInt(amount.value.amount), slippageBps: slip.maximumBps };
}
function isObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function topicAddress(value: unknown): string {
  const raw = hex(value);
  if (!/^0x[0-9a-f]{64}$/.test(raw) || !/^0{24}$/.test(raw.slice(2, 26))) fail('RECEIPT_INVALID');
  return address('0x' + raw.slice(-40));
}
/** Strictly decode one default-mode ExecutionLib.encodeSingle inside redeemDelegations. */
function delegatedExecution(input: string): { target: string; data: string } | null {
  if (!input.startsWith(REDEEM_SELECTOR)) return null;
  const raw = input.slice(10);
  if (raw.length % 64 !== 0) return null;
  const bytes = raw.length / 2;
  const read = (offset: number) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + 32 > bytes) throw new Error('DELEGATION_ABI_INVALID');
    return BigInt('0x' + raw.slice(offset * 2, (offset + 32) * 2));
  };
  const number = (offset: number) => {
    const value = read(offset);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('DELEGATION_ABI_INVALID');
    return Number(value);
  };
  const oneBytes = (offset: number) => {
    if (number(offset) !== 1 || number(offset + 32) !== 32) throw new Error('DELEGATION_ABI_INVALID');
    const start = offset + 64, length = number(start), first = start + 32;
    const end = first + Math.ceil(length / 32) * 32;
    if (length < 1 || end > bytes || !/^0*$/.test(raw.slice((first + length) * 2, end * 2)))
      throw new Error('DELEGATION_ABI_INVALID');
    return { value: '0x' + raw.slice(first * 2, (first + length) * 2), end };
  };
  try {
    if (number(0) !== 96) return null;
    const contexts = oneBytes(96), modeOffset = number(32);
    if (modeOffset !== contexts.end || number(modeOffset) !== 1 || read(modeOffset + 32) !== 0n) return null;
    const callsOffset = number(64);
    if (callsOffset !== modeOffset + 64) return null;
    const call = oneBytes(callsOffset);
    if (call.end !== bytes || call.value.length < 2 + (20 + 32 + 4) * 2) return null;
    const packed = call.value.slice(2);
    if (BigInt('0x' + packed.slice(40, 104)) !== 0n) return null;
    return { target: address('0x' + packed.slice(0, 40)), data: '0x' + packed.slice(104) };
  } catch { return null; }
}
/** Accept at most two canonical single-call redemptions, ending in the exact prepared action. */
function delegatedExecutionDepth(input: string, target: string, data: string): number | null {
  let current = input;
  for (let depth = 1; depth <= 2; depth++) {
    const inner = delegatedExecution(current);
    if (!inner) return null;
    if (inner.target === target && inner.data === data) return depth;
    if (depth === 2 || inner.target !== DELEGATION_MANAGER || !inner.data.startsWith(REDEEM_SELECTOR)) return null;
    current = inner.data;
  }
  return null;
}
function signed(value: bigint): bigint { return value >= 1n << 255n ? value - (1n << 256n) : value; }
export function publicRecordingEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.GRYLOO_PUBLIC_TESTNET === 'record' && env.NODE_ENV === 'development' &&
    typeof env.GRYLOO_PUBLIC_TESTNET_JOURNAL === 'string' && isAbsolute(env.GRYLOO_PUBLIC_TESTNET_JOURNAL);
}
export function explorerUrl(txHash: string): string { if (!HASH.test(txHash)) fail('TX_HASH_INVALID'); return BASE_SEPOLIA.explorer + txHash; }
export function createPublicTestnetService(config: { readonly rpc: Rpc; readonly journalDir: string; readonly now?: () => Date }) {
  const { rpc, journalDir } = config;
  const now = config.now ?? (() => new Date());
  if (!isAbsolute(journalDir)) fail('PUBLIC_JOURNAL_INVALID');
  mkdirSync(journalDir, { recursive: true, mode: 0o700 });
  const locks = new Set<string>();
  function save(run: PublicRun): PublicRun {
    const file = join(journalDir, run.quote.executionId + '.json');
    const temp = file + '.' + randomBytes(8).toString('hex') + '.tmp';
    const fd = openSync(temp, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(run)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, file);
    const dir = openSync(journalDir, 'r');
    try { fsyncSync(dir); } finally { closeSync(dir); }
    return run;
  }
  function load(id: string): PublicRun {
    if (!/^pub-[0-9a-f]{24}$/.test(id)) fail('EXECUTION_ID_INVALID');
    const file = join(journalDir, id + '.json');
    if (!existsSync(file)) fail('EXECUTION_NOT_FOUND');
    return JSON.parse(readFileSync(file, 'utf8')) as PublicRun;
  }
  async function locked<T>(id: string, action: () => Promise<T>): Promise<T> {
    if (locks.has(id)) fail('EXECUTION_BUSY');
    const lockFile = join(journalDir, id + '.lock');
    let fd: number;
    try { fd = openSync(lockFile, 'wx', 0o600); } catch { fail('EXECUTION_BUSY'); }
    closeSync(fd);
    locks.add(id);
    try { return await action(); } finally { locks.delete(id); unlinkSync(lockFile); }
  }
  async function read(to: string, data: string, block: string): Promise<string> {
    return hex(await rpc('eth_call', [{ to, data }, block]));
  }
  async function balance(token: string, owner: string, block: string): Promise<bigint> {
    return BigInt(await read(token, balanceData(owner), block));
  }
  async function allowance(token: string, owner: string, block: string): Promise<bigint> {
    return BigInt(await read(token, allowanceData(owner), block));
  }
  async function quote(workflow: SemanticWorkflow, executionId: string): Promise<PublicQuote> {
    const swap = swapOf(workflow);
    if (quantity(await rpc('eth_chainId', [])) !== 84532n) fail('WRONG_PROVIDER_CHAIN');
    const head = await rpc('eth_getBlockByNumber', ['latest', false]);
    if (!isObject(head) || typeof head.number !== 'string' || typeof head.hash !== 'string' || typeof head.timestamp !== 'string') fail('RPC_RESPONSE_INVALID');
    const blockNumber = Number(quantity(head.number)), blockHash = hex(head.hash), block = blockHex(blockNumber);
    if (!Number.isSafeInteger(blockNumber) || !HASH.test(blockHash)) fail('RPC_RESPONSE_INVALID');
    const age = now().getTime() - Number(quantity(head.timestamp)) * 1000;
    if (age > 120_000 || age < -30_000) fail('STALE_CHAIN_HEAD');
    for (const target of [BASE_SEPOLIA.factory, BASE_SEPOLIA.router, BASE_SEPOLIA.quoter,
      BASE_SEPOLIA.usdc, BASE_SEPOLIA.weth, BASE_SEPOLIA.pool]) {
      const code = hex(await rpc('eth_getCode', [target, block]));
      if (code === '0x0' || code === '0x') fail('CONTRACT_CODE_MISSING');
    }
    for (const target of [BASE_SEPOLIA.quoter, BASE_SEPOLIA.router]) {
      if (address('0x' + (await read(target, '0xc45a0155', block)).slice(-40)) !== BASE_SEPOLIA.factory ||
          address('0x' + (await read(target, '0x4aa4a4fc', block)).slice(-40)) !== BASE_SEPOLIA.weth)
        fail('PROTOCOL_DEPLOYMENT_MISMATCH');
    }
    if (Number(BigInt(await read(BASE_SEPOLIA.usdc, '0x313ce567', block))) !== 6 ||
        Number(BigInt(await read(BASE_SEPOLIA.weth, '0x313ce567', block))) !== 18) fail('TOKEN_METADATA_MISMATCH');
    if (address('0x' + (await read(BASE_SEPOLIA.factory, poolData(swap.inputToken, swap.outputToken), block)).slice(-40)) !== BASE_SEPOLIA.pool)
      fail('POOL_FACTORY_MISMATCH');
    if (address('0x' + (await read(BASE_SEPOLIA.pool, '0x0dfe1681', block)).slice(-40)) !== BASE_SEPOLIA.usdc ||
        address('0x' + (await read(BASE_SEPOLIA.pool, '0xd21220a7', block)).slice(-40)) !== BASE_SEPOLIA.weth ||
        BigInt(await read(BASE_SEPOLIA.pool, '0xddca3f43', block)) !== 500n) fail('POOL_METADATA_MISMATCH');
    if (BigInt(await read(BASE_SEPOLIA.pool, '0x1a686502', block)) === 0n ||
        BigInt((await read(BASE_SEPOLIA.pool, '0x3850c7bd', block)).slice(0, 66)) === 0n) fail('POOL_UNUSABLE');
    const raw = await read(BASE_SEPOLIA.quoter, quoteData(swap.inputToken, swap.outputToken, swap.amountIn), block);
    if (raw.length < 66) fail('QUOTE_INVALID');
    const expectedOut = BigInt(raw.slice(0, 66));
    const minimumOut = expectedOut * BigInt(10_000 - swap.slippageBps) / 10_000n;
    if (expectedOut <= 0n || minimumOut <= 0n) fail('QUOTE_INVALID');
    const sameBlock = await rpc('eth_getBlockByNumber', [block, false]);
    if (!isObject(sameBlock) || sameBlock.hash !== blockHash) fail('QUOTE_BLOCK_REORG');
    const observedAt = now().toISOString();
    const fields = { executionId, revision: workflow.revision, nodeId: swap.node.nodeId,
      workflowHash: digest(canonical(workflow)), chainId: 84532 as const, inputToken: swap.inputToken, outputToken: swap.outputToken,
      inputSymbol: swap.inputSymbol, outputSymbol: swap.outputSymbol, amountIn: swap.amountIn.toString(),
      expectedOut: expectedOut.toString(), minimumOut: minimumOut.toString(), slippageBps: swap.slippageBps,
      pool: BASE_SEPOLIA.pool, fee: 500 as const, blockNumber, blockHash, observedAt,
      expiresAt: new Date(now().getTime() + 60_000).toISOString(), estimatedGas: null };
    return { ...fields, manifestHash: digest(canonical(fields)) };
  }
  async function prepare(workflow: SemanticWorkflow): Promise<PublicRun> {
    const executionId = 'pub-' + randomBytes(12).toString('hex');
    const q = await quote(workflow, executionId);
    return save({ quote: q, workflow, reviewedManifestHash: null, attempts: [], outcome: null });
  }
  async function refresh(id: string): Promise<PublicRun> {
    return locked(id, async () => {
      const run = load(id);
      const last = run.attempts.at(-1);
      if (run.outcome || last?.step !== 'approval' || last.state !== 'CONFIRMED' ||
          run.attempts.some(attempt => attempt.step === 'swap')) fail('QUOTE_REFRESH_NOT_ALLOWED');
      const fresh = await quote(run.workflow, id);
      return save({ ...run, quote: fresh, reviewedManifestHash: null });
    });
  }
  function review(id: string, manifestHash: string): PublicRun {
    const run = load(id);
    if (run.quote.manifestHash !== manifestHash || now().getTime() >= Date.parse(run.quote.expiresAt) ||
        run.attempts.some(a => a.step === 'swap' || ['PREPARED', 'HASH', 'PENDING', 'UNKNOWN'].includes(a.state)))
      fail('REVIEW_EXPIRED');
    return save({ ...run, reviewedManifestHash: manifestHash });
  }
  async function begin(id: string, ownerValue: string): Promise<PublicBegin> {
    return locked(id, async () => {
      let run = load(id);
      const owner = address(ownerValue);
      if (run.outcome || run.attempts.some(attempt => ['PREPARED', 'HASH', 'PENDING', 'UNKNOWN'].includes(attempt.state))) fail('ATTEMPT_ALREADY_ACTIVE');
      if (run.attempts.some(attempt => attempt.step === 'swap' && attempt.state !== 'REJECTED')) fail('SWAP_ALREADY_ATTEMPTED');
      if (run.reviewedManifestHash !== run.quote.manifestHash) fail('REVIEW_REQUIRED');
      const fresh = await quote(run.workflow, id);
      if (fresh.manifestHash !== run.quote.manifestHash) {
        // Observation metadata changes each block; only economic changes require a new review.
        if (fresh.expectedOut !== run.quote.expectedOut || fresh.minimumOut !== run.quote.minimumOut ||
            fresh.pool !== run.quote.pool || fresh.fee !== run.quote.fee) {
          run = save({ ...run, quote: fresh, reviewedManifestHash: null });
          fail('QUOTE_CHANGED_REVIEW_REQUIRED');
        }
      }
      if (now().getTime() >= Date.parse(run.quote.expiresAt)) {
        run = save({ ...run, quote: fresh, reviewedManifestHash: null });
        fail('QUOTE_EXPIRED_REVIEW_REQUIRED');
      }
      const gate = resolveWorkflowCapability(run.workflow, { environment: 'PUBLIC_TESTNET', runtime: {
        quoteProviderAvailable: true, walletConnected: true, walletChainId: BASE_SEPOLIA.chainRef,
        artifacts: 'CURRENT', simulationReady: true, authorizationReady: true,
      } });
      if (!gate.executionReady) fail('EXECUTION_NOT_READY');
      const head = Number(quantity(await rpc('eth_blockNumber', []))), at = blockHex(head);
      const amountIn = BigInt(run.quote.amountIn);
      const [inputBefore, outputBefore, allowanceBefore, ethBefore] = await Promise.all([
        balance(run.quote.inputToken, owner, at), balance(run.quote.outputToken, owner, at),
        allowance(run.quote.inputToken, owner, at), rpc('eth_getBalance', [owner, at]).then(quantity),
      ]);
      if (inputBefore < amountIn) fail('INSUFFICIENT_INPUT');
      const step: Step = allowanceBefore < amountIn ? 'approval' : 'swap';
      if (step === 'approval' && run.attempts.some(a => a.step === 'approval' && a.state === 'CONFIRMED')) fail('APPROVAL_INEFFECTIVE');
      const data = step === 'approval' ? approveData(amountIn) : swapData(run.quote, owner);
      const to = step === 'approval' ? run.quote.inputToken : BASE_SEPOLIA.router;
      const baseTx = { chainId: BASE_SEPOLIA.chainHex, from: owner, to, data, value: '0x0' as const };
      const gas = quantity(await rpc('eth_estimateGas', [{ from: owner, to, data, value: '0x0' }]));
      const gasPrice = quantity(await rpc('eth_gasPrice', []));
      if (gas <= 0n || gasPrice <= 0n || ethBefore < gas * gasPrice * 2n) fail('INSUFFICIENT_TEST_ETH');
      const tx: Tx = { ...baseTx, gas: '0x' + (gas * 12n / 10n).toString(16) };
      const attempt: PublicAttempt = { attemptId: id + '.' + step + '.' + String(run.attempts.length + 1), executionId: id,
        step, state: 'PREPARED', createdAt: now().toISOString(), submittedAt: null, account: owner, chainId: 84532, environment: 'PUBLIC_TESTNET',
        adapter: 'uniswap.v3', semanticRevision: run.quote.revision, manifestHash: run.quote.manifestHash,
        tx, calldataDigest: digest(data), authorizedInput: run.quote.amountIn,
        authorizedMinimumOutput: run.quote.minimumOut, preBlock: head, nativeBefore: ethBefore.toString(), inputBefore: inputBefore.toString(),
        outputBefore: outputBefore.toString(), allowanceBefore: allowanceBefore.toString(), nativeAfter: null, txHash: null, receipt: null };
      save({ ...run, attempts: [...run.attempts, attempt] });
      return { attempt, tx };
    });
  }
  function report(id: string, attemptId: string, result: { kind: 'HASH'; txHash: string } | { kind: 'REJECTED' | 'UNKNOWN' }): PublicRun {
    const run = load(id);
    const target = run.attempts.find(a => a.attemptId === attemptId);
    if (!target || target.state !== 'PREPARED') fail('ATTEMPT_STATE_INVALID');
    if (result.kind === 'HASH' && !HASH.test(result.txHash)) fail('TX_HASH_INVALID');
    const changed: PublicAttempt = { ...target, state: result.kind === 'HASH' ? 'HASH' : result.kind,
      submittedAt: result.kind === 'HASH' ? now().toISOString() : null,
      txHash: result.kind === 'HASH' ? result.txHash : null };
    return save({ ...run, attempts: run.attempts.map(a => a.attemptId === attemptId ? changed : a) });
  }
  async function observe(id: string): Promise<PublicRun> {
    return locked(id, async () => {
      let run = load(id);
      const attempt = run.attempts.at(-1);
      if (!attempt?.txHash || !['HASH', 'PENDING', 'CONFIRMED'].includes(attempt.state) || run.outcome) fail('NO_SUBMITTED_ATTEMPT');
      const raw = await rpc('eth_getTransactionReceipt', [attempt.txHash]);
      if (raw === null) return save({ ...run, attempts: run.attempts.map(a => a.attemptId === attempt.attemptId ? { ...a, state: 'PENDING' } : a) });
      if (!isObject(raw)) fail('RECEIPT_INVALID');
      const tx = await rpc('eth_getTransactionByHash', [attempt.txHash]);
      if (!isObject(tx)) fail('TRANSACTION_MISMATCH');
      const txFrom = address(tx.from), txTo = address(tx.to), txInput = hex(tx.input);
      if (Number(quantity(tx.chainId)) !== 84532 || hex(tx.hash) !== attempt.txHash || quantity(tx.value) !== 0n)
        fail('TRANSACTION_MISMATCH');
      const direct = txFrom === attempt.account && txTo === attempt.tx.to && txInput === attempt.tx.data;
      const delegationDepth = delegatedExecutionDepth(txInput, attempt.tx.to, attempt.tx.data);
      const authorizations = tx.authorizationList;
      const txType = direct ? null : hex(tx.type);
      const newlyAuthorized = txType === '0x4' && delegationDepth === 1 &&
        Array.isArray(authorizations) && authorizations.length === 1 && isObject(authorizations[0]) &&
        quantity(authorizations[0].chainId) === 84532n && address(authorizations[0].address) === DELEGATOR_IMPL;
      const alreadyDelegated = txType === '0x2' && delegationDepth === 2 &&
        !('authorizationList' in tx);
      const delegated = !direct && txFrom !== attempt.account && txTo === DELEGATION_MANAGER &&
        (newlyAuthorized || alreadyDelegated);
      if (!direct && !delegated) fail('TRANSACTION_MISMATCH');
      const status = Number(quantity(raw.status));
      const blockNumber = Number(quantity(raw.blockNumber));
      const gasUsed = quantity(raw.gasUsed), effectiveGasPrice = quantity(raw.effectiveGasPrice);
      const l1Fee = quantity(raw.l1Fee);
      if (![0, 1].includes(status) || !Number.isSafeInteger(blockNumber) || blockNumber < attempt.preBlock ||
          hex(raw.transactionHash) !== attempt.txHash || address(raw.from) !== txFrom ||
          address(raw.to) !== txTo || !HASH.test(hex(raw.blockHash))) fail('RECEIPT_INVALID');
      if (delegated) {
        const block = blockHex(blockNumber);
        const [managerCode, ownerCode, previousOwnerCode] = await Promise.all([
          rpc('eth_getCode', [DELEGATION_MANAGER, block]).then(hex),
          rpc('eth_getCode', [attempt.account, block]).then(hex),
          alreadyDelegated ? rpc('eth_getCode', [attempt.account, blockHex(attempt.preBlock)]).then(hex) : Promise.resolve(null),
        ]);
        if (managerCode === '0x' || managerCode === '0x0' || ownerCode !== '0xef0100' + DELEGATOR_IMPL.slice(2))
          fail('TRANSACTION_MISMATCH');
        if (alreadyDelegated && previousOwnerCode !== ownerCode) fail('TRANSACTION_MISMATCH');
        if (status === 1) {
          if (!Array.isArray(raw.logs)) fail('RECEIPT_INVALID');
          const redeemed = raw.logs.filter(log => isObject(log) && address(log.address) === DELEGATION_MANAGER &&
            Array.isArray(log.topics) && log.topics[0] === REDEEMED_TOPIC);
          if (redeemed.length !== delegationDepth || redeemed.some(log => !isObject(log) ||
              !Array.isArray(log.topics) || topicAddress(log.topics[1]) !== attempt.account))
            fail('TRANSACTION_MISMATCH');
          const redeemers = redeemed.map(log => topicAddress((log as { topics: unknown[] }).topics[2]));
          if (delegationDepth === 1 ? redeemers[0] !== txFrom :
              redeemers.filter(value => value === attempt.account).length !== 1 ||
              redeemers.filter(value => value === txFrom).length !== 1) fail('TRANSACTION_MISMATCH');
          if (attempt.step === 'approval') {
            const tokenLogs = raw.logs.filter(log => isObject(log) &&
              [run.quote.inputToken, run.quote.outputToken].includes(address(log.address)));
            if (tokenLogs.length !== 1 || !isObject(tokenLogs[0]) ||
                address(tokenLogs[0].address) !== run.quote.inputToken || !Array.isArray(tokenLogs[0].topics) ||
                tokenLogs[0].topics[0] !== APPROVAL_TOPIC ||
                topicAddress(tokenLogs[0].topics[1]) !== attempt.account ||
                topicAddress(tokenLogs[0].topics[2]) !== BASE_SEPOLIA.router ||
                quantity(tokenLogs[0].data) !== BigInt(attempt.authorizedInput)) fail('TRANSACTION_MISMATCH');
          } else {
            const tokenLogs = raw.logs.filter(log => isObject(log) &&
              [run.quote.inputToken, run.quote.outputToken].includes(address(log.address)));
            const poolLogs = raw.logs.filter(log => isObject(log) && address(log.address) === run.quote.pool);
            if (tokenLogs.length !== 2 || poolLogs.length !== 1) fail('TRANSACTION_MISMATCH');
            const inputLog = tokenLogs.find(log => isObject(log) && address(log.address) === run.quote.inputToken);
            const outputLog = tokenLogs.find(log => isObject(log) && address(log.address) === run.quote.outputToken);
            const poolLog = poolLogs[0];
            if (!isObject(inputLog) || !Array.isArray(inputLog.topics) || inputLog.topics[0] !== TRANSFER_TOPIC ||
                topicAddress(inputLog.topics[1]) !== attempt.account || topicAddress(inputLog.topics[2]) !== run.quote.pool ||
                quantity(inputLog.data) !== BigInt(attempt.authorizedInput) ||
                !isObject(outputLog) || !Array.isArray(outputLog.topics) || outputLog.topics[0] !== TRANSFER_TOPIC ||
                topicAddress(outputLog.topics[1]) !== run.quote.pool || topicAddress(outputLog.topics[2]) !== attempt.account ||
                !isObject(poolLog) || !Array.isArray(poolLog.topics) || poolLog.topics[0] !== SWAP_TOPIC ||
                topicAddress(poolLog.topics[1]) !== BASE_SEPOLIA.router || topicAddress(poolLog.topics[2]) !== attempt.account)
              fail('TRANSACTION_MISMATCH');
            const poolData = hex(poolLog.data);
            if (poolData.length < 130 || BigInt('0x' + poolData.slice(2, 66)) !== BigInt(attempt.authorizedInput) ||
                signed(BigInt('0x' + poolData.slice(66, 130))) !== -quantity(outputLog.data))
              fail('TRANSACTION_MISMATCH');
          }
        }
      }
      const executionGasCost = gasUsed * effectiveGasPrice;
      const receipt: PublicReceipt = { transactionHash: attempt.txHash, status: status as 0 | 1,
        blockNumber, blockHash: hex(raw.blockHash), from: txFrom, to: txTo,
        gasUsed: gasUsed.toString(), effectiveGasPrice: effectiveGasPrice.toString(),
        executionGasCostWei: executionGasCost.toString(), l1FeeWei: l1Fee.toString(),
        gasCostWei: (executionGasCost + l1Fee).toString(), gasPayer: txFrom,
        nonce: quantity(tx.nonce).toString(), value: quantity(tx.value).toString(),
        submissionKind: delegated ? 'DELEGATED_SINGLE' : 'DIRECT', executionTarget: attempt.tx.to,
        delegationDepth: delegated ? delegationDepth! : 0,
        outerCalldataDigest: digest(txInput), executionCalldataDigest: attempt.calldataDigest };
      const changed: PublicAttempt = { ...attempt, state: status === 1 ? 'CONFIRMED' : 'REVERTED', receipt };
      run = save({ ...run, attempts: run.attempts.map(a => a.attemptId === attempt.attemptId ? changed : a) });
      if (status === 0) return run;
      const at = blockHex(blockNumber);
      if (attempt.step === 'approval') {
        const [observed, inputAfter, outputAfter, nativeAfter] = await Promise.all([
          allowance(run.quote.inputToken, attempt.account, at),
          balance(run.quote.inputToken, attempt.account, at), balance(run.quote.outputToken, attempt.account, at),
          rpc('eth_getBalance', [attempt.account, at]).then(quantity),
        ]);
        if (observed !== BigInt(attempt.authorizedInput) || inputAfter !== BigInt(attempt.inputBefore) ||
            outputAfter !== BigInt(attempt.outputBefore) ||
            (direct && BigInt(attempt.nativeBefore) - nativeAfter < BigInt(receipt.gasCostWei)) ||
            (delegated && nativeAfter !== BigInt(attempt.nativeBefore)))
          fail('APPROVAL_NOT_EFFECTIVE');
        return save({ ...run, attempts: run.attempts.map(a => a.attemptId === attempt.attemptId ?
          { ...a, nativeAfter: nativeAfter.toString() } : a) });
      }
      const [inputAfter, outputAfter, allowanceAfter, nativeAfter] = await Promise.all([
        balance(run.quote.inputToken, attempt.account, at), balance(run.quote.outputToken, attempt.account, at),
        allowance(run.quote.inputToken, attempt.account, at), rpc('eth_getBalance', [attempt.account, at]).then(quantity),
      ]);
      const spent = BigInt(attempt.inputBefore) - inputAfter;
      const received = outputAfter - BigInt(attempt.outputBefore);
      const approvalGasCost = run.attempts.filter(a => a.step === 'approval' && a.state === 'CONFIRMED').reduce((sum, a) => {
        if (a.nativeAfter === null || a.receipt === null) fail('APPROVAL_GAS_UNKNOWN');
        return sum + BigInt(a.receipt.gasCostWei);
      }, 0n);
      const actualGasCost = BigInt(receipt.gasCostWei) + approvalGasCost;
      if (spent !== BigInt(run.quote.amountIn) || received < BigInt(run.quote.minimumOut) ||
          (direct && BigInt(attempt.nativeBefore) - nativeAfter < BigInt(receipt.gasCostWei)) ||
          (delegated && nativeAfter !== BigInt(attempt.nativeBefore))) fail('RECONCILIATION_MISMATCH');
      const explorer = explorerUrl(attempt.txHash);
      run = { ...run, attempts: run.attempts.map(a => a.attemptId === attempt.attemptId ?
        { ...a, nativeAfter: nativeAfter.toString() } : a) };
      const journalHeadHash = digest(canonical(run));
      const receiptHash = digest(canonical(raw));
      const inputAsset = { chainId: BASE_SEPOLIA.chainRef, address: run.quote.inputToken,
        decimals: run.quote.inputSymbol === 'USDC' ? 6 : 18 };
      const outputAsset = { chainId: BASE_SEPOLIA.chainRef, address: run.quote.outputToken,
        decimals: run.quote.outputSymbol === 'USDC' ? 6 : 18 };
      const nativeAsset = { chainId: BASE_SEPOLIA.chainRef, nativeId: 'ETH', decimals: 18 };
      const reconciliation = { balances: [{ asset: inputAsset, amount: inputAfter.toString() },
        { asset: outputAsset, amount: outputAfter.toString() }],
        allowances: [{ asset: inputAsset, amount: allowanceAfter.toString() }], debt: [], positions: [],
        fees: [{ asset: nativeAsset, amount: actualGasCost.toString() }],
        residualAssets: [{ asset: inputAsset, amount: inputAfter.toString() }, { asset: outputAsset, amount: outputAfter.toString() }],
        ownership: [{ chainId: BASE_SEPOLIA.chainRef, address: attempt.account }], limitations: ['PUBLIC_TESTNET_ONLY'] };
      const bundle = validateArtifact('evidence-bundle', { schemaVersion: '1.0.0',
        evidenceBundleId: id + '.evidence', version: 1, supersedes: null,
        semanticWorkflowHash: run.quote.workflowHash, artifactSetHash: digest(canonical(run.quote)),
        simulationHash: digest(canonical({ expected: run.quote.expectedOut, minimum: run.quote.minimumOut, pool: run.quote.pool })),
        policyHash: digest(canonical({ amount: run.quote.amountIn, slippageBps: run.quote.slippageBps })),
        manifestHash: run.quote.manifestHash, executionPlanHash: digest(canonical(attempt.tx)),
        journalHeadHash, observedAt: now().toISOString(), environment: 'TESTNET_EXECUTED', outcome: 'RECONCILED',
        receipts: [{ receiptId: attempt.txHash, contentHash: receiptHash }], differences: [], reconciliation,
        evidence: [{ evidenceId: 'public-explorer', kind: 'EXTERNAL_REFERENCE', contentHash: digest(explorer) },
          { evidenceId: 'transaction-readback', kind: 'EXTERNAL_REFERENCE', contentHash: digest(canonical(tx)) },
          { evidenceId: 'balance-reconciliation', kind: 'EXTERNAL_REFERENCE', contentHash: digest(canonical(reconciliation)) }],
      }) as EvidenceBundle;
      const evidenceBundleHash = hashArtifactBytes('evidence-bundle', new TextEncoder().encode(JSON.stringify(bundle)));
      const outcome: PublicOutcome = { inputSpent: spent.toString(), outputReceived: received.toString(),
        inputAfter: inputAfter.toString(), outputAfter: outputAfter.toString(), allowanceAfter: allowanceAfter.toString(),
        nativeAfter: nativeAfter.toString(), gasCostWei: actualGasCost.toString(), explorer, evidence: bundle, evidenceBundleHash };
      return save({ ...run, outcome });
    });
  }
  return { prepare, refresh, review, begin, report, observe, load,
    list: () => readdirSync(journalDir).filter(file => /^pub-[0-9a-f]{24}\.json$/.test(file)).map(file => file.slice(0, -5)) };
}
export type PublicTestnetService = ReturnType<typeof createPublicTestnetService>;
