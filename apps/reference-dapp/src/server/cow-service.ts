// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-005 loopback CoW orderbook and DApp orchestration. Every order and settlement is MOCKED. */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { baseAssetRegistry } from '@defi-workflow-engine/action-registry';
import { COW_CHAIN, COW_RELAYER, COW_SETTLEMENT, compileCow, cowCancellationDigest, type CowQuote } from '@defi-workflow-engine/reference-compiler';
import { initialCowRecord, postCowOnce, recoverCowPost, transitionCow, type CowOrderbookTransport, type CowOrderbookView, type CowPostingRecord } from '@defi-workflow-engine/reference-executor';
import { reconcileCowSettlement, verifyCowSignature, verifyCowDigestSignature, type CowSettlementObservation } from '@defi-workflow-engine/reference-reconciler';
import { hashArtifactBytes, hashRawBytes, type EvidenceBundle, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
import { modeASwapFromWorkflow } from './mode-a-service';

export type CowScenario = 'fill' | 'hold' | 'ambiguous' | 'expire' | 'failure';
export type CowExecution = { readonly format: 'gryloo.cow-local.v1'; readonly scenario: CowScenario;
  readonly record: CowPostingRecord; readonly evidence: { readonly bundle: EvidenceBundle; readonly hash: string } | null };
type BookRecord = { readonly uid: string; readonly status: CowOrderbookView['status']; readonly lookups: number;
  readonly executedSellAmount: string; readonly executedBuyAmount: string;
  readonly observedAt: string; readonly scenario: CowScenario; readonly owner: string; readonly receiver: string;
  readonly sellAmount: string; readonly buyAmount: string };
const ADDRESS = /^0x[0-9a-f]{40}$/;
const EXECUTION = /^cow-[0-9a-f]{24}$/;
const UID = /^0x[0-9a-f]{112}$/;
const enc = new TextEncoder();
const sha = (value: string) => '0x' + createHash('sha256').update(value).digest('hex');
const at = () => new Date().toISOString();
const err = (code: string): never => { throw new Error(code); };
function validateOwner(owner: string): string {
  if (!ADDRESS.test(owner) || owner === '0x0000000000000000000000000000000000000000') err('COW_OWNER_INVALID');
  return owner;
}
function validateId(id: string): void { if (!EXECUTION.test(id)) err('COW_EXECUTION_INVALID'); }
function decimals(direction: 'WETH_TO_USDC' | 'USDC_TO_WETH') {
  return direction === 'WETH_TO_USDC' ? { sell: baseAssetRegistry.WETH.asset, buy: baseAssetRegistry.USDC.asset }
    : { sell: baseAssetRegistry.USDC.asset, buy: baseAssetRegistry.WETH.asset };
}
function address(asset: typeof baseAssetRegistry.WETH.asset): string {
  if ('address' in asset) return asset.address;
  throw new Error('COW_ASSET_INVALID');
}
export function discoverCow(workflow: SemanticWorkflow): { available: boolean; reason: string; chain: typeof COW_CHAIN;
  provider: string; environment: 'MOCKED'; spender: string; settlement: string } {
  try {
    const swap = modeASwapFromWorkflow(workflow);
    if (swap.amountIn <= 0n || !workflow.nodes.find(node => node.nodeId === swap.nodeId)?.adapterConstraints.protocols.includes('cow-protocol'))
      throw new Error('COW_PROVIDER_NOT_PREAUTHORIZED');
    return { available: true, reason: 'Base USDC/WETH exact-input local scripted profile',
      chain: COW_CHAIN, provider: 'cow-protocol.signed-intent', environment: 'MOCKED',
      spender: COW_RELAYER, settlement: COW_SETTLEMENT };
  } catch {
    return { available: false, reason: 'This local CoW profile supports one Base USDC/WETH exact-input swap.',
      chain: COW_CHAIN, provider: 'cow-protocol.signed-intent', environment: 'MOCKED',
      spender: COW_RELAYER, settlement: COW_SETTLEMENT };
  }
}
function quoteFor(workflow: SemanticWorkflow, owner: string, now: number): CowQuote {
  const swap = modeASwapFromWorkflow(workflow);
  const token = decimals(swap.direction);
  const sellAmount = swap.amountIn;
  const gross = swap.direction === 'WETH_TO_USDC'
    ? sellAmount * 1000n * 1_000_000n / 1_000_000_000_000_000_000n
    : sellAmount * 1_000_000_000_000_000_000n / (1000n * 1_000_000n);
  const minimum = gross * BigInt(10_000 - swap.slippageBps) / 10_000n;
  if (minimum <= 0n) err('COW_QUOTE_TOO_SMALL');
  const quoteId = 'local-' + randomBytes(8).toString('hex');
  const raw = JSON.stringify({ quoteId, owner, sellAmount: sellAmount.toString(), buyAmount: minimum.toString(), now });
  return { quoteId, sourceId: 'cow.loopback.orderbook', chainId: COW_CHAIN,
    sellToken: address(token.sell), buyToken: address(token.buy), owner, receiver: owner,
    sellAmount: sellAmount.toString(), buyAmount: minimum.toString(), feeAmount: '0',
    validTo: Math.floor(now / 1000) + 300, observedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(), sourceBlock: 0,
    sourceHash: sha('cow-mocked-block'), rawHash: hashRawBytes('raw-response', enc.encode(raw)) };
}
async function atomicJson(path: string, value: unknown): Promise<void> {
  const directory = join(path, '..');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temp = path + '.' + randomBytes(8).toString('hex') + '.tmp';
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, path);
  const dir = await open(directory, 'r');
  try { await dir.sync(); } finally { await dir.close(); }
}
export function createCowService(directory: string, transportOverride?: CowOrderbookTransport) {
  if (!directory.startsWith('/') || directory.includes('..')) err('COW_DIRECTORY_INVALID');
  const locks = new Map<string, Promise<unknown>>();
  const executionPath = (id: string) => { validateId(id); return join(directory, 'executions', id + '.jsonl'); };
  const bookPath = (uid: string) => { if (!UID.test(uid)) err('COW_UID_INVALID'); return join(directory, 'orderbook', uid + '.json'); };
  const settlementPath = (uid: string) => { if (!UID.test(uid)) err('COW_UID_INVALID'); return join(directory, 'settlements', uid + '.json'); };
  async function readExecution(id: string): Promise<CowExecution> {
    const raw = await readFile(executionPath(id), 'utf8').catch(() => err('COW_EXECUTION_NOT_FOUND'));
    const lines = raw.trim().split('\n');
    const value = JSON.parse(lines.at(-1)!) as CowExecution;
    if (value.format !== 'gryloo.cow-local.v1' || value.record.executionId !== id ||
      !['fill', 'hold', 'ambiguous', 'expire', 'failure'].includes(value.scenario) ||
      value.record.postCount > 1 || value.record.compiled.orderUid.length !== 114)
      err('COW_RECORD_INVALID');
    return value;
  }
  async function append(value: CowExecution): Promise<void> {
    const path = executionPath(value.record.executionId);
    await mkdir(join(directory, 'executions'), { recursive: true, mode: 0o700 });
    const handle = await open(path, 'a', 0o600);
    try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); } finally { await handle.close(); }
  }
  async function lock<T>(id: string, work: () => Promise<T>): Promise<T> {
    const prior = locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    locks.set(id, gate);
    await prior;
    try { return await work(); } finally { release(); if (locks.get(id) === gate) locks.delete(id); }
  }
  async function readBook(uid: string): Promise<BookRecord | null> {
    try { return JSON.parse(await readFile(bookPath(uid), 'utf8')) as BookRecord; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  async function writeBook(value: BookRecord): Promise<void> { await atomicJson(bookPath(value.uid), value); }
  async function scriptedSettlement(value: BookRecord): Promise<void> {
    const amount = BigInt(value.sellAmount), buy = BigInt(value.buyAmount);
    const txHash = sha(value.uid + '/settlement');
    const observation: CowSettlementObservation = {
      environment: 'MOCKED', uid: value.uid, owner: value.owner, receiver: value.receiver,
      receipt: { transactionHash: txHash, status: 1, blockHash: sha(value.uid + '/block') },
      trade: { uid: value.uid, txHash, sellAmount: value.sellAmount, buyAmount: value.buyAmount, feeAmount: '0' },
      before: { sell: (amount * 2n).toString(), buy: '0', allowance: amount.toString() },
      after: { sell: amount.toString(), buy: buy.toString(), allowance: '0' },
    };
    await atomicJson(settlementPath(value.uid), observation);
  }
  function loopback(scenario: CowScenario): CowOrderbookTransport {
    return {
      async post(order) {
        if (scenario === 'failure') throw new Error('COW_SCRIPTED_PROVIDER_FAILURE');
        const existing = await readBook(order.uid);
        if (existing) return { uid: existing.uid };
        const value: BookRecord = { uid: order.uid, status: 'open', lookups: 0,
          executedSellAmount: '0', executedBuyAmount: '0', observedAt: at(), scenario,
          owner: order.owner, receiver: order.compiled.order.receiver,
          sellAmount: order.compiled.order.sellAmount, buyAmount: order.compiled.order.buyAmount };
        await writeBook(value);
        if (scenario === 'ambiguous') throw new Error('COW_SCRIPTED_AMBIGUOUS_RESPONSE');
        return { uid: order.uid };
      },
      async lookup(uid) {
        const current = await readBook(uid);
        if (!current) return null;
        let next = { ...current, lookups: current.lookups + 1, observedAt: at() };
        if (current.status === 'open' && current.scenario === 'expire') next = { ...next, status: 'expired' };
        if (current.status === 'open' && current.scenario === 'fill' && next.lookups >= 2) {
          next = { ...next, status: 'fulfilled', executedSellAmount: current.sellAmount, executedBuyAmount: current.buyAmount };
          await scriptedSettlement(next);
        }
        if (current.status === 'open' && current.scenario === 'ambiguous' && next.lookups >= 3) {
          next = { ...next, status: 'fulfilled', executedSellAmount: current.sellAmount, executedBuyAmount: current.buyAmount };
          await scriptedSettlement(next);
        }
        await writeBook(next);
        return { uid, status: next.status, executedSellAmount: next.executedSellAmount,
          executedBuyAmount: next.executedBuyAmount, observedAt: next.observedAt };
      },
      async cancel(uid) {
        const current = await readBook(uid);
        if (!current || current.status !== 'open') return { accepted: false };
        await writeBook({ ...current, status: 'cancelled', observedAt: at() });
        return { accepted: true };
      },
    };
  }
  const transport = (scenario: CowScenario) => transportOverride ?? loopback(scenario);
  async function prepare(workflow: SemanticWorkflow, owner: string, scenario: CowScenario = 'fill'): Promise<CowExecution> {
    validateArtifact('semantic-workflow', workflow);
    if (!discoverCow(workflow).available || !['fill', 'hold', 'ambiguous', 'expire', 'failure'].includes(scenario))
      err('COW_CAPABILITY_UNAVAILABLE');
    validateOwner(owner);
    const now = Date.now();
    const quote = quoteFor(workflow, owner, now);
    const compiled = compileCow(workflow, quote, now);
    const executionId = 'cow-' + randomBytes(12).toString('hex');
    const value: CowExecution = { format: 'gryloo.cow-local.v1', scenario,
      record: initialCowRecord(executionId, quote, compiled, at()), evidence: null };
    await append(value);
    return value;
  }
  async function signAndPost(id: string, signature: string): Promise<CowExecution> {
    return lock(id, async () => {
      let value = await readExecution(id);
      if (value.record.state !== 'REVIEWED') err('COW_POST_NOT_ALLOWED');
      verifyCowSignature(value.record.compiled.order, signature, value.record.quote.owner);
      const signed = transitionCow(value.record, 'SIGNED', at(), { signature });
      value = { ...value, record: signed }; await append(value);
      const save = async (record: CowPostingRecord) => { value = { ...value, record }; await append(value); };
      const posted = await postCowOnce(signed, transport(value.scenario), save, at());
      return { ...value, record: posted };
    });
  }
  async function status(id: string): Promise<CowExecution> { return readExecution(id); }
  async function track(id: string): Promise<CowExecution> {
    return lock(id, async () => {
      let value = await readExecution(id);
      const save = async (record: CowPostingRecord) => { value = { ...value, record }; await append(value); };
      const record = await recoverCowPost(value.record, transport(value.scenario), save, at());
      return { ...value, record };
    });
  }
  async function cancel(id: string, signature: string): Promise<CowExecution> {
    return lock(id, async () => {
      let value = await readExecution(id);
      if (!['OPEN', 'POSTED', 'PARTIALLY_FILLED'].includes(value.record.state)) err('COW_CANCEL_NOT_ALLOWED');
      verifyCowDigestSignature(cowCancellationDigest(value.record.compiled.orderUid), signature, value.record.quote.owner);
      const requested = transitionCow(value.record, 'CANCEL_REQUESTED', at(), { cancellationSignature: signature });
      value = { ...value, record: requested }; await append(value);
      try { await transport(value.scenario).cancel(requested.compiled.orderUid, signature); }
      catch { /* The request remains pending until an independent lookup. */ }
      return value;
    });
  }
  async function reconcile(id: string): Promise<CowExecution> {
    return lock(id, async () => {
      let value = await readExecution(id);
      if (value.record.state !== 'RECONCILIATION_REQUIRED' && value.record.state !== 'INCONCLUSIVE') err('COW_RECONCILIATION_NOT_ALLOWED');
      let observation: CowSettlementObservation | null = null;
      try { observation = JSON.parse(await readFile(settlementPath(value.record.compiled.orderUid), 'utf8')) as CowSettlementObservation; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const result = observation ? reconcileCowSettlement(value.record.compiled.order, value.record.compiled.orderUid,
        value.record.quote.owner, observation) : { outcome: 'INCONCLUSIVE' as const, reason: 'No scripted settlement observation',
          observedSell: '0', observedBuy: '0', residualAllowance: '0' };
      const hashes = value.record.compiled.hashes;
      const receiptHash = observation ? hashRawBytes('raw-response', enc.encode(JSON.stringify(observation))) : null;
      const bundle = validateArtifact('evidence-bundle', {
        schemaVersion: '1.0.0', evidenceBundleId: 'cow.evidence.' + id, version: 1, supersedes: null,
        semanticWorkflowHash: hashes.workflow, artifactSetHash: hashes.artifactSet, simulationHash: hashes.simulation,
        policyHash: hashes.policy, manifestHash: hashes.manifest, executionPlanHash: hashes.plan,
        journalHeadHash: hashRawBytes('raw-response', enc.encode(JSON.stringify(value.record.history))),
        observedAt: at(), environment: 'MOCKED', outcome: result.outcome,
        receipts: receiptHash ? [{ receiptId: 'cow.scripted.receipt', contentHash: receiptHash }] : [],
        differences: [], reconciliation: { balances: [], allowances: [], debt: [], positions: [], fees: [], residualAssets: [],
          ownership: [{ chainId: COW_CHAIN, address: value.record.quote.owner }],
          limitations: ['Scripted orderbook and settlement only; no public CoW API, chain receipt or funds observed.', result.reason] },
        evidence: receiptHash ? [{ evidenceId: 'cow.scripted.settlement', kind: 'EXTERNAL_REFERENCE', contentHash: receiptHash }] : [],
      });
      const state = result.outcome === 'RECONCILED' ? 'RECONCILED' : result.outcome;
      value = { ...value, record: transitionCow(value.record, state, at()), evidence: {
        bundle, hash: hashArtifactBytes('evidence-bundle', enc.encode(JSON.stringify(bundle))) } };
      await append(value);
      return value;
    });
  }
  async function list(): Promise<readonly { executionId: string; state: CowPostingRecord['state']; preparedAt: string }[]> {
    let names: string[];
    try { names = await readdir(join(directory, 'executions')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const values = await Promise.all(names.filter(name => /^cow-[0-9a-f]{24}\.jsonl$/.test(name)).map(async name => {
      const value = await readExecution(name.slice(0, -6));
      return { executionId: value.record.executionId, state: value.record.state, preparedAt: value.record.history[0]!.at };
    }));
    return values.sort((a, b) => b.preparedAt.localeCompare(a.preparedAt));
  }
  return { prepare, status, signAndPost, track, cancel, reconcile, list };
}
