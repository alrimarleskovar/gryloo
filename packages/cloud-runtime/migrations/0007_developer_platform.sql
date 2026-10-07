-- SPDX-License-Identifier: AGPL-3.0-only
-- BUILD-DEVELOPER-001 0007: the FloFi Developer Platform — Developer-only persistence. Every key starts with tenant_id. Credentials and
-- secrets are never stored: API keys are 32-byte keyed digests; webhook signing secrets are derived from the deployment's developer
-- secret and never written. Nothing here is financial authority: a developer project, its API keys, strategies, approvals, events and
-- webhooks never sign, submit or approve anything — the end user's own wallet does, in FloFi's existing /approve flow.
-- The shared approval-handoff table (mcp_handoffs, migration 0006) is only bound to, never altered: DEVELOPER_PROJECT handoffs gain a
-- binding row and a database check that they carry the exact workflow hash of an immutable strategy of the same project.

-- A developer project (an integrator), created by the operator. Disabling it disables every key at once.
CREATE TABLE developer_projects (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  project_id text NOT NULL CHECK (project_id ~ '^prj_[a-z2-7]{26}$'),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 64 AND display_name !~ '[[:cntrl:]]' AND display_name = btrim(display_name)),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  PRIMARY KEY (tenant_id, project_id),
  CHECK ((status = 'DISABLED') = (disabled_at IS NOT NULL))
);

-- Server-side API keys. Only the keyed digest is stored; `hint` is the key's last four characters for display.
CREATE TABLE developer_api_keys (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  key_id text NOT NULL CHECK (key_id ~ '^key_[a-z2-7]{26}$'),
  project_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  key_digest bytea NOT NULL CHECK (octet_length(key_digest) = 32),
  hint text NOT NULL CHECK (hint ~ '^[A-Za-z0-9_-]{4}$'),
  scopes text[] NOT NULL CHECK (cardinality(scopes) >= 1 AND scopes <@ ARRAY['strategies', 'approvals', 'executions', 'webhooks']::text[]),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_used_at timestamptz,
  PRIMARY KEY (tenant_id, key_id),
  UNIQUE (tenant_id, key_digest),
  FOREIGN KEY (tenant_id, project_id) REFERENCES developer_projects (tenant_id, project_id),
  CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);
CREATE INDEX developer_api_keys_project ON developer_api_keys (tenant_id, project_id, created_at DESC);

-- Immutable developer strategies: the canonical StrategySpec, its workflow hash and plan at creation. A changed strategy is a new row.
CREATE TABLE developer_strategies (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  strategy_id text NOT NULL CHECK (strategy_id ~ '^str_[a-z2-7]{26}$'),
  project_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  strategy jsonb NOT NULL CHECK (jsonb_typeof(strategy) = 'object' AND octet_length(strategy::text) <= 16384),
  workflow_hash text NOT NULL CHECK (workflow_hash ~ '^0x[0-9a-f]{64}$'),
  engine_version text NOT NULL CHECK (engine_version ~ '^[a-z0-9][a-z0-9.+-]{0,63}$'),
  funds_class text NOT NULL CHECK (funds_class IN ('TEST_FUNDS', 'REAL_FUNDS')),
  network_environment text NOT NULL CHECK (network_environment ~ '^[A-Z][A-Z_]{2,31}$'),
  plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object' AND octet_length(plan::text) <= 16384),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, strategy_id),
  UNIQUE (tenant_id, project_id, environment, strategy_id, workflow_hash),
  FOREIGN KEY (tenant_id, project_id) REFERENCES developer_projects (tenant_id, project_id),
  -- Sandbox credentials compose test-funds strategies only (mainnet never becomes reachable through a sandbox key).
  CHECK (environment <> 'sandbox' OR funds_class = 'TEST_FUNDS')
);
CREATE INDEX developer_strategies_project ON developer_strategies (tenant_id, project_id, environment, created_at DESC);
CREATE FUNCTION developer_strategy_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'DEVELOPER_STRATEGY_IMMUTABLE' USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
CREATE TRIGGER developer_strategies_immutable BEFORE UPDATE ON developer_strategies FOR EACH ROW EXECUTE FUNCTION developer_strategy_immutable();

-- The binding of a DEVELOPER_PROJECT approval handoff to its project, environment and immutable strategy revision. It is written by the
-- database itself, atomically with the handoff (trigger below): a handoff whose strategy is not the project's, or whose workflow hash is
-- not that strategy's, cannot exist. `sync_state` tracks only webhook-event derivation; the binding itself never changes.
CREATE TABLE developer_approvals (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  handoff_id text NOT NULL,
  project_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  strategy_id text NOT NULL,
  workflow_hash text NOT NULL,
  sync_state text NOT NULL DEFAULT 'OPEN' CHECK (sync_state IN ('OPEN', 'DONE')),
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, handoff_id),
  FOREIGN KEY (tenant_id, handoff_id) REFERENCES mcp_handoffs (tenant_id, handoff_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, project_id, environment, strategy_id, workflow_hash)
    REFERENCES developer_strategies (tenant_id, project_id, environment, strategy_id, workflow_hash)
);
CREATE INDEX developer_approvals_sync ON developer_approvals (tenant_id, sync_state, synced_at NULLS FIRST, created_at);
CREATE INDEX developer_approvals_project ON developer_approvals (tenant_id, project_id, environment, created_at DESC);
CREATE FUNCTION developer_approval_binding_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.handoff_id IS DISTINCT FROM OLD.handoff_id OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.environment IS DISTINCT FROM OLD.environment OR NEW.strategy_id IS DISTINCT FROM OLD.strategy_id OR NEW.workflow_hash IS DISTINCT FROM OLD.workflow_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'DEVELOPER_APPROVAL_IMMUTABLE' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER developer_approvals_immutable BEFORE UPDATE ON developer_approvals FOR EACH ROW EXECUTE FUNCTION developer_approval_binding_immutable();

-- Binds every DEVELOPER_PROJECT handoff as it is inserted (requester_id = '<project>.<environment>', requester_context.strategyId): the
-- strategy must belong to that project and environment and carry exactly the handoff's workflow hash. Other requester kinds (MCP
-- accounts, channel conversations) are untouched.
CREATE FUNCTION developer_bind_approval() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_project text := split_part(NEW.requester_id, '.', 1);
  v_environment text := split_part(NEW.requester_id, '.', 2);
  v_strategy text := NEW.requester_context ->> 'strategyId';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM developer_strategies s WHERE s.tenant_id = NEW.tenant_id AND s.project_id = v_project AND s.environment = v_environment
      AND s.strategy_id = v_strategy AND s.workflow_hash = NEW.workflow_hash) THEN
    RAISE EXCEPTION 'DEVELOPER_APPROVAL_UNBOUND' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  INSERT INTO developer_approvals (tenant_id, handoff_id, project_id, environment, strategy_id, workflow_hash, created_at)
    VALUES (NEW.tenant_id, NEW.handoff_id, v_project, v_environment, v_strategy, NEW.workflow_hash, NEW.created_at);
  RETURN NULL;
END;
$$;
CREATE TRIGGER developer_handoff_binding AFTER INSERT ON mcp_handoffs FOR EACH ROW WHEN (NEW.requester_kind = 'DEVELOPER_PROJECT')
  EXECUTE FUNCTION developer_bind_approval();

-- Webhook notification events, derived from approval and execution state and deduplicated per project and environment.
CREATE TABLE developer_events (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  event_id text NOT NULL CHECK (event_id ~ '^evt_[a-z2-7]{26}$'),
  project_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  type text NOT NULL CHECK (type IN ('approval.claimed', 'approval.applied', 'approval.ended', 'execution.started', 'execution.failed', 'execution.reconciled')),
  dedupe_key text NOT NULL CHECK (length(dedupe_key) BETWEEN 8 AND 200),
  approval_id text NOT NULL,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 16384),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, event_id),
  UNIQUE (tenant_id, project_id, environment, dedupe_key),
  FOREIGN KEY (tenant_id, project_id) REFERENCES developer_projects (tenant_id, project_id)
);
CREATE INDEX developer_events_age ON developer_events (tenant_id, created_at);

-- Webhook endpoints. The signing secret is derived (never stored); a deleted endpoint is never revived and its id never reused.
CREATE TABLE developer_webhook_endpoints (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  endpoint_id text NOT NULL CHECK (endpoint_id ~ '^whe_[a-z2-7]{26}$'),
  project_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  url text NOT NULL CHECK (length(url) BETWEEN 10 AND 2048 AND (url ~ '^https://' OR url ~ '^http://(127\.0\.0\.1|localhost|\[::1\])[:/]')),
  event_types text[] NOT NULL DEFAULT '{}' CHECK (event_types <@ ARRAY['approval.claimed', 'approval.applied', 'approval.ended', 'execution.started',
    'execution.failed', 'execution.reconciled']::text[]),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DELETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (tenant_id, endpoint_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES developer_projects (tenant_id, project_id),
  CHECK ((status = 'DELETED') = (deleted_at IS NOT NULL))
);
CREATE INDEX developer_webhook_endpoints_project ON developer_webhook_endpoints (tenant_id, project_id, environment, status);

-- One delivery per event and endpoint: claimed with a lease, retried with bounded backoff, settled once.
CREATE TABLE developer_webhook_deliveries (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  delivery_id text NOT NULL CHECK (delivery_id ~ '^whd_[a-z2-7]{26}$'),
  project_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  endpoint_id text NOT NULL,
  event_id text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCEEDED', 'DEAD')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  next_attempt_at timestamptz NOT NULL,
  lease_token text CHECK (lease_token IS NULL OR lease_token ~ '^[a-f0-9]{32}$'),
  leased_until timestamptz,
  last_attempt_at timestamptz,
  last_status integer CHECK (last_status IS NULL OR last_status BETWEEN 0 AND 999),
  last_error text CHECK (last_error IS NULL OR last_error ~ '^[A-Z][A-Z0-9_]{2,80}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, delivery_id),
  UNIQUE (tenant_id, endpoint_id, event_id),
  FOREIGN KEY (tenant_id, endpoint_id) REFERENCES developer_webhook_endpoints (tenant_id, endpoint_id),
  FOREIGN KEY (tenant_id, event_id) REFERENCES developer_events (tenant_id, event_id) ON DELETE CASCADE
);
CREATE INDEX developer_webhook_deliveries_due ON developer_webhook_deliveries (tenant_id, status, next_attempt_at);
CREATE INDEX developer_webhook_deliveries_project ON developer_webhook_deliveries (tenant_id, project_id, environment, created_at DESC);

-- Daily usage counters (metering for future plans; no billing).
CREATE TABLE developer_usage (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  project_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  day date NOT NULL,
  metric text NOT NULL CHECK (metric ~ '^[a-z][a-z0-9_.]{2,63}$'),
  dimension text NOT NULL DEFAULT '' CHECK (length(dimension) <= 128),
  count bigint NOT NULL CHECK (count >= 1),
  PRIMARY KEY (tenant_id, project_id, environment, day, metric, dimension),
  FOREIGN KEY (tenant_id, project_id) REFERENCES developer_projects (tenant_id, project_id)
);
