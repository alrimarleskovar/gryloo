// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import type { ReadResult } from '../domain/base-observation';
import { readBaseQuoteOnServer } from '../server/base-rpc';

/**
 * The only Server Action: one read-only Base observation for one authored
 * swap. It receives the workflow and node ID only, and returns a transcript
 * and artifact or a failure code. It is never an authorization input.
 */
export async function readBaseQuote(input: unknown): Promise<ReadResult> {
  return readBaseQuoteOnServer(input);
}
