-- SPDX-License-Identifier: AGPL-3.0-only
-- AUTOMATION-001A: durable scheduled strategy prompts. A rule can make an owner-confirmation event due;
-- it never stores a signing key, signature or delegated transaction authority.
CREATE TABLE automation_rules (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  automation_id text NOT NULL CHECK (automation_id ~ '^auto-[0-9a-f]{24}$'),
  owner_account text NOT NULL CHECK (owner_account ~ '^0x[0-9a-f]{40}$'),
  state text NOT NULL CHECK (state IN ('ACTIVE', 'PAUSED')),
  spec jsonb NOT NULL CHECK (jsonb_typeof(spec) = 'object'),
  workflow_hash text NOT NULL CHECK (workflow_hash ~ '^0x[0-9a-f]{64}$'),
  next_evaluation_at timestamptz NOT NULL,
  last_evaluated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, automation_id)
);
CREATE INDEX automation_rules_owner ON automation_rules (tenant_id, owner_account, created_at DESC);
CREATE INDEX automation_rules_due ON automation_rules (tenant_id, next_evaluation_at, automation_id) WHERE state = 'ACTIVE';

CREATE TABLE automation_events (
  tenant_id text NOT NULL,
  event_id text NOT NULL CHECK (event_id ~ '^evt-[0-9a-f]{24}$'),
  automation_id text NOT NULL,
  owner_account text NOT NULL CHECK (owner_account ~ '^0x[0-9a-f]{40}$'),
  occurrence_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING_OWNER', 'OPENED', 'DISMISSED', 'EXPIRED')),
  strategy jsonb NOT NULL CHECK (jsonb_typeof(strategy) = 'object'),
  workflow_hash text NOT NULL CHECK (workflow_hash ~ '^0x[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  opened_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, event_id),
  UNIQUE (tenant_id, automation_id, occurrence_at),
  FOREIGN KEY (tenant_id, automation_id) REFERENCES automation_rules (tenant_id, automation_id)
);
CREATE INDEX automation_events_owner ON automation_events (tenant_id, owner_account, created_at DESC);
CREATE INDEX automation_events_pending ON automation_events (tenant_id, expires_at, event_id)
  WHERE status IN ('PENDING_OWNER', 'OPENED');
