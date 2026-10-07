// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { AAVE_V3_BASE_SEPOLIA, AAVE_V3_ETHEREUM_SEPOLIA, CROSSCHAIN_ROUTER_BASE_SEPOLIA_ARBITRUM_SEPOLIA } from '@defi-workflow-engine/action-registry';
import { codeCapabilities, supportedAssets, supportedNetworks } from './capability-catalog';

describe('BUILD-MCP-001 discovery derived from registries', () => {
  it('lists networks with registry chain ids and honest fund classes', () => {
    const networks = Object.fromEntries(supportedNetworks().map(n => [n.id, n]));
    expect(networks['base-sepolia']).toMatchObject({ chainId: 'eip155:84532', class: 'TESTNET', funds: 'TEST_FUNDS' });
    expect(networks['arbitrum-sepolia']).toMatchObject({ chainId: CROSSCHAIN_ROUTER_BASE_SEPOLIA_ARBITRUM_SEPOLIA.destination.chain, actions: ['bridge'] });
    expect(networks['base']).toMatchObject({ chainId: 'eip155:8453', class: 'MAINNET', funds: 'REAL_FUNDS' });
    expect(networks['solana-devnet']!.class).toBe('DEVNET');
    expect(networks['ethereum-sepolia']!.actions).toEqual(expect.arrayContaining(['swap', 'supply', 'add_liquidity']));
  });

  it('distinguishes the two Base Sepolia USDC tokens by the actions that use each', () => {
    const usdc = supportedAssets('base-sepolia').filter(a => a.symbol === 'USDC');
    expect(usdc.map(a => a.address).sort()).toEqual([AAVE_V3_BASE_SEPOLIA.asset, '0x036cbd53842c5426634e7929541ec2318f3dcf7e'].sort());
    expect(usdc.find(a => a.address === AAVE_V3_BASE_SEPOLIA.asset)!.actions).toEqual(['borrow', 'lending_composition', 'repay', 'supply', 'withdraw']);
    expect(usdc.find(a => a.address !== AAVE_V3_BASE_SEPOLIA.asset)!.actions).toEqual(['add_liquidity', 'bridge', 'swap']);
    expect(supportedAssets('ethereum-sepolia').find(a => a.symbol === 'WBTC')).toMatchObject({ address: AAVE_V3_ETHEREUM_SEPOLIA.asset, decimals: 8 });
    expect(supportedAssets().every(a => a.sources.length > 0)).toBe(true);
  });

  it('derives code capabilities from the registry on the composed IR, never claiming more than it records', () => {
    const rows = Object.fromEntries(codeCapabilities().map(c => [`${c.action}:${c.network}`, c]));
    // Router testnet: owner execution implemented, nothing demonstrated.
    expect(rows['bridge:base-sepolia']).toMatchObject({ adapters: ['flofi.router'], publicEnvironment: 'PUBLIC_TESTNET', ownerWalletExecutionImplemented: true,
      demonstratedEvidence: null, funds: 'TEST_FUNDS' });
    // The exact Base Sepolia Uniswap swap path is the one with recorded public testnet execution.
    expect(rows['swap:base-sepolia']!.demonstratedEvidence).toBe('TESTNET_EXECUTED');
    // Base mainnet Uniswap swap exists only as MOCK / LOCAL_FORK: no public execution is claimed.
    expect(rows['swap:base']).toMatchObject({ ownerWalletExecutionImplemented: false, demonstratedEvidence: null, funds: 'REAL_FUNDS' });
    expect(rows['swap:base']!.registryEnvironments).toEqual(expect.arrayContaining(['MOCK', 'LOCAL_FORK']));
    expect(rows['swap:base']!.registryEnvironments).not.toContain('MAINNET');
    expect(rows['bridge:base']).toMatchObject({ publicEnvironment: 'MAINNET', funds: 'REAL_FUNDS' });
    for (const row of codeCapabilities()) expect(row.supportedByCode.AUTHOR).toBe(true);
  });
});
