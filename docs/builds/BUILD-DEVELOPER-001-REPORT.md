# BUILD-DEVELOPER-001 — Report: FloFi for Developers (Developer API, SDK, webhooks)

Date: 2026-10-07. Branch `claude/build-developer-001` (worktree `~/projects/flofi-developer`), originally stacked on
`claude/build-mcp-002` at `8f9650a`, then **re-stacked onto `main` at `f2881e3`** (after PR #65) by the owner-approved plan: only the
eight Developer commits were replayed, upstream UX/MCP safety controls were kept, and migrations 0006 and 0007 remain this build's
(§3a). Nothing was merged, pushed or published, and no PR was opened. No real financial transaction was signed or sent: every
execution in this build ran on MOCKED loopback chains, and the only "sends" in every journey are the test owner's own wallet
transactions on those chains (the browser journey now sends none, §3a).

> **An API key is not financial authority.** A developer credential authenticates an *integration*, never a wallet and never a
> person. No Developer API endpoint signs, submits, approves a Review or moves funds, because none exists. Execution still needs
> the end user, in FloFi, to prove their wallet, run a fresh simulation, review the Strategy Manifest, approve explicitly and sign
> with their own wallet. FloFi and the developer never hold a key and never sign.

**Primary acceptance criterion (AC-0):** *a third-party server application can integrate FloFi end to end with minimal code while
FloFi remains the single execution truth and the developer credential has zero financial authority.* **Met on MOCKED chains and
local integration** (the full lifecycle on PostgreSQL; the loopback browser journey up to Review, where current `main` blocks MOCKED
financial authority): see §4. Not demonstrated on a live public testnet (§6).

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
| `4aa9304` | plan | the approved plan |
| `98b4c40` | 1 | shared platform extraction (`src/platform`): MCP tools delegate; outputs byte-identical; boundary, parity and preview tests |
| `ecf1680` | 2 (Phase 2A) | one requester-neutral approval model: migration `0006_approval_requesters`, approval-link schemes, contributor-based `/approve`, claim-policy and viewer hooks |
| `97beaed` | 3 | migration `0007_developer_platform`, credentials (`flofi_sk_test_`), developer store, `fixedWindow`, operator CLI |
| `7a3603a` | 4–5 | the 10 endpoints over `src/platform`, the route file, `/approve` for developer requesters (third-party disclosure, sharing OFF by default), `pinnedHttpsRequest` |
| `1816ff3` | 6 | derived events, leased signed deliveries with retries, the internal dispatch endpoint, `after()` sync on `/approve` |
| `f29b942` | 7 | the TypeScript SDK and the generated OpenAPI 3.1 document (drift-tested); CI inventory; license map |
| `b664868` | 8 | SDK-only third-party journeys (PostgreSQL and browser), two approval tests, developer and operator documentation, status and security documents, this report |

Committed footprint before this commit: 85 files, +12 748 / −599 relative to `8f9650a`.

## 2. Task 8 (this commit)

| File | Change |
| --- | --- |
| `apps/reference-dapp/src/developer/journey.pg.test.ts` (new) | the full AC-0 chain on the embedded PostgreSQL runtime a Preview runs, each request on a fresh "serverless instance": operator project + key → SDK only: capabilities → strategy → validate → simulate → webhook endpoint → approval → `/approve` view (third-party, unauthorized, sharing off) → claim with sharing → apply → the owner's unchanged router journey (Review, two wallet-signed transactions, reconciliation) → approval status, execution, canonical evidence → scheduler dispatch → four signed webhooks verified with the SDK. Asserts the Developer API reached only flow `mode`/`info`/`status` and `previewFlow`, and that the only two sends are the owner's |
| `apps/reference-dapp/e2e/developer-journey.spec.ts` (new) | the same chain in a real browser against the running app, up to the boundary current `main` enforces: the operator CLI writes the key to a new mode-0600 file under a temporary directory; the user opens the approval link, sees "Created by Acme Wallet, a third-party app registered with FloFi, not by FloFi" (no AI wording), sharing unchecked by default then checked, proves the wallet, loads the proposal, runs the product's simulation and Strategy Manifest Review, where MOCKED financial authority is blocked (Approve disabled, execution blocked across a reload, no `eth_sendTransaction`, zero sends); the app then reads the applied approval and the prepared, unreconciled run with no evidence, and verifies the signed loopback webhooks (`approval.claimed`, `approval.applied`, `execution.started`). Re-stack update, §3a |
| `apps/reference-dapp/playwright.config.ts` | under the existing embedded-loopback harness flag (`GRYLOO_MCP_E2E=EMBEDDED_LOOPBACK_ONLY`) only: per-run random developer secret and dispatch token, `FLOFI_DEVELOPER=enabled`, loopback webhooks, the token's digest |
| `.github/workflows/contracts.yml` | runs `developer-journey.spec.ts` in the CI browser group beside `mcp-in-chat.spec.ts`, on the same harness |
| `apps/reference-dapp/src/developer/engine.pg.test.ts` | two focused tests closing gaps found during recovery: **REVIEW_BLOCKED** (a Base Sepolia swap above the review's slippage limit composes and passes every availability fact, yet `POST /approvals` answers `422 REVIEW_BLOCKED` with `issues: [{path: "/strategy", rule: "SLIPPAGE_ABOVE_REVIEW_LIMIT"}]` and creates no handoff; the same swap within the limit is handed off) and the **open-approval cap of 100** (50 + 50 approvals across an hourly window boundary, each window under the 60/h rate; the 101st answers `429 RATE_LIMITED` / `PENDING_APPROVALS` with the count unchanged; another project is unaffected; once the first 50 lapse, the project may hand off again) |
| `docs/developer/{README,QUICKSTART,API,WEBHOOKS}.md` (new) | integrator documentation (Apache-2.0 per `LICENSE_MAP`) |
| `docs/deploy/DEVELOPER.md` (new); `docs/deploy/ENVIRONMENT.md` §5c and the local-only list; `docs/deploy/CLOUD.md` section | operator documentation: enabling, secret and rotation consequences, CLI, scheduler (an owner action), limits, runbook |
| `docs/STATUS.md`, `docs/SECURITY_MODEL.md`, `docs/AUTHORITY_MATRIX.md` | status entry; developer API boundary; "Developer API key — no financial authority" matrix |
| `docs/builds/BUILD-DEVELOPER-001-PLAN.md` | status line only (implemented; push withheld) |

No production source file changed in this commit.

## 3. Validation results (original session on the `8f9650a` stack, 2026-10-07; superseded by §3a)

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

## 3a. Re-stack onto `main` (`f2881e3`) and validation on it (2026-10-07)

The eight Developer commits were replayed onto `main` after PR #65; none of the BUILD-MCP-001/MCP-002 history was replayed. Two
owner decisions shaped the adaptation to `main`'s safety controls:

- **A. `/approve` route-state headings unchanged.** The MCP route-presentation tests keep asserting them. Only the descriptions
  are requester-aware where the requester is known (the resolved proposal, else the link's `flofi_dhs_` tag, via
  `src/developer/link-format.ts`, an import-free constant the server's link scheme also uses). The tag only words a message; it
  authorizes nothing, and the server alone resolves a link. The shared surface's `APPROVALS_NOT_ENABLED` gets the same friendly
  message as its MCP-era name `MCP_OAUTH_NOT_ENABLED`.
- **B. The browser journey mirrors `main`'s release safety.** `main` blocks MOCKED financial authority at Review, so
  `developer-journey.spec.ts` now stops there and asserts it (Approve disabled with the authorization-required notice,
  `assertExecutionBlocked` before and after a reload, no `eth_sendTransaction`, zero sends; the approval link's response carries
  `connect-src 'self'` and `frame-ancestors 'none'`). The app sees the applied approval and the prepared run, unreconciled and
  without evidence, and three verified webhooks (`approval.claimed`, `approval.applied`, `execution.started`); no body contains a
  secret, calldata or `RECONCILED`. An unknown developer link shows the shared heading with app wording. The owner's full lifecycle
  (Review, two wallet-signed transactions, reconciliation, canonical evidence, `execution.reconciled`) remains proven by
  `journey.pg.test.ts`, as MCP's is. No release, MCP or financial-authority control was weakened.

Environment as in §3 (PostgreSQL 18.6 pinned image on loopback port 55432; Anvil 1.8.3 binary SHA-256 matching
`scripts/bootstrap-anvil.py`; CI browser environment with `FLOFI_E2E_APP_PORT=3100` and headless shell 1243). Browser runs waited
for another worktree's Playwright runs to release the fixed harness ports.

| Gate | Result |
| --- | --- |
| `pnpm check` (typecheck, lint, build, schema drift, unit tests) | **passed**: 251 files / 2575 tests; 2 skipped — the pre-existing env-gated BUILD-007 files (`composition-service.test.ts`, `mode-b-service.test.ts`), not touched by this branch |
| CI check-step extras (`eslint scripts/guarded-release-browser.mjs`, screenshot-diff self-test, linter exports) | **passed** |
| `pnpm test:postgres` | **passed**: 29 files / 176 tests, none skipped (all 11 developer/platform files, `journey.pg.test.ts` included) |
| `developer-journey.spec.ts` (embedded loopback) | **1/1 passed**, then **2/2** with `--repeat-each=2` |
| `mcp-route-presentation.spec.ts` (OAuth disabled, as CI runs it first) | **11/11 passed** |
| `mcp-in-chat.spec.ts` + `mcp-route-presentation.spec.ts` (embedded loopback) | **21/21 passed** (5 + 16) |
| `python3 -m unittest discover -s scripts -p 'test_governance_lite.py'` | **19/19 OK** (worktree and clean export) |
| `python3 scripts/governance_lite.py` (worktree; history-free export of the working tree) | **passed** |
| `pnpm audit --audit-level low` | **passed**: no known vulnerabilities (§7.1) |
| Guarded release browser profiles, fork suites (`pnpm test:anvil`, `test:fork`), BUILD-007 composition | not run locally: outside this build's surface; CI runs them |

## 4. Acceptance criteria

| AC | Evidence | Result |
| --- | --- | --- |
| AC-0 third-party E2E, zero financial authority | `journey.pg.test.ts` (full lifecycle; flow-call recording; `sends === owner signatures`), `developer-journey.spec.ts` (browser to Review; MOCKED authority blocked, zero sends) | **met (MOCKED + local integration)** |
| AC-1 platform extraction, MCP unchanged | commit `98b4c40` gates; every MCP unit, PostgreSQL and browser test still passes (`pnpm check`, `pnpm test:postgres`, `mcp-in-chat.spec.ts` 5/5) | **met** |
| AC-2 every §5 invariant tested; no route reaches a mutating flow method | `api.pg`, `engine.pg`, `store.pg`, `webhooks.pg`, `journey.pg` (`READ_ONLY_CALL`; the journey's flow-call log); output guard on every response | **met** |
| AC-3 StrategySpec, hash, validation, simulation and gate parity with MCP and the engine | `platform/parity.test.ts`, `engine.pg.test.ts` (REST ≡ MCP `compose_strategy`/`validate_strategy`/`simulate_strategy`) | **met** |
| AC-4 tenant isolation; no secret in logs, payloads, errors or idempotency rows | `api.pg` (identical 404s, log and table sweeps for `flofi_sk_`, `flofi_dhs_`, `whsec_`), `store.pg` (tenants), `webhooks.pg`, journey payload sweep | **met** |
| AC-5 webhooks signed, replay-protected, retried with bounded backoff, duplicate-safe, replaceable, never authority | `webhooks.pg` (endpoint pinned to 500 leaves outcomes identical, leases, jitter bounds, DEAD after 10, stable `webhook-id`, replacement), SDK `webhooks.test` (vector, tamper, stale, wrong secret, secret arrays) | **met** |
| AC-6 sandbox test-funds only; live keys and mainnet refused | `engine.pg` (`SANDBOX_TEST_FUNDS_ONLY`, `LIVE_MODE_DISABLED`), `api.pg`, capability rows mark mainnet unavailable | **met** |
| AC-7 browser journey through `/approve` on the embedded loopback runtime; MCP E2E unchanged | on `f2881e3`: `developer-journey.spec.ts` 1/1 (+2/2 repeated), `mcp-in-chat.spec.ts` 5/5, `mcp-route-presentation.spec.ts` 11/11 and 16/16 | **met** |

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

1. **`pnpm audit --audit-level low`** failed on the original stack with two inherited **high** advisories (`source-map-js` 1.2.1,
   GHSA-68fv-2mgg-jv7q; `sharp` 0.35.4, GHSA-wq5f-xc86-pv6w / CVE-2026-96889) that `main` fixes with the overrides in `78be634`.
   **Resolved by the re-stack:** on `f2881e3` the audit reports no known vulnerabilities. Relative to `main`, this branch changes
   `pnpm-lock.yaml` only by the SDK's empty importer (`packages/developer-sdk: {}`); no override was added or weakened.
2. **Re-stack done** (§3a): onto `main` at `f2881e3` (PR #65 merged BUILD-MCP-001 and BUILD-MCP-002). The MCP edits of this build
   remain delegation in `tools.ts`, the `service.ts`/`store.ts` compatibility re-exports and the 0006 generalization.
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
export NEXT_TELEMETRY_DISABLED=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1                 # required by playwright.config.ts
pnpm --filter @defi-workflow-engine/reference-dapp exec playwright test mcp-route-presentation.spec.ts
GRYLOO_MCP_E2E=EMBEDDED_LOOPBACK_ONLY pnpm --filter @defi-workflow-engine/reference-dapp exec playwright test developer-journey.spec.ts
GRYLOO_MCP_E2E=EMBEDDED_LOOPBACK_ONLY pnpm --filter @defi-workflow-engine/reference-dapp exec playwright test mcp-in-chat.spec.ts mcp-route-presentation.spec.ts
python3 -m unittest discover -s scripts -p 'test_governance_lite.py' && python3 scripts/governance_lite.py   # on a clean export
pnpm audit --audit-level low
```

Governance-Lite on a history-free export of the final working tree on `f2881e3` (this report included): passed; self-tests
19/19 (§3a). Dependency integrity: no registry package added or changed by this build; the pinned toolchain is unchanged; the SDK's
`LICENSE` is the unmodified Apache-2.0 text.
