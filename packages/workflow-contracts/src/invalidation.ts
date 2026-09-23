const dependents = {
  SEMANTIC_EDIT: ['quote-state-artifact', 'artifact-set', 'simulation-bundle', 'authorization-policy', 'strategy-manifest', 'execution-plan', 'authorization'],
  QUOTE_REFRESH: ['artifact-set', 'simulation-bundle', 'authorization-policy', 'strategy-manifest', 'execution-plan', 'authorization'],
  ARTIFACT_EXPIRED: ['artifact-set', 'simulation-bundle', 'authorization-policy', 'strategy-manifest', 'execution-plan', 'authorization'],
  SIMULATION_CHANGED: ['authorization-policy', 'strategy-manifest', 'execution-plan', 'authorization'],
  POLICY_EDIT: ['strategy-manifest', 'execution-plan', 'authorization'],
  MANIFEST_EDIT: ['execution-plan', 'authorization'],
  EXECUTION_PLAN_EDIT: ['authorization'],
  JOURNAL_APPEND: [],
  EVIDENCE_APPEND: [],
  PRESENTATION_EDIT: [],
} as const;
export type ChangeKind = keyof typeof dependents;
for (const value of Object.values(dependents)) Object.freeze(value);
export const INVALIDATION = Object.freeze(dependents);

/** Entries identify references requiring new review, never permission to execute. */
export function invalidationFor(change: ChangeKind): readonly string[] {
  if (!Object.hasOwn(INVALIDATION, change)) throw new Error('Unknown change class');
  return INVALIDATION[change];
}
