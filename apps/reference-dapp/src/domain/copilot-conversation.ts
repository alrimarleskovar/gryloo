// SPDX-License-Identifier: AGPL-3.0-only
import type { ReviewContext } from '@defi-workflow-engine/reference-linter';
import { commandIsValid, type Command } from './commands';
import { editorReducer } from './editor';
import type { Workflow } from './initial-workflow';
import { lendingDetails } from './lending-authoring';
import { workflowSteps, type WorkflowStep } from './workflow-steps';
import { editCommandFor, removeCommandFor } from './workflow-edits';
import { COPILOT_AUTHORING_COMMANDS, COPILOT_NETWORK_LABEL, COPILOT_POOLS, amountReadings, copilotRejection, planCopilotActions, proposalFromPlan,
  type CarriedField, type CopilotOutcome, type Grounding } from './copilot-authoring';
import { COPILOT_LIMITS, hasUnsafeCharacters, safeCopilotProse, type CopilotAction, type CopilotLendingAction, type CopilotNetwork,
  type CopilotSwapAction } from './copilot-intent';
import { COPILOT_TRANSCRIPT, COPILOT_V2_LIMITS, isCopilotIntentError, parseCopilotIntentV2, type CopilotChanges, type CopilotIntentV2, type CopilotOrdinal, type CopilotQuestionTopic,
  type CopilotReuseField, type CopilotTarget } from './copilot-intent-v2';
import { copilotCopy, type CarriedLabel, type CopilotCopy, type CopilotLanguage } from './copilot-messages';
import { answerQuestion, stepSummary, type CopilotFacts } from './copilot-answers';

/**
 * BUILD-COPILOT-002: the conversation engine. Pure: no React, no network, no wallet, no execution. It keeps a bounded
 * transcript for the model's context, the open request segment (the only text explicit values may come from), Flofi's own
 * open question, and the proposals Flofi showed. Every reference is resolved here against the canonical workflow and
 * the visible pending proposal; the model never names a node. Every outcome is a reply plus, at most, one Command that
 * the caller hands to the existing `propose`; the workflow changes only when the user clicks Apply.
 */
export type TranscriptEntry = { readonly role: 'user' | 'assistant'; readonly text: string };
/** A proposal Flofi showed, as Flofi recorded it from the Command and its editor preview (never as the model described it). */
export type CopilotReferent = { readonly command: Command; readonly sentence: string; readonly step: WorkflowStep };
export type ContextSnapshot = { readonly workflow: Workflow; readonly pending: object | null; readonly wallet: string | null; readonly walletChainId: string | null };
type Resolved =
  | { readonly source: 'PENDING'; readonly step: WorkflowStep; readonly command: Command }
  | { readonly source: 'NODE'; readonly step: WorkflowStep }
  | { readonly source: 'REFERENT'; readonly step: WorkflowStep; readonly referent: CopilotReferent };
type DraftFill = { readonly kind: 'TARGET'; readonly target: Resolved } | { readonly kind: 'ACTION'; readonly patch: Readonly<Record<string, unknown>> };
/** Flofi's own open question: each button has a deterministic meaning, so answering it needs no model. */
type Draft = { readonly intent: CopilotIntentV2; readonly options: readonly { readonly label: string; readonly fill: DraftFill }[]; readonly amountFill: boolean;
  readonly snapshot: ContextSnapshot };
export type CopilotConversation = {
  readonly transcript: readonly TranscriptEntry[]; readonly segment: readonly string[]; readonly clarifications: number;
  readonly draft: Draft | null; readonly referents: readonly CopilotReferent[]; readonly language: CopilotLanguage;
};
export type CopilotEnvironment = {
  readonly workflow: Workflow; readonly context: ReviewContext; readonly wallet: string | null; readonly walletChainId: string | null;
  readonly pending: { readonly command: Command; readonly diff: readonly string[] } | null; readonly facts: CopilotFacts;
};
export type CopilotReply = {
  readonly kind: 'PROPOSAL' | 'ANSWER' | 'CLARIFICATION' | 'UNSUPPORTED' | 'FAILED'; readonly text: string; readonly notes: readonly string[];
  readonly options: readonly string[]; readonly command?: Command; readonly sentence?: string; readonly topic?: CopilotQuestionTopic;
};
export type CopilotRequestV2 = { readonly version: '2'; readonly messages: readonly TranscriptEntry[] };
export type CopilotResultV2 = { readonly ok: true; readonly intent: unknown } | { readonly ok: false; readonly code: string; readonly retryAfterSeconds?: number };
export type PendingTurn = { readonly before: CopilotConversation; readonly state: CopilotConversation; readonly snapshot: ContextSnapshot };
export type TurnStart = { readonly kind: 'LOCAL'; readonly reply: CopilotReply; readonly next: CopilotConversation }
  | { readonly kind: 'REMOTE'; readonly request: CopilotRequestV2; readonly turn: PendingTurn };
type Result = { readonly reply: CopilotReply; readonly next: CopilotConversation };

/** Every Command the Copilot may hand to `propose`: new authoring, typed edits of existing steps, and removal. */
export const COPILOT_V2_COMMANDS: ReadonlySet<string> = new Set([...COPILOT_AUTHORING_COMMANDS, 'SET_SUPPLY', 'SET_BORROW', 'SET_REPAY', 'SET_WITHDRAW',
  'SET_SOLANA_SWAP', 'SET_ROUTER_BRIDGE', 'SET_UNISWAP_LIQUIDITY', 'SET_SOLANA_LIQUIDITY', 'SET_SWAP_AMOUNT', 'SET_SLIPPAGE', 'REMOVE']);
export const emptyConversation = (): CopilotConversation => ({ transcript: [], segment: [], clarifications: 0, draft: null, referents: [], language: 'EN' });
export const snapshotOf = (env: CopilotEnvironment): ContextSnapshot =>
  ({ workflow: env.workflow, pending: env.pending, wallet: env.wallet, walletChainId: env.walletChainId });
/** What changed between two snapshots, by identity: the IR and the pending proposal are immutable objects replaced on every change. */
export function contextChange(a: ContextSnapshot, b: ContextSnapshot): 'WORKFLOW' | 'PROPOSAL' | 'WALLET' | null {
  if (a.workflow !== b.workflow) return 'WORKFLOW';
  if (a.pending !== b.pending) return 'PROPOSAL';
  return a.wallet !== b.wallet || a.walletChainId !== b.walletChainId ? 'WALLET' : null;
}

// A private key, seed phrase or other 64-hex secret is refused locally: it is never sent to the model and never stored.
const SECRET_WORDS = /\b(?:private[\s_-]*keys?|secret[\s_-]*keys?|seed[\s_-]*phrases?|recovery[\s_-]*phrases?|mnemonics?|chaves?[\s_-]*privadas?|frases?[\s_-]*(?:semente|secretas?|de\s+recupera[cç][aã]o)|palavras[\s_-]*secretas)\b/i;
const HEX_SECRET = /(?<![0-9a-fA-F])(?:0x)?[0-9a-fA-F]{64}(?![0-9a-fA-F])/;
const MNEMONIC = /^\s*(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\s*$/;
export const looksSecret = (text: string): boolean => SECRET_WORDS.test(text) || HEX_SECRET.test(text) || MNEMONIC.test(text);
// Carrying a value from an earlier step needs the user's own reuse wording; repeating a whole proposal needs a repeat cue.
const REUSE_CUE = /\b(?:same|again|also|too|as before|like before|mesm[oa]s?|igual|iguais|de novo|novamente|tamb[ée]m|outra vez|como antes)\b/i;
const REPEAT_CUE = /\b(?:same|again|repeat|once more|as before|like before|mesm[oa]s?|igual|de novo|novamente|repet\w*|outra vez|como antes)\b/i;

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const segmentText = (state: CopilotConversation) => state.segment.join('\n');
/** Flofi's own transcript entries never carry an address (a carried beneficiary, a connected wallet): the model needs none. */
const redact = (text: string) => text.replace(/0x[0-9a-fA-F]{40}/g, '[address]').slice(0, COPILOT_LIMITS.maxAssistantMessageLength);
function bounded(entries: readonly TranscriptEntry[]): TranscriptEntry[] {
  let out = entries.map(entry => entry.role === 'assistant' ? { role: entry.role, text: redact(entry.text) } : entry)
    .slice(-COPILOT_V2_LIMITS.maxTranscriptMessages);
  const size = (list: readonly TranscriptEntry[]) => list.reduce((total, entry) => total + entry.text.length, 0);
  while (out.filter(entry => entry.role === 'user').length > COPILOT_V2_LIMITS.maxUserTurns || size(out) > COPILOT_V2_LIMITS.maxRequestCharacters) out = out.slice(1);
  while (out.length && out[0]!.role !== 'user') out = out.slice(1);
  return out;
}
const withUser = (state: CopilotConversation, text: string): CopilotConversation => ({ ...state, draft: null,
  segment: [...state.segment, text].slice(-COPILOT_V2_LIMITS.maxSegmentUserTurns), transcript: bounded([...state.transcript, { role: 'user', text }]) });
export const closeSegment = (state: CopilotConversation): CopilotConversation => ({ ...state, segment: [], clarifications: 0, draft: null });
const reply = (kind: CopilotReply['kind'], text: string, extra: Partial<CopilotReply> = {}): CopilotReply => ({ kind, text, notes: [], options: [], ...extra });
/** A turn that ends the open request: proposal, answer, refusal or failure. */
const terminal = (state: CopilotConversation, value: CopilotReply, summary: string): Result =>
  ({ reply: value, next: { ...closeSegment(state), transcript: bounded([...state.transcript, { role: 'assistant', text: summary }]) } });
const failed = (state: CopilotConversation, m: CopilotCopy, message: string): Result =>
  terminal(state, reply('FAILED', /(?:Nothing changed|Nada mudou)\.$/.test(message) ? message : `${message} ${m.nothingChanged}`), COPILOT_TRANSCRIPT.declined + message);
const refused = (state: CopilotConversation, m: CopilotCopy, message: string): Result =>
  terminal(state, reply('UNSUPPORTED', message), COPILOT_TRANSCRIPT.declined + message);
/** A question keeps the request open, up to the clarification budget. */
function question(state: CopilotConversation, m: CopilotCopy, text: string, options: readonly string[], draft: Draft | null): Result {
  if (state.clarifications >= COPILOT_V2_LIMITS.maxClarifications) return failed(state, m, m.tooManyClarifications);
  return { reply: reply('CLARIFICATION', text, { options }),
    next: { ...state, clarifications: state.clarifications + 1, draft, transcript: bounded([...state.transcript, { role: 'assistant', text: COPILOT_TRANSCRIPT.asked + text }]) } };
}
export const failureText = (code: string, language: CopilotLanguage, retryAfterSeconds?: number): string => {
  const m = copilotCopy(language);
  return `${m.failures[code] ?? m.failureDefault}${retryAfterSeconds ? m.retryAfter(retryAfterSeconds) : ''}${m.failureSuffix}`;
};

// ── Steps, previews and referents ────────────────────────────────────────────────────────────────────────────────────
const editable = (step: WorkflowStep) => step.kind !== 'TEMPLATE' && step.kind !== 'OTHER';
const previewOf = (env: CopilotEnvironment, command: Command) => editorReducer({ workflow: env.workflow, error: null }, command, env.context);
/** The steps a command would create or change, read from its editor preview. */
function changedSteps(env: CopilotEnvironment, command: Command): WorkflowStep[] {
  const preview = previewOf(env, command);
  if (preview.error || preview.workflow === env.workflow) return [];
  const before = new Map(env.workflow.nodes.map(node => [node.nodeId, JSON.stringify(node)]));
  const changed = new Set(preview.workflow.nodes.filter(node => before.get(node.nodeId) !== JSON.stringify(node)).map(node => node.nodeId));
  return workflowSteps(preview.workflow, env.context).filter(step => changed.has(step.nodeId));
}
const pendingSteps = (env: CopilotEnvironment): WorkflowStep[] => env.pending && env.pending.command.type !== 'REMOVE' ? changedSteps(env, env.pending.command) : [];
/** Records a proposal the user can now see, whoever made it (the Copilot or the exact grammar). */
export function recordProposal(state: CopilotConversation, env: CopilotEnvironment, command: Command, sentence?: string): CopilotConversation {
  if (state.referents[0]?.command === command) return state;
  const step = changedSteps(env, command)[0];
  if (!step) return state;
  return { ...state, referents: [{ command, sentence: sentence ?? stepSummary(step, 'EN'), step }, ...state.referents].slice(0, COPILOT_V2_LIMITS.maxReferents) };
}
/** A referent still names a canonical step only if that step exists unchanged (it was applied and not edited since). */
function appliedStep(referent: CopilotReferent | undefined, steps: readonly WorkflowStep[]): WorkflowStep | null {
  if (!referent || referent.step.detail.type === 'LENDING_COMPOSITION') return null;
  const step = steps.find(item => item.nodeId === referent.step.nodeId);
  return step && JSON.stringify(step.detail) === JSON.stringify(referent.step.detail) ? step : null;
}
const stepLabel = (m: CopilotCopy, step: WorkflowStep, language: CopilotLanguage) => m.stepLabel(step.index, stepSummary(step, language));
const sourceLabel = (m: CopilotCopy, resolved: Resolved, language: CopilotLanguage) => resolved.source === 'PENDING' ? m.fromPending
  : resolved.source === 'REFERENT' ? m.fromEarlier(resolved.referent.sentence) : m.fromStep(resolved.step.index, stepSummary(resolved.step, language));

type Purpose = 'EDIT' | 'REMOVE' | 'REPEAT' | 'REUSE' | 'QUESTION' | 'ANCHOR';
type Resolution = { readonly ok: true; readonly resolved: Resolved } | { readonly ok: false; readonly result: Result };
const ORDINAL_INDEX: Readonly<Record<Exclude<CopilotOrdinal, 'LAST'>, number>> = { FIRST: 0, SECOND: 1, THIRD: 2, FOURTH: 3, FIFTH: 4 };
const pick = <T>(list: readonly T[], ordinal: CopilotOrdinal): T | undefined => ordinal === 'LAST' ? list.at(-1) : list[ORDINAL_INDEX[ordinal]];

/** "it", "the swap", "the second step" → exactly one step, or Flofi's question with concrete step buttons. Never a guess. */
function resolveTarget(target: CopilotTarget, purpose: Purpose, intent: CopilotIntentV2, state: CopilotConversation, env: CopilotEnvironment): Resolution {
  const language = intent.language, m = copilotCopy(language);
  const steps = workflowSteps(env.workflow, env.context);
  const proposed = purpose === 'EDIT' || purpose === 'QUESTION' ? pendingSteps(env) : [];
  const asPending = (step: WorkflowStep): Resolved => ({ source: 'PENDING', step, command: env.pending!.command });
  // A step with a visible pending edit is presented as that proposal: it is the newest state the user sees.
  const latest = (step: WorkflowStep): Resolved => { const p = proposed.find(item => item.nodeId === step.nodeId); return p ? asPending(p) : { source: 'NODE', step }; };
  const stop = (result: Result): Resolution => ({ ok: false, result });
  const found = (resolved: Resolved): Resolution => ({ ok: true, resolved });
  const ask = (candidates: readonly Resolved[], kind: string | null) => stop(question(state, m, kind ? m.whichKind(kind) : m.whichStep,
    candidates.map(item => optionLabel(m, item, language)), { intent, amountFill: false, snapshot: snapshotOf(env),
      options: candidates.map(item => ({ label: optionLabel(m, item, language), fill: { kind: 'TARGET', target: item } })) }));
  const repeat = purpose === 'REPEAT' || purpose === 'REUSE';
  if (target.step === null && target.ordinal === null) {
    if (purpose === 'REMOVE' && env.pending) return stop(refused(state, m, m.pendingOnly));
    if (proposed.length === 1) return found(asPending(proposed[0]!));
    if (proposed.length > 1) return ask(proposed.map(asPending), null);
    if (repeat && state.referents[0]) return found({ source: 'REFERENT', step: state.referents[0].step, referent: state.referents[0] });
    const applied = repeat ? null : appliedStep(state.referents[0], steps);
    if (applied) return found({ source: 'NODE', step: applied });
    const candidates = steps.filter(editable);
    if (candidates.length === 1) return found(latest(candidates[0]!));
    if (!candidates.length) return stop(refused(state, m, repeat ? m.nothingToRepeat : m.noReferent));
    return ask(candidates.map(latest), null);
  }
  if (target.step !== null) {
    const kind = m.kind[target.step]!;
    if (repeat && target.ordinal === null) {
      const referent = state.referents.find(item => item.step.kind === target.step);
      if (referent) return found({ source: 'REFERENT', step: referent.step, referent });
    }
    const existing = steps.filter(step => step.kind === target.step).map(latest);
    const added = proposed.filter(step => step.kind === target.step && !steps.some(item => item.nodeId === step.nodeId)).map(asPending);
    const candidates = [...existing, ...added];
    if (!candidates.length) return stop(refused(state, m, m.noKind(kind)));
    if (target.ordinal !== null) {
      const chosen = pick(candidates, target.ordinal);
      return chosen ? found(chosen) : stop(refused(state, m, m.noOrdinalKind(candidates.length, kind)));
    }
    return candidates.length === 1 ? found(candidates[0]!) : ask(candidates, kind);
  }
  const chosen = pick(steps, target.ordinal!);
  return chosen ? found(latest(chosen)) : stop(refused(state, m, m.noOrdinal(steps.length)));
}
const optionLabel = (m: CopilotCopy, resolved: Resolved, language: CopilotLanguage) =>
  resolved.source === 'PENDING' ? m.pendingOption(stepSummary(resolved.step, language)) : m.stepOption(resolved.step.index, stepSummary(resolved.step, language));

// ── Steps as V1 actions, changes and reuse ───────────────────────────────────────────────────────────────────────────
type Base = { readonly actions: readonly CopilotAction[]; readonly composition: boolean; readonly role: 'SUPPLY' | 'BORROW' | 'SWAP' | null };
type ChangeField = keyof CopilotChanges | 'deposit';
const SWAP_FIELDS: readonly CarriedField[] = ['network', 'inputAsset', 'outputAsset', 'amount', 'slippage'];
const BRIDGE_FIELDS: readonly CarriedField[] = ['sourceNetwork', 'destinationNetwork', 'asset', 'amount', 'slippage', 'routing', 'recipient'];
const LENDING_FIELDS: readonly CarriedField[] = ['network', 'asset', 'amount', 'beneficiary'];
const COMPOSITION_FIELDS: readonly CarriedField[] = ['network', 'asset', 'inputAsset', 'outputAsset', 'supplyAmount', 'borrowAmount', 'slippage', 'beneficiary'];
/** A step's typed IR fields as the V1 action that would author it again; null for steps the Copilot does not re-author. */
function stepAction(step: WorkflowStep): Base | null {
  const d = step.detail;
  const solana = (symbol: string) => (symbol === 'devUSDC' ? 'DEVUSDC' : symbol) as CopilotSwapAction['inputAsset'];
  switch (d.type) {
    case 'EVM_SWAP': return { composition: false, role: null, actions: [{ type: 'SWAP', network: d.network === 'Base' ? 'BASE' : 'BASE_SEPOLIA', inputAsset: d.from,
      outputAsset: d.to, amount: d.amount, slippageBps: d.slippage }] };
    case 'SOLANA_SWAP': return { composition: false, role: null, actions: [{ type: 'SWAP', network: d.input.network === 'Solana' ? 'SOLANA' : 'SOLANA_DEVNET',
      inputAsset: solana(d.input.from), outputAsset: solana(d.input.to), amount: d.input.amount, slippageBps: d.input.slippage }] };
    case 'ROUTER': return { composition: false, role: null, actions: [{ type: 'BRIDGE', sourceNetwork: d.input.source === 'Base' ? 'BASE' : 'BASE_SEPOLIA',
      destinationNetwork: d.input.destination === 'Arbitrum' ? 'ARBITRUM' : 'ARBITRUM_SEPOLIA', asset: 'USDC', amount: d.input.amount, slippageBps: d.input.slippage,
      routing: d.input.routing === 'AUTO' ? null : d.input.routing, recipient: d.input.recipient ? d.input.recipient.toLowerCase() : null }] };
    case 'AAVE': return { composition: false, role: null, actions: [{ type: d.operation, protocol: 'AAVE_V3', network: 'BASE_SEPOLIA', asset: 'USDC', amount: d.input.amount,
      beneficiary: d.input.beneficiary.toLowerCase() }] };
    case 'AAVE_WITHDRAW': return { composition: false, role: null, actions: [{ type: 'WITHDRAW', protocol: 'AAVE_V3', network: 'BASE_SEPOLIA', asset: 'USDC',
      amount: d.input.amount, beneficiary: null }] };
    case 'UNISWAP_LIQUIDITY': return { composition: false, role: null, actions: [{ type: 'LIQUIDITY', protocol: 'UNISWAP_V3', network: 'BASE_SEPOLIA',
      deposits: [{ asset: 'USDC', maxAmount: d.input.maxUsdc }, { asset: 'WETH', maxAmount: d.input.maxWeth }], rangeUnit: d.input.rangeUnit, lower: d.input.lower,
      upper: d.input.upper, slippageBps: d.input.slippage }] };
    case 'ORCA_LIQUIDITY': return { composition: false, role: null, actions: [{ type: 'LIQUIDITY', protocol: 'ORCA', network: 'SOLANA_DEVNET',
      deposits: [{ asset: 'SOL', maxAmount: d.input.maxSol }, { asset: 'DEVUSDC', maxAmount: d.input.maxDevUsdc }], rangeUnit: d.input.rangeUnit, lower: d.input.lower,
      upper: d.input.upper, slippageBps: d.input.slippage }] };
    case 'LENDING_COMPOSITION': {
      const owner = d.input.owner.toLowerCase();
      const lending = (type: 'SUPPLY' | 'BORROW', amount: string): CopilotLendingAction => ({ type, protocol: 'AAVE_V3', network: 'BASE_SEPOLIA', asset: 'USDC', amount, beneficiary: owner });
      return { composition: true, role: d.role, actions: [lending('SUPPLY', d.input.supply), lending('BORROW', d.input.borrow),
        { type: 'SWAP', network: 'BASE_SEPOLIA', inputAsset: 'USDC', outputAsset: 'WETH', amount: d.input.borrow, slippageBps: d.input.slippage }] };
    }
    default: return null;
  }
}
function allFields(base: Base): Set<CarriedField> {
  if (base.composition) return new Set(COMPOSITION_FIELDS);
  const action = base.actions[0]!;
  if (action.type === 'SWAP') return new Set(SWAP_FIELDS);
  if (action.type === 'BRIDGE') return new Set(BRIDGE_FIELDS);
  if (action.type === 'LIQUIDITY') return new Set<CarriedField>(['protocol', 'network', 'range', 'slippage', ...action.deposits.map(d => `deposit:${poolSymbol(action, d.asset)}` as CarriedField)]);
  return new Set(LENDING_FIELDS);
}
const poolSymbol = (action: Extract<CopilotAction, { type: 'LIQUIDITY' }>, asset: string) => COPILOT_POOLS[action.protocol === 'ORCA' ? 'ORCA' : 'UNISWAP_V3'].symbol(asset);
const CARRIED_LABEL: Readonly<Record<string, CarriedLabel>> = { network: 'network', sourceNetwork: 'network', destinationNetwork: 'destination', asset: 'token',
  inputAsset: 'token', outputAsset: 'token', amount: 'amount', supplyAmount: 'amount', borrowAmount: 'amount', slippage: 'slippage', recipient: 'recipient',
  beneficiary: 'beneficiary', routing: 'routing', range: 'range' };
const carriedLabels = (m: CopilotCopy, carried: ReadonlySet<CarriedField>) =>
  [...new Set([...carried].flatMap(field => field.startsWith('deposit:') ? ['maxima' as const] : CARRIED_LABEL[field] ? [CARRIED_LABEL[field]!] : []))].map(label => m.carriedLabel[label]);

type Applied = { readonly ok: true; readonly base: Base; readonly carried: Set<CarriedField>; readonly changed: readonly string[] } | { readonly ok: false; readonly field: ChangeField };
/** Only the changed fields leave the carried set; each of them must then be grounded in the open request by the planners. */
function applyChanges(base: Base, changes: CopilotChanges): Applied {
  const carried = allFields(base), changed: string[] = [];
  let actions = base.actions.map(action => ({ ...action })) as CopilotAction[];
  const set = (index: number, key: string, value: unknown) => { actions = actions.map((item, at) => at === index ? { ...item, [key]: value } as CopilotAction : item); };
  const drop = (...fields: CarriedField[]) => fields.forEach(field => carried.delete(field));
  const entries = (Object.keys(changes) as (keyof CopilotChanges)[]).filter(key => key === 'deposits' ? changes.deposits.length > 0 : key === 'lower' || key === 'upper' ? false
    : changes[key] !== null);
  for (const key of entries) {
    const action = actions[0]!, type = base.composition ? 'COMPOSITION' : action.type;
    const fail = (): Applied => ({ ok: false, field: key });
    switch (key) {
      case 'amount':
        if (type === 'LIQUIDITY') return fail();
        if (type === 'COMPOSITION') {
          if (base.role === 'SWAP') return { ok: false, field: 'deposit' };
          if (base.role === 'SUPPLY') { set(0, 'amount', changes.amount); drop('supplyAmount'); }
          else { set(1, 'amount', changes.amount); set(2, 'amount', changes.amount); drop('borrowAmount'); }
        } else { set(0, 'amount', changes.amount); drop('amount'); }
        break;
      case 'slippageBps':
        if (type === 'COMPOSITION') set(2, 'slippageBps', changes.slippageBps); else if (type === 'SWAP' || type === 'BRIDGE' || type === 'LIQUIDITY') set(0, 'slippageBps', changes.slippageBps);
        else return fail();
        drop('slippage'); break;
      case 'network':
        if (type === 'BRIDGE') { set(0, 'sourceNetwork', changes.network); drop('sourceNetwork'); }
        else if (type === 'COMPOSITION') return fail();
        else { set(0, 'network', changes.network); drop('network'); }
        break;
      case 'destinationNetwork': if (type !== 'BRIDGE') return fail(); set(0, 'destinationNetwork', changes.destinationNetwork); drop('destinationNetwork'); break;
      case 'inputAsset': case 'outputAsset':
        if (type === 'SWAP') { set(0, key, changes[key]); drop(key); }
        else if (type === 'BRIDGE' || type === 'SUPPLY' || type === 'BORROW' || type === 'REPAY' || type === 'WITHDRAW') { set(0, 'asset', changes[key]); drop('asset'); }
        else return fail();
        break;
      case 'recipient':
        if (type === 'BRIDGE') { set(0, 'recipient', changes.recipient); drop('recipient'); }
        else if (type === 'COMPOSITION') { set(0, 'beneficiary', changes.recipient); set(1, 'beneficiary', changes.recipient); drop('beneficiary'); }
        else if (type === 'SUPPLY' || type === 'BORROW' || type === 'REPAY' || type === 'WITHDRAW') { set(0, 'beneficiary', changes.recipient); drop('beneficiary'); }
        else return fail();
        break;
      case 'routing': if (type !== 'BRIDGE') return fail(); set(0, 'routing', changes.routing); drop('routing'); break;
      case 'rangeUnit':
        if (type !== 'LIQUIDITY') return fail();
        set(0, 'rangeUnit', changes.rangeUnit); set(0, 'lower', changes.lower); set(0, 'upper', changes.upper); drop('range'); break;
      case 'deposits': {
        if (type !== 'LIQUIDITY') return fail();
        const liquidity = actions[0] as Extract<CopilotAction, { type: 'LIQUIDITY' }>;
        let deposits = [...liquidity.deposits];
        for (const deposit of changes.deposits) {
          const symbol = poolSymbol(liquidity, deposit.asset);
          if (!symbol) return fail();
          deposits = deposits.map(item => poolSymbol(liquidity, item.asset) === symbol ? { asset: deposit.asset, maxAmount: deposit.maxAmount } : item);
          drop(`deposit:${symbol}`);
        }
        set(0, 'deposits', deposits); break;
      }
    }
    changed.push(key);
  }
  return { ok: true, base: { ...base, actions }, carried, changed };
}
/** Values the user asked to reuse ("the same network"), copied from the resolved step into fields the user left unstated. */
function applyReuse(action: CopilotAction, from: Base, fields: readonly CopilotReuseField[]): { readonly action: CopilotAction; readonly carried: Set<CarriedField> } {
  const source = from.composition ? null : from.actions[0]!, carried = new Set<CarriedField>();
  if (!source) return { action, carried };
  const sourceNetwork = (): CopilotNetwork | null => source.type === 'BRIDGE' ? null : source.network;
  const sourceAsset = () => source.type === 'SWAP' ? source.inputAsset : source.type === 'LIQUIDITY' ? null : source.asset;
  const sourceAmount = () => source.type === 'LIQUIDITY' ? null : source.amount;
  let out = { ...action } as Record<string, unknown>;
  const fill = (key: string, value: unknown, field: CarriedField) => { if (value !== null && value !== undefined && key in out && out[key] === null) { out = { ...out, [key]: value }; carried.add(field); } };
  for (const field of fields) {
    if (field === 'network' && action.type === 'BRIDGE') fill('sourceNetwork', source.type === 'BRIDGE' ? source.sourceNetwork : sourceNetwork(), 'sourceNetwork');
    else if (field === 'network') fill('network', sourceNetwork(), 'network');
    if (field === 'destination' && action.type === 'BRIDGE' && source.type === 'BRIDGE') fill('destinationNetwork', source.destinationNetwork, 'destinationNetwork');
    if (field === 'asset') {
      if (action.type === 'SWAP' && source.type === 'SWAP') { fill('inputAsset', source.inputAsset, 'inputAsset'); fill('outputAsset', source.outputAsset, 'outputAsset'); }
      else if (action.type === 'SWAP') fill('inputAsset', sourceAsset(), 'inputAsset');
      else fill('asset', sourceAsset(), 'asset');
    }
    if (field === 'amount') fill('amount', sourceAmount(), 'amount');
    if (field === 'slippage') fill('slippageBps', source.type === 'SWAP' || source.type === 'BRIDGE' || source.type === 'LIQUIDITY' ? source.slippageBps : null, 'slippage');
    if (field === 'recipient' && action.type === 'BRIDGE') fill('recipient', source.type === 'BRIDGE' ? source.recipient : null, 'recipient');
    else if (field === 'recipient') fill('beneficiary', source.type !== 'SWAP' && source.type !== 'BRIDGE' && source.type !== 'LIQUIDITY' ? source.beneficiary : null, 'beneficiary');
  }
  return { action: out as CopilotAction, carried };
}

// ── Deterministic answers to Flofi's own questions ───────────────────────────────────────────────────────────────────
const NETWORK_BY_LABEL = new Map<string, CopilotNetwork>(Object.entries(COPILOT_NETWORK_LABEL).map(([network, label]) => [normalize(label), network as CopilotNetwork]));
/** The deterministic meaning of each button Flofi offered for a new action; buttons without one go to the model like typed text. */
function actionFills(intent: CopilotIntentV2, missing: readonly string[], options: readonly string[]): Draft['options'] {
  if (intent.kind !== 'ACTION') return [];
  const action = intent.action, en = copilotCopy('EN'), pt = copilotCopy('PT');
  const out: { label: string; fill: DraftFill }[] = [];
  for (const label of options) {
    const patch = ((): Record<string, unknown> | null => {
      const parts = label.split('→').map(normalize), networks = parts.map(part => NETWORK_BY_LABEL.get(part) ?? null);
      if (action.type === 'BRIDGE') {
        const routing = [en.routingOptions, pt.routingOptions].map(list => list.map(normalize).indexOf(normalize(label))).find(index => index >= 0);
        if (routing !== undefined) return { routing: [null, 'LIFI', 'ACROSS'][routing] };
        if (networks.length === 2 && networks.every(Boolean)) return { sourceNetwork: networks[0], destinationNetwork: networks[1] };
        if (networks.length === 1 && networks[0]) return /^ARBITRUM/.test(networks[0]) ? missing.includes('destinationNetwork') ? { destinationNetwork: networks[0] } : null
          : missing.includes('sourceNetwork') ? { sourceNetwork: networks[0] } : null;
        return null;
      }
      if (action.type === 'LIQUIDITY') {
        const pool = [en.poolOptions, pt.poolOptions].map(list => list.map(normalize).indexOf(normalize(label))).find(index => index >= 0);
        if (pool !== undefined) return pool === 0 ? { protocol: 'UNISWAP_V3', network: 'BASE_SEPOLIA' } : { protocol: 'ORCA', network: 'SOLANA_DEVNET' };
      }
      if (networks.length === 1 && networks[0] && missing.includes('network')) return { network: networks[0] };
      if (normalize(label) === 'usdc' && missing.includes('asset') && action.type !== 'SWAP' && action.type !== 'LIQUIDITY') return { asset: 'USDC' };
      return null;
    })();
    if (patch) out.push({ label, fill: { kind: 'ACTION', patch } });
  }
  return out;
}
/** A reply that is only a number answers Flofi's amount question, when it has exactly one reading. */
function bareAmount(text: string): string | null {
  const match = /^\s*(\d+(?:[.,]\d+)*)\s*(?:usdc|weth|eth|sol|usdt|devusdc)?\s*[.!]?\s*$/i.exec(text);
  const readings = match ? amountReadings(match[1]!) : [];
  return readings.length === 1 && /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(readings[0]!) && readings[0]!.length <= COPILOT_LIMITS.maxValueLength ? readings[0]! : null;
}
function patchIntent(intent: CopilotIntentV2, patch: Readonly<Record<string, unknown>>): CopilotIntentV2 {
  if (intent.kind !== 'ACTION') return intent;
  const action = { ...intent.action } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) if (key in action) action[key] = value;
  return { ...intent, action: action as CopilotAction };
}

// ── Turns ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Starts a user turn: a local answer (input refused, secret, or a reply to Flofi's own question) or a request for the model. */
export function startTurn(state: CopilotConversation, raw: string, env: CopilotEnvironment): TurnStart {
  const text = typeof raw === 'string' ? raw.trim() : '', m = copilotCopy(state.language);
  if (!text || text.length > COPILOT_LIMITS.maxUserMessageLength || hasUnsafeCharacters(text))
    return { kind: 'LOCAL', reply: reply('FAILED', failureText('COPILOT_INPUT_INVALID', state.language)), next: state };
  // No model runs for a secret, so its language comes from the conversation or from the Portuguese wording that matched.
  if (looksSecret(text)) return { kind: 'LOCAL', reply: reply('UNSUPPORTED', /chaves?\s+privad|frases?\s+(?:semente|secreta|de\s+recupera)|palavras\s+secretas/i.test(text)
    ? copilotCopy('PT').secret : m.secret), next: state };
  const draft = state.draft;
  if (draft) {
    const option = draft.options.find(item => normalize(item.label) === normalize(text));
    const amount = !option && draft.amountFill ? bareAmount(text) : null;
    if (option || amount) {
      if (contextChange(draft.snapshot, snapshotOf(env))) return { kind: 'LOCAL', ...failed(closeSegment(state), m, m.draftStale) };
      const next = withUser(state, text);
      if (option?.fill.kind === 'TARGET') return { kind: 'LOCAL', ...resolveIntent(draft.intent, next, env, option.fill.target) };
      const intent = option?.fill.kind === 'ACTION' ? patchIntent(draft.intent, option.fill.patch) : patchIntent(draft.intent, { amount });
      return { kind: 'LOCAL', ...resolveIntent(intent, next, env, null) };
    }
  }
  const next = withUser(state, text);
  return { kind: 'REMOTE', request: { version: '2', messages: next.transcript }, turn: { before: state, state: next, snapshot: snapshotOf(env) } };
}
/** Finishes a model turn against the current state. A changed workflow, proposal or wallet discards the answer. */
export function finishTurn(turn: PendingTurn, result: CopilotResultV2, env: CopilotEnvironment): Result {
  const language = turn.state.language, m = copilotCopy(language), rollback = closeSegment(turn.before);
  const change = contextChange(turn.snapshot, snapshotOf(env));
  if (change) return { reply: reply('FAILED', change === 'WORKFLOW' ? m.workflowChanged : change === 'PROPOSAL' ? m.proposalChanged : m.walletChanged), next: rollback };
  if (!result.ok) return { reply: reply('FAILED', failureText(result.code, language, result.retryAfterSeconds)), next: rollback };
  let intent: CopilotIntentV2;
  try { intent = parseCopilotIntentV2(result.intent); }
  catch (cause) { return { reply: reply('FAILED', failureText(isCopilotIntentError(cause) && cause.message === 'COPILOT_TOO_MANY_ACTIONS' ? cause.message : 'COPILOT_INTENT_INVALID', language)), next: rollback }; }
  return resolveIntent(intent, { ...turn.state, language: intent.language }, env, null);
}

/** One validated intent → reply and next state. `forced` is a step the user picked from Flofi's own buttons. */
function resolveIntent(intent: CopilotIntentV2, state: CopilotConversation, env: CopilotEnvironment, forced: Resolved | null): Result {
  const language = intent.language, m = copilotCopy(language);
  const target = (value: CopilotTarget, purpose: Purpose): Resolution => forced ? { ok: true, resolved: forced } : resolveTarget(value, purpose, intent, state, env);
  switch (intent.kind) {
    case 'UNSUPPORTED': {
      const message = safeCopilotProse(intent.reason) ?? m.cannotAuthor;
      return refused(state, m, message.includes(m.capabilities) ? message : `${message} ${m.capabilities}`);
    }
    case 'CLARIFICATION_REQUIRED': {
      const text = safeCopilotProse(intent.question) ?? m.stillNeeds(m.subject.request, intent.missing.filter(field => field !== 'target').map(field => m.field[field as keyof typeof m.field]));
      return question(state, m, text, intent.options.flatMap(option => safeCopilotProse(option) ?? []), null);
    }
    case 'QUESTION': {
      let step: WorkflowStep | null = null;
      if (intent.target !== null || intent.topic === 'STEP_DETAIL') {
        const resolution = target(intent.target ?? { step: null, ordinal: null }, 'QUESTION');
        if (!resolution.ok) return resolution.result;
        step = resolution.resolved.step;
      }
      const answer = answerQuestion(intent.topic, step, env.facts, language);
      return terminal(state, reply('ANSWER', answer.text, { notes: answer.notes, topic: intent.topic }), m.answered(intent.topic));
    }
    case 'ACTION': case 'COMPOSITION': {
      let actions = intent.kind === 'ACTION' ? [intent.action] : intent.actions;
      let carried = new Set<CarriedField>(), notes: string[] = [];
      if (intent.kind === 'ACTION' && intent.reuse && REUSE_CUE.test(segmentText(state))) {
        const resolution = target(intent.reuse.from, 'REUSE');
        if (!resolution.ok) return resolution.result;
        const from = stepAction(resolution.resolved.step);
        if (from) {
          const reused = applyReuse(intent.action, from, intent.reuse.fields);
          actions = [reused.action]; carried = reused.carried;
          if (carried.size) notes = [m.carried(sourceLabel(m, resolution.resolved, language), carriedLabels(m, carried))];
        }
      }
      return author(intent, actions, intent.kind === 'COMPOSITION', carried, state, env, notes, sentence => m.interpreted(sentence), m.subject.composition);
    }
    case 'EDIT': case 'REPEAT': {
      if (intent.kind === 'REPEAT' && !REPEAT_CUE.test(segmentText(state))) return refused(state, m, m.repeatNeedsCue);
      const resolution = target(intent.target, intent.kind === 'EDIT' ? 'EDIT' : 'REPEAT');
      if (!resolution.ok) return resolution.result;
      const resolved = resolution.resolved, label = resolved.source === 'PENDING' ? m.sourcePending : stepLabel(m, resolved.step, language);
      const base = stepAction(resolved.step);
      if (!base) return refused(state, m, m.refusal.STEP_NOT_EDITABLE(label));
      const applied = applyChanges(base, intent.changes);
      if (!applied.ok) return refused(state, m, applied.field === 'deposit' ? m.compositionSwapAmount
        : m.changeNotApplicable(m.carriedLabel[CARRIED_LABEL[applied.field] ?? (applied.field === 'deposits' ? 'maxima' : 'range')], label));
      const notes = applied.carried.size ? [m.carried(sourceLabel(m, resolved, language), carriedLabels(m, applied.carried))] : [];
      if (intent.kind === 'REPEAT') return author(intent, applied.base.actions, applied.base.composition, applied.carried, state, env, notes, sentence => m.interpreted(sentence), label);
      const revising = resolved.source === 'PENDING' && (resolved.command.type.startsWith('ADD_') || resolved.command.type === 'AUTHOR_LENDING');
      return author(intent, applied.base.actions, applied.base.composition, applied.carried, state, env, notes,
        sentence => revising ? m.interpretedRevision(sentence) : m.interpretedEdit(label, sentence), label, revising ? null : resolved.step.nodeId);
    }
    case 'REMOVE': {
      const resolution = target(intent.target, 'REMOVE');
      if (!resolution.ok) return resolution.result;
      const resolved = resolution.resolved, label = stepLabel(m, resolved.step, language);
      if (resolved.source === 'PENDING') return refused(state, m, m.pendingOnly);
      const plan = removeCommandFor(env.workflow, env.context, resolved.step.nodeId, env.workflow.revision);
      if (!plan.ok) return refused(state, m, m.refusal[plan.code as keyof typeof m.refusal]?.(label) ?? m.rejectedCode(plan.code));
      return propose(state, env, plan.command, `remove ${stepLabel(copilotCopy('EN'), resolved.step, 'EN')}`, m.interpretedRemove(label), [], label);
    }
    case 'INSERT': {
      const resolution = target(intent.anchor, 'ANCHOR');
      if (!resolution.ok) return resolution.result;
      return refused(state, m, m.insertUnsupported);
    }
  }
}

/** Planners → exact grammar → (for an existing step) the typed edit command → editor preview → proposal. */
function author(intent: CopilotIntentV2, actions: readonly CopilotAction[], composition: boolean, carried: ReadonlySet<CarriedField>, state: CopilotConversation,
  env: CopilotEnvironment, notes: readonly string[], describe: (sentence: string) => string, label: string, editNodeId: string | null = null): Result {
  const language = intent.language, m = copilotCopy(language);
  const grounding: Grounding = { text: segmentText(state), carried, policy: { language, networkDefaults: false }, latest: state.segment.at(-1) ?? '' };
  const planned = planCopilotActions(actions, composition, grounding, env.wallet);
  if (planned.kind !== 'PLAN') return stopped(planned, intent, state, env, m);
  const outcome = proposalFromPlan(planned.plan, env, language);
  if (outcome.kind !== 'PROPOSAL') return stopped(outcome, intent, state, env, m);
  let command = outcome.command;
  if (editNodeId) {
    const edit = editCommandFor(env.workflow, env.context, editNodeId, command);
    if (!edit.ok) { const label = workflowSteps(env.workflow, env.context).find(step => step.nodeId === editNodeId);
      return refused(state, m, m.refusal[edit.code as keyof typeof m.refusal]?.(label ? stepLabel(m, label, language) : editNodeId) ?? m.rejectedCode(edit.code)); }
    command = edit.command;
  }
  return propose(state, env, command, outcome.sentence, describe(outcome.sentence), [...notes, ...outcome.notes], label);
}
function stopped(outcome: Exclude<CopilotOutcome, { kind: 'PROPOSAL' }>, intent: CopilotIntentV2, state: CopilotConversation, env: CopilotEnvironment, m: CopilotCopy): Result {
  if (outcome.kind === 'UNSUPPORTED') return refused(state, m, outcome.message.includes(m.capabilities) ? outcome.message : `${outcome.message} ${m.capabilities}`);
  if (outcome.kind === 'REJECTED') return failed(state, m, outcome.message);
  const draft: Draft = { intent, options: actionFills(intent, outcome.missing, outcome.options), snapshot: snapshotOf(env),
    amountFill: intent.kind === 'ACTION' && outcome.missing.includes('amount') && intent.action.type !== 'LIQUIDITY' };
  return question(state, m, outcome.question, outcome.options, draft.options.length || draft.amountFill ? draft : null);
}
/** Defense in depth, then the editor preview: an unappliable or empty edit is explained instead of shown as a proposal. */
function propose(state: CopilotConversation, env: CopilotEnvironment, command: Command, sentence: string, text: string, notes: readonly string[], label: string): Result {
  const m = copilotCopy(state.language);
  if (!COPILOT_V2_COMMANDS.has(command.type) || command.source !== 'CHAT' || command.baseRevision !== env.workflow.revision || !commandIsValid(command))
    return failed(state, m, copilotRejection('COPILOT_COMMAND_MISMATCH', state.language).message);
  const preview = previewOf(env, command);
  if (preview.error) return failed(state, m, copilotRejection(preview.error.split(':')[0]!.trim(), state.language).message);
  const unchanged = preview.workflow === env.workflow || (command.type === 'AUTHOR_LENDING' && lendingDetails(env.workflow) !== null &&
    JSON.stringify(lendingDetails(preview.workflow)) === JSON.stringify(lendingDetails(env.workflow)));
  if (unchanged) return refused(state, m, m.refusal.NO_CHANGE(label));
  return terminal(recordProposal(state, env, command, sentence), reply('PROPOSAL', text, { notes: [...new Set(notes)], command, sentence }),
    COPILOT_TRANSCRIPT.proposed + sentence);
}
