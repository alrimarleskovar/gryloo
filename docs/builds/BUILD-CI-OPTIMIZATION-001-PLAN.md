# BUILD-CI-OPTIMIZATION-001 — implementation plan

## Starting repository state

Verified in `/home/asus/projects/gryloo-ci-optimization`: branch
`codex/build-ci-optimization-001`, clean tree, HEAD and local `origin/main`
`fefda242e4abea5b8be5db57a9b8a09adbd2b65a` (merge of PR #71).
Remote is `alrimarleskovar/gryloo`. No new branch/worktree, runner
configuration change or other-worktree edit is required or authorized.
The shared Git metadata belongs to the existing worktree arrangement.

## Updated main integration

### Final integration instruction (2026-10-09)

The owner resumed integration after PR #73 merged at `fd0f9a3`. Preserve local
commit `938575b`, fetch and merge latest `origin/main` on the existing branch,
resolve compatibility issues, and run only safe focused local checks. Do not
pursue performance targets or additional benchmarks. When the runner is
available, push the final integrated branch once and let ordinary mandatory
Contracts/Governance CI run. Keep PR #74 Draft and report
`READY_FOR_OWNER_REVIEW` only after exact-head checks pass, otherwise `BLOCKED`.
Record final CI closeout in the existing PR description so no follow-up report
push changes the certified head. No new branch, other-worktree edits, runner
modification or automatic PR merge.

Integration merge `656c2d2` preserves parents `938575b` and `fd0f9a3`. The
browser release gate matches updated main's full spec/profile inventory,
including the new mandatory brand spec. The 41 focused tests, governance
scanner, syntax/command preservation and offline failure-propagation checks
passed. Main Contracts `37980271679` and Governance `37980271678` both passed
on `fd0f9a3`. Finalization independently reconfirmed source/command preservation
without running heavy tests. The matching runner was online and idle with no
queued/in-progress runs, and CI ports 5432, 3100 and 8545–8559 were clear at
19:47 UTC. Main certification and final branch CI are ordinary workflows.

### Earlier owner priorities and stopping snapshot (2026-10-09)

The CI optimizations are implemented. Do not expand scope, pursue the 20%
target, or initiate repeated benchmarks/unnecessary heavy validation. Integrate
PR #73 into this existing branch only after it merges and main certification is
available; preserve all optimization work and every mandatory CI/governance
gate. Resolve compatibility issues within that scope. Finish safe operations,
preserve completed work, and leave PR #74 Draft for owner review. If runner
availability blocks integration/validation, document the blocker and stop.
Never restart/modify the runner, interfere with other PRs, create another branch,
or merge PR #74. The historical benchmark strategy below is not authorization
to continue performance-target work after this priority update.

At the stopping snapshot (19:04 UTC), PR #73 is still open and runner
`flofi-wsl` is online/busy with its existing validation. There is no PR #73 main
certification to integrate. Evidence is preserved locally; no new run or push
was initiated.

The owner's later instruction explicitly authorizes incorporating PR #72 from
`origin/main` at `68249fad76f515dee9c953cb42df115492f191dd`. Fetch the remote,
save independent copies of all optimization files under the existing ignored
`.cache/build-ci-optimization-001/`, commit the optimization checkpoint and
rebase this branch onto that exact main baseline. Stop on conflicts; never force
or modify another worktree. Main adds one separately isolated
`channel-signing.spec.ts` browser invocation; preserve it and all PR #72 product
and test changes. Recheck the original command inventory against the updated
baseline and rerun governance/static checks. Historical PR #71 timing remains
historical evidence, not a controlled measurement of the updated product.

## Existing architecture and measured bottlenecks

Contracts and Governance both trigger on all pushes and PR events. Both use
`[self-hosted, flofi-wsl]`, read-only permissions and explicit shallow Git fetches.
Contracts sequentially verifies the pinned Node 24.21.0 / pnpm 11.22.0 archives,
installs with frozen lockfile and lifecycle scripts disabled, verifies all 265
registry identities/licenses/ages, typechecks, lints, builds, checks schemas,
runs units, PostgreSQL, offline Anvil/forks and guarded browser profiles, audits
dependencies and validates an ephemeral SBOM. Governance independently runs its
self-tests, safety/secret scanner and whitespace checks. Turbo concurrency is 2;
Playwright is serial with one worker and zero retries.

Successful run [37850860794](https://github.com/alrimarleskovar/gryloo/actions/runs/37850860794)
has 1,210 seconds of job wall time plus 1,155 seconds before job start. Its main
costs are browser validation (589s), combined static/build/unit validation (303s),
fresh registry review (120s), PostgreSQL (94s), and Anvil/forks (60s).
The frozen install is already 2s with the runner's existing pnpm store. Turbo
already reuses seven dependency builds within the same job; Next builds once.
The browser runner starts isolated fixtures for each of 19 product profiles and
one composition profile. Those isolation boundaries must remain intact.

Failed run [37866899397](https://github.com/alrimarleskovar/gryloo/actions/runs/37866899397)
is diagnostic evidence only. Its `.floating-toolbox` assertion fails after
`Undock toolbar`; it is not a successful performance baseline.

Initial resource observations: 7.7 GiB RAM, 4.2 GiB available, 1.9/2.0 GiB swap
used; `/tmp` is memory-backed. Historical successful-run start: 2.0 GiB swap used,
`/tmp` 87% full. These snapshots are not peak-memory measurements or proof of
sustained swap thrashing. Another Contracts job and queued runs were present at
initial inspection. Other local agent validation also shares the host.

## Optimization strategy and scope

1. Keep both triggers and existing required job identities. Introduce independent
   workflow-specific concurrency groups. Only runs for the same PR supersede;
   push groups contain unique run IDs, protecting both active and pending main
   certifications. Do not cancel existing jobs manually. Dynamic push/PR
   deduplication is deferred: unconditional gates and both events are existing
   governance requirements, and skipping a push check could misrepresent merge
   certification or require a broader governance change.
2. Request gzip for fresh full npm metadata. Fetch once per package name (259
   names for 265 locked versions) and retain each pinned version and publication
   time. Preserve eight network workers and all existing verification rules.
   Do not cache registry metadata or security evidence between jobs.
3. Cache only four public raw approved tool archives via an immutable official
   `actions/cache` commit. Rehash every restored archive into a private copy,
   extract anew and retain source/redirect, archive-entry and version checks.
   Node's official checksum listing remains a fresh request. No cache-hit gate
   conditions, build outputs, node_modules, credentials or database contents.
4. Split the combined validation stage into native steps without command changes.
   Move the existing audit before compilation to detect security
   failures sooner; retain SBOM at the end. Retain serial suites, Turbo 2 and Playwright 1.
5. Record stage elapsed time/outcome, system CPU/I/O/swap counters and endpoint
   memory observations with standard-library Python and Bash. Print each guarded
   profile's duration. Summary runs after success or failure without relaxing the
   governance allowlist; failure/cancellation remains non-success.

Cross-job Turbo, Next and TypeScript caches are rejected for this build because
untrusted executable outputs or cached successful gates cannot be independently
verified against source. An added pnpm cache is rejected because the measured
install is already 2s; shared global store reconfiguration is out of scope.
Browser profile consolidation and more workers are deferred until fixture state,
ports and memory isolation can be demonstrated independently.

## Security boundaries

All original commands, dependency/tool pins, lockfile, license/age exceptions,
financial authorization, replay-only networking and runner installation stay
unchanged. Cache keys include OS/architecture, exact four tool versions,
bootstrap/cache verifier source, lockfile and dependency configuration hashes.
No restore prefixes. Each job uses runner temporary storage; only named raw
archives are exported. Cache content is untrusted even on an exact key match;
SHA-256/SHA-512, sizes where already pinned, safe extraction and version checks
remain mandatory. Missing/corrupt entries require a verified download or failure.

## Validation and benchmark strategy

Run existing governance self-tests/scanner and new focused tests for bad digests,
missing caches, symlinks/FIFOs, cold/warm/invalidation, full dependency gate
violations, interruption/failure propagation, concurrency isolation and mandatory
suite preservation. Parse YAML, Bash and embedded Python; compare the command
inventory with the starting workflows. Review the complete diff.

Inspect Actions queue, host processes and RAM/swap before intensive validation.
Use only owned local scratch space on disk. Never kill other processes or change
shared Docker/runner resources. Run full original validation on the self-hosted
runner when available. Compare successful full jobs only, including cache
restore/save and service cleanup costs; record queue separately. Full cold/warm/
invalidation benchmarks and the 20% target remain `NOT MEASURED` until evidence
exists. Setup-only benchmarks are separate evidence, never a full-CI claim.

## Rollback and delivery

Deliver one PR on the prepared branch. Owner review/merge remains mandatory;
never merge or enable automatic merging. If remote contention or a real test
failure blocks full acceptance, preserve the implementation and mark acceptance
pending. Roll back by reverting the implementation commit through a normal PR;
archive cache removal requires no runner/global cleanup. Removing the archive
cache environment setting restores verified-download behavior without changing
validation gates. Detailed rollback commands and measured results belong in the
report.
