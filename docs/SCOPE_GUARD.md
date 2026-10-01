# Scope guard — GOVERNANCE-LITE

The human owner is the repository authorization boundary. The normal flow is:
branch → code → focused tests → PR → CI → owner review → owner merge.

## Repository changes

Work on a named branch, never directly on main. Open a PR and leave merge to
the human owner; agents must not merge or enable auto-merge. Any legitimate
repository path may change as needed for the requested work. Keep changes
focused and explain meaningful risks and blockers.

No build-specific path allowlist, exact create/modify manifest, governance
amendment, historical permission baseline, reviewed source byte pin or duplicate
authorization phase is required. Owner instructions authorize implementation;
PR review and ordinary CI protect the resulting change.

## Safety remains required

- Do not expose secrets, credentials, private keys or seed phrases. Documented
  placeholders and generated non-secret test fixtures are allowed.
- Preserve lockfile integrity, the approved package manager/toolchain, dependency
  verification, license obligations, release-age/peer controls and security audits.
- Preserve typecheck, lint, build, schema compatibility, unit and relevant browser
  tests. Do not delete failing tests or silently bypass security checks to get
  green CI. Explain intentional changes to safety controls in the PR.
- Preserve explicit owner wallet authorization, no private key custody, no
  automatic owner signing, no silent mainnet execution, bounded authorization,
  fail-closed execution, recovery, reconciliation and evidence semantics.
- Agents must not autonomously send real-money transactions. Public execution
  using owner funds or signatures requires explicit human action in the reviewed
  wallet flow. A build request, PR or passing CI grants no transaction authority.
- Report skipped/failed checks and evidence honestly; a mock or local fork is
  not public execution. Keep fork/browser acceptance on closed replay/loopback.

## Checks and history

The existing `Governance` workflow/job runs one lightweight safety gate and its
focused self-tests. It scans the current tree for secret indicators, detects
obvious CI bypass/auto-merge changes, checks policy files and license copies,
and checks whitespace. Checkout includes only the current revision and immediate
parents to check the current diff, with no reviewed historical baselines or network
access during validation. The separate Contracts workflow
retains broad product, dependency, audit, fork, browser and SBOM checks.

Self-tests surface obvious disabling changes; they cannot make PR-controlled
code tamper-proof. Owner review and owner-managed branch protection remain
necessary. Main pushes are checked after owner merge; CI cannot establish who
performed a merge from a source checkout alone.

BUILD-012A and earlier plans, reports, decisions and evidence remain historical
records of the old model. Their path lists and governance procedures are not
requirements for future builds. [Migration notes](GOVERNANCE_LITE.md) record the
baseline and preserved controls. Implementation scope does not expand any
historical financial execution permission or evidence claim.
