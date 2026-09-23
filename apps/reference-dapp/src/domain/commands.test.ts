// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { commandIsValid, parseMockCommand } from './commands';

describe('deterministic mock command grammar', () => {
  it('parses only the approved local edit forms with their captured revision', () => {
    expect(parseMockCommand('add transform', 3)).toEqual({ type: 'ADD', kind: 'transform', source: 'CHAT', baseRevision: 3 });
    expect(parseMockCommand('set node-001 amount 2500000', 4)).toEqual({ type: 'SET_AMOUNT', nodeId: 'node-001', amount: '2500000', source: 'CHAT', baseRevision: 4 });
  });

  it('rejects financial commands, malformed amounts, and forged command fields', () => {
    for (const text of ['swap 1', 'execute', 'add payment', 'set node-001 amount 01', 'set node-001 amount -1']) {
      expect(() => parseMockCommand(text, 0)).toThrow();
    }
    expect(commandIsValid({ type: 'LOCK', nodeId: 'node-001', locked: true, source: 'CHAT', baseRevision: 0 })).toBe(false);
    expect(commandIsValid({ type: 'ADD', kind: 'read', source: 'CHAT', baseRevision: 0, extra: true } as never)).toBe(false);
  });
});
