// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { parseLocalCommand } from '../domain/commands';
import { editorReducer, initialEditor } from '../domain/editor';
import { composeBound, composeStrategy, dappReviewContext, reviewComposition, type Composition } from './strategy-engine';
import { STRATEGY_EXAMPLES } from './strategy-examples';
import type { StrategySpec } from './strategy-spec';

const OWNER = '0x1111111111111111111111111111111111111111';
const composed = (spec: unknown): Composition => { const result = composeStrategy(spec); if (!result.ok) throw new Error(result.code); return result; };
const refused = (spec: unknown) => { const result = composeStrategy(spec); if (result.ok) throw new Error('composed'); return result; };
/** The DApp chat path: the same sentence a user types, through the exact grammar and the same reducer. */
function dappChat(sentence: string) {
  const state = initialEditor(), context = dappReviewContext();
  const after = editorReducer(state, parseLocalCommand(sentence, state.workflow, context, null), context);
  if (after.error) throw new Error(after.error);
  return after.workflow;
}

describe('BUILD-MCP-001 deterministic engine facade', () => {
  it('composes the owner example: 5 USDC Base Sepolia → Arbitrum Sepolia, auto routing', () => {
    const c = composed({ action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5', routing: 'auto' });
    expect(c.workflow.revision).toBe(1);
    expect(c.workflow.nodes).toHaveLength(1);
    expect(c.workflow.nodes[0]).toMatchObject({ actionType: 'asset.bridge', chainId: 'eip155:84532', requiredAuthorizationClass: 'MODE_A' });
    expect(c.strategy).toEqual({ version: 1, action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5',
      routing: 'auto', slippageBps: 50 });
    expect(c.workflowHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(c.fundsClass).toBe('TEST_FUNDS');
    expect(c.notes).toContain('Default slippage 50 bps applied.');
    expect(c.explanation.join('\n')).toMatch(/Base Sepolia USDC → Arbitrum Sepolia USDC/);
    expect(c.steps.map(s => s.kind)).toEqual(['BRIDGE']);
  });

  it('is byte-identical to the DApp chat authoring for every supported action and network', () => {
    const sentences: Record<string, string> = {
      'bridge-base-sepolia-arbitrum-sepolia': 'bridge 5 USDC from Base Sepolia to Arbitrum Sepolia via auto slippage 50 bps',
      'bridge-base-arbitrum-one': 'bridge 5 USDC from Base to Arbitrum via auto slippage 50 bps',
      'swap-base': 'swap 2 USDC to WETH on Base slippage 50 bps',
      'swap-base-sepolia': 'swap 1 USDC to WETH on Base Sepolia slippage 50 bps',
      'swap-ethereum-sepolia': 'swap 1 USDC to WETH on Ethereum Sepolia slippage 50 bps',
      'swap-solana': 'swap 1 USDC to SOL on Solana slippage 50 bps',
      'swap-solana-devnet': 'swap 1 devUSDC to SOL on Solana Devnet slippage 50 bps',
      'supply-base-sepolia': 'supply 1 USDC to Aave on Base Sepolia beneficiary 0x0000000000000000000000000000000000000001',
      'supply-ethereum-sepolia': 'supply 0.001 WBTC to Aave on Ethereum Sepolia beneficiary 0x0000000000000000000000000000000000000001',
      'borrow-base-sepolia': 'borrow 1 USDC from Aave on Base Sepolia beneficiary 0x0000000000000000000000000000000000000001',
      'borrow-ethereum-sepolia': 'borrow 0.001 WBTC from Aave on Ethereum Sepolia beneficiary 0x0000000000000000000000000000000000000001',
      'repay-base-sepolia': 'repay 1 USDC to Aave on Base Sepolia beneficiary 0x0000000000000000000000000000000000000001',
      'repay-ethereum-sepolia': 'repay 0.001 WBTC to Aave on Ethereum Sepolia beneficiary 0x0000000000000000000000000000000000000001',
      'withdraw-base-sepolia': 'withdraw 1 USDC from Aave on Base Sepolia',
      'withdraw-ethereum-sepolia': 'withdraw 0.001 WBTC from Aave on Ethereum Sepolia',
      'add-liquidity-base-sepolia': 'add liquidity 10 USDC and 0.005 WETH ticks 189960 to 200040 on Base Sepolia slippage 100 bps',
      'add-liquidity-ethereum-sepolia': 'add liquidity 10 USDC and 0.005 WETH ticks 189960 to 200040 on Ethereum Sepolia slippage 100 bps',
      'add-liquidity-solana-devnet': 'add liquidity 0.01 SOL and 0.3 devUSDC ticks -29952 to -25600 on Solana Devnet slippage 100 bps',
      'lending-composition-base-sepolia': 'compose supply 10 USDC to Aave then borrow 2 USDC then swap borrowed USDC to WETH on Base Sepolia slippage 50 bps owner 0x0000000000000000000000000000000000000001',
    };
    expect(Object.keys(sentences).sort()).toEqual(STRATEGY_EXAMPLES.map(e => e.id).sort());
    for (const example of STRATEGY_EXAMPLES) {
      const c = composed(example.strategy);
      expect(JSON.stringify(c.workflow), example.id).toBe(JSON.stringify(dappChat(sentences[example.id]!)));
    }
  });

  it('is deterministic: the same spec (and its normalized form) yields the same IR and hash', () => {
    for (const example of STRATEGY_EXAMPLES) {
      const a = composed(example.strategy), b = composed(structuredClone(example.strategy)), n = composed(a.strategy);
      expect(b.workflowHash).toBe(a.workflowHash);
      expect(n.workflowHash).toBe(a.workflowHash);
      expect(JSON.stringify(n.workflow)).toBe(JSON.stringify(a.workflow));
    }
    // Address case never changes the IR.
    const lower = composed({ action: 'supply', network: 'base-sepolia', asset: 'USDC', amount: '1', beneficiary: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' });
    const upper = composed({ action: 'supply', network: 'base-sepolia', asset: 'USDC', amount: '1', beneficiary: '0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD' });
    expect(upper.workflowHash).toBe(lower.workflowHash);
  });

  it('fails closed on unsupported combinations instead of guessing', () => {
    const bridge = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5' };
    expect(refused({ ...bridge, destinationNetwork: 'arbitrum-one' }).code).toBe('ROUTER_PAIR_UNSUPPORTED');
    expect(refused({ ...bridge, amount: '50' }).code).toMatch(/AMOUNT/);
    expect(refused({ ...bridge, amount: '0' }).code).toMatch(/AMOUNT/);
    expect(refused({ ...bridge, slippageBps: 0 }).code).toBe('ROUTER_SLIPPAGE_OUT_OF_RANGE');
    expect(refused({ ...bridge, slippageBps: 5000 }).code).toMatch(/SLIPPAGE/);
    expect(refused({ ...bridge, recipient: '0x0000000000000000000000000000000000000000' }).code).toBe('ROUTER_RECIPIENT_INVALID');
    expect(refused({ action: 'supply', network: 'ethereum-sepolia', asset: 'USDC', amount: '1', beneficiary: OWNER }).code).toBe('SUPPLY_DEPLOYMENT_UNSUPPORTED');
    expect(refused({ action: 'supply', network: 'base-sepolia', asset: 'USDC', amount: '1', beneficiary: '0x0000000000000000000000000000000000000000' }).code).toMatch(/INVALID/);
    expect(refused({ action: 'swap', network: 'base-sepolia', inputAsset: 'SOL', outputAsset: 'WETH', amount: '1' }).code).toBe('SWAP_ASSET_PAIR_UNSUPPORTED');
    expect(refused({ action: 'swap', network: 'base-sepolia', inputAsset: 'USDC', outputAsset: 'USDC', amount: '1' }).code).toBe('INVALID_ASSET_PAIR');
    expect(refused({ action: 'swap', network: 'solana', inputAsset: 'devUSDC', outputAsset: 'SOL', amount: '1' }).code).toBe('SOLANA_MINT_UNSUPPORTED');
    expect(refused({ action: 'swap', network: 'base-sepolia', inputAsset: 'USDC', outputAsset: 'WETH', amount: '1.1234567' }).code).toBe('AMOUNT_PRECISION');
    expect(refused({ action: 'add_liquidity', network: 'base-sepolia', maxAmounts: { SOL: '1', devUSDC: '1' }, range: { unit: 'tick', lower: '0', upper: '10' } }).code)
      .toBe('LIQUIDITY_ASSET_PAIR_UNSUPPORTED');
    expect(refused({ action: 'add_liquidity', network: 'base-sepolia', maxAmounts: { USDC: '1', WETH: '0.001' }, range: { unit: 'tick', lower: '10', upper: '5' } }).code)
      .toBe('UNISWAP_LIQUIDITY_RANGE_INVALID');
    expect(refused({ action: 'lending_composition', network: 'base-sepolia', asset: 'USDC', supplyAmount: '10', borrowAmount: '2', outputAsset: 'WETH', owner: OWNER,
      slippageBps: 1000 }).code).toBe('LENDING_INPUT_INVALID');
  });

  it('rejects malformed, extended or injected input by schema, without echoing values', () => {
    const base = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5' };
    const key = '0x' + 'ab'.repeat(32), words = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima';
    const cases: [unknown, string][] = [
      [{ ...base, amount: '1e3' }, '/amount'], [{ ...base, amount: '-5' }, '/amount'], [{ ...base, amount: 5 }, '/amount'],
      [{ ...base, sourceNetwork: 'optimism' }, '/sourceNetwork'], [{ ...base, asset: 'ETH' }, '/asset'],
      [{ ...base, calldata: '0xa9059cbb' }, '/calldata'], [{ ...base, to: OWNER, data: '0x' }, '/to'], [{ ...base, chainId: 'eip155:1' }, '/chainId'],
      [{ ...base, privateKey: key }, '/privateKey'], [{ ...base, mnemonic: words }, '/mnemonic'], [{ ...base, [key]: 1 }, '/'],
      [{ ...base, recipient: key }, '/recipient'], [{ ...base, version: 2 }, '/version'],
      [{ action: 'send_transaction', to: OWNER, data: '0x' }, '/action'], [{ action: 'sign', message: words }, '/action'],
      [null, '/action'], ['bridge 5 USDC', '/action'], [[base], '/action'],
    ];
    for (const [input, path] of cases) {
      const result = refused(input);
      expect(result.code).toBe('STRATEGY_SCHEMA_INVALID');
      expect(result.issues.some(issue => issue.path.startsWith(path)), JSON.stringify(result.issues)).toBe(true);
      const echoed = JSON.stringify(result);
      expect(echoed).not.toContain(key);
      expect(echoed).not.toContain('alpha bravo');
      expect(echoed).not.toContain('1e3');
    }
  });

  it('binds later calls to the composed hash: a changed strategy is a conflict, never a silent replacement', () => {
    const spec: StrategySpec = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5' };
    const first = composed(spec);
    expect(composeBound(spec, first.workflowHash)).toMatchObject({ ok: true, workflowHash: first.workflowHash });
    expect(composeBound({ ...spec, amount: '4' }, first.workflowHash)).toEqual({ ok: false, code: 'STRATEGY_WORKFLOW_HASH_MISMATCH', issues: [] });
    expect(composeBound({ ...spec, recipient: OWNER }, first.workflowHash)).toMatchObject({ ok: false, code: 'STRATEGY_WORKFLOW_HASH_MISMATCH' });
    expect(composeBound(spec, undefined).ok).toBe(true);
  });

  it('reviews deterministically and never approves', () => {
    const testnet = reviewComposition(composed(STRATEGY_EXAMPLES[0]!.strategy));
    expect(testnet.environment).toBe('PUBLIC_TESTNET');
    expect(testnet.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: 'BLOCK', code: 'ROUTER_ROUTE_REQUIRED', source: 'LINTER' }),
      expect.objectContaining({ level: 'INFORMATION', code: 'WALLET_NOT_CONNECTED', source: 'CAPABILITY' }),
      expect.objectContaining({ level: 'INFORMATION', code: 'OWNER_APPROVAL_REQUIRED' })]));
    expect(testnet.capability).toMatchObject({ executionImplementedForOwnerWallet: true, evidenceCeiling: null });
    const mainnet = reviewComposition(composed({ action: 'bridge', sourceNetwork: 'base', destinationNetwork: 'arbitrum-one', asset: 'USDC', amount: '5', recipient: OWNER }));
    expect(mainnet.findings.map(f => f.code)).toEqual(expect.arrayContaining(['REAL_FUNDS', 'EXPLICIT_RECIPIENT']));
    // Base mainnet Uniswap is a local-fork capability only: no public execution is claimed.
    const swap = reviewComposition(composed({ action: 'swap', network: 'base', inputAsset: 'USDC', outputAsset: 'WETH', amount: '2' }));
    expect(swap.findings).toEqual(expect.arrayContaining([expect.objectContaining({ level: 'BLOCK', code: 'MAINNET_EXECUTION_NOT_ENABLED' })]));
    expect(swap.capability.executionImplementedForOwnerWallet).toBe(false);
    const lending = reviewComposition(composed(STRATEGY_EXAMPLES.find(e => e.id === 'lending-composition-base-sepolia')!.strategy));
    expect(lending.findings.map(f => f.code)).toContain('DEBT_REMAINS');
  });
});
