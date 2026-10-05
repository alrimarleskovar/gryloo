// SPDX-License-Identifier: AGPL-3.0-only
import { createNativeTransferNode, readNativeTransferNode, TRANSFER_ACTION, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { ETHEREUM_SEPOLIA_TRANSFER, ROBINHOOD_TESTNET_TRANSFER, type NativeTransferProfile } from '@defi-workflow-engine/action-registry';
/** The native test-ETH self-transfer networks: RH-DEMO-001 Robinhood Testnet and BUILD-ETHEREUM-001 Ethereum Sepolia. */
export type TransferNetwork = 'Robinhood Chain Testnet' | 'Ethereum Sepolia';
export type RobinhoodTransferInput = { network: TransferNetwork; asset: 'ETH'; amount: string; recipient: 'CONNECTED_OWNER' };
export const TRANSFER_NETWORKS: Readonly<Record<TransferNetwork, NativeTransferProfile>> = Object.freeze({
  'Robinhood Chain Testnet': ROBINHOOD_TESTNET_TRANSFER, 'Ethereum Sepolia': ETHEREUM_SEPOLIA_TRANSFER });
const WEI = 10n ** 18n;
/** Exact decimal ETH to wei; at most 18 decimals and never above the profile's test cap. */
export function parseTransferAmount(value: string, profile: NativeTransferProfile = ROBINHOOD_TESTNET_TRANSFER): string {
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
/** The transfer profile of a network name; any other name (Mainnet included) is unsupported. */
export function transferProfileFor(network: string): NativeTransferProfile {
  const profile = Object.hasOwn(TRANSFER_NETWORKS, network) ? TRANSFER_NETWORKS[network as TransferNetwork] : undefined;
  if (!profile) throw new Error('TRANSFER_PROFILE_UNSUPPORTED');
  return profile;
}
export function createAuthoredTransfer(nodeId: string, input: RobinhoodTransferInput): SemanticWorkflow['nodes'][number] {
  if (input.asset !== 'ETH' || input.recipient !== 'CONNECTED_OWNER') throw new Error('TRANSFER_PROFILE_UNSUPPORTED');
  const profile = transferProfileFor(input.network);
  return createNativeTransferNode(nodeId, { chain: profile.chain, amount: parseTransferAmount(input.amount, profile), recipient: 'CONNECTED_OWNER' });
}
export function transferDetails(node: SemanticWorkflow['nodes'][number]): RobinhoodTransferInput | null {
  if (node.actionType !== TRANSFER_ACTION) return null;
  try {
    const fields = readNativeTransferNode(node);
    const network = (Object.keys(TRANSFER_NETWORKS) as TransferNetwork[]).find(name => TRANSFER_NETWORKS[name].chain === fields.chain);
    return network ? { network, asset: 'ETH', amount: formatEth(fields.amount), recipient: 'CONNECTED_OWNER' } : null;
  } catch { return null; }
}
/** Canvas card text: "0.000001 ETH · Robinhood Testnet" / "… · Ethereum Sepolia". Display only. */
export function transferCardLabel(node: SemanticWorkflow['nodes'][number]): string {
  const details = transferDetails(node);
  return details ? `${details.amount} ETH · ${details.network === 'Robinhood Chain Testnet' ? 'Robinhood Testnet' : details.network}` : '';
}
