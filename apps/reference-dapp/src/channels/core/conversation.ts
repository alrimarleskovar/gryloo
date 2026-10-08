// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: one conversational turn of a channel — the same semantics as FloFi's own chat, server-side.
 *
 *   1. opt-out, secrets and unsupported content are handled before anything else (a secret never reaches this code as text);
 *   2. local commands (HELP, STATUS, NEW/CANCEL, LINK, STOP/START), EN and PT, with no model;
 *   3. "yes", "confirm", "execute"… that answer no open FloFi question get the zero-authority notice and change nothing;
 *   4. the exact grammar first (`parseLocalCommand`, no default beneficiary);
 *   5. otherwise the Copilot conversation engine (`copilot-conversation.ts`) with the model as an untrusted interpreter — the same
 *      grounding, clarifications, corrections and FloFi-written answers as the DApp. With the interpreter disabled, nothing reaches a
 *      model and only exact commands are understood.
 *
 * The channel never has a canvas: its environment is the editor's initial workflow plus, as the visible pending proposal, the
 * channel's current authoring command. A correction of that proposal is therefore a revision producing a fresh authoring command,
 * exactly as in the DApp. A decision only DESCRIBES what to do (propose, cancel, status…); the service performs it through the shared
 * platform. Nothing here can approve, sign or execute, and no message is ever treated as authorization.
 */
import { parseLocalCommand, type Command } from '../../domain/commands';
import { buildCopilotFacts } from '../../domain/copilot-answers';
import { COPILOT_AUTHORING_COMMANDS } from '../../domain/copilot-authoring';
import { closeSegment, emptyConversation, failureText, finishTurn, recordProposal, startTurn, type CopilotConversation, type CopilotEnvironment,
  type CopilotRequestV2, type CopilotResultV2 } from '../../domain/copilot-conversation';
import { editorReducer, initialEditor } from '../../domain/editor';
import type { Workflow } from '../../domain/initial-workflow';
import { describeProposal } from '../../domain/proposal';
import { dappReviewContext } from '../../engine/strategy-engine';
import type { ChannelLanguage } from './config.ts';
import { channelCopy } from './copy.ts';
import type { ChannelReply, InboundContent, ReplyChoice } from './types.ts';

/** The untrusted interpreter: one bounded Copilot V2 request in, a structured result (or a closed failure code) out. */
export type ChannelInterpreter = (request: CopilotRequestV2) => Promise<CopilotResultV2>;
/** Bounded, encrypted at rest, erased after 30 minutes of inactivity. */
export type ChannelState = {
  readonly v: 1; readonly language: ChannelLanguage;
  /** The Copilot conversation (bounded transcript, open request, FloFi's open question, referents), snapshots encoded by marker. */
  readonly copilot: unknown;
  /** The channel's pending proposal: an authoring command of the editor's initial state. */
  readonly pending: Command | null;
  /** The live approval handoff of the pending proposal, and the most recent one (for STATUS). Ids only. */
  readonly approvalId: string | null; readonly lastApprovalId: string | null;
  /** The choices FloFi offered last (answerable by number or by tapping). */
  readonly choices: readonly ReplyChoice[];
  readonly greeted: boolean;
};
export const freshState = (language: ChannelLanguage): ChannelState =>
  ({ v: 1, language, copilot: null, pending: null, approvalId: null, lastApprovalId: null, choices: [], greeted: false });
export const MAX_STATE_BYTES = 32_768;

export type TurnContent = InboundContent | { readonly kind: 'SECRET'; readonly language: ChannelLanguage };
export type TurnAction = 'REPLY' | 'PROPOSE' | 'CANCEL' | 'LINK' | 'STATUS' | 'OPT_OUT' | 'OPT_IN' | 'IGNORE' | 'SUBSCRIBE';
export type TurnDecision = { readonly action: TurnAction; readonly command: Command | null; readonly aiInterpreted: boolean; readonly replies: readonly ChannelReply[];
  readonly notes: readonly string[]; readonly outcome: string; readonly state: ChannelState;
  /** BUILD-AUTOMATION-001: the one-time code of a SUBSCRIBE turn (`automations ABCD-EFGH-JKLM`), handed to the subscription hook. */
  readonly subscribeCode?: string };
export type TurnInput = { readonly content: TurnContent; readonly state: ChannelState; readonly optedOut: boolean; readonly interpret: ChannelInterpreter | null;
  readonly support: string; readonly privacy: string };

const BASE: Workflow = initialEditor().workflow;
const CONTEXT = dappReviewContext();
const AUTHORING: ReadonlySet<string> = new Set(COPILOT_AUTHORING_COMMANDS);
const text = (value: string): ChannelReply => ({ text: value, choices: [], link: null });

const words = (value: string) => value.trim().toLowerCase().replace(/[.!?¡¿]+$/g, '').replace(/\s+/g, ' ');
const COMMANDS: readonly (readonly [Exclude<TurnAction, 'REPLY' | 'PROPOSE' | 'IGNORE'> | 'HELP', RegExp, ChannelLanguage | null])[] = [
  ['HELP', /^(?:help|menu|\?)$/, 'EN'], ['HELP', /^(?:ajuda)$/, 'PT'],
  ['STATUS', /^(?:status)$/, null], ['STATUS', /^(?:estado|situa[cç][aã]o)$/, 'PT'],
  ['CANCEL', /^(?:new|cancel|reset|start over)$/, 'EN'], ['CANCEL', /^(?:novo|nova|cancelar|recome[cç]ar)$/, 'PT'],
  ['LINK', /^(?:link|new link)$/, null], ['LINK', /^(?:novo link)$/, 'PT'],
  ['OPT_OUT', /^(?:stop|unsubscribe)$/, 'EN'], ['OPT_OUT', /^(?:parar|pare|sair|descadastrar)$/, 'PT'],
  ['OPT_IN', /^(?:start)$/, 'EN'], ['OPT_IN', /^(?:voltar|iniciar)$/, 'PT'],
  // BUILD-AUTOMATION-001: link this chat to an owner's automation notifications with the one-time code shown in FloFi. Never authority.
  ['SUBSCRIBE', /^(?:automations?|notifications?) ([a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})$/, 'EN'],
  ['SUBSCRIBE', /^(?:automa[cç](?:[oõ]es|[aã]o)|notifica[cç](?:[oõ]es|[aã]o)) ([a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})$/, 'PT'],
];
/** Messages that sound like an authorization. In a channel they never are one. */
// A confirmation — alone or chained ("yes, execute it", "sim, pode executar agora") — is answered with the zero-authority notice.
const CONFIRMATION = '(?:yes|yeah|yep|ok|okay|confirm|confirmed|i confirm|execute|execute it|run it|go|go ahead|approve|approved|sign|sign it|do it|send it|sim|s|'
  + 'confirmo|confirmar|confirma|executar|executa|aprovar|aprovo|aprova|assinar|assina|manda|pode mandar|vai|pode executar)';
const AUTHORIZATION = new RegExp(`^${CONFIRMATION}(?:[ ,;.!]+(?:${CONFIRMATION}|please|now|it|this|por favor|agora|isso|já|ja))*$`);
const PORTUGUESE = /\b(?:coloca|quero|faz|fazer|empresta|emprestar|troca|trocar|muda|mudar|na|no|para|com|de|da|do|em|sim|não|nao)\b/i;

// ── The Copilot conversation, persisted ────────────────────────────────────────────────────────────────────────────────
// The engine compares context snapshots by identity. Persisted drafts reference the channel's two context objects by marker and are
// rehydrated to the live objects; anything that no longer matches becomes a fresh object, which the engine treats as stale.
const BASE_MARK = '$flofi:base', PENDING_MARK = '$flofi:pending', STALE_MARK = '$flofi:stale';
function encodeCopilot(conversation: CopilotConversation, env: CopilotEnvironment): unknown {
  return JSON.parse(JSON.stringify(conversation, (key, value: unknown) => {
    if (key !== 'snapshot' || !value || typeof value !== 'object') return value;
    const s = value as { workflow: unknown; pending: unknown };
    return { ...s, workflow: s.workflow === env.workflow ? BASE_MARK : STALE_MARK, pending: s.pending === null ? null : s.pending === env.pending ? PENDING_MARK : STALE_MARK };
  }));
}
function decodeCopilot(raw: unknown, env: CopilotEnvironment): CopilotConversation {
  const c = raw as Partial<CopilotConversation> | null;
  if (!c || !Array.isArray(c.transcript) || !Array.isArray(c.segment) || !Array.isArray(c.referents) || typeof c.clarifications !== 'number') return emptyConversation();
  const conversation = structuredClone(c) as unknown as CopilotConversation;
  const snapshot = (conversation as unknown as { draft: { snapshot?: Record<string, unknown> } | null }).draft?.snapshot;
  if (snapshot) {
    snapshot.workflow = snapshot.workflow === BASE_MARK ? env.workflow : { stale: true };
    snapshot.pending = snapshot.pending === null ? null : snapshot.pending === PENDING_MARK && env.pending ? env.pending : { stale: true };
  }
  return conversation;
}
function environment(pending: Command | null): CopilotEnvironment {
  const before = { workflow: BASE, error: null };
  const visible = pending ? { command: pending, diff: describeProposal(before, editorReducer(before, pending, CONTEXT), pending, CONTEXT) } : null;
  return { workflow: BASE, context: CONTEXT, wallet: null, walletChainId: null, pending: visible, facts: buildCopilotFacts({ workflow: BASE, context: CONTEXT, pending: visible }) };
}
/** The state with the conversation encoded and bounded: past the size bound the transcript restarts, never the pending proposal. */
function withCopilot(state: ChannelState, conversation: CopilotConversation, env: CopilotEnvironment, patch: Partial<ChannelState> = {}): ChannelState {
  const next: ChannelState = { ...state, ...patch, copilot: encodeCopilot(conversation, env), language: conversation.language };
  return Buffer.byteLength(JSON.stringify(next), 'utf8') <= MAX_STATE_BYTES ? next : { ...next, copilot: null, choices: [] };
}
const choicesOf = (options: readonly string[]): ReplyChoice[] => options.slice(0, 4).map((label, i) => ({ id: `c${i + 1}`, label }));

/** One turn. `interpret` is called at most once, only when the engine asks for the model, and never for a local or exact command. */
export async function decideTurn(input: TurnInput): Promise<TurnDecision> {
  const { content, optedOut } = input;
  let state = input.state;
  const decision = (action: TurnAction, outcome: string, replies: readonly ChannelReply[], next: ChannelState = state, extra: Partial<TurnDecision> = {}): TurnDecision =>
    ({ action, command: null, aiInterpreted: false, notes: [], replies, outcome, state: next, ...extra });
  if (content.kind === 'SECRET') return decision('REPLY', 'SECRET_REFUSED', [text(channelCopy(content.language).secret)], { ...state, choices: [] });
  // The user stopped the conversation on the provider's side (e.g. blocked the bot): honoured as STOP, and nothing is sent back.
  if (content.kind === 'PROVIDER_OPT_OUT') return optedOut ? decision('IGNORE', 'IGNORED_OPTED_OUT', []) : decision('OPT_OUT', 'OPTED_OUT_BY_PROVIDER', [], freshState(state.language));
  if (content.kind === 'UNSUPPORTED') return optedOut ? decision('IGNORE', 'IGNORED_OPTED_OUT', []) : decision('REPLY', 'UNSUPPORTED_MESSAGE', [text(channelCopy(state.language).unsupported)]);
  // A tapped choice or a bare number answers FloFi's own last question with the label FloFi offered.
  let raw = content.kind === 'CHOICE' ? state.choices.find(c => c.id === content.id)?.label ?? content.label : content.text;
  const numbered = /^\s*([1-9])\s*$/.exec(raw);
  if (numbered && state.choices[Number(numbered[1]) - 1]) raw = state.choices[Number(numbered[1]) - 1]!.label;
  const normalized = words(raw), local = COMMANDS.find(([, pattern]) => pattern.test(normalized));
  if (local?.[2]) state = { ...state, language: local[2] };
  const m = channelCopy(state.language), greet = (replies: ChannelReply[]) => state.greeted ? replies : [text(m.firstContact(input.support, input.privacy)), ...replies];
  if (optedOut) return local?.[0] === 'OPT_IN' ? decision('OPT_IN', 'OPTED_IN', [text(m.optedIn), text(m.help(input.support, input.privacy))], { ...freshState(state.language), greeted: true })
    : decision('IGNORE', 'IGNORED_OPTED_OUT', []);
  const greeted = { ...state, greeted: true, choices: [] };
  if (local) {
    const [kind] = local;
    // HELP and START answer with the help text, preceded by the first-contact notice when this is the conversation's first exchange
    // (Telegram's /start is how every Telegram conversation begins).
    if (kind === 'HELP' || kind === 'OPT_IN') return decision('REPLY', 'HELP', greet([text(m.help(input.support, input.privacy))]), greeted);
    if (kind === 'OPT_OUT') return decision('OPT_OUT', 'OPTED_OUT', [text(m.optedOut)], freshState(state.language));
    // NEW/CANCEL also forgets the open question; the service revokes the live approval link.
    if (kind === 'CANCEL') return decision('CANCEL', 'CANCELLED', greet([]), { ...greeted, pending: null, approvalId: null, copilot: null });
    if (kind === 'SUBSCRIBE') return decision('SUBSCRIBE', 'SUBSCRIBE', greet([]), greeted, { subscribeCode: local[1].exec(normalized)![1]!.toUpperCase() });
    return decision(kind, kind === 'STATUS' ? 'STATUS' : 'LINK', greet([]), greeted);
  }
  const pending = state.pending, env = environment(pending), conversation = decodeCopilot(state.copilot, env);
  const openQuestion = conversation.draft !== null || state.choices.length > 0;
  if (!openQuestion && AUTHORIZATION.test(normalized)) return decision('REPLY', 'AUTHORIZATION_REFUSED', greet([text(m.authority)]), greeted);
  // The exact grammar first: exactly what a user could type in FloFi's chat, with no default beneficiary.
  try {
    const command = parseLocalCommand(raw, BASE, CONTEXT, null);
    if (AUTHORING.has(command.type)) {
      const next = withCopilot(greeted, recordProposal(closeSegment(conversation), environment(command), command), environment(command), { pending: command });
      return decision('PROPOSE', 'PROPOSED_EXACT', greet([]), next, { command });
    }
  } catch { /* not an exact authoring command: the interpreter decides */ }
  if (!input.interpret) return decision('REPLY', 'NOT_UNDERSTOOD', greet([text(m.grammarOnly)]), greeted);
  const languageHint = PORTUGUESE.test(raw) ? 'PT' : state.language;
  const start = startTurn(conversation.language === languageHint ? conversation : { ...conversation, language: languageHint }, raw, env);
  let reply, next: CopilotConversation;
  if (start.kind === 'LOCAL') ({ reply, next } = start);
  else {
    let result: CopilotResultV2;
    try { result = await input.interpret(start.request); } catch { result = { ok: false, code: 'COPILOT_UNAVAILABLE' }; }
    ({ reply, next } = finishTurn(start.turn, result, env));
  }
  const lm = channelCopy(next.language);
  if (reply.command && AUTHORING.has(reply.command.type)) {
    const proposed = withCopilot({ ...greeted, language: next.language }, next, environment(reply.command), { pending: reply.command });
    return decision('PROPOSE', 'PROPOSED_INTERPRETED', [], proposed, { command: reply.command, aiInterpreted: true, notes: reply.notes });
  }
  const choices = reply.kind === 'CLARIFICATION' ? choicesOf(reply.options) : [];
  const body = [reply.text, ...reply.notes].filter(Boolean).join('\n') || failureText('COPILOT_UNAVAILABLE', next.language);
  const after = withCopilot({ ...greeted, language: next.language, choices }, next, env);
  const replies = [{ text: body, choices, link: null }];
  return decision('REPLY', `COPILOT_${reply.kind}`, state.greeted ? replies : [text(lm.firstContact(input.support, input.privacy)), ...replies], after);
}

/** The persisted state, or a fresh one when it is absent or unreadable (never a guess). */
export function parseState(json: string | null, language: ChannelLanguage): ChannelState {
  if (!json) return freshState(language);
  try {
    const s = JSON.parse(json) as Partial<ChannelState>;
    if (s.v !== 1 || (s.language !== 'EN' && s.language !== 'PT') || !Array.isArray(s.choices)) return freshState(language);
    return { ...freshState(s.language), ...s } as ChannelState;
  } catch { return freshState(language); }
}
