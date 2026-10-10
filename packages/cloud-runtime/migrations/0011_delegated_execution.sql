-- SPDX-License-Identifier: AGPL-3.0-only
-- BUILD-AUTOMATION-002 0011: generic delegated execution (`DELEGATED_WITH_LIMITS`), additive. Existing automation rules keep their meaning:
-- their execution mode stays CONFIRM_EACH_TIME, they have no authorization and they can never be upgraded in place.
--
-- What is stored: passkey PUBLIC keys; execution Credentials (owner wallets) and their grants (scope, the owner-signed delegation or
-- delegation transaction, an opaque session-signer REFERENCE and its public address — never key material); the DelegatedAuthorizationManifest
-- revisions with the owner's passkey assertion; delegated executions, their steps (exact signed submissions are persisted before any
-- broadcast), the budget ledger and an append-only audit trail. Every row is tenant- and owner-scoped.

-- 1. Automation rules: a second, explicit execution mode. A delegated rule names its authorization lineage; neither can change later.
ALTER TABLE automation_rules DROP CONSTRAINT automation_rules_execution_mode_check;
ALTER TABLE automation_rules ADD CONSTRAINT automation_rules_execution_mode_check CHECK (execution_mode IN ('CONFIRM_EACH_TIME', 'DELEGATED_WITH_LIMITS'));
ALTER TABLE automation_rules ADD COLUMN authorization_id text CHECK (authorization_id IS NULL OR authorization_id ~ '^dau_[a-z2-7]{26}$');
ALTER TABLE automation_rules ADD CONSTRAINT automation_rules_delegated_authorization CHECK (
  (execution_mode = 'DELEGATED_WITH_LIMITS') = (authorization_id IS NOT NULL)
  AND (execution_mode = 'CONFIRM_EACH_TIME' OR (action_strategy IS NOT NULL AND kind <> 'DAILY_WATCH')));
CREATE UNIQUE INDEX automation_rules_authorization ON automation_rules (tenant_id, authorization_id) WHERE authorization_id IS NOT NULL;

CREATE OR REPLACE FUNCTION automation_rule_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.rule_id IS DISTINCT FROM OLD.rule_id OR NEW.owner_namespace IS DISTINCT FROM OLD.owner_namespace
     OR NEW.owner_account IS DISTINCT FROM OLD.owner_account OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.execution_mode IS DISTINCT FROM OLD.execution_mode
     OR NEW.authorization_id IS DISTINCT FROM OLD.authorization_id
     OR NEW.timezone IS DISTINCT FROM OLD.timezone OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.definition IS DISTINCT FROM OLD.definition
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'AUTOMATION_RULE_IMMUTABLE' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW.action_strategy, NEW.action_workflow_hash, NEW.engine_version, NEW.source_workflow_id, NEW.source_workflow_hash, NEW.source_workflow_version)
       IS DISTINCT FROM (OLD.action_strategy, OLD.action_workflow_hash, OLD.engine_version, OLD.source_workflow_id, OLD.source_workflow_hash, OLD.source_workflow_version)
     AND NEW.version <= OLD.version THEN
    RAISE EXCEPTION 'AUTOMATION_RULE_VERSION_INVALID' USING ERRCODE = 'integrity_constraint_violation';
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

-- 2. Occurrences: a delegated rule's occurrence is handed to the executor (`DELEGATED`, terminal for the occurrence; the execution has its own
--    state machine). A delegated rule never creates an owner proposal and a confirm-each-time rule never creates a delegated occurrence: there
--    is no silent fallback in either direction.
ALTER TABLE automation_occurrences DROP CONSTRAINT automation_occurrences_state_check;
ALTER TABLE automation_occurrences ADD CONSTRAINT automation_occurrences_state_check
  CHECK (state IN ('PENDING_OWNER', 'APPROVAL_CREATED', 'COMPLETED', 'DISMISSED', 'EXPIRED', 'DELEGATED'));
ALTER TABLE automation_occurrences ADD CONSTRAINT automation_occurrences_delegated CHECK (state <> 'DELEGATED' OR (strategy IS NOT NULL AND handoff_id IS NULL));

CREATE FUNCTION automation_occurrence_mode() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mode text;
BEGIN
  SELECT execution_mode INTO mode FROM automation_rules WHERE tenant_id = NEW.tenant_id AND rule_id = NEW.rule_id;
  IF (mode = 'DELEGATED_WITH_LIMITS') <> (NEW.state = 'DELEGATED') THEN
    RAISE EXCEPTION 'AUTOMATION_OCCURRENCE_MODE_MISMATCH' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER automation_occurrence_mode BEFORE INSERT ON automation_occurrences FOR EACH ROW EXECUTE FUNCTION automation_occurrence_mode();

CREATE OR REPLACE FUNCTION automation_occurrence_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.occurrence_id IS DISTINCT FROM OLD.occurrence_id OR NEW.rule_id IS DISTINCT FROM OLD.rule_id
     OR NEW.owner_namespace IS DISTINCT FROM OLD.owner_namespace OR NEW.owner_account IS DISTINCT FROM OLD.owner_account
     OR NEW.trigger_key IS DISTINCT FROM OLD.trigger_key OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.strategy IS DISTINCT FROM OLD.strategy
     OR NEW.workflow_hash IS DISTINCT FROM OLD.workflow_hash OR NEW.spend_asset IS DISTINCT FROM OLD.spend_asset OR NEW.spend_amount IS DISTINCT FROM OLD.spend_amount
     OR NEW.observation IS DISTINCT FROM OLD.observation OR NEW.due_at IS DISTINCT FROM OLD.due_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'AUTOMATION_OCCURRENCE_IMMUTABLE' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.state IN ('COMPLETED', 'DISMISSED', 'EXPIRED', 'DELEGATED') THEN
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

-- 3. Passkeys (WebAuthn ES256): public keys only, bound to the owner who registered them under a fresh wallet sign-in.
CREATE TABLE passkey_credentials (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  passkey_id text NOT NULL CHECK (passkey_id ~ '^psk_[a-z2-7]{26}$'),
  owner_namespace text NOT NULL CHECK (owner_namespace IN ('eip155', 'solana')),
  owner_account text NOT NULL CHECK (
    (owner_namespace = 'eip155' AND owner_account ~ '^0x[0-9a-f]{40}$') OR
    (owner_namespace = 'solana' AND owner_account ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')),
  credential_id text NOT NULL CHECK (credential_id ~ '^[A-Za-z0-9_-]+$' AND length(credential_id) BETWEEN 22 AND 1400),
  public_key_spki bytea NOT NULL CHECK (octet_length(public_key_spki) = 91),
  algorithm integer NOT NULL CHECK (algorithm = -7),
  rp_id text NOT NULL CHECK (length(rp_id) BETWEEN 1 AND 253),
  origin text NOT NULL CHECK (length(origin) BETWEEN 8 AND 300),
  sign_count bigint NOT NULL DEFAULT 0 CHECK (sign_count >= 0 AND sign_count <= 4294967295),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  PRIMARY KEY (tenant_id, passkey_id),
  UNIQUE (tenant_id, credential_id),
  UNIQUE (tenant_id, passkey_id, owner_namespace, owner_account)
);
CREATE INDEX passkey_credentials_owner ON passkey_credentials (tenant_id, owner_namespace, owner_account, created_at DESC);
CREATE FUNCTION passkey_credential_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.passkey_id IS DISTINCT FROM OLD.passkey_id OR NEW.owner_namespace IS DISTINCT FROM OLD.owner_namespace
     OR NEW.owner_account IS DISTINCT FROM OLD.owner_account OR NEW.credential_id IS DISTINCT FROM OLD.credential_id
     OR NEW.public_key_spki IS DISTINCT FROM OLD.public_key_spki OR NEW.algorithm IS DISTINCT FROM OLD.algorithm OR NEW.rp_id IS DISTINCT FROM OLD.rp_id
     OR NEW.origin IS DISTINCT FROM OLD.origin OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) OR NEW.sign_count < OLD.sign_count THEN
    RAISE EXCEPTION 'PASSKEY_IMMUTABLE' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER passkey_credential_transition BEFORE UPDATE ON passkey_credentials FOR EACH ROW EXECUTE FUNCTION passkey_credential_transition();

-- Single-use, short-lived WebAuthn challenges (digest only). An authorization challenge IS the digest of the envelope being signed.
CREATE TABLE passkey_challenges (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  challenge_digest bytea NOT NULL CHECK (octet_length(challenge_digest) = 32),
  owner_namespace text NOT NULL CHECK (owner_namespace IN ('eip155', 'solana')),
  owner_account text NOT NULL CHECK (length(owner_account) BETWEEN 32 AND 44),
  purpose text NOT NULL CHECK (purpose IN ('REGISTER', 'AUTHORIZE')),
  subject text CHECK (subject IS NULL OR subject ~ '^[A-Za-z0-9_:.-]{1,120}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, challenge_digest),
  CHECK (expires_at > created_at)
);

-- 4. Execution Credentials: an owner wallet registered for delegated execution, and its per-chain grants.
CREATE TABLE execution_credentials (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  credential_id text NOT NULL CHECK (credential_id ~ '^crd_[a-z2-7]{26}$'),
  owner_namespace text NOT NULL CHECK (owner_namespace IN ('eip155', 'solana')),
  owner_account text NOT NULL CHECK (length(owner_account) BETWEEN 32 AND 44),
  wallet_namespace text NOT NULL CHECK (wallet_namespace IN ('eip155', 'solana')),
  wallet_address text NOT NULL CHECK (
    (wallet_namespace = 'eip155' AND wallet_address ~ '^0x[0-9a-f]{40}$') OR
    (wallet_namespace = 'solana' AND wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, credential_id),
  UNIQUE (tenant_id, owner_namespace, owner_account, wallet_namespace, wallet_address),
  UNIQUE (tenant_id, credential_id, owner_namespace, owner_account)
);

CREATE TABLE credential_grants (
  tenant_id text NOT NULL,
  grant_id text NOT NULL CHECK (grant_id ~ '^grt_[a-z2-7]{26}$'),
  credential_id text NOT NULL,
  owner_namespace text NOT NULL,
  owner_account text NOT NULL,
  chain text NOT NULL CHECK (chain ~ '^(eip155:[1-9][0-9]{0,18}|solana:[1-9A-HJ-NP-Za-km-z]{32})$'),
  mechanism text NOT NULL CHECK (mechanism IN ('EVM_ERC7710_METAMASK_V1_3', 'SOLANA_SPL_DELEGATE_V1')),
  state text NOT NULL CHECK (state IN ('PENDING_SIGNATURE', 'ACTIVE', 'REVOCATION_REQUESTED', 'REVOKED', 'EXPIRED', 'UNCERTAIN', 'FAILED')),
  scope jsonb NOT NULL CHECK (jsonb_typeof(scope) = 'object' AND octet_length(scope::text) <= 8192),
  scope_hash text NOT NULL CHECK (scope_hash ~ '^0x[0-9a-f]{64}$'),
  passkey_id text NOT NULL,
  session_key_ref text NOT NULL CHECK (session_key_ref ~ '^[a-z0-9-]{2,24}:[A-Za-z0-9_.-]{8,128}$'),
  session_address text NOT NULL CHECK (length(session_address) BETWEEN 32 AND 44),
  enrollment jsonb NOT NULL CHECK (jsonb_typeof(enrollment) = 'object' AND octet_length(enrollment::text) <= 32768),
  grant_payload jsonb CHECK (grant_payload IS NULL OR (jsonb_typeof(grant_payload) = 'object' AND octet_length(grant_payload::text) <= 32768)),
  commitment text CHECK (commitment IS NULL OR commitment ~ '^0x[0-9a-f]{64}$'),
  verification jsonb CHECK (verification IS NULL OR (jsonb_typeof(verification) = 'object' AND octet_length(verification::text) <= 8192)),
  verified_at timestamptz,
  calls_used integer NOT NULL DEFAULT 0 CHECK (calls_used >= 0),
  evm_next_nonce bigint CHECK (evm_next_nonce IS NULL OR evm_next_nonce >= 0),
  expires_at timestamptz NOT NULL,
  revocation jsonb CHECK (revocation IS NULL OR (jsonb_typeof(revocation) = 'object' AND octet_length(revocation::text) <= 32768)),
  revocation_requested_at timestamptz,
  revoked_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, grant_id),
  UNIQUE (tenant_id, grant_id, owner_namespace, owner_account),
  UNIQUE (tenant_id, session_key_ref),
  FOREIGN KEY (tenant_id, credential_id, owner_namespace, owner_account) REFERENCES execution_credentials (tenant_id, credential_id, owner_namespace, owner_account),
  FOREIGN KEY (tenant_id, passkey_id, owner_namespace, owner_account) REFERENCES passkey_credentials (tenant_id, passkey_id, owner_namespace, owner_account),
  CHECK (state NOT IN ('ACTIVE', 'REVOCATION_REQUESTED', 'REVOKED') OR (grant_payload IS NOT NULL AND commitment IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE INDEX credential_grants_owner ON credential_grants (tenant_id, owner_namespace, owner_account, created_at DESC);
CREATE FUNCTION credential_grant_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.grant_id IS DISTINCT FROM OLD.grant_id OR NEW.credential_id IS DISTINCT FROM OLD.credential_id
     OR NEW.owner_namespace IS DISTINCT FROM OLD.owner_namespace OR NEW.owner_account IS DISTINCT FROM OLD.owner_account OR NEW.chain IS DISTINCT FROM OLD.chain
     OR NEW.mechanism IS DISTINCT FROM OLD.mechanism OR NEW.scope IS DISTINCT FROM OLD.scope OR NEW.scope_hash IS DISTINCT FROM OLD.scope_hash
     OR NEW.passkey_id IS DISTINCT FROM OLD.passkey_id OR NEW.session_key_ref IS DISTINCT FROM OLD.session_key_ref
     OR NEW.session_address IS DISTINCT FROM OLD.session_address OR NEW.enrollment IS DISTINCT FROM OLD.enrollment OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.grant_payload IS NOT NULL AND NEW.grant_payload IS DISTINCT FROM OLD.grant_payload)
     OR (OLD.commitment IS NOT NULL AND NEW.commitment IS DISTINCT FROM OLD.commitment)
     OR NEW.calls_used < OLD.calls_used OR NEW.evm_next_nonce < OLD.evm_next_nonce OR NEW.version < OLD.version THEN
    RAISE EXCEPTION 'CREDENTIAL_GRANT_IMMUTABLE' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.state <> OLD.state AND NOT (
       (OLD.state = 'PENDING_SIGNATURE' AND NEW.state IN ('ACTIVE', 'FAILED'))
    -- ACTIVE → REVOKED: an on-chain revocation the owner made outside FloFi, observed by read-only verification.
    OR (OLD.state = 'ACTIVE' AND NEW.state IN ('REVOCATION_REQUESTED', 'REVOKED', 'EXPIRED', 'UNCERTAIN'))
    OR (OLD.state = 'UNCERTAIN' AND NEW.state IN ('ACTIVE', 'REVOCATION_REQUESTED', 'REVOKED'))
    OR (OLD.state = 'EXPIRED' AND NEW.state IN ('REVOCATION_REQUESTED', 'REVOKED'))
    OR (OLD.state = 'REVOCATION_REQUESTED' AND NEW.state IN ('REVOKED', 'UNCERTAIN'))) THEN
    RAISE EXCEPTION 'CREDENTIAL_GRANT_TRANSITION_INVALID' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  -- A grant that was ever revocation-requested can never be used again, even if it later reads as uncertain.
  IF NEW.state = 'ACTIVE' AND OLD.revocation_requested_at IS NOT NULL THEN
    RAISE EXCEPTION 'CREDENTIAL_GRANT_TRANSITION_INVALID' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER credential_grant_transition BEFORE UPDATE ON credential_grants FOR EACH ROW EXECUTE FUNCTION credential_grant_transition();

-- 5. Workflow authorizations: a lineage per delegated rule, and immutable revisions (manifest + the owner's ONE passkey signature).
CREATE TABLE delegated_authorizations (
  tenant_id text NOT NULL,
  authorization_id text NOT NULL CHECK (authorization_id ~ '^dau_[a-z2-7]{26}$'),
  owner_namespace text NOT NULL,
  owner_account text NOT NULL,
  rule_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('PENDING_SIGNATURE', 'ACTIVE', 'REVOKED', 'EXPIRED')),
  active_revision integer CHECK (active_revision IS NULL OR active_revision >= 1),
  latest_revision integer NOT NULL DEFAULT 1 CHECK (latest_revision >= 1),
  revoked_at timestamptz,
  revoke_code text CHECK (revoke_code IS NULL OR revoke_code ~ '^[A-Z][A-Z0-9_]{2,80}$'),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, authorization_id),
  UNIQUE (tenant_id, authorization_id, owner_namespace, owner_account),
  UNIQUE (tenant_id, rule_id),
  FOREIGN KEY (tenant_id, rule_id, owner_namespace, owner_account) REFERENCES automation_rules (tenant_id, rule_id, owner_namespace, owner_account),
  CHECK ((state = 'ACTIVE') = (active_revision IS NOT NULL)),
  CHECK (state <> 'REVOKED' OR revoked_at IS NOT NULL)
);
CREATE FUNCTION delegated_authorization_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.authorization_id IS DISTINCT FROM OLD.authorization_id OR NEW.owner_namespace IS DISTINCT FROM OLD.owner_namespace
     OR NEW.owner_account IS DISTINCT FROM OLD.owner_account OR NEW.rule_id IS DISTINCT FROM OLD.rule_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.latest_revision < OLD.latest_revision OR NEW.version <= OLD.version THEN
    RAISE EXCEPTION 'DELEGATED_AUTHORIZATION_IMMUTABLE' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.state = 'REVOKED' THEN
    RAISE EXCEPTION 'DELEGATED_AUTHORIZATION_REVOKED' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.state <> OLD.state AND NOT (
       (OLD.state = 'PENDING_SIGNATURE' AND NEW.state IN ('ACTIVE', 'REVOKED', 'EXPIRED'))
    OR (OLD.state = 'ACTIVE' AND NEW.state IN ('PENDING_SIGNATURE', 'REVOKED', 'EXPIRED'))
    OR (OLD.state = 'EXPIRED' AND NEW.state = 'REVOKED')) THEN
    RAISE EXCEPTION 'DELEGATED_AUTHORIZATION_TRANSITION_INVALID' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER delegated_authorization_transition BEFORE UPDATE ON delegated_authorizations FOR EACH ROW EXECUTE FUNCTION delegated_authorization_transition();

CREATE TABLE delegated_authorization_revisions (
  tenant_id text NOT NULL,
  authorization_id text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  owner_namespace text NOT NULL,
  owner_account text NOT NULL,
  state text NOT NULL CHECK (state IN ('PENDING_SIGNATURE', 'ACTIVE', 'SUPERSEDED', 'REVOKED', 'EXPIRED')),
  strategy jsonb NOT NULL CHECK (jsonb_typeof(strategy) = 'object' AND octet_length(strategy::text) <= 8192),
  workflow_hash text NOT NULL CHECK (workflow_hash ~ '^0x[0-9a-f]{64}$'),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object' AND octet_length(manifest::text) <= 32768),
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^0x[0-9a-f]{64}$'),
  widening jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(widening) = 'array'),
  envelope jsonb CHECK (envelope IS NULL OR (jsonb_typeof(envelope) = 'object' AND octet_length(envelope::text) <= 16384)),
  envelope_digest text CHECK (envelope_digest IS NULL OR envelope_digest ~ '^0x[0-9a-f]{64}$'),
  passkey_id text,
  assertion jsonb CHECK (assertion IS NULL OR (jsonb_typeof(assertion) = 'object' AND octet_length(assertion::text) <= 8192)),
  signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, authorization_id, revision),
  FOREIGN KEY (tenant_id, authorization_id, owner_namespace, owner_account) REFERENCES delegated_authorizations (tenant_id, authorization_id, owner_namespace, owner_account),
  FOREIGN KEY (tenant_id, passkey_id, owner_namespace, owner_account) REFERENCES passkey_credentials (tenant_id, passkey_id, owner_namespace, owner_account),
  CHECK ((envelope IS NULL) = (envelope_digest IS NULL)),
  CHECK (state IN ('PENDING_SIGNATURE') OR (assertion IS NOT NULL AND signed_at IS NOT NULL AND envelope IS NOT NULL AND passkey_id IS NOT NULL) OR state IN ('SUPERSEDED', 'REVOKED', 'EXPIRED'))
);
CREATE FUNCTION delegated_revision_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.authorization_id IS DISTINCT FROM OLD.authorization_id OR NEW.revision IS DISTINCT FROM OLD.revision
     OR NEW.owner_namespace IS DISTINCT FROM OLD.owner_namespace OR NEW.owner_account IS DISTINCT FROM OLD.owner_account OR NEW.strategy IS DISTINCT FROM OLD.strategy
     OR NEW.workflow_hash IS DISTINCT FROM OLD.workflow_hash OR NEW.manifest IS DISTINCT FROM OLD.manifest OR NEW.manifest_hash IS DISTINCT FROM OLD.manifest_hash
     OR NEW.widening IS DISTINCT FROM OLD.widening OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.assertion IS NOT NULL AND (NEW.assertion IS DISTINCT FROM OLD.assertion OR NEW.envelope IS DISTINCT FROM OLD.envelope
       OR NEW.envelope_digest IS DISTINCT FROM OLD.envelope_digest OR NEW.passkey_id IS DISTINCT FROM OLD.passkey_id OR NEW.signed_at IS DISTINCT FROM OLD.signed_at)) THEN
    RAISE EXCEPTION 'DELEGATED_REVISION_IMMUTABLE' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.state <> OLD.state AND NOT (
       (OLD.state = 'PENDING_SIGNATURE' AND NEW.state IN ('ACTIVE', 'SUPERSEDED', 'REVOKED', 'EXPIRED'))
    OR (OLD.state = 'ACTIVE' AND NEW.state IN ('SUPERSEDED', 'REVOKED', 'EXPIRED'))) THEN
    RAISE EXCEPTION 'DELEGATED_REVISION_TRANSITION_INVALID' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER delegated_revision_transition BEFORE UPDATE ON delegated_authorization_revisions FOR EACH ROW EXECUTE FUNCTION delegated_revision_transition();

-- 6. Delegated executions: one per (authorization, occurrence); steps; the budget ledger; the audit trail.
CREATE TABLE delegated_executions (
  tenant_id text NOT NULL,
  execution_id text NOT NULL CHECK (execution_id ~ '^dex_[a-z2-7]{26}$'),
  authorization_id text NOT NULL,
  revision integer NOT NULL,
  owner_namespace text NOT NULL,
  owner_account text NOT NULL,
  rule_id text NOT NULL,
  occurrence_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('QUEUED', 'AUTHORITY_VERIFIED', 'RESERVED', 'RUNNING', 'SETTLED', 'BLOCKED', 'UNCERTAIN', 'HALTED', 'FAILED')),
  code text CHECK (code IS NULL OR code ~ '^[A-Z][A-Z0-9_]{2,80}$'),
  workflow_hash text NOT NULL CHECK (workflow_hash ~ '^0x[0-9a-f]{64}$'),
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^0x[0-9a-f]{64}$'),
  step_count integer NOT NULL CHECK (step_count BETWEEN 1 AND 8),
  current_step integer NOT NULL DEFAULT 0 CHECK (current_step >= 0),
  attention boolean NOT NULL DEFAULT false,
  evidence jsonb CHECK (evidence IS NULL OR (jsonb_typeof(evidence) = 'object' AND octet_length(evidence::text) <= 65536)),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  reserved_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, execution_id),
  UNIQUE (tenant_id, authorization_id, occurrence_id),
  UNIQUE (tenant_id, execution_id, authorization_id),
  FOREIGN KEY (tenant_id, authorization_id, revision) REFERENCES delegated_authorization_revisions (tenant_id, authorization_id, revision),
  FOREIGN KEY (tenant_id, authorization_id, owner_namespace, owner_account) REFERENCES delegated_authorizations (tenant_id, authorization_id, owner_namespace, owner_account),
  FOREIGN KEY (tenant_id, occurrence_id) REFERENCES automation_occurrences (tenant_id, occurrence_id)
);
CREATE INDEX delegated_executions_owner ON delegated_executions (tenant_id, owner_namespace, owner_account, created_at DESC);
CREATE INDEX delegated_executions_open ON delegated_executions (tenant_id, updated_at) WHERE state NOT IN ('SETTLED', 'BLOCKED', 'FAILED');
CREATE FUNCTION delegated_execution_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.execution_id IS DISTINCT FROM OLD.execution_id OR NEW.authorization_id IS DISTINCT FROM OLD.authorization_id
     OR NEW.revision IS DISTINCT FROM OLD.revision OR NEW.owner_namespace IS DISTINCT FROM OLD.owner_namespace OR NEW.owner_account IS DISTINCT FROM OLD.owner_account
     OR NEW.rule_id IS DISTINCT FROM OLD.rule_id OR NEW.occurrence_id IS DISTINCT FROM OLD.occurrence_id OR NEW.workflow_hash IS DISTINCT FROM OLD.workflow_hash
     OR NEW.manifest_hash IS DISTINCT FROM OLD.manifest_hash OR NEW.step_count IS DISTINCT FROM OLD.step_count OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.version <= OLD.version THEN
    RAISE EXCEPTION 'DELEGATED_EXECUTION_IMMUTABLE' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.state IN ('SETTLED', 'BLOCKED', 'FAILED') THEN
    RAISE EXCEPTION 'DELEGATED_EXECUTION_TERMINAL' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.state <> OLD.state AND NOT (
       (OLD.state = 'QUEUED' AND NEW.state IN ('AUTHORITY_VERIFIED', 'BLOCKED'))
    OR (OLD.state = 'AUTHORITY_VERIFIED' AND NEW.state IN ('RESERVED', 'BLOCKED'))
    OR (OLD.state = 'RESERVED' AND NEW.state IN ('RUNNING', 'BLOCKED'))
    OR (OLD.state = 'RUNNING' AND NEW.state IN ('SETTLED', 'BLOCKED', 'UNCERTAIN', 'HALTED', 'FAILED'))
    OR (OLD.state = 'UNCERTAIN' AND NEW.state IN ('RUNNING', 'SETTLED', 'HALTED', 'FAILED'))
    OR (OLD.state = 'HALTED' AND NEW.state = 'RUNNING')) THEN
    RAISE EXCEPTION 'DELEGATED_EXECUTION_TRANSITION_INVALID' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER delegated_execution_transition BEFORE UPDATE ON delegated_executions FOR EACH ROW EXECUTE FUNCTION delegated_execution_transition();

CREATE TABLE delegated_execution_steps (
  tenant_id text NOT NULL,
  execution_id text NOT NULL,
  step_index integer NOT NULL CHECK (step_index BETWEEN 0 AND 7),
  state text NOT NULL CHECK (state IN ('PENDING', 'SIMULATED', 'POLICY_VERIFIED', 'SUBMISSION_PREPARED', 'SUBMITTED', 'RECONCILED', 'BLOCKED', 'UNCERTAIN', 'REVERTED')),
  credential_id text NOT NULL,
  grant_id text NOT NULL,
  mechanism text NOT NULL CHECK (mechanism IN ('EVM_ERC7710_METAMASK_V1_3', 'SOLANA_SPL_DELEGATE_V1')),
  chain text NOT NULL,
  grant_commitment text NOT NULL CHECK (grant_commitment ~ '^0x[0-9a-f]{64}$'),
  plan jsonb CHECK (plan IS NULL OR (jsonb_typeof(plan) = 'object' AND octet_length(plan::text) <= 16384)),
  submission jsonb CHECK (submission IS NULL OR (jsonb_typeof(submission) = 'object' AND octet_length(submission::text) <= 65536)),
  reconciliation jsonb CHECK (reconciliation IS NULL OR (jsonb_typeof(reconciliation) = 'object' AND octet_length(reconciliation::text) <= 16384)),
  code text CHECK (code IS NULL OR code ~ '^[A-Z][A-Z0-9_]{2,80}$'),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, execution_id, step_index),
  FOREIGN KEY (tenant_id, execution_id) REFERENCES delegated_executions (tenant_id, execution_id),
  CHECK (state NOT IN ('SUBMISSION_PREPARED', 'SUBMITTED', 'RECONCILED', 'UNCERTAIN', 'REVERTED') OR submission IS NOT NULL)
);
CREATE FUNCTION delegated_step_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.execution_id IS DISTINCT FROM OLD.execution_id OR NEW.step_index IS DISTINCT FROM OLD.step_index
     OR NEW.credential_id IS DISTINCT FROM OLD.credential_id OR NEW.grant_id IS DISTINCT FROM OLD.grant_id OR NEW.mechanism IS DISTINCT FROM OLD.mechanism
     OR NEW.chain IS DISTINCT FROM OLD.chain OR NEW.grant_commitment IS DISTINCT FROM OLD.grant_commitment OR NEW.created_at IS DISTINCT FROM OLD.created_at
     -- The exact signed submission never changes once prepared: recovery can only re-broadcast those bytes.
     OR (OLD.submission IS NOT NULL AND NEW.submission IS DISTINCT FROM OLD.submission) THEN
    RAISE EXCEPTION 'DELEGATED_STEP_IMMUTABLE' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.state IN ('RECONCILED', 'BLOCKED', 'REVERTED') THEN
    RAISE EXCEPTION 'DELEGATED_STEP_TERMINAL' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.state <> OLD.state AND NOT (
       (OLD.state = 'PENDING' AND NEW.state IN ('SIMULATED', 'BLOCKED'))
    OR (OLD.state = 'SIMULATED' AND NEW.state IN ('POLICY_VERIFIED', 'BLOCKED'))
    OR (OLD.state = 'POLICY_VERIFIED' AND NEW.state IN ('SIMULATED', 'SUBMISSION_PREPARED', 'BLOCKED'))
    OR (OLD.state = 'SUBMISSION_PREPARED' AND NEW.state IN ('SUBMITTED', 'UNCERTAIN', 'REVERTED'))
    OR (OLD.state = 'SUBMITTED' AND NEW.state IN ('RECONCILED', 'REVERTED', 'UNCERTAIN'))
    OR (OLD.state = 'UNCERTAIN' AND NEW.state IN ('SUBMITTED', 'RECONCILED', 'REVERTED'))) THEN
    RAISE EXCEPTION 'DELEGATED_STEP_TRANSITION_INVALID' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER delegated_step_transition BEFORE UPDATE ON delegated_execution_steps FOR EACH ROW EXECUTE FUNCTION delegated_step_transition();

-- The budget ledger: amounts in integer native units per asset key; period starts are computed in the manifest's zone at reservation.
CREATE TABLE delegated_budget_entries (
  tenant_id text NOT NULL,
  entry_id bigint GENERATED ALWAYS AS IDENTITY,
  authorization_id text NOT NULL,
  execution_id text NOT NULL,
  step_index integer NOT NULL CHECK (step_index BETWEEN 0 AND 7),
  asset text NOT NULL CHECK (asset ~ '^(eip155:[0-9]{1,19}/erc20:0x[0-9a-f]{40}|solana:[1-9A-HJ-NP-Za-km-z]{32}/token:[1-9A-HJ-NP-Za-km-z]{32,44})$'),
  reserved_amount numeric(78, 0) NOT NULL CHECK (reserved_amount > 0),
  spent_amount numeric(78, 0) CHECK (spent_amount IS NULL OR spent_amount >= 0),
  state text NOT NULL CHECK (state IN ('RESERVED', 'SPENT', 'RELEASED')),
  day_start timestamptz NOT NULL,
  week_start timestamptz NOT NULL,
  month_start timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, entry_id),
  UNIQUE (tenant_id, execution_id, step_index, asset),
  FOREIGN KEY (tenant_id, execution_id, authorization_id) REFERENCES delegated_executions (tenant_id, execution_id, authorization_id),
  CHECK ((state = 'SPENT') = (spent_amount IS NOT NULL))
);
CREATE INDEX delegated_budget_usage ON delegated_budget_entries (tenant_id, authorization_id, asset, week_start) WHERE state <> 'RELEASED';
CREATE FUNCTION delegated_budget_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.entry_id IS DISTINCT FROM OLD.entry_id OR NEW.authorization_id IS DISTINCT FROM OLD.authorization_id
     OR NEW.execution_id IS DISTINCT FROM OLD.execution_id OR NEW.step_index IS DISTINCT FROM OLD.step_index OR NEW.asset IS DISTINCT FROM OLD.asset
     OR NEW.reserved_amount IS DISTINCT FROM OLD.reserved_amount OR NEW.day_start IS DISTINCT FROM OLD.day_start OR NEW.week_start IS DISTINCT FROM OLD.week_start
     OR NEW.month_start IS DISTINCT FROM OLD.month_start OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'DELEGATED_BUDGET_IMMUTABLE' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.state <> 'RESERVED' OR NEW.state NOT IN ('SPENT', 'RELEASED') THEN
    RAISE EXCEPTION 'DELEGATED_BUDGET_TRANSITION_INVALID' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER delegated_budget_transition BEFORE UPDATE ON delegated_budget_entries FOR EACH ROW EXECUTE FUNCTION delegated_budget_transition();
CREATE FUNCTION delegated_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'DELEGATED_RECORD_APPEND_ONLY' USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
CREATE TRIGGER delegated_budget_no_delete BEFORE DELETE ON delegated_budget_entries FOR EACH ROW EXECUTE FUNCTION delegated_no_delete();

-- Append-only audit and evidence trail (closed codes, ids and public facts only).
CREATE TABLE delegated_events (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  event_id bigint GENERATED ALWAYS AS IDENTITY,
  owner_namespace text NOT NULL CHECK (owner_namespace IN ('eip155', 'solana')),
  owner_account text NOT NULL CHECK (length(owner_account) BETWEEN 32 AND 44),
  kind text NOT NULL CHECK (kind ~ '^[A-Z][A-Z0-9_]{2,60}$'),
  authorization_id text,
  execution_id text,
  grant_id text,
  passkey_id text,
  code text CHECK (code IS NULL OR code ~ '^[A-Z][A-Z0-9_]{2,80}$'),
  detail jsonb CHECK (detail IS NULL OR (jsonb_typeof(detail) = 'object' AND octet_length(detail::text) <= 4096)),
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, event_id)
);
CREATE INDEX delegated_events_owner ON delegated_events (tenant_id, owner_namespace, owner_account, at DESC);
CREATE TRIGGER delegated_events_no_update BEFORE UPDATE OR DELETE ON delegated_events FOR EACH ROW EXECUTE FUNCTION delegated_no_delete();
