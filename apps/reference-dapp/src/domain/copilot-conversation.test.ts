// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { applyCommand, FIXTURE, OTHER_ADDRESS } from './copilot-test-fixtures';
import { act, CopilotSession, intent, TEST_WALLET } from './copilot-session.test-harness';
import { looksSecret } from './copilot-conversation';
import { workflowSteps } from './workflow-steps';

const supply5 = act.lending('SUPPLY', { asset: 'USDC', amount: '5' });

describe('bounded multi-turn conversation', () => {
  it('asks for the network, takes the button answer without a model call, then revises the pending proposal', () => {
    const session = new CopilotSession();
    const asked = session.say('Quero colocar 5 USDC na Aave.', intent.action(supply5, 'PT'))!;
    expect(asked).toMatchObject({ kind: 'CLARIFICATION', options: ['Base Sepolia'] });
    expect(asked.text).toContain('Em qual rede?');
    expect(session.pending).toBeNull();
    const proposed = session.say('Base Sepolia')!;
    expect(session.turns.at(-1)!.request).toBeNull();
    expect(proposed).toMatchObject({ kind: 'PROPOSAL', sentence: `supply 5 USDC to Aave on Base Sepolia` });
    expect(proposed.text).toContain('Interpretado como “supply 5 USDC to Aave on Base Sepolia”');
    expect(session.workflow.revision).toBe(0);
    const revised = session.say('Na verdade muda para 2.', intent.edit({ amount: '2' }, {}, 'PT'))!;
    expect(revised).toMatchObject({ kind: 'PROPOSAL', command: { type: 'ADD_SUPPLY', input: { amount: '2', beneficiary: TEST_WALLET } } });
    expect(revised.text).toContain('nova versão da proposta pendente');
    expect(revised.notes.join(' ')).toContain('Mantido de a proposta pendente');
    expect(session.workflow.revision).toBe(0);
    session.apply();
    expect(workflowSteps(session.workflow, session.context)[1]).toMatchObject({ kind: 'SUPPLY', detail: { input: { amount: '2' } } });
  });
  it('asks where a bridge should go instead of completing the pair, and fills the button deterministically', () => {
    const session = new CopilotSession();
    const asked = session.say('Bridge 1 USDC from Base Sepolia.', intent.action(act.bridge({ sourceNetwork: 'BASE_SEPOLIA', asset: 'USDC', amount: '1' })))!;
    expect(asked).toMatchObject({ kind: 'CLARIFICATION', text: 'To prepare this bridge, Flofi still needs the destination network.', options: ['Arbitrum Sepolia'] });
    expect(session.say('Arbitrum Sepolia')).toMatchObject({ kind: 'PROPOSAL', sentence: 'bridge 1 USDC from Base Sepolia to Arbitrum Sepolia via auto slippage 50 bps' });
  });
  it('fills a bare amount answer locally and keeps every other value grounded', () => {
    const session = new CopilotSession();
    expect(session.say('Swap USDC to ETH on Base Sepolia', intent.action(act.swap({ network: 'BASE_SEPOLIA', inputAsset: 'USDC', outputAsset: 'ETH' })))).toMatchObject({ kind: 'CLARIFICATION' });
    expect(session.say('3')).toMatchObject({ kind: 'PROPOSAL', sentence: 'swap 3 USDC to WETH on Base Sepolia slippage 50 bps' });
  });
  it('edits an applied step through its typed edit command and leaves the workflow alone until Apply', () => {
    const session = new CopilotSession([FIXTURE.testnetSwap]);
    const before = session.workflow;
    const edited = session.say('change it to 2', intent.edit({ amount: '2' }))!;
    expect(edited).toMatchObject({ kind: 'PROPOSAL', command: { type: 'SET_SWAP_AMOUNT', nodeId: 'node-002', amount: '2' } });
    expect(edited.text).toContain('Interpreted as a change to step 2 (Swap 3 USDC → WETH · Base Sepolia)');
    expect(session.workflow).toBe(before);
    session.apply();
    expect(workflowSteps(session.workflow, session.context)[1]!.detail).toMatchObject({ amount: '2' });
  });
  it('never lets the model invent a value: "make it smaller" becomes a question', () => {
    const session = new CopilotSession([FIXTURE.supply]);
    const reply = session.say('Make it smaller', intent.edit({ amount: '2' }))!;
    expect(reply.kind).toBe('CLARIFICATION');
    expect(reply.text).toContain('could not find the amount 2');
    expect(session.pending).toBeNull();
  });
  it('asks which swap when two match, and resolves the chosen button to that exact node', () => {
    const session = new CopilotSession([FIXTURE.baseSwap, FIXTURE.baseSwap2]);
    const asked = session.say('change the swap to 2', intent.edit({ amount: '2' }, { step: 'SWAP' }))!;
    expect(asked).toMatchObject({ kind: 'CLARIFICATION', text: 'Which swap do you mean?',
      options: ['Step 2 · Swap 2 USDC → WETH · Base', 'Step 3 · Swap 3 USDC → WETH · Base'] });
    expect(session.pending).toBeNull();
    expect(session.say('Step 3 · Swap 3 USDC → WETH · Base')).toMatchObject({ kind: 'PROPOSAL', command: { type: 'SET_SWAP_AMOUNT', nodeId: 'node-003', amount: '2' } });
    expect(session.turns.at(-1)!.request).toBeNull();
  });
  it('resolves ordinals against the canonical IR and removes only what the canvas could', () => {
    const session = new CopilotSession([FIXTURE.supply]);
    expect(session.say('Remove o segundo passo', intent.remove({ ordinal: 'SECOND' }, 'PT'))).toMatchObject({ kind: 'PROPOSAL', command: { type: 'REMOVE', nodeId: 'node-002' } });
    session.dismiss();
    expect(session.say('remove the first step', intent.remove({ ordinal: 'FIRST' }))!.text).toContain('starting template');
    expect(session.say('remove the fifth step', intent.remove({ ordinal: 'FIFTH' }))!.text).toContain('This workflow has 2 steps');
  });
  it('repeats an earlier proposal only with a repeat cue, carrying its values with provenance', () => {
    const session = new CopilotSession();
    session.say(FIXTURE.testnetSwap);
    session.dismiss();
    const repeated = session.say('Do the same thing but with 2 USDC', intent.repeat({ amount: '2' }))!;
    expect(repeated).toMatchObject({ kind: 'PROPOSAL', sentence: 'swap 2 USDC to WETH on Base Sepolia slippage 50 bps' });
    expect(repeated.notes.join(' ')).toContain('Kept from your earlier proposal');
    session.dismiss();
    expect(session.say('Swap with 2 USDC', intent.repeat({ amount: '2' }))!.text).toContain('only when you ask for “the same” or “again”');
  });
  it('reuses a named field only with reuse wording, and asks for anything else', () => {
    const session = new CopilotSession();
    session.say(FIXTURE.testnetSwap);
    session.dismiss();
    const reuse = { from: { step: null, ordinal: null }, fields: ['network'] };
    const reply = session.say('Now supply 2 USDC on the same network', intent.action(act.lending('SUPPLY', { asset: 'USDC', amount: '2' }), 'EN', reuse))!;
    expect(reply).toMatchObject({ kind: 'PROPOSAL', sentence: 'supply 2 USDC to Aave on Base Sepolia' });
    session.dismiss();
    expect(session.say('Now supply 2 USDC', intent.action(act.lending('SUPPLY', { asset: 'USDC', amount: '2' }), 'EN', reuse))!.kind).toBe('CLARIFICATION');
  });
  it('answers read-only questions from Flofi state without proposing or changing anything', () => {
    const session = new CopilotSession([FIXTURE.testnetSwap]);
    session.say(FIXTURE.baseSwap.replace('Base', 'Base Sepolia').replace('2 USDC', '4 USDC'));
    const pending = session.pending, before = session.workflow;
    const answer = session.say('What does this workflow do?', intent.question('WORKFLOW_OVERVIEW'))!;
    expect(answer.kind).toBe('ANSWER');
    expect(answer.command).toBeUndefined();
    expect(answer.notes.join('\n')).toContain('Swaps 3 USDC for WETH on Base Sepolia through Uniswap v3');
    expect(answer.notes.at(-1)).toBe('Read only: nothing was proposed, changed, signed or executed.');
    expect(session.pending).toBe(pending);
    expect(session.workflow).toBe(before);
    expect(session.say('O que a simulação mostrou?', intent.question('SIMULATION', null, 'PT'))!.text).toContain('Ainda não há resultado de simulação');
    expect(session.say("What's the APY on Aave?", intent.question('MARKET_DATA'))!.text).toContain('never estimates them');
  });
});

describe('stale context and safety', () => {
  it('discards an answer when the workflow, the proposal or the wallet changed meanwhile', () => {
    const canvasEdit = (s: CopilotSession) => { s.workflow = applyCommand(s.workflow, { type: 'ADD', kind: 'read', source: 'CANVAS', baseRevision: s.workflow.revision }); };
    const session = new CopilotSession([FIXTURE.supply]);
    expect(session.say('make it 2', intent.edit({ amount: '2' }), canvasEdit))
      .toMatchObject({ kind: 'FAILED', text: 'The workflow changed while Flofi Copilot was interpreting, so nothing was proposed. Send your message again.' });
    expect(session.pending).toBeNull();
    expect(session.say('make it 2', intent.edit({ amount: '2' }), s => { s.wallet = OTHER_ADDRESS; })!.text).toContain('Your wallet or its network changed');
    session.say(FIXTURE.testnetSwap.replace('3 USDC', '1 USDC'));
    expect(session.say('make it 2', intent.edit({ amount: '2' }), s => s.dismiss())!.text).toContain('The pending proposal changed');
  });
  it('refuses Flofi\'s own step button after the workflow changed', () => {
    const session = new CopilotSession([FIXTURE.baseSwap, FIXTURE.baseSwap2]);
    session.say('change the swap to 2', intent.edit({ amount: '2' }, { step: 'SWAP' }));
    session.workflow = applyCommand(session.workflow, { type: 'ADD', kind: 'read', source: 'CANVAS', baseRevision: session.workflow.revision });
    const reply = session.say('Step 3 · Swap 3 USDC → WETH · Base')!;
    expect(reply).toMatchObject({ kind: 'FAILED' });
    expect(reply.text).toContain('changed after Flofi asked');
    expect(session.pending).toBeNull();
  });
  it('never sends a private key or seed phrase anywhere', () => {
    const session = new CopilotSession();
    const reply = session.say('My private key is 0x' + 'ab'.repeat(32))!;
    expect(reply.kind).toBe('UNSUPPORTED');
    expect(session.turns.at(-1)!.request).toBeNull();
    expect(session.state.transcript).toEqual([]);
    expect(looksSecret('abandon ability able about above absent absorb abstract absurd abuse access accident')).toBe(true);
    expect(looksSecret('Swap 2 USDC to WETH on Base Sepolia')).toBe(false);
  });
});
