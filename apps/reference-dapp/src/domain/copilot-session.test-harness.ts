// SPDX-License-Identifier: AGPL-3.0-only
import { parseLocalCommand, type Command } from './commands';
import { editorReducer, initialEditor } from './editor';
import type { Workflow } from './initial-workflow';
import { describeProposal } from './proposal';
import { buildCopilotFacts, type CopilotFacts, type CopilotFactsInput } from './copilot-answers';
import { closeSegment, emptyConversation, finishTurn, recordProposal, startTurn, type CopilotConversation, type CopilotEnvironment, type CopilotReply,
  type CopilotRequestV2, type CopilotResultV2 } from './copilot-conversation';
import { applyCommand, buildWorkflow, contextFor, TEST_WALLET } from './copilot-test-fixtures';

/**
 * Test-only: drives the real conversation engine the way the Copilot panel does — "explain" and the exact grammar
 * first, then the engine — with a scripted model and the real editor for Apply. No network, no wallet, no execution.
 */
export type ModelAnswer = Record<string, unknown> | { readonly failure: string; readonly retryAfterSeconds?: number } | ((request: CopilotRequestV2) => CopilotResultV2);
export type TurnRecord = { readonly text: string; readonly reply: CopilotReply | null; readonly local: 'EXACT' | 'ENGINE' | null; readonly request: CopilotRequestV2 | null;
  readonly workflowBefore: Workflow; readonly workflowAfter: Workflow };
export class CopilotSession {
  workflow: Workflow;
  pending: { command: Command; diff: readonly string[] } | null = null;
  state: CopilotConversation = emptyConversation();
  wallet: string | null;
  walletChainId: string | null = 'eip155:84532';
  facts: Partial<Omit<CopilotFactsInput, 'workflow' | 'context' | 'pending'>> = {};
  readonly turns: TurnRecord[] = [];
  constructor(setup: readonly string[] | Workflow = [], wallet: string | null = TEST_WALLET) {
    this.wallet = wallet;
    this.workflow = Array.isArray(setup) ? buildWorkflow(setup as readonly string[], wallet) : setup as Workflow;
  }
  get context() { return contextFor(this.workflow); }
  currentFacts(): CopilotFacts { return buildCopilotFacts({ workflow: this.workflow, context: this.context, pending: this.pending, ...this.facts }); }
  env(): CopilotEnvironment {
    return { workflow: this.workflow, context: this.context, wallet: this.wallet, walletChainId: this.walletChainId, pending: this.pending, facts: this.currentFacts() };
  }
  propose(command: Command) {
    const before = { workflow: this.workflow, error: null };
    this.pending = { command, diff: describeProposal(before, editorReducer(before, command, this.context), command, this.context) };
  }
  /** One user message. `model` is what the scripted model returns if (and only if) the engine asks it. */
  say(text: string, model?: ModelAnswer, race?: (session: CopilotSession) => void): CopilotReply | null {
    const workflowBefore = this.workflow;
    if (text.toLowerCase() === 'explain') { this.pending = null; this.turns.push({ text, reply: null, local: 'EXACT', request: null, workflowBefore, workflowAfter: this.workflow }); return null; }
    try {
      const command = parseLocalCommand(text, this.workflow, this.context, this.wallet);
      this.propose(command);
      this.state = recordProposal(closeSegment(this.state), this.env(), command);
      this.turns.push({ text, reply: null, local: 'EXACT', request: null, workflowBefore, workflowAfter: this.workflow });
      return null;
    } catch { /* not an exact command: the engine decides */ }
    const start = startTurn(this.state, text, this.env());
    let reply: CopilotReply, request: CopilotRequestV2 | null = null;
    if (start.kind === 'LOCAL') { reply = start.reply; this.state = start.next; }
    else {
      request = start.request;
      if (model === undefined) throw new Error(`unexpected model call for: ${text}`);
      const result: CopilotResultV2 = typeof model === 'function' ? (model as (request: CopilotRequestV2) => CopilotResultV2)(start.request)
        : 'failure' in model ? { ok: false, code: model.failure as string, ...(model.retryAfterSeconds ? { retryAfterSeconds: model.retryAfterSeconds as number } : {}) }
        : { ok: true, intent: model };
      race?.(this);
      const finished = finishTurn(start.turn, result, this.env());
      reply = finished.reply; this.state = finished.next;
    }
    if (reply.command) this.propose(reply.command);
    this.turns.push({ text, reply, local: start.kind === 'LOCAL' ? 'ENGINE' : null, request, workflowBefore, workflowAfter: this.workflow });
    return reply;
  }
  apply() { if (!this.pending) throw new Error('nothing to apply'); this.workflow = applyCommand(this.workflow, this.pending.command); this.pending = null; }
  dismiss() { this.pending = null; }
  reset() { this.workflow = initialEditor().workflow; this.pending = null; }
}

// Scripted model answers: exactly what a model may return, in the strict V2 shape.
type L = 'EN' | 'PT';
const head = (kind: string, language: L = 'EN') => ({ version: '2', language, kind });
export const NO_TARGET = { step: null, ordinal: null };
export const CHANGES = { amount: null, slippageBps: null, network: null, destinationNetwork: null, inputAsset: null, outputAsset: null, recipient: null, routing: null,
  deposits: [], rangeUnit: null, lower: null, upper: null };
export const intent = {
  action: (action: Record<string, unknown>, language: L = 'EN', reuse: unknown = null) => ({ ...head('ACTION', language), action, reuse }),
  composition: (actions: unknown[], language: L = 'EN') => ({ ...head('COMPOSITION', language), actions }),
  edit: (changes: Record<string, unknown>, target: Record<string, unknown> = NO_TARGET, language: L = 'EN') => ({ ...head('EDIT', language), target: { ...NO_TARGET, ...target }, changes: { ...CHANGES, ...changes } }),
  repeat: (changes: Record<string, unknown> = {}, target: Record<string, unknown> = NO_TARGET, language: L = 'EN') => ({ ...head('REPEAT', language), target: { ...NO_TARGET, ...target }, changes: { ...CHANGES, ...changes } }),
  remove: (target: Record<string, unknown> = NO_TARGET, language: L = 'EN') => ({ ...head('REMOVE', language), target: { ...NO_TARGET, ...target } }),
  insert: (position: 'BEFORE' | 'AFTER', anchor: Record<string, unknown>, action: Record<string, unknown>, language: L = 'EN') => ({ ...head('INSERT', language), position, anchor: { ...NO_TARGET, ...anchor }, action }),
  question: (topic: string, target: Record<string, unknown> | null = null, language: L = 'EN') => ({ ...head('QUESTION', language), topic, target: target ? { ...NO_TARGET, ...target } : null }),
  clarify: (missing: string[], question: string, options: string[] = [], language: L = 'EN') => ({ ...head('CLARIFICATION_REQUIRED', language), missing, question, options }),
  unsupported: (reason: string, language: L = 'EN') => ({ ...head('UNSUPPORTED', language), reason }),
};
export const act = {
  swap: (fields: Record<string, unknown> = {}) => ({ type: 'SWAP', network: null, inputAsset: null, outputAsset: null, amount: null, slippageBps: null, ...fields }),
  bridge: (fields: Record<string, unknown> = {}) => ({ type: 'BRIDGE', sourceNetwork: null, destinationNetwork: null, asset: null, amount: null, slippageBps: null, routing: null, recipient: null, ...fields }),
  lending: (type: string, fields: Record<string, unknown> = {}) => ({ type, protocol: 'AAVE_V3', network: null, asset: null, amount: null, beneficiary: null, ...fields }),
  liquidity: (fields: Record<string, unknown> = {}) => ({ type: 'LIQUIDITY', protocol: null, network: null, deposits: [], rangeUnit: null, lower: null, upper: null, slippageBps: null, ...fields }),
};
export { TEST_WALLET };
