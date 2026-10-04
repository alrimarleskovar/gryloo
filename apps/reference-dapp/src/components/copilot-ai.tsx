// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { copilotInterpret, copilotStatus } from '../app/copilot-action';
import type { Command } from '../domain/commands';
import { COPILOT_CAPABILITIES, copilotIntentToCommand } from '../domain/copilot-authoring';
import { COPILOT_LIMITS, type CopilotThreadMessage } from '../domain/copilot-intent';
import type { CopilotMode } from '../server/copilot-service';
import { useBuild009Wallet } from '../state/build009-wallet-store';
import { useWorkflow } from '../state/workflow-store';

/**
 * BUILD-COPILOT-001: AI interpretation for the Copilot panel, kept apart from the panel itself. Text the exact grammar
 * does not recognize goes to the server-side interpreter; its untrusted intent becomes a proposal only through
 * `copilotIntentToCommand` (exact grammar) and the existing `propose`. Applying stays an explicit user action, and
 * any workflow change while the interpreter runs discards its answer.
 */
export type CopilotReply = { readonly kind: 'PROPOSAL' | 'CLARIFICATION' | 'UNSUPPORTED' | 'FAILED'; readonly text: string;
  readonly notes: readonly string[]; readonly options: readonly string[] };
const FAILURES: Readonly<Record<string, string>> = {
  COPILOT_OFF: 'Flofi Copilot is off on this server. Exact commands still work.',
  COPILOT_NOT_CONFIGURED: 'Flofi Copilot is not configured on this server. Exact commands still work.',
  COPILOT_INPUT_INVALID: 'Flofi Copilot accepts plain messages of up to 1,024 characters.',
  COPILOT_BUSY: 'Flofi Copilot is handling too many requests. Wait a moment and try again.',
  COPILOT_TIMEOUT: 'Flofi Copilot did not answer in time.',
  COPILOT_UPSTREAM_RATE_LIMITED: 'The AI service is rate limiting requests. Try again shortly.',
  COPILOT_REFUSED: 'The AI declined to interpret this request.',
  COPILOT_INTENT_INVALID: 'The AI returned an answer that Flofi could not validate, so it was discarded.',
  COPILOT_TOO_MANY_ACTIONS: 'The AI returned more steps than one proposal may contain, so it was discarded.',
  COPILOT_RESPONSE_INVALID: 'The AI returned an answer that Flofi could not read, so it was discarded.',
  COPILOT_RESPONSE_INCOMPLETE: 'The AI returned an incomplete answer, so it was discarded.',
  COPILOT_RESPONSE_TOO_LARGE: 'The AI returned an answer larger than Flofi accepts, so it was discarded.',
  COPILOT_UPSTREAM_UNAVAILABLE: 'The AI service is unavailable right now.',
  COPILOT_UPSTREAM_REJECTED: 'The AI service rejected the request.',
  COPILOT_UPSTREAM_UNAUTHORIZED: 'The AI service rejected this server\'s credentials.',
  COPILOT_REPLAY_MISS: 'No recorded Copilot answer matches this message (replay mode, no model is called).',
};
const failure = (code: string): CopilotReply => ({ kind: 'FAILED', notes: [], options: [],
  text: `${FAILURES[code] ?? 'Flofi Copilot could not interpret this request.'} Nothing changed. You can also type an exact command.` });

export function useCopilotInterpreter() {
  const workflow = useWorkflow();
  const wallet = useBuild009Wallet();
  // `loading` renders exactly like `off`; text sent before the status arrives waits for it rather than guessing.
  const [mode, setMode] = useState<CopilotMode | 'loading'>('loading');
  const status = useRef<Promise<CopilotMode> | null>(null);
  const [busy, setBusy] = useState(false);
  const thread = useRef<CopilotThreadMessage[]>([]);
  const proposal = useRef<{ readonly command: Command; readonly sentence: string } | null>(null);
  const latest = useRef({ workflow, account: wallet.account });
  latest.current = { workflow, account: wallet.account };
  useEffect(() => {
    let stopped = false;
    const pending = copilotStatus().then(result => result.mode, () => 'off' as const);
    status.current = pending;
    void pending.then(next => { if (!stopped) setMode(next); });
    return () => { stopped = true; };
  }, []);
  const reset = useCallback(() => { thread.current = []; }, []);
  const interpret = useCallback(async (text: string): Promise<CopilotReply> => {
    const start = latest.current.workflow;
    const messages = [...thread.current, { role: 'user' as const, text }].slice(-COPILOT_LIMITS.maxMessages);
    while (messages[0]?.role === 'assistant') messages.shift();
    thread.current = [];
    setBusy(true);
    try {
      const result = await copilotInterpret({ messages });
      const now = latest.current;
      // The answer is discarded if the workflow changed or another proposal appeared while the interpreter ran.
      if (now.workflow.state.workflow !== start.state.workflow || now.workflow.pending) return { kind: 'FAILED', notes: [], options: [],
        text: 'The workflow changed while Flofi Copilot was interpreting, so nothing was proposed. Send your message again.' };
      if (!result.ok) return failure(result.code);
      const outcome = copilotIntentToCommand(result.intent, { userText: messages.filter(m => m.role === 'user').map(m => m.text).join('\n'),
        workflow: now.workflow.state.workflow, context: now.workflow.context, wallet: now.account });
      if (outcome.kind === 'PROPOSAL') {
        proposal.current = { command: outcome.command, sentence: outcome.sentence };
        now.workflow.propose(outcome.command);
        return { kind: 'PROPOSAL', notes: outcome.notes, options: [],
          text: `Interpreted as “${outcome.sentence}”. Review the proposal below: nothing changes until you apply it.` };
      }
      if (outcome.kind === 'CLARIFICATION') {
        thread.current = [...messages, { role: 'assistant' as const, text: outcome.question.slice(0, COPILOT_LIMITS.maxAssistantMessageLength) }];
        return { kind: 'CLARIFICATION', text: outcome.question, notes: [], options: outcome.options };
      }
      if (outcome.kind === 'UNSUPPORTED') return { kind: 'UNSUPPORTED', notes: [], options: [],
        text: outcome.message.includes(COPILOT_CAPABILITIES) ? outcome.message : `${outcome.message} ${COPILOT_CAPABILITIES}` };
      return { kind: 'FAILED', notes: [], options: [], text: outcome.message.endsWith('Nothing changed.') ? outcome.message : `${outcome.message} Nothing changed.` };
    } catch {
      return failure('COPILOT_UNAVAILABLE');
    } finally { setBusy(false); }
  }, []);
  /** The Copilot's reply, or null when it is not enabled on this server (the caller shows its exact-grammar guidance). */
  const respond = useCallback(async (text: string): Promise<CopilotReply | null> => {
    const resolved = await (status.current ?? Promise.resolve<CopilotMode>('off'));
    return resolved === 'live' || resolved === 'replay' ? interpret(text) : null;
  }, [interpret]);
  const proposalSentence = useCallback((command: Command | undefined) =>
    command && proposal.current?.command === command ? proposal.current.sentence : null, []);
  return { mode, enabled: mode === 'live' || mode === 'replay', mayInterpret: mode === 'loading' || mode === 'live' || mode === 'replay', busy, respond,
    reset, proposalSentence };
}

export const COPILOT_PLACEHOLDER = 'Put 1 USDC into Aave on Base Sepolia';
export function copilotIntro(mode: CopilotMode | 'loading'): string | null {
  if (mode === 'live') return 'Flofi Copilot ready. Describe an action in your own words or type an exact command. An AI model turns free text into a proposal; it cannot sign or execute, and nothing changes until you apply.';
  if (mode === 'replay') return 'Flofi Copilot ready in replay mode (recorded answers, no AI model). Describe an action or type an exact command. Nothing changes until you apply a proposal.';
  if (mode === 'unavailable') return 'Local command assistant ready. Flofi Copilot is not configured on this server, so only exact commands work. Review each proposal before applying it.';
  return null;
}
export function copilotHelp(mode: CopilotMode | 'loading'): string | null {
  return mode === 'live' || mode === 'replay' ? `Swaps, Cross-chain Router bridges, Aave V3 and liquidity. ${mode === 'live' ? 'An AI model with no authority interprets' : 'Recorded replay answers interpret'} free text; exact commands skip it.` : null;
}
export const copilotLabel = (role: string, mode: CopilotMode | 'loading') => role === 'you' ? 'YOU' : role === 'ai' ? 'FLOFI COPILOT · AI'
  : mode === 'off' || mode === 'loading' ? 'GRYLOO' : 'FLOFI';

/** Keeps the newest message in view while the Copilot is enabled (off mode keeps its existing scrolling). */
export function useFollowLatest(enabled: boolean, messages: number, busy: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (enabled && ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [enabled, messages, busy]);
  return ref;
}
/** A Copilot answer: plain text, deterministic notes, and clarification options that are sent as the next message. */
export function CopilotMessage({ text, notes, options, disabled, onPick }: { text: string; notes?: readonly string[] | undefined; options?: readonly string[] | undefined;
  disabled: boolean; onPick(option: string): void }) {
  return <>
    <p>{text}</p>
    {notes && notes.length > 0 && <ul className="copilot-notes">{notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
    {options && options.length > 0 && <div className="copilot-options" role="group" aria-label="Suggested answers">
      {options.map(option => <button key={option} type="button" className="quiet" disabled={disabled} onClick={() => onPick(option)}>{option}</button>)}</div>}
  </>;
}
/** Shown inside the existing proposal box when the pending proposal came from the Copilot. */
export function CopilotProposalNotice({ sentence }: { sentence: string }) {
  return <p className="copilot-notice" role="note">AI interpretation of your words as “{sentence}”. It has no authority: check every field.</p>;
}
