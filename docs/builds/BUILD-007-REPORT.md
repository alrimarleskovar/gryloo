# BUILD-007 — finite Mode B swap-to-liquidity report

**State:** LOCAL SYNTHETIC ACCEPTANCE COMPLETE / RECORDING STOPPED / NOT CERTIFIED. **Authority:** DEC-0038 and [approved plan](BUILD-007-PLAN.md), including the six consumer-manifest pin amendment and exact dependency-verifier amendment. **Baseline:** synchronized main `f4868b94e10981b820653dd21d1ef94a72edb067`. **Branch:** `codex/build-007-mode-b-composition`. Owner merge and certification are separate decisions.

## Delivered scope

The reference DApp authors one two-node revisioned Semantic Workflow: Base USDC → WETH exact-input Uniswap 0.05% swap, then one Uniswap v3 WETH/USDC 0.05% position owned by the Safe. A typed WETH output edge, immutable budget/range terms, distinct source-state and simulation artifacts, a new additive composition permission hash, exact owner installation/revocation calls, a fixed two-step worker, four-level durable journal and raw-RPC reconciliation implement the approved local chain-31337 path. `workflow-contracts` is private workspace version 0.3.0; six consumers use exact `workspace:0.3.0` pins. Frozen v1 schemas/vectors remain unchanged.

The owner reviews and signs each setup and revocation call. Safe 1.4.1 + Zodiac Roles 2.1.0 enforce separate one-use swap and mint calls. The mint role directly enforces Position Manager target, selector, pair, tier, ticks, Safe NFT recipient, desired-amount ceilings and fixed minimums/deadline. Uniswap enforces transaction-time minimums and deadlines. Gas reserve, cumulative budget and step order are application controls. The owner retains wider Safe authority. A successful swap followed by a failed mint is partial completion with Safe residuals; an unknown submission stays frozen without resend.

## Current evidence and gates

| Gate | Current result | Limit |
|---|---|---|
| Direct pinned Roles boundary on closed local fork | PASS: one-unit WETH/USDC excess, recipient, ticks, token, target and selector rejected; two same-block mint attempts yield one success and one failure; replay and revocation reject | One contention path uses a labeled local STOP target after direct bound rejection; no liquidity outcome inferred from it |
| Credential-free synthetic source recording | PASS: 116 loopback requests, 3,016 reserved listed CU, official pinned local code, actual Safe-owned NFT | `MOCKED` source state only |
| Synthetic closed replay | `REPLAY_BYTE_IDENTICAL` | `MOCKED` only |
| Browser review, installation, browser-close/fresh-worker continuation, NFT readback and revocation | PASS on synthetic closed local fork | Disposable local wallet, `MOCKED` |
| Browser wrong-chain rejection and restart without duplicate sends | PASS on synthetic closed local fork | `MOCKED` |
| Independent raw-RPC verifier in browser journey | Mint `RECONCILED`; overall `LIMITED` solely because source is `MOCKED` | No BUILD-007 fork claim yet |
| Credential-free Base recording preflight | PASS: manifest SHA-256 `977502de3c68f054365d1d2b41ed0121260b4b8940b158db837a8b3d11515627` | Credential and truthful rotation attestations follow preflight |
| Owner-operated read-only Base recording | STOPPED: 1/1 attempt, 2/1,500 read-only provider requests, 52/39,000 reserved listed CU; credential removed | Local harness readiness timeout at port 18545; root cause unconfirmed |
| New Base transcript, closed replay and independent verifier | NOT RUN; no transcript produced | A new owner decision is required for another recording attempt |
| `pnpm check`, exact governance, frozen install, audit and SBOM | `pnpm check` PASS: 13/13 typecheck, lint, 7/7 build, 11 schema exports, 400 passed / 2 skipped unit tests; both governance programs PASS before the verifier amendment; final local governance rerun blocked by automatic approval review; PR-head Governance PASS with the amendment. Frozen install PASS, low-level audit PASS (zero known vulnerabilities), dependency integrity PASS (247), ephemeral CycloneDX 1.6 SBOM PASS (247 registry components / 16 reviewed license exceptions) | No skipped/unrun gate counts as pass |
| PR-head CI | [Governance PASS](https://github.com/alrimarleskovar/gryloo/actions/runs/36415615279); [contracts FAIL](https://github.com/alrimarleskovar/gryloo/actions/runs/36415615319) at mandatory missing `composition-transcript.json`. Prior typecheck/build/unit and compatible fork steps passed. Browser, audit and SBOM steps were skipped after the failure. | PR #17 remains unmerged and check-blocked |
| Owner merge, post-merge CI, certification | NOT AUTHORIZED / NOT RUN | Owner decision required |

## Recording controls

The credential-free preflight verifies the owner-reported Free-plan, no-payment/no-paid-extension state, Base Mainnet availability, current 12,128 of 30,000,000 CU usage, 29,987,872 CU remaining, exact source/tool/method pins and the complete synthetic rehearsal. It intentionally does not demand `credentialRotated`, `previousCredentialDeleted` or `rotatedOn` before the fresh credential exists. The later `record` mode verified those truthful attestations, `format="gryloo.build-003f-provider-billing.v1"`, and a mode-0600 owner-created key file newer than the preflight manifest. It removed the credential after the stopped single attempt. The recording proxy is single-flight with at least 400 ms spacing, at most 1,500 requests / 39,000 reserved listed CU / 30 minutes, and permanent stop on the first provider, policy or accounting failure. Only approved read methods can reach Base; every local setup account/storage value is labeled `LOCAL_SETUP_NOT_BASE_OBSERVED`.

## Scope and baseline

The exact changed-path allowance is [plan §11](BUILD-007-PLAN.md) plus the six owner-approved consumer pins and the narrow owner-approved `scripts/bootstrap-ci.py` verifier edit. The governance gate compares each protected baseline path and mode to `f4868b94e10981b820653dd21d1ef94a72edb067`. Certified BUILD-003/004/006 fork evidence, BUILD-005 mocked evidence, historical transcripts, frozen v1 schemas/vectors, legal copies and earlier screenshots remain byte-identical. The global non-custodial multichain roadmap and Solana priority remain intact.

## Findings and next owner decision

The early browser worker resolved Vite modules relative to Playwright's subdirectory; an explicit repository root fixed it. The first repeated rehearsal found an existing stale synthetic marker, which was removed before a complete rerun. The real Base attempt then stopped at local harness readiness after two read-only requests. The stop journal records `HARNESS_FAILED`; no complete child diagnostic survived, so a port conflict or other root cause is not established. The credential was removed and no transcript was created. Automatic approval review rejected the final local governance rerun because it interpreted the invocation as including a checkout/fetch step that could overwrite uncommitted work; the earlier governance run passed before the narrow verifier amendment. PR-head Governance passed after the narrow verifier amendment. The contracts job reached the mandatory BUILD-007 transcript presence check and failed there, as the stopped attempt produced no transcript; later browser, audit and SBOM CI steps were skipped. The corresponding local gates passed. The exact next owner decision is whether to authorize a separately bounded new recording attempt after diagnostic work, or hold/close BUILD-007 at `MOCKED`. The existing approval grants no retry, merge or certification.
