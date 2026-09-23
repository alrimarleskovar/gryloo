# Invalidation contract v1

These are pure dependency declarations. They do not revoke an on-chain
permission, persist state, schedule work, or authorize execution. Consumers
must compare revisions and hashes and seek fresh human authorization where
required. The frozen [cases](../../tests/compatibility/v1/invalidation-cases.json)
and `INVALIDATION` in `packages/workflow-contracts/src/invalidation.ts`
define the exact v1 matrix.

| Change | Invalidated downstream references |
|---|---|
| Semantic edit | Quote/state artifact, artifact set, simulation, policy, manifest, execution plan, authorization |
| Quote refresh or expiration | Artifact set, simulation, policy, manifest, execution plan, authorization |
| Simulation change | Policy, manifest, execution plan, authorization |
| Policy edit | Manifest, execution plan, authorization |
| Manifest edit | Execution plan, authorization |
| Execution plan edit | Authorization |
| Journal or evidence append, presentation edit | None |

A quote refresh leaves semantic intent intact. Expiration retires the
dependent authority references. A material semantic edit creates a new
revision via `nextRevision`; stale base revisions fail with
`BASE_REVISION_CONFLICT` even for a requested no-op. A journal state
transition is validated separately at workflow, segment, step, and attempt
levels. Unknown submission outcomes and recovery states grant no retry or
execution permission.
