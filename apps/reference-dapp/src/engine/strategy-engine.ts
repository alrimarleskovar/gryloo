// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-001: the server-safe deterministic engine facade.
 *
 * It composes the functions the DApp already uses — no new authoring semantics:
 *   StrategySpec → the existing typed `Command` (the canvas/chat command set) → `editorReducer` from the initial editor state
 *   with the DApp's own ReviewContext → canonical Semantic Workflow IR (+ `semanticWorkflowHash`) → `lintWorkflow`,
 *   `resolveWorkflowCapability`, `describeProposal`, `summarize`, `workflowSteps`.
 * Pure: no React, network, storage, wallet, clock or model. The same spec always yields the same IR and hash, and that IR is
 * byte-identical to what the DApp authors for the equivalent chat sentence (tested). Nothing here can quote, simulate,
 * authorize, sign or submit; a composed workflow authorizes nothing.
 */
import { baseAssetRegistry, referenceRegistry, resolveWorkflowCapability, type CapabilityBlocker, type EvidenceMaturity,
  type ExecutionEnvironment } from '@defi-workflow-engine/action-registry';
import { createReviewContext, lintWorkflow, reviewContextForChain, type ReviewContext } from '@defi-workflow-engine/reference-linter';
import { createHash } from 'node:crypto';
import { hashArtifactBytes } from '@defi-workflow-engine/workflow-contracts';
import { capabilityBlockMessage } from '../domain/capability-view';
import { summarize, type Command } from '../domain/commands';
import { editorReducer, initialEditor, type EditorState } from '../domain/editor';
import type { Workflow } from '../domain/initial-workflow';
import { createSolanaSwapNode } from '../domain/jupiter-authoring';
import { createAuthoredLending } from '../domain/lending-authoring';
import { describeProposal } from '../domain/proposal';
import { createRouterNode, ROUTER_NETWORK_OPTIONS, type RouterBridgeInput } from '../domain/router-authoring';
import { createSolanaLiquidityNode, SOLANA_LIQUIDITY_DEFAULT_SLIPPAGE } from '../domain/solana-liquidity-authoring';
import { createAuthoredBorrow, createAuthoredRepay, createAuthoredSupply, createAuthoredWithdraw, type LendingNetwork } from '../domain/supply-authoring';
import { createSwapNode, type Direction } from '../domain/swap-authoring';
import { createUniswapLiquidityNode, uniswapLiquidityProfileFor, type UniswapLiquidityNetwork } from '../domain/uniswap-liquidity-authoring';
import { workflowSteps, type WorkflowStep } from '../domain/workflow-steps';
import { isStrategyInput, isStrategySpec, isStrategyWorkflow, strategyInputIssues, strategySpecIssues, type NetworkId, type SchemaIssue, type StrategyInput,
  type StrategySpec } from './strategy-spec';

/** The DApp's initial ReviewContext (`app/page.tsx`): Base mainnet assets from the reference registry. */
export function dappReviewContext(): ReviewContext {
  return createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]!.id,
    actionId: referenceRegistry.actions[0]!.id, assets: baseAssetRegistry });
}
/** The context the DApp derives for a workflow (`state/workflow-store.tsx`): a testnet swap's own chain, else the initial one. */
export function reviewContextOf(workflow: Workflow): ReviewContext {
  const swapChain = workflow.nodes.find(n => n.actionType === 'asset.swap.exact-input' && (n.chainId === 'eip155:84532' || n.chainId === 'eip155:11155111'))?.chainId;
  return swapChain ? reviewContextForChain(swapChain, dappReviewContext()) : dappReviewContext();
}
/** The canonical `semanticWorkflowHash`, computed exactly as the flows compute it for Review and the Manifest. */
export function semanticWorkflowHash(workflow: Workflow): string {
  return hashArtifactBytes('semantic-workflow', new TextEncoder().encode(JSON.stringify(workflow)));
}

/** Network facts the facade needs; labels are the authoring modules' own network names. */
export const NETWORKS: Readonly<Record<NetworkId, { readonly label: string; readonly class: 'MAINNET' | 'TESTNET' | 'DEVNET'; readonly environment: ExecutionEnvironment }>> = Object.freeze({
  'base': { label: 'Base', class: 'MAINNET', environment: 'MAINNET' },
  'base-sepolia': { label: 'Base Sepolia', class: 'TESTNET', environment: 'PUBLIC_TESTNET' },
  'arbitrum-one': { label: 'Arbitrum One', class: 'MAINNET', environment: 'MAINNET' },
  'arbitrum-sepolia': { label: 'Arbitrum Sepolia', class: 'TESTNET', environment: 'PUBLIC_TESTNET' },
  'ethereum-sepolia': { label: 'Ethereum Sepolia', class: 'TESTNET', environment: 'PUBLIC_TESTNET' },
  'solana': { label: 'Solana', class: 'MAINNET', environment: 'MAINNET' },
  'solana-devnet': { label: 'Solana Devnet', class: 'DEVNET', environment: 'PUBLIC_TESTNET' },
});
const ROUTING = { auto: 'AUTO', lifi: 'LIFI', across: 'ACROSS' } as const;
/** Defaults FloFi applies when a spec omits slippage: the same values the Copilot planners and profiles use. */
export function defaultSlippageBps(spec: StrategySpec): number | null {
  switch (spec.action) {
    case 'bridge': return ROUTER_NETWORK_OPTIONS[spec.sourceNetwork === 'base' ? 'mainnet' : 'testnet'].profile.defaultSlippageBps;
    case 'swap': case 'lending_composition': return 50;
    case 'add_liquidity': return spec.network === 'solana-devnet' ? Number(SOLANA_LIQUIDITY_DEFAULT_SLIPPAGE)
      : uniswapLiquidityProfileFor(NETWORKS[spec.network].label).defaultSlippageBps;
    default: return null;
  }
}
/** Primary network of a spec (the bridge's source). */
export const strategyNetwork = (spec: StrategySpec): NetworkId => spec.action === 'bridge' ? spec.sourceNetwork : spec.network;

/** The spec with every default made explicit and addresses lower-cased: its canonical form. */
export function normalizeStrategy(spec: StrategySpec): { readonly strategy: StrategySpec; readonly notes: readonly string[] } {
  const notes: string[] = [], lower = (value: string) => value.toLowerCase();
  const slippage = 'slippageBps' in spec && spec.slippageBps !== undefined ? spec.slippageBps : defaultSlippageBps(spec);
  if (!('slippageBps' in spec && spec.slippageBps !== undefined) && slippage !== null) notes.push(`Default slippage ${slippage} bps applied.`);
  switch (spec.action) {
    case 'bridge': {
      if (spec.routing === undefined) notes.push('Default routing auto applied: LI.FI first, direct Across only if LI.FI has no reconcilable route.');
      if (spec.recipient === undefined) notes.push('No recipient given: the wallet that signs in the FloFi app receives the funds (bound at Review).');
      return { notes, strategy: { version: 1, action: 'bridge', sourceNetwork: spec.sourceNetwork, destinationNetwork: spec.destinationNetwork, asset: 'USDC', amount: spec.amount,
        routing: spec.routing ?? 'auto', slippageBps: slippage!, ...spec.recipient === undefined ? {} : { recipient: lower(spec.recipient) } } };
    }
    case 'swap': return { notes, strategy: { version: 1, action: 'swap', network: spec.network, inputAsset: spec.inputAsset, outputAsset: spec.outputAsset, amount: spec.amount, slippageBps: slippage! } };
    case 'supply': case 'borrow': case 'repay':
      return { notes, strategy: { version: 1, action: spec.action, network: spec.network, asset: spec.asset, amount: spec.amount, beneficiary: lower(spec.beneficiary) } };
    case 'withdraw': return { notes, strategy: { version: 1, action: 'withdraw', network: spec.network, asset: spec.asset, amount: spec.amount } };
    case 'add_liquidity': return { notes, strategy: { version: 1, action: 'add_liquidity', network: spec.network, maxAmounts: { ...spec.maxAmounts },
      range: { unit: spec.range.unit, lower: spec.range.lower, upper: spec.range.upper }, slippageBps: slippage! } };
    case 'lending_composition': return { notes, strategy: { version: 1, action: 'lending_composition', network: 'base-sepolia', asset: 'USDC', supplyAmount: spec.supplyAmount,
      borrowAmount: spec.borrowAmount, outputAsset: 'WETH', slippageBps: slippage!, owner: lower(spec.owner) } };
  }
}

type Built = { readonly command: Command; readonly check: () => unknown };
class Refusal extends Error {}
const refuse = (code: string): never => { throw new Refusal(code); };
const base = { source: 'CHAT', baseRevision: 0 } as const;
/**
 * A normalized spec → the existing authoring command, plus the builder the reducer will run (called first so a refusal keeps
 * its specific code, as `parseLocalCommand` does). Unsupported combinations are refused, never mapped to something nearby.
 */
function build(spec: StrategySpec, context: ReviewContext): Built {
  const slippage = 'slippageBps' in spec ? String(spec.slippageBps) : '';
  switch (spec.action) {
    case 'bridge': {
      const input: RouterBridgeInput = { source: spec.sourceNetwork === 'base' ? 'Base' : 'Base Sepolia', destination: spec.destinationNetwork === 'arbitrum-one' ? 'Arbitrum' : 'Arbitrum Sepolia',
        token: 'USDC', amount: spec.amount, recipient: spec.recipient ?? '', slippage, routing: ROUTING[spec.routing ?? 'auto'] };
      return { command: { ...base, type: 'ADD_ROUTER_BRIDGE', input }, check: () => createRouterNode('node-preview', input) };
    }
    case 'swap': {
      if (spec.inputAsset === spec.outputAsset) refuse('INVALID_ASSET_PAIR');
      if (spec.network === 'solana' || spec.network === 'solana-devnet') {
        const input = { network: NETWORKS[spec.network].label as 'Solana' | 'Solana Devnet', from: spec.inputAsset as never, to: spec.outputAsset as never, amount: spec.amount, slippage };
        return { command: { ...base, type: 'ADD_SOLANA_SWAP', input }, check: () => createSolanaSwapNode('node-preview', input) };
      }
      const pair = `${spec.inputAsset}>${spec.outputAsset}`;
      const direction: Direction = pair === 'USDC>WETH' ? 'USDC_TO_WETH' : pair === 'WETH>USDC' ? 'WETH_TO_USDC' : refuse('SWAP_ASSET_PAIR_UNSUPPORTED');
      const type = spec.network === 'base' ? 'ADD_SWAP' : spec.network === 'base-sepolia' ? 'ADD_TESTNET_SWAP' : 'ADD_ETHEREUM_SEPOLIA_SWAP';
      const swapContext = spec.network === 'base' ? context : reviewContextForChain(spec.network === 'base-sepolia' ? 'eip155:84532' : 'eip155:11155111', context);
      return { command: { ...base, type, direction, amount: spec.amount, slippage }, check: () => createSwapNode('node-preview', direction, spec.amount, slippage, swapContext) };
    }
    case 'supply': case 'borrow': case 'repay': {
      const input = { network: NETWORKS[spec.network].label as LendingNetwork, asset: spec.asset, amount: spec.amount, beneficiary: spec.beneficiary };
      const create = spec.action === 'supply' ? createAuthoredSupply : spec.action === 'borrow' ? createAuthoredBorrow : createAuthoredRepay;
      return { command: { ...base, type: spec.action === 'supply' ? 'ADD_SUPPLY' : spec.action === 'borrow' ? 'ADD_BORROW' : 'ADD_REPAY', input }, check: () => create('node-preview', input) };
    }
    case 'withdraw': {
      const input = { network: NETWORKS[spec.network].label as LendingNetwork, asset: spec.asset, amount: spec.amount, recipient: 'CONNECTED_OWNER' as const };
      return { command: { ...base, type: 'ADD_WITHDRAW', input }, check: () => createAuthoredWithdraw('node-preview', input) };
    }
    case 'add_liquidity': {
      const amounts = spec.maxAmounts, keys = Object.keys(amounts).sort().join();
      const rangeUnit = spec.range.unit === 'price' ? 'PRICE' as const : 'TICK' as const, { lower, upper } = spec.range;
      if (spec.network === 'solana-devnet') {
        if (keys !== 'SOL,devUSDC') refuse('LIQUIDITY_ASSET_PAIR_UNSUPPORTED');
        const input = { network: 'Solana Devnet' as const, maxSol: amounts.SOL!, maxDevUsdc: amounts.devUSDC!, rangeUnit, lower, upper, slippage };
        return { command: { ...base, type: 'ADD_SOLANA_LIQUIDITY', input }, check: () => createSolanaLiquidityNode('node-preview', input) };
      }
      if (keys !== 'USDC,WETH') refuse('LIQUIDITY_ASSET_PAIR_UNSUPPORTED');
      const input = { network: NETWORKS[spec.network].label as UniswapLiquidityNetwork, maxUsdc: amounts.USDC!, maxWeth: amounts.WETH!, rangeUnit, lower, upper, slippage };
      return { command: { ...base, type: 'ADD_UNISWAP_LIQUIDITY', input }, check: () => createUniswapLiquidityNode('node-preview', input) };
    }
    case 'lending_composition': {
      const input = { supply: spec.supplyAmount, borrow: spec.borrowAmount, slippage, owner: spec.owner };
      return { command: { ...base, type: 'AUTHOR_LENDING', input }, check: () => createAuthoredLending('lending-preview', 1, input) };
    }
  }
}

export type ComposeFailure = { readonly ok: false; readonly code: string; readonly issues: readonly SchemaIssue[] };
export type Composition = {
  readonly ok: true; readonly strategy: StrategySpec; readonly command: Command; readonly workflow: Workflow; readonly workflowHash: string;
  readonly context: ReviewContext; readonly steps: readonly WorkflowStep[]; readonly explanation: readonly string[]; readonly summary: string;
  readonly notes: readonly string[]; readonly fundsClass: 'TEST_FUNDS' | 'REAL_FUNDS';
};
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;
const codeOf = (cause: unknown, fallback: string) => cause instanceof Error && CODE.test(cause.message) ? cause.message : fallback;

/**
 * Untrusted structured intent → the canonical IR revision the DApp would author for it, or a closed refusal code. The
 * reducer starts from the DApp's initial editor state (revision 0), so a composition is always revision 1.
 */
export function composeStrategy(input: unknown): Composition | ComposeFailure {
  if (!isStrategySpec(input)) return { ok: false, code: 'STRATEGY_SCHEMA_INVALID', issues: strategySpecIssues(input) };
  const { strategy, notes } = normalizeStrategy(input), context = dappReviewContext(), initial: EditorState = initialEditor();
  let built: Built;
  try { built = build(strategy, context); built.check(); }
  catch (cause) { return { ok: false, code: cause instanceof Refusal ? cause.message : codeOf(cause, 'STRATEGY_UNSUPPORTED'), issues: [] }; }
  const after = editorReducer(initial, built.command, context);
  if (after.error) return { ok: false, code: CODE.test(after.error) ? after.error : after.error.split(':')[0]!.trim() || 'STRATEGY_UNSUPPORTED', issues: [] };
  const workflow = after.workflow, workflowContext = reviewContextOf(workflow), steps = workflowSteps(workflow, workflowContext);
  const real = steps.some(step => step.testFunds === false);
  return { ok: true, strategy, command: built.command, workflow, workflowHash: semanticWorkflowHash(workflow), context: workflowContext, steps,
    explanation: describeProposal(initial, after, built.command, context), summary: summarize(workflow, workflowContext), notes,
    fundsClass: real ? 'REAL_FUNDS' : 'TEST_FUNDS' };
}

/** Composition bound to a hash the caller saw earlier: a different hash is a stale or altered strategy, never silently replaced. */
export function composeBound(input: unknown, expectedHash: string | undefined): Composition | ComposeFailure {
  const composed = composeStrategy(input);
  if (composed.ok && expectedHash !== undefined && expectedHash !== composed.workflowHash) return { ok: false, code: 'STRATEGY_WORKFLOW_HASH_MISMATCH', issues: [] };
  return composed;
}

/**
 * BUILD-MCP-002: a step-list workflow (`version: 2`, or a v1 strategy as its one step). Each step is the ordinary single-action
 * composition with its own isolated IR and hash. One step: the workflow IS that step (same canonical strategy, same hash — a v1
 * strategy and a one-step workflow are indistinguishable). Several steps: the canonical strategy is the v2 list of normalized steps
 * and the workflow hash covers the ordered step hashes. The exact Base Sepolia supply → borrow → swap shape is FloFi's existing
 * lending composition and is composed as such (one step, one executor).
 */
export type WorkflowComposition = {
  readonly ok: true; readonly strategy: StrategyInput; readonly workflowHash: string; readonly steps: readonly Composition[];
  readonly fundsClass: 'TEST_FUNDS' | 'REAL_FUNDS'; readonly notes: readonly string[];
};
/** The hash of an ordered list of step hashes (several steps only). */
export function workflowSequenceHash(stepHashes: readonly string[]): string {
  return '0x' + createHash('sha256').update(JSON.stringify({ contract: 'flofi-strategy-workflow', version: 2, steps: stepHashes })).digest('hex');
}
const sameAccount = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** Supply → borrow → swap of exactly the borrowed USDC to WETH, all on Base Sepolia for one account: the existing lending composition. */
function collapseLending(steps: readonly StrategySpec[]): readonly StrategySpec[] {
  if (steps.length !== 3) return steps;
  const [supply, borrow, swap] = steps;
  if (supply?.action !== 'supply' || borrow?.action !== 'borrow' || swap?.action !== 'swap') return steps;
  if (supply.network !== 'base-sepolia' || borrow.network !== 'base-sepolia' || swap.network !== 'base-sepolia' || supply.asset !== 'USDC' || borrow.asset !== 'USDC' ||
      swap.inputAsset !== 'USDC' || swap.outputAsset !== 'WETH' || swap.amount !== borrow.amount || !sameAccount(supply.beneficiary, borrow.beneficiary)) return steps;
  return [{ version: 1, action: 'lending_composition', network: 'base-sepolia', asset: 'USDC', supplyAmount: supply.amount, borrowAmount: borrow.amount, outputAsset: 'WETH',
    ...swap.slippageBps === undefined ? {} : { slippageBps: swap.slippageBps }, owner: supply.beneficiary }];
}
export function composeWorkflow(input: unknown): WorkflowComposition | ComposeFailure {
  if (!isStrategyInput(input)) return { ok: false, code: 'STRATEGY_SCHEMA_INVALID', issues: strategyInputIssues(input) };
  const specs = isStrategyWorkflow(input) ? collapseLending(input.steps.map(step => ({ ...step, version: 1 }) as StrategySpec)) : [input];
  const steps: Composition[] = [];
  for (const [index, spec] of specs.entries()) {
    const composed = composeStrategy(spec);
    if (!composed.ok) return { ...composed, issues: composed.issues.map(issue => ({ path: specs.length > 1 || isStrategyWorkflow(input) ? `/steps/${index}${issue.path === '/' ? '' : issue.path}` : issue.path, rule: issue.rule })) };
    steps.push(composed);
  }
  const fundsClass = steps.some(c => c.fundsClass === 'REAL_FUNDS') ? 'REAL_FUNDS' : 'TEST_FUNDS';
  if (steps.length === 1) return { ok: true, strategy: steps[0]!.strategy, workflowHash: steps[0]!.workflowHash, steps, fundsClass, notes: steps[0]!.notes };
  return { ok: true, strategy: { version: 2, steps: steps.map(c => c.strategy) }, workflowHash: workflowSequenceHash(steps.map(c => c.workflowHash)), steps, fundsClass,
    notes: steps.flatMap((c, i) => c.notes.map(note => `Step ${i + 1}: ${note}`)) };
}
export function composeWorkflowBound(input: unknown, expectedHash: string | undefined): WorkflowComposition | ComposeFailure {
  const composed = composeWorkflow(input);
  if (composed.ok && expectedHash !== undefined && expectedHash !== composed.workflowHash) return { ok: false, code: 'STRATEGY_WORKFLOW_HASH_MISMATCH', issues: [] };
  return composed;
}

export type FindingLevel = 'BLOCK' | 'WARNING' | 'INFORMATION';
export type StrategyFinding = { readonly level: FindingLevel; readonly code: string; readonly source: 'LINTER' | 'CAPABILITY' | 'STRATEGY';
  readonly nodeId: string | null; readonly message: string };
export type StrategyReview = {
  readonly environment: ExecutionEnvironment; readonly findings: readonly StrategyFinding[];
  readonly capability: { readonly executionImplementedForOwnerWallet: boolean; readonly evidenceCeiling: EvidenceMaturity | null;
    readonly blockers: readonly (CapabilityBlocker & { readonly message: string })[] };
};
// Blockers that only the owner's own steps in the FloFi app clear (connect, simulate, review, authorize): information, not defects.
const OWNER_STEPS = new Set(['WALLET_NOT_CONNECTED', 'WRONG_WALLET_CHAIN', 'ARTIFACTS_MISSING', 'ARTIFACTS_STALE', 'SIMULATION_REQUIRED', 'AUTHORIZATION_REQUIRED']);

/**
 * The deterministic Strategy Review Engine (§9.1) over a composition: the linter, the capability registry for the network's
 * public environment, and strategy-level warnings. It never approves anything; the owner's Review in the FloFi app does.
 */
export function reviewComposition(composed: Composition): StrategyReview {
  const environment = NETWORKS[strategyNetwork(composed.strategy)].environment, findings: StrategyFinding[] = [];
  for (const f of lintWorkflow(composed.workflow, composed.context).findings)
    findings.push({ level: f.severity === 'BLOCK' ? 'BLOCK' : 'WARNING', code: f.code, source: 'LINTER', nodeId: f.nodeId, message: f.message });
  const capability = resolveWorkflowCapability(composed.workflow, { environment, runtime: {} });
  const required = new Set(capability.nodes.filter(n => !n.actionType.startsWith('mock-')).map(n => n.nodeId));
  const blockers = capability.blockers.map(b => ({ ...b, message: capabilityBlockMessage(b, capability.nodes.find(n => n.nodeId === b.nodeId)) }));
  for (const b of blockers) {
    if (!required.has(b.nodeId)) continue;
    findings.push({ level: OWNER_STEPS.has(b.code) ? 'INFORMATION' : 'BLOCK', code: b.code, source: 'CAPABILITY', nodeId: b.nodeId, message: b.message });
  }
  const s = composed.strategy;
  if (composed.fundsClass === 'REAL_FUNDS') findings.push({ level: 'WARNING', code: 'REAL_FUNDS', source: 'STRATEGY', nodeId: null,
    message: 'This strategy uses a mainnet: real funds. Nothing executes without the owner\'s Review and wallet signature in the FloFi app.' });
  if (s.action === 'bridge' && s.recipient) findings.push({ level: 'WARNING', code: 'EXPLICIT_RECIPIENT', source: 'STRATEGY', nodeId: null,
    message: `Funds are delivered to ${s.recipient}, not necessarily the signing wallet. Confirm this address belongs to the intended recipient.` });
  if ((s.action === 'supply' || s.action === 'borrow' || s.action === 'repay') && s.beneficiary) findings.push({ level: 'WARNING', code: 'EXPLICIT_BENEFICIARY', source: 'STRATEGY', nodeId: null,
    message: `The Aave position of ${s.beneficiary} is affected (onBehalfOf). Confirm it is the intended account; the signer may differ.` });
  if (s.action === 'lending_composition') findings.push({ level: 'WARNING', code: 'DEBT_REMAINS', source: 'STRATEGY', nodeId: null,
    message: 'Debt remains after the swap. If the swap fails, the borrowed USDC and the debt remain; there is no automatic repayment.' });
  findings.push({ level: 'INFORMATION', code: 'OWNER_APPROVAL_REQUIRED', source: 'STRATEGY', nodeId: null,
    message: 'This review authorizes nothing. Execution needs a fresh simulation, the owner\'s Review and the owner\'s wallet signature in the FloFi app.' });
  return { environment, findings, capability: { executionImplementedForOwnerWallet: capability.executionSupported, evidenceCeiling: capability.evidenceCeiling, blockers } };
}
