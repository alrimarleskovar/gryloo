// SPDX-License-Identifier: AGPL-3.0-only
import type { Database } from '@defi-workflow-engine/cloud-runtime';
import { savedWorkflowHash, validateSavedWorkflow, type SavedWorkflow, type WorkflowList, type WorkflowOwner } from '../domain/saved-workflow.ts';

/** A simulation or an unused approval is not a previously executed workflow. */
export const EXECUTED_WORKFLOW_RUN = `(er.has_evidence OR EXISTS (
  SELECT 1 FROM execution_attempts ea WHERE ea.tenant_id=er.tenant_id AND ea.run_id=er.run_id
    AND ea.state NOT IN ('PREPARED','CANCELLED')
))`;

type Row = { workflow_id: string; display_name: string; semantic_workflow: unknown; semantic_revision: string; workflow_hash: string; version: string; created_at: Date; updated_at: Date };
const document = (row: Row): SavedWorkflow => {
  const workflow = validateSavedWorkflow(row.semantic_workflow);
  if (workflow.workflowId !== row.workflow_id || workflow.revision !== Number(row.semantic_revision) || savedWorkflowHash(workflow) !== row.workflow_hash) throw Error('WORKFLOW_STORE_CORRUPT');
  return { workflowId: row.workflow_id, name: row.display_name, workflow, revision: workflow.revision, version: Number(row.version), createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
};
export const validWorkflowId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id);
/** Every read and CAS write includes tenant, namespace and verified owner; a guessed ID is never sufficient. */
export function createSavedWorkflowStore(db: Database, tenantId: string, owner: WorkflowOwner) {
  const scope = [tenantId, owner.namespace, owner.address];
  return {
    async get(id: string): Promise<SavedWorkflow | null> {
      if (!validWorkflowId(id)) throw Error('WORKFLOW_INVALID');
      const { rows } = await db.query<Row>('SELECT * FROM saved_workflows WHERE tenant_id=$1 AND owner_namespace=$2 AND owner_account=$3 AND workflow_id=$4', [...scope, id]);
      return rows[0] ? document(rows[0]) : null;
    },
    async save(input: unknown): Promise<SavedWorkflow> {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['workflow', 'name', 'expectedVersion'].includes(k))) throw Error('WORKFLOW_INVALID');
      const { workflow: raw, name, expectedVersion } = input as { workflow: unknown; name: unknown; expectedVersion: unknown };
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 || !name.isWellFormed() || [...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || !Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 0) throw Error('WORKFLOW_INVALID');
      const workflow = validateSavedWorkflow(raw), hash = savedWorkflowHash(workflow);
      if (!validWorkflowId(workflow.workflowId)) throw Error('WORKFLOW_INVALID');
      return db.transaction(async tx => {
        const values = [...scope, workflow.workflowId, name.trim(), JSON.stringify(workflow), workflow.revision, hash];
        if (expectedVersion === 0) {
          const inserted = await tx.query<Row>(`INSERT INTO saved_workflows (tenant_id,owner_namespace,owner_account,workflow_id,display_name,semantic_workflow,semantic_revision,workflow_hash,version)
            VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,1) ON CONFLICT DO NOTHING RETURNING *`, values);
          if (!inserted.rows[0]) throw Error('WORKFLOW_VERSION_CONFLICT');
          return document(inserted.rows[0]);
        }
        const prior = (await tx.query<Row>('SELECT * FROM saved_workflows WHERE tenant_id=$1 AND owner_namespace=$2 AND owner_account=$3 AND workflow_id=$4 FOR UPDATE', [...scope, workflow.workflowId])).rows[0];
        if (!prior) throw Error('WORKFLOW_NOT_FOUND');
        const current = document(prior);
        if (current.version !== expectedVersion) throw Error('WORKFLOW_VERSION_CONFLICT');
        if (workflow.revision < current.revision || hash !== prior.workflow_hash && workflow.revision <= current.revision) throw Error('WORKFLOW_REVISION_CONFLICT');
        const updated = await tx.query<Row>(`UPDATE saved_workflows SET display_name=$5,semantic_workflow=$6::jsonb,semantic_revision=$7,workflow_hash=$8,
          version=version+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND owner_namespace=$2 AND owner_account=$3 AND workflow_id=$4 AND version=$9 RETURNING *`, [...values, expectedVersion]);
        if (!updated.rows[0]) throw Error('WORKFLOW_VERSION_CONFLICT');
        return document(updated.rows[0]);
      });
    },
    async list(): Promise<WorkflowList> {
      const { rows } = await db.query<{ workflow_id: string; display_name: string | null; version: string | null; updated_at: Date;
        run_count: string; last_run_id: string | null; last_status: string | null; has_evidence: boolean }>(`
        WITH owned_runs AS (
          SELECT workflow_id,count(*)::text AS run_count,(array_agg(run_id ORDER BY updated_at DESC,run_id DESC))[1] AS last_run_id,
            (array_agg(status ORDER BY updated_at DESC,run_id DESC))[1] AS last_status,max(updated_at) AS updated_at,bool_or(has_evidence) AS has_evidence
          FROM execution_runs er WHERE tenant_id=$1 AND owner_account=$3 AND ${EXECUTED_WORKFLOW_RUN} GROUP BY workflow_id
        ), owned_saved AS (
          SELECT * FROM saved_workflows WHERE tenant_id=$1 AND owner_namespace=$2 AND owner_account=$3
        )
        SELECT coalesce(s.workflow_id,r.workflow_id) AS workflow_id,s.display_name,s.version::text,
          greatest(s.updated_at,r.updated_at) AS updated_at,coalesce(r.run_count,'0') AS run_count,r.last_run_id,r.last_status,coalesce(r.has_evidence,false) AS has_evidence
        FROM owned_saved s FULL OUTER JOIN owned_runs r ON s.workflow_id=r.workflow_id
        ORDER BY updated_at DESC,workflow_id LIMIT 101`, scope);
      return { hasMore: rows.length > 100, items: rows.slice(0,100).map(row => ({ workflowId: row.workflow_id, name: row.display_name, saved: row.version !== null,
        version: row.version === null ? null : Number(row.version), updatedAt: row.updated_at.toISOString(), runCount: Number(row.run_count), lastRunId: row.last_run_id, lastStatus: row.last_status, hasEvidence: row.has_evidence })) };
    },
  };
}
