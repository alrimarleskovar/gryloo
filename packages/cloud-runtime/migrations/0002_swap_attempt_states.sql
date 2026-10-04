-- SPDX-License-Identifier: AGPL-3.0-only
-- BUILD-CLOUD-001 0002: the Base Sepolia swap flow records wallet outcomes as HASH / REJECTED / UNKNOWN
-- attempt states. Widen the projection's state domain; no existing row is rewritten.
ALTER TABLE execution_attempts DROP CONSTRAINT execution_attempts_state_check;
ALTER TABLE execution_attempts ADD CONSTRAINT execution_attempts_state_check CHECK (state IN ('PREPARED', 'CANCELLED', 'SUBMITTING',
  'SUBMISSION_RESULT_UNKNOWN', 'NOT_FOUND', 'PENDING', 'CONFIRMED', 'REVERTED', 'RECONCILIATION_REQUIRED', 'HASH', 'REJECTED', 'UNKNOWN'));
