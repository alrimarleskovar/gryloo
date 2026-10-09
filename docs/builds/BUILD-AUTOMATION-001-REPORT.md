# BUILD-AUTOMATION-001 — Report: FloFi Automations (automated evaluation, owner-confirmed execution)

Date: 2026-10-09. Branch `claude/build-automation-001-production` (worktree `~/projects/gryloo-automation-001`), from main
`8f91a010755449b333233a7d763cf44580c16ddf`. Developed and validated locally; **not pushed, no PR** (one owner push, one CI cycle).
PR #66 and BUILD-016 / Mode C were not used as a baseline: nothing was cherry-picked, merged, rebased or copied.

**Final status: `READY_FOR_OWNER_PUSH`.**

> Automations are **automated evaluation and owner-confirmed execution** (`CONFIRM_EACH_TIME`, the only mode the schema admits).
> FloFi evaluates schedules and deterministic price conditions; when one holds it records one occurrence and asks the owner, who
> continues in FloFi's existing flow: `/approve` → wallet proof → re-composed strategy (same workflow hash) → fresh simulation →
> Strategy Manifest Review → explicit approval → the owner's own wallet signature → execution → reconciliation → evidence. The scheduler,
> the price source and every notification have zero financial authority. FloFi does not trade automatically.

| Evidence level | Result |
| --- | --- |
| Implemented | **yes**: domain, migration `0010`, store, evaluator, scheduler endpoint, shared-approval integration, Telegram notifications through Channel Core, Automations workspace (EN/PT), docs |
| MOCKED / fixture / loopback tested | **yes**: unit, PostgreSQL (concurrency, crash/retry, isolation, approvals, Telegram double), browser journeys (§6) |
| Live price provider tested | **NOT DONE** (no Chainlink/RPC call was made by the build; the adapter is tested against a JSON-RPC double) |
| Real Telegram message | **NOT DONE** (Bot API double only) |
| Public-chain / real transaction | **NOT DONE**, by design: no transaction was submitted or signed |

## 1. Architecture as implemented

| Layer | Module | Role |
| --- | --- | --- |
| Domain (pure) | `src/automations/{schedule,trigger,limits,definition,assets,binding,decimal}.ts` | IANA schedules (DST `compatible` rule), missed-run policy, edge/re-arm/cooldown triggers, enforced limits, closed input schema, observation-vs-execution capability, binding by value with drift detection, exact decimals |
| Persistence | `store.ts`, `pg-store.ts`, migration `0010_automations` | rules, occurrences (unique per trigger key), history, link codes, notification targets/records; rule-row lock + compare-and-set |
| Evaluation | `evaluator.ts`, `runtime.ts`, `dispatch.ts`, `http.ts`, route `/api/automations/dispatch` (+ `/health`) | durable `automation.evaluate` / `automation.notify` work items, fenced leases, phase 1 read-only observation, phase 2 locked commit |
| Prices | `price-source.ts`, `config.ts` | `chainlink` (read-only `eth_call`, feeds verified on-chain), `fixture` (tests, never hosted), `off` |
| Approval | `approval.ts`, `service.ts`; `src/platform` requester kind `AUTOMATION_RULE` | owner opens → `requestApproval` on the shared model (`flofi_auhs_`) → attach under the rule lock with limits re-checked; owner-only claim policy in the `/approve` contributor |
| Notifications | `notify.ts`, `copy.ts`, `subscriptions.ts`; Channel Core `subscriber.ts` + the `automations <CODE>` command | in-app always; Telegram via the existing Channel Core outbox (no second bot stack) |
| UI | `components/automations-workspace.tsx`, `/app/automations`, nav entry, in-app inbox, `/approve` wording, `i18n/pt-automations.ts` | create (DCA, price trigger, daily watch), pending decisions, rules, history, Telegram linking |
| Owner API | `app/automation-action.ts` | server actions; each re-verifies the HttpOnly wallet session of the named owner |

**Reused, unchanged in behaviour:** StrategySpec / `composeWorkflowBound` / workflow hash; `requestApproval`, the handoff store,
`/approve` claim/apply, `verifyHandoff`, `sharedRuns`; `evaluateWorkflowGates` with a dedicated automation policy; `work_items`,
`createPostgresWorkQueue`, `createWorker`; wallet sessions; saved workflows (`0008`); Channel Core delivery (retries, dead letters, no
resend after an uncertain send) and the Telegram adapter; the bearer-digest scheduler convention.

## 2. State machines

- **Rule:** `ACTIVE ⇄ PAUSED → EXPIRED → ARCHIVED` (database trigger; ARCHIVED terminal; identity, kind, zone and execution mode
  immutable). Owner changes are compare-and-set on `version`. `attention` (`WORKFLOW_CHANGED`, `STRATEGY_STALE`) stops proposals.
  Resuming re-arms a price condition from the next fresh observation.
- **Occurrence:** `PENDING_OWNER → APPROVAL_CREATED → COMPLETED`; open → `DISMISSED | EXPIRED`; a watch report or alert
  `PENDING_OWNER → COMPLETED | DISMISSED`; `APPROVAL_CREATED → APPROVAL_CREATED` only to replace an ended handoff. Terminal states are
  immutable (trigger). `COMPLETED` = the handoff was applied in the owner's workflow; execution and reconciliation are shown from the
  existing run/evidence model (runs of the owner's own wallet that reviewed exactly the proposal's workflow hash), linked to the run page.

## 3. Scheduler semantics

At-least-once infrastructure, at most one logical occurrence per trigger event: the bearer-only dispatch inserts one evaluation work
item per due rule (dedupe `<rule>:<due time>`), claims only `automation.*` items, and each handler re-checks the rule under its row lock
before committing the occurrence (`ON CONFLICT DO NOTHING` on `(rule, trigger_key)`), the history, the rule's new state and the
notification item in one transaction. Trigger keys: `slot:<local date>T<HH:MM>`, `price:<arm epoch>`, `watch:<slot>`.

- **Missed runs `LATEST_WITHIN_GRACE`:** only the latest due slot, within 6 h, can propose; earlier slots are recorded once as MISSED.
- **DST:** a missing local time is shifted forward by the gap; a repeated one runs once, at its first occurrence.
- **Expiry:** DCA proposals at the next slot (≤ 24 h), price proposals after 6 h, watch reports at the next slot (≤ 24 h).
- **Clock:** application clock per evaluation; one-minute resolution with a once-a-minute scheduler. The test clock
  (`x-flofi-automation-now`) exists only with `FLOFI_AUTOMATION_TEST_CLOCK=enabled`, refused on hosted deployments.
- **Railway worker:** not a host for automation handlers in this build — `backend/main.ts` runs under Node's TypeScript stripping and
  cannot load the extensionless engine modules the evaluator needs. The worker now claims only the work kinds it has handlers for, so it
  can never dead-letter automation items when it shares a database and tenant with the web runtime. Hosting evaluation there later needs
  no schema change.

## 4. Assets, networks and limits (honest)

Observation: ETH, BTC, SOL (`chainlink` with configured Base mainnet USD feeds; `fixture` in tests). Execution: USDC ⇄ WETH on Base
Sepolia and Ethereum Sepolia; devUSDC ⇄ SOL on Solana Devnet for a Solana owner. Base mainnet swaps compose but are not owner-executable
on main (`OWNER_EXECUTION_NOT_IMPLEMENTED`); Solana mainnet is disabled by policy; **BTC has no swap route** (`BTC_EXECUTION_ROUTE_UNAVAILABLE`)
and is never substituted. A route needing another wallet namespace than the owner's is never offered (`AUTOMATION_WALLET_NAMESPACE_MISMATCH`).
Limits (all enforced): per execution, per day/week/month amount and count (local periods; counting open, taken-up and opened-then-expired
proposals), cooldown, slippage, expiry.

**Chainlink feed addresses** are configuration (`FLOFI_AUTOMATION_CHAINLINK_FEEDS`), not pins: the official directory could not be read
authoritatively during the build, so no address is committed; each configured feed is verified on-chain (chain 8453, `description()`,
`decimals()`) before any answer is used.

## 5. Security acceptance (proved by)

| # | Property | Evidence |
| --- | --- | --- |
| 1 | The scheduler cannot sign | `boundaries.test.ts`: no key custody or signing primitive anywhere in the scheduler's import closure; no wallet, state or component module reachable |
| 2 | The scheduler cannot submit | same test (no flow calls, no submission methods); `price-source.test.ts`: every non-read JSON-RPC method refused before sending |
| 3 | A price source cannot authorize spending | observations only feed `stepTrigger`; an occurrence is a proposal (`scheduler.pg.test.ts`, `approval.pg.test.ts`) |
| 4 | A notification cannot authorize spending | output guard admits only the workspace link; no `flofi_*hs_` secret in any message (`telegram.pg.test.ts`, `config.test.ts`) |
| 5 | No bypass of fresh simulation | the approval re-composes to the same hash, then FloFi's own Simulate runs (browser journey) |
| 6 | No bypass of Manifest Review | the browser journey reaches FloFi's Review; nothing is approved by the system |
| 7 | No bypass of the owner wallet | owner-only claim policy (`AUTOMATION_OWNER_MISMATCH` for wallet B; proof required) |
| 8 | Duplicate work cannot duplicate occurrences | competing evaluators, duplicate schedulers, crash before/after commit, expired lease, pause while queued (`scheduler.pg.test.ts`) |
| 9 | An edited workflow cannot silently mutate an automation | `WORKFLOW_CHANGED`, no proposal; rebind re-checks limits (500 refused against a 50 limit) |
| 10 | Wallet A ↔ Wallet B isolation | id guessing refused for every read and write (`scheduler.pg.test.ts`, `approval.pg.test.ts`) |

## 6. Validation (local)

All on 2026-10-09 against the final tree, on loopback infrastructure (disposable PostgreSQL 18.6 container, the CI-pinned Anvil 1.8.3
and headless shell 1243). No public network, price provider, chat or chain was contacted except the CI-equivalent dependency audit and
BUILD-007 pinned downloads, and the one real LI.FI read that CI's `default-product` profile itself makes.

| Gate | Result |
| --- | --- |
| `pnpm check` (typecheck, lint, build, schema drift, unit tests) | **PASS** — 290 test files passed, 2 skipped; 2,985 tests passed, 2 skipped |
| `pnpm test:postgres` | **PASS** — 41 files, 276 tests (all PostgreSQL suites, including 6 new automation files) |
| Governance-lite self-tests (`python3 -m unittest discover -s scripts -p 'test_governance_lite.py'`) | **PASS** — 19 tests |
| `python3 scripts/governance_lite.py` | **PASS** (working tree and a clean history-free export of the final commit) |
| `git diff --check` | **PASS** |
| `node scripts/guarded-release-browser.mjs product` | **PASS** — 20 profiles (now including `automations`: 2 passed); `default-product` 60, review/execute/recovery 31, workflow acceptance 5, swap-read 2, copilot 13, provenance and loopback profiles all passed |
| `playwright test automations.spec.ts --repeat-each=3` | **PASS** — 6/6 |
| CI's extra browser suites: `mcp-route-presentation` (11), `developer-journey` (1), `mcp-in-chat` + `mcp-route-presentation` (21), `whatsapp-approve` + `telegram-approve` (2) | **PASS** |
| `pnpm test:anvil`, `pnpm test:fork`, F1 offline rehearsal | **PASS** — 4 passed / 10 skipped; 31 passed / 29 skipped; five-pass `PASS` |
| BUILD-007 composition phase (pinned downloads, composition fork suites, `guarded-release-browser.mjs composition`) | **PASS** — 3/3 fork tests, 1 profile |
| `bootstrap-ci.py --verify-dependencies`, `pnpm audit --audit-level low`, CycloneDX SBOM validation | **PASS** — no dependency or lockfile change; no known vulnerabilities; 265 components |

**Skipped, and why (all pre-existing, unchanged by this build):** the 2 unit skips are `composition-service.test.ts` and
`mode-b-service.test.ts`, which need BUILD-007 pinned inputs (CI provides them only to its composition phase, which passed above); the
Anvil/fork skips are the owner-only pinned-account cases (DEC-0026/DEC-0027). Specs outside CI that are stale on main were not run as
gates (e.g. `navigation-drawer.spec.ts`, which already omits "Your workflows" on main).

**Changed existing tests (explained):** `channels/core/migration.pg.test.ts` now bounds its 0009 checks to the first nine migrations
(0010 has its own suite, as main's 0008 test did for 0009); `cloud-runtime/test/storage.pg.test.ts` sorted migration versions
lexicographically, which breaks at ten migrations — now numeric; `platform/handoff-store.pg.test.ts` gains the `AUTOMATION_RULE` link
scheme in its per-kind table; `navigation-drawer.test.tsx` lists the new Automations entry. No test was deleted, skipped or weakened.

**Defects the suites caught during the build (fixed):** saved-workflow comparison was key-order-sensitive after the JSONB round trip;
a `BigInt()` bound on a non-integer in the Chainlink adapter; the outbox sealed away the (non-secret) notification link; the shell's
per-render owner object reset the workspace; a channel-variable-like error code in browser code (caught by the Channels boundary test).

## 7. Files

79 files changed against `8f91a01` (≈ 5,500 insertions, 45 deletions; no dependency change).

- **New — automations:** `apps/reference-dapp/src/automations/` (`schedule`, `trigger`, `limits`, `definition`, `assets`, `binding`,
  `decimal`, `labels`, `store`, `pg-store`, `price-source`, `config`, `evaluator`, `runtime`, `dispatch`, `http`, `approval`,
  `link-format`, `service`, `subscriptions`, `notify`, `copy`, `log`, `views`), its tests (`schedule`, `trigger`, `domain`,
  `price-source`, `config`, `boundaries`, and PostgreSQL `scheduler`, `approval`, `telegram`, `migration`) and test harness.
- **New — routes and UI:** `src/app/api/automations/{dispatch,health}/route.ts`, `src/app/app/automations/page.tsx`,
  `src/app/automation-action.ts`, `src/components/automations-workspace.tsx`, `src/i18n/pt-automations.ts`.
- **New — persistence:** `packages/cloud-runtime/migrations/0010_automations.sql`; pinned in `src/migrations.ts`.
- **New — Channel Core:** `src/channels/core/subscriber.ts`, `src/channels/subscriptions.ts` (wiring).
- **New — browser:** `e2e/automations.spec.ts`, `e2e/automation-fixtures.ts`; harness block in `playwright.config.ts`; profile in
  `scripts/guarded-release-browser.mjs`.
- **Modified — shared platform:** `platform/handoff-store.ts` and `platform/approvals.ts` (requester kind `AUTOMATION_RULE`),
  `server/approval-surface.ts` (contributor), `cloud-runtime/src/work-queue.ts` (optional kind-scoped claim), `backend/main.ts`
  (the worker claims only its own kinds).
- **Modified — Channel Core:** `conversation.ts` (`automations <CODE>`), `service.ts` (subscription hook; STOP unlinks), `copy.ts`,
  `delivery.ts` (workspace-link guard; a non-secret workspace link may stay sealed), `pg-store.ts` (retention honours a live link),
  `http.ts` / `dispatch-http.ts` (hook wiring).
- **Modified — UI:** `app-shell.tsx` (workspace props, in-app notice), `approval-handoff.tsx` (automation wording, no sharing toggle for
  the owner's own automation), `secondary-product-workspace.tsx`, `navigation-drawer.tsx`, `domain/secondary-workspaces.ts`,
  `globals.css`, `i18n/pt.ts`, `i18n/preserved-values.ts`.
- **Docs:** this report, the [plan](BUILD-AUTOMATION-001-PLAN.md), [AUTOMATIONS.md](../deploy/AUTOMATIONS.md),
  [ENVIRONMENT.md §5f](../deploy/ENVIRONMENT.md), `STATUS.md`, `SECURITY_MODEL.md`.

## 8. Known limitations

- No live price provider, real Telegram message or public transaction was exercised; the owner's deployment needs real feed addresses
  and a keyed Base RPC for price rules.
- The Railway worker does not host automation evaluation (§3); the scheduler endpoint does, so a per-minute scheduler is required.
- Execution routes are the existing testnet swaps; BTC and Base-mainnet purchases are refused honestly.
- Daily-watch Buy/Sell prepare the owner's own Build proposal (not an automation proposal), so they are not limit-checked: the owner
  types the amount and applies, simulates, reviews and signs it.
- Price triggers compare against an observation at the check time (cadence ≥ 5 minutes); intra-interval wicks are not seen.
- Telegram links last 90 days and keep the chat's sealed send address that long (Channel Core retention honours the link); the
  owner can end it anytime (STOP / Unlink).
- Stale specs outside CI (e.g. `navigation-drawer.spec.ts`, already stale on main) were left untouched.
- The Automations workspace has no screenshot baseline; existing baselines are unchanged (the in-app notice renders only for a proven
  owner with pending proposals).

## 9. Deployment

Migration `0010_automations` (additive; adds `AUTOMATION_RULE` to the handoff requester kinds and `channel_conversations.retain_until`).
Variables: [ENVIRONMENT.md §5f](../deploy/ENVIRONMENT.md); setup and scheduler: [AUTOMATIONS.md](../deploy/AUTOMATIONS.md).
