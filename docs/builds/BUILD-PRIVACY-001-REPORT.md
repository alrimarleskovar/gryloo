# BUILD-PRIVACY-001 — implementation report

## Result

**Draft foundation delivered; funded challenge acceptance remains blocked.** The owner corrected the demonstration choice to **SOL → public USDC with private SOL change** after discovery of Cloak's supported direction. The original USDC → private SOL request remains rejected.

This implementation adds required Cloak policy to Flofi's existing Guided/Canvas canonical swap, prevents public compilation/fallback, and introduces tested browser private-state preparation, encrypted immutable checkpoints, wallet-change protection and a strict reconciliation contract. It deliberately issues no executable financial Manifest, requests no wallet signature and submits no transaction. A feasibility report is explicitly non-executed evidence. This is not a completed end-to-end private-execution demonstration.

The isolated worktree is `/home/asus/projects/gryloo/.turbo/privacy001`, branch `codex/build-privacy-001-cloak`, based on fetched current main `7f582c55775f086ac456b22032c0c63a759c4176`. Main advanced from the initial `ce78992` base during implementation; only this privacy commit was rebased onto main, with four UI/export conflicts resolved to preserve main's behavior and add privacy. Protected worktrees/branches were not modified, merged, rebased, cherry-picked or used directly as an integration source. No branch was merged.

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

1. A safe prepare-only Cloak proof/transaction path bound to Flofi's existing artifacts, exact financial simulation, fees, expiry, provider-fixed Manifest and explicit Review. Deposit/shield preparation and submission are not implemented here. Actual prepared change must be supplied to the SDK rather than recreated internally.
2. Browser SDK proving and approved RPC/relay/circuit transport compatible with Flofi's network policy. Browser proving has not been validated; local SDK note tests do not establish it.
3. Integration of the encrypted vault and wallet guard into the owner-authorized execution/recovery UI, a durable public recovery-reference catalogue/journal linkage, verified backup UX, and atomic input-note reservations across runs/tabs. Immutable per-run checkpoint collision tests do not establish cross-run spending exclusivity.
4. Authoritative mainnet verification of SwapState, both transaction stages, exact recipient balance effects, nullifier spend and private commitment membership/index/unspent status. A pure reconciliation function cannot manufacture those observations.
5. Timeout/refund execution/recovery, malformed or incomplete SDK-result quarantine and resumption of ambiguous attempts without automatic resubmission. Valid divergent returned state is preserved now; the funded failure lifecycle remains unwired.
6. Genuine owner-funded execution, reload/recovery demonstration and redacted evidence produced through the canonical financial evidence model. No such evidence exists in this draft.

Do not remove the linter/capability/financial gates merely to make a demonstration appear successful. Do not treat mocked verdicts or the feasibility JSON as chain acceptance. Keep the PR draft until the gates and genuine evidence exist.

## Verification

Security coverage includes Guided/Canvas policy equivalence and hash parity, policy retention on edit, downgrade rejection, unsupported direction/network/amount, public compilation rejection, incomplete privacy declarations and Manifest binding; exact SDK note/recovery preparation, index-zero restoration and unexpected refund retention; encryption, read-back, immutable-write collisions, quota/lost-write failure, missing/corrupt/wrong-owner/wrong-secret state and validated backup restoration; wallet changes; journal semantics; and settlement/private-output reconciliation failures.

The isolated browser tests exercise the supported request and the original unsupported request. The supported test aborts any non-loopback browser request and asserts none occurred. It verifies explicit disclosure, honest feasibility, redacted report export and disabled authorization. [The captured feasibility JSON](BUILD-PRIVACY-001-feasibility.json) came from that browser flow, with workflow hash `0x74fe543e681094a6198dee680c23d26522f6af8f06ab104529427704c3f82943`. It is explicitly NOT_EXECUTED / NOT_PERFORMED / BLOCKED. These tests exercise authoring/UI, not browser proving or funded state recovery.

The unchanged v1 schema exports are verified separately. Sandbox restrictions initially prevented existing Python hash subprocesses and Next TypeScript output capture; rerunning authorized checks outside the sandbox resolved those environment failures. Chromium initially lacked shared libraries; the existing browser-library cache resolved that without changing system packages or another worktree.

Final local checks on 2026-10-04:

| Check | Result |
| --- | --- |
| `pnpm test` | **1,277 passed**, 2 existing skips; 152 passing files. Includes 27 added privacy security tests. Fork tests are excluded by the existing script. |
| `pnpm exec turbo run build typecheck --cache-dir .turbo/privacy001-cache` | **14 tasks successful**, including production Next build and all package/app type checks. |
| `pnpm lint` plus ESLint on the isolated privacy Playwright config | Passed. |
| `pnpm schemas:check` | **11 unchanged schema exports verified**. |
| `playwright test --config playwright.privacy.config.ts` | **2 passed**, including non-executed redacted feasibility export. |
| `git diff --check` | Passed. |

These checks do not substitute for real owner-funded challenge acceptance or an independent security audit.

[Draft PR #55](https://github.com/alrimarleskovar/gryloo/pull/55) targets main and remains draft pending genuine acceptance. The main-base conflict resolution is confined to this privacy branch.

## Demonstration, submission and owner actions

[BUILD-PRIVACY-001-DEMO.md](BUILD-PRIVACY-001-DEMO.md) contains the exact available demonstration, accurate submission explanation and future owner-only actions. No funded action is requested now. Funding and signatures become relevant only after the engineering gates above are implemented. No owner keypair was generated, and no owner message or transaction was signed/sent by the agent.

Out of scope: Zcash, private lending/LP/bridge, Mode C/private automation, generalized multichain privacy, B2B APIs, mainnet production rollout and any modification or merge of protected builds. Transitive dependencies bundled by Cloak do not enable those features.
