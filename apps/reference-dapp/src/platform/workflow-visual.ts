// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-WORKFLOW-VISUAL-PRESENTATION-001: the one presentation model of a FloFi workflow, shared by MCP, Telegram and WhatsApp.
 *
 *   composeWorkflowOrRefuse (canonical IR + semanticWorkflowHash)  →  workflowVisualModel  →  workflowVisualLayout (EN/PT)  →  PNG / DOM
 *
 * A pure, deterministic projection of the canonical workflow: every fact is read from the composed Semantic Workflow IR through the
 * authoring modules' own readers (`workflowSteps`, `transferDetails`), in canonical node order. It is PRESENTATION ONLY: it is never an
 * input to composition, review, approval or execution, it does not alter the workflow or its hash, and `workflowHash` is a reference to
 * the authoritative canonical hash, not a new one. Nothing is inferred: a value the IR does not carry (minimum received, fees, quotes)
 * is absent, never estimated. No approval link, secret, session, token, capability, calldata or full address is ever part of it.
 */
import type { ReviewContext } from '@defi-workflow-engine/reference-linter';
import type { Workflow } from '../domain/initial-workflow';
import { transferDetails } from '../domain/robinhood-transfer-authoring';
import { ROUTER_NETWORK_OPTIONS } from '../domain/router-authoring';
import { workflowSteps, type WorkflowStep } from '../domain/workflow-steps';
import { semanticWorkflowHash, type WorkflowComposition } from '../engine/strategy-engine';

export const WORKFLOW_VISUAL_VERSION = 1;
export type VisualAction = 'SWAP' | 'BRIDGE' | 'SUPPLY' | 'BORROW' | 'REPAY' | 'WITHDRAW' | 'ADD_LIQUIDITY' | 'TRANSFER' | 'OTHER';
export type VisualChain = 'EVM' | 'SOLANA';
/** An exact amount as the IR states it (a decimal string, never rounded) and its asset symbol. */
export type VisualAmount = { readonly amount: string; readonly asset: string };
/** The one account a step names, shortened (`0x1234…abcd`), or the wallet that signs in FloFi. */
export type VisualAccount = { readonly role: 'RECIPIENT' | 'BENEFICIARY' | 'OWNER'; readonly address: string } | { readonly role: 'CONNECTED_WALLET' };
export type VisualStep = {
  /** Stable within one model: `s1`, `s2`, … in canonical order. */
  readonly id: string; readonly index: number; readonly action: VisualAction;
  /** The provider the IR names (`Uniswap v3`, `Aave V3`, `LI.FI / Across`, …); null when it names none. */
  readonly provider: string | null; readonly chain: VisualChain; readonly network: string; readonly toNetwork: string | null;
  /** EXACT: the amount the step moves. MAXIMUM: limits (a liquidity deposit never spends more). */
  readonly amounts: readonly VisualAmount[]; readonly amountKind: 'EXACT' | 'MAXIMUM';
  /** A swap's output asset: known as an asset only — the received amount comes from a quote, which the IR does not hold. */
  readonly toAsset: string | null;
  readonly slippageBps: number | null;
  readonly range: { readonly lower: string; readonly upper: string; readonly unit: string } | null;
  readonly account: VisualAccount | null;
  /** Test tokens, real funds, or unknown (null). */
  readonly testFunds: boolean | null;
};
export type VisualWarning = 'REAL_FUNDS' | 'DEBT_REMAINS' | 'SEQUENCE_NOT_EXECUTABLE';
export type WorkflowVisualModel = {
  readonly version: typeof WORKFLOW_VISUAL_VERSION;
  /** The canonical workflow hash this picture shows (single step: its semanticWorkflowHash; a step list: its sequence hash). */
  readonly workflowHash: string;
  readonly fundsClass: 'TEST_FUNDS' | 'REAL_FUNDS';
  readonly networks: readonly string[]; readonly chains: readonly VisualChain[];
  readonly steps: readonly VisualStep[];
  /** Dependencies between steps: the IR's own edges inside one workflow, and the order of a step list. */
  readonly connections: readonly { readonly from: string; readonly to: string }[];
  readonly warnings: readonly VisualWarning[];
};

const short = (address: string) => /^0x[0-9a-fA-F]{40}$/.test(address) ? `0x${address.slice(2, 6)}…${address.slice(-4)}`.toLowerCase() : address.length > 16
  ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
const bps = (value: string) => /^(0|[1-9][0-9]{0,4})$/.test(value) ? Number(value) : null;
const chainOf = (network: string): VisualChain => network.startsWith('Solana') ? 'SOLANA' : 'EVM';
const ROUTING_PROVIDER = { AUTO: 'LI.FI / Across', LIFI: 'LI.FI', ACROSS: 'Across' } as const;

type Projected = Omit<VisualStep, 'id' | 'index'>;
const step = (fields: Partial<Projected> & Pick<Projected, 'action' | 'network'>): Projected => ({ provider: null, chain: chainOf(fields.network), toNetwork: null,
  amounts: [], amountKind: 'EXACT', toAsset: null, slippageBps: null, range: null, account: null, testFunds: null, ...fields });

/** One IR step as the user sees it, from its typed detail (or the IR node's own reader); null for the editor's authoring-only template. */
function project(s: WorkflowStep, node: Workflow['nodes'][number] | undefined): Projected | null {
  const d = s.detail, testFunds = s.testFunds;
  switch (d.type) {
    case 'TEMPLATE': return null;
    case 'EVM_SWAP': return step({ action: 'SWAP', provider: 'Uniswap v3', network: d.network, amounts: [{ amount: d.amount, asset: d.from }], toAsset: d.to,
      slippageBps: bps(d.slippage), testFunds });
    case 'SOLANA_SWAP': return step({ action: 'SWAP', provider: s.protocol, network: d.input.network, chain: 'SOLANA', amounts: [{ amount: d.input.amount, asset: d.input.from }],
      toAsset: d.input.to, slippageBps: bps(d.input.slippage), testFunds });
    case 'ROUTER': {
      const option = ROUTER_NETWORK_OPTIONS[d.network];
      return step({ action: 'BRIDGE', provider: ROUTING_PROVIDER[d.input.routing], network: option.sourceLabel, toNetwork: option.destinationLabel,
        amounts: [{ amount: d.input.amount, asset: d.input.token }], slippageBps: bps(d.input.slippage),
        account: d.input.recipient ? { role: 'RECIPIENT', address: short(d.input.recipient) } : { role: 'CONNECTED_WALLET' }, testFunds });
    }
    case 'AAVE': return step({ action: d.operation, provider: 'Aave V3', network: d.input.network, amounts: [{ amount: d.input.amount, asset: d.input.asset }],
      account: { role: 'BENEFICIARY', address: short(d.input.beneficiary) }, testFunds });
    case 'AAVE_WITHDRAW': return step({ action: 'WITHDRAW', provider: 'Aave V3', network: d.input.network, amounts: [{ amount: d.input.amount, asset: d.input.asset }],
      account: { role: 'CONNECTED_WALLET' }, testFunds });
    case 'UNISWAP_LIQUIDITY': return step({ action: 'ADD_LIQUIDITY', provider: 'Uniswap v3', network: d.input.network, amountKind: 'MAXIMUM',
      amounts: [{ amount: d.input.maxUsdc, asset: 'USDC' }, { amount: d.input.maxWeth, asset: 'WETH' }], range: { lower: d.lowerPrice, upper: d.upperPrice, unit: 'USDC/WETH' },
      slippageBps: bps(d.input.slippage), testFunds });
    case 'ORCA_LIQUIDITY': return step({ action: 'ADD_LIQUIDITY', provider: s.protocol, network: d.input.network, chain: 'SOLANA', amountKind: 'MAXIMUM',
      amounts: [{ amount: d.input.maxSol, asset: 'SOL' }, { amount: d.input.maxDevUsdc, asset: 'devUSDC' }], range: { lower: d.lowerPrice, upper: d.upperPrice, unit: 'devUSDC/SOL' },
      slippageBps: bps(d.input.slippage), testFunds });
    case 'LENDING_COMPOSITION': {
      const owner: VisualAccount = { role: 'OWNER', address: short(d.input.owner) };
      if (d.role === 'SWAP') return step({ action: 'SWAP', provider: 'Uniswap v3', network: s.network, amounts: [{ amount: d.input.borrow, asset: 'USDC' }], toAsset: 'WETH',
        slippageBps: bps(d.input.slippage), account: owner, testFunds });
      return step({ action: d.role, provider: 'Aave V3', network: s.network, amounts: [{ amount: d.role === 'SUPPLY' ? d.input.supply : d.input.borrow, asset: 'USDC' }],
        account: owner, testFunds });
    }
    case 'OTHER': {
      const transfer = node ? transferDetails(node as Parameters<typeof transferDetails>[0]) : null;
      if (transfer) return step({ action: 'TRANSFER', network: transfer.network, amounts: [{ amount: transfer.amount, asset: transfer.asset }],
        account: { role: 'CONNECTED_WALLET' }, testFunds });
      // Described generically, never guessed: no amounts, no provider beyond what the IR names.
      return step({ action: 'OTHER', provider: s.protocol || null, network: s.network, testFunds });
    }
  }
}

type Part = { readonly steps: readonly { readonly nodeId: string; readonly projected: Projected }[]; readonly edges: readonly (readonly [string, string])[] };
/** One canonical IR → its visible steps (canonical order) and the IR's own dependency edges between them. */
function partOf(workflow: Workflow, context: ReviewContext): Part {
  const nodes = new Map(workflow.nodes.map(n => [n.nodeId, n]));
  const steps = workflowSteps(workflow, context).flatMap(s => { const projected = project(s, nodes.get(s.nodeId)); return projected ? [{ nodeId: s.nodeId, projected }] : []; });
  const visible = new Set(steps.map(s => s.nodeId));
  const edges = workflow.nodes.flatMap(n => visible.has(n.nodeId) ? n.dependencies.filter(dep => visible.has(dep)).map(dep => [dep, n.nodeId] as const) : []);
  return { steps, edges };
}

function assemble(parts: readonly Part[], workflowHash: string, fundsClass: WorkflowVisualModel['fundsClass'], extra: readonly VisualWarning[]): WorkflowVisualModel {
  const steps: VisualStep[] = [], connections: { from: string; to: string }[] = [];
  let previousLast: string | null = null;
  parts.forEach((part, p) => {
    const ids = new Map<string, string>();
    for (const s of part.steps) { const id = `s${steps.length + 1}`; ids.set(s.nodeId, id); steps.push(Object.freeze({ id, index: steps.length + 1, ...s.projected })); }
    for (const [from, to] of part.edges) connections.push({ from: ids.get(from)!, to: ids.get(to)! });
    // A step list runs in its order: the last step of one workflow leads to the first of the next.
    const first = part.steps[0] ? ids.get(part.steps[0].nodeId)! : null;
    if (p > 0 && previousLast && first) connections.push({ from: previousLast, to: first });
    if (part.steps.length) previousLast = ids.get(part.steps.at(-1)!.nodeId)!;
  });
  const networks = [...new Set(steps.flatMap(s => s.toNetwork ? [s.network, s.toNetwork] : [s.network]))];
  const chains = (['EVM', 'SOLANA'] as const).filter(c => steps.some(s => s.chain === c));
  const warnings = [...fundsClass === 'REAL_FUNDS' ? ['REAL_FUNDS' as const] : [], ...extra];
  return deepFreeze({ version: WORKFLOW_VISUAL_VERSION, workflowHash, fundsClass, networks, chains, steps, connections, warnings });
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) deepFreeze(item); Object.freeze(value); }
  return value;
}

/**
 * The visual model of a composed workflow (`composeWorkflowOrRefuse`): one step or a step list, in canonical order, bound to its canonical
 * workflow hash. Reads the composition; never modifies it.
 */
export function workflowVisualModel(workflow: WorkflowComposition): WorkflowVisualModel {
  const parts = workflow.steps.map(c => partOf(c.workflow, c.context));
  const extra: VisualWarning[] = [];
  if (workflow.steps.some(c => c.strategy.action === 'lending_composition')) extra.push('DEBT_REMAINS');
  if (workflow.steps.length > 1) extra.push('SEQUENCE_NOT_EXECUTABLE');
  return assemble(parts, workflow.workflowHash, workflow.fundsClass, extra);
}
/** The visual model of one canonical IR (e.g. a FloFi-authored workflow), bound to its `semanticWorkflowHash`. */
export function workflowVisualModelOfIr(workflow: Workflow, context: ReviewContext): WorkflowVisualModel {
  const part = partOf(workflow, context);
  const real = part.steps.some(s => s.projected.testFunds === false);
  return assemble([part], semanticWorkflowHash(workflow), real ? 'REAL_FUNDS' : 'TEST_FUNDS', []);
}

/** Every string a picture of this model can show (for output guards). */
export function visualModelStrings(model: WorkflowVisualModel): readonly string[] {
  return [...model.networks, ...model.steps.flatMap(s => [s.provider ?? '', s.network, s.toNetwork ?? '', s.toAsset ?? '', ...s.amounts.flatMap(a => [a.amount, a.asset]),
    ...s.range ? [s.range.lower, s.range.upper, s.range.unit] : [], ...s.account && 'address' in s.account ? [s.account.address] : []])].filter(Boolean);
}
