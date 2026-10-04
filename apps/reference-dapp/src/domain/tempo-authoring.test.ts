// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { parseLocalCommand, commandIsValid } from './commands';
import { editorReducer, initialEditor } from './editor';
import { createAuthoredTempo } from './tempo-authoring';
describe('Tempo in shared Guided / Canvas authoring', () => {
  const input = { amount: '1', recipient: '0x2222222222222222222222222222222222222222', memo: '0x' + '01'.repeat(32), maximumFee: '0.01' };
  it('chat and Canvas produce identical canonical IR, edits increase revision', () => {
    const state = initialEditor(), context = createBaseSepoliaReviewContext();
    const chat = parseLocalCommand(`pay 1 pathUSD to ${input.recipient} on Tempo Moderato memo ${input.memo} fee 0.01`, state.workflow, context);
    const canvas = { type: 'AUTHOR_TEMPO_PAYMENT' as const, input, source: 'CANVAS' as const, baseRevision: 0 };
    expect(commandIsValid(canvas)).toBe(true);
    const a = editorReducer(state, chat, context), b = editorReducer(state, canvas, context);
    expect(a.error).toBeNull(); expect(a.workflow).toEqual(b.workflow);
    expect(a.workflow.nodes[1]?.actionType).toBe('asset.transfer');
    const edit = editorReducer(a, { ...canvas, baseRevision: 1, input: { ...input, amount: '2' } }, context);
    expect(edit.error).toBeNull(); expect(edit.workflow.revision).toBe(2); expect(edit.workflow.nodes).toHaveLength(2);
  });
  it('rejects oversized, malformed or ambiguous decimal amounts and recipients', () => {
    for (const amount of ['11','0','1.0000001','1e-6','-1']) expect(() => createAuthoredTempo('payment', { ...input, amount })).toThrow();
    expect(() => createAuthoredTempo('payment', { ...input, maximumFee: '0.11' })).toThrow();
    expect(() => createAuthoredTempo('payment', { ...input, recipient: 'CONNECTED_OWNER' })).toThrow();
  });
});
