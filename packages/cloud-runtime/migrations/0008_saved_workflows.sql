-- SPDX-License-Identifier: AGPL-3.0-only
-- Canonical authoring documents only. Execution authority, signatures and quotes are not stored here.
CREATE TABLE saved_workflows (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id),
  owner_namespace text NOT NULL CHECK (owner_namespace IN ('eip155', 'solana')),
  owner_account text NOT NULL CHECK (
    (owner_namespace = 'eip155' AND owner_account ~ '^0x[0-9a-f]{40}$') OR
    (owner_namespace = 'solana' AND owner_account ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')),
  workflow_id text NOT NULL CHECK (workflow_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  semantic_workflow jsonb NOT NULL CHECK (jsonb_typeof(semantic_workflow) = 'object' AND octet_length(semantic_workflow::text) <= 262144),
  semantic_revision bigint NOT NULL CHECK (semantic_revision >= 0 AND semantic_revision <= 9007199254740991),
  workflow_hash text NOT NULL CHECK (workflow_hash ~ '^0x[0-9a-f]{64}$'),
  version bigint NOT NULL CHECK (version >= 1 AND version <= 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, owner_namespace, owner_account, workflow_id),
  CHECK (semantic_workflow->>'workflowId' = workflow_id),
  CHECK ((semantic_workflow->>'revision')::bigint = semantic_revision)
);
CREATE INDEX saved_workflows_owner_history ON saved_workflows
  (tenant_id, owner_namespace, owner_account, updated_at DESC, workflow_id);
