# Evidence levels

Future financial evidence environments are `MOCKED`, `FORK_REPRODUCED`,
`TESTNET_EXECUTED`, and `MAINNET_EXECUTED`. Future financial outcome statuses
include `CONFIRMED_NOT_RECONCILED`, `RECONCILED`, `INCONCLUSIVE`, and `DIVERGENT`.
They may be used only when their technical prerequisites are met.

BUILD-000 is governance-only:

- Evidence environment: `NOT_APPLICABLE`
- Financial outcome status: `NOT_APPLICABLE`
- Retained evidence: repository inventory, Git baseline, specification digest,
  governance checks, and human decision records

Governance checks are not financial execution or reconciliation evidence.

BUILD-001 adds contract verification only:

- Evidence environment: `NOT_APPLICABLE`
- Financial outcome status: `NOT_APPLICABLE`
- Authorization mode: `NONE`; financial enforcement: `NOT_ENFORCED`
- Retained evidence: versioned schemas, source tests, compatibility vectors,
  lockfile, approved plan, truthful report, and reviewed Git changes
- Per-run evidence: test and bootstrap logs, dependency checks, and SBOM digest
  in CI logs and the job summary

The SBOM file exists temporarily for validation. It is not committed, uploaded,
or claimed as a retained artifact. Local validation does not prove a remote CI
run. Synthetic fixtures containing financial environment or outcome enum values
test contracts; they do not demonstrate those outcomes. No primitive has P1–P14
certification from this build.

BUILD-002 local acceptance is demonstrated by strict compiler, full
dependency integrity/license inventory, frozen install, regression, browser,
accessibility, network, visual, audit, ephemeral SBOM and governance gates
recorded in the [BUILD-002 report](builds/BUILD-002-REPORT.md). These are local
observations; remote CI and future binary release compliance require their own
evidence.
