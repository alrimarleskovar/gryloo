// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useState, type FormEvent } from 'react';
import { parseLocalCommand, summarize } from '../domain/commands';
import { useWorkflow } from '../state/workflow-store';

import { useBuild009Wallet } from '../state/build009-wallet-store';

type Message = { role: 'system' | 'you'; text: string };
export function CopilotPanel() {
  const { state, context, propose, dismissProposal } = useWorkflow();
  const wallet = useBuild009Wallet();
  const guidance = 'This request could not be understood. Check the action, amount, asset and chain, then try again.';
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([{ role: 'system', text: 'Review each proposed change before applying it.' }]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
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
      setMessages(old => [...old, { role: 'you', text }, { role: 'system', text: `Proposal: ${text}. Review against revision ${command.baseRevision} before applying.` }]);
    } catch {
      dismissProposal();
      setMessages(old => [...old, { role: 'you', text }, { role: 'system', text: guidance }]);
    }
  }
  return <aside className="copilot panel" aria-label="Workflow assistant">
    <div className="copilot-head"><div><p className="eyebrow">ASSISTANT</p><h2>Copilot</h2></div></div>
    <div className="chat-messages" role="log" aria-live="polite" aria-label="Conversation">{messages.map((message, index) =>
      <div key={index} className={`message ${message.role}`}>{message.role === 'you' && <small>YOU</small>}<p>{message.text}</p></div>)}</div>
    <form className="chat-form" onSubmit={submit}><label htmlFor="mock-prompt">Describe your flow</label><div><input id="mock-prompt" value={input} onChange={event => setInput(event.target.value)} placeholder="Action, amount, asset and chain" maxLength={1024} autoComplete="off"/><button type="submit">Send</button></div></form>
  </aside>;
}
