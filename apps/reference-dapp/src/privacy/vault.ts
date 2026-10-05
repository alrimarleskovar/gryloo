// SPDX-License-Identifier: AGPL-3.0-only
import { digestRawResponse } from '@defi-workflow-engine/reference-linter';
/** Owner custody stays browser-local. The isolated server demo constructs only public synthetic fixtures. */
export type PrivateNote = { bytes: string; index: number | null; commitment: string };
export type PrivateRefund = { privateKey: string; publicKey: string; blinding: string; derivedFromNk: boolean };
export type PrivateStateIdentity = { runId: string; owner: string; genesisHash: string; programId: string; manifestHash: string };
export type PrivateState = PrivateStateIdentity & {
  format: 'flofi.cloak-private-state.v1'; checkpoint: 'prepared' | 'result';
  inputNotes: PrivateNote[]; outputNotes: PrivateNote[]; refund: PrivateRefund;
  viewingKeyNk: string; noteSalt: string; swapStatePda: string | null; signature: string | null;
};
export type VaultReference = PrivateStateIdentity & { checkpoint: PrivateState['checkpoint']; ciphertextHash: string };
/** putNew must atomically reject an existing key; acknowledgment means the transaction committed. */
export type VaultBackend = { putNew(key: string, value: string): Promise<void>; get(key: string): Promise<string | null>;
  /** All keys commit together or none do. Required for submission and cross-run reservations. */
  putManyNew?(entries: readonly { key: string; value: string }[]): Promise<void> };
function fail(code: string): never { throw new Error(code); }
const encode = (bytes: Uint8Array): string => btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
const decode = (text: unknown, length?: number): Uint8Array<ArrayBuffer> => {
  if (typeof text !== 'string' || text.length > 1_400_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) fail('PRIVACY_STATE_INVALID');
  const bytes = Uint8Array.from(atob(text), c => c.charCodeAt(0));
  if (length !== undefined && bytes.length !== length) fail('PRIVACY_STATE_INVALID');
  return bytes;
};
const hex = (text: unknown): text is string => typeof text === 'string' && /^(?:0x)?[a-f0-9]{64}$/.test(text);
const address = (text: unknown): text is string => typeof text === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text);
const exact = (value: unknown, fields: readonly string[]): value is Record<string, unknown> => Boolean(value && typeof value === 'object' &&
  !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).sort().join() === [...fields].sort().join());
const identityFields = ['runId', 'owner', 'genesisHash', 'programId', 'manifestHash'] as const;

export function validatePrivateState(value: unknown): asserts value is PrivateState {
  if (!exact(value, [...identityFields, 'format', 'checkpoint', 'inputNotes', 'outputNotes', 'refund', 'viewingKeyNk', 'noteSalt', 'swapStatePda', 'signature']) ||
      value.format !== 'flofi.cloak-private-state.v1' || !['prepared', 'result'].includes(String(value.checkpoint)) ||
      typeof value.runId !== 'string' || !/^cloak-[a-f0-9]{32}$/.test(value.runId) || !address(value.owner) ||
      !address(value.genesisHash) || !address(value.programId) || !/^0x[a-f0-9]{64}$/.test(String(value.manifestHash)) ||
      !hex(value.viewingKeyNk) || typeof value.noteSalt !== 'string' || !/^[1-9][0-9]{0,28}$/.test(value.noteSalt) ||
      BigInt(value.noteSalt) >= 1n << 96n || !Array.isArray(value.inputNotes) || value.inputNotes.length < 1 || value.inputNotes.length > 2 ||
      !Array.isArray(value.outputNotes) || value.outputNotes.length < 1 || value.outputNotes.length > 2 ||
      !exact(value.refund, ['privateKey', 'publicKey', 'blinding', 'derivedFromNk']) ||
      !hex(value.refund.privateKey) || !hex(value.refund.publicKey) || !hex(value.refund.blinding) ||
      typeof value.refund.derivedFromNk !== 'boolean' || ['privateKey', 'publicKey', 'blinding'].some(k => /^(?:0x)?0{64}$/.test(String((value.refund as Record<string, unknown>)[k])))) fail('PRIVACY_STATE_INVALID');
  for (const note of [...value.inputNotes, ...value.outputNotes]) {
    if (!exact(note, ['bytes', 'index', 'commitment']) || !hex(note.commitment) ||
        note.index !== null && (!Number.isSafeInteger(note.index) || (note.index as number) < 0 || (note.index as number) >= 2 ** 32)) fail('PRIVACY_STATE_INVALID');
    decode(note.bytes, 128);
  }
  if (value.checkpoint === 'result' && (!address(value.swapStatePda) || typeof value.signature !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value.signature))) fail('PRIVACY_STATE_INVALID');
  if (value.checkpoint === 'prepared' && (value.swapStatePda !== null || value.signature !== null)) fail('PRIVACY_STATE_INVALID');
  if (value.checkpoint === 'prepared' && value.refund.derivedFromNk !== true) fail('PRIVACY_STATE_INVALID');
}

function identity(value: PrivateStateIdentity): PrivateStateIdentity {
  return { runId: value.runId, owner: value.owner, genesisHash: value.genesisHash, programId: value.programId, manifestHash: value.manifestHash };
}
const keyOf = (value: PrivateStateIdentity & { checkpoint: string }) => `${value.owner}:${value.runId}:${value.checkpoint}`;
const aadOf = (value: PrivateStateIdentity & { checkpoint: string }) => new TextEncoder().encode(JSON.stringify({ ...identity(value), checkpoint: value.checkpoint }));
const digest = async (bytes: Uint8Array<ArrayBuffer>) => '0x' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');

/** AES-GCM binds ciphertext to owner/network/program/run/Manifest/checkpoint. No wallet key is requested. */
export class PrivateStateVault {
  // Reuse a derived encryption key only while this vault is unlocked; every ciphertext still has its own random salt/IV.
  private readonly derivedKeys = new Map<string, Promise<CryptoKey>>();
  constructor(private readonly backend: VaultBackend, private readonly passphrase: string) {
    if (passphrase.length < 16 || passphrase.length > 1024) fail('PRIVACY_UNLOCK_SECRET_REQUIRED');
  }
  private async key(salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
    const id = encode(salt), cached = this.derivedKeys.get(id); if (cached) return cached;
    if (this.derivedKeys.size >= 128) this.derivedKeys.delete(this.derivedKeys.keys().next().value!);
    const deriving = (async () => {
      const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(this.passphrase), 'PBKDF2', false, ['deriveKey']);
      return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    })();
    this.derivedKeys.set(id, deriving);
    try { return await deriving; } catch (e) { this.derivedKeys.delete(id); throw e; }
  }
  /** Separate authenticated execution records; the completed v1 note codec stays unchanged. */
  async saveExecution(identityInput: PrivateStateIdentity, stage: string, value: unknown, reservationInput: readonly string[] = []): Promise<void> {
    const identity = structuredClone(identityInput), reservations = [...reservationInput];
    if (!/^execution\.(prepared|intent|signed|handoff|submitted|reconciled|restore|viewing|journal\.[0-9]{1,3})$/.test(stage)) fail('PRIVACY_STAGE_INVALID');
    const text = JSON.stringify(structuredClone(value));
    if (!text || text.length > 1_048_576) fail('PRIVACY_STATE_TOO_LARGE');
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
      additionalData: aadOf({ ...identity, checkpoint: stage }) }, await this.key(salt), new TextEncoder().encode(text)));
    const envelope = JSON.stringify({ format: 'flofi.cloak-execution-v1', salt: encode(salt), iv: encode(iv), ciphertext: encode(ciphertext) });
    const entries = [{ key: keyOf({ ...identity, checkpoint: stage }), value: envelope },
      ...reservations.map(key => ({ key: 'cloak.reservation:' + key, value: envelope }))];
    if (stage === 'execution.intent') {
      if (!this.backend.putManyNew || !reservations.length) fail('PRIVACY_ATOMIC_RESERVATION_UNAVAILABLE');
      await this.backend.putManyNew(entries);
    } else {
      if (reservations.length) fail('PRIVACY_STAGE_INVALID');
      await this.backend.putNew(entries[0]!.key, envelope);
    }
    if (JSON.stringify(await this.loadExecution(identity, stage)) !== text) fail('PRIVACY_PERSISTENCE_DIVERGENT');
  }
  async loadExecution(identityInput: PrivateStateIdentity, stage: string): Promise<unknown | null> {
    const identity = structuredClone(identityInput);
    const envelope = await this.backend.get(keyOf({ ...identity, checkpoint: stage }));
    if (envelope === null) return null;
    try {
      if (envelope.length > 1_500_000) fail('PRIVACY_STATE_TOO_LARGE');
      const parsed: unknown = JSON.parse(envelope);
      if (!exact(parsed, ['format', 'salt', 'iv', 'ciphertext']) || parsed.format !== 'flofi.cloak-execution-v1') fail('PRIVACY_STATE_INVALID');
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(parsed.iv, 12),
        additionalData: aadOf({ ...identity, checkpoint: stage }) }, await this.key(decode(parsed.salt, 16)), decode(parsed.ciphertext));
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
    } catch { throw new Error('PRIVACY_STATE_UNREADABLE'); }
  }
  async save(input: PrivateState): Promise<VaultReference> {
    // Snapshot before the first await so a caller cannot alter note ownership mid-write.
    const state: unknown = structuredClone(input); validatePrivateState(state);
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const payload = new TextEncoder().encode(JSON.stringify(state));
    if (payload.length > 1_048_576) fail('PRIVACY_STATE_TOO_LARGE');
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aadOf(state) }, await this.key(salt), payload));
    const envelope = JSON.stringify({ format: 'flofi.cloak-vault.v1', salt: encode(salt), iv: encode(iv), ciphertext: encode(ciphertext) });
    const reference: VaultReference = { ...identity(state), checkpoint: state.checkpoint, ciphertextHash: await digest(ciphertext) };
    await this.backend.putNew(keyOf(state), envelope);
    const readBack = await this.load(reference);
    if (JSON.stringify(readBack) !== JSON.stringify(state)) fail('PRIVACY_PERSISTENCE_DIVERGENT');
    return reference;
  }
  async load(reference: VaultReference): Promise<PrivateState> {
    const envelope = await this.backend.get(keyOf(reference));
    if (envelope === null) fail('PRIVACY_RECOVERY_DATA_MISSING');
    if (envelope.length > 1_500_000) fail('PRIVACY_STATE_TOO_LARGE');
    try {
      const parsed: unknown = JSON.parse(envelope);
      if (!exact(parsed, ['format', 'salt', 'iv', 'ciphertext']) || parsed.format !== 'flofi.cloak-vault.v1') fail('PRIVACY_STATE_INVALID');
      const ciphertext = decode(parsed.ciphertext);
      if (await digest(ciphertext) !== reference.ciphertextHash) fail('PRIVACY_PERSISTENCE_DIVERGENT');
      const payload = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(parsed.iv, 12), additionalData: aadOf(reference) }, await this.key(decode(parsed.salt, 16)), ciphertext);
      const state: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload)); validatePrivateState(state);
      if (JSON.stringify(identity(state)) !== JSON.stringify(identity(reference)) || state.checkpoint !== reference.checkpoint) fail('PRIVACY_STATE_LINK_MISMATCH');
      return state;
    } catch { throw new Error('PRIVACY_STATE_UNREADABLE'); }
  }
  async encryptedBackup(reference: VaultReference): Promise<string> {
    await this.load(reference); // A corrupt or wrong-owner record must never be exported as a usable backup.
    return await this.backend.get(keyOf(reference)) ?? fail('PRIVACY_RECOVERY_DATA_MISSING');
  }
  /** Recover a committed result when the process stopped before its evidence pointer was written. */
  async existingResult(identity: PrivateStateIdentity): Promise<VaultReference | null> {
    const envelope = await this.backend.get(keyOf({ ...identity, checkpoint: 'result' }));
    if (envelope === null) return null;
    try {
      const parsed = JSON.parse(envelope) as { ciphertext: unknown };
      const reference: VaultReference = { ...identity, checkpoint: 'result', ciphertextHash: await digest(decode(parsed.ciphertext)) };
      await this.load(reference); return reference;
    } catch { throw new Error('PRIVACY_STATE_UNREADABLE'); }
  }
  async hasExecutionReservation(keys: readonly string[]): Promise<boolean> {
    const reservations = await Promise.all(keys.map(key => this.backend.get('cloak.reservation:' + key)));
    return reservations.some(value => value !== null);
  }
  async restore(reference: VaultReference, encryptedBackup: string): Promise<PrivateState> {
    // Verify in an isolated sink before committing the supplied ciphertext to durable storage.
    const reader = new PrivateStateVault({ get: async () => encryptedBackup, putNew: async () => fail('PRIVACY_READ_ONLY') }, this.passphrase);
    const restored = await reader.load(reference);
    await this.backend.putNew(keyOf(reference), encryptedBackup);
    await this.load(reference);
    return restored;
  }
  /** Complete encrypted LIVE recovery bundle, including immutable journal and authorization evidence. */
  async executionBackup(reference: VaultReference): Promise<string> {
    await this.load(reference);
    const records: Record<string, string> = {};
    for (const checkpoint of ['prepared', 'result', 'execution.prepared', 'execution.intent', 'execution.signed',
      'execution.handoff', 'execution.submitted', 'execution.reconciled', 'execution.restore', 'execution.viewing',
      ...Array.from({ length: 64 }, (_, i) => 'execution.journal.' + i)]) {
      const raw = await this.backend.get(keyOf({ ...reference, checkpoint }));
      if (raw === null) continue;
      if (checkpoint.startsWith('execution.')) await this.loadExecution(reference, checkpoint);
      else if (checkpoint === 'result') await this.existingResult(reference);
      records[checkpoint] = raw;
    }
    if (!records['execution.prepared'] || reference.checkpoint !== 'prepared') fail('PRIVACY_LIVE_BACKUP_INCOMPLETE');
    return JSON.stringify({ format: 'flofi.cloak-live-backup.v1', reference, records });
  }
  /** Atomic, quarantined restore. It can resume inspection; it can never resume signing or submission. */
  async restoreExecutionBackup(text: string): Promise<VaultReference> {
    if (text.length > 24_000_000 || !this.backend.putManyNew) fail('PRIVACY_ATOMIC_RESERVATION_UNAVAILABLE');
    const bundle = JSON.parse(text) as { format?: string; reference?: VaultReference; records?: Record<string, string> };
    if (!exact(bundle, ['format', 'reference', 'records']) || bundle.format !== 'flofi.cloak-live-backup.v1' ||
        !bundle.reference || bundle.reference.checkpoint !== 'prepared' || !bundle.records ||
        !bundle.records.prepared || !bundle.records['execution.prepared']) fail('PRIVACY_LIVE_BACKUP_INCOMPLETE');
    const reference = structuredClone(bundle.reference), records = structuredClone(bundle.records);
    const isolated = new Map<string, string>();
    for (const [checkpoint, raw] of Object.entries(records)) {
      if (!/^(prepared|result|execution\.(prepared|intent|signed|handoff|submitted|reconciled|restore|viewing|journal\.[0-9]{1,2}))$/.test(checkpoint) ||
          typeof raw !== 'string' || raw.length > 1_500_000) fail('PRIVACY_LIVE_BACKUP_INCOMPLETE');
      isolated.set(keyOf({ ...reference, checkpoint }), raw);
    }
    const reader = new PrivateStateVault({ get: async key => isolated.get(key) ?? null,
      putNew: async (key, value) => { if (isolated.has(key)) fail('PRIVACY_DUPLICATE'); isolated.set(key, value); } }, this.passphrase);
    const state = await reader.load(reference);
    for (const checkpoint of Object.keys(records)) if (checkpoint.startsWith('execution.')) await reader.loadExecution(reference, checkpoint);
    if (records.result) await reader.existingResult(reference);
    const preparation = await reader.loadExecution(reference, 'execution.prepared') as {
      format?: string; reference?: VaultReference; review?: { manifestHash?: string; manifest?: { nonce?: string } } };
    if (preparation.format !== 'flofi.cloak-live-preparation.v1' || JSON.stringify(preparation.reference) !== JSON.stringify(reference) ||
        preparation.review?.manifestHash !== reference.manifestHash || !/^(?:0|[1-9][0-9]*)$/.test(preparation.review?.manifest?.nonce ?? ''))
      fail('PRIVACY_LIVE_BACKUP_INCOMPLETE');
    // Always regenerate the marker locally, even when the exported bundle predated submission.
    isolated.delete(keyOf({ ...reference, checkpoint: 'execution.restore' }));
    await reader.saveExecution(reference, 'execution.restore', { format: 'flofi.cloak-live-restore.v1', mode: 'INSPECTION_ONLY' });
    const keys = await Promise.all([['nonce', state.owner, state.genesisHash, state.programId, preparation.review!.manifest!.nonce!],
      ...state.inputNotes.map(n => ['note', state.genesisHash, state.programId, n.commitment])]
      .map(k => digestRawResponse(new TextEncoder().encode(JSON.stringify(k)))));
    const marker = isolated.get(keyOf({ ...reference, checkpoint: 'execution.restore' }))!;
    await this.backend.putManyNew!([...isolated].map(([key, value]) => ({ key, value })).concat(keys.map(k => ({ key: 'cloak.reservation:' + k, value: marker }))));
    await this.load(reference);
    return reference;
  }
}

/** Immutable checkpoints; IDB add fails on duplicates. Resolve only on transaction completion. */
export function indexedDbVaultBackend(db: IDBDatabase): VaultBackend {
  return {
    putManyNew: entries => new Promise<void>((resolve, reject) => {
      const tx = db.transaction('checkpoints', 'readwrite', { durability: 'strict' });
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new Error('PRIVACY_RESERVATION_CONFLICT'));
      tx.onerror = () => reject(new Error('PRIVACY_RESERVATION_CONFLICT'));
      try { for (const entry of entries) tx.objectStore('checkpoints').add(entry.value, entry.key); }
      catch { tx.abort(); reject(new Error('PRIVACY_RESERVATION_CONFLICT')); }
    }),
    putNew: (key, value) => new Promise<void>((resolve, reject) => {
      const tx = db.transaction('checkpoints', 'readwrite', { durability: 'strict' });
      tx.objectStore('checkpoints').add(value, key);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new Error('PRIVACY_PERSISTENCE_FAILED'));
      tx.onerror = () => reject(new Error('PRIVACY_PERSISTENCE_FAILED'));
    }),
    get: key => new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction('checkpoints', 'readonly');
      const request = tx.objectStore('checkpoints').get(key);
      tx.oncomplete = () => typeof request.result === 'string' ? resolve(request.result) : request.result === undefined
        ? resolve(null) : reject(new Error('PRIVACY_STATE_UNREADABLE'));
      tx.onabort = () => reject(new Error('PRIVACY_STATE_UNREADABLE'));
      tx.onerror = () => reject(new Error('PRIVACY_STATE_UNREADABLE'));
    }),
  };
}

export async function openPrivateVault(): Promise<VaultBackend> {
  if (typeof indexedDB === 'undefined') fail('PRIVACY_DURABLE_STORAGE_UNAVAILABLE');
  if (!navigator.storage || !await navigator.storage.persisted()) fail('PRIVACY_PERSISTENT_STORAGE_REQUIRED');
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('flofi-cloak-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('checkpoints');
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => db.close(); resolve(db); };
    request.onerror = () => reject(new Error('PRIVACY_DURABLE_STORAGE_UNAVAILABLE'));
    request.onblocked = () => reject(new Error('PRIVACY_DURABLE_STORAGE_UNAVAILABLE'));
  });
  return indexedDbVaultBackend(db);
}
