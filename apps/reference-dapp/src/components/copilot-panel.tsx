// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { useState, type FormEvent } from 'react';
import { parseLocalCommand, summarize } from '../domain/commands';
import { useWorkflow } from '../state/workflow-store';

import { useBuild009Wallet } from '../state/build009-wallet-store';
import { CopilotMessage, COPILOT_PLACEHOLDER, copilotHelp, copilotIntro, copilotLabel, useCopilotInterpreter, useFollowLatest } from './copilot-ai';

type Message = { role: 'system' | 'you' | 'ai'; text: string; notes?: readonly string[]; options?: readonly string[] };
export function CopilotPanel() {
  const { t: tr } = useLocale();
  const { state, context, propose, dismissProposal } = useWorkflow();
  const wallet = useBuild009Wallet();
  const copilot = useCopilotInterpreter();
  const guidance = copilotHelp(copilot.mode) ?? 'This request could not be understood. Check the action, amount, asset and chain, then try again.';
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([{ role: 'system', text: 'Review each proposed change before applying it.' }]);
  const log = useFollowLatest(copilot.enabled, messages.length, copilot.busy);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || copilot.busy) return;
    setInput('');
    send(text);
  }
  function send(text: string) {
    if (text.toLowerCase() === 'explain') {
      dismissProposal();
      // Display the same authored actions as the canvas; the canonical scaffold stays untouched.
      const nodes = state.workflow.nodes.filter(node => !node.actionType.startsWith('mock-'));
      const summary = nodes.length ? summarize({ ...state.workflow, nodes }, context) : 'Your flow has no actions yet. Add an action to start building.';
      setMessages(old => [...old, { role: 'you', text }, { role: 'system', text: summary }]);
      return;
    }
    try {
      const command = parseLocalCommand(text, state.workflow, context, wallet.account);
      propose(command);
      copilot.reset();
      setMessages(old => [...old, { role: 'you', text }, { role: 'system', text: `Proposal: ${text}. Review against revision ${command.baseRevision} before applying.` }]);
    } catch {
      // BUILD-COPILOT-002: the Copilot keeps the pending proposal visible while it interprets ("make it 2", questions about it).
      if (copilot.mayInterpret) {
        setMessages(old => [...old, { role: 'you', text }]);
        void copilot.respond(text).then(reply => setMessages(old => [...old,
          reply ? { role: 'ai', text: reply.text, notes: reply.notes, options: reply.options } : { role: 'system', text: guidance }]));
        return;
      }
      dismissProposal();
      setMessages(old => [...old, { role: 'you', text }, { role: 'system', text: guidance }]);
    }
  }
  return <aside className="copilot panel" aria-label={tr("Workflow assistant")}>
    <div className="copilot-head"><div><p className="eyebrow">{tr("ASSISTANT")}</p><h2>{tr("Copilot")}</h2></div></div>
    <div ref={log} className="chat-messages" role="log" aria-live="polite" aria-label={tr("Conversation")}>{messages.map((message, index) =>
      <div key={index} className={`message ${message.role}`}>{(message.role === 'you' || copilot.enabled) && <small>{tr(message.role === 'you' ? 'YOU' : copilotLabel(message.role, copilot.mode))}</small>}{message.role === 'ai'
        ? <CopilotMessage text={message.text} notes={message.notes} options={message.options} disabled={copilot.busy} onPick={send}/>
        : <p>{message.role === 'you' ? message.text : tr((index === 0 && copilot.enabled && copilotIntro(copilot.mode)) || message.text)}</p>}</div>)}
      {copilot.busy && <div className="message ai" role="status"><small>{tr(copilotLabel('ai', copilot.mode))}</small><p>{tr("Interpreting your message…")}</p></div>}</div>
    <form className="chat-form" onSubmit={submit}><label htmlFor="mock-prompt">{tr("Describe your flow")}</label><div><input id="mock-prompt" value={input} onChange={event => setInput(event.target.value)} placeholder={tr(copilot.enabled ? COPILOT_PLACEHOLDER : 'Action, amount, asset and chain')} maxLength={1024} autoComplete="off"/><button type="submit" disabled={copilot.busy}>{tr("Send")}</button></div></form>
  </aside>;
}
