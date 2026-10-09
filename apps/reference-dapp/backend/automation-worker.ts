// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: automation evaluation on the Railway worker. Loaded by `main.ts worker` only when the worker's environment sets
 * FLOFI_AUTOMATIONS=enabled; otherwise neither this module nor the resolution rule is ever loaded and the worker is unchanged.
 *
 * The automation handlers hold no flow transport, key or signer: they evaluate rules, write proposals for owners and deliver
 * notifications. The worker's flow services keep their observe-only transports (WORKER_SUBMISSION_FORBIDDEN) untouched.
 */
import type { Database, Logger } from '@defi-workflow-engine/cloud-runtime';
import { installSourceResolution } from './source-resolution.ts';

type Env = Readonly<Record<string, string | undefined>>;
export async function loadAutomationWorker(env: Env, db: Database, tenantId: string, logger: Logger) {
  installSourceResolution();
  const { automationWorkerParts } = await import('../src/automations/worker.ts');
  return automationWorkerParts(env, db, tenantId, logger);
}
