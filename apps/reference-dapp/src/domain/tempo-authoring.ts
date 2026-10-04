// SPDX-License-Identifier: AGPL-3.0-only
import { createTokenPaymentNode, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { TEMPO_PAYMENT as p } from '@defi-workflow-engine/action-registry';
export type TempoInput = { amount: string; recipient: string; memo: string; maximumFee: string };
export const isTempoNode = (n: { adapterConstraints: { adapters: readonly { id: string }[] } }) => n.adapterConstraints.adapters.some(a => a.id === p.adapterId);
export function tempoUnits(value: string): string {
  if (!/^(0|[1-9][0-9]{0,2})(?:\.[0-9]{1,6})?$/.test(value)) throw new Error('TEMPO_AMOUNT_INVALID');
  const [whole, fraction = ''] = value.split('.'); return (BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))).toString();
}
export function createAuthoredTempo(nodeId: string, input: TempoInput): SemanticWorkflow['nodes'][number] {
  const amount = tempoUnits(input.amount), maximumFee = tempoUnits(input.maximumFee);
  if (BigInt(amount) < 1n || BigInt(amount) > BigInt(p.maximumAmount) || BigInt(maximumFee) < 1n || BigInt(maximumFee) > BigInt(p.maximumFee)) throw new Error('TEMPO_AMOUNT_INVALID');
  return createTokenPaymentNode(nodeId, { chain: p.chain, token: p.token, decimals: 6, adapterId: p.adapterId,
    feeToken: p.token, amount, maximumFee, recipient: input.recipient.toLowerCase(), memo: input.memo.toLowerCase() });
}
