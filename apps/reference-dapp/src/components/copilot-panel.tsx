// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useState, type FormEvent } from 'react';
import { HELP, BRIDGE_HELP, parseLocalCommand, summarize } from '../domain/commands';
import { useWorkflow } from '../state/workflow-store';
import { useBridge } from '../state/bridge-store';

import { useBuild009Wallet } from '../state/build009-wallet-store';

type Message = { role: 'system' | 'you'; text: string };
export function CopilotPanel() {
  const { state, context, pending, propose, applyProposal, dismissProposal } = useWorkflow();
  const wallet = useBuild009Wallet();
  const bridgeEnabled = useBridge().enabled;
  const guidance = state.workflow.nodes.some(node => node.actionType === 'asset.liquidity.prepare')
    ? `${bridgeEnabled ? BRIDGE_HELP : HELP} Cross-chain: bridge 100 USDC from Base to Arbitrum via LI.FI and create Uniswap liquidity ticks -200100 to -199900 recipient 0x1111111111111111111111111111111111111111.`
    : bridgeEnabled ? BRIDGE_HELP : HELP;
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([{ role: 'system', text: 'Local command assistant ready. Review each proposal before applying it.' }]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    if (text.toLowerCase() === 'explain') {
      dismissProposal();
      setMessages(old => [...old, { role: 'you', text }, { role: 'system', text: summarize(state.workflow, context) }]);
      return;
    }
    try {
      const command = parseLocalCommand(text, state.workflow, context, wallet.account);
      propose(command);
      setMessages(old => [...old, { role: 'you', text }, { role: 'system', text: `Proposal: ${text}. Review against revision ${command.baseRevision} before applying.` }]);
    } catch (cause) {
      dismissProposal();
      const message = cause instanceof Error && cause.message.startsWith('CLOAK_')
        ? 'Cloak supports SOL → public USDC with private SOL change. USDC → private SOL is unavailable. Try “swap 0.02 SOL to USDC privately”.' : guidance;
      setMessages(old => [...old, { role: 'you', text }, { role: 'system', text: message }]);
    }
  }
  function apply() {
    if (!pending) return;
    applyProposal();
    setMessages(old => [...old, { role: 'system', text: `Submitted proposal based on revision ${pending.command.baseRevision}. Check the canvas and review findings.` }]);
  }
  return <aside className="copilot panel" aria-label="Workflow assistant">
    <div className="copilot-head"><div><p className="eyebrow">ASSISTANT</p><h2>Copilot</h2></div></div>
    <div className="chat-messages" role="log" aria-live="polite" aria-label="Conversation">{messages.map((message, index) =>
      <div key={index} className={`message ${message.role}`}><small>{message.role === 'you' ? 'YOU' : 'GRYLOO'}</small><p>{message.text}</p></div>)}</div>
    {pending && <div className="proposal" role="status"><div className="proposal-copy"><strong>Review proposed edit</strong>
      <p>{pending.command.type} · base revision {pending.command.baseRevision}</p>
      <ul>{pending.diff.map((line, index) => <li key={index}>{line}</li>)}</ul>
      {pending.review && <p>Review: {pending.review.findings.length} findings · execution unavailable</p>}</div>
      <div className="proposal-actions"><button type="button" onClick={apply} disabled={pending.diff.length === 1 && pending.diff[0] !== 'Edit'}>Apply proposal</button><button type="button" className="quiet" onClick={dismissProposal}>Dismiss</button></div>
    </div>}
    <form className="chat-form" onSubmit={submit}><label htmlFor="mock-prompt">{bridgeEnabled ? 'Describe a mock edit, Base swap or bridge' : 'Describe a mock edit or Base swap'}</label><div><input id="mock-prompt" value={input} onChange={event => setInput(event.target.value)} placeholder="Swap 2 USDC to WETH on Base slippage 50 bps" maxLength={1024} autoComplete="off"/><button type="submit">Send</button></div><small>{guidance}</small></form>
  </aside>;
}
