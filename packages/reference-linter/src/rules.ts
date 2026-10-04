// SPDX-License-Identifier: AGPL-3.0-only
import type { ReviewContext } from './context.js';
import { validateAuthoringWorkflow } from './validation.js';
import { BRIDGE_ACTION } from '@defi-workflow-engine/workflow-contracts';

export interface ReviewFinding {
  readonly code: string;
  readonly severity: 'WARNING' | 'BLOCK';
  readonly nodeId: string;
  readonly field: string;
  readonly message: string;
}
export interface ReviewResult {
  readonly revision: number;
  readonly findings: readonly ReviewFinding[];
  readonly executable: false;
  readonly enforcement: 'NOT_ENFORCED';
}

export function lintWorkflow(input: unknown, context: ReviewContext): ReviewResult {
  const workflow = validateAuthoringWorkflow(input, context);
  const findings: ReviewFinding[] = [];
  const bridgeSwap = workflow.nodes[0]?.nodeId === 'build009-bridge';
  const composition = workflow.resourceEdges.some(edge => edge.outputId === 'amount-out' && edge.inputName === 'weth-from-swap');
  for (const node of workflow.nodes) {
    if (node.actionType === 'supply') { findings.push({ code: 'SUPPLY_SIMULATION_REQUIRED', severity: 'BLOCK', nodeId: node.nodeId, field: 'amount', message: 'Simulate the exact Aave Supply and review its allowance and beneficiary before execution.' }); continue; }
    if (node.actionType === BRIDGE_ACTION && node.adapterConstraints.adapters[0]?.id === 'flofi.router') { findings.push({ code: 'ROUTER_ROUTE_REQUIRED', severity: 'BLOCK', nodeId: node.nodeId, field: 'expectedOutputs', message: 'Quote a fresh route, simulate the exact Base transactions and review the route-bound Manifest before execution.' }); continue; }
    if (node.actionType === BRIDGE_ACTION) { findings.push({ code: 'BRIDGE_QUOTE_REQUIRED', severity: 'BLOCK', nodeId: node.nodeId, field: 'expectedOutputs', message: node.adapterConstraints.adapters[0]?.id === 'across.direct' ? 'A fresh direct Across quote and fixed-provider review are required before the simulated bridge.' : 'A fresh LI.FI route and Manifest review are required before the mocked rehearsal.' }); continue; }
    if (node.actionType === 'asset.liquidity.concentrated' && node.chainId === 'eip155:84532') { findings.push({ code: 'UNISWAP_LIQUIDITY_SIMULATION_REQUIRED', severity: 'BLOCK', nodeId: node.nodeId, field: 'expectedOutputs', message: 'Simulate the position against current Base Sepolia pool state and review the exact approvals and mint before execution.' }); continue; }
    if (node.actionType === 'asset.liquidity.concentrated') { findings.push({ code: 'SOLANA_LIQUIDITY_SIMULATION_REQUIRED', severity: 'BLOCK', nodeId: node.nodeId, field: 'expectedOutputs', message: 'Simulate the position against current pool state and review the exact Solana transaction before execution.' }); continue; }
    if (node.actionType !== 'asset.swap.exact-input') continue;
    if (node.chainId.startsWith('solana:')) { findings.push({ code: 'SOLANA_SWAP_QUOTE_REQUIRED', severity: 'BLOCK', nodeId: node.nodeId, field: 'expectedOutputs', message: 'Simulate a fresh quote and review the exact Solana transaction before execution.' }); continue; }
    const slippage = node.userConstraints.filter(c => c.kind === 'MAXIMUM_SLIPPAGE_BPS');
    if (slippage.length !== 1) findings.push({ code: 'SLIPPAGE_REQUIRED_ONCE', severity: 'BLOCK', nodeId: node.nodeId, field: 'userConstraints', message: 'Set one explicit slippage limit.' });
    else if (slippage[0]?.kind === 'MAXIMUM_SLIPPAGE_BPS') {
      const bps = slippage[0].maximumBps;
      if (bps === 0 || bps > 100 && bps <= 300) findings.push({ code: bps === 0 ? 'ZERO_SLIPPAGE' : 'ELEVATED_SLIPPAGE', severity: 'WARNING', nodeId: node.nodeId, field: 'slippage', message: 'Review the prototype slippage limit.' });
      if (bps > 300) findings.push({ code: 'SLIPPAGE_ABOVE_REVIEW_LIMIT', severity: 'BLOCK', nodeId: node.nodeId, field: 'slippage', message: 'Above the BUILD-003A review limit.' });
    }
    findings.push(bridgeSwap ? { code: 'DESTINATION_QUOTE_REQUIRED', severity: 'BLOCK', nodeId: node.nodeId, field: 'expectedOutputs',
      message: 'Reconcile Arbitrum USDC first, then quote the received amount and review a fresh MOCKED destination Manifest.' } : composition ? { code: 'COMPOSITION_FORK_REVIEW_REQUIRED', severity: 'BLOCK', nodeId: node.nodeId, field: 'expectedOutputs',
      message: 'This authoring graph needs a fresh fork quote, chained simulation and finite Safe/Roles review before local execution.' }
      : { code: 'UNQUOTED_EXECUTION_UNAVAILABLE', severity: 'BLOCK', nodeId: node.nodeId, field: 'expectedOutputs', message: 'Output is an unquoted placeholder. Execution is unavailable.' });
  }
  findings.sort((a, b) => a.nodeId.localeCompare(b.nodeId) || a.field.localeCompare(b.field) || a.code.localeCompare(b.code));
  return Object.freeze({ revision: workflow.revision, findings: Object.freeze(findings.map(f => Object.freeze(f))), executable: false, enforcement: 'NOT_ENFORCED' });
}
