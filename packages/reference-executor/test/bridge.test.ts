import { describe, expect, it } from 'vitest';
import { BRIDGE_SOURCE, BRIDGE_DESTINATION } from '@defi-workflow-engine/workflow-contracts';
import { validateBridgeJournal } from '@defi-workflow-engine/workflow-contracts';
describe('bridge lifecycle invariants', () => {
  it('requires ordered events and both chains after restart', () => {
    const hash = '0x' + 'a'.repeat(64);
    const value = { format: 'gryloo.bridge-journal.v1' as const, executionId: 'bridge-' + 'b'.repeat(24),
      workflowHash: hash, manifestHash: hash, quoteHash: hash,
      events: [{ sequence: 0, at: '2026-09-28T00:00:00.000Z', state: 'NOT_SENT' as const, step: 'source' as const,
        sourceChainId: BRIDGE_SOURCE, destinationChainId: BRIDGE_DESTINATION, transactionHash: null, note: 'uncertain' }] };
    expect(validateBridgeJournal(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(() => validateBridgeJournal({ ...value, events: [{ ...value.events[0]!, sequence: 1 }] })).toThrow();
  });
});
