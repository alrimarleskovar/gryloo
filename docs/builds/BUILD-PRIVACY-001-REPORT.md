# BUILD-PRIVACY-001 — implementation report

## Result

**Local execution/recovery slice implemented; funded challenge acceptance remains blocked.** The selected demonstration remains **SOL → public USDC with private SOL change**. The original USDC → private SOL request remains rejected. This continuation preserves the foundation and adds a complete deterministic LOCAL/MOCKED lifecycle; it does not enable financial execution.

This implementation adds required Cloak policy to Flofi's existing Guided/Canvas canonical swap, prevents public compilation/fallback, and introduces tested browser private-state preparation, encrypted immutable checkpoints, wallet-change protection and a strict reconciliation contract. It deliberately issues no executable financial Manifest, requests no wallet signature and submits no transaction. A feasibility report is explicitly non-executed evidence. This is not a completed end-to-end private-execution demonstration.

The isolated worktree is `/home/asus/projects/gryloo/.turbo/privacy001`, branch `codex/build-privacy-001-cloak`, continuing from Draft PR #55 head `e98101d196b09b717003beaf3d60098ca7d3e4bb`. Its prior base is `ebbd4aa3766a656f01b24a61ea71e13c4963b1f8`. This continuation changed only this worktree. Main, CI migration, Tempo and BUILD-016 were untouched. The owner reviewed the LOCAL/MOCKED checkpoint report and authorized committing/pushing it and updating PR #55 while keeping the PR draft. No merge, owner signature, funding or public-chain transaction occurred. The next live stage does not inherit challenge acceptance from this checkpoint.

## Discovery and implemented boundary

The [plan](BUILD-PRIVACY-001-PLAN.md) was written before implementation and records the official documentation, SDK inspection, network, wallet and security findings. The implementation pins published `@cloak.dev/sdk` **0.2.5**; SDK note generation, commitments, serialization and recovery derivation are exercised directly in local tests. No guessed SDK calls or alternate privacy application were introduced.

| Existing Flofi boundary | Change |
| --- | --- |
| Guided / Canvas | Same `ADD_SOLANA_SWAP` / `SET_SOLANA_SWAP` commands, editor reducer and proposal review; canonical SOL → USDC construction with required privacy. |
| Canonical IR | Existing hash-covered capability/adapter fields express required Cloak and public output with private change. No frozen v1 schema changes. |
| Manifest / artifacts | A typed projection checks the canonical hash, revision, owner chain, Mode A and fixed Cloak provider. Public Jupiter and generic Solana artifact compilation reject privacy requirements. No unverified executable Manifest is produced. |
| Capability / linter | Privacy authoring remains available; financial execution and evidence upgrades are blocked by explicit missing-gate findings. Existing public capability behavior remains covered by regression tests. |
| Simulate / Execute tabs | Required privacy and output disclosure appear in the existing UI. Feasibility hashes and validates the IR; financial simulation is explicitly absent and authorization is disabled. |
| Cloak adapter | Uses actual SDK note codecs and recoverable change/refund derivation. Prepares 1–2 indexed SOL inputs, positive private change, at most 0.05 SOL gross swap. Rejects unsupported network/direction and hidden many-note consolidation. Captures actual returned outputs/refund data before comparing with prepared state. |
| Private state | AES-256-GCM encrypted browser checkpoints with PBKDF2-SHA256 (310,000 iterations), random salt/IV and authenticated owner/genesis/program/run/Manifest linkage. Atomic immutable IndexedDB writes require strict durability, persistent-storage grant and verified read-back. Prepared and result checkpoints are retained separately. |
| Recovery | Exact 128-byte SDK note encoding plus explicit index metadata preserves leaf index zero. Missing/corrupt state and wrong unlock secret fail. Encrypted backup/restore validates before writing. Divergent valid SDK results remain persisted, with a recovery reference attached to the error. |
| Owner wallet | Browser session guard requires mainnet transaction/message features and events; any change is latched, including switching away and back. This guard is prepared for the future hand-off; financial signing is not wired. |
| Journal | Reuses canonical hash-linked attempt journal; a public `CONFIRMED` observation transitions to `RECONCILIATION_REQUIRED`, not success. The helper is tested, not connected to a live Cloak run. |
| Reconciliation | Pure verdict over separately established chain and vault observations. Requires finalized Tx1 and Tx2, SWAPPED settlement, spent inputs, reviewed public recipient/mint/minimum, exact unspent private change and durable reload/refund retention. The authoritative observation transport is not implemented. |

Private spending authority stays outside public artifacts and server actions. Vault linkage is security-critical but does not itself prove a chain result. Synthetic test observations and SDK-generated local notes are not financial evidence.

## Protocol and browser constraints

This slice is **Solana mainnet-beta only**. Program, genesis, SOL/USDC mint addresses, production relay and ceremony version are recorded exactly in the plan and `CLOAK_RUNTIME`. Public USDC output is a Cloak protocol constraint for this swap path. Public confirmation alone cannot prove the intended private result. See [official transaction flows](https://docs.cloak.ag/platform/transaction-flows) and [the published SDK](https://www.npmjs.com/package/@cloak.dev/sdk).

SDK free functions combine proving and submission. Flofi's current exact unsigned-message simulation/review boundary cannot be replaced with a relay success string. Its browser CSP remains `connect-src 'self'`; this draft has no new RPC/relay/circuit proxy or broader browser permissions. The adapter's financial entry gate unconditionally throws `CLOAK_VERIFIED_EXECUTION_BOUNDARY_UNAVAILABLE`.

## Engineering gates still required

These are implementation gaps, **not owner funding/signature blockers**:

1. A safe prepare-only Cloak proof/transaction path and exact financial simulation bound to Flofi's existing artifacts, live fees, expiry, provider-fixed Manifest and explicit Review. The deterministic local fixture now builds and validates that artifact chain, but has no unsigned chain message or proof simulation. Deposit/shield preparation and submission remain unimplemented. Actual prepared change must be supplied to the live SDK rather than recreated internally.
2. Browser SDK proving and approved RPC/relay/circuit transport compatible with Flofi's network policy. Browser proving has not been validated; local SDK note tests do not establish it.
3. Integration into the financial browser UI, approved recovery-reference catalogue/public journal linkage and verified backup UX. Atomic input-note/nonce reservations are now implemented with a strict-durability multi-key IndexedDB transaction and tested with an atomic local backend across concurrent executions/runs. Their actual multi-tab browser behavior has not been acceptance-tested. The orchestration harness uses the Node compiler/hash boundary and is deliberately absent from the financial UI; production browser orchestration is still required.
4. Authoritative mainnet verification of SwapState, both transaction stages, exact recipient balance effects, nullifier spend and private commitment membership/index/unspent status. A pure reconciliation function cannot manufacture those observations.
5. Live timeout/refund execution/recovery and live chain inspection of uncertain attempts. The local lifecycle now persists raw malformed/divergent SDK hand-offs in an encrypted quarantine record, restores exact results and resumes inspection/reconciliation without resubmission. The funded failure lifecycle remains unwired.
6. Genuine owner-funded execution, reload/recovery demonstration and redacted evidence produced through the canonical financial evidence model. No such evidence exists in this draft.
7. SDK dependency clearance: the remaining Elliptic advisory must be resolved without suppressing the repository's low-severity audit gate. The exact added dependency inventory/licenses must also be reviewed and admitted through the existing integrity/SBOM controls before merge. The current registry/license verification deliberately remains failing; no allowlist or CI gate was weakened.

Do not remove the linter/capability/financial gates merely to make a demonstration appear successful. Do not treat mocked verdicts or the feasibility JSON as chain acceptance. Keep the PR draft until the gates and genuine evidence exist.

## Local lifecycle completed in this continuation

`compileCloakLocalReview` validates the existing canonical privacy-required workflow and produces schema-valid QuoteStateArtifact → ArtifactSet → SimulationBundle → AuthorizationPolicy → StrategyManifest → ExecutionPlan using the frozen v1 hash domains. Given the same SDK-prepared note commitments and fixture route, its arithmetic and artifacts are deterministic. It binds gross shielded SOL spend, included fixture fee/cap, USDC expected/minimum output, public recipient, private change, input commitments, provider/program/genesis, nonce, expiry, owner and recovery policy. Fixture price/fees are explicitly local data, not discovered market values or deployed PoolConfig evidence.

The adapter now exposes a prepare-only note-material function so the actual SDK change commitment can enter Review before saving the final Manifest-linked prepared note checkpoint. The existing persisted preparation API and completed SDK codecs remain intact. No random change note is regenerated during execution/recovery.

The local authorization function validates and hashes the entire reviewed bundle, uses the existing latched mainnet owner-wallet guard, and issues an in-process receipt only for an explicit acknowledgment of that exact digest. Copying/forging a receipt, changing route/amount/recipient/policy/Manifest after review, or switching wallets fails closed. This acknowledgment is a **simulated authorization**, not a wallet signature or financial permission; both wallet signing methods are test spies that throw if invoked. The local Manifest cannot unlock the production financial gate.

The execution controller verifies the same review and actual vault notes, then atomically commits encrypted submission intent plus reservations for each input commitment and the owner/network/program authorization nonce. A collision denies execution before submission. Reservations are conservative and never automatically released. Before the intent commits, restart requires a new review. After intent commits, restart is inspection-only, even if the submitter response was lost, the record disappeared, the wallet changed or a result/evidence write failed. No unknown attempt is automatically submitted again.

After the closed in-process ledger runs, the vault preserves the exact raw SDK hand-off before decoding or checking it, the immutable actual result, submission observations and the reconciliation verdict. It can locate a committed encrypted result whose evidence pointer was lost. Recovery reloads actual SDK notes and requires the existing reconciler to establish finalized Tx1/Tx2, SWAPPED settlement, spent inputs, reviewed public recipient/mint/minimum, exact unspent change commitment/amount/index, durable outputs and retained refund authority. Unknown chain/ledger data, absent/corrupt checkpoints or mismatches never produce success. Every outcome is explicitly **LOCAL / MOCKED**.

The local ledger has no RPC, relay, wallet-signing or external submission hooks. Tests reload the controller/vault while the independent mocked ledger still has its observation; losing that ledger makes recovery inconclusive. This does not prove public-chain transport, real chain observation, browser proving, actual owner authorization or funded execution. The financial UI, original feasibility artifact and unconditional live execution guard remain intact.

Files changed for review: `packages/reference-compiler/src/privacy.ts`, `packages/reference-compiler/src/index.ts`, `apps/reference-dapp/src/privacy/local-execution.ts`, `apps/reference-dapp/src/privacy/local-execution.test.ts`, `apps/reference-dapp/src/privacy/cloak-adapter.ts`, `apps/reference-dapp/src/privacy/vault.ts`, and this report, the plan, demo and [dependency investigation](BUILD-PRIVACY-001-DEPENDENCIES.md). No dependency, lockfile, schema, CI, wallet-guard or pure reconciler file changed.

## Verification

Security coverage includes Guided/Canvas policy equivalence and hash parity, policy retention on edit, downgrade rejection, unsupported direction/network/amount, public compilation rejection, incomplete privacy declarations and Manifest binding; exact SDK note/recovery preparation, index-zero restoration and unexpected refund retention; encryption, read-back, immutable-write collisions, quota/lost-write failure, missing/corrupt/wrong-owner/wrong-secret state and validated backup restoration; wallet changes; journal semantics; and settlement/private-output reconciliation failures.

The isolated browser tests exercise the supported request and the original unsupported request. The supported test aborts any non-loopback browser request and asserts none occurred. It verifies explicit disclosure, honest feasibility, redacted report export and disabled authorization. [The captured feasibility JSON](BUILD-PRIVACY-001-feasibility.json) came from that browser flow, with workflow hash `0x74fe543e681094a6198dee680c23d26522f6af8f06ab104529427704c3f82943`. It is explicitly NOT_EXECUTED / NOT_PERFORMED / BLOCKED. These tests exercise authoring/UI, not browser proving or funded state recovery.

The unchanged v1 schema exports are verified separately. Sandbox restrictions initially prevented existing Python hash subprocesses and Next TypeScript output capture; rerunning authorized checks outside the sandbox resolved those environment failures. Chromium initially lacked shared libraries; the existing browser-library cache resolved that without changing system packages or another worktree.

Final local checks on 2026-10-04:

| Check | Result |
| --- | --- |
| `pnpm test` | **1,395 passed**, 2 existing skips; 162 passing files. Includes all prior 1,355 tests and **40 new local lifecycle tests**. Fork and PostgreSQL tests remain excluded by the existing script. |
| `pnpm exec turbo run build typecheck --cache-dir .turbo/privacy001-cache` | **16 tasks successful**, including production Next build and all package/app type checks. |
| `pnpm lint` plus focused ESLint on the privacy code/config | Passed. |
| `pnpm schemas:check` | **11 unchanged schema exports verified**. |
| `playwright test --config playwright.privacy.config.ts` | **2 passed**, including non-executed redacted feasibility export. |
| `git diff --check` | Passed. |
| Local governance safety check / self-tests | Passed; **17 self-tests**. |
| `pnpm audit --audit-level low` | **Failed: 1 low Elliptic advisory remains**; two high and one moderate advisories were removed with scoped published patch pins. No audit exception was added. |
| `bootstrap-ci.py --verify-dependencies` / approved SBOM inventory | **Failed: 20 violations**; 411 identities versus the approved 262, direct SDK/graph drift and 14 unreviewed license entries. No SRI mismatch/release-age/registry-read errors in this run. No approved dependency/SBOM evidence is claimed. |

The 40 new tests cover deterministic simulation, exact authorization binding/forgery, altered route/amount/fees/recipient/change/nonce, public fallback, invalid/stale Manifest, restart before intent and after submission, uncertain/lost responses, committed results with lost evidence writes, replay/concurrency/cross-run reservations, independent ledger double-spend rejection after catalogue loss, malformed/divergent SDK results, public/private reconciliation mismatch, corrupted/missing/unavailable checkpoints and wallet changes during intent persistence. The initial sandboxed full-suite/build attempt hit existing plain-Node/Python and Next subprocess restrictions; the approved unsandboxed local reruns passed. Browser checks used the existing generic browser/library cache and loopback server, with no system package install or external browser traffic.

These checks do not substitute for real owner-funded challenge acceptance or an independent security audit.

The raw SDK tree initially brought four advisories. Scoped overrides pin `jsonpath>underscore` to **1.13.8** and `@ethersproject/providers>ws` to **8.22.0**, addressing the [Underscore recursion advisory](https://github.com/advisories/GHSA-qpx9-hpmf-5gmw) and both WebSocket advisories. The [remaining Elliptic advisory](https://github.com/advisories/GHSA-848j-6mx2-7j84) affects the SDK's transitive **6.6.1**. The advisory lists 6.6.2 as patched, but the official npm registry returned no published 6.6.2 and identified 6.6.1 as latest during this work. Do not pin a nonexistent release or waive the failing gate. This draft does not use EVM signing, but that fact is not an audit exemption. The registry verifier also reported 14 new license-review entries (GPL-3.0 / Unlicense / missing metadata), unchanged existing exception pins and no new integrity-mismatch finding; this is not a completed license clearance. SDK dependency remediation/review is an engineering prerequisite, not an owner wallet action.

[Draft PR #55](https://github.com/alrimarleskovar/gryloo/pull/55) targets main and remains draft pending genuine acceptance. The main-base conflict resolution is confined to this privacy branch.

The current dependency investigation is recorded [separately](BUILD-PRIVACY-001-DEPENDENCIES.md). Elliptic 6.6.2 remains unpublished; Cloak has no newer stable release. Esprima's missing modern license metadata has a legacy BSD declaration and two-condition legal/source text, but the inventory gate still requires explicit admission. No safe published dependency remedy was applied, and no gate was weakened.

Remote checks observed on implementation commit `012bb0880c4caf7854677921519c2b4a8cd40f5e`: GitHub reports the PR as conflict-free (`MERGEABLE`) but checks are not green. Both [contract CI](https://github.com/alrimarleskovar/gryloo/actions/runs/37200420919) and [governance CI](https://github.com/alrimarleskovar/gryloo/actions/runs/37200420925) did **not start**: GitHub's annotation says recent account payments failed or the spending limit needs adjustment. It does not identify which account condition applies. These are account-level blockers, not remote test results. The [Vercel preview](https://vercel.com/alrimarleskovars-projects/flofi/Axy3vxeYHHCRSGCjJcBpoeMYVGdx) also reports failure; build logs could not be retrieved in this session, so its cause is unverified. No billing, spending limit, deployment settings or production rollout was changed. Owner-only follow-up is recorded in the demo instructions. Local passing checks do not establish that remote CI/deployment passed.

## Demonstration, submission and owner actions

[BUILD-PRIVACY-001-DEMO.md](BUILD-PRIVACY-001-DEMO.md) contains the exact available demonstration, accurate submission explanation and future owner-only actions. No funded action is requested now. Funding and signatures become relevant only after the engineering gates above are implemented. No owner keypair was generated, and no owner message or transaction was signed/sent by the agent.

Out of scope: Zcash, private lending/LP/bridge, Mode C/private automation, generalized multichain privacy, B2B APIs, mainnet production rollout and any modification or merge of protected builds. Transitive dependencies bundled by Cloak do not enable those features.
