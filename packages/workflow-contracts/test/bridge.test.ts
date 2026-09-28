import { describe, expect, it } from 'vitest';
import { BRIDGE_SOURCE, BRIDGE_DESTINATION, validateBridgeJournal } from '../src/bridge.js';
describe('bridge journal projection', () => {
  it('requires explicit chain-specific ordered states', () => {
    const hash = '0x' + 'a'.repeat(64);
    const journal = { format: 'gryloo.bridge-journal.v1' as const, executionId: 'bridge-' + 'a'.repeat(24),
      workflowHash: hash, manifestHash: hash, quoteHash: hash,
      events: [{ sequence: 0, at: '2026-09-28T00:00:00.000Z', state: 'NOT_SENT' as const,
        sourceChainId: BRIDGE_SOURCE, destinationChainId: BRIDGE_DESTINATION, step: 'source' as const,
        transactionHash: null, note: 'prepared' }] };
    expect(validateBridgeJournal(journal)).toEqual(journal);
    expect(() => validateBridgeJournal({ ...journal, events: [{ ...journal.events[0]!, destinationChainId: BRIDGE_SOURCE }] } as never)).toThrow();
  });
});
