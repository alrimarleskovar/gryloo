// SPDX-License-Identifier: AGPL-3.0-only
/** Validated extending-file journal for direct Across MOCKED executions. */
import { randomBytes } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createReviewContext, validateAuthoringWorkflow } from '@defi-workflow-engine/reference-linter';
import { readValidatedFile, writeExtendingFile, newAcrossExecution, authorizeAcross, approveAcross,
  prepareAcrossDeposit, submitAcrossDeposit, recheckAcrossDeposit, confirmAcrossSource, progressAcrossFill,
  delayAcrossFill, fillAcross, reconcileAcross, expireAcrossDeposit, pendingAcrossRefund, confirmAcrossRefund,
  validateAcrossExecution, type AcrossExecution } from '@defi-workflow-engine/reference-executor';
import { compileAcrossReview, verifyAcrossReview } from '@defi-workflow-engine/reference-compiler';
import { requestAcrossQuote, type AcrossQuote } from './across-adapter';
const enc = new TextEncoder(), dec = new TextDecoder();
const ID = /^across-[0-9a-f]{24}$/;
const OWNER = /^0x[0-9a-f]{40}$/;
function parse(bytes: Uint8Array): AcrossExecution {
  const lines = dec.decode(bytes).trimEnd().split('\n');
  if (!lines.length || lines.length > 64) throw new Error('ACROSS_JOURNAL_CORRUPT');
  let previous: AcrossExecution | null = null;
  for (const line of lines) {
    const next = validateAcrossExecution(JSON.parse(line) as unknown);
    if (previous && (next.executionId !== previous.executionId || next.quote.rawHash !== previous.quote.rawHash
      || next.review.manifestHash !== previous.review.manifestHash
      || next.events.length < previous.events.length
      || previous.events.some((event, index) => JSON.stringify(event) !== JSON.stringify(next.events[index]))
      || next.attempts.length < previous.attempts.length)) throw new Error('ACROSS_JOURNAL_CORRUPT');
    previous = next;
  }
  if (!previous) throw new Error('ACROSS_JOURNAL_CORRUPT');
  return previous;
}
export function createAcrossService(directory: string, quoteProvider: (owner: string, amount: string, slippageBps: number) => Promise<AcrossQuote> = requestAcrossQuote) {
  if (!directory.startsWith('/') || directory.includes('..')) throw new Error('ACROSS_JOURNAL_DIR_INVALID');
  const locks = new Map<string, Promise<void>>();
  const path = (id: string) => { if (!ID.test(id)) throw new Error('ACROSS_ID_INVALID'); return join(directory, id + '.jsonl'); };
  const load = async (id: string) => parse(await readValidatedFile(path(id), parse));
  async function save(run: AcrossExecution): Promise<void> {
    const file = path(run.executionId);
    let prior: Uint8Array = new Uint8Array();
    try { prior = await readValidatedFile(file, parse); }
    catch (cause) { if ((cause as Error & { cause?: { code?: string } }).cause?.code !== 'ENOENT') throw cause; }
    await writeExtendingFile(file, enc.encode(dec.decode(prior) + JSON.stringify(run) + '\n'), parse);
  }
  async function serial<T>(id: string, work: () => Promise<T>): Promise<T> {
    const prior = locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    locks.set(id, gate); await prior;
    try { return await work(); } finally { release(); if (locks.get(id) === gate) locks.delete(id); }
  }
  const update = (id: string, transform: (run: AcrossExecution) => AcrossExecution) => serial(id, async () => {
    const run = await load(id); const next = transform(run); await save(next); return next;
  });
  return {
    load,
    async list(): Promise<readonly { executionId: string; state: string }[]> {
      let names: string[];
      try { names = await readdir(directory); } catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []; throw cause; }
      const found: { executionId: string; state: string }[] = [];
      for (const name of names.filter(value => /^across-[0-9a-f]{24}\.jsonl$/.test(value))) {
        const run = await load(name.slice(0, -6)); found.push({ executionId: run.executionId, state: run.state });
      }
      return found;
    },
    async quote(workflow: SemanticWorkflow, ownerInput: string): Promise<AcrossExecution> {
      const context = createReviewContext({ registryId: referenceRegistry.registryId,
        capabilityId: referenceRegistry.capabilities[0]?.id, actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });
      validateAuthoringWorkflow(workflow, context);
      const owner = ownerInput.toLowerCase();
      if (!OWNER.test(owner) || owner === '0x0000000000000000000000000000000000000000') throw new Error('ACROSS_OWNER_INVALID');
      const node = workflow.nodes[0], input = node?.inputs.find(x => x.name === 'amount-in');
      if (workflow.nodes.length !== 1 || input?.kind !== 'QUANTITY') throw new Error('ACROSS_WORKFLOW_INVALID');
      const slippage = node?.userConstraints.find(x => x.kind === 'MAXIMUM_SLIPPAGE_BPS');
      if (slippage?.kind !== 'MAXIMUM_SLIPPAGE_BPS') throw new Error('ACROSS_WORKFLOW_INVALID');
      const route = await quoteProvider(owner, input.value.amount, slippage.maximumBps);
      const now = Date.now(); const review = compileAcrossReview(workflow, route, now);
      const run = newAcrossExecution('across-' + randomBytes(12).toString('hex'), workflow, route, review, now);
      await save(run); return run;
    },
    authorize: (id: string, hash: string) => update(id, run => { verifyAcrossReview(run.review, run.workflow, run.quote, Date.now());
      return authorizeAcross(run, hash, Date.now()); }),
    approve: (id: string) => update(id, run => { verifyAcrossReview(run.review, run.workflow, run.quote, Date.now());
      return approveAcross(run, Date.now()); }),
    prepare: (id: string) => update(id, run => { verifyAcrossReview(run.review, run.workflow, run.quote, Date.now());
      return prepareAcrossDeposit(run, Date.now()); }),
    submit: (id: string, uncertain: boolean) => update(id, run => { verifyAcrossReview(run.review, run.workflow, run.quote, Date.now());
      return submitAcrossDeposit(run, uncertain, Date.now()); }),
    recheck: (id: string) => update(id, run => recheckAcrossDeposit(run, Date.now())),
    confirmSource: (id: string) => update(id, run => confirmAcrossSource(run, Date.now())),
    progress: (id: string) => update(id, run => progressAcrossFill(run, Date.now())),
    delay: (id: string) => update(id, run => delayAcrossFill(run, Date.now())),
    fill: (id: string) => update(id, run => fillAcross(run, Date.now())),
    reconcile: (id: string) => update(id, run => reconcileAcross(run, { owner: run.quote.owner,
      token: run.quote.outputToken, sourceHash: run.depositHash ?? '', fillHash: run.fillHash ?? '',
      before: '0', after: run.quote.minimumOutput }, Date.now())),
    expire: (id: string) => update(id, run => expireAcrossDeposit(run, run.fillDeadlineMs ?? Date.now())),
    refundPending: (id: string) => update(id, run => pendingAcrossRefund(run, Date.now())),
    refundConfirm: (id: string) => update(id, run => confirmAcrossRefund(run, Date.now())),
  };
}
