# BUILD-AUTOMATION-001 — Plan: FloFi Automations (automated evaluation, owner-confirmed execution)

Date: 2026-10-08. Branch `claude/build-automation-001-production` (worktree `~/projects/gryloo-automation-001`), from main
`8f91a010755449b333233a7d763cf44580c16ddf` (BUILD-CHANNELS-001 merged; migrations end at `0009`). One coherent build, developed and
validated locally, pushed once by the owner.

Historical context only, not a baseline: PR #66 (`AUTOMATION-001A`, built on an older main) and BUILD-016 / Mode C (unmerged delegated
authority). Neither is cherry-picked, merged, rebased or copied; nothing of Mode C's smart-account authority is revived.

> **Framing.** Automations are **automated evaluation and owner-confirmed execution** (`CONFIRM_EACH_TIME`). FloFi evaluates a
> schedule or a deterministic price condition the owner configured; when it holds, FloFi records one occurrence and asks the owner.
> The owner then uses FloFi's existing path: `/approve` → wallet proof → re-composed strategy → fresh simulation → Strategy Manifest
> Review → explicit approval → the owner's own wallet signature → execution → reconciliation → evidence. **The scheduler, the price
> source and every notification have zero financial authority.** FloFi does not trade automatically.

## 1. Components reused (unchanged in behaviour)

| Need | Reused primitive |
| --- | --- |
| Canonical action | StrategySpec v1 + `composeWorkflowBound` / `semanticWorkflowHash` (`src/engine`, `src/platform/strategy.ts`): the same IR and workflow hash as the app, MCP, the Developer API and Channels |
| Owner approval | The requester-neutral handoff platform (`requestApproval`, `createPgHandoffStore`, `approvalLinkScheme`, `ApprovalContributor`/`ClaimPolicy`, `/approve`, `verifyHandoff`, `sharedRuns`) |
| Gates and policy | `evaluateWorkflowGates` (supported by code / enabled by deployment / enabled by policy), a dedicated automation `HandoffPolicy` |
| Durable work | `work_items` (dedupe, leases, fenced settlement, retry/backoff, DEAD) through `createPostgresWorkQueue` and `createWorker` (the same claim/settle loop the Railway worker uses); idempotent handlers |
| Owner identity | HttpOnly EIP-4361 / Sign-In With Solana sessions (`currentWalletPrincipals`), the `WorkflowOwner` shape of saved workflows |
| Saved workflows | Migration `0008` documents: an automation can be created from a saved single-swap workflow and stays bound to its exact hash and version |
| Channels | Channel Core outbox, delivery, retries and the Telegram adapter for automation notifications; no second bot stack |
| Scheduler convention | Bearer-digest scheduler endpoints (`/api/channels/dispatch`, Developer `/internal/dispatch`): 404 unless configured, constant-time check |
| Shell and locale | The persistent product shell's secondary workspaces, the navigation drawer, the EN/PT catalog |

## 2. New components

- `src/automations/` — pure domain: `schedule.ts` (IANA zones, DST, slots, missed-run policy), `trigger.ts` (price conditions,
  edge/re-arm, cooldown), `limits.ts`, `definition.ts` (closed input schema), `assets.ts` (observation vs execution capability),
  `binding.ts` (strategy and saved-workflow binding, drift); persistence: `store.ts` / `pg-store.ts`; `price-source.ts`
  (provider abstraction: `chainlink`, `fixture`, `off`); `evaluator.ts` (the work handlers); `approval.ts` (requester, link scheme,
  claim policy, owner open); `notify.ts` (in-app record, Telegram via Channel Core); `dispatch.ts` + `http.ts` (scheduler endpoint);
  `config.ts`, `log.ts`, `service.ts` (owner operations).
- Migration `0010_automations.sql`.
- Approval requester kind `AUTOMATION_RULE` (a requester like `DEVELOPER_PROJECT`/`CHANNEL_CONVERSATION`), link scheme `flofi_auhs_`.
- Channel Core: a provider-neutral **subscription hook** (`automations <CODE>` links a chat to an owner's automation notifications;
  STOP unlinks) and a subscriber notification helper; the Automations module provides the hook implementation.
- UI: `/app/automations` workspace (create, list, pending decisions, history, Telegram link), EN/PT catalog `pt-automations.ts`;
  `/approve` wording for automation proposals.
- Routes: `/api/automations/dispatch` (bearer), `/api/automations/health` (bearer).
- Docs: this plan, the report, `docs/deploy/AUTOMATIONS.md`, ENVIRONMENT/STATUS/SECURITY_MODEL sections.

## 3. Data model (migration `0010_automations`)

| Table / change | Purpose |
| --- | --- |
| `mcp_handoffs.requester_kind` CHECK | adds `AUTOMATION_RULE` (nothing else in the handoff schema changes) |
| `automation_rules` | tenant, verified owner (`owner_namespace`, `owner_account`), `rule_id` (`aut_…`), name, `kind` (`SCHEDULED_DCA` / `PRICE_TRIGGER` / `DAILY_WATCH`), `state`, `execution_mode` = `CONFIRM_EACH_TIME` (CHECK: the only value), `definition` (schedule / condition / watch / limits), the bound action (`action_strategy`, `action_workflow_hash`, `engine_version`), optional source saved workflow (`source_workflow_id`, `_hash`, `_version`), `timezone`, `next_evaluation_at`, `last_evaluation_at`, `last_outcome`, `last_observation`, `trigger_state` (armed, arm epoch, cooldown), `attention`, `expires_at`, optimistic `version`, timestamps |
| `automation_occurrences` | one immutable logical occurrence: `occurrence_id` (`occ_…`), rule, owner (composite FK to the rule's owner), **`UNIQUE (tenant_id, rule_id, trigger_key)`**, kind (`SCHEDULE` / `PRICE` / `WATCH`), state, snapshot of the strategy and hash, spend asset/amount, observation + provenance, `due_at`, `expires_at`, `handoff_id`; a trigger enforces forward-only states and immutable facts |
| `automation_evaluations` | content-free history: outcome codes (`TRIGGERED`, `CONDITION_NOT_MET` on state changes, `MISSED`, `COOLDOWN`, `LIMIT_BLOCKED`, `OBSERVATION_STALE`, `WORKFLOW_CHANGED`, …), observation snapshot; bounded retention |
| `automation_link_codes` | one-time Telegram link codes: keyed digest only, owner, 10-minute expiry, consumed once |
| `automation_notification_targets` | owner → linked channel conversation (FK, cascade), expiry |
| `automation_notifications` | per occurrence and channel: delivery attempt status (never affects the occurrence) |
| `channel_conversations.retain_until` | an owner-requested subscription keeps the sealed send address until it expires; Channel Core's purge honours it |

## 4. Automation (rule) state machine

`ACTIVE ⇄ PAUSED`; `ACTIVE | PAUSED → EXPIRED` (its `expires_at` passed; applied by the evaluator and lazily on read);
`ACTIVE | PAUSED | EXPIRED → ARCHIVED` (terminal; history kept, nothing evaluates). Every owner change is a compare-and-set on
`version` (`AUTOMATION_VERSION_CONFLICT`). `attention` (`WORKFLOW_CHANGED`, `STRATEGY_STALE`) stops proposals until the owner rebinds
explicitly; it never changes the bound strategy by itself.

## 5. Occurrence state machine

`PENDING_OWNER → APPROVAL_CREATED → COMPLETED`; `PENDING_OWNER | APPROVAL_CREATED → DISMISSED | EXPIRED`; a watch report
`PENDING_OWNER → COMPLETED` (the owner acted) `| DISMISSED` (Ignore) `| EXPIRED`. `APPROVAL_CREATED → APPROVAL_CREATED` only to replace
an ended handoff with a fresh one. Terminal: `COMPLETED`, `DISMISSED`, `EXPIRED`. `COMPLETED` = the handoff was APPLIED in the owner's
FloFi workflow; execution and reconciliation are the run's own facts (shown from the existing run/evidence model, never as occurrence
states). `DUE` is not persisted: an occurrence is created, limit-checked and queued for notification in one transaction.

## 6. Scheduler semantics

- **Discovery**: in production the Railway worker's 60 s sweep (`FLOFI_AUTOMATIONS=enabled` on the worker), and optionally
  `/api/automations/dispatch` on an embedded web runtime (an external scheduler, bearer), insert `automation.evaluate` work items for
  ACTIVE rules whose `next_evaluation_at <= now`, deduplicated by `<rule>:<next_evaluation_at>`. (Final production integration,
  2026-10-09: the owner's operations and automation approval links reach the Railway API through the BFF — `/v1/automations/*`,
  `/v1/approvals/*` — so the remote production topology serves automations end to end; see the report §11.)
- **Processing**: the dispatch claims only `automation.*` items (fenced leases) and runs their handlers; the Railway worker runs the
  same handlers in its own claim loop, claiming only the kinds it has handlers for. Any number of concurrent calls, replicas and
  workers is safe. (Final review, 2026-10-09: the worker could not load these modules at first because `backend/main.ts` runs under
  Node's TypeScript stripping without a bundler, while `src/` modules use bundler-style extensionless imports. One scoped resolution
  rule, `backend/source-resolution.ts`, installed only when the worker enables automations, lets plain Node load the same files — no
  second engine, no schema change; see the report §3.)
  Phase 1 reads the rule and makes the read-only observation (outside any transaction). Phase 2 locks the rule row, re-checks state,
  version and due time (a paused, archived, re-bound or already-advanced rule is a no-op), applies the trigger state machine and
  limits, inserts the occurrence `ON CONFLICT DO NOTHING`, advances `next_evaluation_at`, writes history and enqueues the notification —
  one transaction. A crash before commit changes nothing; after commit the retried item finds the rule advanced.
- **Identity**: schedule slot = local date + local time + zone (`slot:2026-10-12T09:00`); price trigger = arm epoch
  (`price:<epoch>`); watch report = slot. At-least-once delivery therefore yields at most one occurrence per trigger event.
- **Schedules**: `DAILY` and `WEEKLY` (ISO weekday) at `HH:MM` in an IANA zone, computed from the zone's rules at every slot (never a
  fixed UTC hour). DST gap: a local time that does not exist is shifted forward by the gap (02:30 → 03:30 in a one-hour gap). DST
  overlap: the first (earlier) instant (Temporal's `compatible` rule). Resolution: one minute.
- **Missed-run policy (`LATEST_WITHIN_GRACE`)**: after downtime only the most recent due slot can produce a proposal, and only within
  6 hours of its time; all earlier slots are recorded once as `MISSED` (with a count) and never proposed. Ten missed weeks never become
  ten purchases.
- **Price cadence**: every `checkEveryMinutes` (5–1440), aligned to the minute grid.
- **Expiry**: a DCA occurrence expires at the next slot (≤ 24 h); a price occurrence after 6 h; a watch report at the next slot (≤ 24 h).
  The scheduler expires lapsed occurrences; reads apply expiry lazily.
- **Test clock**: `FLOFI_AUTOMATION_TEST_CLOCK=enabled` (refused on hosted deployments) lets the bearer dispatch take
  `x-flofi-automation-now`.

## 7. Price observation architecture

`PriceSource.observe(asset)` → `{ asset, priceUsd (exact decimal), observedAt (source time), receivedAt, source, provenance, evidence }`.

- `chainlink`: read-only `eth_call` of a configured Chainlink AggregatorV3 proxy on Base mainnet (`latestRoundData`, `decimals`,
  `description`) through `FLOFI_AUTOMATION_CHAINLINK_RPC_URL` (default: the existing Base read RPC). Feed addresses are configuration
  (`ETH=0x…,BTC=0x…,SOL=0x…`), never unverified pins: each read checks chain id 8453, `description() == "<ASSET> / USD"` and
  `decimals()`; answers older than `FLOFI_AUTOMATION_PRICE_MAX_AGE_SECONDS` are `PRICE_STALE`. Only `eth_chainId` and `eth_call` can leave
  the transport (anything else: `AUTOMATION_RPC_METHOD_FORBIDDEN`); 5-second timeouts; classified errors. Evidence: `PUBLIC_READ_ONLY`.
- `fixture`: a JSON file under `/tmp` (refused on hosted deployments) for CI and browser tests; evidence `MOCKED`.
- `off` (default): price rules record `PRICE_SOURCE_OFF` and never trigger.

A failed or stale observation changes no trigger state and creates nothing. Observation support (ETH, BTC, SOL) and execution support
are separate facts (§10).

## 8. Notification integration

- **In-app (always)**: the occurrence itself; the Automations workspace lists pending decisions; the navigation drawer shows the
  count.
- **Telegram (Channel Core)**: the owner creates a one-time code in FloFi and sends `automations <CODE>` to the FloFi bot; Channel Core
  passes it to the automation link hook (digest lookup, single use, 10 minutes) and links that conversation to the owner (STOP
  unlinks). Each occurrence enqueues one NOTIFICATION outbox row (`automation:<occurrence>`) with a link to
  `/app/automations?occurrence=<id>` — **no approval secret, no authority**; the owner's FloFi session is still required. Delivery
  failures are Channel Core's retries and dead letters; they never change the occurrence. WhatsApp's policy guard is unchanged.

## 9. Security boundaries

1. The scheduler, evaluator and dispatch hold no key, sign nothing, submit nothing: their import closure is checked (no signing
   primitives, no flow calls, no claim/apply) and the price transport refuses every method except `eth_chainId`/`eth_call`.
2. A price observation only feeds a deterministic comparison; a notification carries no secret; an occurrence is a proposal.
3. The proposal enters `/approve` as an `AUTOMATION_RULE` handoff (authority NONE): the claim policy accepts only the automation
   owner's proven wallet while the rule is ACTIVE and the occurrence open; the stored strategy is re-composed and must reproduce
   its hash; the owner's fresh simulation, Manifest Review and wallet signature are unchanged.
4. Every owner operation requires the owner's HttpOnly wallet session matching the requested owner; every query filters tenant,
   namespace and account (a guessed id finds nothing).
5. A saved-workflow edit marks the automation `WORKFLOW_CHANGED`; only an explicit owner rebind (re-checked against limits) changes
   the bound strategy. An engine change that alters the hash marks it `STRATEGY_STALE`.
6. Mainnet is disabled by policy (`FLOFI_AUTOMATION_HANDOFF_MAINNET_NETWORKS` empty by default).

## 10. Assets and execution capability (current main)

Observation: ETH/USD, BTC/USD, SOL/USD (Chainlink on Base mainnet when configured; fixture in tests). Execution (the action of a DCA
or price trigger): the existing swap flows — USDC ⇄ WETH on Base Sepolia, Ethereum Sepolia (and Base mainnet, policy-disabled),
devUSDC ⇄ SOL on Solana Devnet (and USDC ⇄ SOL on Solana mainnet, policy-disabled). **BTC has no swap route in FloFi**
(WBTC is Aave-only on Ethereum Sepolia; no cbBTC): BTC can be watched and alerted on, a BTC purchase shows the blocker
`BTC_EXECUTION_ROUTE_UNAVAILABLE`, and nothing is substituted. Adding a route later is a StrategySpec/flow change; the scheduler is
action-agnostic. Testnet swaps execute at test-pool prices, not at the observed market price (stated in the UI).

## 11. Limits (enforced, all deterministic)

`maxAmountPerExecution` (bound amount ≤ limit), `maxAmountPerPeriod` and `maxOccurrencesPerPeriod` (DAY / WEEK / MONTH in the rule's
zone, counting the owner's open and taken-up proposals: PENDING_OWNER, APPROVAL_CREATED, COMPLETED), `cooldownMinutes`,
`maxSlippageBps` (bound slippage ≤ limit), `expiresAt`. Checked when the rule is created or rebound, when an occurrence is created
(under the rule lock) and again when the owner opens it. They bound what FloFi proposes; they are not on-chain spending limits, and
the fresh simulation and Review stay authoritative for market and route facts.

## 12. Tests

- **Pure**: daily/weekly slots, DST gap and overlap (Europe/Lisbon, America/New_York), next slot, missed-run policy, absolute and
  percentage conditions, crossing/re-arm, cooldown, stale observations, limits and periods, definition validation, binding and drift,
  saved-workflow derivation, price-source parsing and method allowlist, notification output guard.
- **PostgreSQL**: migration integrity (0009 → 0010 additive, requester kind), owner isolation, CRUD with optimistic concurrency,
  exactly one occurrence under competing evaluators and duplicate dispatches, crash after commit and retry, pause while queued,
  expiry, repeated observations, limit counting, approval claim by owner only, wallet mismatch, expired approval, workflow edit drift.
- **Integration**: due schedule → occurrence → handoff → claim → apply (existing owner flow) → status; price crossing → occurrence;
  Telegram notification through Channel Core with the loopback provider; the scheduler cannot submit.
- **Browser**: owner proves a wallet → creates a weekly DCA → test clock makes it due → pending occurrence → Review in FloFi →
  `/approve` → load → Simulate/Review entered, no wallet transaction; a price trigger with the fixture source.
- **Gates**: `pnpm check`, `pnpm test:postgres`, governance-lite and its tests, the relevant Playwright suites, `git diff --check`.

## 13. Out of scope

Delegated or unattended execution (Mode C or any session key), automatic signing, mainnet enablement, WhatsApp activation,
general multi-step sequences, BTC execution routes, a new always-on service.
