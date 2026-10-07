# FloFi conversational channels: the WhatsApp adapter (BUILD-CHANNELS-001)

**Status: DORMANT. Fixture provider only, local only. Not live, not production.** The adapter is built against fixtures shaped
like Meta's WhatsApp Cloud API documentation and runs end to end in tests. It cannot be activated on any hosted deployment, and
it never sends a message to Meta.

WhatsApp is an entry channel into FloFi's existing engine. It has **no financial authority**:

```
WhatsApp message ─► /api/channels/whatsapp (signature) ─► Channel Core turn ─► canonical StrategySpec (shared platform)
   ─► CHANNEL_CONVERSATION approval (shared platform; one link, 15 min, view/claim only)
   ─► FloFi /approve ─► wallet proof ─► fresh simulation ─► Strategy Manifest Review ─► the owner's wallet signs
   ─► execution ─► reconciliation / evidence ─► (owner opted in) status back in the chat
```

A message such as "yes", "confirm" or "execute" authorizes nothing. A sender id is never a wallet. Nothing in the channel signs,
submits, claims, applies or reads a wallet session.

## 1. Why it is dormant (owner decision D1)

The WhatsApp Business Messaging Policy (last updated 2026-09-23, §4) prohibits using WhatsApp for Business for "buying, selling,
promoting, or otherwise facilitating the exchange of" "Real, virtual, or fake currency". Until the owner holds written clearance
from Meta (or counsel's written opinion that FloFi's use is outside that clause), the adapter stays dormant, and the code enforces it:

| Condition | Result |
| --- | --- |
| `FLOFI_WHATSAPP` is not `enabled` | `404 WHATSAPP_NOT_ENABLED` |
| any hosted deployment (`VERCEL=1`, Railway, `FLOFI_DEPLOYMENT=hosted`), whatever the other variables say | `404 CHANNEL_PROVIDER_NOT_ACTIVATED` |
| `FLOFI_WHATSAPP_PROVIDER=live` | `503 WHATSAPP_LIVE_PROVIDER_NOT_CLEARED` |
| any missing or malformed value | `503` with a closed code; the channel is off |

Lifting the guard is a separate, reviewed change (§6). Do not connect a WhatsApp Business number, subscribe a Meta webhook or send a
real message before then.

## 2. Running it locally (fixture provider)

Requirements: the embedded runtime (`FLOFI_RUNTIME=embedded`, a loopback PostgreSQL `DATABASE_URL`) and the staged migration
`packages/cloud-runtime/migrations-pending/0008_channel_conversations.sql` applied by hand. It is staged, not in the shipped
sequence, because `0007` belongs to BUILD-DEVELOPER-001 and the runner requires a gapless sequence (§5). Without it the webhook
answers `503 CHANNEL_SCHEMA_NOT_INSTALLED`.

```
FLOFI_WHATSAPP=enabled
FLOFI_WHATSAPP_PROVIDER=fixture
FLOFI_WHATSAPP_ALLOWED_SENDERS=<sha256 hex of a test BSUID or phone digits>,…
WHATSAPP_APP_SECRET=<generated, ≥ 16 chars>            # signs test deliveries (X-Hub-Signature-256)
WHATSAPP_WEBHOOK_VERIFY_TOKEN=<generated, ≥ 32 chars>
WHATSAPP_PHONE_NUMBER_ID=<digits>  WHATSAPP_BUSINESS_ACCOUNT_ID=<digits>
FLOFI_CHANNEL_SECRET=<openssl rand -hex 32>             # distinct from every other secret
FLOFI_PUBLIC_ORIGIN=http://127.0.0.1:3000               # loopback http only when not hosted
FLOFI_CHANNEL_SUPPORT_CONTACT=<email or https URL>  FLOFI_CHANNEL_PRIVACY_URL=<https URL>
```

All values are server-only (never `NEXT_PUBLIC_*`). Every variable is listed in [ENVIRONMENT.md §5d](ENVIRONMENT.md). With the
fixture provider, outbound messages are rendered exactly as they would be sent, validated, and then dropped. No process keeps
them, including the approval link.

The tests drive it the same way. Signed deliveries go through the real handler and route
(`src/channels/whatsapp/channel.pg.test.ts`, `journey.pg.test.ts`, `e2e/whatsapp-approve.spec.ts`).

## 3. What a user can do

- Describe a strategy: exact FloFi commands always work. With the Copilot enabled, natural language is read by the existing
  untrusted interpreter (`store: false`, strict schema, grounded in the user's own words). FloFi asks for anything missing, such as
  a network, an amount or the owner address.
- Get one approval link per proposal. It opens FloFi `/approve`, expires after 15 minutes, and is replaced (the old one is
  revoked) on any correction, `LINK` or `NEW`.
- `STATUS`: the proposal's state, plus the runs started from it, but only while the wallet owner shares them on `/approve` (off
  by default for channels).
- `HELP`, `NEW`/`CANCEL`, `LINK`, `STOP` (opt-out: the address is erased at once) and `START`, in English or Portuguese.
- Never: send a key or seed phrase (refused, never stored), authorize by message, read unshared runs.

## 4. Data held (see the report for the full table)

Channel tables are `channel_conversations`, `channel_events` and `channel_outbox`.

- Inbound text: an encrypted transient payload, erased when the turn completes. A payload left behind by a crashed turn is erased
  by the next delivery and never processed late.
- Records: content-free keyed digests and closed codes, kept for 8 days.
- Send address: encrypted, erased 24 h after the user's last message.
- Approval links: never stored. Only the platform's digest of the secret is kept, in the shared handoff table.

Encryption is AES-256-GCM, with keys derived from `FLOFI_CHANNEL_SECRET` by HKDF and the AAD bound to tenant, table, row and
column. Logs hold closed codes and opaque ids only.

## 5. The staged migration `0008`

`0008_channel_conversations.sql` creates the three channel tables only. It does not reference or alter the generic handoff
table (`mcp_handoffs`, generalized by migration `0006`). Channel approvals are ordinary platform handoffs with
`requester_kind = 'CHANNEL_CONVERSATION'`. When BUILD-DEVELOPER-001's `0007` merges:

1. Move the file to `packages/cloud-runtime/migrations/`.
2. Add it to `src/migrations.ts`.
3. Drop the raw application from the test harness (`channel-db.test-harness.ts`) and the Playwright global setup.

## 6. Activation prerequisites (all owner actions; none done)

1. Written policy clearance for this use (see §1). Without it, WhatsApp stays dormant permanently, and Telegram (plan §11) is
   the candidate first live adapter.
2. Legal and regulatory review of FloFi's classification for chat-originated DeFi proposals.
3. A Meta app, a WhatsApp Business Account, a verified number, the system-user access token and the app secret, all in the
   deployment's secret store only.
4. A reviewed code change that lifts the D1 guard for one named deployment and implements `FLOFI_WHATSAPP_PROVIDER=live` with
   the existing Graph transport (`transport.ts`, tested against a fake `fetch` only).
5. Migration `0008` shipped (§5); the privacy policy and support contact published; allowlist digests for the first testers.
6. A supervised live session on test funds only, and a separate report. Mainnet channel handoffs stay disabled
   (`FLOFI_CHANNEL_HANDOFF_MAINNET_NETWORKS` empty).

## 7. Wallet and mobile limitations

- WhatsApp opens the link in the phone's default browser, which has no injected wallet. The owner must open FloFi in a
  wallet's in-app browser, or on a desktop with a wallet extension. The link survives the copy because the secret is in the
  fragment, but it works once and lasts 15 minutes; `LINK` gives a fresh one.
- Status pushes happen only while `/approve` stays open and visible after the owner opted in (there is no scheduler). Otherwise
  `STATUS` reads the same facts on demand.
- Outside WhatsApp's 24-hour customer-service window FloFi sends nothing (no templates in this build).
