// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useEffect, useState } from 'react';
import { hashArtifactBytes, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { requestBuildEstimate, type BuildEstimate, type BuildEstimateResult } from '../domain/build-estimate';

export function useBuildEstimate(workflow: SemanticWorkflow | undefined, nodeId: string, owner?: string | null) {
  const key = workflow ? hashArtifactBytes('semantic-workflow', new TextEncoder().encode(JSON.stringify(workflow))) : null;
  const scope = JSON.stringify([key, nodeId, owner ?? null]);
  const node = workflow?.nodes.find(node => node.nodeId === nodeId);
  const chain = node?.chainId;
  const provider = node?.adapterConstraints.protocols.some(protocol => protocol === 'uniswap' || protocol === 'uniswap-v3') ? 'Uniswap V3'
    : node?.adapterConstraints.protocols.includes('jupiter') ? 'Jupiter'
      : node?.adapterConstraints.protocols.includes('orca-whirlpools') ? 'Orca Whirlpools' : null;
  const [result, setResult] = useState<{ key: string; estimate: BuildEstimate | null } | null>(null);
  useEffect(() => {
    if (!workflow || !key || !chain || !provider) return;
    let expire: ReturnType<typeof setTimeout> | undefined;
    const cancel = requestBuildEstimate(async signal => {
      const response = await fetch('/api/build-estimate', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workflow, nodeId, owner }), signal });
      return await response.json() as BuildEstimateResult;
    }, response => {
      const estimate = response.ok && response.estimate.workflowHash === key && response.estimate.nodeId === nodeId && response.estimate.chain === chain && response.estimate.provider === provider && Date.parse(response.estimate.expiresAt) > Date.now() ? response.estimate : null;
      setResult({ key: scope, estimate });
      if (estimate) expire = setTimeout(() => setResult({ key: scope, estimate: null }), Math.max(0, Date.parse(estimate.expiresAt) - Date.now()));
    });
    return () => { cancel(); clearTimeout(expire); };
  }, [key, scope, workflow, nodeId, owner, chain, provider]);
  return key && result?.key === scope ? result.estimate : null;
}
