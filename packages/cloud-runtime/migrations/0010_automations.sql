-- SPDX-License-Identifier: AGPL-3.0-only
-- BUILD-AUTOMATION-001 0010: FloFi Automations — automated evaluation and owner-confirmed execution (CONFIRM_EACH_TIME).
-- Nothing here is financial authority. A rule describes WHEN FloFi evaluates and WHAT it would propose; an occurrence is one
-- proposal waiting for its owner; the owner's approval still happens in the shared approval model (mcp_handoffs) and FloFi's existing
-- flow (fresh simulation, Strategy Manifest Review, the owner's own wallet signature). No key, signature, quote, transaction or
-- approval secret is stored here. Every row is tenant-scoped and owner-scoped (namespace + account of a PROVEN wallet).

-- 1. The shared approval model gains one requester kind: an automation rule of a verified owner. Nothing else in the handoff schema
--    changes; its transition rules (0005/0006) apply unchanged.
ALTER TABLE mcp_handoffs DROP CONSTRAINT mcp_handoffs_requester_kind_check;
ALTER TABLE mcp_handoffs ADD CONSTRAINT mcp_handoffs_requester_kind_check
  CHECK (requester_kind IN ('MCP_ACCOUNT', 'DEVELOPER_PROJECT', 'CHANNEL_CONVERSATION', 'AUTOMATION_RULE'));

-- 2. Rules. The bound action is a canonical StrategySpec with its workflow hash and the engine version that composed it; a saved
--    workflow (0008) it came from is recorded by id, hash and version only (drift is detected, never followed). The execution mode
--    can only be CONFIRM_EACH_TIME.
CREATE TABLE automation_rules (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  rule_id text NOT NULL CHECK (rule_id ~ '^aut_[a-z2-7]{26}$'),
  owner_namespace text NOT NULL CHECK (owner_namespace IN ('eip155', 'solana')),
  owner_account text NOT NULL CHECK (
    (owner_namespace = 'eip155' AND owner_account ~ '^0x[0-9a-f]{40}$') OR
    (owner_namespace = 'solana' AND owner_account ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  kind text NOT NULL CHECK (kind IN ('SCHEDULED_DCA', 'PRICE_TRIGGER', 'DAILY_WATCH')),
  state text NOT NULL CHECK (state IN ('ACTIVE', 'PAUSED', 'EXPIRED', 'ARCHIVED')),
  execution_mode text NOT NULL DEFAULT 'CONFIRM_EACH_TIME' CHECK (execution_mode = 'CONFIRM_EACH_TIME'),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object' AND octet_length(definition::text) <= 8192),
  action_strategy jsonb CHECK (action_strategy IS NULL OR (jsonb_typeof(action_strategy) = 'object' AND octet_length(action_strategy::text) <= 4096)),
  action_workflow_hash text CHECK (action_workflow_hash IS NULL OR action_workflow_hash ~ '^0x[0-9a-f]{64}$'),
  engine_version text CHECK (engine_version IS NULL OR engine_version ~ '^[a-z0-9][a-z0-9.+-]{0,63}$'),
  source_workflow_id text CHECK (source_workflow_id IS NULL OR source_workflow_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  source_workflow_hash text CHECK (source_workflow_hash IS NULL OR source_workflow_hash ~ '^0x[0-9a-f]{64}$'),
  source_workflow_version bigint CHECK (source_workflow_version IS NULL OR source_workflow_version >= 1),
  timezone text NOT NULL CHECK (length(timezone) BETWEEN 1 AND 64),
  next_evaluation_at timestamptz,
  -- The last schedule slot handled (scheduled rules): the missed-run policy counts from here.
  schedule_cursor timestamptz,
  last_evaluation_at timestamptz,
  last_outcome text CHECK (last_outcome IS NULL OR last_outcome ~ '^[A-Z][A-Z0-9_]{2,80}$'),
  last_observation jsonb CHECK (last_observation IS NULL OR (jsonb_typeof(last_observation) = 'object' AND octet_length(last_observation::text) <= 4096)),
  trigger_state jsonb NOT NULL DEFAULT '{"armed": null, "epoch": 0, "cooldownUntil": null, "lastTriggeredAt": null}'::jsonb
    CHECK (jsonb_typeof(trigger_state) = 'object' AND octet_length(trigger_state::text) <= 1024),
  attention text CHECK (attention IS NULL OR attention IN ('WORKFLOW_CHANGED', 'STRATEGY_STALE')),
  expires_at timestamptz,
  -- The owner's optimistic-concurrency token: every owner change is a compare-and-set on it. The evaluator never changes it.
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1 AND version <= 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, rule_id),
  UNIQUE (tenant_id, rule_id, owner_namespace, owner_account),
  CHECK ((action_strategy IS NULL) = (action_workflow_hash IS NULL) AND (action_strategy IS NULL) = (engine_version IS NULL)),
  CHECK (kind <> 'SCHEDULED_DCA' OR action_strategy IS NOT NULL),
  CHECK (kind <> 'DAILY_WATCH' OR action_strategy IS NULL),
  CHECK ((source_workflow_id IS NULL) = (source_workflow_hash IS NULL) AND (source_workflow_id IS NULL) = (source_workflow_version IS NULL)),
  CHECK (source_workflow_id IS NULL OR action_strategy IS NOT NULL),
  CHECK (state <> 'ACTIVE' OR next_evaluation_at IS NOT NULL)
);
CREATE INDEX automation_rules_owner ON automation_rules (tenant_id, owner_namespace, owner_account, created_at DESC);
CREATE INDEX automation_rules_due ON automation_rules (tenant_id, next_evaluation_at) WHERE state = 'ACTIVE';

-- Who and what a rule is never changes; its state moves only along ACTIVE ⇄ PAUSED → EXPIRED → ARCHIVED (ARCHIVED is terminal).
CREATE FUNCTION automation_rule_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.rule_id IS DISTINCT FROM OLD.rule_id OR NEW.owner_namespace IS DISTINCT FROM OLD.owner_namespace
     OR NEW.owner_account IS DISTINCT FROM OLD.owner_account OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.execution_mode IS DISTINCT FROM OLD.execution_mode
     OR NEW.timezone IS DISTINCT FROM OLD.timezone OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'AUTOMATION_RULE_IMMUTABLE' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.state = 'ARCHIVED' THEN
    RAISE EXCEPTION 'AUTOMATION_RULE_ARCHIVED' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.state <> OLD.state AND NOT (
       (OLD.state = 'ACTIVE' AND NEW.state IN ('PAUSED', 'EXPIRED', 'ARCHIVED'))
    OR (OLD.state = 'PAUSED' AND NEW.state IN ('ACTIVE', 'EXPIRED', 'ARCHIVED'))
    OR (OLD.state = 'EXPIRED' AND NEW.state = 'ARCHIVED')) THEN
    RAISE EXCEPTION 'AUTOMATION_RULE_TRANSITION_INVALID' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.version < OLD.version THEN
    RAISE EXCEPTION 'AUTOMATION_RULE_VERSION_INVALID' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER automation_rule_transition BEFORE UPDATE ON automation_rules FOR EACH ROW EXECUTE FUNCTION automation_rule_transition();

-- 3. Occurrences: one immutable logical occurrence per trigger event. (rule, trigger_key) is unique, so at-least-once evaluation
--    yields at most one occurrence per schedule slot, price crossing or watch report. The owner is the rule's owner (composite key).
--    The strategy is a snapshot of the binding at creation; the owner's approval is a handoff in the shared model.
CREATE TABLE automation_occurrences (
  tenant_id text NOT NULL,
  occurrence_id text NOT NULL CHECK (occurrence_id ~ '^occ_[a-z2-7]{26}$'),
  rule_id text NOT NULL,
  owner_namespace text NOT NULL,
  owner_account text NOT NULL,
  trigger_key text NOT NULL CHECK (trigger_key ~ '^(slot|price|watch):[A-Za-z0-9:._-]{1,96}$'),
  kind text NOT NULL CHECK (kind IN ('SCHEDULE', 'PRICE', 'WATCH')),
  state text NOT NULL CHECK (state IN ('PENDING_OWNER', 'APPROVAL_CREATED', 'COMPLETED', 'DISMISSED', 'EXPIRED')),
  strategy jsonb CHECK (strategy IS NULL OR (jsonb_typeof(strategy) = 'object' AND octet_length(strategy::text) <= 4096)),
  workflow_hash text CHECK (workflow_hash IS NULL OR workflow_hash ~ '^0x[0-9a-f]{64}$'),
  spend_asset text CHECK (spend_asset IS NULL OR spend_asset ~ '^[A-Za-z]{2,10}$'),
  spend_amount numeric(48, 18) CHECK (spend_amount IS NULL OR spend_amount > 0),
  observation jsonb CHECK (observation IS NULL OR (jsonb_typeof(observation) = 'object' AND octet_length(observation::text) <= 4096)),
  due_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  handoff_id text CHECK (handoff_id IS NULL OR handoff_id ~ '^apr_[a-z2-7]{26}$'),
  outcome text CHECK (outcome IS NULL OR outcome ~ '^[A-Z][A-Z0-9_]{2,80}$'),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, occurrence_id),
  UNIQUE (tenant_id, rule_id, trigger_key),
  FOREIGN KEY (tenant_id, rule_id, owner_namespace, owner_account) REFERENCES automation_rules (tenant_id, rule_id, owner_namespace, owner_account),
  CHECK (expires_at > due_at),
  CHECK ((strategy IS NULL) = (workflow_hash IS NULL)),
  CHECK ((spend_asset IS NULL) = (spend_amount IS NULL) AND (spend_asset IS NULL OR strategy IS NOT NULL)),
  CHECK (kind <> 'WATCH' OR strategy IS NULL),
  CHECK (state <> 'APPROVAL_CREATED' OR (handoff_id IS NOT NULL AND strategy IS NOT NULL)),
  CHECK (state IN ('PENDING_OWNER', 'APPROVAL_CREATED') OR decided_at IS NOT NULL)
);
CREATE INDEX automation_occurrences_owner ON automation_occurrences (tenant_id, owner_namespace, owner_account, created_at DESC);
CREATE INDEX automation_occurrences_rule ON automation_occurrences (tenant_id, rule_id, created_at DESC);
CREATE INDEX automation_occurrences_open ON automation_occurrences (tenant_id, expires_at) WHERE state IN ('PENDING_OWNER', 'APPROVAL_CREATED');

-- Forward-only: PENDING_OWNER → APPROVAL_CREATED → COMPLETED; open → DISMISSED | EXPIRED; a watch report or alert PENDING_OWNER →
-- COMPLETED | DISMISSED; APPROVAL_CREATED → APPROVAL_CREATED only to replace an ended handoff. Terminal states never change.
CREATE FUNCTION automation_occurrence_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.occurrence_id IS DISTINCT FROM OLD.occurrence_id OR NEW.rule_id IS DISTINCT FROM OLD.rule_id
     OR NEW.owner_namespace IS DISTINCT FROM OLD.owner_namespace OR NEW.owner_account IS DISTINCT FROM OLD.owner_account
     OR NEW.trigger_key IS DISTINCT FROM OLD.trigger_key OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.strategy IS DISTINCT FROM OLD.strategy
     OR NEW.workflow_hash IS DISTINCT FROM OLD.workflow_hash OR NEW.spend_asset IS DISTINCT FROM OLD.spend_asset OR NEW.spend_amount IS DISTINCT FROM OLD.spend_amount
     OR NEW.observation IS DISTINCT FROM OLD.observation OR NEW.due_at IS DISTINCT FROM OLD.due_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'AUTOMATION_OCCURRENCE_IMMUTABLE' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.state IN ('COMPLETED', 'DISMISSED', 'EXPIRED') THEN
    RAISE EXCEPTION 'AUTOMATION_OCCURRENCE_TERMINAL' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NOT (
       (OLD.state = 'PENDING_OWNER' AND NEW.state IN ('PENDING_OWNER', 'APPROVAL_CREATED', 'COMPLETED', 'DISMISSED', 'EXPIRED'))
    OR (OLD.state = 'APPROVAL_CREATED' AND NEW.state IN ('APPROVAL_CREATED', 'COMPLETED', 'DISMISSED', 'EXPIRED'))) THEN
    RAISE EXCEPTION 'AUTOMATION_OCCURRENCE_TRANSITION_INVALID' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.handoff_id IS DISTINCT FROM OLD.handoff_id AND NEW.state <> 'APPROVAL_CREATED' THEN
    RAISE EXCEPTION 'AUTOMATION_OCCURRENCE_TRANSITION_INVALID' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER automation_occurrence_transition BEFORE UPDATE ON automation_occurrences FOR EACH ROW EXECUTE FUNCTION automation_occurrence_transition();

-- 4. History: content-free evaluation records (closed outcome codes, opaque ids, the public observation and its provenance).
CREATE TABLE automation_evaluations (
  tenant_id text NOT NULL,
  evaluation_id bigint GENERATED ALWAYS AS IDENTITY,
  rule_id text NOT NULL,
  at timestamptz NOT NULL,
  outcome text NOT NULL CHECK (outcome ~ '^[A-Z][A-Z0-9_]{2,80}$'),
  trigger_key text CHECK (trigger_key IS NULL OR trigger_key ~ '^(slot|price|watch):[A-Za-z0-9:._-]{1,96}$'),
  occurrence_id text CHECK (occurrence_id IS NULL OR occurrence_id ~ '^occ_[a-z2-7]{26}$'),
  observation jsonb CHECK (observation IS NULL OR (jsonb_typeof(observation) = 'object' AND octet_length(observation::text) <= 4096)),
  detail jsonb CHECK (detail IS NULL OR (jsonb_typeof(detail) = 'object' AND octet_length(detail::text) <= 1024)),
  PRIMARY KEY (tenant_id, evaluation_id),
  FOREIGN KEY (tenant_id, rule_id) REFERENCES automation_rules (tenant_id, rule_id)
);
CREATE INDEX automation_evaluations_rule ON automation_evaluations (tenant_id, rule_id, at DESC, evaluation_id DESC);

-- 5. Notifications through a channel (Channel Core, 0009). A one-time link code (keyed digest only, short-lived, consumed once) links
--    a channel conversation to an owner; the conversation keeps its sealed send address while the link lives (`retain_until`). A
--    notification record is delivery bookkeeping only: it never changes an occurrence.
CREATE TABLE automation_link_codes (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  code_digest bytea NOT NULL CHECK (octet_length(code_digest) = 32),
  owner_namespace text NOT NULL CHECK (owner_namespace IN ('eip155', 'solana')),
  owner_account text NOT NULL CHECK (length(owner_account) BETWEEN 32 AND 44),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, code_digest),
  CHECK (expires_at > created_at)
);
CREATE INDEX automation_link_codes_owner ON automation_link_codes (tenant_id, owner_namespace, owner_account, created_at DESC);

ALTER TABLE channel_conversations ADD COLUMN retain_until timestamptz;

CREATE TABLE automation_notification_targets (
  tenant_id text NOT NULL,
  owner_namespace text NOT NULL CHECK (owner_namespace IN ('eip155', 'solana')),
  owner_account text NOT NULL CHECK (length(owner_account) BETWEEN 32 AND 44),
  channel text NOT NULL CHECK (channel ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  conversation_id text NOT NULL,
  linked_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, owner_namespace, owner_account, channel),
  UNIQUE (tenant_id, conversation_id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES channel_conversations (tenant_id, conversation_id) ON DELETE CASCADE,
  CHECK (expires_at > linked_at)
);

CREATE TABLE automation_notifications (
  tenant_id text NOT NULL,
  occurrence_id text NOT NULL,
  channel text NOT NULL CHECK (channel ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  status text NOT NULL CHECK (status IN ('QUEUED', 'SKIPPED', 'FAILED')),
  code text CHECK (code IS NULL OR code ~ '^[A-Z][A-Z0-9_]{2,80}$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, occurrence_id, channel),
  FOREIGN KEY (tenant_id, occurrence_id) REFERENCES automation_occurrences (tenant_id, occurrence_id) ON DELETE CASCADE
);
