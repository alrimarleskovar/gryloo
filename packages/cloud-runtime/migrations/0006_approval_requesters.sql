-- SPDX-License-Identifier: AGPL-3.0-only
-- BUILD-DEVELOPER-001 0006: one approval-handoff model for every FloFi surface that hands a proposal to its owner.
-- `mcp_handoffs` (historical name, kept for compatibility) now stores the approval handoffs of every requester kind: an MCP account
-- (BUILD-MCP-002), and later a developer project or a channel conversation. A handoff names its requester generically:
--   requester_kind     MCP_ACCOUNT | DEVELOPER_PROJECT | CHANNEL_CONVERSATION
--   requester_id       the requester's identity for every kind except MCP_ACCOUNT, whose identity stays its account_id
--   requester_ref      generated: the requester's isolation key; every requester-scoped read, approval session and revocation
--                      filters on (requester_kind, requester_ref)
--   requester_context  immutable, non-secret facts the requester's claim policy may need (for example an intended wallet)
-- MCP rows keep their account and grant (unchanged foreign keys) and an empty context; other requesters carry no MCP identity.
-- Existing rows and MCP-shaped inserts that name no requester are MCP_ACCOUNT rows. Secrets are still stored only as 32-byte keyed
-- digests. Nothing here is authority: a requester never signs or authorizes; the owner's wallet does, in FloFi's existing flow.

ALTER TABLE mcp_handoffs
  ADD COLUMN requester_kind text NOT NULL DEFAULT 'MCP_ACCOUNT'
    CHECK (requester_kind IN ('MCP_ACCOUNT', 'DEVELOPER_PROJECT', 'CHANNEL_CONVERSATION')),
  ADD COLUMN requester_id text CHECK (requester_id IS NULL OR requester_id ~ '^[a-z][a-z0-9_.:-]{2,95}$'),
  ADD COLUMN requester_context jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(requester_context) = 'object' AND octet_length(requester_context::text) <= 4096),
  ALTER COLUMN account_id DROP NOT NULL,
  ALTER COLUMN grant_id DROP NOT NULL;
ALTER TABLE mcp_handoffs ADD COLUMN requester_ref text GENERATED ALWAYS AS (coalesce(requester_id, account_id)) STORED;
ALTER TABLE mcp_handoffs ADD CONSTRAINT mcp_handoffs_requester_identity CHECK (
  (requester_kind = 'MCP_ACCOUNT' AND account_id IS NOT NULL AND grant_id IS NOT NULL AND requester_id IS NULL AND requester_context = '{}'::jsonb)
  OR (requester_kind <> 'MCP_ACCOUNT' AND requester_id IS NOT NULL AND account_id IS NULL AND grant_id IS NULL));
CREATE INDEX mcp_handoffs_requester ON mcp_handoffs (tenant_id, requester_kind, requester_ref, status, created_at DESC);

-- The transition rules of 0005, unchanged, with the requester columns added to the immutable set (requester_ref is derived from
-- immutable columns). The exception names are kept so existing callers and tests see the same errors.
CREATE OR REPLACE FUNCTION mcp_handoff_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.handoff_id IS DISTINCT FROM OLD.handoff_id OR NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.grant_id IS DISTINCT FROM OLD.grant_id OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.client_name IS DISTINCT FROM OLD.client_name
     OR NEW.secret_digest IS DISTINCT FROM OLD.secret_digest OR NEW.strategy IS DISTINCT FROM OLD.strategy OR NEW.workflow_hash IS DISTINCT FROM OLD.workflow_hash
     OR NEW.engine_version IS DISTINCT FROM OLD.engine_version OR NEW.network_environment IS DISTINCT FROM OLD.network_environment
     OR NEW.funds_class IS DISTINCT FROM OLD.funds_class OR NEW.plan IS DISTINCT FROM OLD.plan OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.requester_kind IS DISTINCT FROM OLD.requester_kind
     OR NEW.requester_id IS DISTINCT FROM OLD.requester_id OR NEW.requester_context IS DISTINCT FROM OLD.requester_context THEN
    RAISE EXCEPTION 'MCP_HANDOFF_IMMUTABLE' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.claimed_address IS NOT NULL AND (NEW.claimed_address IS DISTINCT FROM OLD.claimed_address OR NEW.claimed_namespace IS DISTINCT FROM OLD.claimed_namespace
     OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at) THEN
    RAISE EXCEPTION 'MCP_HANDOFF_CLAIM_IMMUTABLE' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status IN ('EXPIRED', 'SUPERSEDED', 'REVOKED', 'STALE') THEN
    RAISE EXCEPTION 'MCP_HANDOFF_TERMINAL' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'PENDING' AND NEW.status IN ('CLAIMED', 'EXPIRED', 'SUPERSEDED', 'REVOKED', 'STALE'))
    OR (OLD.status = 'CLAIMED' AND NEW.status IN ('APPLIED', 'EXPIRED', 'REVOKED', 'STALE'))) THEN
    RAISE EXCEPTION 'MCP_HANDOFF_TRANSITION_INVALID' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status = 'APPLIED' AND (NEW.signing_digest IS DISTINCT FROM OLD.signing_digest) THEN
    RAISE EXCEPTION 'MCP_HANDOFF_TERMINAL' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
