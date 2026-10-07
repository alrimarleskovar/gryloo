# PR #64 final release gates — 2026-10-07

Engineering readiness: **MAIN_READY** at takeover HEAD
`ece8313c003bde4992d79da616f82c14a1c7b960`, branch
`codex/build-product-ux-001`. Publishing and merging remain conditional on green
GitHub release checks for the final pushed PR head, with no conflict or protection
bypass. This report records the local gates before that commit and push.

The exact carried worktree was preserved. Its browser sources and intentional
snapshots predate the successful recovered runs. Their evidence was reused without
repeating browser remediation. The first pushed PR Governance run exposed one
extra blank newline at the end of `proposal-review.tsx` from an earlier commit:
the PR job checks the entire diff against main. Removing exactly that trailing
newline changes no runtime code or assertions. Typecheck, lint and production
build were rerun on this final source; the full PR whitespace diff was checked.
The sandboxed build compiled successfully but its TypeScript subprocess exited
with signal 139. The same production build passed outside the sandbox, with all
type checks enabled. No repository build setting changed.
Ephemeral evidence remains locally under
`apps/reference-dapp/.tmp/`; it must never be committed.

| Gate | Result |
| --- | --- |
| Default guarded browser | PASS, 56/56; recovered |
| Review / Execute / recovery | PASS, 31/31; recovered |
| CoW | PASS, 9/9; recovered |
| Guarded browser profiles | PASS, 17/17; recovered; same runner commands as CI |
| Typecheck | PASS, 15/15 tasks; rerun on final source |
| Lint, including guarded release runner | PASS; rerun on final source |
| Production build | PASS, 8/8 tasks; rerun on final source |
| Dependency age / license / integrity | PASS; fresh registry validation, 262 exact dependencies, 16 existing reviewed license exceptions |
| Temporary waiver | PASS; exactly `source-map-js@1.2.2`; no sharp waiver |
| Waiver / governance self-tests | PASS, 19 tests; recovered unchanged control-source evidence |
| Dependency audit | PASS, enforced `--audit-level low`; 0 HIGH, 0 CRITICAL, 0 other vulnerabilities |
| Final CycloneDX 1.6 SBOM | PASS; 262 exact registry components, dependency reference graph, nine separate workspace manifests/importers, 16 reviewed license exceptions |
| Governance | PASS; fresh current-tree validation |
| Secret scan | PASS; 1,149 release text files, zero findings; two unchanged synthetic test fixtures individually reviewed |
| Whitespace / conflict markers | PASS; working tree, staged diff and full PR diff against main; no unresolved conflict markers |

Fresh dependency evidence SHA-256:
`ce92e617b7a735c364de684e3c0d30001a61a8a31f91ee5eccd1709ae4a8eab4`.

Fresh validated ephemeral SBOM SHA-256:
`3159c504546838a86663637482679c09db1c99b201891f39435331e9d7892f2f`.
The validator removes its newly generated SBOM after recording the hash, as CI
requires; the recovered evidence directory remains intact.

Dependency manifests, lockfile and waiver were unchanged during this continuation.
The waiver removal condition remains **remove after Colosseum delivery**. No
audit advisory exclusion or threshold change is introduced.

The final remediation preserves duplicate group selection, migrates browser
interaction and screenshot baselines to the current product, and makes the
guarded profile selection identical locally and in CI. See
[guarded profile coverage](PR64-GUARDED-BROWSER-PROFILES.md) for the required
authoring, provenance, authorization and lifecycle coverage. Historical financial
diagnostic failures and unrun cases retain their original status. Existing unit,
PostgreSQL, offline fork, transcript and pinned composition contract gates remain
mandatory; mock results cannot authorize production financial execution.

Commit review excludes ephemeral evidence and generated Python bytecode. No
wallet action, public financial execution or owner acceptance is performed.
Release SHA, exact-head GitHub checks, merge SHA/time and production deployment
metadata are recorded in the final handoff after their verification.

DEPLOYED TESTNET/DEVNET ACCEPTANCE: **PENDING OWNER TEST**.

DEPLOYED MAINNET ACCEPTANCE: **PENDING AFTER TESTNET PASS**.

Functional acceptance is performed manually by the owner at **https://flofi.xyz**.
