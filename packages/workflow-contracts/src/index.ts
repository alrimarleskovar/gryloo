import { parseArtifactBytes } from './raw-json.js';
import { hashArtifactValue, hashJournalEntries, type StructuredHashKind } from './canonical.js';

export { parseJsonBytes, parseArtifactBytes, RawJsonError, RAW_JSON_LIMITS } from './raw-json.js';
export { HASH_DOMAINS, hashRawBytes, hashModeBPermission } from './canonical.js';
export type { RawHashKind, StructuredHashKind } from './canonical.js';
export type { ArtifactKind, ArtifactByKind } from './schemas.js';
export type { Asset } from './common.js';
export type { SemanticWorkflow } from './semantic-workflow.js';
export type { QuoteStateArtifact } from './quote-state.js';
export type { ArtifactSet } from './artifact-set.js';
export type { SimulationBundle } from './simulation.js';
export type { AuthorizationPolicy } from './authorization-policy.js';
export type { StrategyManifest } from './strategy-manifest.js';
export type { ExecutionPlan } from './execution-plan.js';
export type { ExecutionJournal, JournalEntry } from './execution-journal.js';
export type { EvidenceBundle } from './evidence-bundle.js';
export type { EnforcementMatrix } from './enforcement-matrix.js';
export { nextRevision, RevisionConflictError } from './revision.js';
export { invalidationFor, INVALIDATION } from './invalidation.js';
export type { ChangeKind } from './invalidation.js';
export { assertTransition, INITIAL_STATES, STATE_TRANSITIONS } from './state-transitions.js';
export type { JournalLevel } from './state-transitions.js';

/** Guarded raw ingress followed by the exact v1 structured artifact projection. */
export function hashArtifactBytes(kind: StructuredHashKind, bytes: Uint8Array): string {
  if (kind === ('execution-journal' as string)) throw new Error('Use hashJournalBytes for journal entry hashes');
  return hashArtifactValue(kind, parseArtifactBytes(bytes, kind));
}

/** Returns individual linked entry hashes; no whole-journal hash is invented. */
export function hashJournalBytes(bytes: Uint8Array): readonly string[] {
  return hashJournalEntries(parseArtifactBytes(bytes, 'execution-journal'));
}
