# GOVERNANCE-LITE migration

The human owner authorizes repository changes by reviewing and merging PRs.
Future builds may edit any legitimate repository path without a per-build path
manifest or governance amendment. Implementation approval never grants wallet
signature, public transaction or real-funds authority.

## Baseline and scope

Work began on `codex/governance-lite` with a clean working tree at the
post-BUILD-012A baseline `6e41b2fb5762c321730c3427aeb1fc0c64d8f916`.
This migration changes governance, agent instructions and explanatory docs only.
BUILD-012A plans, reports and evidence remain unchanged. No BUILD-014 worktree
was inspected or modified, and no BUILD-014 product feature was implemented.

## What the old controls did

| Old mechanism | Purpose | Migration |
|---|---|---|
| Exact per-build Create/Modify sets and UX path categories | Restrict implementation to previously authorized files | Removed; focused PR diff and owner review authorize paths |
| Fetches of old reviewed commits and historical tree comparisons | Re-prove earlier and current build authorization | Removed; shallow current revision/parent checkout for ordinary diff checks |
| Reviewed source/test hashes and masking exceptions | Permit privileged tokens only in byte-identical reviewed files | Removed; product correctness and financial boundaries remain in code/tests |
| Two large inline validation phases | Repeat scope, history, policy and byte checks | Replaced by one local safety gate with focused self-tests |
| Build amendments, fixed branch/baseline combinations and recursive exceptions | Authorize each new file or assertion change | Removed for future implementation |
| Basic secret patterns and workflow permission restrictions | Surface credentials and privileged automation | Retained in the lightweight check, with documented placeholders allowed |
| Dependency, toolchain, license, patch, audit and SBOM checks | Protect dependency integrity and legal obligations | Existing Contracts workflow and bootstrap verifier preserved |
| Product guards and financial evidence checks | Enforce authorization, bounded execution and honest reconciliation | Product code/tests and CI fork/browser/evidence validation preserved |

Historical report formatting, email/name rules and blanket source/schema/asset
freezes are no longer automated authorization gates. Reports and evidence must
remain truthful, and schema compatibility still runs in ordinary CI. Toolchain,
registry, dependency patch, transcript and financial artifact integrity digests
retain their original purposes; these are not source edit permission pins.

## Current checks

The workflow remains named `Governance` and its job ID/display name remains
`governance`, preserving the existing check identity. It runs:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts -p 'test_governance_lite.py'
PYTHONDONTWRITEBYTECODE=1 python3 scripts/governance_lite.py
git diff --check
git diff --check HEAD^1 HEAD # CI checks the current PR/push diff
```

The standard-library Python check reads the current tracked/non-ignored tree
once. It checks branch context, the existing credential families plus seed
phrase literals, obvious disabled CI commands, forbidden merge automation,
read-only workflow permissions, policy/control file presence, package license
copies and current dependency settings. Diagnostics report paths and rule names,
never matched secret values. No additional scanner dependency was installed.

Checkout fetches only the current revision at depth two; its immediate parent(s)
are used solely for the ordinary PR/push whitespace diff. Checking a depth-one
snapshot as a root commit would incorrectly recheck unrelated historical
whitespace. The safety script and self-tests work with a single shallow commit
and no remote. No reviewed historical commits or authorization baselines are
fetched; validation makes no network requests. Ordinary Contracts CI still needs
official toolchain/artifact downloads and npm registry access for dependency
verification and security audit. Those meaningful dependencies remain intact.

Owner review is essential: PR-controlled scripts cannot guarantee protection
against coordinated malicious edits to both a check and its tests. These checks
surface obvious bypasses, not cryptographic owner authorization. Post-merge main
CI is allowed; the source checkout cannot determine who merged. GitHub returned
HTTP 403 when querying main protection (the repository plan does not expose
that feature), so no remote branch-protection guarantee is claimed or changed.

## Acceptance and validation

The 17 focused self-tests cover all required cases:

| Case | Expected result |
|---|---|
| A: several ordinary product files | PASS without path allowlist |
| B: a new adapter file | PASS without amendment |
| C: a changed test assertion | PASS without byte-pin update |
| D: a single shallow commit, no remote or historical objects | PASS through the actual CLI |
| E: private key, token, credential or seed phrase literal | FAIL, without printing the value |
| F: missing/commented/skipped/ignored/early-exit safety gate | FAIL |
| G: hypothetical BUILD-012B IR + adapter + DApp + tests | PASS without explicit manifest |

Additional cases cover local main/detached rejection, post-merge CI, merge
automation, privileged workflow changes, dependency control removal, disabled
test scripts and incorrect package license copies.

Local validation: self-tests, current-tree governance check, frozen offline
installation, `pnpm check`, registry integrity/license/release-age verification,
dependency audit and whitespace checks. The normal current-head GitHub CI runs
on the delivery branch/PR; its result belongs in the PR. No skipped check is a
pass. The sandboxed build could not read a TypeScript subprocess result; the
normal check succeeded outside that process sandbox. Registry checks likewise
required permitted network access. No gate or configuration was changed to
obtain those results.

## Future builds

BUILD-012B can edit IR, adapter, DApp and test files as needed for owner-requested
implementation. It needs ordinary product tests, CI and owner PR review, with
explicit human wallet action still required for public execution.

After this PR merges, the owner can rebase `claude/build-014-jupiter` onto the
new main. Resolve conflicts by adopting GOVERNANCE-LITE in active governance
files and retaining product changes and truthful historical evidence. Do not
restore old path lists, reviewed source hashes or historical scope fetches.
Dependency changes still undergo the existing dependency review and checks.
