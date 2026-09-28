// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-008 service: live read-only quote, durable deterministic MOCKED financial lifecycle. */
import { randomBytes } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { validateAuthoringWorkflow, createReviewContext } from '@defi-workflow-engine/reference-linter';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { BRIDGE_ACTION, validateBridgeJournal, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
import { compileBridge, verifyBridgeReview } from '@defi-workflow-engine/reference-compiler';
import { authorizeBridge, bridgeState, confirmBridgeDestination, confirmBridgeSource, markBridgeReconciled,
  newBridgeExecution, progressBridge, recheckBridgeSource, rehearseBridgeApproval, rehearseBridgeSource,
  readValidatedFile, writeExtendingFile, type BridgeExecution } from '@defi-workflow-engine/reference-executor';
import { buildBridgeEvidence, reconcileBridgeDestination, type BridgeObservation } from '@defi-workflow-engine/reference-reconciler';
import { requestLifiQuote, type LifiQuote } from './lifi-adapter';

const context = createReviewContext({ registryId: referenceRegistry.registryId,
  capabilityId: referenceRegistry.capabilities[0]?.id, actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });
const enc = new TextEncoder(), dec = new TextDecoder();
const ID = /^bridge-[0-9a-f]{24}$/;
const OWNER = /^0x[0-9a-f]{40}$/;
type QuoteProvider = (owner: string, amountIn: string, slippageBps: number) => Promise<LifiQuote>;
function parseSnapshots(bytes: Uint8Array): BridgeExecution {
  const lines = dec.decode(bytes).trimEnd().split('\n');
  if (!lines.length || lines.length > 64) throw new Error('BRIDGE_JOURNAL_CORRUPT');
  let last: BridgeExecution | null = null;
  for (const line of lines) {
    const value = JSON.parse(line) as BridgeExecution;
    if (value.format !== 'gryloo.bridge-execution.v1' || !ID.test(value.executionId)
      || !Array.isArray(value.attempts) || value.attempts.length > 2
      || value.compiled.hashes.manifest !== value.bridgeJournal.manifestHash
      || value.compiled.hashes.quote !== value.bridgeJournal.quoteHash
      || value.compiled.hashes.workflow !== value.bridgeJournal.workflowHash
      || value.canonicalJournal.manifestHash !== value.compiled.hashes.manifest)
      throw new Error('BRIDGE_JOURNAL_CORRUPT');
    validateBridgeJournal(value.bridgeJournal);
    validateArtifact('execution-journal', value.canonicalJournal);
    if (value.evidence) validateArtifact('evidence-bundle', value.evidence.bundle);
    if (last && (last.executionId !== value.executionId || JSON.stringify(last.route) !== JSON.stringify(value.route)
      || JSON.stringify(last.compiled) !== JSON.stringify(value.compiled)
      || last.bridgeJournal.events.some((event, i) => JSON.stringify(event) !== JSON.stringify(value.bridgeJournal.events[i]))
      || last.canonicalJournal.entries.some((event, i) => JSON.stringify(event) !== JSON.stringify(value.canonicalJournal.entries[i]))))
      throw new Error('BRIDGE_JOURNAL_CORRUPT');
    last = value;
  }
  if (!last) throw new Error('BRIDGE_JOURNAL_CORRUPT');
  return last;
}
export function createBridgeService(directory: string, quoteProvider: QuoteProvider = requestLifiQuote) {
  if (!directory.startsWith('/')) throw new Error('BRIDGE_JOURNAL_DIR_INVALID');
  const locks = new Map<string, Promise<void>>();
  const path = (id: string) => { if (!ID.test(id)) throw new Error('BRIDGE_EXECUTION_ID_INVALID'); return join(directory, id + '.jsonl'); };
  async function load(id: string): Promise<BridgeExecution> {
    return parseSnapshots(await readValidatedFile(path(id), parseSnapshots));
  }
  async function save(value: BridgeExecution): Promise<void> {
    const file = path(value.executionId);
    let prior: Uint8Array;
    try { prior = await readValidatedFile(file, parseSnapshots); }
    catch (error) { if ((error as Error & { cause?: { code?: string } }).cause?.code === 'ENOENT') prior = new Uint8Array(); else throw error; }
    const next = enc.encode(dec.decode(prior) + JSON.stringify(value) + '\n');
    await writeExtendingFile(file, next, parseSnapshots);
  }
  async function serial<T>(id: string, work: () => Promise<T>): Promise<T> {
    const prior = locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    locks.set(id, gate);
    await prior;
    try { return await work(); } finally { release(); if (locks.get(id) === gate) locks.delete(id); }
  }
  async function update(id: string, transform: (run: BridgeExecution) => BridgeExecution): Promise<BridgeExecution> {
    return serial(id, async () => { const run = await load(id); const next = transform(run); await save(next); return next; });
  }
  return {
    async quote(workflow: SemanticWorkflow, ownerInput: string, scenario: 'normal' | 'uncertain' = 'normal'): Promise<BridgeExecution> {
      validateAuthoringWorkflow(workflow, context);
      if (workflow.nodes.length !== 1 || workflow.nodes[0]?.actionType !== BRIDGE_ACTION) throw new Error('BRIDGE_WORKFLOW_UNSUPPORTED');
      const owner = ownerInput.toLowerCase();
      if (!OWNER.test(owner) || owner === '0x0000000000000000000000000000000000000000') throw new Error('BRIDGE_OWNER_INVALID');
      const node = workflow.nodes[0]!;
      const amount = node.inputs.find(x => x.name === 'amount-in');
      const slip = node.userConstraints.find(x => x.kind === 'MAXIMUM_SLIPPAGE_BPS');
      if (amount?.kind !== 'QUANTITY' || slip?.kind !== 'MAXIMUM_SLIPPAGE_BPS') throw new Error('BRIDGE_WORKFLOW_UNSUPPORTED');
      const route = await quoteProvider(owner, amount.value.amount, slip.maximumBps);
      const compiled = compileBridge(workflow, route, Date.now());
      const run = newBridgeExecution('bridge-' + randomBytes(12).toString('hex'), route, compiled, scenario);
      await save(run);
      return run;
    },
    load,
    async list(): Promise<readonly { executionId: string; state: string }[]> {
      let names: string[];
      try { names = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
      const found: { executionId: string; state: string }[] = [];
      for (const name of names.filter(x => /^bridge-[0-9a-f]{24}\.jsonl$/.test(x))) {
        const id = name.slice(0, -6);
        const run = await load(id);
        found.push({ executionId: id, state: bridgeState(run) });
      }
      return found;
    },
    authorize: (id: string, manifestHash: string) => update(id, run => {
      verifyBridgeReview(run.compiled, run.route, Date.now());
      return authorizeBridge(run, manifestHash, Date.now());
    }),
    approve: (id: string) => update(id, run => {
      verifyBridgeReview(run.compiled, run.route, Date.now());
      return rehearseBridgeApproval(run, Date.now());
    }),
    submit: (id: string) => update(id, run => {
      verifyBridgeReview(run.compiled, run.route, Date.now());
      return rehearseBridgeSource(run, Date.now());
    }),
    recheck: (id: string) => update(id, recheckBridgeSource),
    confirmSource: (id: string) => update(id, confirmBridgeSource),
    progress: (id: string) => update(id, progressBridge),
    confirmDestination: (id: string) => update(id, confirmBridgeDestination),
    reconcile: (id: string) => update(id, run => {
      if (!run.destination || bridgeState(run) !== 'DESTINATION_CONFIRMED') throw new Error('BRIDGE_RECONCILIATION_NOT_READY');
      const source = run.attempts.find(x => x.stepId === 'bridge.step.source');
      if (!source?.transactionHash) throw new Error('BRIDGE_SOURCE_HASH_MISSING');
      // Independent scripted chain readback. It is intentionally and permanently labeled MOCKED.
      const observation: BridgeObservation = { source: { chainId: 8453, transactionHash: source.transactionHash, status: 1 },
        destination: { chainId: 10, transactionHash: run.destination.transactionHash, status: 1,
          token: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', recipient: run.destination.recipient,
          balanceBefore: '0', balanceAfter: run.destination.receivedAmount } };
      const result = reconcileBridgeDestination(run.route, run.compiled,
        source.transactionHash, run.destination.transactionHash, observation);
      if (result.outcome !== 'RECONCILED') throw new Error(result.code);
      const done = markBridgeReconciled(run);
      return { ...done, evidence: buildBridgeEvidence(run.compiled, done.bridgeJournal, done.canonicalJournal,
        observation, result.received) };
    }),
  };
}
