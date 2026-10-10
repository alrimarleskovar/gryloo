// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useEffect } from 'react';
import { useWorkflow } from '../state/workflow-store';

/** Read-only loopback test probe. Mounted only under the server's engineering guard. */
export function EngineeringProbe() {
  const { state } = useWorkflow();
  useEffect(() => {
    const target = window as unknown as { __flofiEngineeringWorkflow?: string };
    target.__flofiEngineeringWorkflow = JSON.stringify(state.workflow);
    return () => { delete target.__flofiEngineeringWorkflow; };
  }, [state.workflow]);
  return null;
}
