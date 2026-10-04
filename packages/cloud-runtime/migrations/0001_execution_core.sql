-- SPDX-License-Identifier: AGPL-3.0-only
-- BUILD-CLOUD-001 0001: durable execution core. PostgreSQL is the authority for execution state.
-- Every table is tenant-scoped; every key starts with tenant_id. Append-only history tables reject
-- UPDATE/DELETE. Mutable aggregates carry an explicit version. No vendor-specific extension is used.

CREATE FUNCTION reject_append_only_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY_VIOLATION: % on %', TG_OP, TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TABLE tenants (
  tenant_id text PRIMARY KEY CHECK (tenant_id ~ '^[a-z0-9][a-z0-9_-]{0,62}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO tenants (tenant_id) VALUES ('default');

-- Durable logs: the exact bytes the file store kept per run snapshot log or economic intent.
CREATE TABLE execution_logs (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  namespace text NOT NULL CHECK (namespace ~ '^[a-z][a-z0-9-]{0,62}$'),
  name text NOT NULL CHECK (name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$' AND position('..' IN name) = 0),
  kind text NOT NULL CHECK (kind IN ('RUN', 'INTENT')),
  version bigint NOT NULL CHECK (version >= 1),
  segment_count integer NOT NULL CHECK (segment_count = version),
  byte_length integer NOT NULL CHECK (byte_length > 0 AND byte_length <= 16777216),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, namespace, name)
);

-- One immutable row per strict extension. Concatenated in seq order they reproduce the log exactly.
CREATE TABLE execution_log_segments (
  tenant_id text NOT NULL,
  namespace text NOT NULL,
  name text NOT NULL,
  seq integer NOT NULL CHECK (seq >= 0),
  bytes bytea NOT NULL CHECK (octet_length(bytes) > 0),
  segment_sha256 text NOT NULL CHECK (segment_sha256 ~ '^[0-9a-f]{64}$'),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, namespace, name, seq),
  FOREIGN KEY (tenant_id, namespace, name) REFERENCES execution_logs (tenant_id, namespace, name)
);
CREATE TRIGGER execution_log_segments_append_only BEFORE UPDATE OR DELETE ON execution_log_segments
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

CREATE TABLE workflows (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  workflow_id text NOT NULL CHECK (length(workflow_id) BETWEEN 1 AND 128),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, workflow_id)
);

-- Projection of the latest run snapshot, written in the SAME transaction as the snapshot itself.
CREATE TABLE execution_runs (
  tenant_id text NOT NULL,
  run_id text NOT NULL CHECK (run_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  namespace text NOT NULL,
  log_name text NOT NULL,
  workflow_id text NOT NULL,
  flow text NOT NULL CHECK (flow ~ '^[a-z][a-z0-9-]{0,62}$'),
  status text NOT NULL CHECK (status ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  provenance text NOT NULL CHECK (provenance IN ('MOCKED', 'PUBLIC_TESTNET')),
  owner_account text CHECK (owner_account IS NULL OR owner_account ~ '^0x[0-9a-f]{40}$'),
  recovery_of text,
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{1,80}$'),
  needs_observation boolean NOT NULL,
  attention_required boolean NOT NULL DEFAULT false,
  has_evidence boolean NOT NULL,
  log_version bigint NOT NULL CHECK (log_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, run_id),
  UNIQUE (tenant_id, namespace, log_name),
  FOREIGN KEY (tenant_id, namespace, log_name) REFERENCES execution_logs (tenant_id, namespace, name),
  FOREIGN KEY (tenant_id, workflow_id) REFERENCES workflows (tenant_id, workflow_id),
  FOREIGN KEY (tenant_id, recovery_of) REFERENCES execution_runs (tenant_id, run_id)
);
CREATE INDEX execution_runs_history ON execution_runs (tenant_id, updated_at DESC, run_id DESC);
CREATE INDEX execution_runs_workflow ON execution_runs (tenant_id, workflow_id, created_at DESC);
CREATE INDEX execution_runs_observation ON execution_runs (tenant_id, run_id) WHERE needs_observation;

CREATE TABLE execution_attempts (
  tenant_id text NOT NULL,
  attempt_id text NOT NULL CHECK (attempt_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$'),
  run_id text NOT NULL,
  step text NOT NULL CHECK (step ~ '^[A-Z][A-Z0-9_]{0,31}$'),
  state text NOT NULL CHECK (state IN ('PREPARED', 'CANCELLED', 'SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'NOT_FOUND',
    'PENDING', 'CONFIRMED', 'REVERTED', 'RECONCILIATION_REQUIRED')),
  nonce text CHECK (nonce IS NULL OR nonce ~ '^(0|[1-9][0-9]*)$'),
  transaction_hash text CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$'),
  prepared_at_block bigint CHECK (prepared_at_block IS NULL OR prepared_at_block >= 0),
  reconciled boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, attempt_id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES execution_runs (tenant_id, run_id),
  CHECK (NOT reconciled OR (state = 'CONFIRMED' AND transaction_hash IS NOT NULL))
);
CREATE INDEX execution_attempts_run ON execution_attempts (tenant_id, run_id);
CREATE INDEX execution_attempts_transaction ON execution_attempts (tenant_id, transaction_hash) WHERE transaction_hash IS NOT NULL;

-- Append-only projection of the hash-chained execution journal.
CREATE TABLE journal_entries (
  tenant_id text NOT NULL,
  run_id text NOT NULL,
  sequence integer NOT NULL CHECK (sequence >= 0),
  entry_hash text NOT NULL CHECK (entry_hash ~ '^0x[0-9a-f]{64}$'),
  level text NOT NULL,
  entity_id text NOT NULL,
  attempt_id text,
  from_state text,
  to_state text NOT NULL,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, run_id, sequence),
  FOREIGN KEY (tenant_id, run_id) REFERENCES execution_runs (tenant_id, run_id)
);
CREATE TRIGGER journal_entries_append_only BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

-- Fenced leases. Rows are never deleted, so a key's fence only increases.
CREATE TABLE execution_leases (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  namespace text NOT NULL CHECK (namespace ~ '^[a-z][a-z0-9-]{0,62}$'),
  lease_key text NOT NULL CHECK (lease_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$'),
  owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 200),
  fence bigint NOT NULL CHECK (fence >= 1),
  acquired_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, namespace, lease_key)
);

-- Transactional outbox and durable work queue. Delivery is at-least-once; handlers are idempotent.
CREATE TABLE work_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9.-]{0,62}$'),
  dedupe_key text NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 200),
  run_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL CHECK (state IN ('READY', 'LEASED', 'DONE', 'DEAD')),
  deliveries integer NOT NULL DEFAULT 0 CHECK (deliveries >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 200),
  trace_parent text CHECK (trace_parent IS NULL OR trace_parent ~ '^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((state = 'LEASED') = (lease_token IS NOT NULL)),
  CHECK (state <> 'LEASED' OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK ((state IN ('DONE', 'DEAD')) = (completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX work_items_open_dedupe ON work_items (tenant_id, kind, dedupe_key) WHERE state IN ('READY', 'LEASED');
CREATE INDEX work_items_ready ON work_items (available_at, id) WHERE state = 'READY';
CREATE INDEX work_items_leased ON work_items (lease_expires_at) WHERE state = 'LEASED';
CREATE INDEX work_items_run ON work_items (tenant_id, run_id, created_at DESC) WHERE run_id IS NOT NULL;
CREATE INDEX work_items_completed ON work_items (completed_at) WHERE state = 'DONE';

-- HTTP request idempotency. A crashed request's claim expires so a retry can take it over.
CREATE TABLE api_idempotency (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  scope text NOT NULL CHECK (scope ~ '^[a-z][a-z0-9./-]{0,127}$'),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('IN_PROGRESS', 'COMPLETED')),
  response jsonb,
  claimed_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, scope, idempotency_key),
  CHECK ((state = 'COMPLETED') = (response IS NOT NULL))
);
CREATE INDEX api_idempotency_expiry ON api_idempotency (expires_at);

-- Evidence object metadata. The bytes live in the EvidenceStore under a content address.
CREATE TABLE evidence_objects (
  tenant_id text NOT NULL,
  run_id text NOT NULL,
  bundle_hash text NOT NULL CHECK (bundle_hash ~ '^0x[0-9a-f]{64}$'),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  byte_length bigint NOT NULL CHECK (byte_length > 0),
  media_type text NOT NULL CHECK (media_type = 'application/json'),
  store_id text NOT NULL CHECK (store_id ~ '^[a-z][a-z0-9-]{0,62}$'),
  object_key text NOT NULL CHECK (length(object_key) BETWEEN 1 AND 300 AND object_key ~ '^[a-z0-9/._-]+$'),
  environment text NOT NULL CHECK (environment IN ('MOCKED', 'FORK_REPRODUCED', 'TESTNET_EXECUTED', 'MAINNET_EXECUTED')),
  outcome text NOT NULL CHECK (outcome IN ('CONFIRMED_NOT_RECONCILED', 'RECONCILED', 'INCONCLUSIVE', 'DIVERGENT')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, run_id, bundle_hash),
  FOREIGN KEY (tenant_id, run_id) REFERENCES execution_runs (tenant_id, run_id)
);
CREATE TRIGGER evidence_objects_append_only BEFORE UPDATE OR DELETE ON evidence_objects
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
