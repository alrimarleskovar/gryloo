// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useState, type FormEvent } from 'react';
import { HELP, parseMockCommand, summarize, type Command } from '../domain/commands';
import { useWorkflow } from '../state/workflow-store';

type Message = { role: 'system' | 'you'; text: string };
export function CopilotPanel() {
  const { state, dispatch } = useWorkflow();
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<Command | null>(null);
  const [messages, setMessages] = useState<Message[]>([{ role: 'system', text: 'Local mock assistant ready. Changes require review before they update the shared workflow.' }]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    if (text.toLowerCase() === 'explain') {
      setPending(null);
      setMessages((old) => [...old, { role: 'you', text }, { role: 'system', text: summarize(state.workflow) }]);
      return;
    }
    try {
      const command = parseMockCommand(text.toLowerCase(), state.workflow.revision);
      setPending(command);
      setMessages((old) => [...old, { role: 'you', text }, { role: 'system', text: `Proposal: ${text}. Review against revision ${command.baseRevision} before applying.` }]);
    } catch {
      setPending(null);
      setMessages((old) => [...old, { role: 'you', text }, { role: 'system', text: HELP }]);
    }
  }
  function apply() {
    if (!pending) return;
    dispatch(pending);
    setMessages((old) => [...old, { role: 'system', text: `Submitted proposal based on revision ${pending.baseRevision}. Check the canvas and revision for the result.` }]);
    setPending(null);
  }
  return <aside className="copilot panel" aria-label="Mock copilot">
    <div className="copilot-head"><div><p className="eyebrow">BUILD / 02</p><h2>Copilot</h2></div><span className="local-tag">LOCAL MOCK</span></div>
    <div className="chat-messages" role="log" aria-live="polite" aria-label="Mock conversation">{messages.map((message, index) =>
      <div key={index} className={`message ${message.role}`}><small>{message.role === 'you' ? 'YOU' : 'GRYL OO · MOCK'.replace(' ', '')}</small><p>{message.text}</p></div>)}</div>
    {pending && <div className="proposal" role="status"><strong>Review proposed edit</strong><p>{pending.type} · base revision {pending.baseRevision}</p><div><button type="button" onClick={apply}>Apply proposal</button><button type="button" className="quiet" onClick={() => setPending(null)}>Dismiss</button></div></div>}
    <form className="chat-form" onSubmit={submit}><label htmlFor="mock-prompt">Describe a mock edit</label><div><input id="mock-prompt" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Add read" autoComplete="off"/><button type="submit">Send</button></div><small>No model or network service is connected. Try “explain”.</small></form>
  </aside>;
}
