// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/** Browser-only custody boundary. No private state is sent to server actions or public evidence. */
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
export type VaultBackend = { putNew(key: string, value: string): Promise<void>; get(key: string): Promise<string | null> };
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
  constructor(private readonly backend: VaultBackend, private readonly passphrase: string) {
    if (passphrase.length < 16 || passphrase.length > 1024) fail('PRIVACY_UNLOCK_SECRET_REQUIRED');
  }
  private async key(salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(this.passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
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
  async restore(reference: VaultReference, encryptedBackup: string): Promise<PrivateState> {
    // Verify in an isolated sink before committing the supplied ciphertext to durable storage.
    const reader = new PrivateStateVault({ get: async () => encryptedBackup, putNew: async () => fail('PRIVACY_READ_ONLY') }, this.passphrase);
    const restored = await reader.load(reference);
    await this.backend.putNew(keyOf(reference), encryptedBackup);
    await this.load(reference);
    return restored;
  }
}

/** Immutable checkpoints; IDB add fails on duplicates. Resolve only on transaction completion. */
export function indexedDbVaultBackend(db: IDBDatabase): VaultBackend {
  return {
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
