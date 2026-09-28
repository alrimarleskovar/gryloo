// SPDX-License-Identifier: AGPL-3.0-only
'use server';
/** Same-origin actions for the opt-in chain-31337 liquidity fork only. No signing or broadcasting. */
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createForkRpc } from '../server/fork-rpc';
import { createLiquidityService, parseLiquidityProfile, type LiquidityService, type LiquidityOperation } from '../server/liquidity-service';
export type LiquidityResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string };
export type LiquidityInfo = { readonly available: true; readonly environment: 'MOCKED' | 'FORK_REPRODUCED'; readonly owner: string;
  readonly sourceBlockHash: string; readonly chainIdHex: '0x7a69'; readonly status: Awaited<ReturnType<LiquidityService['status']>> }
  | { readonly available: false; readonly reason: 'LIQUIDITY_OFF' };
let runtime: { key: string; service: LiquidityService; environment: 'MOCKED' | 'FORK_REPRODUCED'; owner: string; sourceBlockHash: string } | null = null;
function load() {
  if (process.env.GRYLOO_LIQUIDITY !== 'fork') return null;
  const profilePath = process.env.GRYLOO_LIQUIDITY_PROFILE, journalDir = process.env.GRYLOO_LIQUIDITY_JOURNAL;
  if (!profilePath || !isAbsolute(profilePath) || !journalDir || !isAbsolute(journalDir)) throw new Error('LIQUIDITY_CONFIGURATION_INVALID');
  const bytes = readFileSync(profilePath, 'utf8');
  const key = `${profilePath}\n${journalDir}\n${bytes}`;
  if (runtime?.key === key) return runtime;
  const profile = parseLiquidityProfile(JSON.parse(bytes));
  runtime = { key, service: createLiquidityService({ call: createForkRpc({ url: profile.rpcUrl }), profile, journalDir }),
    environment: profile.environment, owner: profile.owner, sourceBlockHash: profile.sourceBlockHash };
  return runtime;
}
const codeOf = (cause: unknown): string => {
  const message = cause instanceof Error ? cause.message : '';
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(message) ? message : 'LIQUIDITY_INTERNAL_ERROR';
};
async function run<T>(action: (service: LiquidityService) => Promise<T>): Promise<LiquidityResult<T>> {
  try { const current = load(); if (!current) return { ok: false, code: 'LIQUIDITY_OFF' };
    return { ok: true, value: await action(current.service) }; }
  catch (cause) { return { ok: false, code: codeOf(cause) }; }
}
const validExecutionId = (input: unknown) => {
  const value = (input as { executionId?: unknown } | null)?.executionId;
  if (typeof value !== 'string' || !/^liquidity-[0-9a-f]{24}$/.test(value)) throw new Error('LIQUIDITY_INPUT_INVALID');
  return value;
};
export async function liquidityStatus(): Promise<LiquidityResult<LiquidityInfo>> {
  try { const current = load();
    if (!current) return { ok: true, value: { available: false, reason: 'LIQUIDITY_OFF' } };
    return { ok: true, value: { available: true, environment: current.environment, owner: current.owner,
      sourceBlockHash: current.sourceBlockHash, chainIdHex: '0x7a69', status: await current.service.status() } }; }
  catch (cause) { return { ok: false, code: codeOf(cause) }; }
}
export async function liquidityPrepare(input: unknown) {
  return run(service => {
    const value = input as { workflow?: unknown; operation?: unknown; tokenId?: unknown; partBps?: unknown } | null;
    if (!value || typeof value.workflow !== 'object' || typeof value.operation !== 'string') throw new Error('LIQUIDITY_INPUT_INVALID');
    if (value.tokenId !== undefined && (typeof value.tokenId !== 'string' || !/^[1-9][0-9]{0,76}$/.test(value.tokenId))) throw new Error('LIQUIDITY_INPUT_INVALID');
    if (value.partBps !== undefined && (!Number.isSafeInteger(value.partBps) || (value.partBps as number) < 1 || (value.partBps as number) > 9999))
      throw new Error('LIQUIDITY_INPUT_INVALID');
    return service.prepare({ workflow: value.workflow as SemanticWorkflow, operation: value.operation as LiquidityOperation,
      ...(value.tokenId === undefined ? {} : { tokenId: value.tokenId as string }),
      ...(value.partBps === undefined ? {} : { partBps: value.partBps as number }) });
  });
}
export async function liquidityBegin(input: unknown) {
  return run(service => {
    const value = input as { idempotencyKey?: unknown; workflow?: unknown } | null;
    if (typeof value?.idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(value.idempotencyKey) ||
      !value.workflow || typeof value.workflow !== 'object') throw new Error('LIQUIDITY_INPUT_INVALID');
    return service.begin(validExecutionId(input), value.idempotencyKey, value.workflow as SemanticWorkflow);
  });
}
export async function liquiditySubmission(input: unknown) {
  return run(service => {
    const value = input as { attemptId?: unknown; report?: { kind?: unknown; transactionHash?: unknown } } | null;
    if (typeof value?.attemptId !== 'string' || !/^liquidity-[0-9a-f]{24}\.[a-z-]+\.a[12]$/.test(value.attemptId)) throw new Error('LIQUIDITY_INPUT_INVALID');
    const report = value.report;
    if (!report || !['HASH', 'UNKNOWN', 'REJECTED'].includes(report.kind as string) ||
      (report.kind === 'HASH' && (typeof report.transactionHash !== 'string' || !/^0x[0-9a-f]{64}$/.test(report.transactionHash))))
      throw new Error('LIQUIDITY_INPUT_INVALID');
    return service.submission(validExecutionId(input), value.attemptId, report as { kind: 'HASH' | 'UNKNOWN' | 'REJECTED'; transactionHash?: string });
  });
}
export async function liquidityObserve(input: unknown) { return run(service => service.observe(validExecutionId(input))); }
export async function liquidityRecoverUnknown(input: unknown) { return run(service => service.recoverUnknown(validExecutionId(input))); }
export async function liquidityInspect(input: unknown) {
  return run(service => {
    const tokenId = (input as { tokenId?: unknown } | null)?.tokenId;
    if (typeof tokenId !== 'string' || !/^[1-9][0-9]{0,76}$/.test(tokenId)) throw new Error('LIQUIDITY_INPUT_INVALID');
    return service.inspect(tokenId);
  });
}
