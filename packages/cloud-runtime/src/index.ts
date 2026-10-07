// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CLOUD-001 infrastructure adapters for Flofi: PostgreSQL execution/journal/lease stores, the durable
 * work queue (transactional outbox), request idempotency, EvidenceStore implementations, a worker loop, a
 * stateless HTTP boundary and vendor-neutral telemetry. The financial core never imports this package; it
 * depends only on the storage ports exported by @defi-workflow-engine/reference-executor.
 */
export const CLOUD_RUNTIME_PACKAGE = '@defi-workflow-engine/cloud-runtime';
export * from './db.js';
export * from './migrations.js';
export * from './telemetry.js';
export * from './leases.js';
export * from './log-store.js';
export * from './work-queue.js';
export * from './idempotency.js';
export * from './evidence-store.js';
export * from './worker.js';
export * from './queries.js';
export * from './automations.js';
export * from './http.js';
export * from './config.js';
