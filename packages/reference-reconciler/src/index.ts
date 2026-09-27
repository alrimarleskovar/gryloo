// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-003D independent reconciler and Evidence Bundle builder (filled in phase P3). */
export const REFERENCE_RECONCILER_PACKAGE = '@defi-workflow-engine/reference-reconciler';
export { decodeSignedTransaction, verifySignedPayload } from './raw-transaction.js';
export { reconcileModeA, TRANSFER_TOPIC, APPROVAL_TOPIC } from './reconcile.js';
export { buildEvidenceBundle } from './evidence.js';
export { reconcileWithScriptedTransport } from './reconcile.js';
export type { ReconcileScriptQuery, ReconcileScriptTransport, ReconcileStaticInput } from './reconcile.js';
export { reconcileModeB } from './mode-b.js';
export type { ModeBChainEvidence, ModeBReconciliation, ModeBOutcome } from './mode-b.js';
