// SPDX-License-Identifier: AGPL-3.0-only
/** Durable append-only MOCKED composed run snapshots; a reload resumes its last confirmed state. */
import { join } from 'node:path';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
import { readValidatedFile, writeExtendingFile } from './file-store.js';
import type { CrossChainRun } from './cross-chain-liquidity.js';
const enc = new TextEncoder(), dec = new TextDecoder();
const identity = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function encode(run: CrossChainRun): string {
  return JSON.stringify(run, (_key, value: unknown) => typeof value === 'bigint' ? { $bigint: value.toString() } : value);
}
function parse(bytes: Uint8Array): CrossChainRun {
  const lines = dec.decode(bytes).trimEnd().split('\n');
  if (!lines.length || lines.length > 128) throw new Error('CROSS_CHAIN_JOURNAL_CORRUPT');
  let last: CrossChainRun | null = null;
  for (const line of lines) {
    const run = JSON.parse(line, (_key, value: unknown) => {
      if (value && typeof value === 'object' && !Array.isArray(value) && '$bigint' in value) {
        const raw = (value as { $bigint: unknown }).$bigint;
        if (typeof raw !== 'string' || !/^-?[0-9]+$/.test(raw) || Object.keys(value).length !== 1)
          throw new Error('CROSS_CHAIN_JOURNAL_CORRUPT');
        return BigInt(raw);
      }
      return value;
    }) as CrossChainRun;
    if (!run || !identity.test(run.workflowId) || run.provider !== 'lifi.rest' && run.provider !== 'across.direct' ||
      !Array.isArray(run.observations) || !Array.isArray(run.produced) || !Array.isArray(run.location) ||
      run.journal.workflowId !== run.workflowId || run.journal.manifestHash !== run.sourceManifestHash ||
      run.journal.executionPlanHash !== run.executionPlanHash)
      throw new Error('CROSS_CHAIN_JOURNAL_CORRUPT');
    validateArtifact('execution-journal', run.journal);
    if (last && (run.workflowId !== last.workflowId || run.owner !== last.owner || run.provider !== last.provider ||
      run.sourceManifestHash !== last.sourceManifestHash || run.executionPlanHash !== last.executionPlanHash ||
      run.maximumSourceUsdc !== last.maximumSourceUsdc || run.sourceHash !== last.sourceHash && last.sourceHash !== null ||
      last.journal.entries.some((entry, i) => JSON.stringify(entry) !== JSON.stringify(run.journal.entries[i])) ||
      last.observations.some((entry, i) => JSON.stringify(entry) !== JSON.stringify(run.observations[i])) ||
      last.produced.some((entry, i) => JSON.stringify(entry) !== JSON.stringify(run.produced[i]))))
      throw new Error('CROSS_CHAIN_JOURNAL_CORRUPT');
    last = run;
  }
  if (!last) throw new Error('CROSS_CHAIN_JOURNAL_CORRUPT');
  return last;
}
export function createCrossChainRunStore(directory: string) {
  if (!directory.startsWith('/')) throw new Error('CROSS_CHAIN_JOURNAL_DIR_INVALID');
  const path = (id: string) => {
    if (!identity.test(id)) throw new Error('CROSS_CHAIN_EXECUTION_ID_INVALID');
    return join(directory, `${id}.jsonl`);
  };
  return {
    async load(id: string): Promise<CrossChainRun> { return parse(await readValidatedFile(path(id), parse)); },
    async save(run: CrossChainRun): Promise<void> {
      const file = path(run.workflowId);
      let prior: Uint8Array;
      try { prior = await readValidatedFile(file, parse); }
      catch (error) {
        if ((error as Error & { cause?: { code?: string } }).cause?.code === 'ENOENT') prior = new Uint8Array();
        else throw error;
      }
      await writeExtendingFile(file, enc.encode(dec.decode(prior) + encode(run) + '\n'), parse);
    },
  };
}
