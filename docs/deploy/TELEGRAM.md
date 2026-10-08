# FloFi conversational channels: the Telegram adapter (BUILD-CHANNELS-001)

A plain Telegram bot (Bot API over HTTPS, a webhook; no Mini App, no inline mode, no groups) connected to FloFi's Channel Core. Like
every channel it has **zero financial authority**: a message composes a proposal and FloFi hands it to the wallet owner on
`/approve`, where the owner proves the wallet, FloFi simulates again, the owner reviews the Strategy Manifest and signs with their
own wallet. "Yes", "confirm" or "execute" in the chat authorizes nothing, and a Telegram user id is never a wallet.

**Status: implemented and configurable; READY FOR THE OWNER'S REAL END-TO-END TEST.** Verified against a Bot API double (unit,
PostgreSQL and browser suites); no real bot has been contacted by the build. The step-by-step owner test is
[CHANNELS-OWNER-E2E.md](CHANNELS-OWNER-E2E.md).

## 1. Policy

Telegram's [Bot Platform Developer Terms](https://telegram.org/tos/bot-developers) apply to the bot; the blockchain-specific
guidelines concern Mini Apps, which FloFi does not use. Before any public use the owner reviews those terms (including the clauses
on regulated goods and services) and the regulatory classification of chat-originated DeFi proposals. Until then keep the bot to the
owner's own allowlisted account, test funds only (`FLOFI_CHANNEL_HANDOFF_MAINNET_NETWORKS` empty).

## 2. Configuration

All server-only; enter secrets in the deployment's secret store, never in Git or a chat. Full table: [ENVIRONMENT.md §5d](ENVIRONMENT.md).

| Variable | Value |
| --- | --- |
| `FLOFI_TELEGRAM` | `enabled` |
| `TELEGRAM_BOT_TOKEN` | the token @BotFather gave for the bot |
| `TELEGRAM_WEBHOOK_SECRET` | `openssl rand -hex 32` (the secret token Telegram will echo) |
| `FLOFI_TELEGRAM_ALLOWED_USERS` | digests of allowed Telegram user ids (`channels-admin.ts telegram-whoami` / `allowlist-digest`) |
| Channel Core | `FLOFI_CHANNEL_SECRET`, `FLOFI_PUBLIC_ORIGIN`, `FLOFI_CHANNEL_SUPPORT_CONTACT`, `FLOFI_CHANNEL_PRIVACY_URL`, `FLOFI_CHANNEL_DISPATCH_TOKEN_SHA256`, optional `FLOFI_CHANNEL_COPILOT`/`_SIMULATION`/`_LANGUAGE` |

Webhook: `https://<FLOFI_PUBLIC_ORIGIN host>/api/channels/telegram`, registered with the operator CLI (below). Telegram requires a
public HTTPS URL (ports 443, 80, 88 or 8443); a Vercel deployment qualifies once Vercel Authentication does not block it.

## 3. Operator CLI (`backend/channels-admin.ts`, plain Node, reads secrets from your shell only)

```sh
CLI='node apps/reference-dapp/backend/channels-admin.ts'
read -rs TELEGRAM_BOT_TOKEN && export TELEGRAM_BOT_TOKEN        # paste the token; nothing is echoed
$CLI telegram-me                       # the bot's id and username: the token works
$CLI telegram-whoami                   # BEFORE the webhook: user ids + allowlist digests of people who wrote to the bot
read -rs TELEGRAM_WEBHOOK_SECRET && export TELEGRAM_WEBHOOK_SECRET
export FLOFI_PUBLIC_ORIGIN=https://<deployment host>
$CLI telegram-set-webhook              # registers <origin>/api/channels/telegram, secret token, message/callback_query/my_chat_member, drops pending updates
$CLI telegram-webhook-info             # url, pending updates, Telegram's last delivery error (if any)
$CLI telegram-delete-webhook           # unregister
$CLI dispatch-token --token-file ~/.flofi-cron-secret   # scheduler token in a new mode-0600 file; prints only its SHA-256
```

## 4. How the adapter behaves (as implemented)

| Concern | Behaviour |
| --- | --- |
| Authenticity | `X-Telegram-Bot-Api-Secret-Token` must equal `TELEGRAM_WEBHOOK_SECRET` (constant-time) before the body is parsed; 1 MiB bound; POST only |
| Scope | private chats with people only; groups, channels, bots, edits and inline queries are acknowledged and ignored |
| Inbound | text → TEXT (bot commands keep their word: `/start`, `/help`, `/status`, `/link`, `/new`, `/stop`; a `/start` payload is never read); photos, voice, documents… → "I can only read text"; a tap on FloFi's button → CHOICE, acknowledged with `answerCallbackQuery`; blocking the bot → opt-out (the live link is withdrawn, nothing is sent) |
| Identity | the numeric user id (private chat id = user id), stored only as a keyed digest plus an encrypted chat id |
| Deduplication | `update_id` (keyed digest): Telegram's redeliveries never repeat a turn |
| Outbound | `sendMessage`, plain text (no `parse_mode`), link previews off; the approval link as one URL button; up to 4 short choices as callback buttons |
| Window | none: a bot may write to a user who started it, until the user blocks it; the user must send `/start` first (Telegram's rule) |
| Delivery status | the Bot API reports nothing after accepting a message: SENT means accepted; there are no delivered/read receipts |
| Failures | 429 → retried after `retry_after`; 403 (blocked/deactivated) → final; 401/404 (bad token) → final; 400 (chat not found, invalid button) → final; 5xx with the API's error body → retried; a timeout, lost connection or 5xx without body → **never resent** (Telegram cannot confirm it), an approval link then withdrawn with "send LINK" |
| Rate limits | sends of one conversation go in order; a throttled message holds the ones after it (never an approval link) |
| Data | inbound text exists only as transient ciphertext until the turn records its outcome; the chat id is erased 48 hours after the last inbound message, at once on STOP or block |

## 5. Live provider check (owner-run)

`pnpm test:channels-live` with `FLOFI_TELEGRAM_LIVE=SEND_ONE_MESSAGE`, `TELEGRAM_BOT_TOKEN`, `FLOFI_TELEGRAM_LIVE_CHAT_ID=<your user
id>` and optionally `FLOFI_PUBLIC_ORIGIN`: checks the token, the registered webhook and sends one plain message to your own chat
through the production adapter. It never runs in `pnpm test` or CI and touches no database or wallet.

## 6. Wallet and mobile limitations

The URL button opens the link in Telegram's or the phone's browser, which has no injected wallet: copy it into a wallet's in-app
browser, or open it on a desktop with a wallet extension. The link works once for 15 minutes; send `LINK` for a fresh one.
