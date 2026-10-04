// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { callCloudFlow } from '../server/cloud-api-client';
import type { TempoRecord } from '../server/tempo-service';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import type { TempoTransaction } from '@defi-workflow-engine/reference-compiler';
// Cloud runtime is the authority; there is no parallel Tempo-specific persistence backend.
export async function tempoSimulate(w: SemanticWorkflow, account: string) { return callCloudFlow<TempoRecord>('tempo-payment', 'simulate', [w, account]); }
export async function tempoReview(id: string, c: string, w: SemanticWorkflow) { return callCloudFlow<TempoRecord>('tempo-payment', 'review', [id, c, w]); }
export async function tempoBegin(id: string, account: string, w: SemanticWorkflow) { return callCloudFlow<{ record: TempoRecord; transaction: TempoTransaction }>('tempo-payment', 'begin', [id, account, w]); }
export async function tempoHandoff(id: string, hash: string, w: SemanticWorkflow) { return callCloudFlow<TempoRecord>('tempo-payment', 'handoff', [id, hash, w]); }
export async function tempoReport(id: string) { return callCloudFlow<TempoRecord>('tempo-payment', 'report', [id]); }
export async function tempoInvalidate(id: string) { return callCloudFlow<TempoRecord>('tempo-payment', 'invalidate', [id]); }
export async function tempoStatus(id: string) { return callCloudFlow<TempoRecord>('tempo-payment', 'status', [id]); }
export async function tempoObserve(id: string) { return callCloudFlow<TempoRecord>('tempo-payment', 'observe', [id]); }

export async function tempoRecoverReview(id: string, w: SemanticWorkflow) { return callCloudFlow<TempoRecord>('tempo-payment', 'recoverReview', [id, w]); }
