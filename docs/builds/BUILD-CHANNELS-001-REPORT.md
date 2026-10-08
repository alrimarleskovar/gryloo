# BUILD-CHANNELS-001 — Report: FloFi Channel Core and a MOCKED WhatsApp adapter

Date: 2026-10-07. Branch `claude/build-channels-001`, on BUILD-DEVELOPER-001 Phase 2A (`1558dc0`, shared approval/handoff
generalization, migration `0006`). Status:
- not pushed, no PR, nothing merged or rebased;
- no WhatsApp Business number connected, no Meta webhook subscribed, no real message sent;
- no real or public-chain transaction: every execution ran on MOCKED loopback chains.

> A channel is an entry point into FloFi's shared engine with **zero financial authority**. A message such as "yes", "confirm"
> or "execute" authorizes nothing. A sender id is never a wallet. The only path to execution is FloFi's own: `/approve` → wallet
> proof → fresh simulation → Strategy Manifest Review → explicit approval → the owner's wallet signature → reconciliation.

| Evidence level | Result |
| --- | --- |
| Implemented | **yes**: Channel Core, the WhatsApp adapter (fixture provider), `/approve` integration, status ping, staged migration `0008` |
| MOCKED-tested | **yes**: unit, PostgreSQL, in-process journeys and one browser journey, all on loopback (§9) |
| Live-provider tested | **NOT DONE**: forbidden by owner decision D1; the adapter cannot be activated on a hosted deployment |
| Public-chain tested | **NOT DONE** |
| Production-ready | **NO** |

## 1. Commit sequence

| Commit | Content |
| --- | --- |
| `fc84a1e` | Plan, updated for the shared platform (owner decisions D1–D6) |
| `ede48d5` | Channel Core foundations: types, keys, configuration, store; staged migration `0008` |
| `2d6ae01` | Conversation, canonical strategy (parity with MCP/DApp), untrusted interpreter |
| `cbccfb1` | Channel Core service, platform approval (`CHANNEL_CONVERSATION`), transactional outbox delivery, status/notify, logging |
| `8488a8f` | MOCKED WhatsApp adapter, webhook route, channel approval surface (registered at `approval-surface.ts`) |
| `4904fd0` | Approval-side status ping (D5): server action, invisible client component, one line on `/approve` |
| `9c5ae53` | MOCKED end-to-end journeys (router bridge, lending composition) and channel boundaries |
| `4dbe5c3` | Browser journey: WhatsApp (fixture) → real route under `next start` → `/approve` → owner flow → notifications |
| `e1695b0` | Deterministic retention purge on every delivery (was sampled) |
| `169e9fb` | Tests: lost approval message withdrawn; cross-conversation isolation |
| (this commit) | Docs: this report, `deploy/WHATSAPP.md`, `ENVIRONMENT.md` §5d, `STATUS.md`, `SECURITY_MODEL.md` |

## 2. Final architecture

```
WhatsApp Cloud API (fixture-shaped)            future: Telegram adapter (§13)
  │ POST /api/channels/whatsapp  (X-Hub-Signature-256 over raw bytes, 4 MiB bound, D1 guard)
  ▼
src/channels/whatsapp  ── provider concerns only: verify · parse (BSUID-first) · render · transport (fixture | Graph, never live)
  │ InboundMessage / DeliveryUpdate                     ▲ ChannelReply (text, choices, ≤1 link)
  ▼                                                     │
src/channels/core  ── provider-neutral Channel Core
  ingest: secret → marker before storage · allowlist (content-free record otherwise) · sealed address + transient payload · dedupe
  drain (after the 200, next/server after()): fenced lease per conversation → decideTurn (local commands, zero-authority notice,
     exact grammar, then Copilot V2 as untrusted interpreter) → canonicalStrategy (inverse of the engine mapping + parity check)
     → revoke the replaced link → requestApproval (platform) → simulatePreview (platform, read-only) → commit state + outbox (1 tx)
  deliver: transactional outbox · outputSafe · window/TTL · ordered bounded retries · lost link ⇒ revoke + "send LINK"
  │
  ▼
src/platform  (BUILD-DEVELOPER-001, unchanged)
  composeWorkflowOrRefuse · simulatePreview · requestApproval · HandoffStore (mcp_handoffs, requester_kind CHANNEL_CONVERSATION)
  approvalLinkScheme('flofi_chs_') · assembleApprovalSurface (+ channel contributor) · approvalProgress / sharedRuns
  │
  ▼
FloFi /approve (unchanged UI + invisible <ChannelProgressPing/>)
  wallet proof (EIP-4361 / SIWS) → claim (intended-wallet rule) → existing proposal card → apply → the owner's unchanged flow
  → fresh simulation → Manifest Review → wallet signature → reconciliation / evidence
  └─ ping (server action, every 20 s while visible, model-free) → notifyChannelHandoff → outbox NOTIFICATION → the chat
```

## 3. Exact Channel Core surface (`apps/reference-dapp/src/channels/core`)

| Module | Exports |
| --- | --- |
| `types.ts` | `CHANNEL_ID`, `ChannelId`, `ChannelSubject`, `ChannelAddress`, `InboundContent`, `InboundMessage`, `DeliveryStatus`, `DeliveryUpdate`, `ReplyChoice`, `ChannelReply`, `SendResult`, **`ChannelAdapter`** `{channel, clientId, displayName, windowHours, choicesFit, send}` |
| `config.ts` | `readChannelCoreConfig`, `readChannelHandoffPolicy`, `channelPublicOrigin`, `sameSecret`, `ChannelCoreConfig`, `ChannelLanguage` |
| `crypto.ts` | `channelKeys` (HKDF per purpose), `keyedDigest`, `seal`/`open` (AES-256-GCM, AAD = tenant\|table\|row\|column), `sealContext`, `channelRowId`, `leaseToken` |
| `store.ts` / `pg-store.ts` | `ChannelStore` (`schemaInstalled`, `ensureConversation`, `conversation`, `storeAddress`, `recordEvents`, `acquire`, `nextEvent`, `completeTurn`, `release`, `claimDue`, `markSent`, `markRetry`, `markEnded`, `applyDelivery`, `enqueue`, `allow`, `purge`), `RETENTION`, `createPgChannelStore` |
| `strategy.ts` | `canonicalStrategy`, `strategyOfCommand`, `sameCommand`, `intendedWalletOf` |
| `conversation.ts` | `decideTurn`, `freshState`, `parseState`, `ChannelState`, `TurnDecision`, `ChannelInterpreter`, `MAX_STATE_BYTES` |
| `interpreter.ts` | `channelInterpreter` (the existing Copilot V2 boundary; the only Channel Core module that reaches the Copilot service) |
| `approval.ts` | `CHANNEL_APPROVAL_PREFIX`, `CHANNEL_HANDOFF_RULES`, `channelApprovalScheme`, `channelRequester`, `conversationScope`, `intendedWalletPolicy`, `createChannelApproval`, `revokeChannelApproval`, `channelApprovalProgress` |
| `service.ts` | `createChannelService` → `{ ingest, drain, deliver }`, `LIMITS`, `LEASE_SECONDS` |
| `delivery.ts` | `deliverConversation`, `outputSafe`, `sealReply`, `newOutboxId`, `addressContext`, `MAX_SEND_ATTEMPTS` |
| `notify.ts` / `status.ts` | `notifyChannelHandoff`; `statusReplies`, `plannedNotifications`, `ENDED` |
| `copy.ts`, `log.ts`, `state-language.ts` | EN/PT texts (`channelCopy`, `readyText`, `shorten`); `channelLogger` (allowlisted fields); `parseStateLanguage` |

Wiring outside Core (`src/channels/`): `registry.ts` (`readChannelDeployment`), `approval-profile.ts`
(`channelApprovalContributor`), `approval-ping.ts` (`pingChannelApproval`).

App files:
- `src/app/api/channels/whatsapp/route.ts`;
- `src/app/channel-approve-action.ts` (`'use server'`);
- `src/components/channel-progress-ping.tsx` (`'use client'`, renders nothing);
- one line in `src/app/approve/page.tsx`;
- one contributor line in `src/server/approval-surface.ts`.

## 4. Generic vs WhatsApp split (measured, non-test lines)

| Part | Lines | Share |
| --- | --- | --- |
| Channel Core (`src/channels/core`, 17 modules) | 1,487 | **79 %** |
| WhatsApp adapter (`src/channels/whatsapp`, 6 modules) | 395 | **21 %** |
| Wiring (`registry.ts`, `approval-profile.ts`, `approval-ping.ts`) + route/action/component | 101 + 75 | — |

Tests add 1,295 lines under `src/channels` plus the browser spec. The plan estimated a 75/25 split.

Untouched: `src/platform/**`, `src/mcp/**`, `src/engine/**`, the Copilot files, `approval-handoff.tsx`, shipped migrations and
`migrations.ts`, every `package.json` and the lockfile (no new dependency), and every UX-sensitive file (`app-shell.tsx`,
`workflow-canvas.tsx`, `copilot-panel.tsx`, `globals.css`, `summary-bar.tsx`, `artifact-inspector.tsx`). All have zero diff lines
against `1558dc0`.

## 5. Migration `0008` (staged)

`packages/cloud-runtime/migrations/0008_channel_conversations.sql` creates three tenant-scoped tables. They hold digests,
ciphertext and closed codes only, and have no reference to `mcp_handoffs`:

| Table | Holds | Minimization enforced by the database |
| --- | --- | --- |
| `channel_conversations` | keyed subject digest, status (ACTIVE/OPTED_OUT), sealed send address, sealed state (≤ 32 KiB), lease + fencing token, timestamps | `CHECK (status = 'ACTIVE' OR (address_ciphertext IS NULL AND state_ciphertext IS NULL))` |
| `channel_events` | keyed digest of the provider message id, outcome code, handoff id, transient sealed payload | `CHECK (status = 'PENDING' OR payload_ciphertext IS NULL)` |
| `channel_outbox` | dedupe key, kind (REPLY/APPROVAL/NOTIFICATION), sealed body (never a link), status, delivery, provider-id digest | `CHECK ((status IN ('PENDING','SENDING')) = (body_ciphertext IS NOT NULL))` |

Abuse counters reuse the existing generic `mcp_rate_limits` table under `channel:` / `handoff:conversation:` buckets; there is no
new counter table. The generic handoff schema is unchanged: no column, no table and no second approval implementation was added.
Why it is staged:
- `0007` is BUILD-DEVELOPER-001's and is not in this stack;
- the migration runner requires a gapless sequence.

Until `0007` lands, the tests and the Playwright global setup apply the file raw after the shipped migrations. Runtime code fails
closed with `503 CHANNEL_SCHEMA_NOT_INSTALLED` without it. **Owner/next-build action:** move it to `migrations/`, pin it in
`src/migrations.ts`, and remove the two raw applications.

## 6. Approval integration

- **Requester**: `{ kind: 'CHANNEL_CONVERSATION', id: <conversation id> }`, a first-class platform requester. No MCP account and no
  grant; `client_id` is `whatsapp:<phone number id>` and `client_name` is `WhatsApp`. `requester_context` is `{ intendedWallet }`
  when the strategy names an address (D3).
- **Scheme**: `flofi_chs_` + 43 base64url characters, keyed by HKDF(`FLOFI_CHANNEL_SECRET`, `approval`), resolving only
  `CHANNEL_CONVERSATION` rows. An MCP `flofi_hs_` link cannot resolve a channel handoff (tested); the platform's scheme kinds keep
  each surface to its own rows.
- **Rules**: `{ handoffSeconds: 900, maxPending: 3, rate: [20, 3600], supersedeSameWorkflow: false }`. Every new strategy,
  correction, `NEW`/`CANCEL`, `LINK` and `STOP` revokes the live handoff first (`revokeForRequester`), so old links show
  REVOKED on `/approve`.
- **Claim policy** (`intendedWalletPolicy`): the platform's wallet proof stays mandatory, and the claimant must also equal
  `intendedWallet` when one exists, else `CHANNEL_INTENDED_WALLET_MISMATCH`. Status sharing defaults off for channel requesters.
- **Surface**: `channelApprovalContributor(env)` is registered at `src/server/approval-surface.ts` (the documented extension
  point). It is enabled only when Channel Core and an adapter are active, so never on a hosted deployment in this build.
- **Link transport**: the URL fragment only. The link exists in the memory of the turn that created it. The approval message is
  sent once; if it cannot be sent, the next turn revokes the handoff and asks the user to send `LINK`. It is never re-minted
  outside a turn, never stored and never logged.
- **Status**: `STATUS` uses `approvalProgress`. Runs are visible only while the owner shares them, and only as public facts
  (status, reconciled, evidence environment/outcome, shortened bundle hash; never a wallet, run id, transaction, calldata or
  signature).
- **Ping (D5)**: `/approve` pings every 20 s while visible (30 min cap). The server requires a `flofi_chs_` secret, the claimant's
  own proven wallet session, the owner's share choice and a per-handoff rate (12/min). Notifications ("loaded in FloFi", one per
  terminal run) are keyed, so each is sent once. There is no scheduler. A failed send is only a failed message: execution,
  reconciliation and evidence never wait on or depend on it.

## 7. Configuration

All server-only; see [ENVIRONMENT.md §5d](../deploy/ENVIRONMENT.md) and [WHATSAPP.md](../deploy/WHATSAPP.md).

| Group | Variables |
| --- | --- |
| Channel Core | `FLOFI_CHANNEL_SECRET`, `FLOFI_PUBLIC_ORIGIN`, `FLOFI_CHANNEL_SUPPORT_CONTACT`, `FLOFI_CHANNEL_PRIVACY_URL`, `FLOFI_CHANNEL_COPILOT`, `FLOFI_CHANNEL_SIMULATION`, `FLOFI_CHANNEL_LANGUAGE`, `FLOFI_CHANNEL_HANDOFF_TEST_FUNDS`, `FLOFI_CHANNEL_HANDOFF_MAINNET_NETWORKS` |
| WhatsApp | `FLOFI_WHATSAPP`, `FLOFI_WHATSAPP_PROVIDER` (`fixture` only), `FLOFI_WHATSAPP_ALLOWED_SENDERS`, `WHATSAPP_APP_SECRET` (+`_PREVIOUS`), `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_GRAPH_API_VERSION` (validated, unused) |
| Browser test only | `GRYLOO_CHANNEL_E2E=FIXTURE_LOOPBACK_ONLY` (with `GRYLOO_MCP_E2E`); per-run `FLOFI_E2E_*` secrets generated in `playwright.config.ts` |

Every invalid value disables the channel (fail closed). `FLOFI_CHANNEL_SECRET` is refused if it equals `API_AUTH_TOKEN`,
`FLOFI_SESSION_SECRET`, `FLOFI_MCP_OAUTH_SECRET` or any provider secret.

## 8. Data minimization (as implemented)

| Data | Stored as | Lifetime |
| --- | --- | --- |
| Inbound text | AES-256-GCM transient payload | erased in the transaction that records the turn's outcome; a crashed turn's payload is erased (`EXPIRED_UNPROCESSED`) by the next delivery after 15 min, never processed late |
| Keys / seed phrases | **never stored when detected** (FloFi's existing `looksSecret` check): replaced by a `SECRET` marker before anything is written; the reply says it already reached the messaging provider. An undetected one would live only as a transient encrypted payload | — |
| Senders outside the allowlist | a content-free event record (digest + `IGNORED_NOT_ALLOWLISTED`), no conversation | 8 days |
| Conversation state | AES-256-GCM, ≤ 32 KiB | erased after 30 min idle and on `STOP`; reset (pending proposal and drafts dropped) on `NEW` |
| Send address | AES-256-GCM | 24 h after the last inbound message; erased at once on `STOP` |
| Outbound body | AES-256-GCM, approval rows without the link | erased at every terminal state (DB CHECK); never sent after 15 min |
| Records | digests, closed codes, timestamps, handoff id | 8 days; idle conversations deleted after 7 days (opted-out digest kept) |
| Approval secret | memory of one turn; the platform stores its digest | — |
| Logs | allowlisted fields, closed codes, opaque ids | platform retention |

Tests scan every channel table and the captured logs for message text, sender ids, phone numbers, wallet addresses, links,
secrets and run ids.

## 9. Tests and gates

**New tests** (all pass):

| Suite | File | Tests |
| --- | --- | --- |
| Unit | `core/strategy.test.ts` (parity over every capability example) | 24 |
| Unit | `core/conversation.test.ts` | 11 |
| Unit | `core/config.test.ts` | 5 |
| Unit | `whatsapp/webhook.test.ts` | 7 |
| Unit | `whatsapp/render.test.ts` | 6 |
| Unit | `whatsapp/config.test.ts` | 4 |
| Unit | `boundaries.test.ts` | 5 |
| PostgreSQL | `core/store.pg.test.ts` | 10 |
| PostgreSQL | `whatsapp/channel.pg.test.ts` (through the HTTP handler) | 12 |
| PostgreSQL | `whatsapp/journey.pg.test.ts` (MOCKED E2E) | 2 |
| Browser | `e2e/whatsapp-approve.spec.ts` | 1 |
| **Total** | 62 unit + 24 PostgreSQL + 1 browser | **87** |

**MOCKED end-to-end results**

1. **Bridge, testnet router** (`journey.pg.test.ts`, loopback Base Sepolia/Arbitrum Sepolia):
   - a signed webhook leads to the exact command and a `CHANNEL_CONVERSATION` approval;
   - "yes, execute it" changes nothing;
   - the wallet-proven claim (sharing on) is followed by apply, then the owner's unchanged flow: simulate, Review, two wallet
     transactions, `RECONCILED`;
   - the ping delivers "loaded in FloFi", then "Execution reconciled ✅ · evidence: MOCKED · outcome: RECONCILED · bundle 0x…·…",
     once; `STATUS` repeats it;
   - the only sends are the owner's 2 transactions.

   **PASS.**
2. **Lending composition** (`journey.pg.test.ts`, MOCKED lending chain):
   - the natural-language request goes through the scripted untrusted interpreter, which asks for the owner address;
   - the approval is bound to that intended wallet, and another wallet is refused;
   - five owner-submitted steps (pool approval, supply, borrow, router approval, swap) reach `COMPLETED` / `RECONCILED`;
   - the same notifications follow;
   - exactly 2 interpreter calls and 5 transactions.

   **PASS.**
3. **Browser** (`whatsapp-approve.spec.ts`, `next start`, embedded loopback PostgreSQL, MOCKED lending chain):
   - the real route: GET verification, forged delivery 401, signed delivery 200 with the turn run after the response;
   - `LINK` captures a fresh link and the first is withdrawn;
   - `/approve` shows "FROM WHATSAPP", nothing authorized and sharing off by default;
   - a stranger's proven wallet is refused (`CHANNEL_INTENDED_WALLET_MISMATCH`);
   - the owner proves, opts in, loads and applies;
   - the five wallet-signed steps reach MOCKED / RECONCILED;
   - "loaded" and "reconciled" notifications are SENT once each with their bodies erased;
   - no off-origin browser request and no page error.

   **PASS (30 s).**

**Gates** (local, pinned toolchain Node 24.21.0 / pnpm 11.22.0):

| Gate | Result |
| --- | --- |
| `pnpm check` (typecheck, lint, build, schema drift, unit tests) | **pass**: 213 files, 1,986 tests passed, 2 skipped |
| `pnpm test:postgres` (loopback PostgreSQL) | **pass**: 25 files, 156 tests |
| `mcp-in-chat.spec.ts` (regression for `/approve`) | **pass**: 5/5 |
| `whatsapp-approve.spec.ts` | **pass**: 1/1 |
| `python3 scripts/governance_lite.py` + its unittest suite (on a `git archive` export) | **pass**: 1,101 text files; 17/17 unit tests |

| Bidi controls, trailing whitespace, CRLF, missing EOL over all 54 changed files; `git diff --check` | **clean** |

The 2 skipped unit tests are earlier builds' `it.skipIf` cases (`mode-b-service.test.ts`, `composition-service.test.ts`), which
need BUILD-007 pinned inputs. They are not this build's tests, and nothing in this build is skipped. The code gates ran on the
final code; this docs commit changes no code. Governance-lite ran on an export identical to this commit's tree. The browser
specs ran locally on port 3100, with the pinned headless shell and loopback PostgreSQL; CI runs the new spec after
`mcp-in-chat.spec.ts`.

## 10. Changes and decisions for owner review

1. **The intended wallet follows D3 literally.** When a strategy names an owner, beneficiary or recipient, only that wallet may
   claim. This includes a bridge with an explicit recipient and a supply "on behalf of" another address. For those, the owner's own
   wallet is refused, which is stricter and fail-closed, not unsafe. Binding the owner at claim time instead (D3's deferred
   alternative) would let "bridge to a friend" work from a chat. **Owner decision.**
2. **Chained confirmations** ("yes, execute it", "sim, pode executar agora") now get the zero-authority notice. Before, they got
   "could not read". Either way they never had an effect; the journey test surfaced this.
3. **Retention purge** runs on every authenticated delivery instead of a 10 % sample, so the plan's "erased on the next channel
   activity" holds on quiet channels.
4. **Files beyond the plan's list:**
   - `core/delivery.ts` and `core/state-language.ts`, which keep the notify path model-free;
   - `approval-profile.ts` and `approval-ping.ts` at `src/channels/` rather than in Core, because they read the registry;
   - for the browser spec: `e2e/channel-constants.ts`, `playwright.config.ts` (the `GRYLOO_CHANNEL_E2E` flag) and
     `e2e/cloud-runtime-setup.ts` (applies the staged migration only under that flag).
5. **`/approve` copy** is generic and unchanged (UX isolation): it says "Proposed with an AI assistant from your conversation"
   even for an exact command, and shows the closed code `CHANNEL_INTENDED_WALLET_MISMATCH` the way it shows MCP's codes. Friendlier
   texts are a follow-up for the UX owner.

## 11. Remaining policy and live-provider blockers

- **WhatsApp policy (D1)**: the Business Messaging Policy §4 prohibits facilitating the exchange of "Real, virtual, or fake
  currency". Live use needs written Meta clearance or counsel's opinion. Until then the adapter is dormant by code: hosted gives
  404, `live` gives 503.
- **Regulatory**: FloFi's classification for chat-originated DeFi proposals needs legal review before any live or mainnet use.
- **Provider setup** (owner, after clearance): Meta app, WABA, verified number, system-user token and app secret in the secret
  store, webhook subscription, published privacy policy and support contact, allowlist digests.
- **Code**: a reviewed change lifting the D1 guard for one named deployment and enabling the existing Graph transport; outbound
  templates for messages outside the 24 h window (none in this build); migration `0008` shipped after `0007`.
- **Live Copilot**: channel natural language uses the existing Copilot boundary. It was exercised with scripted/replayed
  answers only; no live model call was made.

## 12. Wallet and mobile limitations

- Links from WhatsApp open in the phone's default browser, which has no injected wallet. The owner must open FloFi in a wallet's
  in-app browser, or on a desktop with an extension. The fragment survives copying, but the link works once for 15 minutes;
  `LINK` gives a fresh one.
- Push status exists only while `/approve` stays open and visible after the owner opted in (no scheduler, D5). Otherwise
  `STATUS` is pull-only.
- No deep links into specific wallets, and no WalletConnect pairing from the chat.

## 13. Exact work for Telegram (first potentially live adapter)

Policy first:
- a plain bot without a Mini App (Telegram's blockchain guidelines apply to Mini Apps);
- the owner's legal review of Bot Platform Developer Terms §5.2(h) ("regulated or questionable goods and services").

Code:
1. `src/channels/telegram/{config,webhook,render,transport,adapter,handler}.ts` + `src/app/api/channels/telegram/route.ts`:
   - authentication by `X-Telegram-Bot-Api-Secret-Token` (constant-time);
   - dedupe on `update_id`;
   - private chats only;
   - `message.text` → TEXT, `callback_query` → CHOICE;
   - `sendMessage` with an inline keyboard (callback buttons + one URL button for the link);
   - `windowHours: null`;
   - `/start` as opt-in, `/stop` and `my_chat_member` blocks as opt-out;
   - an allowlist of user-id digests;
   - a fixture transport and a Bot API transport.
2. No type or SQL change for the new id: `CHANNEL_ID` and the `0008` `channel` CHECK are patterns (`^[A-Z][A-Z0-9_]{1,31}$`).
3. `registry.ts` reads each adapter's config and returns `{ core, adapters }` instead of the WhatsApp field.
   `approval-ping.ts` and `notify` choose the adapter by the conversation's channel instead of constructing the WhatsApp adapter.
   This is the only Core/wiring change: about 40 lines.
4. Tests mirroring `whatsapp/*.test.ts` and one journey. Channel Core's conversation, strategy, approval, delivery, status and
   retention are reused unchanged.

Live: a @BotFather bot, the webhook secret, allowlisted ids, policy sign-off, and a reviewed guard-lifting change.

## 14. Not yet done

- Any live provider, any hosted deployment of the channel, any real message.
- Shipping `0008` (blocked on `0007`).
- Outbound templates (messages outside the 24 h window).
- Binding the owner at claim time instead of the typed intended wallet (D3 alternative).
- Friendlier `/approve` copy for channel proposals (UX owner).
- A live-model acceptance of channel natural language.
