// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { createBorrowNode, createLendingCompositionWorkflow, createNativeTransferNode, createSupplyNode, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { AAVE_V3_BASE_SEPOLIA, AAVE_V3_ETHEREUM_SEPOLIA, AAVE_V3_LENDING_PROFILES, ETHEREUM_MAINNET, ETHEREUM_SEPOLIA, ETHEREUM_SEPOLIA_ASSETS,
  ETHEREUM_SEPOLIA_TRANSFER, NATIVE_TRANSFER_PROFILES, ROBINHOOD_TESTNET_TRANSFER, aaveLendingProfile, assertAaveLendingProfile, baseAssetRegistry,
  ethereumSepoliaAddChainParameters, executionCapabilityRegistry, nativeTransferProfile, resolveWorkflowCapability, LENDING_BASE_SEPOLIA } from '../src/index.js';

const ETH = 'eip155:11155111';
const flow = (node: SemanticWorkflow['nodes'][number]): SemanticWorkflow => ({ schemaVersion: '1.0.0', workflowId: 'eth', revision: 0, nodes: [node], resourceEdges: [] });
const wbtc = { chainId: ETH, address: AAVE_V3_ETHEREUM_SEPOLIA.asset, decimals: 8 };
const owner = '0x1111111111111111111111111111111111111111';

describe('Ethereum Sepolia network identity', () => {
  it('is CAIP-2 eip155:11155111, chain 11155111 = 0xaa36a7, native ETH, Etherscan Sepolia, a public testnet', () => {
    expect(ETHEREUM_SEPOLIA).toMatchObject({ name: 'Ethereum Sepolia', chain: ETH, chainId: 11155111, chainHex: '0xaa36a7', environment: 'PUBLIC_TESTNET',
      nativeCurrency: { symbol: 'ETH', decimals: 18 }, explorer: 'https://sepolia.etherscan.io' });
    expect(BigInt(ETHEREUM_SEPOLIA.chainHex)).toBe(BigInt(ETHEREUM_SEPOLIA.chainId));
    expect(ETHEREUM_SEPOLIA.chain).toBe(`eip155:${ETHEREUM_SEPOLIA.chainId}`);
    expect(ETHEREUM_SEPOLIA.rpc.startsWith('https://')).toBe(true);
    expect(Object.isFrozen(ETHEREUM_SEPOLIA)).toBe(true);
  });
  it('adds the chain only from the official record (EIP-3085 shape, no key in the URL)', () => {
    expect(ethereumSepoliaAddChainParameters()).toEqual({ chainId: '0xaa36a7', chainName: 'Ethereum Sepolia',
      nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [ETHEREUM_SEPOLIA.rpc], blockExplorerUrls: ['https://sepolia.etherscan.io'] });
    expect(ETHEREUM_SEPOLIA.rpc).not.toMatch(/key|token|\/v[23]\//i);
  });
  it('recognises Ethereum Mainnet as a distinct, non-executable network', () => {
    expect(ETHEREUM_MAINNET).toMatchObject({ chain: 'eip155:1', chainHex: '0x1', environment: 'MAINNET', executable: false });
    expect(ETHEREUM_MAINNET.chain).not.toBe(ETHEREUM_SEPOLIA.chain);
  });
});

describe('Ethereum Sepolia assets', () => {
  it('carry the chain, a verified address and decimals; symbols never collide into Base identities', () => {
    expect(ETHEREUM_SEPOLIA_ASSETS.USDC).toMatchObject({ chain: ETH, address: '0x94a9d9ac8a22534e3faca9f4e7f2e2cf85d5e4c8', decimals: 6 });
    expect(ETHEREUM_SEPOLIA_ASSETS.WETH).toMatchObject({ chain: ETH, address: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14', decimals: 18 });
    expect(ETHEREUM_SEPOLIA_ASSETS.WBTC).toMatchObject({ chain: ETH, address: '0x29f2d40b0605204364af54ec677bd022da425d03', decimals: 8 });
    for (const symbol of ['USDC', 'WETH'] as const) {
      expect(ETHEREUM_SEPOLIA_ASSETS[symbol].address).not.toBe(baseAssetRegistry[symbol].asset.address);
      expect(ETHEREUM_SEPOLIA_ASSETS[symbol].chain).not.toBe(baseAssetRegistry[symbol].asset.chainId);
    }
    expect(ETHEREUM_SEPOLIA_ASSETS.WETH.address).not.toBe(LENDING_BASE_SEPOLIA.weth);
    for (const item of Object.values(ETHEREUM_SEPOLIA_ASSETS)) expect(item.address).toMatch(/^0x[0-9a-f]{40}$/);
  });
});

describe('Aave V3 lending profiles', () => {
  it('select by CAIP-2 chain: Base Sepolia USDC (reserve 0) and Ethereum Sepolia WBTC (reserve 3, 8 decimals)', () => {
    expect(AAVE_V3_LENDING_PROFILES).toEqual([AAVE_V3_BASE_SEPOLIA, AAVE_V3_ETHEREUM_SEPOLIA]);
    expect(aaveLendingProfile('eip155:84532')).toBe(AAVE_V3_BASE_SEPOLIA);
    expect(aaveLendingProfile(ETH)).toBe(AAVE_V3_ETHEREUM_SEPOLIA);
    expect(AAVE_V3_BASE_SEPOLIA).toMatchObject({ reserveId: 0, decimals: 6, symbol: 'USDC', l1DataFee: true });
    expect(AAVE_V3_ETHEREUM_SEPOLIA).toMatchObject({ chainId: 11155111, chainHex: '0xaa36a7', reserveId: 3, decimals: 8, symbol: 'WBTC', l1DataFee: false,
      pool: '0x6ae43d3271ff6888e7fc43fd7321a503ff738951', provider: '0x012bac54348c0e635dcac9d5fb99f06f24136c9a',
      aToken: '0x1804bf30507dc2eb3bdebbbdd859991eaef6eeff', variableDebtToken: '0xeb016dfd303f19fbddfb6300eb4aeb2da7ceac37',
      oracle: '0x2da88497588bf89281816106c7259e31af45a663' });
    expect(AAVE_V3_ETHEREUM_SEPOLIA.asset).toBe(ETHEREUM_SEPOLIA_ASSETS.WBTC.address);
  });
  it('refuses Mainnet, unknown chains and look-alike profile objects', () => {
    for (const chain of ['eip155:1', 'eip155:8453', 'eip155:11155112', '']) expect(() => aaveLendingProfile(chain)).toThrow('AAVE_PROFILE_UNSUPPORTED');
    expect(() => assertAaveLendingProfile({ ...AAVE_V3_ETHEREUM_SEPOLIA })).toThrow('AAVE_PROFILE_UNSUPPORTED');
    expect(assertAaveLendingProfile(AAVE_V3_ETHEREUM_SEPOLIA)).toBe(AAVE_V3_ETHEREUM_SEPOLIA);
  });
  it('native transfer profiles cover Robinhood Testnet and Ethereum Sepolia only', () => {
    expect(NATIVE_TRANSFER_PROFILES).toEqual([ROBINHOOD_TESTNET_TRANSFER, ETHEREUM_SEPOLIA_TRANSFER]);
    expect(nativeTransferProfile(ETH)).toMatchObject({ chainHex: '0xaa36a7', settlement: 'L1', minimumConfirmations: 3, adapterId: 'evm.native-transfer' });
    expect(nativeTransferProfile('eip155:46630')).toMatchObject({ settlement: 'L2' });
    expect(() => nativeTransferProfile('eip155:1')).toThrow('TRANSFER_NETWORK_UNSUPPORTED');
  });
});

describe('Ethereum Sepolia capability registry', () => {
  it('lists only the implemented actions, on PUBLIC_TESTNET, owner wallet, with no demonstrated evidence', () => {
    const rows = executionCapabilityRegistry.filter(row => row.chainId === ETH);
    expect(rows.map(row => `${row.actionType}:${row.adapterId}`).sort()).toEqual(
      ['asset.swap.exact-input:uniswap.v3', 'asset.transfer:evm.native-transfer', 'borrow:aave-v3', 'repay:aave-v3', 'supply:aave-v3', 'withdraw:aave-v3']);
    for (const row of rows) {
      expect(row).toMatchObject({ environment: 'PUBLIC_TESTNET', evidenceMaturity: null, authorizationModes: ['A'], executionKind: 'DIRECT_TRANSACTION' });
      expect(row.requirements).toContain('INJECTED_WALLET');
      expect(row.requirements).toContain('REVIEWED_ARTIFACTS');
    }
  });
  it('has no Ethereum Mainnet row of any kind', () => {
    expect(executionCapabilityRegistry.filter(row => row.chainId === 'eip155:1')).toEqual([]);
    const mainnet = resolveWorkflowCapability(flow(createSupplyNode('s', { chain: 'eip155:1', asset: { ...wbtc, chainId: 'eip155:1' }, amount: '1', beneficiary: owner })),
      { environment: 'MAINNET' });
    expect(mainnet.executionSupported).toBe(false);
    expect(mainnet.blockers[0]).toMatchObject({ code: 'CHAIN_NOT_SUPPORTED' });
  });
  it('supports Supply and the native transfer on Ethereum Sepolia only with the owner wallet on that chain', () => {
    const supply = flow(createSupplyNode('s', { chain: ETH, asset: wbtc, amount: '100000', beneficiary: owner }));
    const ready = { walletConnected: true, artifacts: 'CURRENT' as const, simulationReady: true, authorizationReady: true };
    const on = resolveWorkflowCapability(supply, { environment: 'PUBLIC_TESTNET', runtime: { ...ready, walletChainId: ETH } });
    expect(on).toMatchObject({ executionSupported: true, executionReady: true, evidenceCeiling: null });
    for (const walletChainId of ['eip155:84532', 'eip155:1', null]) {
      const off = resolveWorkflowCapability(supply, { environment: 'PUBLIC_TESTNET', runtime: { ...ready, walletChainId } });
      expect(off.executionReady).toBe(false);
      expect(off.blockers.map(blocker => blocker.code)).toContain('WRONG_WALLET_CHAIN');
    }
    const transfer = flow(createNativeTransferNode('t', { chain: ETH, amount: '1000000000000', recipient: 'CONNECTED_OWNER' }));
    expect(resolveWorkflowCapability(transfer, { environment: 'PUBLIC_TESTNET', runtime: { ...ready, walletChainId: ETH } }).executionReady).toBe(true);
    expect(resolveWorkflowCapability(supply, { environment: 'MAINNET' }).executionSupported).toBe(false);
    const borrow = flow(createBorrowNode('b', { chain: ETH, asset: wbtc, amount: '1000', beneficiary: owner, interestRateMode: 2 }));
    expect(resolveWorkflowCapability(borrow, { environment: 'PUBLIC_TESTNET', runtime: { ...ready, artifacts: 'STALE', walletChainId: ETH } }).blockers.map(b => b.code))
      .toContain('ARTIFACTS_STALE');
  });
  it('keeps Supply → Borrow → Swap blocked on Ethereum Sepolia', () => {
    const composition = createLendingCompositionWorkflow('eth-composition', 0, { chain: ETH, collateral: wbtc, borrowed: wbtc,
      output: { chainId: ETH, address: ETHEREUM_SEPOLIA_ASSETS.WETH.address, decimals: 18 }, supplyAmount: '100000', borrowAmount: '1000', slippageBps: 50, owner });
    // Even with every runtime flag set, the exact Base Sepolia composition profile does not match: execution stays unavailable.
    const result = resolveWorkflowCapability(composition, { environment: 'PUBLIC_TESTNET', runtime: { lendingCompositionViable: true, walletConnected: true,
      walletChainId: ETH, artifacts: 'CURRENT', simulationReady: true, authorizationReady: true } });
    expect(result.executionReady).toBe(false);
    expect(result.blockers.map(blocker => blocker.code)).toContain('RUNTIME_UNAVAILABLE');
  });
});
