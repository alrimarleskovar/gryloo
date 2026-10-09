# FloFi Automations — operator guide (BUILD-AUTOMATION-001)

Automations are **automated evaluation and owner-confirmed execution** (`CONFIRM_EACH_TIME`). FloFi evaluates the schedules and
deterministic price conditions an owner configures; when one holds, it records one occurrence and asks the owner. The owner then uses
FloFi's existing path: `/approve` → wallet proof → re-composed strategy (same workflow hash) → fresh simulation → Strategy Manifest
Review → explicit approval → the owner's own wallet signature → execution → reconciliation → evidence.

Nothing here trades automatically. No component holds a key, signs, submits or approves: the scheduler, the price source and every
notification carry zero financial authority. See [the plan](../builds/BUILD-AUTOMATION-001-PLAN.md) and
[the report](../builds/BUILD-AUTOMATION-001-REPORT.md).

## 1. What runs where

**Standard production — FloFi's existing topology, unchanged:** Vercel frontend/BFF → Railway API → Neon PostgreSQL, plus the Railway
worker. Automations need no embedded web runtime, no cron, no Vercel Pro and no new service. Since PR #71 (BUILD-PLATFORM-STATE-001)
Vercel may also hold the pooled Neon `DATABASE_URL` for durable platform state (MCP, Developer, Channels, the shared approval store);
`API_BASE_URL` still selects the remote runtime, and automations stay on the API: Vercel holds no automation variable and reads no
automation state itself.

| Piece | Where (production) | Notes |
| --- | --- | --- |
| Workspace `/app/automations` and its server actions | Vercel (BFF) | every action re-verifies the owner's HttpOnly wallet session, then forwards the operation to the API with the API bearer and the verified owner in the server-to-server `x-flofi-workflow-owner` header — the saved-workflow convention |
| Automation CRUD/state: `POST /v1/automations/:method` | Railway API (`main.ts api`) | overview, create, pause/resume/archive, rebind, history, open, dismiss, watch Buy/Sell, Telegram link/unlink — every query scoped to the owner header; another owner's id answers NOT FOUND; `create` is idempotency-keyed |
| `/approve` for automation links: `POST /v1/approvals/:method` | Vercel `/approve` → Railway API | view / claim / apply / share on the SHARED approval model (same platform functions, same handoff store), with the wallets the browser proved in `x-flofi-wallet-principals`; other link kinds are unchanged. PR #72's recovery of an APPLIED proposal by its id (`resume`) is tried on Vercel's own surface first and, on the remote runtime, then on the API — for its proven claimant only, reissuing nothing |
| Scheduler | Railway worker (`main.ts worker`) | its sweep (every 60 s) discovers due rules, expires, syncs approvals and applies retention; its claim loop runs `automation.evaluate` (the same handlers, work items and leases as the dispatch) |
| State | Neon/PostgreSQL, migration `0010_automations` | rules, occurrences, history, Telegram links; approvals in the shared `mcp_handoffs` |
| Telegram notifications | Channel Core | not in this topology today. Since PR #71 Channel Core also runs on Vercel, but automation Telegram uses it where automations run — the API decides availability and mints link codes, the worker delivers — and the standard Railway API/worker carry no Telegram configuration (nor Vercel any automation configuration). The API therefore reports Telegram unavailable, no chat can be linked and no notification item is queued; owners see proposals in the app (§5) |

Authority does not move: the API does CRUD/state and mints no-authority approval links on the shared model; the worker only
evaluates; neither can sign, submit, run a flow or skip the owner's fresh simulation, Strategy Manifest Review or wallet signature
(the worker's flow services stay observe-only, `WORKER_SUBMISSION_FORBIDDEN`). The routes and the worker's automation handlers load
only where `FLOFI_AUTOMATIONS=enabled` is set; otherwise the API and the worker are unchanged.

### Scheduler topology (choose by deployment)

| Deployment | Scheduler | Needs |
| --- | --- | --- |
| **Standard production** (Vercel BFF → Railway API → Neon + Railway worker) | the worker's 60 s sweep | `FLOFI_AUTOMATIONS=enabled` on the API and the worker (§2); **no cron, no Vercel Pro, no external scheduler** |
| An embedded web runtime with a Railway worker on the same `DATABASE_URL` and `TENANT_ID` | the worker's 60 s sweep | as above, with the web deployment holding the automation configuration instead of the API |
| An embedded web runtime without a worker (every Preview — no worker serves a Preview's `pv-…` tenant, and Vercel Cron never runs for Previews) | optional: an external scheduler calling `GET /api/automations/dispatch` each minute with the bearer | `FLOFI_AUTOMATION_DISPATCH_TOKEN_SHA256` on the web deployment |

`/api/automations/dispatch` (embedded web runtime only) stays an **optional alternative trigger** — Previews, a deployment without a
worker, recovery or a manual pass — never the production scheduler. The worker and the dispatch may run at once: every step is
idempotent and they still produce exactly one occurrence per trigger event. Without any scheduler nothing is evaluated or proposed (fail
closed).

## 2. Setup (standard production)

1. Migrate: the deploy step (`node apps/reference-dapp/backend/main.ts migrate`) applies `0010_automations`. Nothing serves
   automations until it is applied (`AUTOMATION_SCHEMA_NOT_INSTALLED`).
2. **Railway API** (all server-only; see [ENVIRONMENT.md §5f](ENVIRONMENT.md)):
   - `FLOFI_AUTOMATIONS=enabled`, `FLOFI_AUTOMATION_SECRET` (`openssl rand -hex 32`, dedicated; keys the approval links and Telegram
     link codes), `FLOFI_PUBLIC_ORIGIN` = the Vercel origin (approval and notification links point there).
   - Prices (optional): `FLOFI_AUTOMATION_PRICE_SOURCE=chainlink`, `FLOFI_AUTOMATION_CHAINLINK_FEEDS=ETH=0x…,BTC=0x…,SOL=0x…` with the
     **Base mainnet** USD proxy addresses copied from [data.chain.link](https://data.chain.link) (FloFi verifies chain 8453, the
     feed's `description()` and `decimals()` before trusting any answer, so a wrong address fails closed with `PRICE_FEED_MISMATCH`),
     and a keyed `FLOFI_AUTOMATION_CHAINLINK_RPC_URL` (or `GRYLOO_BASE_RPC_URL`). The API only reads which assets are observable (it
     never queries a price); without a price source, price triggers and daily watches cannot be created (`PRICE_ASSET_NOT_OBSERVABLE`)
     and scheduled DCAs still work.
   - Keep `FLOFI_AUTOMATION_HANDOFF_MAINNET_NETWORKS` empty (mainnet refused by policy). The swap flows an automation proposes must be
     enabled on the API as for any proposal (e.g. `GRYLOO_PUBLIC_TESTNET=record` for Base Sepolia).
   - Its log says `automation.api_enabled` at start; a load failure logs `automation.api_disabled` and every other route keeps serving.
3. **Railway worker** (same `DATABASE_URL` and `TENANT_ID` as the API): `FLOFI_AUTOMATIONS=enabled`, `FLOFI_PUBLIC_ORIGIN` and the
   same price variables. It needs **no** `FLOFI_AUTOMATION_SECRET` and no dispatch token (it mints no approval and serves no route).
   Its log says `automation.worker_enabled` (kinds, `telegram`); an invalid value logs `automation.worker_disabled` with a closed code
   and leaves reconciliation running. Resolution: about a minute.
4. **Vercel**: nothing new — the existing `API_BASE_URL` and `API_AUTH_TOKEN` carry the workspace and automation approval links to the
   API. No automation variable, database URL or cron is needed on Vercel in this topology.
5. Check: the workspace shows the Automations form for a proven wallet (`/v1/automations/availability` answers `enabled: true`), and
   the worker logs `automation.evaluated` as rules come due.

(For an embedded web runtime, the web deployment holds the API's variables above and, if it has no worker, the optional dispatch:
`FLOFI_AUTOMATION_DISPATCH_TOKEN_SHA256` = `sha256(CRON_SECRET)` and a scheduler calling `GET /api/automations/dispatch` with
`Authorization: Bearer $CRON_SECRET`; `GET /api/automations/health` with the bearer answers its readiness.)

## 3. What an owner can create

| Kind | Example | Action |
| --- | --- | --- |
| Scheduled DCA | Every Monday 09:00 Europe/Lisbon | a bound swap (USDC → WETH on Base Sepolia, …) proposed each time, or from a saved single-swap workflow |
| Price trigger | If ETH falls below $3,000 / BTC falls 5 % from $100,000 | a bound swap of the observed asset, or "notify me only" |
| Daily watch | Every day 09:00, check BTC / ETH / SOL | a report only; Ignore, or Buy / Sell (below) |

**Daily watch Buy / Sell is the owner's own new trade, not automation execution.** A watch has no action and no limits. Buy / Sell
puts FloFi's ordinary authoring proposal for the amount the owner types into the owner's Build draft — exactly as if they had composed
it in Build — and closes the report (*You started your own buy/sell in Build*). It is not an automation proposal, no `AUTOMATION_RULE`
approval is created, and automation limits do not apply to it; the owner applies it, simulates, reviews and signs it like any other
workflow. Likewise, after the owner adds an automation proposal to their workflow, any edit they make there is their own workflow:
automation limits bound what FloFi proposes, not what the owner later chooses to sign.

**Assets, honestly.** Observation: ETH, BTC, SOL (when the price source serves them). Execution: USDC ⇄ WETH on Base Sepolia and
Ethereum Sepolia; devUSDC ⇄ SOL on Solana Devnet (needs the Devnet flow and a Solana wallet session). Base mainnet swaps are not
owner-executable on current main (`OWNER_EXECUTION_NOT_IMPLEMENTED`); Solana mainnet is disabled by policy. **BTC has no swap route**
(`BTC_EXECUTION_ROUTE_UNAVAILABLE`): BTC can be watched and alerted on, never bought through a substitute. Test-network swaps execute at
test-pool prices, not at the observed market price.

## 4. Semantics the owner can rely on

- **Schedules** use IANA zones and follow daylight saving (a missing local time runs one gap later; a repeated one runs once, the first
  time). One slot per local date.
- **Missed runs (`LATEST_WITHIN_GRACE`)**: after downtime only the latest due slot can propose, and only within 6 hours of its time;
  earlier ones are recorded as missed. Ten missed weeks never become ten purchases.
- **Price triggers** fire once on the crossing into the condition; staying in it never proposes again; the rule re-arms when the
  condition clears. A crossing during the cooldown, or one refused by a limit, is consumed without a proposal. A condition already met
  when the rule is created (or resumed) waits for a new crossing. Stale or failed observations change nothing.
- **Limits** (per execution, per day/week/month amount and count, cooldown, slippage, expiry) bound what FloFi proposes; they are
  checked when the rule is created or rebound, when an occurrence is created and when the owner opens it. They are not on-chain limits.
  A rule's definition and limits never change after creation (enforced by the database); only its bound action can be rebound.
- **One occurrence, one proposal.** Opening a proposal again withdraws the previous approval first; once the owner has added it to their
  workflow it is completed and cannot be proposed or dismissed again (`AUTOMATION_OCCURRENCE_COMPLETED`).
- **Workflow edits** never change an automation: a saved workflow it came from is recorded by id, hash and version; an edit marks the
  automation "rebind required" and nothing is proposed until the owner rebinds (re-checked against the limits).
- **Expiry**: a DCA proposal waits until the next slot (≤ 24 h), a price proposal 6 h, a watch report until the next slot.

## 5. Notifications

- **In FloFi**: always — the Automations workspace lists what is waiting, and the product stages show a notice while anything is.
- **Telegram**: in the workspace, *Connect Telegram* shows a one-time code (10 minutes); the owner sends `automations <CODE>` to the
  FloFi bot (the sender must be on the Telegram allowlist, §5e). The chat then receives one message per occurrence with a button to
  `/app/automations?occurrence=…` — never an approval secret; the owner's FloFi session is still required. STOP in the chat or *Unlink*
  in FloFi ends it; a link lasts 90 days. A failed delivery changes nothing about the proposal. WhatsApp is never used (policy, D1).
- **Who delivers, by topology.** Telegram runs only through the existing Channel Core (webhook, link codes, outbox, retries) — there is
  no second bot stack. Automations use it in the processes that serve them: availability and link codes where the owner operations run,
  delivery where evaluation runs, link-code consumption in the bot's webhook only where automations are enabled. Since PR #71 Channel
  Core runs on Vercel in the remote topology as well, but in **standard production** the Railway API and worker hold no Telegram
  configuration and Vercel holds no automation configuration, so Telegram is not available for automations: the API reports it
  unavailable, no chat can be linked, no notification item is ever queued, and owners see every proposal in the app. Wiring it there
  would mean placing the Channels Telegram configuration on Railway and the automation configuration on Vercel; this build does neither
  and has not tested that combination (an owner decision). Where Channel Core and automations share a process (an embedded web runtime with Telegram), the occurrence's
  notification item is queued only for an owner with a live linked chat and is delivered by a process that has the Channels Telegram
  configuration: the web deployment's optional dispatch, or the worker if that configuration is also set on it. In every topology the
  occurrence is created first, in its own transaction; delivery can never block or change it.

## 6. Logs and codes

Content-free JSON lines (`service: flofi-automations`): `automation.evaluated`, `automation.trigger_matched`,
`automation.condition_not_met` (on changes only), `automation.occurrence_created`, `automation.approval_requested`,
`automation.notification_attempted`, `automation.paused` / `resumed` / `archived` / `expired`, `automation.dispatch`. Fields are ids,
closed codes and counts only — never an owner address, a channel address, a link, a token or a signature.

## 7. What not to do

- Never set `FLOFI_AUTOMATION_PRICE_SOURCE=fixture` or `FLOFI_AUTOMATION_TEST_CLOCK=enabled` on a hosted deployment (both are refused).
- Never list mainnet networks for automations without the owner's explicit decision and the legal review Channels and MCP require.
- There is no "run this automation now" endpoint and none should be added: evaluation only ever produces proposals for the owner.
