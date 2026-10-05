// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { commandIsValid, parseLocalCommand, type Command } from './commands';
import { editorReducer } from './editor';
import { buildWorkflow, contextFor, FIXTURE, OTHER_ADDRESS, TEST_WALLET } from './copilot-test-fixtures';
import { editCommandFor, removeCommandFor, type EditPlan } from './workflow-edits';
import type { Workflow } from './initial-workflow';

const typed = (workflow: Workflow, sentence: string): Command => parseLocalCommand(sentence, workflow, contextFor(workflow), TEST_WALLET);
const edit = (workflow: Workflow, nodeId: string, sentence: string): EditPlan => editCommandFor(workflow, contextFor(workflow), nodeId, typed(workflow, sentence));
const command = (plan: EditPlan): Command => { if (!plan.ok) throw new Error(plan.code); expect(commandIsValid(plan.command)).toBe(true); return plan.command; };
const applies = (workflow: Workflow, plan: EditPlan) => {
  const next = editorReducer({ workflow, error: null }, command(plan), contextFor(workflow));
  expect(next.error).toBeNull();
  return next.workflow;
};

describe('edit commands for existing steps', () => {
  it('maps a validated Aave input onto the existing SET command of that node', () => {
    const workflow = buildWorkflow([FIXTURE.supply]);
    const plan = edit(workflow, 'node-002', 'supply 2 USDC to Aave on Base Sepolia');
    expect(command(plan)).toEqual({ type: 'SET_SUPPLY', nodeId: 'node-002', source: 'CHAT', baseRevision: 1,
      input: { network: 'Base Sepolia', asset: 'USDC', amount: '2', beneficiary: TEST_WALLET } });
    expect(applies(workflow, plan).revision).toBe(2);
    expect(command(edit(workflow, 'node-002', `supply 5 USDC to Aave on Base Sepolia beneficiary ${OTHER_ADDRESS}`))).toMatchObject({ input: { beneficiary: OTHER_ADDRESS } });
    expect(edit(workflow, 'node-002', 'borrow 2 USDC from Aave on Base Sepolia')).toEqual({ ok: false, code: 'STEP_KIND_MISMATCH' });
    expect(command(edit(buildWorkflow([FIXTURE.withdraw]), 'node-002', 'withdraw 1 USDC from Aave on Base Sepolia'))).toMatchObject({ type: 'SET_WITHDRAW' });
  });
  it('edits a Base swap one parameter at a time and never its tokens or network', () => {
    const workflow = buildWorkflow([FIXTURE.testnetSwap]);
    expect(command(edit(workflow, 'node-002', 'swap 2 USDC to WETH on Base Sepolia slippage 50 bps'))).toEqual(
      { type: 'SET_SWAP_AMOUNT', nodeId: 'node-002', amount: '2', source: 'CHAT', baseRevision: 1 });
    expect(command(edit(workflow, 'node-002', 'swap 3 USDC to WETH on Base Sepolia slippage 100 bps'))).toMatchObject({ type: 'SET_SLIPPAGE', slippage: '100' });
    expect(edit(workflow, 'node-002', 'swap 2 USDC to WETH on Base Sepolia slippage 100 bps')).toEqual({ ok: false, code: 'ONE_CHANGE_AT_A_TIME' });
    expect(edit(workflow, 'node-002', 'swap 3.0 USDC to WETH on Base Sepolia slippage 50 bps')).toEqual({ ok: false, code: 'NO_CHANGE' });
    expect(edit(workflow, 'node-002', 'swap 0.001 WETH to USDC on Base Sepolia slippage 50 bps')).toEqual({ ok: false, code: 'SWAP_TOKENS_OR_NETWORK_FIXED' });
    expect(edit(workflow, 'node-002', 'swap 3 USDC to WETH on Base slippage 50 bps')).toEqual({ ok: false, code: 'SWAP_TOKENS_OR_NETWORK_FIXED' });
    expect(applies(workflow, edit(workflow, 'node-002', 'swap 2 USDC to WETH on Base Sepolia slippage 50 bps')).revision).toBe(2);
  });
  it('re-authors the Router, Solana swap and liquidity nodes through their own SET commands', () => {
    const bridge = buildWorkflow([FIXTURE.bridge]);
    const routed = command(edit(bridge, 'node-002', 'bridge 2 USDC from Base Sepolia to Arbitrum Sepolia via auto slippage 50 bps'));
    expect(routed).toMatchObject({ type: 'SET_ROUTER_BRIDGE', nodeId: 'node-002', input: { amount: '2', destination: 'Arbitrum Sepolia' } });
    expect(applies(bridge, edit(bridge, 'node-002', 'bridge 2 USDC from Base Sepolia to Arbitrum Sepolia via auto slippage 50 bps')).nodes).toHaveLength(1);
    expect(command(edit(buildWorkflow([FIXTURE.devnetSwap]), 'node-002', 'swap 2 SOL to devUSDC on Solana Devnet slippage 50 bps'))).toMatchObject({ type: 'SET_SOLANA_SWAP' });
    expect(command(edit(buildWorkflow([FIXTURE.uniswap]), 'node-002',
      'add liquidity 50 USDC and 0.05 WETH from 2000 to 4000 USDC per WETH on Base Sepolia slippage 100 bps'))).toMatchObject({ type: 'SET_UNISWAP_LIQUIDITY' });
    expect(command(edit(buildWorkflow([FIXTURE.orca]), 'node-002', 'add liquidity 2 SOL and 100 devUSDC ticks -1024 to 1024 on Solana Devnet slippage 100 bps')))
      .toMatchObject({ type: 'SET_SOLANA_LIQUIDITY' });
  });
  it('edits a lending composition only by re-authoring it with AUTHOR_LENDING', () => {
    const workflow = buildWorkflow([FIXTURE.lending]);
    const plan = edit(workflow, 'lending-borrow', 'compose supply 10 USDC to Aave then borrow 3 USDC then swap borrowed USDC to WETH on Base Sepolia slippage 50 bps');
    expect(command(plan)).toMatchObject({ type: 'AUTHOR_LENDING', input: { supply: '10', borrow: '3' } });
    expect(edit(workflow, 'lending-swap', FIXTURE.supply)).toEqual({ ok: false, code: 'STEP_KIND_MISMATCH' });
  });
  it('refuses templates, legacy steps and unknown nodes', () => {
    const workflow = buildWorkflow([FIXTURE.supply]);
    expect(edit(workflow, 'node-001', FIXTURE.supply)).toEqual({ ok: false, code: 'STEP_NOT_EDITABLE' });
    expect(edit(workflow, 'node-404', FIXTURE.supply)).toEqual({ ok: false, code: 'UNKNOWN_STEP' });
  });
});

describe('remove commands', () => {
  it('removes only what the canvas could delete, and says why otherwise', () => {
    const workflow = buildWorkflow([FIXTURE.supply]);
    expect(removeCommandFor(workflow, contextFor(workflow), 'node-002', 1)).toEqual({ ok: true, command: { type: 'REMOVE', nodeId: 'node-002', source: 'CHAT', baseRevision: 1 } });
    expect(removeCommandFor(workflow, contextFor(workflow), 'node-001', 1)).toEqual({ ok: false, code: 'FIRST_STEP_PROTECTED' });
    const bridge = buildWorkflow([FIXTURE.bridge]);
    expect(removeCommandFor(bridge, contextFor(bridge), 'node-002', 1)).toEqual({ ok: false, code: 'LAST_STEP_PROTECTED' });
    const lending = buildWorkflow([FIXTURE.lending]);
    expect(removeCommandFor(lending, contextFor(lending), 'lending-borrow', 1)).toEqual({ ok: false, code: 'COMPOSITION_STEP_PROTECTED' });
    expect(removeCommandFor(workflow, contextFor(workflow), 'node-009', 1)).toEqual({ ok: false, code: 'UNKNOWN_STEP' });
  });
});
