// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { PrivacyDemoRun } from '../privacy/local-demo';

// Isolated synthetic sessions. Server/process restart loses the mocked ledger; never reconstruct or resubmit it.
const sessions = new Map<string, PrivacyDemoRun>();
export async function simulatePrivacyDemo(workflow: SemanticWorkflow) {
  if (sessions.size >= 64) throw new Error('CLOAK_DEMO_SESSION_LIMIT');
  const run = await PrivacyDemoRun.create(workflow), snapshot = await run.snapshot();
  sessions.set(snapshot.runId, run); return snapshot;
}
export async function advancePrivacyDemo(runId: string, action: 'review' | 'manifest' | 'authorize' | 'execute' | 'recover',
  workflow: SemanticWorkflow, acknowledgment: string | null) {
  const run = sessions.get(runId);
  if (!run) throw new Error('CLOAK_DEMO_SESSION_UNAVAILABLE_NO_RETRY');
  return run.act(action, workflow, acknowledgment);
}
