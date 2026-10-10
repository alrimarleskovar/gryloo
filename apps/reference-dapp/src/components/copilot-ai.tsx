// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { useCallback, useEffect, useRef, useState } from 'react';
import { copilotInterpret, copilotStatus } from '../app/copilot-action';
import type { Command } from '../domain/commands';
import { chainStatus } from '../domain/artifact-chain';
import { buildCopilotFacts, simulationFlowOf, type CopilotFacts, type SimulationFlow } from '../domain/copilot-answers';
import { closeSegment, emptyConversation, finishTurn, recordProposal, startTurn, type CopilotConversation, type CopilotEnvironment, type CopilotReply,
  type CopilotResultV2 } from '../domain/copilot-conversation';
import { workflowSteps } from '../domain/workflow-steps';
import type { CopilotMode } from '../server/copilot-service';
import { useBuild009Wallet } from '../state/build009-wallet-store';
import { useWorkflowCapability } from '../state/capability-store';
import { useJupiter } from '../state/jupiter-store';
import { useLending } from '../state/lending-store';
import { usePublicTestnet } from '../state/public-testnet-store';
import { useRobinhoodTransfer } from '../state/robinhood-transfer-store';
import { useRouter } from '../state/router-store';
import { useSolanaLiquidity } from '../state/solana-liquidity-store';
import { useSupply } from '../state/supply-store';
import { useUniswapLiquidity } from '../state/uniswap-liquidity-store';
import { useWorkflow } from '../state/workflow-store';

/**
 * BUILD-COPILOT-001: AI interpretation for the Copilot panel, kept apart from the panel itself. Text the exact grammar
 * does not recognize goes to the server-side interpreter; its untrusted intent becomes a proposal only through
 * `copilotIntentToCommand` (exact grammar) and the existing `propose`. Applying stays an explicit user action, and
 * any workflow change while the interpreter runs discards its answer.
 *
 * BUILD-COPILOT-002: the hook drives the pure conversation engine. It hands the engine a read-only snapshot of state
 * Flofi already holds (canonical IR, pending proposal, lint review, capability blockers, the active flow's own record)
 * and passes at most one resulting Command to `propose`. It never dispatches, signs, simulates or executes.
 */
export type { CopilotReply };
type Record_ = { readonly record?: unknown; readonly run?: unknown; readonly retired: boolean } | null;
const authorized = (value: unknown) => {
  const record = value as { authorization?: unknown; reviewedManifestHash?: unknown } | null;
  return Boolean(record && (record.authorization || record.reviewedManifestHash));
};

export function useCopilotInterpreter() {
  const workflow = useWorkflow();
  const wallet = useBuild009Wallet();
  const { environment, result: capability } = useWorkflowCapability();
  const flows: Readonly<Record<Exclude<SimulationFlow, 'MOCKED_CHAIN'>, Record_>> = { SUPPLY: useSupply(), LENDING: useLending(), ROUTER: useRouter(),
    SOLANA_SWAP: useJupiter(), ORCA: useSolanaLiquidity(), UNISWAP: useUniswapLiquidity(), PUBLIC_TESTNET: usePublicTestnet(), TRANSFER: useRobinhoodTransfer() };
  // `loading` renders exactly like `off`; text sent before the status arrives waits for it rather than guessing.
  const [mode, setMode] = useState<CopilotMode | 'loading'>('loading');
  const status = useRef<Promise<CopilotMode> | null>(null);
  const [busy, setBusy] = useState(false);
  const conversation = useRef<CopilotConversation>(emptyConversation());
  const proposals = useRef(new WeakMap<Command, string>());
  const latest = useRef({ workflow, wallet, environment, capability, flows });
  latest.current = { workflow, wallet, environment, capability, flows };
  useEffect(() => {
    let stopped = false;
    const pending = copilotStatus().then(result => result.mode, () => 'off' as const);
    status.current = pending;
    void pending.then(next => { if (!stopped) setMode(next); });
    return () => { stopped = true; };
  }, []);
  /** A read-only snapshot of Flofi state for the engine, taken now. */
  const environmentNow = useCallback((): CopilotEnvironment => {
    const now = latest.current, store = now.workflow, current = store.state.workflow;
    const steps = workflowSteps(current, store.context), flow = simulationFlowOf(steps);
    const owner = flow === 'MOCKED_CHAIN' ? null : now.flows[flow];
    const record = owner ? owner.record ?? owner.run ?? null : null;
    const chain = chainStatus(store.chain);
    const simulation = flow === 'MOCKED_CHAIN' ? { flow, status: chain === 'CURRENT' ? 'CURRENT' as const : chain === 'INVALIDATED' || chain === 'EXPIRED' ? 'STALE' as const : 'NONE' as const, reviewed: false }
      : { flow, status: record ? owner!.retired ? 'STALE' as const : 'CURRENT' as const : 'NONE' as const, reviewed: Boolean(record && !owner!.retired && authorized(record)) };
    const facts: CopilotFacts = buildCopilotFacts({ workflow: current, context: store.context, pending: store.pending, findings: store.review?.findings ?? [], reviewError: store.reviewError,
      capability: { environment: now.environment, executionSupported: now.capability.executionSupported, executionReady: now.capability.executionReady,
        evidenceCeiling: now.capability.evidenceCeiling, blockers: now.capability.blockers.filter(item => item.dimension === 'EXECUTE' || item.dimension === 'AUTHORIZE') },
      simulation, walletConnected: Boolean(now.wallet.account) });
    return { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, workflow: current, context: store.context, wallet: now.wallet.account, walletChainId: now.wallet.chainId, pending: store.pending, facts };
  }, []);
  // Every proposal the user can see becomes a referent, including exact-grammar proposals ("make it 2" after one).
  const pendingCommand = workflow.pending?.command;
  useEffect(() => { if (pendingCommand) conversation.current = recordProposal(conversation.current, environmentNow(), pendingCommand); }, [pendingCommand, environmentNow]);
  /** The exact grammar handled a message: Flofi's open question, if any, is over. */
  const reset = useCallback(() => { conversation.current = closeSegment(conversation.current); }, []);
  const show = useCallback((reply: CopilotReply) => {
    if (reply.command) { proposals.current.set(reply.command, reply.sentence ?? reply.command.type); latest.current.workflow.propose(reply.command); }
    return reply;
  }, []);
  const interpret = useCallback(async (text: string): Promise<CopilotReply> => {
    const start = startTurn(conversation.current, text, environmentNow());
    if (start.kind === 'LOCAL') { conversation.current = start.next; return show(start.reply); }
    setBusy(true);
    try {
      let result: CopilotResultV2;
      try { result = await copilotInterpret(start.request) as CopilotResultV2; } catch { result = { ok: false, code: 'COPILOT_UNAVAILABLE' }; }
      const finished = finishTurn(start.turn, result, environmentNow());
      conversation.current = finished.next;
      return show(finished.reply);
    } finally { setBusy(false); }
  }, [environmentNow, show]);
  /** The Copilot's reply, or null when it is not enabled on this server (the caller shows its exact-grammar guidance). */
  const respond = useCallback(async (text: string): Promise<CopilotReply | null> => {
    const resolved = await (status.current ?? Promise.resolve<CopilotMode>('off'));
    if (resolved === 'live' || resolved === 'replay') return interpret(text);
    // Off mode keeps the exact-grammar behaviour: unrecognized text discards the pending proposal.
    latest.current.workflow.dismissProposal();
    return null;
  }, [interpret]);
  const proposalSentence = useCallback((command: Command | undefined) => command ? proposals.current.get(command) ?? null : null, []);
  return { mode, enabled: mode === 'live' || mode === 'replay', mayInterpret: mode === 'loading' || mode === 'live' || mode === 'replay', busy, respond,
    reset, proposalSentence };
}

export const COPILOT_PLACEHOLDER = 'Put 1 USDC into Aave on Base Sepolia';
export function copilotIntro(mode: CopilotMode | 'loading'): string | null {
  if (mode === 'live') return 'Flofi Copilot ready. Describe an action in your own words, change a step, ask about this workflow, or type an exact command. An AI model turns free text into a proposal; it cannot sign or execute, and nothing changes until you apply.';
  if (mode === 'replay') return 'Flofi Copilot ready in replay mode (recorded answers, no AI model). Describe an action, change a step, ask about this workflow, or type an exact command. Nothing changes until you apply a proposal.';
  if (mode === 'unavailable') return 'Local command assistant ready. Flofi Copilot is not configured on this server, so only exact commands work. Review each proposal before applying it.';
  return null;
}
export function copilotHelp(mode: CopilotMode | 'loading'): string | null {
  return mode === 'live' || mode === 'replay' ? `Swaps, Cross-chain Router bridges, Aave V3 and liquidity; edits and questions about this workflow. ${mode === 'live' ? 'An AI model with no authority interprets' : 'Recorded replay answers interpret'} free text; exact commands skip it.` : null;
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
  const { t: tr } = useLocale();
  return <>
    <p>{tr(text)}</p>
    {notes && notes.length > 0 && <ul className="copilot-notes">{notes.map((note, index) => <li key={index}>{tr(note)}</li>)}</ul>}
    {options && options.length > 0 && <div className="copilot-options" role="group" aria-label={tr("Suggested answers")}>
      {options.map(option => <button key={option} type="button" className="quiet" disabled={disabled} onClick={() => onPick(option)}>{option}</button>)}</div>}
  </>;
}
/** Shown inside the existing proposal box when the pending proposal came from the Copilot. */
export function CopilotProposalNotice({ sentence }: { sentence: string }) {
  const { t: tr } = useLocale();
  return <p className="copilot-notice" role="note">{tr("AI interpretation of your words as “")}{tr(sentence)}{tr("”. It has no authority: check every field.")}</p>;
}
