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
| Implemented | **yes**: domain, migration `0010`, store, evaluator, evaluation in the existing Railway worker, the workspace and automation approval links on the existing Railway API (remote production runtime), optional scheduler endpoint, shared-approval integration, Telegram notifications through Channel Core, Automations workspace (EN/PT), docs |
| MOCKED / fixture / loopback tested | **yes**: unit, PostgreSQL (concurrency, crash/retry, isolation, approvals, Telegram double), browser journeys (§6) |
| Live price provider tested | **NOT DONE** (no Chainlink/RPC call was made by the build; the adapter is tested against a JSON-RPC double) |
| Real Telegram message | **NOT DONE** (Bot API double only) |
| Public-chain / real transaction | **NOT DONE**, by design: no transaction was submitted or signed |

## 1. Architecture as implemented

| Layer | Module | Role |
| --- | --- | --- |
| Domain (pure) | `src/automations/{schedule,trigger,limits,definition,assets,binding,decimal}.ts` | IANA schedules (DST `compatible` rule), missed-run policy, edge/re-arm/cooldown triggers, enforced limits, closed input schema, observation-vs-execution capability, binding by value with drift detection, exact decimals |
| Persistence | `store.ts`, `pg-store.ts`, migration `0010_automations` | rules, occurrences (unique per trigger key), history, link codes, notification targets/records; rule-row lock + compare-and-set |
| Evaluation | `evaluator.ts`, `runtime.ts`, `dispatch.ts`, `http.ts`, route `/api/automations/dispatch` (+ `/health`); `worker.ts`, `backend/automation-worker.ts`, `backend/source-resolution.ts` (Railway worker) | durable `automation.evaluate` / `automation.notify` work items, fenced leases, phase 1 read-only observation, phase 2 locked commit; the same handlers in the dispatch and in the worker |
| Prices | `price-source.ts`, `config.ts` | `chainlink` (read-only `eth_call`, feeds verified on-chain), `fixture` (tests, never hosted), `off` |
| Approval | `approval.ts`, `service.ts`; `src/platform` requester kind `AUTOMATION_RULE` | owner opens → `requestApproval` on the shared model (`flofi_auhs_`) → attach under the rule lock with limits re-checked; owner-only claim policy in the `/approve` contributor |
| Notifications | `notify.ts`, `copy.ts`, `subscriptions.ts`; Channel Core `subscriber.ts` + the `automations <CODE>` command | in-app always; Telegram via the existing Channel Core outbox (no second bot stack) |
| UI | `components/automations-workspace.tsx`, `/app/automations`, nav entry, in-app inbox, `/approve` wording, `i18n/pt-automations.ts` | create (DCA, price trigger, daily watch), pending decisions, rules, history, Telegram linking |
| Owner API | `app/automation-action.ts`, `server/automation-operation.ts`, `operations.ts` | server actions; each re-verifies the HttpOnly wallet session of the named owner, then runs the closed operation in process (embedded) or forwards it to the API (remote) |
| Remote runtime | `api.ts`, `api-headers.ts`, `backend/automation-api.ts`; `/approve` forwarding in `app/approve-action.ts` | Railway API routes `POST /v1/automations/:method` (owner header, saved-workflow convention) and `POST /v1/approvals/:method` (automation links on the shared approval model) |

**Reused, unchanged in behaviour:** StrategySpec / `composeWorkflowBound` / workflow hash; `requestApproval`, the handoff store,
`/approve` claim/apply, `verifyHandoff`, `sharedRuns`; `evaluateWorkflowGates` with a dedicated automation policy; `work_items`,
`createPostgresWorkQueue`, `createWorker` (and the Railway worker itself, opt-in); wallet sessions; saved workflows (`0008`); Channel Core delivery (retries, dead letters, no
resend after an uncertain send) and the Telegram adapter; the bearer-digest scheduler convention.

## 2. State machines

- **Rule:** `ACTIVE ⇄ PAUSED → EXPIRED → ARCHIVED` (database trigger; ARCHIVED terminal; identity, kind, zone, execution mode,
  definition — schedule, condition, limits — and expiry immutable; the bound action changes only with a version increase, i.e. a
  rebind). Owner changes are compare-and-set on `version`. `attention` (`WORKFLOW_CHANGED`, `STRATEGY_STALE`) stops proposals.
  Resuming re-arms a price condition from the next fresh observation.
- **Occurrence:** `PENDING_OWNER → APPROVAL_CREATED → COMPLETED`; open → `DISMISSED | EXPIRED`; a watch report or alert
  `PENDING_OWNER → COMPLETED | DISMISSED`; `APPROVAL_CREATED → APPROVAL_CREATED` only to replace an ended handoff. Terminal states are
  immutable (trigger). Reopening or dismissing withdraws the current handoff first; an already-applied one completes the occurrence
  instead (`AUTOMATION_OCCURRENCE_COMPLETED`), so one occurrence yields at most one applied proposal. `COMPLETED` = the handoff was applied in the owner's workflow; execution and reconciliation are shown from the
  existing run/evidence model (runs of the owner's own wallet that reviewed exactly the proposal's workflow hash), linked to the run page.

## 3. Scheduler semantics

At-least-once infrastructure, at most one logical occurrence per trigger event: the bearer-only dispatch inserts one evaluation work
item per due rule (dedupe `<rule>:<due time>`), claims only `automation.*` items, and each handler re-checks the rule under its row lock
before committing the occurrence (`ON CONFLICT DO NOTHING` on `(rule, trigger_key)`), the history, the rule's new state and — only for
an owner with a live linked chat — the notification item in one transaction. Trigger keys: `slot:<local date>T<HH:MM>`, `price:<arm epoch>`, `watch:<slot>`.

- **Missed runs `LATEST_WITHIN_GRACE`:** only the latest due slot, within 6 h, can propose; earlier slots are recorded once as MISSED.
- **DST:** a missing local time is shifted forward by the gap; a repeated one runs once, at its first occurrence.
- **Expiry:** DCA proposals at the next slot (≤ 24 h), price proposals after 6 h, watch reports at the next slot (≤ 24 h).
- **Clock:** application clock per evaluation; one-minute resolution with a once-a-minute scheduler. The test clock
  (`x-flofi-automation-now`) exists only with `FLOFI_AUTOMATION_TEST_CLOCK=enabled`, refused on hosted deployments.
- **Railway worker (final review): it now hosts evaluation, opt-in.** With `FLOFI_AUTOMATIONS=enabled` on the worker, `main.ts worker`
  merges the automation handlers into its own (`automation.evaluate`; `automation.notify` only when the Channels Telegram configuration
  is on that process), keeps the kind-scoped claim, and adds `sweepAutomations` to its 60 s sweep — discovery, expiry, approval sync and
  retention. Same work items, dedupe keys, leases and handlers as the dispatch; both may run at once (`worker.pg.test.ts` races them).
  Unset, the worker is byte-for-byte the previous behaviour (nothing automation-related is even imported). A misconfiguration or a load
  failure logs `automation.worker_disabled` with a closed code and leaves reconciliation running.

### 3a. Why the worker could not load the modules, and what changed

The cause was **module resolution only** — not the architecture, not a cycle, not the frontend/server boundary. `backend/main.ts` runs
on Node 24's native TypeScript stripping with no bundler, and Node resolves only exact specifiers; the shared `src/engine`,
`src/domain`, `src/platform`, `src/mcp` and `src/channels` modules are written for `moduleResolution: "Bundler"` (Next.js, Vitest and
`tsc` resolve `'../domain/commands'` to `commands.ts`), so the first extensionless import failed with `ERR_MODULE_NOT_FOUND`. The
closure has no JSX, no non-erasable TypeScript and no cycle Node cannot load; every package it imports is a production dependency
already built in the Docker image (`reference-dapp^...`), and the image copies the full source.

Rewriting ~100 import specifiers across ~60 shared files would have been a broad cosmetic diff across the engine. Instead,
`backend/source-resolution.ts` registers one synchronous `node:module` resolve hook that reproduces exactly the bundler rule and nothing
else: only after Node itself fails with `ERR_MODULE_NOT_FOUND`, only for a relative, extension-less specifier, only from a parent inside
`apps/reference-dapp/src/`, and only to `<specifier>.ts` that exists inside `src/`. Packages, explicit extensions, absolute or escaping
paths, directories and `.tsx` are untouched. It is installed only by `backend/automation-worker.ts`, which `main.ts` imports only when
the worker enables automations. The worker builds the **work runtime** only (`automationWorkRuntime`): store, handoff store (read and
approval sync), price source, notifier — no automation keys (it cannot mint an approval or a link code), no engine runtime (it cannot
run a flow), no owner service, and no `FLOFI_AUTOMATION_SECRET` (`readAutomationWorkerConfig`). The worker's flow services keep their
observe-only transports (`WORKER_SUBMISSION_FORBIDDEN` unchanged). `automation-worker.test.ts` proves, in a plain Node child process,
that the module fails without the rule, loads with it, and computes the **same workflow hash** as the bundled code (no second engine).

### 3b. Scheduler topology (final)

| Deployment | Heartbeat | Notes |
| --- | --- | --- |
| **Standard production**: Vercel BFF → Railway API → Neon + Railway worker (§11) | the worker's 60 s sweep | automations work end to end on the existing remote topology: the API serves the workspace and automation approval links, the worker evaluates; no cron, no Vercel Pro, no external scheduler, no new service |
| Embedded web runtime + the Railway worker on the same `DATABASE_URL` and `TENANT_ID` | the worker's 60 s sweep | the web deployment holds the automation configuration instead of the API |
| Embedded web runtime without a worker (every Preview) | optional: an external scheduler calling the bearer dispatch each minute | no worker serves a Preview tenant and Vercel Cron never runs for Previews |

`/api/automations/dispatch` is an optional alternative trigger (Previews, no worker, recovery, a manual pass), never the production
scheduler. Worker and dispatch may coexist (one occurrence per trigger event). With none, nothing is evaluated or proposed (fail closed).
Deployment architecture was not changed.

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
| 1 | The scheduler cannot sign | `boundaries.test.ts`: no key custody or signing primitive anywhere in the import closure of the dispatch, **the worker entry** (`backend/automation-worker.ts`, `worker.ts`) **or the API routes and BFF boundary** (`backend/automation-api.ts`, `api.ts`, `operations.ts`, `server/automation-operation.ts`); no wallet, state or component module reachable |
| 2 | The scheduler cannot submit | same tests (no flow calls, no submission methods; the worker entry builds no engine runtime, no automation keys, no owner service); `remote.pg.test.ts` records every flow call the API's automation routes make over a full journey: only the read-only `mode`/`info` gates; `price-source.test.ts`: every non-read JSON-RPC method refused before sending; `WORKER_SUBMISSION_FORBIDDEN` unchanged |
| 3 | A price source cannot authorize spending | observations only feed `stepTrigger`; an occurrence is a proposal (`scheduler.pg.test.ts`, `approval.pg.test.ts`) |
| 4 | A notification cannot authorize spending | output guard admits only the workspace link; no `flofi_*hs_` secret in any message (`telegram.pg.test.ts`, `config.test.ts`) |
| 5 | No bypass of fresh simulation | the approval re-composes to the same hash, then FloFi's own Simulate runs (browser journey) |
| 6 | No bypass of Manifest Review | the browser journey reaches FloFi's Review; nothing is approved by the system |
| 7 | No bypass of the owner wallet | owner-only claim policy (`AUTOMATION_OWNER_MISMATCH` for wallet B; proof required) — embedded and through the API (`remote.pg.test.ts`) |
| 8 | Duplicate work cannot duplicate occurrences | competing evaluators, duplicate schedulers, crash before/after commit, expired lease, pause while queued (`scheduler.pg.test.ts`); the Railway worker racing the dispatch (`worker.pg.test.ts`); one applied proposal per occurrence (`approval.pg.test.ts`) |
| 9 | An edited workflow cannot silently mutate an automation | `WORKFLOW_CHANGED`, no proposal; rebind re-checks limits (500 refused against a 50 limit) |
| 10 | Wallet A ↔ Wallet B isolation | id guessing refused for every read and write (`scheduler.pg.test.ts`, `approval.pg.test.ts`); across the remote boundary B cannot find, change, open, dismiss or claim A's automation, and the API refuses any call without a well-formed owner on its own (`remote.pg.test.ts`) |

## 6. Validation (local)

All on 2026-10-09 against the final tree of the final review, on loopback infrastructure (disposable PostgreSQL 18.6 container, the
CI-pinned Anvil 1.8.3 and headless shell 1243). The self-hosted CI runner on the same machine was running another branch's job and
holds the default e2e ports, so browser and fork gates ran in a private network namespace (own loopback, PostgreSQL relayed through a
Unix socket, no outbound network) — except `default-product`, whose `build009.spec.ts` makes the one real LI.FI read CI itself makes;
it ran on the host with network on configurable non-default ports (`FLOFI_E2E_APP_PORT=3290`, `FLOFI_E2E_FORK_PORT=18545`). No price
provider, chat or chain was contacted; the dependency audit and BUILD-007 pinned inputs are the CI-equivalent network uses.

| Gate | Result |
| --- | --- |
| `pnpm check` (typecheck, lint, build, schema drift, unit tests) | **PASS** — 291 test files passed, 2 skipped; 2,990 tests passed, 2 skipped (new: `backend/automation-worker.test.ts`) |
| `pnpm test:postgres` | **PASS** — 42 files, 285 tests (7 automation files, including the new `worker.pg.test.ts`) |
| Governance-lite self-tests (`python3 -m unittest discover -s scripts -p 'test_governance_lite.py'`) | **PASS** — 19 tests |
| `python3 scripts/governance_lite.py` | **PASS** (working tree and a clean history-free export of the final commit) |
| `git diff --check` | **PASS** |
| `node scripts/guarded-release-browser.mjs product` — 20 profiles | **PASS** — `default-product` 60/60 (host, see above); the other 19 profiles (`automations` 2, review/execute/recovery 31, workflow acceptance 5, swap-read 2, copilot 13, provenance and loopback profiles) all passed in the namespace. Not hidden: in the namespace `default-product` failed only its 2 `build009` tests (no DNS for `li.quest`), and a first host run flaked once in `canvas-ux.spec.ts` while the CI job loaded the machine; that spec then passed 36/36 (`--repeat-each=3`) and the whole profile 60/60 |
| `playwright test automations.spec.ts --repeat-each=3` | **PASS** — 6/6 |
| CI's extra browser suites: `mcp-route-presentation` (11), `developer-journey` (1), `mcp-in-chat` + `mcp-route-presentation` (21), `whatsapp-approve` + `telegram-approve` (2) | **PASS** |
| `pnpm test:anvil`, `pnpm test:fork`, F1 offline rehearsal | **PASS** — 4 passed / 10 skipped; 31 passed / 29 skipped; five-pass `PASS` |
| BUILD-007 composition phase (pinned inputs, composition fork suites, `guarded-release-browser.mjs composition`) | **PASS** — 3/3 fork tests, 1 profile |
| `bootstrap-ci.py --verify-dependencies`, `pnpm audit --audit-level low`, CycloneDX SBOM validation | **PASS** — no dependency or lockfile change; no known vulnerabilities; 265 components |

**Skipped, and why (all pre-existing, unchanged by this build):** the 2 unit skips are `composition-service.test.ts` and
`mode-b-service.test.ts`, which need BUILD-007 pinned inputs (CI provides them only to its composition phase, which passed above); the
Anvil/fork skips are the owner-only pinned-account cases (DEC-0026/DEC-0027). Specs outside CI that are stale on main were not run as
gates (e.g. `navigation-drawer.spec.ts`, which already omits "Your workflows" on main).

**Changed existing tests in the final review (explained):** `scheduler.pg.test.ts` — the "one notification item" assertion now
links a chat first (items are queued only for owners with a live chat) and the duplicate-dispatch count expects the one evaluation;
`migration.pg.test.ts` gains the immutability assertions; `boundaries.test.ts` gains the worker entry. Nothing was deleted or skipped.

**Changed existing tests (explained):** `channels/core/migration.pg.test.ts` now bounds its 0009 checks to the first nine migrations
(0010 has its own suite, as main's 0008 test did for 0009); `cloud-runtime/test/storage.pg.test.ts` sorted migration versions
lexicographically, which breaks at ten migrations — now numeric; `platform/handoff-store.pg.test.ts` gains the `AUTOMATION_RULE` link
scheme in its per-kind table; `navigation-drawer.test.tsx` lists the new Automations entry. No test was deleted, skipped or weakened.

**Defects the suites caught during the build (fixed):** saved-workflow comparison was key-order-sensitive after the JSONB round trip;
a `BigInt()` bound on a non-integer in the Chainlink adapter; the outbox sealed away the (non-secret) notification link; the shell's
per-render owner object reset the workspace; a channel-variable-like error code in browser code (caught by the Channels boundary test).

## 7. Files

85 files changed against `8f91a01` (≈ 6,100 insertions, 47 deletions; no dependency change).

- **New — automations:** `apps/reference-dapp/src/automations/` (`schedule`, `trigger`, `limits`, `definition`, `assets`, `binding`,
  `decimal`, `labels`, `store`, `pg-store`, `price-source`, `config`, `evaluator`, `runtime`, `dispatch`, `http`, `approval`,
  `link-format`, `service`, `subscriptions`, `notify`, `copy`, `log`, `views`), its tests (`schedule`, `trigger`, `domain`,
  `price-source`, `config`, `boundaries`, and PostgreSQL `scheduler`, `approval`, `telegram`, `migration`) and test harness.
- **New — Railway worker hosting (final review):** `src/automations/worker.ts`, `backend/automation-worker.ts`,
  `backend/source-resolution.ts`; tests `backend/automation-worker.test.ts`, `src/automations/worker.pg.test.ts`.
- **New — remote production runtime (§11):** `src/automations/{operations,api,api-headers}.ts`, `backend/automation-api.ts`,
  `src/server/automation-operation.ts`; tests `src/automations/remote.pg.test.ts`, `backend/automation-production.pg.test.ts`,
  `src/server/automation-operation.test.ts`. Modified: `backend/main.ts` (API loads the routes when enabled), `app/automation-action.ts`,
  `app/approve-action.ts` (automation links forwarded on the remote runtime), `server/flow-runtime.ts` (`ownerRunReaders` shared with the
  API), `automations/{http,runtime,dispatch}.ts` (comments).
- **New — routes and UI:** `src/app/api/automations/{dispatch,health}/route.ts`, `src/app/app/automations/page.tsx`,
  `src/app/automation-action.ts`, `src/components/automations-workspace.tsx`, `src/i18n/pt-automations.ts`.
- **New — persistence:** `packages/cloud-runtime/migrations/0010_automations.sql`; pinned in `src/migrations.ts`.
- **New — Channel Core:** `src/channels/core/subscriber.ts`, `src/channels/subscriptions.ts` (wiring).
- **New — browser:** `e2e/automations.spec.ts`, `e2e/automation-fixtures.ts`; harness block in `playwright.config.ts`; profile in
  `scripts/guarded-release-browser.mjs`.
- **Modified — shared platform:** `platform/handoff-store.ts` and `platform/approvals.ts` (requester kind `AUTOMATION_RULE`),
  `server/approval-surface.ts` (contributor), `cloud-runtime/src/work-queue.ts` (optional kind-scoped claim), `backend/main.ts`
  (the worker claims only its own kinds; with `FLOFI_AUTOMATIONS=enabled` it also hosts automation evaluation).
- **Modified — Channel Core:** `conversation.ts` (`automations <CODE>`), `service.ts` (subscription hook; STOP unlinks), `copy.ts`,
  `delivery.ts` (workspace-link guard; a non-secret workspace link may stay sealed), `pg-store.ts` (retention honours a live link),
  `http.ts` / `dispatch-http.ts` (hook wiring).
- **Modified — UI:** `app-shell.tsx` (workspace props, in-app notice), `approval-handoff.tsx` (automation wording, no sharing toggle for
  the owner's own automation), `secondary-product-workspace.tsx`, `navigation-drawer.tsx`, `domain/secondary-workspaces.ts`,
  `globals.css`, `i18n/pt.ts`, `i18n/preserved-values.ts`.
- **Docs:** this report, the [plan](BUILD-AUTOMATION-001-PLAN.md), [AUTOMATIONS.md](../deploy/AUTOMATIONS.md),
  [ENVIRONMENT.md §5f](../deploy/ENVIRONMENT.md), `CLOUD.md` (worker variable), `STATUS.md`, `SECURITY_MODEL.md`.

## 8. Known limitations

- No live price provider, real Telegram message or public transaction was exercised; the owner's deployment needs real feed addresses
  and a keyed Base RPC for price rules.
- The production topology was exercised with the real entry points (`node backend/main.ts api` and `… worker`, plain Node) on a loopback
  PostgreSQL and the BFF in remote mode (§11); the Docker image itself was not rebuilt locally, and no browser journey ran against a
  remote-mode Next.js server (the browser journeys cover the embedded runtime; the remote path is covered at the BFF/API level).
- Telegram for automations needs Channel Core, which runs only on the embedded runtime (Channels §5e): in standard production owners
  are notified in the app only (the API reports Telegram unavailable; no chat can be linked; no notification item is queued).
- Execution routes are the existing testnet swaps; BTC and Base-mainnet purchases are refused honestly.
- Daily-watch Buy/Sell is the owner's own new trade, not automation execution: a watch has no action and no limits; Buy/Sell puts
  FloFi's ordinary authoring proposal in the owner's Build draft (as if composed there), creates no automation approval and is not
  limit-checked — the UI, operator guide and history label say so. Likewise, once an automation proposal is in the owner's workflow,
  any edit the owner makes is their own workflow: limits bound what FloFi proposes, not what the owner later signs.
- Price triggers compare against an observation at the check time (cadence ≥ 5 minutes); intra-interval wicks are not seen.
- Telegram links last 90 days and keep the chat's sealed send address that long (Channel Core retention honours the link); the
  owner can end it anytime (STOP / Unlink).
- Stale specs outside CI (e.g. `navigation-drawer.spec.ts`, already stale on main) were left untouched.
- The Automations workspace has no screenshot baseline; existing baselines are unchanged (the in-app notice renders only for a proven
  owner with pending proposals).

## 9. Deployment

Migration `0010_automations` (additive; adds `AUTOMATION_RULE` to the handoff requester kinds and `channel_conversations.retain_until`).
Variables: [ENVIRONMENT.md §5f](../deploy/ENVIRONMENT.md); setup and scheduler: [AUTOMATIONS.md](../deploy/AUTOMATIONS.md).

## 10. Final architecture and adversarial review (2026-10-09)

**Worker architecture: changed** (§3, §3a). The Railway worker can now host automation evaluation, opt-in, without a second engine,
a new service, a new secret on the worker or any widening of financial authority. Reason it could not before: plain-Node ESM
resolution versus the bundler-style extensionless imports of the shared modules — fixed by one scoped resolution rule loaded only in
that case. **Scheduler topology** (§3b): the worker's sweep; an optional external scheduler for Previews. (Superseded for production
by §11: the remote production topology now serves automations end to end.) No deployment architecture was changed.

**Defects found and fixed** (the tests for #1, #2 were run against the previous `service.ts` and fail there; #4 and #5 fail against
the previous trigger / enqueue by construction; #3's tests pin the new ordering — the race window itself is not deterministic):

| # | Defect | Fix | Regression test |
| --- | --- | --- | --- |
| 1 | Reopening an occurrence whose approval the owner had **already applied** (before the next sweep synced it) minted a second approval; the owner could add the same occurrence to a workflow twice, while the limits counted it once | `open()` withdraws the current handoff **first** (transactional revoke); an applied one completes the occurrence and refuses `AUTOMATION_OCCURRENCE_COMPLETED` | `approval.pg.test.ts` "one occurrence yields at most one applied proposal" |
| 2 | Dismissing an occurrence whose approval was already applied marked it `DISMISSED`, so it stopped counting against the period limits | `dismiss()` withdraws first (applied → completed, refused); `decide` is a compare-and-set on the handoff it saw (`AUTOMATION_OCCURRENCE_CHANGED`) | "dismissing a proposal already added to the workflow completes it instead"; "a review opened while the owner dismisses never leaves a live approval on a dismissed occurrence" (concurrent) |
| 3 | Reopening revoked the previous approval only **after** the new one was attached, and ignored a failed revoke (`.catch(() => null)`): a claimed review could stay usable next to the new one | withdraw first, fail closed (no swallowed error) | "reopening a claimed review withdraws it before the new one exists" |
| 4 | Migration 0010 did not enforce what its comment and the state machine claim: a rule's `definition` (schedule, condition, **limits**) and `expires_at` could be changed in place, and the bound action without a version increase | the rule trigger now refuses both (`AUTOMATION_RULE_IMMUTABLE`, `AUTOMATION_RULE_VERSION_INVALID`); 0010 re-pinned (unshipped) | `migration.pg.test.ts` invariants |
| 5 | Every occurrence queued an `automation.notify` item even for owners without a linked chat — items that, with the worker as heartbeat and no Telegram on it, nobody would ever claim | the item is queued only for an owner with a live, ACTIVE linked chat | `scheduler.pg.test.ts` "queues no chat notification for an owner without a live linked chat" |
| 6 | Watch Buy/Sell wording ("prepares an ordinary FloFi proposal") could read as automation execution | UI, PT catalog, history labels and docs now state it is the owner's own new trade, not part of the automation, with no automation authority or limits (§8) | — (copy; no behaviour change) |

**Reviewed and found sound (no change):** scheduler/API reach to submission (boundary tests, both entries); occurrence duplication
(unique key + row lock, now also worker vs dispatch); stale prices (max age by the feed's own `updatedAt`); repeated firing (edge
trigger, re-arm on clear); percentage reference (fixed by the owner at creation, now immutable in the database; the price source
cannot move it); pause/update races (re-check under the rule lock; claim policy requires ACTIVE); saved-workflow edits
(`WORKFLOW_CHANGED`); owner isolation (session-verified owner on every action; tenant/namespace/account scoping); Telegram secrets
(output guard; the worker never needs `FLOFI_AUTOMATION_SECRET`; the hosted worker refuses the fixture price source); missed-run
catch-up and DST (unchanged, tested); provider outage (failed observations change nothing); limits shown and enforced; endpoints
(`/api/automations/*` bearer-only; every server action re-verifies the wallet session).

**Evidence maturity unchanged:** no live price provider call, no real Telegram message, no transaction, BTC watch-only, no delegated
execution, `CONFIRM_EACH_TIME` only.

## 11. Production integration on the remote runtime (2026-10-09)

**Current remote production now supports Automations**, on FloFi's existing topology and without changing it:

```
Vercel BFF
  → Railway API
  → Neon/PostgreSQL

Railway Worker
  → 60-second automation sweep
  → deterministic evaluation
  → occurrence
  → shared approval
  → fresh simulation
  → Strategy Manifest Review
  → owner wallet signature
```

(The worker's part ends at the occurrence; the shared approval is minted by the API when the owner opens the proposal, and fresh
simulation, Strategy Manifest Review and the signature happen in FloFi's existing owner flow in the browser.)

```
browser ──(server actions, same origin)──▶ Vercel BFF ──(API bearer + x-flofi-workflow-owner)──▶ Railway API ──▶ Neon PostgreSQL
                                                                                                    ▲
                                                Railway worker ── 60 s sweep → automation.evaluate ─┘
```

- Standard production requires **no Vercel Cron**, **no Vercel Pro** and **no external scheduler**.
- `/api/automations/dispatch` is optional / recovery / Preview infrastructure only.
- Telegram is unavailable in the standard remote topology unless Channel Core becomes available there; in-app occurrences remain
  fully functional without it.
- No signing or submission authority was added to the API or the worker.

- **Automation CRUD path:** `app/automation-action.ts` → `server/automation-operation.ts` verifies that the browser PROVED the named
  wallet (HttpOnly EIP-4361 / SIWS cookies) → on the remote runtime, `POST {API_BASE_URL}/v1/automations/:method` with the API bearer and
  the verified owner in `x-flofi-workflow-owner` (exactly the saved-workflow convention; `create` carries an idempotency key) → the API
  (`src/automations/api.ts`) requires a well-formed owner header itself (401 otherwise), runs the closed operation list of
  `operations.ts` against the same service the embedded runtime uses, every query scoped to that owner → JSON views identical to the
  embedded ones. Methods: overview, create, setState (pause/resume/archive), rebind, history, open, dismiss, prepareWatch,
  telegramLinkCode, telegramUnlink, plus `availability` (names nobody).
- **Approval path:** "Review in FloFi" → `open` on the API mints a no-authority `flofi_auhs_` link on the shared approval model →
  `/approve` → `app/approve-action.ts` forwards **automation links only** (other kinds are unchanged) to `POST /v1/approvals/:method`
  (view / claim / apply / share) with the proven wallets in `x-flofi-wallet-principals` → the same platform functions, the automation
  contributor and the shared handoff store, on the API → the owner's own Simulate, Strategy Manifest Review and signature in FloFi →
  the worker's sweep marks the occurrence COMPLETED.
- **Scheduler path:** the Railway worker's 60 s sweep (`sweepAutomations`) discovers due rules and its claim loop runs
  `automation.evaluate` → one occurrence per trigger event. **No cron, Vercel Cron, Vercel Pro or external scheduler is required for
  standard production.** `/api/automations/dispatch` remains an optional trigger on an embedded web runtime (Previews, no worker,
  recovery, a manual pass); it and the worker may race and still produce exactly one occurrence.
- **Telegram:** delivered only through the existing Channel Core, which needs the embedded runtime; in standard production the API
  reports Telegram unavailable, no chat can be linked and no notification item is queued — owners are notified in the app. The occurrence
  is always created first and never depends on a delivery. No Telegram infrastructure was duplicated.
- **Variables:** API — `FLOFI_AUTOMATIONS`, `FLOFI_AUTOMATION_SECRET`, `FLOFI_PUBLIC_ORIGIN` (the Vercel origin), the price variables;
  worker — `FLOFI_AUTOMATIONS`, `FLOFI_PUBLIC_ORIGIN`, the price variables; Vercel — nothing new.
- **Authority:** the API does CRUD/state and mints no-authority approval links only where the shared model already permits it; the
  worker only evaluates; neither signs, submits, runs or previews a flow, or bypasses fresh simulation, Manifest Review or the owner's
  wallet. `WORKER_SUBMISSION_FORBIDDEN` is unchanged. Both load the shared modules through the scoped resolution rule only when
  `FLOFI_AUTOMATIONS=enabled` is set on them; a load failure leaves every other route and the reconciliation running.

**Tests added for this integration:**

| Test | Proves |
| --- | --- |
| `src/automations/remote.pg.test.ts` (5) | the REAL API HTTP server (existing + automation routes, bearer) driven by the REAL BFF functions in remote mode: create / pause / resume / overview / history with views equal to the embedded ones and only the bearer, owner and (create) idempotency headers crossing; an unproven owner never reaches the API and the API refuses missing/malformed owners, a missing idempotency key, unknown operations and ambiguous principals on its own; wallet A/B isolation for every read, write, open, dismiss and claim; a remotely created automation → the worker's sweep (no cron) racing the dispatch → one occurrence; occurrence → `/approve` view / claim (wallet B refused, proof required) / apply (edited workflow refused) on the API → worker completes it; the API made no flow call beyond `mode`/`info` |
| `backend/automation-production.pg.test.ts` (1) | production's own entry points as plain Node processes — `main.ts api` and `main.ts worker` — on PostgreSQL with the BFF in remote mode: create through the API; the worker's startup sweep arms the price trigger; after the price falls, a worker sweep proposes once (`price:1`); the owner opens it through the API on the shared approval model (authority NONE); both processes logged `automation.*_enabled` |
| `src/server/automation-operation.test.ts` (7) | BFF boundary without a database (runs in `pnpm check`): unproven owners never forwarded; exact headers; only automation links forwarded; fail-closed answers |
| `backend/automation-worker.test.ts` (+1) | the API loads its automation routes on plain Node through the same rule: exactly two POST routes |
| `src/automations/boundaries.test.ts` (+1) | the API routes, operations and BFF boundary reach no signing, key custody, flow call, preview, run or journal; the route patterns and the closed operation list are fixed |
