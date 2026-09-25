// SPDX-License-Identifier: AGPL-3.0-only
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
type StoreHandle = { writeFile: (bytes: Uint8Array) => Promise<void>; sync: () => Promise<void>; close: () => Promise<void> };
export type StoreOps = {
  mkdir: (path: string, options: { recursive: true; mode: number }) => Promise<unknown>;
  readFile: (path: string) => Promise<Uint8Array>;
  open: (path: string, flags: string, mode?: number) => Promise<StoreHandle>;
  rename: (from: string, to: string) => Promise<void>;
  unlink: (path: string) => Promise<void>;
};
const defaultOps: StoreOps = { mkdir, readFile, open, rename, unlink };
let sequence = 0;
const pendingWrites = new Map<string, Promise<void>>();
/** Atomic append-only file replacement: complete temp file, file fsync, rename, directory fsync. */
export async function writeExtendingFile(path: string, nextBytes: Uint8Array, validate: (bytes: Uint8Array) => void, ops: StoreOps = defaultOps): Promise<void> {
  const previous = pendingWrites.get(path) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  pendingWrites.set(path, gate);
  await previous;
  try { await writeExtendingFileLocked(path, nextBytes, validate, ops); }
  finally { release(); if (pendingWrites.get(path) === gate) pendingWrites.delete(path); }
}
async function writeExtendingFileLocked(path: string, nextBytes: Uint8Array, validate: (bytes: Uint8Array) => void, ops: StoreOps): Promise<void> {
  if (!(nextBytes instanceof Uint8Array) || nextBytes.length > 16_777_216) throw new Error('JOURNAL_CORRUPT');
  const directory = dirname(path);
  await ops.mkdir(directory, { recursive: true, mode: 0o700 });
  let prior: Uint8Array = new Uint8Array();
  try { prior = await ops.readFile(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('JOURNAL_WRITE_FAILED', { cause: error });
  }
  if (nextBytes.length <= prior.length || !prior.every((byte, index) => byte === nextBytes[index])) throw new Error('JOURNAL_CORRUPT');
  try { if (prior.length) validate(prior); validate(nextBytes); }
  catch (error) { throw new Error('JOURNAL_CORRUPT', { cause: error }); }
  const temp = join(directory, `.${basename(path)}.${process.pid}.${++sequence}.tmp`);
  let created = false;
  try {
    const handle = await ops.open(temp, 'wx', 0o600);
    created = true;
    try { await handle.writeFile(nextBytes); await handle.sync(); } finally { await handle.close(); }
    await ops.rename(temp, path);
    created = false;
    const dirHandle = await ops.open(directory, 'r');
    try { await dirHandle.sync(); } finally { await dirHandle.close(); }
  } catch (error) {
    if (created) await ops.unlink(temp).catch(() => undefined);
    throw new Error('JOURNAL_WRITE_FAILED', { cause: error });
  }
}
export async function readValidatedFile(path: string, validate: (bytes: Uint8Array) => void): Promise<Uint8Array> {
  let bytes: Uint8Array;
  try { bytes = await readFile(path); } catch (error) { throw new Error('JOURNAL_CORRUPT', { cause: error }); }
  try { validate(bytes); } catch (error) { throw new Error('JOURNAL_CORRUPT', { cause: error }); }
  return bytes;
}
