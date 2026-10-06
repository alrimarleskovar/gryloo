-- SPDX-License-Identifier: AGPL-3.0-only
-- BUILD-MCP-002 0005: consumer OAuth for the MCP gateway, trusted approval handoffs and wallet links.
-- Every key starts with tenant_id. No plaintext secret is stored: access/refresh tokens, authorization codes, handoff and
-- signing secrets, consent CSRF tokens and client IPs are kept only as 32-byte keyed digests (HMAC-SHA-256).
-- Nothing here is financial authority: an account, a grant, a handoff or a wallet link never signs or authorizes a transaction.
-- Nothing here is network-specific: environments and funds classes are data, so mainnet needs policy, not a migration.

-- A pseudonymous FloFi account created at OAuth consent. No email, no name, no wallet.
CREATE TABLE mcp_accounts (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  account_id text NOT NULL CHECK (account_id ~ '^mcpacct_[a-z2-7]{26}$'),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, account_id)
);

-- OAuth clients: a cached Client ID Metadata Document (CIMD) or a narrow dynamic registration (DCR). Public clients only.
CREATE TABLE mcp_oauth_clients (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  client_id text NOT NULL CHECK (length(client_id) BETWEEN 8 AND 512),
  kind text NOT NULL CHECK (kind IN ('CIMD', 'DCR')),
  client_name text NOT NULL CHECK (length(client_name) BETWEEN 1 AND 128),
  redirect_uris text[] NOT NULL CHECK (cardinality(redirect_uris) BETWEEN 1 AND 10),
  metadata_sha256 text NOT NULL CHECK (metadata_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, client_id)
);

-- One authorization request: pending consent, then (approved) a single-use authorization code, then consumed.
CREATE TABLE mcp_oauth_authorizations (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  request_id text NOT NULL CHECK (request_id ~ '^oar_[a-z2-7]{26}$'),
  status text NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'DENIED', 'CONSUMED', 'EXPIRED')),
  client_id text NOT NULL CHECK (length(client_id) BETWEEN 8 AND 512),
  client_name text NOT NULL CHECK (length(client_name) BETWEEN 1 AND 128),
  redirect_uri text NOT NULL CHECK (length(redirect_uri) BETWEEN 8 AND 512),
  state text NOT NULL CHECK (length(state) BETWEEN 1 AND 512),
  code_challenge text NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  scopes text[] NOT NULL CHECK (cardinality(scopes) >= 1 AND scopes <@ ARRAY['flofi.strategy', 'flofi.approval', 'flofi.runs']::text[]),
  resource text NOT NULL CHECK (length(resource) BETWEEN 8 AND 512),
  csrf_digest bytea NOT NULL CHECK (octet_length(csrf_digest) = 32),
  account_id text,
  grant_id text,
  code_digest bytea CHECK (code_digest IS NULL OR octet_length(code_digest) = 32),
  code_expires_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, request_id),
  UNIQUE (tenant_id, code_digest),
  FOREIGN KEY (tenant_id, account_id) REFERENCES mcp_accounts (tenant_id, account_id),
  CHECK (status NOT IN ('APPROVED', 'CONSUMED') OR (code_digest IS NOT NULL AND code_expires_at IS NOT NULL AND account_id IS NOT NULL AND grant_id IS NOT NULL)),
  CHECK (status IN ('APPROVED', 'CONSUMED') OR code_digest IS NULL)
);

-- A client's consent for one account: scopes and the single resource (audience) its tokens are bound to.
CREATE TABLE mcp_oauth_grants (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  grant_id text NOT NULL CHECK (grant_id ~ '^grt_[a-z2-7]{26}$'),
  account_id text NOT NULL,
  client_id text NOT NULL CHECK (length(client_id) BETWEEN 8 AND 512),
  client_name text NOT NULL CHECK (length(client_name) BETWEEN 1 AND 128),
  scopes text[] NOT NULL CHECK (cardinality(scopes) >= 1 AND scopes <@ ARRAY['flofi.strategy', 'flofi.approval', 'flofi.runs']::text[]),
  resource text NOT NULL CHECK (length(resource) BETWEEN 8 AND 512),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (tenant_id, grant_id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES mcp_accounts (tenant_id, account_id),
  CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);
CREATE INDEX mcp_oauth_grants_account ON mcp_oauth_grants (tenant_id, account_id, client_id) WHERE status = 'ACTIVE';
ALTER TABLE mcp_oauth_authorizations ADD FOREIGN KEY (tenant_id, grant_id) REFERENCES mcp_oauth_grants (tenant_id, grant_id);

-- Access and refresh tokens (digests only). A family is one authorization's chain of rotated refresh tokens and the access
-- tokens they minted: reuse of a rotated refresh token outside the grace window revokes the whole family.
CREATE TABLE mcp_oauth_tokens (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  token_digest bytea NOT NULL CHECK (octet_length(token_digest) = 32),
  kind text NOT NULL CHECK (kind IN ('ACCESS', 'REFRESH')),
  grant_id text NOT NULL,
  family_id text NOT NULL CHECK (family_id ~ '^fam_[a-z2-7]{26}$'),
  scopes text[] NOT NULL CHECK (cardinality(scopes) >= 1 AND scopes <@ ARRAY['flofi.strategy', 'flofi.approval', 'flofi.runs']::text[]),
  resource text NOT NULL CHECK (length(resource) BETWEEN 8 AND 512),
  expires_at timestamptz NOT NULL,
  family_expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, token_digest),
  FOREIGN KEY (tenant_id, grant_id) REFERENCES mcp_oauth_grants (tenant_id, grant_id),
  CHECK (kind = 'REFRESH' OR used_at IS NULL),
  CHECK (expires_at <= family_expires_at)
);
CREATE INDEX mcp_oauth_tokens_family ON mcp_oauth_tokens (tenant_id, family_id);
CREATE INDEX mcp_oauth_tokens_grant ON mcp_oauth_tokens (tenant_id, grant_id);
CREATE INDEX mcp_oauth_tokens_expiry ON mcp_oauth_tokens (tenant_id, family_expires_at);

-- A trusted approval handoff: an external proposal waiting for its owner on FloFi. It carries no authority. The secret travels
-- only in the approval URL fragment; the row keeps its digest. Status moves forward only; terminal states never revive.
CREATE TABLE mcp_handoffs (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  handoff_id text NOT NULL CHECK (handoff_id ~ '^apr_[a-z2-7]{26}$'),
  account_id text NOT NULL,
  grant_id text NOT NULL,
  client_id text NOT NULL CHECK (length(client_id) BETWEEN 8 AND 512),
  client_name text NOT NULL CHECK (length(client_name) BETWEEN 1 AND 128),
  secret_digest bytea NOT NULL CHECK (octet_length(secret_digest) = 32),
  signing_digest bytea CHECK (signing_digest IS NULL OR octet_length(signing_digest) = 32),
  signing_expires_at timestamptz,
  strategy jsonb NOT NULL CHECK (jsonb_typeof(strategy) = 'object' AND octet_length(strategy::text) <= 16384),
  workflow_hash text NOT NULL CHECK (workflow_hash ~ '^0x[0-9a-f]{64}$'),
  engine_version text NOT NULL CHECK (engine_version ~ '^[a-z0-9][a-z0-9.+-]{0,63}$'),
  network_environment text NOT NULL CHECK (network_environment ~ '^[A-Z][A-Z_]{2,31}$'),
  funds_class text NOT NULL CHECK (funds_class IN ('TEST_FUNDS', 'REAL_FUNDS')),
  plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object' AND octet_length(plan::text) <= 16384),
  status text NOT NULL CHECK (status IN ('PENDING', 'CLAIMED', 'APPLIED', 'EXPIRED', 'SUPERSEDED', 'REVOKED', 'STALE')),
  claimed_namespace text CHECK (claimed_namespace IS NULL OR claimed_namespace IN ('eip155', 'solana')),
  claimed_address text,
  share_status boolean NOT NULL DEFAULT false,
  run_ids text[] NOT NULL DEFAULT '{}' CHECK (cardinality(run_ids) <= 16),
  expires_at timestamptz NOT NULL,
  claim_expires_at timestamptz,
  claimed_at timestamptz,
  applied_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, handoff_id),
  UNIQUE (tenant_id, secret_digest),
  UNIQUE (tenant_id, signing_digest),
  FOREIGN KEY (tenant_id, account_id) REFERENCES mcp_accounts (tenant_id, account_id),
  FOREIGN KEY (tenant_id, grant_id) REFERENCES mcp_oauth_grants (tenant_id, grant_id),
  CHECK ((claimed_namespace IS NULL) = (claimed_address IS NULL)),
  CHECK (claimed_namespace IS NULL
    OR (claimed_namespace = 'eip155' AND claimed_address ~ '^0x[0-9a-f]{40}$')
    OR (claimed_namespace = 'solana' AND claimed_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')),
  CHECK (status NOT IN ('CLAIMED', 'APPLIED') OR (claimed_address IS NOT NULL AND claimed_at IS NOT NULL AND claim_expires_at IS NOT NULL)),
  CHECK (status <> 'APPLIED' OR applied_at IS NOT NULL),
  CHECK (status NOT IN ('EXPIRED', 'SUPERSEDED', 'REVOKED', 'STALE') OR ended_at IS NOT NULL)
);
CREATE INDEX mcp_handoffs_account ON mcp_handoffs (tenant_id, account_id, status, created_at DESC);
CREATE INDEX mcp_handoffs_expiry ON mcp_handoffs (tenant_id, created_at);

CREATE FUNCTION mcp_handoff_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.handoff_id IS DISTINCT FROM OLD.handoff_id OR NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.grant_id IS DISTINCT FROM OLD.grant_id OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.client_name IS DISTINCT FROM OLD.client_name
     OR NEW.secret_digest IS DISTINCT FROM OLD.secret_digest OR NEW.strategy IS DISTINCT FROM OLD.strategy OR NEW.workflow_hash IS DISTINCT FROM OLD.workflow_hash
     OR NEW.engine_version IS DISTINCT FROM OLD.engine_version OR NEW.network_environment IS DISTINCT FROM OLD.network_environment
     OR NEW.funds_class IS DISTINCT FROM OLD.funds_class OR NEW.plan IS DISTINCT FROM OLD.plan OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
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
CREATE TRIGGER mcp_handoffs_transition BEFORE UPDATE ON mcp_handoffs FOR EACH ROW EXECUTE FUNCTION mcp_handoff_transition();

-- A wallet linked to an account: created on FloFi only with the account session, a fresh wallet proof and explicit consent.
-- It lets the account read that wallet's runs through MCP (scope flofi.runs). It is never ownership or financial authority.
CREATE TABLE mcp_wallet_links (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  link_id text NOT NULL CHECK (link_id ~ '^wlk_[a-z2-7]{26}$'),
  account_id text NOT NULL,
  namespace text NOT NULL CHECK (namespace IN ('eip155', 'solana')),
  address text NOT NULL,
  proof text NOT NULL CHECK (proof IN ('EIP4361', 'SIWS')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (tenant_id, link_id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES mcp_accounts (tenant_id, account_id),
  CHECK ((namespace = 'eip155' AND address ~ '^0x[0-9a-f]{40}$' AND proof = 'EIP4361')
      OR (namespace = 'solana' AND address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND proof = 'SIWS')),
  CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX mcp_wallet_links_active ON mcp_wallet_links (tenant_id, account_id, namespace, address) WHERE revoked_at IS NULL;

-- Fixed-window counters for abuse limits. Keys are digests or opaque ids; no IP address is stored in clear.
CREATE TABLE mcp_rate_limits (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  bucket text NOT NULL CHECK (bucket ~ '^[a-z][a-z0-9_.:-]{2,127}$'),
  window_start timestamptz NOT NULL,
  count integer NOT NULL CHECK (count >= 1),
  PRIMARY KEY (tenant_id, bucket, window_start)
);
