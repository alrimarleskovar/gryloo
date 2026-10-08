# Owner runbook: a real end-to-end test of FloFi Channels (BUILD-CHANNELS-001)

This runbook takes the owner from nothing to a **real** channel journey:

> a Telegram message → Telegram's webhook to FloFi → a durable channel conversation → FloFi's StrategySpec and canonical IR →
> validation → `/approve` → the owner's wallet proof → FloFi's fresh **testnet** simulation → Strategy Manifest Review → the owner's
> approval and **wallet signatures** → Base Sepolia → Arbitrum Sepolia execution → reconciliation → Evidence Bundle → the result back
> in Telegram.

The channel has **zero financial authority** at every step: it never signs, holds a key, approves or submits anything. Every
signature in this runbook is made by the owner, in the owner's wallet, on a testnet. Nothing here uses mainnet or real funds.

**Never paste a secret into a chat, an issue or a commit.** Each secret goes only where this runbook says: the Vercel environment
(marked *Sensitive*) or your own shell (`read -rs`).

WhatsApp is not part of this test: its live activation is blocked by policy ([§9](#9-whatsapp-what-would-be-needed)).

## 0. What you need

- The Vercel project `flofi` and this branch deployed as a **Preview on the embedded runtime** ([CLOUD.md](CLOUD.md#vercel-preview-on-the-embedded-runtime-build-cloud-parity-001)):
  Preview-only `DATABASE_URL` (not Production's), `FLOFI_MIGRATE_ON_BUILD=preview` (the build applies migration `0008`),
  `FLOFI_SESSION_SECRET`, `GRYLOO_ROUTER_TESTNET=live`, no `API_BASE_URL`, and **Vercel Authentication disabled for Preview
  deployments** (Telegram must reach the webhook).
- The Preview's stable branch alias, e.g. `https://flofi-git-claude-build-channels-001-production-<team>.vercel.app` — called
  `$ORIGIN` below (no trailing slash).
- A Telegram account and the Telegram app.
- A browser wallet (desktop extension, e.g. MetaMask/Rabby) on **Base Sepolia** with a little **Base Sepolia ETH** (gas) and at
  least **1 test USDC on Base Sepolia** (e.g. from Circle's testnet faucet). Testnet only.
- This repository checked out at the branch, Node 24.21.0 and pnpm 11.22.0 (`pnpm install --frozen-lockfile`) for the operator CLI.

## 1. Create the bot (BotFather) — owner action

1. In Telegram open **@BotFather** → `/newbot` → choose a display name (e.g. `FloFi Test`) and a username ending in `bot`
   (e.g. `flofi_owner_test_bot`).
2. BotFather replies with the **bot token** (`<digits>:<letters>`). Treat it as a password. It goes **only** into Vercel
   (`TELEGRAM_BOT_TOKEN`, Preview, Sensitive) and your shell when you run the CLI.
3. Recommended: `/setjoingroups` → *Disable* (FloFi ignores groups anyway).

## 2. Prepare the secrets (your shell) — owner action

```sh
CLI='node apps/reference-dapp/backend/channels-admin.ts'
openssl rand -hex 32     # → FLOFI_CHANNEL_SECRET (Vercel, Sensitive)
openssl rand -hex 32     # → TELEGRAM_WEBHOOK_SECRET (Vercel, Sensitive; keep it for step 5)
$CLI dispatch-token --token-file ~/.flofi-cron-secret
#   → prints FLOFI_CHANNEL_DISPATCH_TOKEN_SHA256=<64 hex> (Vercel); the token itself stays in the mode-0600 file
```

Find your Telegram user id (needed for the allowlist; default is deny-all):

```sh
read -rs TELEGRAM_BOT_TOKEN && export TELEGRAM_BOT_TOKEN   # paste the bot token, nothing is echoed
$CLI telegram-me          # → { ok: true, value: { id: <bot id>, username: "<your bot>" } }
```

In Telegram, open your bot and send `/start` (no reply yet — the webhook is not set). Then:

```sh
$CLI telegram-whoami      # → [{ userId: "<your id>", digest: "<64 hex>" }]
```

The `digest` → `FLOFI_TELEGRAM_ALLOWED_USERS`. (`telegram-whoami` only works while no webhook is set.)

## 3. Configure the Preview (Vercel → Settings → Environment Variables → Preview) — owner action

| Variable | Value |
| --- | --- |
| `FLOFI_TELEGRAM` | `enabled` |
| `TELEGRAM_BOT_TOKEN` | the BotFather token (Sensitive) |
| `TELEGRAM_WEBHOOK_SECRET` | from step 2 (Sensitive) |
| `FLOFI_TELEGRAM_ALLOWED_USERS` | your digest from step 2 |
| `FLOFI_CHANNEL_SECRET` | from step 2 (Sensitive; must differ from every other secret) |
| `FLOFI_PUBLIC_ORIGIN` | `$ORIGIN` exactly (already set if MCP/Developer are enabled on the Preview) |
| `FLOFI_CHANNEL_SUPPORT_CONTACT` | an e-mail address or `https://` page where a human answers |
| `FLOFI_CHANNEL_PRIVACY_URL` | your privacy policy `https://` URL |
| `FLOFI_CHANNEL_DISPATCH_TOKEN_SHA256` | the digest from step 2 |
| `FLOFI_CHANNEL_COPILOT` | `disabled` for this test (exact commands only, no model call) |
| `GRYLOO_ROUTER_TESTNET` | `live` |

Leave `FLOFI_CHANNEL_HANDOFF_MAINNET_NETWORKS` **unset** and `FLOFI_WHATSAPP` **unset**. Redeploy the Preview.

## 4. Check readiness

```sh
curl -s -H "Authorization: Bearer $(cat ~/.flofi-cron-secret)" "$ORIGIN/api/channels/health"
```

Expected: `"ok": true`, `"store": "READY"`, `"testFunds": true`, `"mainnetNetworks": []`, and the Telegram provider
`{ "route": "telegram", "enabled": true, "mode": "live", "windowHours": null, "deliveryReports": [], "confirmsUncertainSends": false }`
(WhatsApp `enabled: false`, `code: "WHATSAPP_NOT_ENABLED"`). A `503` names what is missing (`CHANNEL_SCHEMA_NOT_INSTALLED`: the
build did not migrate; `CHANNEL_STORE_UNAVAILABLE`: no embedded runtime). `"reason"` on a provider names the invalid variable.

## 5. Register the webhook

```sh
read -rs TELEGRAM_WEBHOOK_SECRET && export TELEGRAM_WEBHOOK_SECRET   # the same value as in Vercel
export FLOFI_PUBLIC_ORIGIN="$ORIGIN"
$CLI telegram-set-webhook     # → { ok: true, value: true }
$CLI telegram-webhook-info    # → url "$ORIGIN/api/channels/telegram", allowedUpdates [message, callback_query, my_chat_member], lastError null
```

The registration drops pending updates, so the `/start` from step 2 is never processed.

## 6. The test

### 6.1 First contact

Send **`/start`** to your bot. Expected, within a few seconds, two messages:

1. `FloFi (automated assistant). I compose DeFi strategies for you to review and sign in FloFi. I can't sign, execute or move funds,
   and nothing you write here authorizes anything. Never send a private key or seed phrase. Human support: … Privacy: … Reply STOP
   to stop messages.`
2. `What I can do: compose a strategy from your message (…) …`

Nothing at all? Run `$CLI telegram-webhook-info`: `lastError` shows Telegram's view (e.g. `Wrong response from the webhook: 401`
= the secret differs; `404` = `FLOFI_TELEGRAM` not enabled on that deployment; `403` = Vercel Authentication still on).

### 6.2 The proposal

Send exactly:

```
bridge 1 USDC from Base Sepolia to Arbitrum Sepolia via auto slippage 50 bps
```

Expected reply, with one button **Open FloFi**:

```
Strategy ready:
1. Bridge 1 USDC · Base Sepolia → Arbitrum Sepolia
Network: Base Sepolia → Arbitrum Sepolia (test funds)
FloFi runs the simulation when you open it.
Nothing is authorized yet: open FloFi, connect your wallet, review the Strategy Manifest and sign there. The link works once and expires in 15 minutes.
```

Optional checks: send `yes, execute it` → `Nothing can be authorized here — …` (and nothing changes). `LINK` → a fresh button; the
previous link stops working. `STATUS` → `Proposal waiting for you to open it in FloFi (expires HH:MM UTC).`

### 6.3 Approve in FloFi (your browser and wallet)

1. Open the **Open FloFi** link **in the desktop browser that has your wallet** (on a phone, copy it into the wallet's in-app
   browser). It works once, for 15 minutes; `LINK` gives a fresh one.
2. The page shows `EXTERNAL PROPOSAL · FROM TELEGRAM` and `Nothing is authorized yet.` The link's secret leaves the address bar.
3. Tick **Share run status and evidence with Telegram** (off by default — without it, the chat learns nothing about the run).
4. **Connect wallet and prove ownership**: one sign-in message (EIP-4361, `personal_sign`), which authorizes no transaction.
5. **Load proposal** → **Add to my workflow** → `Ready for your review.` — within ~20 s Telegram receives
   `Your proposal is loaded in FloFi for the connected wallet. Nothing is signed yet: …`

### 6.4 Simulate, review, execute on testnet (FloFi, your wallet)

1. In FloFi: **Simular Fees** → **Get route and simulate** (live testnet quotes, `eth_simulateV1` of the exact Base Sepolia
   transactions, observation of both chains).
2. Read the Review and the **Strategy Manifest** (owner = your wallet, 1 USDC spend limit, provider, recipient, deadlines).
   **Approve & Continue** is enabled only for a simulation that can authorize execution (a real testnet one).
3. **Execute workflow**: your wallet asks for the exact USDC approval, then the bridge deposit, on **Base Sepolia**. Sign each in
   your wallet. FloFi never signs and the bot never sees a transaction.
4. Keep the FloFi page open: the run reaches `RECONCILED` only when the Arbitrum Sepolia fill and USDC transfer to your address are
   observed on both chains (usually minutes; reconciliation on a Preview is request-driven — reopen the run from **Your runs** if
   the page was closed).

### 6.5 The result back in Telegram

While the page is open and shares status, Telegram may receive `Execution in progress (…)` once (if FloFi sees the run before it
ends), then, once reconciled:

```
Execution reconciled ✅ · evidence: <environment FloFi recorded — a public testnet, never MOCKED> · outcome: <outcome> · bundle 0x1234…abcd
```

If the page was closed before that, run the dispatch (Vercel Cron does not run for Previews):

```sh
curl -s -H "Authorization: Bearer $(cat ~/.flofi-cron-secret)" "$ORIGIN/api/channels/dispatch"
# → { "ok": true, "object": "channel_dispatch", "notified": 1, … }  (counts only)
```

Send `STATUS` → `Proposal in a FloFi workflow; any execution needs the wallet owner's review and signature there.` followed by the
same `Execution reconciled ✅ · …` line.

## 7. Verify (what proves the journey)

| Check | Where | Expected |
| --- | --- | --- |
| Inbound real webhook | `$CLI telegram-webhook-info` | `pendingUpdates: 0`, `lastError: null` |
| Approval was a channel handoff | `/approve` page | `FROM TELEGRAM`; the run is yours, signed by your wallet |
| Testnet execution | your wallet history / Base Sepolia explorer | the USDC approval and the deposit, from your address |
| Reconciliation | FloFi run view | `RECONCILED` (or `REFUNDED`, verified on chain) |
| Evidence | FloFi → Download Evidence Bundle | bundle hash = the shortened `bundle 0x…` in Telegram |
| Result in the channel | Telegram | `loaded` once, `in progress` at most once, `reconciled ✅` once |
| Nothing leaked | Telegram transcript | no full address, calldata, key or link secret in any FloFi message |

Record what you saw (screenshots of Telegram and the run, the explorer links, the Evidence Bundle hash) in the PR. Only this
journey, performed by you, is a real E2E: the build's own evidence is MOCKED/loopback.

## 8. After the test

- `STOP` in Telegram (or block the bot) ends the conversation: its state and chat id are erased and the live link withdrawn.
- `$CLI telegram-delete-webhook` and unset `FLOFI_TELEGRAM` to switch the channel off. Revoke the token with BotFather
  (`/revoke`) if it was ever exposed.
- Production: a scheduler must call `/api/channels/dispatch` (retries, stranded turns, status without an open page). With Vercel
  Cron (Production only; per-minute schedules need a plan that allows them) add to `apps/reference-dapp/vercel.json`
  `"crons": [{ "path": "/api/channels/dispatch", "schedule": "* * * * *" }]`, set `CRON_SECRET` to the token in
  `~/.flofi-cron-secret` and `FLOFI_CHANNEL_DISPATCH_TOKEN_SHA256` to its digest. Any other scheduler works with
  `Authorization: Bearer <token>` (GET or POST).

## 9. WhatsApp: what would be needed

WhatsApp is implemented end to end (Cloud API transport, signature-verified webhook, statuses, 24-hour window, template path) but
**live activation is blocked by the WhatsApp Business Messaging Policy §4** (facilitating the exchange of currency) — owner decision
D1. It becomes allowed only after the owner obtains written clearance (Meta's written confirmation, or counsel's opinion the owner
accepts) **and** a reviewed code change records it in `WHATSAPP_POLICY_CLEARANCE`. Then: the Meta app, WABA, verified number,
system-user token, app secret, webhook and template in [WHATSAPP.md §2](WHATSAPP.md), and the variables in
[ENVIRONMENT.md §5d](ENVIRONMENT.md) with `FLOFI_WHATSAPP_PROVIDER=live` and `FLOFI_WHATSAPP_POLICY_CLEARANCE=<reference>`. The test
is then this runbook with WhatsApp in place of Telegram (the approval button is a CTA URL; statuses arrive as delivered/read).
