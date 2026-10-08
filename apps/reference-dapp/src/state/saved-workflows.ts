// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { listWorkflows, openWorkflow, saveWorkflow } from '../app/workflow-action';
import { savedWorkflowHash, workflowOwner, type WorkflowDocument, type WorkflowList, type WorkflowOwner } from '../domain/saved-workflow';

export function useSavedWorkflows(owner: WorkflowOwner | null) {
  const ownerKey = owner ? `${owner.namespace}:${owner.address}` : null;
  const latestOwner = useRef(ownerKey); latestOwner.current = ownerKey;
  const [loaded, setLoaded] = useState<{ owner: string; list: WorkflowList } | null>(null);
  const [version, setVersion] = useState<{ owner: string; workflowId: string; value: number } | null>(null);
  const [error, setError] = useState<{ owner: string | null; code: string } | null>(null);
  const [busy, setBusy] = useState(false), busyRef = useRef(false);
  const [serial, setSerial] = useState(0);
  const [pendingList, setPendingList] = useState<{ owner: string; serial: number } | null>(null);
  const refresh = useCallback(() => setSerial(n => n + 1), []);
  useEffect(() => {
    if (!ownerKey) return;
    const scopedOwner = workflowOwner(ownerKey);
    if (!scopedOwner) return;
    let active = true;
    setPendingList({ owner: ownerKey, serial });
    listWorkflows(scopedOwner).then(result => {
      if (!active || latestOwner.current !== ownerKey) return;
      if (result.ok) { setLoaded({ owner: ownerKey, list: result.value }); setError(null); }
      else setError({ owner: ownerKey, code: result.code });
    }, () => { if (active && latestOwner.current === ownerKey) setError({ owner: ownerKey, code: 'WORKFLOW_UNAVAILABLE' }); }).finally(() => { if (active && latestOwner.current === ownerKey) setPendingList(null); });
    return () => { active = false; };
  }, [ownerKey, serial]);
  async function save(workflow: SemanticWorkflow, name: string) {
    if (!owner || !ownerKey || busyRef.current) return false;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      const expected = version?.owner === ownerKey && version.workflowId === workflow.workflowId ? version.value :
        loaded?.owner === ownerKey ? loaded.list.items.find(item => item.workflowId === workflow.workflowId)?.version ?? 0 : 0;
      const hash = savedWorkflowHash(workflow);
      const result = await saveWorkflow(owner, workflow, name, expected);
      if (latestOwner.current !== ownerKey) return false;
      if (!result.ok) { setError({ owner: ownerKey, code: result.code }); return false; }
      if (savedWorkflowHash(result.value.workflow) !== hash || result.value.workflowId !== workflow.workflowId) throw Error('WORKFLOW_RESPONSE_INVALID');
      setVersion({ owner: ownerKey, workflowId: workflow.workflowId, value: result.value.version }); refresh(); return true;
    } catch { if (latestOwner.current === ownerKey) setError({ owner: ownerKey, code: 'WORKFLOW_UNAVAILABLE' }); return false; }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function open(id: string): Promise<WorkflowDocument | null> {
    if (!owner || !ownerKey || busyRef.current) return null;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      const result = await openWorkflow(owner, id);
      if (latestOwner.current !== ownerKey) return null;
      if (!result.ok) { setError({ owner: ownerKey, code: result.code }); return null; }
      if (result.value.workflowId !== id || result.value.workflow.workflowId !== id) throw Error('WORKFLOW_RESPONSE_INVALID');
      setVersion({ owner: ownerKey, workflowId: id, value: result.value.version ?? 0 }); return result.value;
    } catch { if (latestOwner.current === ownerKey) setError({ owner: ownerKey, code: 'WORKFLOW_UNAVAILABLE' }); return null; }
    finally { busyRef.current = false; setBusy(false); }
  }
  return { list: loaded?.owner === ownerKey ? loaded.list : null, error: error?.owner === ownerKey ? error.code : null, loading: Boolean(ownerKey && (pendingList?.owner === ownerKey || loaded?.owner !== ownerKey && error?.owner !== ownerKey)), busy, save, open, refresh };
}
