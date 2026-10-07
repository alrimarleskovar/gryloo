// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { JUPITER_SOLANA_MAINNET, ORCA_WHIRLPOOLS_DEVNET } from '@defi-workflow-engine/action-registry';
import { initialWorkflow, freeze } from './initial-workflow';
import { createRouterNode } from './router-authoring';
import { shellChainLabel, workflowShellContext } from './product-shell';

describe('product shell canonical workflow projection', () => {
  it('distinguishes the starting mock example from a required wallet network', () => {
    const workflow = initialWorkflow();
    expect(workflowShellContext(workflow)).toEqual({ workflowId: workflow.workflowId, revision: 0,
      actionCount: 0, chains: [], mockExample: true, requiredChain: null });
  });

  it.each([
    ['Base Sepolia', 'Arbitrum Sepolia', 'eip155:84532', ['Base Sepolia', 'Arbitrum Sepolia']],
    ['Base', 'Arbitrum', 'eip155:8453', ['Base (8453)', 'Arbitrum (42161)']],
  ] as const)('shows both canonical router chains for %s → %s without altering IR', (source, destination, chain, labels) => {
    const workflow = freeze({ ...initialWorkflow(), revision: 7, nodes: [createRouterNode('bridge', {
      source, destination, token: 'USDC', amount: '1', recipient: '', slippage: '50', routing: 'AUTO',
    })] });
    const before = JSON.stringify(workflow);
    expect(workflowShellContext(workflow)).toMatchObject({ revision: 7, actionCount: 1, chains: labels,
      requiredChain: chain, mockExample: false });
    expect(JSON.stringify(workflow)).toBe(before);
  });

  it('handles an empty workflow without inventing a chain or an action', () => {
    expect(workflowShellContext(freeze({ ...initialWorkflow(), nodes: [] }))).toMatchObject({
      chains: [], actionCount: 0, mockExample: false, requiredChain: null,
    });
  });

  it('deduplicates chains while retaining an unknown canonical chain identity', () => {
    const node = { ...initialWorkflow().nodes[0]!, actionType: 'future.action', chainId: 'eip155:999999' };
    expect(workflowShellContext(freeze({ ...initialWorkflow(), nodes: [node, { ...node, nodeId: 'second' }] })))
      .toMatchObject({ actionCount: 2, chains: ['eip155:999999'], requiredChain: 'eip155:999999', mockExample: false });
  });

  it('keeps local forks and Solana clusters visibly distinct', () => {
    expect(shellChainLabel('eip155:31337')).toBe('Local fork (31337)');
    expect(shellChainLabel(JUPITER_SOLANA_MAINNET.chain)).toBe('Solana');
    expect(shellChainLabel(ORCA_WHIRLPOOLS_DEVNET.chain)).toBe('Solana Devnet');
  });
});
