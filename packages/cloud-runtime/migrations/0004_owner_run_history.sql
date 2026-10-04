-- SPDX-License-Identifier: AGPL-3.0-only
-- BUILD-JOURNEY-001 0004: a wallet lists only its own runs (permissionless journey recovery from any browser).
-- Index the owner-scoped history in the same keyset order as execution_runs_history. No row is rewritten.
CREATE INDEX execution_runs_owner_history ON execution_runs (tenant_id, owner_account, updated_at DESC, run_id DESC)
  WHERE owner_account IS NOT NULL;
