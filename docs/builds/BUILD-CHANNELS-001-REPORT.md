# BUILD-CHANNELS-001 — Report: FloFi Channels (production Channel Core, Telegram, WhatsApp)

Date: 2026-10-08. Branch `claude/build-channels-001-production`, restacked onto main `043ab01` (BUILD-DEVELOPER-001 included).
The earlier MOCKED-only branch `claude/build-channels-001` (`0609937`) is kept untouched as a safety copy.

**Final status: `READY_FOR_OWNER_REAL_E2E`** — Telegram is implemented and configurable end to end and every local gate passes;
only owner credentials and provider setup remain ([CHANNELS-OWNER-E2E.md](../deploy/CHANNELS-OWNER-E2E.md)). WhatsApp:
**`BLOCKED_ON_EXTERNAL_PROVIDER`** (WhatsApp Business Messaging Policy §4; implementation complete). Not `COMPLETE`: no real owner
E2E has happened.

> A channel is an entry point into FloFi's shared engine with **zero financial authority**. A message such as "yes", "confirm" or
> "execute" authorizes nothing. A sender id is never a wallet. The only path to execution is FloFi's own: `/approve` → wallet
> proof → fresh simulation → Strategy Manifest Review → explicit approval → the owner's wallet signature → reconciliation →
> evidence.

| Evidence level | Result |
| --- | --- |
| Implemented | **yes**: production Channel Core, provider contract, Telegram (live-capable), WhatsApp (live path behind the policy guard), scheduled dispatch, readiness, operator CLI, migration `0008` shipped |
| MOCKED / loopback tested | **yes**: unit, PostgreSQL, in-process journeys (full MOCKED execution and reconciliation), browser journeys for both providers (§8) |
| Live-provider tested | **NOT DONE**: no real bot or Meta number was contacted by the build; the owner-run live harness exists (`pnpm test:channels-live`) |
| Public-chain tested | **NOT DONE** |
| Production-ready | **Telegram: yes for the owner's test-funds E2E; public use needs the owner's policy/legal review. WhatsApp: no (policy)** |

## 1. Restack (Phase 1)

- New branch from `043ab01`; only the 11 Channels commits `fc84a1e..0609937` replayed; the 18 superseded MCP/Developer commits
  were not. Channels code came out byte-identical to `0609937` (the WhatsApp guard included).
- Conflicts resolved: `approval-surface.ts` (MCP + Developer + Channel contributors), `/approve` (main's page kept;
  `<ChannelProgressPing/>` next to `ApprovalHandoff` in `ProductWorkspace`), `contracts.yml` (main's gates kept, Channels added),
  `STATUS.md` and `ENVIRONMENT.md` (Developer §5c and Channels §5d both kept). `git diff --check` and `pnpm check` passed.

## 2. Commits (on top of `043ab01`)

| Commit | Content |
| --- | --- |
| `b00ff34` … `8f5ec72` | The 11 restacked BUILD-CHANNELS-001 commits (plan, Core, WhatsApp fixture adapter, ping, journeys, docs) |
| `dcfbce5` | Migration `0008` shipped after `0007`, pinned; raw applications removed; migration tests (0005/0006/0007 → 0008, additive, edit refused) |
| `6c6a0de` | Production Channel Core, provider contract, multi-adapter registry, WhatsApp live path (guarded), Telegram adapter, `0008` finalized |
| `9b16b3c` | Scheduled dispatch, readiness endpoint, operator CLI, live Telegram harness, boundary tests |
| `47f23a2` | Browser journeys for Telegram and WhatsApp on current main; CI |
| `8496074` | Owner E2E runbook, Telegram/WhatsApp guides, ENVIRONMENT/CLOUD/STATUS/SECURITY, plan §15 |
| (this commit) | This report |

87 files changed against `043ab01` (+7,281/−7 before this report); no `package.json` dependency and no lockfile change.

## 3. Architecture

```
Telegram Bot API ──POST /api/channels/telegram (secret token)──┐    WhatsApp Cloud API ──GET/POST /api/channels/whatsapp (HMAC raw body)
                                                               ▼                                                   ▼
src/channels/http.ts  one boundary for every provider: enablement → config → handshake → content type → body bound → authenticity
                      → JSON → provider normalize → embedded PostgreSQL + schema → content-free records (dedup) → 200; turns after()
src/channels/<provider>  ChannelProvider: authentic · normalize · acknowledge · adapter{send → SendResult(class), window, statuses}
src/channels/core     conversation (exact grammar → untrusted Copilot) → canonical StrategySpec (IR parity) → revoke old link →
                      requestApproval (platform, CHANNEL_CONVERSATION) → read-only preview → state + outbox in one tx under a fenced
                      lease → delivery (classified retries, DEAD, UNCERTAIN never resent) → status notifications → retention, audit
/api/channels/dispatch (bearer)  stranded turns · due/interrupted/unconfirmed sends · approval progress → chat · retention
/api/channels/health   (bearer)  provider states and capabilities, store, policy
src/platform (unchanged)  requestApproval · HandoffStore · approvalLinkScheme('flofi_chs_') · approvalProgress
/approve (main's)     wallet proof → claim (intended wallet) → proposal card → FloFi's simulation → Manifest Review → owner signature
```

## 4. Channel Core (Phase 3)

| Requirement | As implemented |
| --- | --- |
| Durable state, tenant isolation | `channel_conversations/events/outbox/audit` (0008), every row and query tenant-scoped (tests prove another tenant sees, sweeps and settles nothing) |
| Provider/channel identity | conversation key = (tenant, channel, provider endpoint id, keyed digest of the provider user id) |
| Dedup, idempotency | keyed digest of the provider event id (WhatsApp message id, Telegram `update_id`); outbox dedupe keys; notification keys |
| Leases, restart safety | fenced per-conversation lease (300 s); stranded events re-run by the dispatch; too-old (> 15 min) answered "late", never acted on |
| State machine, interpretation | `decideTurn`: local commands, zero-authority notice, exact grammar, then the existing Copilot as untrusted interpreter |
| Canonical IR, Review/Manifest | `canonicalStrategy` with parity against the engine; approval through the shared platform; FloFi's own Review on `/approve` |
| Outbox, retries, dead letter | backoff 5 s, 15 s, 45 s, 2 min, 5 min (±20 %, or retry-after), 6 attempts, then `DEAD`; with a once-a-minute scheduler the sixth attempt comes ≤ 882 s after the first, inside the 900 s body lifetime (any jitter, any phase); a message whose next attempt cannot fit ends `DEAD` at once, and an expired body that already failed is `DEAD`, one never attempted `SKIPPED`; permanent → `FAILED` |
| Uncertain sends | timeout / crash / malformed success → `UNCERTAIN`, never resent; WhatsApp's status webhook confirms within 10 min, else `SEND_OUTCOME_UNKNOWN`; an approval link then withdrawn with "send LINK" |
| Receipts, correlation | outbox id as correlation (WhatsApp `biz_opaque_callback_data`); keyed provider message digest; monotonic SENT < DELIVERED < READ, FAILED |
| Status propagation | "loaded", "in progress", "reconciled ✅ · evidence: …"/"ended", each once, only while the owner shares status; ping (fast) + dispatch (guarantee) |
| Retention, audit | payloads ≤ 15 min, state 30 min idle, address 48 h, records 8 days, audit 30 days; audit rows written in the same statement as each change |
| Secret minimization | keys/seed phrases replaced by a marker before storage; AES-256-GCM bound to tenant/table/row/column; no provider secret persisted; logs allowlisted |

## 5. Providers (Phases 4–6)

**Contract** (`core/types.ts`): `ChannelProvider { route, mode, businessId, maxBodyBytes, handshake, authentic, authenticationFailure,
normalize, acknowledge, secrets, adapter }`, `ChannelAdapter { send → SendResult{ok | code, failure: TRANSIENT|RATE_LIMITED|PERMANENT|
UNCERTAIN, retryAfterMs}, windowHours, outsideWindow, deliveryReports, confirmsUncertainSends, choicesFit }`. Network access only
through `core/provider-http.ts` (fixed origins, no redirects, timeouts, byte caps, NOT_SENT vs UNCERTAIN).

| | Telegram | WhatsApp |
| --- | --- | --- |
| Inbound auth | `X-Telegram-Bot-Api-Secret-Token` (constant-time) | `X-Hub-Signature-256` over the exact raw bytes; GET verify-token handshake |
| Normalization | private chats with people; commands keep their word; callback taps (acknowledged); blocked bot → opt-out | text, button/list replies; this WABA and phone number only |
| Outbound | `sendMessage`, plain text, URL button for the link, callback buttons | text / reply buttons / CTA URL; approved template outside the 24 h window |
| Statuses | none exist for bots: SENT = accepted | sent/delivered/read/failed webhooks, correlated |
| Errors | 429 retry_after; 403/401/404/400 final; 5xx with body retried; timeout never resent | Cloud API codes classified (§3 of WHATSAPP.md) |
| Activation | `FLOFI_TELEGRAM=enabled` + token, webhook secret, allowlist | fixture only, never hosted, until clearance is recorded in code (null) |

## 6. Worker / retry / scheduling (Phase 8)

The embedded runtime (Vercel + PostgreSQL), where MCP and the Developer API also live, has no long-running worker; the Railway
worker belongs to the remote runtime, which these surfaces do not support. So, as the Developer API does for webhooks, the
channels expose a bearer-protected dispatch endpoint for any scheduler (Vercel Cron on Production; it does not run for Previews).
No competing runtime was added. Sweeps are bounded (25 conversations, 25 approvals, 45 s) and safe under concurrency.

## 7. Deployment (Phase 9)

Variables: [ENVIRONMENT.md §5e](../deploy/ENVIRONMENT.md) (all default off; mainnet handoffs off). Vercel: Preview on the embedded
runtime with `FLOFI_MIGRATE_ON_BUILD=preview` (applies `0008`), Vercel Authentication disabled for the Telegram webhook to reach
it. Railway: nothing to add (channels refuse the remote runtime). Routes: `/api/channels/telegram`, `/api/channels/whatsapp`,
`/api/channels/dispatch`, `/api/channels/health`. Operator CLI: `backend/channels-admin.ts`. No `vercel.json` cron was added (it
would be Production-only and plan-dependent); the snippet is in the runbook.

## 8. Validation (local, pinned toolchain Node 24.21.0 / pnpm 11.22.0, loopback PostgreSQL 18.6)

| Gate | Result |
| --- | --- |
| `git diff --check` (043ab01..HEAD) | clean |
| typecheck, lint, build, `schemas:check` (the `pnpm check` steps, run separately) | pass |
| `pnpm test` (unit) | **261 files, 2,656 passed**, 2 skipped (earlier builds' BUILD-007 `skipIf` cases) |
| PostgreSQL suites (all 35 `*.pg.test.ts`, as `pnpm test:postgres`) | **35 files, 224 passed** |
| — migration tests (0005/0006/0007 → 0008; additive; edited 0008 refused; manifest pin) | pass |
| — Channels: store (uncertain/stale, DEAD, sweep queries, audit, tenant isolation), dispatch (7), Telegram (6), WhatsApp (incl. full MOCKED execution/reconciliation journeys) | pass |
| Channels unit (Telegram 9, retry schedule, boundaries incl. zero-authority closure check), operator CLI (4, plain Node) | pass; live Telegram harness: 3 skipped (owner-run only) |
| Browser: `telegram-approve.spec.ts`, `whatsapp-approve.spec.ts` | **1/1, 1/1** |
| Browser regressions: `developer-journey.spec.ts`; `mcp-in-chat` + `mcp-route-presentation` (MCP harness); `mcp-route-presentation` (no harness) | **1/1; 21/21; 11/11** |
| `governance_lite.py` on a `git archive` export + its unittest suite | **pass (1,377 text files); 19/19** |
| `pnpm audit --audit-level low` | **no known vulnerabilities**; lockfile unchanged |
| Merge result vs current main | branch descends from `043ab01` (still `origin/main`): the merge result is HEAD |

Not run locally: the CI `guarded-release-browser.mjs product` profiles and the fork suites (`test:fork`), whose areas this build
does not change; CI runs them. Each gate ran on the final code; this report commit changes no code.

## 9. Changes for owner review

1. **Migration `0008` was edited before shipping** (never applied outside tests): new outbox states, indexes, `handoff_settled`,
   `channel_audit`; its pin changed accordingly.
2. **The WhatsApp spec no longer signs five MOCKED steps in the browser**: current main blocks MOCKED financial authority at Review
   (as for the Developer spec). The full MOCKED lifecycle stays proven in `journey.pg.test.ts`.
3. **D5 extended**: a scheduled dispatch now complements the `/approve` ping. **D1 kept but made exact**: a code-recorded clearance
   is the only activation point for live WhatsApp.
4. **Behaviour changes**: HELP/START carry the first-contact notice on a first exchange; an approval message is never held behind a
   failed reply; a send with an unknown outcome is never resent (a lost message is preferred to a duplicate; WhatsApp can still
   confirm it); address retention 24 h → 48 h (template notifications after WhatsApp's window); "execution in progress" notification.
5. `channelPublicOrigin` now reuses main's `deployment.publicOrigin`.

## 10. Remaining blockers and owner actions

- **Telegram (real E2E)**: create the bot, set the Preview variables, register the webhook, fund a testnet wallet, run the test —
  exactly as [CHANNELS-OWNER-E2E.md](../deploy/CHANNELS-OWNER-E2E.md). Policy/legal review before any public use.
- **WhatsApp**: written clearance under the Business Messaging Policy §4, then a reviewed change recording it, then the Meta setup in
  [WHATSAPP.md §2](../deploy/WHATSAPP.md).
- **Production scheduler** for `/api/channels/dispatch`.
- Not built: live-model acceptance of channel natural language (exact commands are used for the E2E), deep links into specific
  wallets, owner binding at claim time (D3 alternative), friendlier `/approve` copy for channel proposals (UX owner).

## 11. Post-push fix (PR #69, CI run 37786549580)

CI failed one PostgreSQL test: the dead-letter case of `dispatch.pg.test.ts` expected `DEAD` and found `PENDING`. **Root cause: a real
retry-policy inconsistency, not only a flaky test.** Retries run only at scheduler ticks, so each of the five waits can grow by up to
one scheduler interval. With the previous backoff (5, 20, 60, 180, 420 s, ±20 %) and a once-a-minute scheduler the sixth attempt
could come up to Σ 1.2·b + 5 × 60 s = 1,122 s after the first (1,020 s at maximum jitter on tick-aligned phases) — past the 900 s
body lifetime — so the message was neither attempted a sixth time nor dead-lettered: it would have expired as `SKIPPED /
EXPIRED_UNSENT` ("never attempted"). The earlier unit "proof" summed the jittered backoffs (822 s) and ignored scheduler
quantization; the local run passed by jitter luck, CI's did not.

Fix (retry count, jitter and the 15-minute privacy bound unchanged):
1. Backoff 5, 15, 45, 120, 300 s: worst case Σ 1.2·b + 5 × 60 s = 882 s ≤ 900 s, proven in closed form and by an exhaustive simulation
   over jitter 0–1 and every scheduler phase (`delivery.test.ts`; the old schedule fails both checks).
2. `nextRetryAt`: a transient failure whose next attempt could not be made within the body's lifetime, allowing one scheduler
   interval (a slower scheduler, a long retry-after), ends `DEAD` immediately.
3. An expired body that already failed transiently is recorded `DEAD` with its last provider error (delivery path and retention
   sweep); a body never attempted, or only held behind another, stays `SKIPPED / EXPIRED_UNSENT`.
4. A deterministic `random` seam (webhook and dispatch entry points); the PostgreSQL tests pin the jitter and cover minimum and
   maximum jitter with exact attempt times, exactly six provider calls, and DEAD vs SKIPPED when the scheduler stalls.
