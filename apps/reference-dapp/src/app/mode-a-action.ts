// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createForkRpc } from '../server/fork-rpc';
import { isHostedDeployment } from '../server/deployment';
import {
  createModeAService, parseModeAProfile, type ExecutionStatus, type ModeAProfile, type ModeAService,
  type PreparedExecution, type RevocationRecord, type StepId, type SubmissionReport,
} from '../server/mode-a-service';

/**
 * Same-origin Server Actions for local-fork Mode A only. They exist only when the server was started
 * in explicit local-fork acceptance mode with a loopback chain-31337 profile. They never sign, never
 * broadcast and never receive a key: the user's injected wallet submits every transaction.
 */
export type ModeAResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string };
export type ModeAInfo = { readonly available: true; readonly environment: ModeAProfile['environment']; readonly owner: string;
  readonly chainIdHex: '0x7a69'; readonly source: { readonly chainId: 8453; readonly blockNumber: number; readonly blockHash: string };
  readonly stateSourceHash: string; readonly executions: readonly { readonly executionId: string; readonly preparedAt: string; readonly final: boolean }[] }
  | { readonly available: false; readonly reason: string };

type Runtime = { readonly key: string; readonly profile: ModeAProfile; readonly service: ModeAService };
let runtime: Runtime | null = null;

function loadRuntime(): Runtime | null {
  // BUILD-CLOUD-PARITY-001: a local rehearsal (loopback chain, MOCKED harness, local journal) is never enabled on a hosted deployment.
  if (process.env.GRYLOO_MODE_A !== 'fork' || isHostedDeployment(process.env)) return null;
  const profilePath = process.env.GRYLOO_MODE_A_PROFILE;
  const journalDir = process.env.GRYLOO_MODE_A_JOURNAL;
  if (!profilePath || !isAbsolute(profilePath) || !journalDir || !isAbsolute(journalDir)) throw new Error('MODE_A_CONFIGURATION_INVALID');
  const text = readFileSync(profilePath, 'utf8');
  const key = `${profilePath}\n${journalDir}\n${text}`;
  if (runtime?.key === key) return runtime;
  const profile = parseModeAProfile(JSON.parse(text));
  const call = createForkRpc({ url: profile.rpcUrl });
  // Records carry fork time: the whole execution happens on the local fork's clock.
  const clock = async () => {
    const block = await call('eth_getBlockByNumber', ['latest', false]) as { timestamp?: unknown };
    if (typeof block?.timestamp !== 'string' || !/^0x[0-9a-f]+$/.test(block.timestamp)) throw new Error('FORK_RESPONSE_INVALID');
    return new Date(Number(BigInt(block.timestamp)) * 1000).toISOString();
  };
  runtime = { key, profile, service: createModeAService({ call, profile, journalDir, clock }) };
  return runtime;
}
function codeOf(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^[A-Z][A-Z0-9_]{2,63}(?::[A-Za-z0-9_ ,:.()-]{0,120})?$/.test(message) ? message : 'MODE_A_INTERNAL_ERROR';
}
async function run<T>(action: (service: ModeAService) => Promise<T>): Promise<ModeAResult<T>> {
  try {
    const current = loadRuntime();
    if (!current) return { ok: false, code: 'MODE_A_OFF' };
    return { ok: true, value: await action(current.service) };
  } catch (error) { return { ok: false, code: codeOf(error) }; }
}
const EXECUTION = /^exec-[0-9a-f]{24}$/;
const STEPS: readonly StepId[] = ['step-approve', 'step-swap', 'step-revoke'];
function executionId(input: unknown): string {
  const value = (input as { executionId?: unknown } | null)?.executionId;
  if (typeof value !== 'string' || !EXECUTION.test(value)) throw new Error('INPUT_INVALID');
  return value;
}
function stepId(input: unknown): StepId {
  const value = (input as { stepId?: unknown } | null)?.stepId;
  if (typeof value !== 'string' || !(STEPS as readonly string[]).includes(value)) throw new Error('INPUT_INVALID');
  return value as StepId;
}

export async function modeAStatus(): Promise<ModeAResult<ModeAInfo>> {
  try {
    const current = loadRuntime();
    if (!current) return { ok: true, value: { available: false, reason: 'MODE_A_OFF' } };
    const { profile, service } = current;
    const executions = [];
    for (const id of await service.list()) {
      const status = await service.status(id);
      const last = status.evidence.at(-1);
      executions.push({ executionId: id, preparedAt: status.prepared.preparedAt,
        final: Boolean(last && (last.residualAllowance === '0' || last.outcome === 'RECONCILED')) });
    }
    return { ok: true, value: { available: true, environment: profile.environment, owner: profile.owner, chainIdHex: '0x7a69',
      source: { chainId: 8453, blockNumber: profile.sourceBlockNumber, blockHash: profile.sourceBlockHash },
      stateSourceHash: profile.stateSourceHash, executions } };
  } catch (error) { return { ok: false, code: codeOf(error) }; }
}
export async function modeAPrepare(input: unknown): Promise<ModeAResult<PreparedExecution>> {
  return run(service => service.prepare({ workflow: (input as { workflow?: unknown } | null)?.workflow as SemanticWorkflow }));
}
export async function modeAExecution(input: unknown): Promise<ModeAResult<ExecutionStatus>> {
  return run(service => service.status(executionId(input)));
}
export async function modeABeginStep(input: unknown): Promise<ModeAResult<Awaited<ReturnType<ModeAService['beginStep']>>>> {
  return run(service => {
    const key = (input as { idempotencyKey?: unknown } | null)?.idempotencyKey;
    if (typeof key !== 'string') throw new Error('INPUT_INVALID');
    return service.beginStep(executionId(input), stepId(input), key);
  });
}
export async function modeARecordSubmission(input: unknown): Promise<ModeAResult<Awaited<ReturnType<ModeAService['recordSubmission']>>>> {
  return run(service => {
    const value = input as { attemptId?: unknown; report?: { kind?: unknown; transactionHash?: unknown } } | null;
    const report = value?.report;
    let parsed: SubmissionReport;
    if (report?.kind === 'HASH' && typeof report.transactionHash === 'string' && /^0x[0-9a-f]{64}$/.test(report.transactionHash)) {
      parsed = { kind: 'HASH', transactionHash: report.transactionHash };
    } else if (report?.kind === 'REJECTED' || report?.kind === 'UNKNOWN') parsed = { kind: report.kind };
    else parsed = { kind: 'UNKNOWN' };
    if (typeof value?.attemptId !== 'string' || !/^exec-[0-9a-f]{24}\.step-(?:approve|swap|revoke)\.a[12]$/.test(value.attemptId)) throw new Error('INPUT_INVALID');
    return service.recordSubmission(executionId(input), value.attemptId, parsed);
  });
}
export async function modeAObserveStep(input: unknown): Promise<ModeAResult<Awaited<ReturnType<ModeAService['observeStep']>>>> {
  return run(service => service.observeStep(executionId(input), stepId(input)));
}
export async function modeAReconcile(input: unknown): Promise<ModeAResult<Awaited<ReturnType<ModeAService['reconcile']>>>> {
  return run(service => service.reconcile(executionId(input)));
}
export async function modeAPrepareRevocation(input: unknown): Promise<ModeAResult<RevocationRecord>> {
  return run(service => service.prepareRevocation(executionId(input)));
}
export async function modeAConfirmRevocation(input: unknown): Promise<ModeAResult<Awaited<ReturnType<ModeAService['confirmRevocation']>>>> {
  return run(service => service.confirmRevocation(executionId(input)));
}
