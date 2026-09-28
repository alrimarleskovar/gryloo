import { Type, type Static } from '@sinclair/typebox';

export const BRIDGE_SOURCE = 'eip155:8453';
export const BRIDGE_DESTINATION = 'eip155:10';
export const BRIDGE_SOURCE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
export const BRIDGE_DESTINATION_USDC = '0x0b2c639c533813f4aa9d7837caf62653d097ff85';
export const BRIDGE_ACTION = 'asset.bridge';
export const BridgeStateSchema = Type.Union([
  Type.Literal('NOT_SENT'), Type.Literal('SOURCE_SUBMITTED'), Type.Literal('SOURCE_CONFIRMED'),
  Type.Literal('BRIDGE_IN_PROGRESS'), Type.Literal('DESTINATION_CONFIRMED'), Type.Literal('RECONCILED'),
  Type.Literal('FAILED'), Type.Literal('UNKNOWN'),
]);
export type BridgeState = Static<typeof BridgeStateSchema>;
export type BridgeEvent = {
  readonly sequence: number; readonly at: string; readonly state: BridgeState;
  readonly sourceChainId: typeof BRIDGE_SOURCE; readonly destinationChainId: typeof BRIDGE_DESTINATION;
  readonly step: 'approval' | 'source' | 'bridge' | 'destination';
  readonly transactionHash: string | null;
  readonly note: string;
};
export type BridgeJournal = {
  readonly format: 'gryloo.bridge-journal.v1'; readonly executionId: string;
  readonly workflowHash: string; readonly manifestHash: string; readonly quoteHash: string;
  readonly events: readonly BridgeEvent[];
};
export function validateBridgeJournal(value: BridgeJournal): BridgeJournal {
  if (value.format !== 'gryloo.bridge-journal.v1' || !/^bridge-[0-9a-f]{24}$/.test(value.executionId)
      || ![value.workflowHash, value.manifestHash, value.quoteHash].every(x => /^0x[0-9a-f]{64}$/.test(x)))
    throw new Error('BRIDGE_JOURNAL_INVALID');
  const transitions: Record<BridgeState, readonly BridgeState[]> = {
    NOT_SENT: ['NOT_SENT', 'SOURCE_SUBMITTED', 'UNKNOWN', 'FAILED'],
    SOURCE_SUBMITTED: ['SOURCE_CONFIRMED', 'FAILED'],
    SOURCE_CONFIRMED: ['BRIDGE_IN_PROGRESS', 'FAILED'],
    BRIDGE_IN_PROGRESS: ['DESTINATION_CONFIRMED', 'FAILED'],
    DESTINATION_CONFIRMED: ['RECONCILED', 'FAILED'],
    RECONCILED: [], FAILED: [], UNKNOWN: ['SOURCE_SUBMITTED', 'FAILED'],
  };
  value.events.forEach((event, index) => {
    if ((index === 0 && event.state !== 'NOT_SENT')
        || (index > 0 && !transitions[value.events[index - 1]!.state].includes(event.state))
        || (['SOURCE_SUBMITTED', 'SOURCE_CONFIRMED', 'DESTINATION_CONFIRMED', 'RECONCILED'].includes(event.state) && event.transactionHash === null)
        || event.sequence !== index || event.sourceChainId !== BRIDGE_SOURCE || event.destinationChainId !== BRIDGE_DESTINATION
        || !['approval', 'source', 'bridge', 'destination'].includes(event.step)
        || !['NOT_SENT', 'SOURCE_SUBMITTED', 'SOURCE_CONFIRMED', 'BRIDGE_IN_PROGRESS', 'DESTINATION_CONFIRMED', 'RECONCILED', 'FAILED', 'UNKNOWN'].includes(event.state)
        || (event.transactionHash !== null && !/^0x[0-9a-f]{64}$/.test(event.transactionHash))
        || !Number.isFinite(Date.parse(event.at)) || event.note.length > 256) throw new Error('BRIDGE_JOURNAL_INVALID');
  });
  return value;
}
