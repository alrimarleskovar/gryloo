import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readValidatedFile, writeExtendingFile } from '../src/file-store.js';
describe('atomic extending file', () => {
  it('persists complete extending bytes and rejects truncation and corruption', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gryloo-g3-store-'));
    const path = join(dir, 'journal.log');
    const validate = (b: Uint8Array) => { if (b.length === 0 || b[0] !== 0x61) throw new Error('bad'); };
    try {
      await writeExtendingFile(path, new TextEncoder().encode('a\n'), validate);
      await writeExtendingFile(path, new TextEncoder().encode('a\nb\n'), validate);
      expect(new TextDecoder().decode(await readValidatedFile(path, validate))).toBe('a\nb\n');
      await expect(writeExtendingFile(path, new TextEncoder().encode('b\n'), validate)).rejects.toThrow('JOURNAL_CORRUPT');
      expect(await readFile(path, 'utf8')).toBe('a\nb\n');
      await expect(readValidatedFile(path, () => { throw new Error('corrupt'); })).rejects.toThrow('JOURNAL_CORRUPT');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('serializes competing appends and rejects a stale prefix', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gryloo-g3-store-race-'));
    const path = join(dir, 'journal.log');
    const encode = (text: string) => new TextEncoder().encode(text);
    const validate = (bytes: Uint8Array) => { if (bytes[0] !== 0x61) throw new Error('bad'); };
    try {
      await writeExtendingFile(path, encode('a\n'), validate);
      const outcomes = await Promise.allSettled([
        writeExtendingFile(path, encode('a\nb\n'), validate),
        writeExtendingFile(path, encode('a\nc\n'), validate),
      ]);
      expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter(item => item.status === 'rejected')).toHaveLength(1);
      expect(await readFile(path, 'utf8')).toBe('a\nb\n');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

import type { StoreOps } from '../src/file-store.js';
describe('durable replacement ordering', () => {
  it('fsyncs the complete temporary file before rename and the directory after rename', async () => {
    const events: string[] = [];
    const ops: StoreOps = {
      mkdir: async () => { events.push('mkdir'); },
      readFile: async () => { events.push('read'); throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
      open: async (_path, flags) => {
        events.push(`open:${flags}`);
        return { writeFile: async () => { events.push('write'); },
          sync: async () => { events.push(flags === 'wx' ? 'fsync:file' : 'fsync:directory'); },
          close: async () => { events.push(flags === 'wx' ? 'close:file' : 'close:directory'); } };
      },
      rename: async () => { events.push('rename'); },
      unlink: async () => { events.push('unlink'); },
    };
    await writeExtendingFile('/tmp/gryloo-scripted-journal.log', new TextEncoder().encode('a\n'), () => undefined, ops);
    expect(events).toEqual(['mkdir', 'read', 'open:wx', 'write', 'fsync:file', 'close:file',
      'rename', 'open:r', 'fsync:directory', 'close:directory']);
  });
});
