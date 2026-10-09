# FloFi Automations — operator guide (BUILD-AUTOMATION-001)

Automations are **automated evaluation and owner-confirmed execution** (`CONFIRM_EACH_TIME`). FloFi evaluates the schedules and
deterministic price conditions an owner configures; when one holds, it records one occurrence and asks the owner. The owner then uses
FloFi's existing path: `/approve` → wallet proof → re-composed strategy (same workflow hash) → fresh simulation → Strategy Manifest
Review → explicit approval → the owner's own wallet signature → execution → reconciliation → evidence.

Nothing here trades automatically. No component holds a key, signs, submits or approves: the scheduler, the price source and every
notification carry zero financial authority. See [the plan](../builds/BUILD-AUTOMATION-001-PLAN.md) and
[the report](../builds/BUILD-AUTOMATION-001-REPORT.md).

## 1. What runs where

| Piece | Where | Notes |
| --- | --- | --- |
| Workspace `/app/automations` and its server actions | Vercel (embedded runtime) | every action re-verifies the owner's HttpOnly wallet session |
| `/api/automations/dispatch` | Vercel (embedded runtime) | bearer-only scheduler pass: expire, discover due rules, evaluate them as durable work items, sync approvals, retention |
| `/api/automations/health` | Vercel | bearer-only readiness (store, price source, observable assets, policy, notifier) |
| Railway worker (`main.ts worker`) | Railway, **only with `FLOFI_AUTOMATIONS=enabled` on the worker** | its sweep (every 60 s) runs the same discovery/expiry/approval-sync/retention steps and its claim loop runs `automation.evaluate` — the same handlers as the dispatch, the same work items and leases; off by default (the worker is then unchanged) |
| State | Neon/PostgreSQL, migration `0010_automations` | rules, occurrences, history, Telegram links; approvals in the shared `mcp_handoffs` |
| Telegram notifications | the existing Channel Core and Telegram adapter | only when Telegram runs on the same tenant (Channels §5e); delivered by a process that has the Telegram configuration (§2, step 4) |

No new always-on service. Evaluation only ever writes proposals for the owner: neither the dispatch nor the worker can sign, submit,
mint an approval or run a flow (the worker's flow services stay observe-only, `WORKER_SUBMISSION_FORBIDDEN`).

### Scheduler topology (choose by deployment)

| Deployment | Heartbeat | Needs |
| --- | --- | --- |
| **Production today** (Vercel on the remote runtime, `API_BASE_URL` → Railway API) | none | nothing: automations need the embedded runtime and answer `AUTOMATION_STORE_UNAVAILABLE`, like MCP, Developer and Channels. Enabling them in production is the owner's runtime decision, not part of this build. |
| **Embedded web runtime + the Railway worker on the same `DATABASE_URL` and `TENANT_ID`** (recommended once automations run in production) | the worker's 60 s sweep | `FLOFI_AUTOMATIONS=enabled`, `FLOFI_PUBLIC_ORIGIN` and the price variables **on the worker** too (§2, step 2); no cron, no Vercel Pro, no extra service |
| **Embedded web runtime without a worker** (every Preview — no worker serves a Preview's `pv-…` tenant, and Vercel Cron never runs for Previews) | an external scheduler calling `GET /api/automations/dispatch` every minute with the bearer | `FLOFI_AUTOMATION_DISPATCH_TOKEN_SHA256`; Vercel Cron works only on Production and needs Pro for a per-minute schedule (Hobby: daily) |

Both heartbeats may run at once (every step is idempotent; one occurrence per trigger event either way). Without any heartbeat nothing
is evaluated and nothing is proposed — the fail-closed outcome.

## 2. Setup

1. Migrate: the deploy step (`node apps/reference-dapp/backend/main.ts migrate`, or `FLOFI_MIGRATE_ON_BUILD=preview` on a Preview)
   applies `0010_automations`. The app refuses to serve automations until it is applied.
2. Variables (all server-only; see [ENVIRONMENT.md §5f](ENVIRONMENT.md)):
   - `FLOFI_AUTOMATIONS=enabled`, `FLOFI_AUTOMATION_SECRET` (`openssl rand -hex 32`, dedicated), `FLOFI_PUBLIC_ORIGIN`.
   - `FLOFI_AUTOMATION_DISPATCH_TOKEN_SHA256` = `sha256(CRON_SECRET)` (`printf %s "$CRON_SECRET" | sha256sum`).
   - Prices (optional): `FLOFI_AUTOMATION_PRICE_SOURCE=chainlink`, `FLOFI_AUTOMATION_CHAINLINK_FEEDS=ETH=0x…,BTC=0x…,SOL=0x…` with the
     **Base mainnet** USD proxy addresses copied from [data.chain.link](https://data.chain.link) (FloFi verifies chain 8453, the
     feed's `description()` and `decimals()` before trusting any answer, so a wrong address fails closed with `PRICE_FEED_MISMATCH`),
     and a keyed `FLOFI_AUTOMATION_CHAINLINK_RPC_URL` (or `GRYLOO_BASE_RPC_URL`). Without a price source, price triggers and daily
     watches cannot be created (`PRICE_ASSET_NOT_OBSERVABLE`); scheduled DCAs still work.
   - Keep `FLOFI_AUTOMATION_HANDOFF_MAINNET_NETWORKS` empty (mainnet refused by policy).
3. Scheduler (see the topology above), either or both:
   - **Railway worker** (same `DATABASE_URL` and `TENANT_ID` as the web deployment): set `FLOFI_AUTOMATIONS=enabled`,
     `FLOFI_PUBLIC_ORIGIN` and the same price variables on the worker. It needs **no** `FLOFI_AUTOMATION_SECRET` and no dispatch token
     (it mints no approval and serves no route). Its log says `automation.worker_enabled` (kinds, `telegram`) at start; an invalid
     value logs `automation.worker_disabled` with a closed code and leaves the rest of the worker running. Resolution: about a minute.
   - **External scheduler / Vercel Cron**: `GET /api/automations/dispatch` every minute with `Authorization: Bearer $CRON_SECRET`
     (Vercel Cron sends exactly that header, on Production only; Hobby allows only daily crons — use Pro, or any external scheduler
     with the same bearer).
   The scheduling resolution is the heartbeat interval; a missed beat is harmless (§4).
4. Telegram with the worker as heartbeat: a chat notification is queued only for an owner with a live linked chat, and it is delivered
   by a process that has the Telegram configuration. The worker claims notification items only when the Channels Telegram variables
   (§5e) are also set on it; otherwise they wait for the web deployment's dispatch (an external scheduler). In-app proposals are never
   affected.
5. Check: `GET /api/automations/health` with the bearer answers `{ ok: true, store: "READY", priceSource, observable, … }`.

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

## 6. Logs and codes

Content-free JSON lines (`service: flofi-automations`): `automation.evaluated`, `automation.trigger_matched`,
`automation.condition_not_met` (on changes only), `automation.occurrence_created`, `automation.approval_requested`,
`automation.notification_attempted`, `automation.paused` / `resumed` / `archived` / `expired`, `automation.dispatch`. Fields are ids,
closed codes and counts only — never an owner address, a channel address, a link, a token or a signature.

## 7. What not to do

- Never set `FLOFI_AUTOMATION_PRICE_SOURCE=fixture` or `FLOFI_AUTOMATION_TEST_CLOCK=enabled` on a hosted deployment (both are refused).
- Never list mainnet networks for automations without the owner's explicit decision and the legal review Channels and MCP require.
- There is no "run this automation now" endpoint and none should be added: evaluation only ever produces proposals for the owner.
