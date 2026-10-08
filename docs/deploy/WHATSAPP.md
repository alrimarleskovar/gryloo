# FloFi conversational channels: the WhatsApp adapter (BUILD-CHANNELS-001)

The WhatsApp adapter connects the WhatsApp Business Platform (Cloud API) to FloFi's Channel Core. Like every channel it has **zero
financial authority**: a message composes a proposal and FloFi hands it to the wallet owner on `/approve`, where the owner proves
the wallet, FloFi simulates again, the owner reviews the Strategy Manifest and signs with their own wallet. "Yes", "confirm" or
"execute" in a chat authorizes nothing, and a WhatsApp sender id is never a wallet.

**Status: implemented in full; live activation BLOCKED by policy (owner decision D1).** The Cloud API transport, the webhook,
delivery statuses, the transactional outbox with retries, the 24-hour window and the template path are built and tested against
fixtures and a fake `fetch`. Nothing has been sent to Meta. Telegram ([TELEGRAM.md](TELEGRAM.md)) is the live channel for the
owner's end-to-end test.

## 1. The policy blocker and the exact activation point

The [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/) (§4, as checked on 2026-10-07) prohibits using
WhatsApp for Business for "buying, selling, promoting, or otherwise facilitating the exchange of" "Real, virtual, or fake
currency", "irrespective of the global or local licenses". FloFi proposals are DeFi strategies; a ban may cover all future use of
the business account (§7). Until the owner holds **written clearance** (Meta's written confirmation that this use is permitted, or
counsel's written opinion the owner accepts), the code keeps WhatsApp off:

| Configuration | Result |
| --- | --- |
| `FLOFI_WHATSAPP` unset | `404 WHATSAPP_NOT_ENABLED` |
| `FLOFI_WHATSAPP_PROVIDER=fixture` (default) on a hosted deployment | `404 CHANNEL_PROVIDER_NOT_ACTIVATED` (the fixture never runs hosted) |
| `FLOFI_WHATSAPP_PROVIDER=live`, any variables | `404 WHATSAPP_LIVE_PROVIDER_NOT_CLEARED` |
| `fixture` on a local, non-hosted server | runs; outbound messages are rendered and recorded, never sent |

**Live activation becomes allowed** only when both hold:

1. a reviewed code change sets `WHATSAPP_POLICY_CLEARANCE` in `apps/reference-dapp/src/channels/whatsapp/config.ts` to
   `{ reference, recordedOn, basis }` describing the written clearance (it is `null` today, and a test pins that);
2. the deployment sets `FLOFI_WHATSAPP_PROVIDER=live` and `FLOFI_WHATSAPP_POLICY_CLEARANCE=<that same reference>`, with a valid
   `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_GRAPH_API_VERSION`.

No environment value alone can activate it. The regulatory classification of chat-originated DeFi proposals also needs the owner's
legal review before any live or mainnet use.

## 2. Meta setup (owner, only after clearance)

Enter every secret in the deployment's secret store (Vercel → Settings → Environment Variables, marked Sensitive) — never in Git,
a chat or a ticket.

1. **Meta Business**: a verified business portfolio; a **Meta app** of type *Business* with the WhatsApp product added.
2. **WhatsApp Business Account (WABA)** and a **registered phone number** (display name approved). Note the *Phone number ID* →
   `WHATSAPP_PHONE_NUMBER_ID` and the *WhatsApp Business Account ID* → `WHATSAPP_BUSINESS_ACCOUNT_ID`.
3. **System user** in Business Settings with the app assigned and the permissions `whatsapp_business_messaging` and
   `whatsapp_business_management`; generate a permanent token → `WHATSAPP_ACCESS_TOKEN`. Pick the Graph API version you tested
   with → `WHATSAPP_GRAPH_API_VERSION` (`vNN.0`).
4. **App secret** (App settings → Basic) → `WHATSAPP_APP_SECRET`; during a rotation keep the old one in
   `WHATSAPP_APP_SECRET_PREVIOUS`.
5. **Webhook**: callback URL `https://<FLOFI_PUBLIC_ORIGIN host>/api/channels/whatsapp`, verify token = a new random value of at
   least 32 characters (`openssl rand -hex 32`) → `WHATSAPP_WEBHOOK_VERIFY_TOKEN`; subscribe the WABA to the **`messages`** field
   (it carries inbound messages and the sent/delivered/read/failed statuses).
6. **Template** (optional, for status notifications after the 24-hour window): a *Utility* template whose body has exactly one
   variable `{{1}}`, approved by Meta → `WHATSAPP_NOTIFICATION_TEMPLATE=<name>:<language code>` (for example
   `flofi_status_update:en_US`). Approval links are never sent through a template.
7. **Allowlist**: `printf '%s\n' '<BSUID or phone digits>' | node apps/reference-dapp/backend/channels-admin.ts allowlist-digest`
   → `FLOFI_WHATSAPP_ALLOWED_SENDERS` (default deny: nobody else gets a reply).
8. **Channel Core and scheduler**: the variables in [ENVIRONMENT.md §5d](ENVIRONMENT.md) (`FLOFI_CHANNEL_SECRET`,
   `FLOFI_PUBLIC_ORIGIN`, support contact, privacy URL, `FLOFI_CHANNEL_DISPATCH_TOKEN_SHA256`) and a scheduler for
   `/api/channels/dispatch` ([CHANNELS-OWNER-E2E.md §5](CHANNELS-OWNER-E2E.md)).
9. Check `/api/channels/health` (bearer) shows WhatsApp `enabled`, `mode: live`.

## 3. How the adapter behaves (as implemented)

| Concern | Behaviour |
| --- | --- |
| Subscription | `GET` with `hub.mode=subscribe`, the verify token compared in constant time, `hub.challenge` echoed |
| Authenticity | `POST` `X-Hub-Signature-256` = HMAC-SHA256 of the **exact raw bytes** under the app secret (current or previous), checked before parsing; 4 MiB bound |
| Scope | only `whatsapp_business_account` entries of this WABA and `messages` changes of this phone number id; anything else is acknowledged and ignored |
| Inbound | text → TEXT; button/list replies → CHOICE; media, voice, location, contacts… → "I can only read text"; reactions and system messages ignored; groups ignored |
| Identity | the business-scoped user id (BSUID) when present, else the phone number — stored only as a keyed digest plus an encrypted send address |
| Deduplication | the message id (keyed digest); Meta's retries and duplicates never repeat a turn |
| Outbound | inside the 24-hour customer service window: text, reply buttons (≤ 3) or one CTA URL button for the approval link; outside it: only a status notification through the approved template, otherwise skipped (`WINDOW_CLOSED`) |
| Correlation | every send carries the outbox id as `biz_opaque_callback_data`; status webhooks are matched by it, so a send whose answer was lost (a timeout) is confirmed by Meta's own report instead of being sent again |
| Failures | 131047 window closed, 368 policy, 0/10/190 authorization, 131026/130403/131021 undeliverable, 132xxx template errors → final; 429, 4, 80007, 130429, 131056 → retried after backoff; 131000/131016/131057/133004 and 5xx with an error body → retried; a timeout or 5xx without body → never resent, confirmed by status or ended unknown after 10 minutes |
| Data | inbound text exists only as transient ciphertext until the turn records its outcome; the send address is erased 48 hours after the last inbound message, at once on STOP |

## 4. Running it locally (fixture provider)

The fixture provider runs on a local, non-hosted server against the embedded runtime (`FLOFI_RUNTIME=embedded`, a loopback
PostgreSQL `DATABASE_URL` migrated through `0008_channel_conversations`). Outbound messages are rendered and dropped. The browser
suite (`e2e/whatsapp-approve.spec.ts`) and the PostgreSQL suites (`src/channels/whatsapp/*.pg.test.ts`) exercise it end to end,
including the owner's full MOCKED execution lifecycle in `journey.pg.test.ts`.

## 5. What a user can do

Text FloFi a strategy ("supply 100 USDC to Aave on Base Sepolia beneficiary 0x…", or natural language when the Copilot is
enabled), answer FloFi's questions, correct the proposal, and use `HELP`, `STATUS`, `LINK` (a fresh approval link), `NEW` (start
over) and `STOP`/`START`. Each proposal produces a 15-minute, single-use `/approve` link; replacing the proposal withdraws the
previous link. Status notifications ("loaded in FloFi", "in progress", "Execution reconciled ✅ · evidence: …") reach the chat only
while the wallet owner shares run status, as FloFi recorded it.

## 6. Wallet and mobile limitations

Links open in the phone's default browser, which has no injected wallet: open FloFi in a wallet's in-app browser or on a desktop
with an extension. The link works once for 15 minutes; `LINK` gives a fresh one.
