// SPDX-License-Identifier: AGPL-3.0-only
/** Human-readable authorization projections. These never quote, sign or execute. */
import type { Asset, AuthorizationPolicy, StrategyManifest } from '@defi-workflow-engine/workflow-contracts';
import { hashArtifactBytes } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
import type { ReviewContext } from '@defi-workflow-engine/reference-linter';
import { decodeApprove } from '@defi-workflow-engine/reference-compiler';
import type { Workflow } from './initial-workflow';
import { composerActions, composerSummary } from './composer-presentation';
import { projectSimulation, simulationAmount, simulationProvider, type SimulationLine, type SimulationSource } from './simulation-presentation';
import { shellChainLabel } from './product-shell';

export type ReviewToken = { address: string; chain: string; symbol: string; decimals: number };
export type ReviewApproval = { token: string; chain: string; spender: string; amount: string; kind: 'exact' | 'bounded'; spenderName?: string };
export type ReviewAuthorization = {
  key: string | null; manifest: unknown; policy?: unknown; owner: string | null; chain: string | null;
  ready: boolean; accepted: boolean; approve: (() => void | Promise<void>) | null;
  approvals: ReviewApproval[]; tokens: ReviewToken[]; limits: SimulationLine[]; technical: unknown;
};
export type ReviewWallet = { account: string | null; chain: string | null; environment: 'mainnet' | 'testnet' | 'unknown'; changed: boolean };

export function reviewedManifest(value: unknown): StrategyManifest | null {
  if (!value) return null;
  try { validateArtifact('strategy-manifest', value); return value as StrategyManifest; } catch { return null; }
}
function reviewedPolicy(value: unknown): AuthorizationPolicy | null {
  if (!value) return null;
  try { validateArtifact('authorization-policy', value); return value as AuthorizationPolicy; } catch { return null; }
}
/** Decode the actual ERC-20 call; a workflow spend limit is never substituted for its allowance. */
export function reviewApprovalCall(to: string, data: string, chain: string, spenderName?: string): ReviewApproval | null {
  // Delegated flows wrap an ERC-20 approval in a Safe owner transaction. Inspect its real inner call.
  if (/^0x6a761202[0-9a-f]+$/i.test(data)) {
    try {
      const body = data.slice(10), target = `0x${body.slice(24, 64)}`;
      const offset = Number(BigInt(`0x${body.slice(128, 192)}`)) * 2;
      if (!Number.isSafeInteger(offset) || offset < 640 || offset + 64 > body.length) return null;
      const length = Number(BigInt(`0x${body.slice(offset, offset + 64)}`)) * 2;
      if (length !== 136 || offset + 64 + length > body.length) return null;
      return reviewApprovalCall(target, `0x${body.slice(offset + 64, offset + 64 + length)}`, chain, spenderName);
    } catch { return null; }
  }
  if (!/^0x095ea7b3[0-9a-f]{128}$/i.test(data)) return null;
  try {
    const bytes = Uint8Array.from(data.slice(2).match(/../g)!, byte => parseInt(byte, 16));
    const decoded = decodeApprove(bytes);
    return { token: to, chain, spender: decoded.spender, amount: decoded.amount.toString(), kind: 'exact', ...(spenderName ? { spenderName } : {}) };
  } catch { return null; }
}
const short = (address: string) => address.length > 16 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
const sameAddress = (a: string, b: string, chain: string) => chain.startsWith('eip155:') ? a.toLowerCase() === b.toLowerCase() : a === b;
export function reviewToken(asset: Asset, tokens: ReviewToken[], context: ReviewContext): { symbol: string; decimals: number } {
  if ('nativeId' in asset) return { symbol: asset.nativeId, decimals: asset.decimals };
  const token = tokens.find(t => t.chain === asset.chainId && sameAddress(t.address, asset.address, asset.chainId));
  if (token) return token;
  const entry = Object.entries(context.assets).find(([, t]) => 'address' in t.asset && t.asset.chainId === asset.chainId && sameAddress(t.asset.address, asset.address, asset.chainId));
  return { symbol: entry?.[0] ?? `Token ${short(asset.address)}`, decimals: asset.decimals };
}
export function reviewApprovalValue(approval: ReviewApproval, tokens: ReviewToken[], context: ReviewContext) {
  const token = tokens.find(t => t.chain === approval.chain && sameAddress(t.address, approval.token, approval.chain));
  const known = token ?? Object.entries(context.assets).map(([symbol, t]) => ({ symbol, ...t.asset, address: 'address' in t.asset ? t.asset.address : '' }))
    .find(t => t.chainId === approval.chain && sameAddress(t.address, approval.token, approval.chain));
  const symbol = known?.symbol ?? `Token ${short(approval.token)}`;
  const unlimited = approval.amount === ((1n << 256n) - 1n).toString();
  const amount = known ? simulationAmount(approval.amount, known.decimals, symbol) : `${approval.amount} token units`;
  return { symbol, unlimited, value: unlimited ? 'Unlimited approval' : `${approval.kind === 'bounded' ? 'Up to ' : 'Exactly '}${amount}`, spender: approval.spenderName ?? short(approval.spender), network: shellChainLabel(approval.chain) };
}

export function projectReview(workflow: Workflow, context: ReviewContext, source: SimulationSource, authorization: ReviewAuthorization, wallet: ReviewWallet, now = Date.now(), invalidWorkflow = false) {
  const simulation = projectSimulation(workflow, context, source, now);
  const manifest = reviewedManifest(authorization.manifest), policy = reviewedPolicy(authorization.policy);
  const tokens = authorization.tokens;
  const amount = (asset: Asset, units: string) => { const token = reviewToken(asset, tokens, context); return simulationAmount(units, token.decimals, token.symbol); };
  const limits: SimulationLine[] = [...authorization.limits];
  if (manifest) {
    for (const spend of manifest.spendLimits) {
      const network = shellChainLabel(spend.asset.chainId);
      for (const [label, units] of [['Max spend', spend.maximumAmount], ['Max per action', spend.maximumPerStepAmount], ['Max total spend', spend.maximumCumulativeAmount]] as const) {
        const value = amount(spend.asset, units); if (value !== null) limits.push({ label, value, note: network });
      }
    }
    limits.push({ label: 'Max slippage', value: `${(manifest.maximumSlippageBps / 100).toFixed(2)}%` });
    const providers = manifest.providers.kind === 'FIXED' ? [manifest.providers.providerId] : manifest.providers.providerIds;
    const names: Record<string, string> = { 'aave-v3': 'Aave V3', 'uniswap.v3': 'Uniswap V3', 'uniswap-500': 'Uniswap V3', 'uniswap-v3.swap-router-02': 'Uniswap V3', 'uniswap-v3.position-manager': 'Uniswap V3', 'jupiter.swap-v2': 'Jupiter', 'orca.whirlpools-devnet': 'Orca Whirlpools', 'orca.whirlpools-devnet-liquidity': 'Orca Whirlpools', 'evm.native-transfer': 'Wallet transfer' };
    const labels = providers.map(id => simulationProvider(id) ?? names[id] ?? id.split(':').map(part => simulationProvider(part) ?? names[part]).filter(Boolean).join(' · ')).filter((name): name is string => Boolean(name));
    if (labels.length) limits.push({ label: 'Allowed providers', value: labels.join(' · ') });
    for (const [label, budgets] of [['Max network cost', manifest.gasBudgets], ['Max provider fees', manifest.feeBudgets]] as const) for (const budget of budgets) {
      const value = amount(budget.asset, budget.maximumAmount); if (value !== null) limits.push({ label, value, note: shellChainLabel(budget.asset.chainId) });
    }
    limits.push({ label: 'Residual assets return to', value: short(manifest.recovery.residualAssetRecipient.address) });
  }
  if (policy) {
    if (policy.allowlists.chains.length) limits.push({ label: 'Allowed networks', value: policy.allowlists.chains.map(shellChainLabel).join(' · ') });
    if (manifest?.spendLimits.length) limits.push({ label: 'Assets covered by spend limits', value: [...new Set(manifest.spendLimits.map(s => reviewToken(s.asset, tokens, context).symbol))].join(' · ') });
    if (policy.allowlists.recipients.length) limits.push({ label: 'Recipients', value: policy.allowlists.recipients.map(r => short(r.address)).join(' · ') });
    for (const risk of policy.accountRiskRules) {
      limits.push({ label: 'Minimum health factor', value: `${risk.minimumHealthFactorNumerator} / ${risk.minimumHealthFactorDenominator}` });
      limits.push({ label: 'Max loan-to-value', value: `${(risk.maximumLtvBps / 100).toFixed(2)}%` });
    }
  }
  const steps = composerActions(workflow).map((node, index) => {
    const card = composerSummary(workflow, node, context), simulated = simulation.steps.find(s => s.id === node.nodeId);
    return { id: node.nodeId, number: index + 1, action: card.action.includes('.') ? 'Action' : card.action, input: card.amount === 'Amount not available' ? '—' : card.amount, pair: card.bridgePair ?? card.detail,
      network: card.chain, provider: simulated?.provider ?? (card.provider === 'Provider not specified' ? null : card.provider) };
  });
  const permissions = [...new Set(steps.map(step => step.action).filter(action => action !== 'Action'))];
  if (authorization.approvals.length) permissions.push('Token approval');
  // Fork records use the fork's block clock. Never compare their historical block dates to wall time.
  const forkClock = ['fork-swap', 'fork-pool', 'composition', 'delegated-swap'].includes(source.kind);
  const expiries = [simulation.expiresAt, manifest && !forkClock ? Date.parse(manifest.expiresAt) : null, policy && !forkClock ? Date.parse(policy.deadline) : null].filter((value): value is number => value !== null && Number.isFinite(value));
  const expiresAt = expiries.length ? Math.min(...expiries) : null;
  const walletMismatch = Boolean(authorization.owner && wallet.account && !sameAddress(authorization.owner, wallet.account, authorization.chain ?? ''));
  const networkMismatch = Boolean(authorization.chain && wallet.chain !== authorization.chain);
  let manifestMismatch = false;
  if (manifest) {
    try { manifestMismatch = manifest.semanticWorkflowRevision !== workflow.revision || manifest.semanticWorkflowHash !== hashArtifactBytes('semantic-workflow', new TextEncoder().encode(JSON.stringify(workflow))); }
    catch { manifestMismatch = true; }
  }
  const policyMismatch = Boolean(authorization.policy && (!policy || manifest && hashArtifactBytes('authorization-policy', new TextEncoder().encode(JSON.stringify(policy))) !== manifest.policyHash));
  let status = 'ready', label = 'Ready to approve', message = 'Review the workflow and limits, then confirm your authorization.';
  if (authorization.accepted) { status = 'approved'; label = 'Review approved'; message = 'This workflow has been reviewed. Each required wallet signature is still a separate confirmation.'; }
  if (!authorization.key || !authorization.ready || !authorization.approve) { status = 'blocked'; label = 'Review blocked'; message = 'Run a valid simulation before approving this workflow.'; }
  if (source.kind === 'across') { status = 'blocked'; label = 'Review blocked'; message = 'This route provides a quote preview. Wallet authorization is not available for this route.'; }
  if (simulation.message === 'Run a simulation to see the expected result.' && authorization.key) { status = 'blocked'; label = 'Review blocked'; message = 'A simulation that can authorize this workflow is required before approval.'; }
  if (simulation.status === 'blocked' || invalidWorkflow || authorization.manifest && !manifest || policyMismatch) { status = 'blocked'; label = 'Review blocked'; message = invalidWorkflow ? 'Check this workflow in Build, then simulate again.' : simulation.status === 'blocked' ? simulation.message : 'The authorization could not be verified. Simulate again before approving.'; }
  if (manifestMismatch || 'retired' in source.state && source.state.retired || /workflow.*changed/i.test(simulation.message)) { status = 'invalidated'; label = 'Review required again'; message = 'Workflow changed. Simulate again for a fresh review.'; }
  if (wallet.changed || walletMismatch) { status = 'invalidated'; label = 'Review required again'; message = 'Wallet changed. Simulate and review this workflow again with the connected wallet.'; }
  if (!wallet.account) { status = 'blocked'; label = 'Connect your wallet'; message = 'Connect the wallet that will authorize this workflow.'; }
  if (networkMismatch && wallet.account) { status = 'invalidated'; label = 'Review required again'; message = 'Network changed. Connect on the reviewed network, then simulate again.'; }
  if (expiresAt !== null && now >= expiresAt || /expired/i.test(simulation.message)) { status = 'expired'; label = 'Simulation expired'; message = 'Run Simulate again to refresh this review.'; }
  const preview = steps.map(step => `${step.action} · ${step.input}${step.pair ? ` · ${step.pair}` : ''} · ${step.network}${step.provider ? ` · ${step.provider}` : ''}`);
  for (const line of limits.filter(l => ['Max spend', 'Max slippage', 'Recipient', 'Recipients', 'Minimum health factor'].includes(l.label))) preview.push(`${line.label} · ${line.value}`);
  // Accepted authority remains bound to the same wallet, workflow and unexpired policy.
  // Consuming a request can close the Review CTA without invalidating this binding.
  const bindingValid = Boolean(authorization.accepted && authorization.key && authorization.approve && wallet.account && !wallet.changed && !walletMismatch && !networkMismatch && !manifestMismatch && !policyMismatch && !(authorization.manifest && !manifest) && !invalidWorkflow && !('retired' in source.state && source.state.retired) && !/workflow.*changed|expired/i.test(simulation.message) && simulation.status !== 'blocked' && simulation.message !== 'Run a simulation to see the expected result.' && source.kind !== 'across' && (expiresAt === null || now < expiresAt));
  return { bindingValid, status, label, message, canApprove: status === 'ready', steps, permissions, limits, preview, expiresAt, warnings: simulation.warnings,
    approvals: authorization.approvals.map(a => ({ ...reviewApprovalValue(a, tokens, context), address: a.spender })), manifest };
}
