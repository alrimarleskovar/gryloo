// SPDX-License-Identifier: Apache-2.0
import type { SemanticWorkflow } from './semantic-workflow.js';
import type { Asset } from './common.js';

/** The one canonical exact-input swap action. Chain and provider never change its semantic shape. */
export const EXACT_INPUT_SWAP_ACTION = 'asset.swap.exact-input';
export type ExactInputSwapNode = SemanticWorkflow['nodes'][number];
export type TokenAsset = Extract<Asset, { address: string }>;
export type ExactInputSwapFields = {
  chain: string; input: TokenAsset; output: TokenAsset; amount: string; slippageBps: number;
  protocols: readonly string[]; maximumAmount: string;
};

const sameAsset = (a: unknown, b: TokenAsset) => !!a && typeof a === 'object' && 'address' in a &&
  (a as TokenAsset).chainId === b.chainId && (a as TokenAsset).address === b.address && (a as TokenAsset).decimals === b.decimals;

/** Build the canonical swap node. EVM and Solana swaps differ only in chain, asset identity and protocol constraint. */
export function createExactInputSwapNode(nodeId: string, fields: ExactInputSwapFields): ExactInputSwapNode {
  const { chain, input, output, amount, slippageBps, protocols, maximumAmount } = fields;
  if (!/^[a-z][a-z0-9-]*:[A-Za-z0-9._-]+$/.test(chain) || input.chainId !== chain || output.chainId !== chain ||
      input.address === output.address || !/^[1-9][0-9]{0,77}$/.test(amount) || !/^[1-9][0-9]{0,77}$/.test(maximumAmount) ||
      BigInt(amount) > BigInt(maximumAmount) || !Number.isSafeInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000 ||
      protocols.length === 0) throw new Error('SWAP_FIELDS_INVALID');
  return {
    nodeId, actionType: EXACT_INPUT_SWAP_ACTION, actionSchemaVersion: '1.0.0', chainId: chain,
    requiredCapabilities: ['swap.direct-transaction'], adapterConstraints: { adapters: [], protocols: [...protocols] },
    inputs: [{ name: 'amount-in', kind: 'QUANTITY', value: { asset: { ...input }, amount } },
      { name: 'asset-out', kind: 'ASSET', value: { ...output } }],
    expectedOutputs: [{ outputId: 'amount-out', asset: { ...output }, minimumAmount: '0' }],
    dependencies: [],
    userConstraints: [{ kind: 'MAXIMUM_INPUT', quantity: { asset: { ...input }, amount } },
      { kind: 'MAXIMUM_SLIPPAGE_BPS', maximumBps: slippageBps }],
    failurePolicy: 'ABORT', requiredAuthorizationClass: 'MODE_A', lockedParameters: [],
    editableBounds: [{ parameterName: 'amount-in', asset: { ...input }, minimumAmount: '1', maximumAmount }],
  };
}

/** Chain-neutral reader for the canonical swap ports. Provider-specific validation is layered on top. */
export function readExactInputSwap(node: ExactInputSwapNode): ExactInputSwapFields {
  if (node.actionType !== EXACT_INPUT_SWAP_ACTION || node.actionSchemaVersion !== '1.0.0') throw new Error('SWAP_ACTION_INVALID');
  const amount = node.inputs.find(p => p.name === 'amount-in'), out = node.inputs.find(p => p.name === 'asset-out');
  const slippage = node.userConstraints.filter(c => c.kind === 'MAXIMUM_SLIPPAGE_BPS');
  const maximum = node.userConstraints.filter(c => c.kind === 'MAXIMUM_INPUT');
  if (node.inputs.length !== 2 || amount?.kind !== 'QUANTITY' || out?.kind !== 'ASSET' || !('address' in amount.value.asset) ||
      !('address' in out.value) || slippage.length !== 1 || maximum.length !== 1 || node.userConstraints.length !== 2) throw new Error('SWAP_PORTS_INVALID');
  const input = amount.value.asset as TokenAsset, output = out.value as TokenAsset;
  const slip = slippage[0]!, max = maximum[0]!;
  const output0 = node.expectedOutputs[0];
  if (slip.kind !== 'MAXIMUM_SLIPPAGE_BPS' || max.kind !== 'MAXIMUM_INPUT' || !sameAsset(max.quantity.asset, input) ||
      max.quantity.amount !== amount.value.amount || node.expectedOutputs.length !== 1 || output0?.outputId !== 'amount-out' ||
      !sameAsset(output0.asset, output) || input.chainId !== node.chainId || output.chainId !== node.chainId) throw new Error('SWAP_PORTS_INVALID');
  const bound = node.editableBounds[0];
  const maximumAmount = bound?.parameterName === 'amount-in' ? bound.maximumAmount : amount.value.amount;
  return { chain: node.chainId, input: { ...input }, output: { ...output }, amount: amount.value.amount, slippageBps: slip.maximumBps,
    protocols: [...node.adapterConstraints.protocols], maximumAmount };
}
