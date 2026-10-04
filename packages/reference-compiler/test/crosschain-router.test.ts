// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { routeCommitment, type CanonicalRoute, type SemanticWorkflow, createRouterBridgeNode } from '@defi-workflow-engine/workflow-contracts';
import { compileRouterArtifacts, decodeAcrossDeposit, decodeErc20Transfer, decodeFilledRelay, decodeFundsDeposited, decodeLifiAcrossV4, decodeLifiFeeForward,
  decodeRouterApprove, encodeAcrossDeposit, encodeErc20TransferLog, encodeFilledRelayLog, encodeFundsDepositedLog, encodeLifiAcrossV4, encodeRouterApprove,
  lifiAcrossOutput, routerProviderId, ROUTER_SELECTORS, ROUTER_TOPICS } from '../src/crosschain-router.js';

const dir = new URL('../../../apps/reference-dapp/src/server/testdata/router/', import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const lifi = fixture('lifi-quote-across-2026-10-04.json'), across = fixture('across-swap-approval-2026-10-04.json'), logs = fixture('across-logs-2026-10-04.json');
const keccak = (s: string) => '0x' + Buffer.from(keccak_256(new TextEncoder().encode(s))).toString('hex');
const OWNER = '0x1111111111111111111111111111111111111111';

describe('BUILD-ROUTER-001 router ABI', () => {
  it('pins selectors and topics to their Solidity signatures', () => {
    expect(keccak('approve(address,uint256)').slice(0, 10)).toBe(ROUTER_SELECTORS.approve);
    expect(keccak('deposit(bytes32,bytes32,bytes32,bytes32,uint256,uint256,uint256,bytes32,uint32,uint32,uint32,bytes)').slice(0, 10)).toBe(ROUTER_SELECTORS.acrossDeposit);
    const bd = '(bytes32,string,string,address,address,address,uint256,uint256,bool,bool)', v4 = '(bytes32,bytes32,bytes32,bytes32,uint256,uint128,bytes32,uint32,uint32,uint32,bytes)';
    expect(keccak(`swapAndStartBridgeTokensViaAcrossV4(${bd},(address,address,address,address,uint256,bytes,bool)[],${v4})`).slice(0, 10)).toBe(ROUTER_SELECTORS.lifiSwapAndStartAcrossV4);
    expect(keccak(`startBridgeTokensViaAcrossV4(${bd},${v4})`).slice(0, 10)).toBe(ROUTER_SELECTORS.lifiStartAcrossV4);
    expect(keccak('forwardERC20Fees(address,(address,uint256)[])').slice(0, 10)).toBe(ROUTER_SELECTORS.lifiForwardErc20Fees);
    expect(keccak('FundsDeposited(bytes32,bytes32,uint256,uint256,uint256,uint256,uint32,uint32,uint32,bytes32,bytes32,bytes32,bytes)')).toBe(ROUTER_TOPICS.fundsDeposited);
    expect(keccak('FilledRelay(bytes32,bytes32,uint256,uint256,uint256,uint256,uint256,uint32,uint32,bytes32,bytes32,bytes32,bytes32,bytes32,(bytes32,bytes32,uint256,uint8))'))
      .toBe(ROUTER_TOPICS.filledRelay);
  });
  it('decodes the real LI.FI → Across calldata exactly and recomputes the facet output', () => {
    const data = String(lifi.transactionRequest.data).toLowerCase();
    const call = decodeLifiAcrossV4(data);
    expect(call.kind).toBe('SWAP_AND_START');
    expect(call.bridgeData).toMatchObject({ bridge: 'across', integrator: 'flofi', receiver: OWNER, sendingAssetId: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      minAmount: 9_975_000n, destinationChainId: 42161n, hasSourceSwaps: true, hasDestinationCall: false });
    expect(call.bridgeData.transactionId).toBe(lifi.transactionId);
    expect(call.swaps).toHaveLength(1);
    expect(call.swaps[0]).toMatchObject({ callTo: '0xce40449b773a3e6e5e769adb4e567179d4828cbd', fromAmount: 10_000_000n, requiresDeposit: true });
    expect(decodeLifiFeeForward(call.swaps[0]!.callData)).toEqual({ token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      fees: [{ recipient: '0xc06ebbefd94032b85424d51906e2a335efae264b', amount: 25_000n }] });
    expect(call.across).toMatchObject({ receiverAddress: OWNER, refundAddress: OWNER, receivingAssetId: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
      outputAmount: 9_966_227n, message: '0x' });
    expect(lifiAcrossOutput(call.bridgeData.minAmount, call.across.outputAmountMultiplier)).toBe(BigInt(lifi.estimate.toAmountMin));
    expect(encodeLifiAcrossV4(call)).toBe(data);
  });
  it('decodes the real direct Across deposit, including its trailer', () => {
    const data = String(across.swapTx.data).toLowerCase();
    const call = decodeAcrossDeposit(data);
    expect(call).toMatchObject({ depositor: OWNER, recipient: OWNER, inputAmount: 10_000_000n, outputAmount: BigInt(across.minOutputAmount), destinationChainId: 42161n,
      outputToken: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', message: '0x', trailer: '0x73c0de' });
    expect(encodeAcrossDeposit(call)).toBe(data);
  });
  it('rejects non-canonical, oversized, tampered or foreign calldata', () => {
    const data = String(across.swapTx.data).toLowerCase();
    expect(() => decodeAcrossDeposit(data + '00'.repeat(40))).toThrow('ROUTER_CALLDATA_TRAILER_INVALID');
    expect(() => decodeAcrossDeposit(data.replace('ad5425c6', '7b939232'))).toThrow('ROUTER_CALLDATA_FUNCTION_INVALID');
    const nonEvm = data.slice(0, 10) + 'ff' + data.slice(12);
    expect(() => decodeAcrossDeposit(nonEvm)).toThrow('ROUTER_NON_EVM_ADDRESS');
    const lifiData = String(lifi.transactionRequest.data).toLowerCase();
    expect(() => decodeLifiAcrossV4(lifiData + '00')).toThrow();
    expect(() => decodeLifiAcrossV4(lifiData.slice(0, -64))).toThrow();
    expect(decodeRouterApprove(encodeRouterApprove('0x09aea4b2242abc8bb4bb78d537a67a245a7bec64', 5n))).toEqual({ spender: '0x09aea4b2242abc8bb4bb78d537a67a245a7bec64', amount: 5n });
    expect(() => decodeRouterApprove(encodeRouterApprove(OWNER, 5n) + '00')).toThrow();
  });
  it('decodes real FundsDeposited and FilledRelay logs and round-trips encoders used by harnesses', () => {
    const deposited = decodeFundsDeposited(logs.fundsDeposited);
    expect(deposited).toMatchObject({ spokePool: '0x09aea4b2242abc8bb4bb78d537a67a245a7bec64', destinationChainId: 1n, depositId: 0x600179n, message: '0x' });
    expect(encodeFundsDepositedLog(deposited)).toEqual({ address: logs.fundsDeposited.address, topics: logs.fundsDeposited.topics, data: logs.fundsDeposited.data });
    const filled = decodeFilledRelay(logs.filledRelay);
    expect(filled).toMatchObject({ spokePool: '0xe35e9842fceaca96570b734083f4a58e8f7c5f2a', originChainId: 8453n, inputToken: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      outputToken: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', outputAmount: 10_000_000n, updatedOutputAmount: 10_000_000n, fillType: 0 });
    expect(filled.updatedRecipient).toBe(filled.recipient);
    expect(encodeFilledRelayLog(filled)).toEqual({ address: logs.filledRelay.address, topics: logs.filledRelay.topics, data: logs.filledRelay.data });
    const transfer = encodeErc20TransferLog('0xaf88d065e77c8cc2239327c5edb3a432268e5831', OWNER, '0x2222222222222222222222222222222222222222', 7n);
    expect(decodeErc20Transfer(transfer)).toEqual({ token: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', from: OWNER, to: '0x2222222222222222222222222222222222222222', amount: 7n });
    expect(() => decodeFilledRelay({ ...logs.filledRelay, topics: logs.filledRelay.topics.slice(0, 3) })).toThrow('ROUTER_LOG_INVALID');
  });
});

describe('BUILD-ROUTER-001 route-bound artifact chain', () => {
  const node = createRouterBridgeNode('node-002', { sourceChain: 'eip155:8453', destinationChain: 'eip155:42161', inputToken: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    outputToken: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', amount: '10000000', recipient: 'CONNECTED_OWNER', slippageBps: 50, providers: ['across'] });
  const workflow: SemanticWorkflow = { schemaVersion: '1.0.0', workflowId: 'w', revision: 2, nodes: [node], resourceEdges: [] };
  const call = decodeAcrossDeposit(String(across.swapTx.data).toLowerCase());
  const route: CanonicalRoute = { format: 'flofi.route.v1', sourceChain: 'eip155:8453', destinationChain: 'eip155:42161',
    inputToken: { chainId: 'eip155:8453', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6, symbol: 'USDC' },
    outputToken: { chainId: 'eip155:42161', address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', decimals: 6, symbol: 'USDC' },
    inputAmount: '10000000', expectedOutput: '9991223', minimumOutput: '9991223', recipient: OWNER, depositor: OWNER, refundAddress: OWNER, routingProvider: 'across',
    underlyingProtocol: 'across', steps: [{ kind: 'BRIDGE', protocol: 'across', fromChain: 'eip155:8453', toChain: 'eip155:42161', fromToken: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      toToken: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', amountIn: '10000000', amountOut: '9991223' }],
    fees: [{ kind: 'BRIDGE_RELAYER_CAPITAL', label: 'Relayer capital fee', chainId: 'eip155:8453', token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', amount: '1000', recipient: null },
      { kind: 'BRIDGE_DESTINATION_GAS', label: 'Destination gas fee', chainId: 'eip155:8453', token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', amount: '7777', recipient: null }],
    feeTotal: '8777', slippageBps: 50, approval: { token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', spender: '0x09aea4b2242abc8bb4bb78d537a67a245a7bec64', amount: '10000000' },
    deposit: { purpose: 'BRIDGE_DEPOSIT', chainId: 'eip155:8453', to: '0x09aea4b2242abc8bb4bb78d537a67a245a7bec64', data: String(across.swapTx.data).toLowerCase(), value: '0x0' },
    bridge: { protocol: 'across', originSpokePool: '0x09aea4b2242abc8bb4bb78d537a67a245a7bec64', destinationSpokePool: '0xe35e9842fceaca96570b734083f4a58e8f7c5f2a',
      depositor: OWNER, recipient: OWNER, inputToken: call.inputToken, outputToken: call.outputToken, inputAmount: '10000000', outputAmount: '9991223', destinationChainId: 42161,
      exclusiveRelayer: call.exclusiveRelayer, quoteTimestamp: call.quoteTimestamp, fillDeadline: call.fillDeadline, exclusivityParameter: call.exclusivityParameter, message: '0x' },
    quote: { id: String(across.id), rawHash: '0x' + '12'.repeat(32), quotedAt: '2026-10-04T16:57:55.000Z', expiresAt: '2026-10-04T17:54:35.000Z',
      estimatedDurationSeconds: 2, providerGasEstimate: null } };
  const input = (r: CanonicalRoute) => ({ workflow, nodeId: 'node-002', route: r, routeCommitment: routeCommitment(r), owner: OWNER,
    calls: [{ purpose: 'APPROVAL' as const, to: r.approval.token, data: encodeRouterApprove(r.approval.spender, BigInt(r.approval.amount)) },
      { purpose: 'BRIDGE_DEPOSIT' as const, to: r.deposit.to, data: r.deposit.data }],
    simulation: { block: 52_170_200, observedAt: '2026-10-04T16:58:00.000Z', gasLimitTotal: '300000', executionFeeUpperBoundWei: '3000000000000', depositId: null },
    expiresAt: '2026-10-04T17:01:00.000Z' });
  it('compiles valid frozen-v1 artifacts whose Manifest binds the route commitment and FIXED provider', () => {
    const out = compileRouterArtifacts(input(route));
    expect(out.quote.normalizedValues.find(v => v.name === 'route-commitment')).toEqual({ name: 'route-commitment', kind: 'IDENTIFIER', value: routeCommitment(route) });
    expect(out.manifest.providers).toEqual({ kind: 'FIXED', providerId: 'across:across' });
    expect(routerProviderId({ routingProvider: 'lifi', underlyingProtocol: 'across' })).toBe('lifi:across');
    expect(out.manifest.artifactSetHash).toBe(out.hashes.artifactSet);
    expect(out.plan.segments[0]!.steps.map(s => s.stepId)).toEqual(['router.step.approval', 'router.step.deposit']);
    expect(out.policy.allowlists.recipients).toEqual([{ chainId: 'eip155:42161', address: OWNER }]);
  });
  it('any route mutation changes the Manifest hash', () => {
    const base = compileRouterArtifacts(input(route)).hashes.manifest;
    const other = { ...route, recipient: '0x2222222222222222222222222222222222222222', bridge: { ...route.bridge, recipient: '0x2222222222222222222222222222222222222222' } };
    expect(compileRouterArtifacts(input(other)).hashes.manifest).not.toBe(base);
    expect(compileRouterArtifacts(input({ ...route, routingProvider: 'lifi' })).hashes.manifest).not.toBe(base);
    expect(compileRouterArtifacts(input({ ...route, deposit: { ...route.deposit, data: route.deposit.data.slice(0, -2) + '00' } })).hashes.manifest).not.toBe(base);
  });
});
