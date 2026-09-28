// SPDX-License-Identifier: AGPL-3.0-only
/** Browser-independent fixed swap → mint worker. A durable event precedes each irreversible send. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildCompositionMintCall, planCompositionMint, type CompositionCompiled, type CompositionTerms, type PoolState } from '@defi-workflow-engine/reference-compiler';
import { writeExtendingFile } from './file-store.js';

type Step = 'SWAP' | 'MINT';
type State = 'RESERVED' | 'SUBMITTING' | 'PENDING' | 'CONFIRMED' | 'RECONCILED' | 'REVERTED' | 'INCONCLUSIVE';
export type CompositionEvent = { readonly format: 'gryloo.composition-journal-event.v1'; readonly executionId: string;
  readonly permissionHash: string; readonly level: 'WORKFLOW' | 'SEGMENT' | 'STEP' | 'ATTEMPT'; readonly step: Step;
  readonly state: State; readonly callHash: string; readonly transactionHash: string | null; readonly at: string;
  readonly actualWETH?: string; readonly safeUSDC?: string; readonly desiredWETH?: string; readonly desiredUSDC?: string;
  readonly tokenId?: string; readonly reason?: string };
export type CompositionWorkerJob = { readonly executionId: string; readonly compiled: CompositionCompiled;
  readonly terms: CompositionTerms; readonly executor: string; readonly expiresAt: number };
export type CompositionWorkerDriver = {
  readonly chainId: () => Promise<number>; readonly now: () => Promise<number>;
  readonly permissionActive: (step: Step) => Promise<boolean>;
  readonly allowanceRemaining: (step: Step) => Promise<bigint>;
  readonly sendExact: (step: Step, call: { readonly to: string; readonly data: string; readonly value: '0x0' }) => Promise<string>;
  readonly receipt: (hash: string) => Promise<null | { readonly status: 0 | 1 }>;
  readonly reconcileSwap: (hash: string) => Promise<{ readonly outcome: 'RECONCILED' | 'INCONCLUSIVE' | 'DIVERGENT';
    readonly actualWETH?: bigint; readonly safeUSDC?: bigint; readonly pool?: PoolState }>;
  readonly reconcileMint: (hash: string, desiredWETH: bigint, desiredUSDC: bigint) => Promise<{
    readonly outcome: 'RECONCILED' | 'INCONCLUSIVE' | 'DIVERGENT'; readonly tokenId?: bigint }>;
};
const hexHash = (v: string) => /^0x[0-9a-f]{64}$/.test(v);
const hashCall = (to: string, data: string) => '0x' + createHash('sha256').update(Buffer.from(to.slice(2) + data.slice(2), 'hex')).digest('hex');
function validate(bytes: Uint8Array) {
  const source = new TextDecoder().decode(bytes);
  if (!source.endsWith('\n')) throw new Error('COMPOSITION_JOURNAL_CORRUPT');
  const rows = source.trimEnd().split('\n').map(line => JSON.parse(line) as CompositionEvent);
  if (rows.length > 64 || !rows.length || rows[0]?.level !== 'WORKFLOW' || rows[0].step !== 'SWAP') throw new Error('COMPOSITION_JOURNAL_CORRUPT');
  for (const row of rows) if (row.format !== 'gryloo.composition-journal-event.v1' || !/^exec-[0-9a-f]{24}$/.test(row.executionId) ||
    !hexHash(row.permissionHash) || !hexHash(row.callHash) || (row.transactionHash !== null && !hexHash(row.transactionHash)) ||
    !['SWAP', 'MINT'].includes(row.step) || !['WORKFLOW', 'SEGMENT', 'STEP', 'ATTEMPT'].includes(row.level) ||
    row.executionId !== rows[0]!.executionId || row.permissionHash !== rows[0]!.permissionHash)
    throw new Error('COMPOSITION_JOURNAL_CORRUPT');
  const attempt = rows.filter(row => row.level === 'ATTEMPT');
  for (const step of ['SWAP', 'MINT'] as const) {
    const history = attempt.filter(row => row.step === step);
    if (history.filter(row => row.state === 'SUBMITTING').length > 1 || history.filter(row => row.state === 'PENDING').length > 1)
      throw new Error('COMPOSITION_JOURNAL_CORRUPT');
  }
}
export function createCompositionWorker(path: string, job: CompositionWorkerJob, driver: CompositionWorkerDriver) {
  if (!/^exec-[0-9a-f]{24}$/.test(job.executionId) || !hexHash(job.compiled.permissionHash)) throw new Error('COMPOSITION_JOB_INVALID');
  let tail: Promise<void> = Promise.resolve();
  const encoder = new TextEncoder();
  const read = async (): Promise<CompositionEvent[]> => {
    try { const raw = await readFile(path); validate(raw); return new TextDecoder().decode(raw).trimEnd().split('\n').map(line => JSON.parse(line) as CompositionEvent); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  };
  const appendBatch = async (events: readonly CompositionEvent[]) => {
    let prior = new Uint8Array();
    try { prior = await readFile(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await writeExtendingFile(path, encoder.encode(new TextDecoder().decode(prior) + events.map(event => JSON.stringify(event) + '\n').join('')), validate);
    return events.at(-1)!;
  };
  const row = (level: CompositionEvent['level'], step: Step, state: State, callHash: string,
    transactionHash: string | null = null, extra: Partial<CompositionEvent> = {}): CompositionEvent => ({
      format: 'gryloo.composition-journal-event.v1', executionId: job.executionId, permissionHash: job.compiled.permissionHash,
      level, step, state, callHash, transactionHash, at: new Date().toISOString(), ...extra });
  const emit = (level: CompositionEvent['level'], step: Step, state: State, callHash: string,
    transactionHash: string | null = null, extra: Partial<CompositionEvent> = {}) => appendBatch([row(level, step, state, callHash, transactionHash, extra)]);
  async function run(): Promise<CompositionEvent> {
    let history = await read();
    if (history.some(row => row.executionId !== job.executionId || row.permissionHash !== job.compiled.permissionHash))
      throw new Error('COMPOSITION_JOURNAL_BINDING_CHANGED');
    const swapHash = hashCall(job.compiled.swapCall.to, job.compiled.swapCall.data);
    if (!history.length) {
      await appendBatch(['WORKFLOW', 'SEGMENT', 'STEP', 'ATTEMPT'].map(level =>
        row(level as CompositionEvent['level'], 'SWAP', 'RESERVED', swapHash)));
      history = await read();
    }
    const last = (step: Step) => history.filter(e => e.level === 'ATTEMPT' && e.step === step).at(-1);
    const swap = last('SWAP');
    if (!swap) throw new Error('COMPOSITION_JOURNAL_CORRUPT');
    if (swap.state === 'SUBMITTING') return emit('ATTEMPT', 'SWAP', 'INCONCLUSIVE', swapHash, null, { reason: 'UNKNOWN_SUBMISSION' });
    if (swap.state === 'INCONCLUSIVE' || swap.state === 'REVERTED') return swap;
    let actualWETH: bigint, safeUSDC: bigint, pool: PoolState;
    if (swap.state === 'PENDING' || swap.state === 'CONFIRMED') {
      if (!swap.transactionHash) throw new Error('COMPOSITION_JOURNAL_CORRUPT');
      const receipt = await driver.receipt(swap.transactionHash);
      if (!receipt) return swap;
      if (receipt.status === 0) return emit('ATTEMPT', 'SWAP', 'REVERTED', swapHash, swap.transactionHash);
      if (swap.state === 'PENDING') await emit('ATTEMPT', 'SWAP', 'CONFIRMED', swapHash, swap.transactionHash);
      const result = await driver.reconcileSwap(swap.transactionHash);
      if (result.outcome !== 'RECONCILED' || result.actualWETH === undefined || result.safeUSDC === undefined || !result.pool)
        return emit('ATTEMPT', 'SWAP', 'INCONCLUSIVE', swapHash, swap.transactionHash, { reason: result.outcome });
      actualWETH = result.actualWETH; safeUSDC = result.safeUSDC; pool = result.pool;
      await emit('ATTEMPT', 'SWAP', 'RECONCILED', swapHash, swap.transactionHash,
        { actualWETH: actualWETH.toString(), safeUSDC: safeUSDC.toString() });
      history = await read();
    } else if (swap.state === 'RECONCILED') {
      if (!swap.actualWETH || !swap.safeUSDC || !swap.transactionHash) throw new Error('COMPOSITION_JOURNAL_CORRUPT');
      actualWETH = BigInt(swap.actualWETH); safeUSDC = BigInt(swap.safeUSDC);
      const fresh = await driver.reconcileSwap(swap.transactionHash);
      if (fresh.outcome !== 'RECONCILED' || fresh.actualWETH !== actualWETH || fresh.safeUSDC !== safeUSDC || !fresh.pool)
        return emit('ATTEMPT', 'SWAP', 'INCONCLUSIVE', swapHash, swap.transactionHash, { reason: 'RECONCILIATION_CHANGED' });
      pool = fresh.pool;
    } else {
      if (await driver.chainId() !== 31337 || await driver.now() > job.expiresAt || !await driver.permissionActive('SWAP') ||
          await driver.allowanceRemaining('SWAP') !== 1n) return emit('ATTEMPT', 'SWAP', 'INCONCLUSIVE', swapHash, null, { reason: 'AUTHORITY_CHANGED' });
      await emit('ATTEMPT', 'SWAP', 'SUBMITTING', swapHash);
      let tx: string;
      try { tx = await driver.sendExact('SWAP', job.compiled.swapCall); }
      catch { return emit('ATTEMPT', 'SWAP', 'INCONCLUSIVE', swapHash, null, { reason: 'UNKNOWN_SUBMISSION' }); }
      if (!hexHash(tx)) return emit('ATTEMPT', 'SWAP', 'INCONCLUSIVE', swapHash, null, { reason: 'INVALID_TX_HASH' });
      return emit('ATTEMPT', 'SWAP', 'PENDING', swapHash, tx);
    }
    let mint = last('MINT');
    let desiredWETH: bigint, desiredUSDC: bigint;
    if (!mint) {
      const planned = planCompositionMint(job.terms, actualWETH, safeUSDC, pool, (await driver.now()) * 1000);
      desiredWETH = planned.desiredWETH; desiredUSDC = planned.desiredUSDC;
      const choice = buildCompositionMintCall(job.compiled, desiredWETH, desiredUSDC);
      const choiceHash = hashCall(choice.to, choice.data);
      mint = await appendBatch(['SEGMENT', 'STEP', 'ATTEMPT'].map(level =>
        row(level as CompositionEvent['level'], 'MINT', 'RESERVED', choiceHash, null,
          { desiredWETH: desiredWETH.toString(), desiredUSDC: desiredUSDC.toString() })));
    } else {
      const reservation = history.find(e => e.level === 'ATTEMPT' && e.step === 'MINT' && e.state === 'RESERVED');
      if (!reservation?.desiredWETH || !reservation.desiredUSDC) throw new Error('COMPOSITION_JOURNAL_CORRUPT');
      desiredWETH = BigInt(reservation.desiredWETH); desiredUSDC = BigInt(reservation.desiredUSDC);
    }
    const mintCall = buildCompositionMintCall(job.compiled, desiredWETH, desiredUSDC);
    const mintHash = hashCall(mintCall.to, mintCall.data);
    if (mint.callHash !== mintHash) return emit('ATTEMPT', 'MINT', 'INCONCLUSIVE', mint.callHash, mint.transactionHash, { reason: 'MINT_PLAN_CHANGED' });
    if (mint.state === 'RECONCILED' || mint.state === 'REVERTED' || mint.state === 'INCONCLUSIVE') return mint;
    if (mint.state === 'SUBMITTING') return emit('ATTEMPT', 'MINT', 'INCONCLUSIVE', mintHash, null, { reason: 'UNKNOWN_SUBMISSION' });
    if (mint.state === 'PENDING' || mint.state === 'CONFIRMED') {
      if (!mint.transactionHash) throw new Error('COMPOSITION_JOURNAL_CORRUPT');
      const receipt = await driver.receipt(mint.transactionHash);
      if (!receipt) return mint;
      if (receipt.status === 0) return emit('ATTEMPT', 'MINT', 'REVERTED', mintHash, mint.transactionHash,
        { reason: 'PARTIALLY_COMPLETED_SAFE_RESIDUAL' });
      if (mint.state === 'PENDING') await emit('ATTEMPT', 'MINT', 'CONFIRMED', mintHash, mint.transactionHash);
      const outcome = await driver.reconcileMint(mint.transactionHash, desiredWETH, desiredUSDC);
      if (outcome.outcome !== 'RECONCILED' || outcome.tokenId === undefined)
        return emit('ATTEMPT', 'MINT', 'INCONCLUSIVE', mintHash, mint.transactionHash, { reason: outcome.outcome });
      return emit('ATTEMPT', 'MINT', 'RECONCILED', mintHash, mint.transactionHash, { tokenId: outcome.tokenId.toString() });
    }
    if (await driver.chainId() !== 31337 || await driver.now() > job.expiresAt || !await driver.permissionActive('MINT') ||
        await driver.allowanceRemaining('MINT') !== 1n) return emit('ATTEMPT', 'MINT', 'INCONCLUSIVE', mintHash, null, { reason: 'AUTHORITY_CHANGED' });
    await emit('ATTEMPT', 'MINT', 'SUBMITTING', mintHash);
    let tx: string;
    try { tx = await driver.sendExact('MINT', mintCall); }
    catch { return emit('ATTEMPT', 'MINT', 'INCONCLUSIVE', mintHash, null, { reason: 'UNKNOWN_SUBMISSION' }); }
    if (!hexHash(tx)) return emit('ATTEMPT', 'MINT', 'INCONCLUSIVE', mintHash, null, { reason: 'INVALID_TX_HASH' });
    return emit('ATTEMPT', 'MINT', 'PENDING', mintHash, tx);
  }
  async function recoverKnown(): Promise<CompositionEvent> {
    const history = await read();
    const pending = history.filter(e => e.level === 'ATTEMPT').at(-1);
    if (!pending || pending.state !== 'INCONCLUSIVE' || !pending.transactionHash)
      throw new Error('COMPOSITION_RECOVERY_REQUIRES_HASH');
    // A known hash may be re-observed; a send with unknown hash is never guessed or repeated.
    const receipt = await driver.receipt(pending.transactionHash);
    if (!receipt) return pending;
    return emit('ATTEMPT', pending.step, 'PENDING', pending.callHash, pending.transactionHash,
      { reason: 'EXPLICIT_RECEIPT_RECOVERY' });
  }
  return { run: () => { const result = tail.then(run); tail = result.then(() => undefined, () => undefined); return result; },
    recoverKnown: () => { const result = tail.then(recoverKnown); tail = result.then(() => undefined, () => undefined); return result; }, events: read };
}
