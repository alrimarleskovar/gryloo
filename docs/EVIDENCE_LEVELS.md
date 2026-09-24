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

BUILD-003A adds non-executing authoring and deterministic lint. Its interface
remains `MOCKED`; authorization is `NONE` and enforcement is `NOT_ENFORCED`.
Asset metadata is `NOT_ONCHAIN_VERIFIED`. Build financial evidence environment
and outcome are `NOT_APPLICABLE`. Browser surface tests and local static source
checks do not constitute quotes, simulation, protocol verification, transaction
execution or reconciliation. Local checks and remote CI are reported separately
in the [BUILD-003A report](builds/BUILD-003A-REPORT.md).

BUILD-003B adds a `MOCKED` Quote/State Artifact, Artifact Set and Simulation
Bundle chain built from a fixed synthetic rate. This is internal-logic evidence
only: the chain is not a live quote, not a financial simulation and not
execution evidence. P6 and P7 appear in mocked form and are not certified.
Build financial outcome remains `NOT_APPLICABLE`; no Evidence Bundle is
produced. Mocked provenance and hashes identify synthetic data and are not
authenticity proof. Local checks and remote CI are reported separately in the
[BUILD-003B report](builds/BUILD-003B-REPORT.md).

BUILD-003C introduces a separate `LIVE_READ_ONLY` or `RECORDED_REPLAY` observation mode. An observation is `NOT_EVIDENCE`, is not an authorization input, and has no financial outcome. The public Base RPC recording stopped after two HTTP 429 responses at request 12 (2/4 attempts, 24/84 requests). The original Alchemy attempt received HTTP 403 before a pinned method and remains preserved at 1/3 attempts and 1/63 requests. Under the approved DEC-0022 continuation, the owner recorded two real, canonical hash-pinned transcripts in attempts 2 and 3; final Alchemy usage is 3/3 attempts and 43/63 requests. The four code pins agree across directions and the historical replay passed local acceptance. This does not elevate the observation to financial evidence or independently enforced authorization. No further live recording is authorized. See the [BUILD-003C report](builds/BUILD-003C-REPORT.md).
