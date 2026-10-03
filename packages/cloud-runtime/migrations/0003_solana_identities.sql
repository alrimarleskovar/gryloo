-- SPDX-License-Identifier: AGPL-3.0-only
-- BUILD-CLOUD-001 0003: Solana flows (Devnet Orca swap and liquidity, Jupiter mainnet-beta swap). Widen the
-- projection domains for base58 owners and transaction signatures, Devnet/mainnet provenance and the EXPIRED
-- attempt state (a signature that can no longer land). No existing row is rewritten.
ALTER TABLE execution_runs DROP CONSTRAINT execution_runs_provenance_check;
ALTER TABLE execution_runs ADD CONSTRAINT execution_runs_provenance_check
  CHECK (provenance IN ('MOCKED', 'PUBLIC_TESTNET', 'PUBLIC_DEVNET', 'PUBLIC_MAINNET'));
ALTER TABLE execution_runs DROP CONSTRAINT execution_runs_owner_account_check;
ALTER TABLE execution_runs ADD CONSTRAINT execution_runs_owner_account_check
  CHECK (owner_account IS NULL OR owner_account ~ '^0x[0-9a-f]{40}$' OR owner_account ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$');
ALTER TABLE execution_attempts DROP CONSTRAINT execution_attempts_transaction_hash_check;
ALTER TABLE execution_attempts ADD CONSTRAINT execution_attempts_transaction_hash_check
  CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$' OR transaction_hash ~ '^[1-9A-HJ-NP-Za-km-z]{43,90}$');
ALTER TABLE execution_attempts DROP CONSTRAINT execution_attempts_state_check;
ALTER TABLE execution_attempts ADD CONSTRAINT execution_attempts_state_check CHECK (state IN ('PREPARED', 'CANCELLED', 'SUBMITTING',
  'SUBMISSION_RESULT_UNKNOWN', 'NOT_FOUND', 'PENDING', 'CONFIRMED', 'REVERTED', 'RECONCILIATION_REQUIRED', 'HASH', 'REJECTED', 'UNKNOWN', 'EXPIRED'));
