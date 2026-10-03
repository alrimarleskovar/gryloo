// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CLOUD-001 storage ports. Execution services persist ONLY through these interfaces, so the same
 * financial logic runs on the local file store or on a shared database without any semantic change.
 *
 * DurableLogStore is the pre-existing persistence contract made explicit: append-only logs that may only
 * be replaced by a strict byte extension (run snapshots, embedded journals and economic intents), plus
 * exclusive creation. LeaseStore is the cross-process exclusive section previously implemented by PID
 * lock directories. The file implementations below preserve the exact pre-existing paths and bytes.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, open, readFile, rmdir, stat, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { writeExtendingFile } from './file-store.js';

export type LogValidator = (bytes: Uint8Array) => void;
export interface DurableLogStore {
  /** The complete stored bytes, or null when the log does not exist. */
  readonly read: (name: string) => Promise<Uint8Array | null>;
  /**
   * Replaces the log with `next`, which must strictly extend the stored bytes; `validate` must accept both.
   * Resolves only after durable persistence. Anything else rejects with JOURNAL_CORRUPT / JOURNAL_WRITE_FAILED.
   */
  readonly extend: (name: string, next: Uint8Array, validate: LogValidator) => Promise<void>;
  /** Exclusive durable creation. Resolves false, writing nothing, when the log already exists. */
  readonly create: (name: string, bytes: Uint8Array) => Promise<boolean>;
}
export interface LeaseStore {
  /**
   * Runs `action` while holding a durable exclusive lease on `key`. Rejects with the flow's BUSY code when a
   * live owner holds it. Re-entrant within the same asynchronous context.
   */
  readonly hold: <T>(key: string, action: () => Promise<T>) => Promise<T>;
}
export type ExecutionStorage = { readonly log: DurableLogStore; readonly leases: LeaseStore };

export const LOG_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/;
export function assertLogName(name: string): string {
  if (!LOG_NAME.test(name) || name.includes('..')) throw new Error('STORAGE_NAME_INVALID');
  return name;
}
/** The error a missing log produces; compatible with the former `readFile` ENOENT rejection. */
export function logMissing(name: string): Error {
  return Object.assign(new Error(`ENOENT: no such execution log '${name}'`), { code: 'ENOENT' });
}
export const utf8 = (bytes: Uint8Array | null): string => bytes === null ? '' : new TextDecoder().decode(bytes);

/** Adds same-context re-entrancy to any lease store (nested holds of the same key run directly). */
export function reentrantLeases(inner: LeaseStore): LeaseStore {
  const held = new AsyncLocalStorage<ReadonlySet<string>>();
  return {
    hold: (key, action) => {
      const current = held.getStore() ?? new Set<string>();
      if (current.has(key)) return action();
      return inner.hold(key, () => held.run(new Set([...current, key]), action));
    },
  };
}

function checkedDirectory(directory: string): string {
  if (!isAbsolute(directory) || directory.includes('/.git/')) throw new Error('STORAGE_DIRECTORY_INVALID');
  return directory;
}
/** The original journal directory layout: `<directory>/<name>`, mode 0700 directory and 0600 files. */
export function createFileLogStore(directory: string): DurableLogStore {
  const root = checkedDirectory(directory), path = (name: string) => join(root, assertLogName(name));
  return {
    async read(name) {
      try { return new Uint8Array(await readFile(path(name))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    },
    extend: (name, next, validate) => writeExtendingFile(path(name), next, validate),
    async create(name, bytes) {
      const file = path(name);
      await mkdir(root, { recursive: true, mode: 0o700 });
      let handle;
      try { handle = await open(file, 'wx', 0o600); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      const directoryHandle = await open(root, 'r');
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
      return true;
    },
  };
}
/**
 * The original cross-process lock: a `<key>.lock` directory holding the owner PID, reclaimed only when that
 * PID is provably dead on THIS machine. Correct for one host; the database lease store replaces it for N hosts.
 */
export function createFileLeaseStore(directory: string, busyCode: string): LeaseStore {
  const root = checkedDirectory(directory);
  return reentrantLeases({
    async hold<T>(key: string, action: () => Promise<T>): Promise<T> {
      await mkdir(root, { recursive: true, mode: 0o700 });
      const lock = join(root, assertLogName(key) + '.lock');
      try { await mkdir(lock, { mode: 0o700 }); } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        const before = await stat(lock);
        let pid: number; try { pid = Number(await readFile(join(lock, 'pid'), 'utf8')); } catch (cause) { throw new Error(busyCode, { cause }); }
        if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(busyCode, { cause: e });
        try { process.kill(pid, 0); throw new Error(busyCode, { cause: e }); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause; }
        if ((await stat(lock)).ino !== before.ino) throw new Error(busyCode, { cause: e });
        await unlink(join(lock, 'pid')); await rmdir(lock); await mkdir(lock, { mode: 0o700 });
      }
      const handle = await open(join(lock, 'pid'), 'wx', 0o600);
      try { await handle.writeFile(String(process.pid)); await handle.sync(); } finally { await handle.close(); }
      try { return await action(); } finally { await unlink(join(lock, 'pid')); await rmdir(lock); }
    },
  });
}
export function createFileExecutionStorage(directory: string, busyCode: string): ExecutionStorage {
  return { log: createFileLogStore(directory), leases: createFileLeaseStore(directory, busyCode) };
}
