// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: fictional, deterministic identities of the MOCKED loopback harness (no key exists for them). Product code references
 * them only to recognize — and label as MOCKED — the harness's fixture swap program; it never instantiates a chain double.
 */
import { createHash } from 'node:crypto';
import { base58Encode } from '@defi-workflow-engine/reference-compiler';

const derive = (label: string) => base58Encode(createHash('sha256').update(label).digest());
export const MOCKED_SWAP_PROGRAM = derive('flofi.automation-002.mocked-swap-program');
export const MOCKED_SWAP_VAULT = derive('flofi.automation-002.mocked-swap-vault');
export const MOCKED_BLOCKHASH = derive('flofi.automation-002.blockhash');
/** The harness's fixed price: lamports paid per whole input-token unit. */
export const MOCKED_SOLANA_LAMPORTS_PER_UNIT = 2_000_000n;
