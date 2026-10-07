# BUILD-DEVELOPER-001 — Report: FloFi for Developers (Developer API, SDK, webhooks)

Date: 2026-10-07. Branch `claude/build-developer-001` (worktree `~/projects/flofi-developer`), **stacked** on `claude/build-mcp-002`
at `8f9650a`. Nothing was merged, rebased, pushed or published, and no PR was opened: per the owner's instruction for this
session the work is committed locally only. No real financial transaction was signed or sent: every execution in this build ran
on MOCKED loopback chains, and the only "sends" in every journey are the test owner's own wallet transactions on those chains.

> **An API key is not financial authority.** A developer credential authenticates an *integration*, never a wallet and never a
> person. No Developer API endpoint signs, submits, approves a Review or moves funds, because none exists. Execution still needs
> the end user, in FloFi, to prove their wallet, run a fresh simulation, review the Strategy Manifest, approve explicitly and sign
> with their own wallet. FloFi and the developer never hold a key and never sign.

**Primary acceptance criterion (AC-0):** *a third-party server application can integrate FloFi end to end with minimal code while
FloFi remains the single execution truth and the developer credential has zero financial authority.* **Met on MOCKED chains and
local integration** (PostgreSQL + loopback browser): see §4. Not demonstrated on a live public testnet (§6).

## 1. What was built

```
Third-party server ── @defi-workflow-engine/developer-sdk (Apache-2.0, 0 deps) ──► /api/developer/v1/*  (src/developer/http.ts)
   enablement → browser refusal → API key (HMAC digest, every request) → rate → route → scope → closed schema → idempotency
                                                 │
                                                 ▼
                       src/platform  (one shared engine service, also used by MCP; MCP behaviour unchanged)
     compose → canonical IR + workflowHash → Strategy Review → execution plan + four facts → read-only simulation preview
                                                 │
     approval handoff (shared table; requester_kind DEVELOPER_PROJECT; bound by the DB to one immutable strategy revision)
                                                 │  https://<origin>/approve#flofi_dhs_<43>   (authority NONE)
                                                 ▼
     /approve → wallet proof (EIP-4361 / SIWS) → claim (re-compose, re-check, CAS) → the existing proposal card and flow panel
        → fresh simulation → Strategy Manifest Review → explicit approval → OWNER WALLET SIGNS → reconciliation → Evidence Bundle
                                                 │
     derived events (dedupe keys) → leased, signed Standard Webhooks deliveries (retried, then DEAD)   ◄── notifications only
     GET /approvals/:id · /executions/:id · /executions/:id/evidence   (runs the owner shares only; sharing OFF by default)
```

| Commit | Task | Content |
| --- | --- | --- |
| `b6d00d3` | plan | the approved plan |
| `819c197` | 1 | shared platform extraction (`src/platform`): MCP tools delegate; outputs byte-identical; boundary, parity and preview tests |
| `1558dc0` | 2 (Phase 2A) | one requester-neutral approval model: migration `0006_approval_requesters`, approval-link schemes, contributor-based `/approve`, claim-policy and viewer hooks |
| `4dbdb60` | 3 | migration `0007_developer_platform`, credentials (`flofi_sk_test_`), developer store, `fixedWindow`, operator CLI |
| `5087fc6` | 4–5 | the 10 endpoints over `src/platform`, the route file, `/approve` for developer requesters (third-party disclosure, sharing OFF by default), `pinnedHttpsRequest` |
| `14543bc` | 6 | derived events, leased signed deliveries with retries, the internal dispatch endpoint, `after()` sync on `/approve` |
| `5647f35` | 7 | the TypeScript SDK and the generated OpenAPI 3.1 document (drift-tested); CI inventory; license map |
| this commit | 8 | SDK-only third-party journeys (PostgreSQL and browser), two approval tests, developer and operator documentation, status and security documents, this report |

Committed footprint before this commit: 85 files, +12 748 / −599 relative to `8f9650a`.

## 2. Task 8 (this commit)

| File | Change |
| --- | --- |
| `apps/reference-dapp/src/developer/journey.pg.test.ts` (new) | the full AC-0 chain on the embedded PostgreSQL runtime a Preview runs, each request on a fresh "serverless instance": operator project + key → SDK only: capabilities → strategy → validate → simulate → webhook endpoint → approval → `/approve` view (third-party, unauthorized, sharing off) → claim with sharing → apply → the owner's unchanged router journey (Review, two wallet-signed transactions, reconciliation) → approval status, execution, canonical evidence → scheduler dispatch → four signed webhooks verified with the SDK. Asserts the Developer API reached only flow `mode`/`info`/`status` and `previewFlow`, and that the only two sends are the owner's |
| `apps/reference-dapp/e2e/developer-journey.spec.ts` (new) | the same chain in a real browser against the running app: the operator CLI writes the key to a new mode-0600 file under a temporary directory; the user opens the approval link, sees "Created by Acme Wallet, a third-party app registered with FloFi, not by FloFi" (no AI wording), sharing unchecked by default then checked, proves the wallet, loads the proposal, runs the unchanged bridge panel (fresh route + simulation, Manifest Review, two wallet transactions, observation to the bridge result); the app then reads status, execution and evidence and verifies the signed loopback webhooks |
| `apps/reference-dapp/playwright.config.ts` | under the existing embedded-loopback harness flag (`GRYLOO_MCP_E2E=EMBEDDED_LOOPBACK_ONLY`) only: per-run random developer secret and dispatch token, `FLOFI_DEVELOPER=enabled`, loopback webhooks, the token's digest |
| `.github/workflows/contracts.yml` | runs `developer-journey.spec.ts` in the CI browser group beside `mcp-in-chat.spec.ts`, on the same harness |
| `apps/reference-dapp/src/developer/engine.pg.test.ts` | two focused tests closing gaps found during recovery: **REVIEW_BLOCKED** (a Base Sepolia swap above the review's slippage limit composes and passes every availability fact, yet `POST /approvals` answers `422 REVIEW_BLOCKED` with `issues: [{path: "/strategy", rule: "SLIPPAGE_ABOVE_REVIEW_LIMIT"}]` and creates no handoff; the same swap within the limit is handed off) and the **open-approval cap of 100** (50 + 50 approvals across an hourly window boundary, each window under the 60/h rate; the 101st answers `429 RATE_LIMITED` / `PENDING_APPROVALS` with the count unchanged; another project is unaffected; once the first 50 lapse, the project may hand off again) |
| `docs/developer/{README,QUICKSTART,API,WEBHOOKS}.md` (new) | integrator documentation (Apache-2.0 per `LICENSE_MAP`) |
| `docs/deploy/DEVELOPER.md` (new); `docs/deploy/ENVIRONMENT.md` §5c and the local-only list; `docs/deploy/CLOUD.md` section | operator documentation: enabling, secret and rotation consequences, CLI, scheduler (an owner action), limits, runbook |
| `docs/STATUS.md`, `docs/SECURITY_MODEL.md`, `docs/AUTHORITY_MATRIX.md` | status entry; developer API boundary; "Developer API key — no financial authority" matrix |
| `docs/builds/BUILD-DEVELOPER-001-PLAN.md` | status line only (implemented; push withheld) |

No production source file changed in this commit.

## 3. Validation results (this session, 2026-10-07)

Local environment: Node 24.21.0, pnpm 11.22.0 (pinned). PostgreSQL **18.6** from the CI-pinned image
`postgres:18.6-bookworm@sha256:3725f4e2…0f6650`, on loopback port 55432 (another worktree's database held 5432; the suites take any
loopback `TEST_DATABASE_URL`). Foundry Anvil **1.8.3**, acquired with `scripts/bootstrap-anvil.py` (archive and binary SHA-256
verified) into a session scratch directory, because `playwright.config.ts` refuses to load without it. Browser runs used the CI
environment (`FLOFI_E2E_APP_PORT=3100`, the pinned headless shell 1243).

| Gate | Result |
| --- | --- |
| `journey.pg.test.ts` (AC-0, PostgreSQL) | **1/1 passed** (first run) |
| `developer-journey.spec.ts` (AC-0/AC-7, browser, embedded loopback) | **1/1 passed** (first run, 9.2 s) |
| `mcp-in-chat.spec.ts` (MCP E2E unchanged, same harness) | **5/5 passed** |
| New `engine.pg.test.ts` tests (REVIEW_BLOCKED, pending cap) | **2/2 passed** |
| `pnpm check` (typecheck, lint, build, schema drift, unit tests) | **passed**: 212 files / 1944 tests passed; 2 tests skipped — pre-existing BUILD-007 local-fork tests (`composition-service.test.ts`, `mode-b-service.test.ts`) that run only with a fork pin configured; unrelated to this build |
| `pnpm test:postgres` | **passed**: 29 files / 176 tests, none skipped |
| `python3 -m unittest discover -s scripts -p 'test_governance_lite.py'` (on a clean export) | **17/17 OK** |
| `python3 scripts/governance_lite.py` (on a history-free export of the final working tree, this report included) | **passed** (1108 text files) |
| `pnpm audit --audit-level low` | **FAILED — inherited, not weakened** (§7) |
| Fork suites (`pnpm test:anvil`), the full CI browser list | not run: outside this build's surface; CI runs them |

## 4. Acceptance criteria

| AC | Evidence | Result |
| --- | --- | --- |
| AC-0 third-party E2E, zero financial authority | `journey.pg.test.ts`, `developer-journey.spec.ts`; flow-call recording; `sends === owner signatures` | **met (MOCKED + local integration)** |
| AC-1 platform extraction, MCP unchanged | commit `819c197` gates; every MCP unit, PostgreSQL and browser test still passes (`pnpm check`, `pnpm test:postgres`, `mcp-in-chat.spec.ts` 5/5) | **met** |
| AC-2 every §5 invariant tested; no route reaches a mutating flow method | `api.pg`, `engine.pg`, `store.pg`, `webhooks.pg`, `journey.pg` (`READ_ONLY_CALL`; the journey's flow-call log); output guard on every response | **met** |
| AC-3 StrategySpec, hash, validation, simulation and gate parity with MCP and the engine | `platform/parity.test.ts`, `engine.pg.test.ts` (REST ≡ MCP `compose_strategy`/`validate_strategy`/`simulate_strategy`) | **met** |
| AC-4 tenant isolation; no secret in logs, payloads, errors or idempotency rows | `api.pg` (identical 404s, log and table sweeps for `flofi_sk_`, `flofi_dhs_`, `whsec_`), `store.pg` (tenants), `webhooks.pg`, journey payload sweep | **met** |
| AC-5 webhooks signed, replay-protected, retried with bounded backoff, duplicate-safe, replaceable, never authority | `webhooks.pg` (endpoint pinned to 500 leaves outcomes identical, leases, jitter bounds, DEAD after 10, stable `webhook-id`, replacement), SDK `webhooks.test` (vector, tamper, stale, wrong secret, secret arrays) | **met** |
| AC-6 sandbox test-funds only; live keys and mainnet refused | `engine.pg` (`SANDBOX_TEST_FUNDS_ONLY`, `LIVE_MODE_DISABLED`), `api.pg`, capability rows mark mainnet unavailable | **met** |
| AC-7 browser journey through `/approve` on the embedded loopback runtime; MCP E2E unchanged | `developer-journey.spec.ts` 1/1, `mcp-in-chat.spec.ts` 5/5 | **met** |

Test inventory (developer surface): `developer/` api.pg 10, engine.pg 9, store.pg 12, webhooks.pg 9, sdk.pg 2, journey.pg 1,
credentials 6, boundary 3, openapi 3; `platform/` approvals.pg 5, approve.pg 8, handoff-store.pg 6, handoff-migration.pg 1,
approval-links 5, parity 5, preview 3, boundary 3; `server/approval-surface.pg` 3; operator CLI 1 + 1; SDK client 4, webhooks 3;
browser 1.

## 5. Deviations from the plan (for owner review)

1. **File layout.** The plan's per-resource modules (`src/developer/resources/*`, `router.ts`, `events`/`dispatch` split as
   listed) were implemented as `http.ts` (boundary + route table), `service.ts` (operations), `views.ts`, `schemas.ts`,
   `errors.ts`, `events.ts`, `dispatch.ts`, `webhooks.ts`, `approval-profile.ts`, `admin.ts`, `keys.ts`, `limits.ts`. Behaviour
   follows the plan; the route table is exported and the OpenAPI document must describe exactly it (unit test).
2. **Test files consolidated.** The plan's `auth`/`isolation`/`idempotency`/`limits`/`strategies`/`approvals`/`executions`/`events`
   PostgreSQL files are covered inside `api.pg`, `engine.pg`, `store.pg` and `webhooks.pg`; `sdk-parity` is `sdk.pg`
   (type equality with the server's `Static` types plus SDK ↔ handler through an injected `fetch`).
3. **Approval binding** uses a `developer_approvals` row written by an `AFTER INSERT` trigger on the handoff table (foreign key to
   the strategy *and* its workflow hash; immutable), rather than only a check trigger — the same guarantee, plus a sync cursor for
   event derivation.
4. **SDK import name.** The private workspace package is `@defi-workflow-engine/developer-sdk`; the npm name `@flofi/sdk` stays
   reserved (publication deferred). The documentation uses the workspace name.
5. **Webhook endpoint cap** answers `403 FORBIDDEN` (`WEBHOOK_ENDPOINT_LIMIT`), not `429`: it is a quota, not a rate.
6. **Two `/approve` changes visible to every requester** (Phase 2A, previously reviewed in the plan): `/approve` no longer requires
   MCP OAuth (it serves each registered requester kind through its own link scheme and key), and its disclosure line is
   requester-aware (MCP and channels: AI assistant; developer projects: third-party app).

## 6. Evidence categories (§26)

- **Implemented:** the plan's MVP — shared platform, generalized approvals (0006), developer persistence (0007), credentials and
  operator CLI, 10 endpoints + the internal dispatch endpoint, `/approve` for developer requesters, events and signed webhooks,
  the SDK and OpenAPI, journeys, documentation.
- **Mocked:** all chain execution and providers (MOCKED loopback Base Sepolia / Arbitrum Sepolia router harness; the MCP browser
  suite also exercises MOCKED Solana Devnet and lending harnesses).
- **Local integration tested:** PostgreSQL 18.6 (pinned image) suites; the loopback browser journey with a loopback webhook
  receiver; the operator CLI against the run's disposable database.
- **Live public testnet tested:** **NOT DONE.** It needs the owner: a Preview with the Developer API enabled and a testnet wallet,
  since only the owner signs.
- **Production-ready:** **NO** — no scheduler entry (owner action), operator-set project names (phishing surface without
  verification), no portal or live-key policy, legal review outstanding.
- **Mainnet-ready:** **NO** — sandbox only; live keys refused; mainnet strategies refused at creation.
- **Not yet done:** everything in plan §27 (deferred endpoints, portal, production credentials, rotation in place, usage API,
  billing, npm publication, remote-runtime developer state, a cron entry, the general sequential runner, WalletConnect, mainnet).

## 7. Warnings and open items

1. **`pnpm audit --audit-level low` fails** with two **high** advisories: `source-map-js` 1.2.1 (GHSA-68fv-2mgg-jv7q, via
   `vite`/`vitest` → `postcss`) and `sharp` 0.35.4 (GHSA-wq5f-xc86-pv6w / CVE-2026-96889, via `next`). Both are **inherited**: relative
   to its stacked base `8f9650a`, this branch changes `pnpm-lock.yaml` only by the SDK's empty importer
   (`packages/developer-sdk: {}`). Both are fixed on `main` by the overrides in `78be634` (UX-008: `postcss@8.5.23>source-map-js`,
   `postcss@8.5.28>source-map-js` → 1.2.2; `next@16.3.6>sharp` → 0.35.5). The audit was not weakened and no override was copied here;
   the branch inherits the fix when it is re-stacked onto `main`.
2. **Re-stack required before a PR.** Local `main` (`a23a77d`) has merged PR #63 (BUILD-MCP-001); BUILD-MCP-002 and this branch must
   be re-stacked by the owner's decision (the agent did not rebase). The MCP edits of this build are delegation in `tools.ts`,
   the `service.ts`/`store.ts` compatibility re-exports and the 0006 generalization.
3. **CHANNELS overlap** (plan §22): migration numbering (`0007` here) and small textual risk in `approval-handoff.tsx`. The CHANNELS
   worktree was not touched.
4. **Webhook latency on Previews:** without a scheduler, `execution.*` notifications wait for the integrator's next request or the
   user's next `/approve` action (documented; `GET /approvals/{id}` is always current).
5. **Regulatory:** third parties steering users to sign DeFi transactions through FloFi needs the owner's legal review before any
   production or mainnet use.

## 8. Repository gates and reproduction

```bash
export TEST_DATABASE_URL=postgres://flofi@127.0.0.1:<port>/postgres          # a loopback PostgreSQL (CI pins 18.6 by digest)
pnpm check && pnpm test:postgres
export GRYLOO_ANVIL_BIN=<dir>/foundry-v1.8.3/anvil                             # python3 scripts/bootstrap-anvil.py <dir>/foundry-v1.8.3
export BUILD002_BROWSER_CACHE=<headless shell 1243> FLOFI_E2E_APP_PORT=3100
GRYLOO_MCP_E2E=EMBEDDED_LOOPBACK_ONLY pnpm --filter @defi-workflow-engine/reference-dapp exec playwright test developer-journey.spec.ts mcp-in-chat.spec.ts
python3 -m unittest discover -s scripts -p 'test_governance_lite.py' && python3 scripts/governance_lite.py   # on a clean export
pnpm audit --audit-level low
```

Governance-Lite on a history-free export of the final working tree (this report included): passed, 1108 text files; self-tests
17/17. Dependency integrity: no registry package added or changed by this build; the pinned toolchain is unchanged; the SDK's
`LICENSE` is the unmodified Apache-2.0 text.
