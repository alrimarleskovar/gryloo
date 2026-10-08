-- SPDX-License-Identifier: AGPL-3.0-only
-- BUILD-CHANNELS-001 0009: persistence of FloFi's conversational channels (Channel Core). It follows 0008 (saved_workflows) in the
-- shipped sequence and touches no earlier table.
--
-- A channel conversation is a CHANNEL_CONVERSATION requester of the shared approval model (0006): its approval handoffs live in
-- mcp_handoffs under (requester_kind, requester_ref = conversation_id). Nothing here references or alters that table.
--
-- Data minimization by construction:
--   * no raw message is kept: an event keeps a keyed digest of the provider message id, an outcome code and timestamps; inbound
--     text exists only as transient AES-256-GCM ciphertext while the event is PENDING (CHECK below);
--   * an outbound body exists only as ciphertext while the message is PENDING or SENDING (CHECK below); approval links are never
--     stored at all;
--   * a sender is a keyed digest (lookup) plus an erasable, encrypted send address; never a profile name, never a wallet.
-- Nothing here is authority: a conversation never signs, claims, applies or authorizes anything.

CREATE TABLE channel_conversations (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  conversation_id text NOT NULL CHECK (conversation_id ~ '^chc_[a-z2-7]{26}$'),
  channel text NOT NULL CHECK (channel ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  business_id text NOT NULL CHECK (business_id ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  subject_digest bytea NOT NULL CHECK (octet_length(subject_digest) = 32),
  address_ciphertext bytea CHECK (address_ciphertext IS NULL OR octet_length(address_ciphertext) BETWEEN 29 AND 1024),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'OPTED_OUT')),
  state_ciphertext bytea CHECK (state_ciphertext IS NULL OR octet_length(state_ciphertext) BETWEEN 29 AND 65536),
  lease_token text CHECK (lease_token IS NULL OR lease_token ~ '^[A-Za-z0-9_-]{16,64}$'),
  lease_until timestamptz,
  last_inbound_at timestamptz,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, conversation_id),
  UNIQUE (tenant_id, channel, business_id, subject_digest),
  -- An opted-out sender keeps only its digest and status (so the opt-out is honoured): no address, no state.
  CHECK (status = 'ACTIVE' OR (address_ciphertext IS NULL AND state_ciphertext IS NULL)),
  CHECK ((lease_token IS NULL) = (lease_until IS NULL))
);
CREATE INDEX channel_conversations_activity ON channel_conversations (tenant_id, last_activity_at);

-- One provider event (an inbound message): the deduplication record and the work item of its conversation.
CREATE TABLE channel_events (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  channel text NOT NULL CHECK (channel ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  event_digest bytea NOT NULL CHECK (octet_length(event_digest) = 32),
  conversation_id text,
  provider_sent_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('PENDING', 'DONE', 'IGNORED', 'FAILED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
  payload_ciphertext bytea CHECK (payload_ciphertext IS NULL OR octet_length(payload_ciphertext) BETWEEN 29 AND 16384),
  outcome text CHECK (outcome IS NULL OR outcome ~ '^[A-Z][A-Z0-9_]{2,80}$'),
  handoff_id text CHECK (handoff_id IS NULL OR handoff_id ~ '^apr_[a-z2-7]{26}$'),
  processed_at timestamptz,
  PRIMARY KEY (tenant_id, channel, event_digest),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES channel_conversations (tenant_id, conversation_id) ON DELETE CASCADE,
  -- Content never survives processing: only a PENDING event may hold its (encrypted) payload.
  CHECK (status = 'PENDING' OR payload_ciphertext IS NULL),
  -- A sender outside the allowlist gets no conversation row at all.
  CHECK (status = 'IGNORED' OR conversation_id IS NOT NULL)
);
CREATE INDEX channel_events_pending ON channel_events (tenant_id, conversation_id, provider_sent_at, received_at) WHERE status = 'PENDING';
CREATE INDEX channel_events_age ON channel_events (tenant_id, received_at);

-- Outbound messages of a conversation (transactional outbox): written with the turn, delivered after commit, idempotent by key.
CREATE TABLE channel_outbox (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  outbox_id text NOT NULL CHECK (outbox_id ~ '^cho_[a-z2-7]{26}$'),
  conversation_id text NOT NULL,
  dedupe_key text NOT NULL CHECK (dedupe_key ~ '^[a-z][a-z0-9_.:-]{2,159}$'),
  kind text NOT NULL CHECK (kind IN ('REPLY', 'APPROVAL', 'NOTIFICATION')),
  sequence integer NOT NULL DEFAULT 0 CHECK (sequence BETWEEN 0 AND 15),
  body_ciphertext bytea CHECK (body_ciphertext IS NULL OR octet_length(body_ciphertext) BETWEEN 29 AND 16384),
  handoff_id text CHECK (handoff_id IS NULL OR handoff_id ~ '^apr_[a-z2-7]{26}$'),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  provider_message_digest bytea CHECK (provider_message_digest IS NULL OR octet_length(provider_message_digest) = 32),
  delivery text CHECK (delivery IS NULL OR delivery IN ('SENT', 'DELIVERED', 'READ', 'FAILED')),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z0-9][A-Z0-9_]{1,80}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, outbox_id),
  UNIQUE (tenant_id, dedupe_key),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES channel_conversations (tenant_id, conversation_id) ON DELETE CASCADE,
  -- A body exists exactly while the message may still be sent.
  CHECK ((status IN ('PENDING', 'SENDING')) = (body_ciphertext IS NOT NULL))
);
CREATE INDEX channel_outbox_due ON channel_outbox (tenant_id, conversation_id, status, next_attempt_at);
CREATE UNIQUE INDEX channel_outbox_provider ON channel_outbox (tenant_id, provider_message_digest) WHERE provider_message_digest IS NOT NULL;
