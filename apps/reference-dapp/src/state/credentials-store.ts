// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * Browser-local credential references (this device only). Only the strict public shapes in `domain/credentials.ts` are
 * written or read: wallet addresses with their provider, and provider-tokenized card metadata. No key, seed phrase, card
 * number or security code can be stored here, and nothing here is consulted by Review, authorization or execution.
 */
import { useSyncExternalStore } from 'react';
import { addCardReference, addWalletReference, EMPTY_CREDENTIALS, readCredentials, removeCredential, renameCredential,
  type Credentials, type WalletReferenceInput } from '../domain/credentials';

export const CREDENTIALS_STORAGE_KEY = 'flofi.credentials.v1';
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: Credentials } = { raw: null, value: EMPTY_CREDENTIALS };

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage ?? null; } catch { return null; }
}
function parse(raw: string | null): Credentials {
  try { return raw ? readCredentials(JSON.parse(raw)) : EMPTY_CREDENTIALS; } catch { return EMPTY_CREDENTIALS; }
}
export function loadCredentials(): Credentials {
  let raw: string | null;
  try { raw = storage()?.getItem(CREDENTIALS_STORAGE_KEY) ?? null; } catch { return cache.value; }
  if (raw === cache.raw) return cache.value;
  cache = { raw, value: parse(raw) };
  return cache.value;
}
function save(next: Credentials): Credentials {
  // Re-validate on write as well, so a programming error cannot persist an unsafe shape.
  const value = readCredentials(next);
  const raw = JSON.stringify(value);
  try { storage()?.setItem(CREDENTIALS_STORAGE_KEY, raw); } catch { throw new Error('CREDENTIALS_STORAGE_UNAVAILABLE'); }
  cache = { raw, value };
  for (const listener of listeners) listener();
  return value;
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === CREDENTIALS_STORAGE_KEY) listener(); };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}
export const saveWalletReference = (input: WalletReferenceInput) => save(addWalletReference(loadCredentials(), input, new Date()));
export const saveCardReference = (providerResult: unknown) => save(addCardReference(loadCredentials(), providerResult, new Date()));
export const renameSavedCredential = (id: string, label: string) => save(renameCredential(loadCredentials(), id, label));
export const removeSavedCredential = (id: string) => save(removeCredential(loadCredentials(), id));

export function useCredentials(): Credentials {
  return useSyncExternalStore(subscribe, loadCredentials, () => EMPTY_CREDENTIALS);
}
