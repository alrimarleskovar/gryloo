# BUILD-CHANNELS-001 — Plan: FloFi Channel Core and a MOCKED WhatsApp adapter

Date: 2026-10-07. Branch `claude/build-channels-001` (worktree `~/projects/flofi-channels`). The branch was fast-forwarded by the
owner onto the shared platform:

- `819c197`: BUILD-DEVELOPER-001 Phase 1, the `src/platform` extraction;
- `1558dc0`: Phase 2A, the generic approval/handoff model and migration `0006_approval_requesters`.

Both sit on BUILD-MCP-002 (`8f9650a`), itself stacked on BUILD-MCP-001 (PR #63, open). Nothing is merged or rebased by this build,
and MCP-001/MCP-002/Developer-001 history is not rewritten.

**Status: approved by the owner on 2026-10-07 (decisions D1–D6, coordination, data minimization); implementation proceeds in
reviewable commits after this plan.**

> **Framing.** WhatsApp / future channel → FloFi Channel Adapter → Channel Core → shared FloFi platform (`src/platform`) → simulation
> → trusted approval handoff → FloFi `/approve` → wallet ownership → fresh simulation → Strategy Manifest Review → explicit wallet
> signature → execution → reconciliation/evidence.
>
> **The channel has zero financial authority.** A channel sender ID is not a wallet identity. A channel message ("yes", "confirm",
> "execute", "sim", "confirmo") authorizes nothing, and neither does an approval link. Only the owner's own wallet authorizes
> execution, inside FloFi. No channel, FloFi server or model holds a key, signs or submits. This is never described as trading
> through WhatsApp.

## 0. Owner decisions and coordination

| # | Decision | Consequence |
| --- | --- | --- |
| D1 | **MOCKED evidence only; the real WhatsApp provider stays disabled.** The WhatsApp Business Messaging Policy (last updated 2026-09-23, §4) prohibits using WhatsApp for Business for "buying, selling, promoting, or otherwise facilitating the exchange of" "Real, virtual, or fake currency". | No live number, no real message, no Meta webhook in any deployed environment, no live or production claim. Code-level activation guard (§3.3). Goals: a production-quality reusable Channel Core; a Cloud API-shaped WhatsApp adapter built against fixtures; the whole architecture proven within policy; a cheap later Telegram or other permitted adapter (§11). |
| D2 | **Approval link with safeguards, on the shared approval model.** | The channel registers its own approval-link scheme (`flofi_chs_`), keyed by HKDF of `FLOFI_CHANNEL_SECRET`. The secret lives only in the URL fragment and is stored only as its HMAC digest (platform). It grants view/claim only, with a bounded TTL. The channel never logs it or persists it (it exists in memory between minting and the single send). It is revoked whenever the pending proposal is materially replaced. A claim still needs wallet proof, then fresh simulation, Manifest Review and the owner's signatures. |
| D3 | **Public wallet address in chat (MVP).** | When a StrategySpec needs an owner, beneficiary or recipient, the channel may ask for the public address. It is strategy input only, recorded as the handoff's `context.intendedWallet`. The channel's claim policy then accepts only that wallet at claim; ownership is proven solely in FloFi. Binding the owner only at claim time is deferred. |
| D4 | **Copilot as an untrusted interpreter** (`store: false`). | Exact grammar first; strict schema validation; canonical grounding; no model authority. Exact-command mode stays available (`FLOFI_CHANNEL_COPILOT=disabled`). |
| D5 | **Status: explicit `status` plus a FloFi-side ping while `/approve` is active. No scheduled sweep.** | Channel delivery never blocks or changes FloFi execution, reconciliation or evidence. |
| D6 | **Default-deny sender allowlist.** | A sender ID is never a wallet identity. |

**Shared platform (owned by BUILD-DEVELOPER-001), consumed as is:**

- Composition, validation and review: `composeWorkflowOrRefuse`, `validateStrategy`, `reviewWorkflow`.
- Preview: `simulatePreview`, with the one shared concurrency cap.
- Approvals: `requestApproval`, `approvalForRequester`, `approvalProgress`, `approvalStatus`, `verifyHandoff`.
- The handoff store `createPgHandoffStore`, including `revokeForRequester`.
- Link schemes: `approvalLinkScheme`, `resolveApprovalSecret`.
- The `/approve` surface: `assembleApprovalSurface`, contributor profiles with `claimPolicy`, and the views in `approve.ts`.
- Runtime and identifiers: `deploymentEngineRuntime`, `newId`.

None of the engine logic that lived in `src/mcp/tools.ts` is recreated.

**Requester:** `ApprovalRequester.kind = 'CHANNEL_CONVERSATION'`.

- `ref` is the conversation ID `chc_<26 base32>` (fits `REQUESTER_REF`).
- `clientId` is `whatsapp:<phone_number_id>`; `displayName` is `WhatsApp`.
- `context` is `{ intendedWallet }` when the strategy names an address.

A conversation is a first-class requester, never an MCP account: there is no account, grant, `channel` column, parallel handoff
table or second approval implementation.

**Migrations:** `0006` belongs to the shared approval generalization, `0007` to BUILD-DEVELOPER-001 and **`0008` to this build**.
`0008` holds only channel persistence and does not alter the generic handoff schema (§5).

**Data minimization:**

- No raw message is kept beyond processing. Deduplication and audit keep content-free records: the keyed digest of the provider
  message ID, an outcome code, timestamps, the handoff ID.
- Transient content is encrypted and erased aggressively; the database enforces the erasure (§3.10).

## 1. Scope

**In:**

- The generic Channel Core (`src/channels/core`).
- The channel approval contributor for `/approve`.
- A Cloud API-shaped WhatsApp adapter against fixtures (`src/channels/whatsapp`).
- The `/approve` status ping (D5).
- Migration `0008` content.
- MOCKED journeys, tests, docs and the report.

**Out:**

- Any live provider, deployed webhook or real message.
- Templates or business-initiated messages.
- A scheduled sweep.
- Media, voice and group interpretation.
- Owner-bound-at-claim.
- Wallet deep links in messages; WalletConnect.
- Telegram, Discord and Slack adapters.
- The general sequential multi-step runner.
- Mainnet enablement.
- UI redesign.

## 2. Platform and policy verification (checked 2026-10-07)

| Source | Finding | Effect |
| --- | --- | --- |
| [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/) (last updated 2026-09-23) | §4 prohibition quoted in D1, "irrespective of the global or local licenses". §5 exceptions: gambling, OTC drugs and alcohol only. §2: free-form replies only inside the 24 h customer service window; automation needs "prompt, clear, and direct escalation paths". §1: opt-in and opt-out. §3: "Don't share or ask people to share … financial account numbers …". §7: bans may cover "all future use". | D1. The escalation path, opt-out, privacy notice and window rules are built in, so a future cleared activation needs no redesign. |
| [Meta Terms for WhatsApp Business Platform](https://www.facebook.com/legal/Meta-Terms-for-WhatsApp-Business-Platform) §4.7 (last modified 2026-09-23) | "AI Providers" are barred when AI is "the primary (rather than incidental or ancillary) functionality". Platform data must not "create, develop, train, or improve" AI models. | The interpreter is incidental. `store: false`; an OpenAI data-sharing opt-out is a prerequisite for any future activation. |
| [Webhook endpoint](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint), [getting started](https://developers.facebook.com/docs/graph-api/webhooks/getting-started) | `GET` verification (`hub.mode`, `hub.challenge`, `hub.verify_token`). `X-Hub-Signature-256` = HMAC-SHA256 of the payload with the app secret. Retries over 7 days; "handle deduplication". Batches of ≤ 1000 updates. Optional mTLS. | Constant-time checks; HMAC over the exact raw bytes before parsing; content-free dedupe for 8 days; signature only (no mTLS on Vercel). |
| [Business-scoped user IDs](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids) | BSUIDs since April 2026 (`contacts[].user_id`, `messages[].from_user_id`). Phone numbers may be absent. Send with `"recipient": "<BSUID>"` (since July 2026). | Identity keyed on the BSUID (fallback `from`), stored as a keyed digest plus an encrypted send address. |
| [Messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages), [buttons](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages), [CTA URL](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-cta-url-messages), [statuses](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status), [errors](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes), [Graph v26.0](https://developers.facebook.com/docs/graph-api/changelog/version26.0) | `POST /<PHONE_NUMBER_ID>/messages`. ≤ 3 reply buttons (label ≤ 20, id ≤ 256, body ≤ 1024). A CTA URL opens in the default browser. `biz_opaque_callback_data` echoed in statuses (≤ 512). Error 368 = policy restriction. v26.0 released 2026-07-29. | Renderer limits and fallbacks; outbox correlation; pinned API version; closed error classes. |

## 3. Architecture

### 3.1 Layers

```
provider adapter (src/channels/whatsapp)        Channel Core (src/channels/core)                 shared platform (src/platform)
  webhook verify · signature · normalize   ──►   ingest · dedupe · lease · conversation   ──►   compose · review · simulatePreview
  BSUID identity · render · transport      ◄──   strategy · approval · status · outbox          requestApproval · revokeForRequester
                                                 identity · crypto · store (0008)               approvalProgress · handoff store
                                                 approval contributor (/approve) ──────────►    /approve surface (claimPolicy)
```

**Import rules** (a test enforces them):

- Channel Core imports `src/platform`, `src/engine` (contracts), `src/domain` (Copilot conversation engine, exact grammar, editor
  initial state) and `src/server/copilot-service.ts` (the interpreter boundary), plus `src/server` deployment helpers. It **never**
  imports `src/mcp/**`.
- The WhatsApp adapter imports Channel Core types only, never the platform.
- `notify.ts`, the claim policy, the approval contributor and the ping action import no interpreter, so `/approve` never loads a model
  client.

### 3.2 Channel Core surface

```ts
type ChannelId = string;                                   // 'WHATSAPP' (pattern ^[A-Z][A-Z0-9_]{1,31}$)
type ChannelSubject = { business: string; user: string };  // provider ids, never logged, stored only digested/encrypted
type InboundMessage = { channel; eventId; subject; sendTo; sentAt; content: TEXT | CHOICE | UNSUPPORTED };
type DeliveryUpdate = { channel; correlationId | null; providerMessageId; status: SENT | DELIVERED | READ | FAILED; errorCode | null };
type ChannelReply = { text; choices: { id; label }[]; link: { label; url } | null };
interface ChannelAdapter { channel; clientId; displayName; windowHours | null; limits; send(to, reply, correlationId) }
```

`ChannelService` (one per request) exposes:

- `ingest(adapter, messages, deliveries)`;
- `drain(adapter, conversationId)`;
- `deliver(adapter, conversationId)`;
- `notifyHandoff(handoff)` (the model-free path used by the ping).

Everything else (conversation, strategy, approval, status, copy, crypto, store) is internal to the core.

### 3.3 WhatsApp adapter and activation guard (D1)

- **Guard.**
  - `FLOFI_WHATSAPP=enabled` is required (otherwise 404).
  - **Any hosted deployment answers 404 `CHANNEL_PROVIDER_NOT_ACTIVATED` regardless of variables.**
  - `FLOFI_WHATSAPP_PROVIDER` accepts only `fixture` (replies are rendered, guarded and handed to a recording transport, never sent);
    `live` → `WHATSAPP_LIVE_PROVIDER_NOT_CLEARED`.
  - The Graph HTTPS transport is implemented and unit-tested against a fake `fetch` only; no runtime path reaches Meta.
  - Lifting the guard is a separate reviewed change after written policy clearance.
- **`GET`:** constant-time `hub.verify_token`; echo `hub.challenge` only if it matches `^[A-Za-z0-9_-]{1,128}$`.
- **`POST`**, in order:
  1. Raw body ≤ 4 MiB, `application/json`.
  2. `X-Hub-Signature-256` (strict `sha256=<64 hex>`): HMAC-SHA256 under `WHATSAPP_APP_SECRET` (and optional `_PREVIOUS`), compared
     with `timingSafeEqual` **before parsing**. A failure → 401.
  3. Strict payload checks: `object`, `entry[].id` = WABA ID, `field === 'messages'`, `metadata.phone_number_id`. A mismatch is
     ignored with 200.
  4. Normalize: `text` → TEXT; `interactive.button_reply` / `list_reply` → CHOICE; other types → UNSUPPORTED; reactions, system and
     group messages are ignored; `statuses` → DeliveryUpdate.
  5. Persist content-free event records plus transient encrypted payloads, reply 200, then `after()` drains.
- Senders outside the allowlist are recorded content-free (IGNORED) with no conversation row and no reply.

### 3.4 Conversation turn

**Lease.** Per conversation, with a fencing token and a 300 s lease (the route's `maxDuration`):

- events are processed oldest-first by provider timestamp;
- a writer acquires after committing its insert;
- release happens only when no event is pending.

**Steps for one event:**

1. **Opt-out and age.** An opted-out conversation answers only START/VOLTAR. Messages older than 15 min are not interpreted (resend
   copy).
2. **Local commands** (EN/PT, no model): HELP/AJUDA (capabilities, zero authority, `FLOFI_CHANNEL_SUPPORT_CONTACT`,
   `FLOFI_CHANNEL_PRIVACY_URL`, opt-out), STATUS/ESTADO, NEW/NOVO/CANCEL/CANCELAR, LINK, STOP/PARAR/SAIR.
3. **Secret refusal at ingest** (`looksSecret`). The text is never written to the database, transcript or model; channel copy explains
   that the message already crossed the provider and that the key should be treated as compromised.
4. **Authorization words** ("yes", "confirm", "execute", "approve", "sign", "go", "sim", "confirmo", "executar", "aprovar", "assinar")
   that answer no open FloFi question get a deterministic zero-authority notice. No state changes.
5. **Exact grammar first** (`parseLocalCommand` on the initial editor state, no default beneficiary). Only
   `COPILOT_AUTHORING_COMMANDS` are accepted.
6. **Copilot V2.**
   - Environment `{ workflow: BASE, context: dappReviewContext(), wallet: null, pending: <channel's authoring command> }`.
   - Corrections of the pending proposal are revisions (the DApp's own behaviour); an ambiguous "it" asks "which step?"; missing
     addresses are asked for (D3).
   - The interpreter is built from `copilot-service.ts` exports with the shared per-process limiter.
7. **State codec.** Encrypted, ≤ 32 KiB, erased after 30 min idle. Drafts reference BASE/PENDING by marker and are rehydrated to the
   live objects the engine compares by identity.

### 3.5 Strategy and parity

`strategyOfCommand` maps the twelve `COPILOT_AUTHORING_COMMANDS` to StrategySpec v1. **Guard:** `composeWorkflowOrRefuse(spec)` must
return a command deep-equal to the pending one, which yields the same IR and the same workflow hash as MCP and the Developer API;
otherwise `CHANNEL_STRATEGY_PARITY_FAILED` and no handoff.

### 3.6 Approval (D2, D3)

- `requestApproval(deps, requester, spec, hash)` with the channel scheme, the shared handoff store, the channel limiter, the
  deployment runtime and the channel policy (`FLOFI_CHANNEL_HANDOFF_TEST_FUNDS`, `FLOFI_CHANNEL_HANDOFF_MAINNET_NETWORKS`; mainnet
  empty by default).
- Rules: `{ handoffSeconds: 900, maxPending: 3, rate: [20, 3600], supersedeSameWorkflow: false }`.
- Every new strategy, correction, NEW/CANCEL or LINK first calls `revokeForRequester` on the live handoff, so old links show REVOKED.
- The `/approve` contributor (`channelApprovalContributor`) is registered in `src/server/approval-surface.ts`, the designated
  extension point:
  - the `flofi_chs_` scheme;
  - the `CHANNEL_CONVERSATION` profile with the channel policy;
  - a `claimPolicy` refusing any wallet other than `context.intendedWallet` (`CHANNEL_INTENDED_WALLET_MISMATCH`).

  It is enabled only when Channel Core and at least one channel adapter are active, so in this build it is never enabled on a hosted
  deployment.
- `/approve` is otherwise unchanged: it already accepts any approval scheme, shows "proposed via WhatsApp" from `displayName`, and
  defaults status sharing off for channel requesters.

### 3.7 Preview

`simulatePreview(runtime, { strategy, workflowHash, simulationSubject }, { budget })` runs only when the subject is known:
`intendedWallet` for EVM plans, any value for `NONE` plans. Bounds: 60 s, 10 per conversation per hour, the shared cap. The reply gives
pass/fail and provenance (for example MOCKED) and says FloFi re-simulates before Review.

### 3.8 Outbound (transactional outbox)

- Rows are written in the turn's transaction. Dedupe keys: `reply:<event>:<n>`, `notify:<handoff>:<state>`,
  `notify:<handoff>:<run>:<state>`.
- States: PENDING → SENDING → SENT | FAILED | SKIPPED.
- Approval rows never store the link: it is attached in memory at send time. A retry in another process re-mints (revoke + new
  handoff).
- `biz_opaque_callback_data` = outbox ID; status webhooks advance delivery monotonically.
- Retries (≤ 5) only for transient errors, on the next delivery or ping (no sweep).
- An output guard checks every text (no long hex or base64, no `flofi_(at|rt|code|csrf)_`, no `Bearer`; the approval link only as the
  link).

### 3.9 Status (D5)

1. **`status`.** `approvalForRequester` + `approvalProgress` give the approval state and, when shared, run IDs, status, evidence
   environment, outcome and bundle hash. Never transaction data or the claimant's address.
2. **Ping.**
   - An invisible `channel-progress-ping.tsx`, rendered by `/approve`'s `page.tsx` (one line), calls `channelApprovalPing(secret)` in
     its own server-action file.
   - Non-channel links stop at once.
   - For channel handoffs it requires the claimant's wallet session, CLAIMED or APPLIED state and sharing on. It runs `notifyHandoff`
     every ~20 s while visible (≤ 30 min, until terminal).
   - Failures are swallowed as codes, and reconciliation never depends on them.
   - `approval-handoff.tsx` is not edited.

### 3.10 Data minimization and retention (enforced by `0008` CHECK constraints where possible)

| Data | Stored as | Lifetime |
| --- | --- | --- |
| Inbound text | AES-256-GCM transient ciphertext | erased in the transaction that records the outcome (DB CHECK: only PENDING events may hold a payload); never processed after 15 min; stranded payloads erased on the next channel activity (no scheduler) |
| Dedupe / audit | keyed digest of the provider message ID, outcome code, timestamps, handoff ID — no content | 8 days |
| Conversation state | AES-256-GCM, ≤ 32 KiB | erased after 30 min idle, on NEW/STOP |
| Send address | AES-256-GCM | erased 24 h after the last inbound message; record deleted after 7 days idle unless opted out (digest + status kept to honour the opt-out) |
| Outbound body | AES-256-GCM (approval rows never contain the link) | erased when terminal (DB CHECK); never sent after 15 min |
| Outbound metadata | status, dedupe key, provider message digest, error code | 8 days |
| Approval secret | memory only (platform stores its digest) | — |
| Logs | allowlisted, content-free fields | platform retention |

Keys are HKDF-SHA256 of `FLOFI_CHANNEL_SECRET`, one label per purpose; AAD binds tenant, table and row.

### 3.11 Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `FLOFI_CHANNEL_SECRET` | — | ≥ 32 chars; refused if equal to `API_AUTH_TOKEN`, `FLOFI_SESSION_SECRET`, `FLOFI_MCP_OAUTH_SECRET` or a provider secret |
| `FLOFI_PUBLIC_ORIGIN` | — | existing; approval link origin |
| `FLOFI_CHANNEL_SUPPORT_CONTACT`, `FLOFI_CHANNEL_PRIVACY_URL` | — | required: human escalation path and privacy policy |
| `FLOFI_CHANNEL_COPILOT`, `FLOFI_CHANNEL_SIMULATION`, `FLOFI_CHANNEL_LANGUAGE` | `enabled`, `enabled`, `EN` | interpreter, preview, default language |
| `FLOFI_CHANNEL_HANDOFF_TEST_FUNDS`, `FLOFI_CHANNEL_HANDOFF_MAINNET_NETWORKS` | `enabled`, empty | channel handoff policy |
| `FLOFI_WHATSAPP`, `FLOFI_WHATSAPP_PROVIDER`, `FLOFI_WHATSAPP_ALLOWED_SENDERS` | off, `fixture`, empty (deny all) | adapter switch, provider, allowlist (SHA-256 hex of the BSUID or phone digits) |
| `WHATSAPP_APP_SECRET` (+ `_PREVIOUS`), `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID` | — | signature, verification, payload matching |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_GRAPH_API_VERSION` | — | future live transport only (unreachable in this build) |

### 3.12 Security boundaries

The channel can never:

- accept, store or forward keys or seed phrases;
- sign, submit, claim or apply;
- read or create wallet sessions;
- treat a sender ID or typed address as ownership;
- treat a message as authorization;
- read unshared runs;
- emit calldata, transactions, signatures, tokens, cookies or link secrets outside the one link;
- initiate a conversation or message outside its window.

Threats and mitigations:

| Threat | Mitigation |
| --- | --- |
| Forged or replayed delivery | raw-bytes HMAC before parsing; content-free dedupe; 15-minute interpretation limit |
| Duplicates and misordering | lease with fencing; outbox dedupe keys; nothing in the channel can authorize |
| Prompt injection | untrusted interpreter; values grounded in the user's own text |
| Phishing with a genuine link | view/claim scope, TTL, single claim, revocation, intended-wallet claim policy, `/approve` banner and Manifest |
| A leaked secret | refusal before storage |
| Data exposure | §3.10, plus tests over logs and database rows |

## 4. Platform consumption (exact)

| Need | Platform function |
| --- | --- |
| Canonical composition and parity | `composeWorkflowOrRefuse` (`platform/strategy.ts`) |
| Preview | `simulatePreview` (`platform/preview.ts`) |
| Approval creation | `requestApproval`, `ApprovalDeps`, `HandoffRules`, `WindowLimit` (`platform/approvals.ts`) |
| Revocation | `HandoffStore.revokeForRequester` (`platform/handoff-store.ts`) |
| Status | `approvalForRequester`, `approvalProgress` |
| Links and `/approve` | `approvalLinkScheme`, `resolveApprovalSecret` (`platform/approval-links.ts`); `ApprovalContributor`, `ClaimPolicy` (`platform/approve.ts`) |
| Runtime | `deploymentEngineRuntime`, `embeddedEngineRuntime`; IDs `newId` |
| Requester kind | `CHANNEL_CONVERSATION` (migration `0006`, no change) |

Only one platform-owned file changes: `src/server/approval-surface.ts`, which gains the channel contributor (one line, its documented
extension point).

## 5. Migration `0008_channel_conversations.sql`

**Contents:** `channel_conversations`, `channel_events` and `channel_outbox`. All are tenant-scoped, hold digests and ciphertext only,
include erasure CHECKs, and have **no reference into `mcp_handoffs`** (the channel keys handoffs by requester ref = conversation ID).
The abuse-limit counters reuse the existing `mcp_rate_limits` table under `channel:`/`handoff:conversation:` buckets, as Developer-001
reuses it.

**Sequencing.** The migration runner requires a gapless sequence (`MIGRATION_SEQUENCE_INVALID`), and Developer-001's `0007` is not in
this stack yet. So the file is authored now as `packages/cloud-runtime/migrations-pending/0008_channel_conversations.sql` and is not
in `migrations/` or `SHIPPED_MIGRATIONS`:

- Channel PostgreSQL tests apply it after the shipped migrations (raw, without a ledger row, so the embedded runtime's schema check
  stays exact).
- Runtime code fails closed with `CHANNEL_SCHEMA_NOT_INSTALLED` without its tables.
- Once `0007` is in the stack, the file moves unchanged into `migrations/`, its identity is pinned, and the suites rerun: one
  migration, no renumbering.

## 6. Files

**Created** (under `apps/reference-dapp/` unless noted):

- **Channel Core:** `src/channels/core/{types,config,crypto,store,pg-store,copy,strategy,conversation,interpreter,approval,
  approval-profile,status,notify,service,log}.ts`.
- **Adapter registry:** `src/channels/registry.ts`.
- **WhatsApp:** `src/channels/whatsapp/{config,webhook,render,transport,adapter,handler}.ts`;
  `src/app/api/channels/whatsapp/route.ts`.
- **Ping:** `src/app/channel-approve-action.ts`, `src/components/channel-progress-ping.tsx`.
- **Migration:** `packages/cloud-runtime/migrations-pending/0008_channel_conversations.sql`.
- **Tests:** unit, PostgreSQL and journey tests under `src/channels/**`; `e2e/whatsapp-approve.spec.ts` if the browser harness permits
  (MOCKED).
- **Docs:** `docs/deploy/WHATSAPP.md`, `docs/builds/BUILD-CHANNELS-001-REPORT.md`.

**Modified:**

- `src/server/approval-surface.ts`: the contributor.
- `src/app/approve/page.tsx`: one line.
- `docs/deploy/ENVIRONMENT.md`, `docs/STATUS.md`, `docs/SECURITY_MODEL.md`.
- `.github/workflows/contracts.yml`: only if a browser spec is added.

**Not modified:**

- `src/platform/**`, `src/mcp/**`, `src/engine/**`, the Copilot files, `approval-handoff.tsx`;
- `migrations/**`, `migrations.ts`, `package.json` and the lockfile;
- every UX-sensitive file (`app-shell.tsx`, `workflow-canvas.tsx`, `copilot-panel.tsx`, `globals.css`, `summary-bar.tsx`,
  `artifact-inspector.tsx`) and the other UX-branch files.

## 7. Generic vs WhatsApp split (planned)

Channel Core plus the `/approve` integration ≈ 75 % of implementation lines; the WhatsApp adapter ≈ 25 %. Measured exactly in the
report.

## 8. Tests (MOCKED only)

**Webhook and transport:**

- challenge and verification;
- valid and invalid signatures (wrong secret, missing or malformed header, tampered byte, re-serialized JSON with `\uXXXX` escapes,
  previous secret);
- body limits;
- duplicate inbound (same batch and parallel requests) → one turn;
- out-of-order and retry tolerance;
- unsupported message;
- allowlist (deny by default);
- activation guard (hosted → 404; live refused; the fixture never calls `fetch`).

**Conversation:**

- secret and private-key refusal (no storage, no model call);
- bounded multi-turn clarification;
- correction of the pending proposal (old handoff REVOKED);
- ambiguity → which step;
- authorization words cannot execute or change state.

**Strategy:** canonical strategy and hash parity (inverse round trip over capability examples and corpus; parity guard fails closed).

**Approvals and platform:**

- simulation through `simulatePreview`;
- channel approval creation (`CHANNEL_CONVERSATION`, no account or grant);
- requester isolation (another conversation or kind cannot read or revoke);
- intended-wallet claim rule;
- channel identity ≠ wallet identity;
- revoked and superseded approvals refused on `/approve`;
- status and evidence read (shared vs not).

**Delivery and configuration:**

- outbox idempotency;
- provider retry with no duplicate effects;
- configuration fails closed;
- secret and log leakage (captured logs and database rows scanned);
- import boundaries.

**MOCKED journeys** (`journey.pg.test.ts`): signed WhatsApp delivery → Channel Core → StrategySpec → platform → approval →
wallet-proven claim → apply → the existing flow on MOCKED loopback chains → reconciliation → ping → outbound "Execution reconciled ✅
(evidence: MOCKED)". One journey uses the router testnet; the lending composition example is included where its harness allows a
server-level journey.

**Regression and gates:**

- the full unit, PostgreSQL and MCP browser suites;
- `pnpm check`, `pnpm test:postgres`;
- governance-lite and its unittest suite on an export.

## 9. Dependencies

None new: `fetch`, `node:crypto` (HMAC, HKDF, AES-256-GCM, `timingSafeEqual`), `after()` from `next/server` (pinned `next@16.3.6`),
the existing PostgreSQL stack.

## 10. External configuration

None in this build (D1). `docs/deploy/WHATSAPP.md` lists what a future, cleared activation would need.

## 11. Telegram as the first potentially live adapter

**Policy first.**

- Telegram's [blockchain guidelines](https://core.telegram.org/bots/blockchain-guidelines) apply to Mini Apps ("Regular Telegram bots
  that do not have a Mini App component are exempt"), so: a plain bot only.
- The [Bot Platform Developer Terms](https://telegram.org/tos/bot-developers) §5.2(h) bars facilitating "regulated or questionable
  goods and services", which needs the owner's legal review.
- Those terms also require a privacy policy, deletion on request, and encryption at rest separate from keys; §3.10 already meets these.

**Adapter:** `src/channels/telegram/{config,webhook,render,transport,adapter,handler}.ts` + `/api/channels/telegram`:

- authentication by the `X-Telegram-Bot-Api-Secret-Token` header (setWebhook `secret_token`, constant-time);
- dedupe on `update_id`;
- private chats only; text → TEXT, `callback_query` → CHOICE;
- `sendMessage` with an inline keyboard (callback buttons plus one URL button);
- `windowHours: null`; `/start` opt-in, `/stop` and blocks as opt-out;
- an allowlist of user-ID digests.

**Core changes:** none expected (pattern channel ID, window as an adapter property, channel-neutral copy).

**Live:**

- a bot created with @BotFather;
- the webhook secret;
- allowlisted IDs;
- policy sign-off;
- a reviewed guard-lifting change.

## 12. Evidence and report

All evidence is MOCKED: in-process signed deliveries, the fixture transport, Copilot replay, MOCKED loopback chains, loopback
PostgreSQL. The report separates:

- implemented;
- MOCKED-tested;
- live-provider tested (**not done**);
- public-chain tested (**not done**);
- production-ready (**no**);
- not yet done.

## 13. Phases (one or more commits each)

1. This plan.
2. Channel Core foundations: types, config, crypto, store, the `0008` content, PostgreSQL tests.
3. Strategy, conversation, interpreter: unit tests (parity, clarification, correction, secrets, authority words).
4. Approval on the platform: approval, contributor, claim policy, status, notify; PostgreSQL tests.
5. WhatsApp adapter, service and route: webhook, render, transport, handler; tests.
6. The ping, MOCKED journeys, leakage and minimization tests, optional browser spec.
7. Docs and report; full gates.

## 14. Risks

- WhatsApp may never be activatable (D1).
- Without a scheduler, push depends on an active `/approve` page; otherwise status is pull-only.
- Mobile wallet UX: links open in the default browser, which has no injected wallet.
- `0008` waits for `0007` (§5).
- LGPD obligations; rotating the channel secret forgets opt-outs.
- Legal review before any production or mainnet use.
- Copilot replay drift from the UX work.

## 15. Production phase (owner instruction, 2026-10-08)

The owner redefined the build's target: **a production-capable Channels service**; the MOCKED WhatsApp adapter is regression
coverage, not acceptance. On the same branch line, restacked onto main `043ab01` (BUILD-DEVELOPER-001 included, the 18 superseded
MCP/Developer commits not replayed), as `claude/build-channels-001-production`:

| Item | Change |
| --- | --- |
| Restack | Only `fc84a1e..0609937`; MCP + Developer + Channel approval contributors side by side; the status ping mounted next to `ApprovalHandoff` in `ProductWorkspace` (main's `/approve` architecture); main's CI gates kept, Channels specs added |
| Migration `0008` | Shipped after `0007` and pinned; finalized before its first shipment (outbox UNCERTAIN/DEAD states, sweep indexes, approval following, `channel_audit`) — it had never been applied outside tests |
| D1 (WhatsApp) | Kept as a guard, now exact: the live Cloud API path is implemented in full and activates only when written clearance is recorded in code (`WHATSAPP_POLICY_CLEARANCE`, null) **and** named by the deployment. Behaviour unchanged until then |
| D5 (status) | Extended: the `/approve` ping stays the fast path; a scheduled, bearer-protected dispatch now guarantees retries, stranded turns and status notifications without an open page or another inbound message |
| Providers | One `ChannelProvider` contract for inbound verification/normalization and outbound send/statuses/failure classes; a multi-adapter registry |
| Telegram | A real Bot API adapter (§11 implemented): the channel for the owner's real end-to-end test |
| Acceptance | `COMPLETE` only after a real owner E2E; otherwise `READY_FOR_OWNER_REAL_E2E`, `BLOCKED_ON_EXTERNAL_PROVIDER` or `NOT_READY` |

Unchanged: zero financial authority; D2, D3, D4, D6; data minimization; no live call, message or transaction by the build itself.
