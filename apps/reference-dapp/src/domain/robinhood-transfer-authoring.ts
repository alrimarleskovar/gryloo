// SPDX-License-Identifier: AGPL-3.0-only
import { createNativeTransferNode, readNativeTransferNode, TRANSFER_ACTION, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { ROBINHOOD_TESTNET_TRANSFER as profile } from '@defi-workflow-engine/action-registry';
export type RobinhoodTransferInput = { network: 'Robinhood Chain Testnet'; asset: 'ETH'; amount: string; recipient: 'CONNECTED_OWNER' };
const WEI = 10n ** 18n;
/** Exact decimal ETH to wei; at most 18 decimals and never above the test cap. */
export function parseTransferAmount(value: string): string {
  if (typeof value !== 'string' || value.length > 40 || !/^(0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(value)) throw new Error('TRANSFER_AMOUNT_INVALID');
  const [whole, fraction = ''] = value.split('.');
  const wei = BigInt(whole!) * WEI + BigInt(fraction.padEnd(18, '0'));
  if (wei <= 0n || wei > BigInt(profile.maximumValueWei)) throw new Error('TRANSFER_AMOUNT_INVALID');
  return wei.toString();
}
export function formatEth(wei: string | bigint): string {
  const value = BigInt(wei), sign = value < 0n ? '-' : '', abs = value < 0n ? -value : value;
  const fraction = (abs % WEI).toString().padStart(18, '0').replace(/0+$/, '');
  return `${sign}${abs / WEI}${fraction ? '.' + fraction : ''}`;
}
export function createAuthoredTransfer(nodeId: string, input: RobinhoodTransferInput): SemanticWorkflow['nodes'][number] {
  if (input.network !== 'Robinhood Chain Testnet' || input.asset !== 'ETH' || input.recipient !== 'CONNECTED_OWNER') throw new Error('TRANSFER_PROFILE_UNSUPPORTED');
  return createNativeTransferNode(nodeId, { chain: profile.chain, amount: parseTransferAmount(input.amount), recipient: 'CONNECTED_OWNER' });
}
export function transferDetails(node: SemanticWorkflow['nodes'][number]): RobinhoodTransferInput | null {
  if (node.actionType !== TRANSFER_ACTION) return null;
  try {
    const fields = readNativeTransferNode(node);
    return fields.chain === profile.chain ? { network: 'Robinhood Chain Testnet', asset: 'ETH', amount: formatEth(fields.amount), recipient: 'CONNECTED_OWNER' } : null;
  } catch { return null; }
}
