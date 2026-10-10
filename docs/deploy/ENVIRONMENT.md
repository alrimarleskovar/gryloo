# Flofi runtime environment reference (BUILD-CLOUD-PARITY-001)

Every variable the reference app, the backend and the build read, per environment. Values are supplied by the hosting platform or
your own shell; none is committed. **No variable is `NEXT_PUBLIC_*`, and none may be**: everything below is read on the server,
and the browser only talks to its own origin plus, for Credentials → Add card, Mercado Pago's three Secure Fields origins (CSP
`connect-src 'self' https://api.mercadopago.com https://api-static.mercadopago.com https://secure-fields.mercadopago.com`).

Columns: **Dev** = local `next dev`/`next start` on WSL; **CI** = the GitHub Actions suites; **Preview** = a Vercel Preview
deployment; **Prod** = Vercel Production + the Railway API/worker. `—` means leave unset. "Hosted" means Vercel, Railway or
`FLOFI_DEPLOYMENT=hosted`.

## 1. Runtime selection and durable state

| Variable | Purpose | Secret | Where | Dev | CI | Preview | Prod | Default / when missing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `API_BASE_URL` | Forward every cloud flow to the remote Flofi API (`remote` runtime). HTTPS only (loopback HTTP allowed for tests). | no | Vercel | — | tests set a loopback URL | — (see note 1) | **required** (Railway API URL) | unset: embedded or local runtime |
| `API_AUTH_TOKEN` | Bearer token between the BFF and the API (≥ 32 chars); also keys wallet sessions when `FLOFI_SESSION_SECRET` is unset. | **yes** | Vercel + API | — | test value | — | **required** (same value on both) | API refuses to start in production without it |
| `DATABASE_URL` | PostgreSQL. API/worker: flow state. Vercel: durable platform state; also selects **embedded** flows on a hosted deployment **only when `API_BASE_URL` is absent**. Use the provider's **pooled** endpoint, `sslmode=require`. | **yes** | API, worker, Vercel | optional for platform state or embedded flows | disposable loopback DBs only | **required** for embedded flows or MCP OAuth/Developer state — a database separate from Production | API/worker: **required**; Vercel: **required** for MCP OAuth/Developer state | no platform state without it; hosted without it and without `API_BASE_URL`: every flow `CLOUD_RUNTIME_NOT_CONFIGURED` |
| `DATABASE_MIGRATION_URL` | Direct (unpooled) URL used only by `migrate`. | **yes** | API pre-deploy, Vercel build | — | — | optional | recommended | `DATABASE_URL` |
| `DATABASE_POOL_MAX` | Connections per process. Vercel platform state and embedded runtime: 1–20, default 3; API/worker: 1–100, default 10. | no | all servers | — | — | optional | optional | 3 (Vercel) / 10 (API) |
| `FLOFI_RUNTIME` | `embedded` runs the embedded runtime outside a hosted platform (local verification). | no | Vercel/dev | optional | `cloud-runtime.spec.ts` | — | — | not embedded unless hosted |
| `FLOFI_DEPLOYMENT` | `hosted` declares a hosted deployment on a platform Flofi does not detect. | no | any | — | — | — | — | detected from `VERCEL` / `RAILWAY_*` |
| `FLOFI_MIGRATE_ON_BUILD` | `preview`: the Vercel build applies the shipped migrations to the Preview `DATABASE_URL` (refused for any other `VERCEL_ENV`). | no | Vercel build | — | — | recommended with a dedicated Preview database | — (migrations run in the API pre-deploy) | no migration at build |
| `TENANT_ID` | Tenant of a Production/local deployment. **Ignored on Previews**, which always use `pv-<branch>-<hash>`. | no | API, worker, Vercel | — | tests | ignored | optional | `default` |
| `PORT`, `HOST` | API listener. | no | API | — | — | — | Railway injects `PORT` | `0.0.0.0:8080` |
| `WORKER_ID`, `WORKER_CONCURRENCY` | Worker identity / parallel items. | no | worker | — | — | — | optional | host-pid-random / 4 |
| `OBJECT_STORE_ENDPOINT`, `OBJECT_STORE_BUCKET`, `OBJECT_STORE_REGION`, `OBJECT_STORE_FORCE_PATH_STYLE`, `OBJECT_STORE_PREFIX` | S3-compatible Evidence export store. | no | worker, API, (Vercel optional) | — | — | optional | worker: **required** | evidence stays in the durable run log only |
| `OBJECT_STORE_ACCESS_KEY_ID`, `OBJECT_STORE_SECRET_ACCESS_KEY` | Bucket-scoped credentials. | **yes** | same | — | — | optional | worker: **required** | — |
| `EVIDENCE_DIRECTORY` | Filesystem evidence store. **Refused on a hosted Vercel deployment** (`EVIDENCE_STORE_FILESYSTEM_FORBIDDEN`). | no | dev only | optional | tests | — | — | none |

Note 1 — a Preview that sets `API_BASE_URL` forwards to that API, which runs **its own** code (Railway deploys `main`) and its
own tenant. Use it only to test frontend-only changes against Production; otherwise give the Preview its own `DATABASE_URL`.

### Production: remote flows and direct durable platform state (BUILD-PLATFORM-STATE-001)

Production Vercel may have `API_BASE_URL`, `API_AUTH_TOKEN` and `DATABASE_URL` simultaneously. `API_BASE_URL` always takes
precedence: `flowRuntimeKind(env) === 'remote'`. Simulate, Review, execution lifecycle, runs, status, reconciliation and evidence
continue through the Railway API/worker. `DATABASE_URL` does not move financial flows into Vercel.

Vercel uses the pooled Neon `DATABASE_URL` directly for MCP OAuth, MCP accounts/wallet links/handoffs and Developer API
projects/keys/approvals/webhooks. Both surfaces and the shared approval store use one server-side `platformStateHost`, scoped
to exactly `deploymentTenant(env)`. Embedded deployments reuse their existing runtime pool. Remote deployments open a state
pool without constructing a flow backend. Every new pool verifies the shipped migration identities and ensures its tenant;
startup never applies migrations. Missing/invalid/unreachable PostgreSQL or a stale schema fails closed with the existing
surface store-unavailable errors. The process cache holds only pools and startup promises; durable state is PostgreSQL.

Reuse `DATABASE_URL`: the existing API-first selection already guarantees remote flows, and the existing PostgreSQL schema
contains these stores. No additional database secret or migration is introduced. Production Vercel and Railway must target the
same database and production tenant (`TENANT_ID`, default `default`); Preview tenant derivation remains branch-scoped.

**Owner action after merge and acceptance:** add the pooled Neon `DATABASE_URL` to Vercel **Production** and redeploy. Keep
`API_BASE_URL` (Railway HTTPS URL) and `API_AUTH_TOKEN` (the existing shared server token) configured. `DATABASE_POOL_MAX` is
optional (default 3); if supplied, use 1–20. MCP consumer access still requires `FLOFI_MCP=enabled`, `FLOFI_MCP_OAUTH=enabled`,
`FLOFI_PUBLIC_ORIGIN` and a dedicated `FLOFI_MCP_OAUTH_SECRET`; Developer access still requires `FLOFI_DEVELOPER=enabled`,
`FLOFI_PUBLIC_ORIGIN` and a separate `FLOFI_DEVELOPER_SECRET`. Existing invite/access and sandbox policies remain in force.
This build configures no production variables, issues no live developer credentials and adds no signing or financial authority.

## 2. Wallet session

| Variable | Purpose | Secret | Where | Dev | CI | Preview | Prod | Default / when missing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `FLOFI_SESSION_SECRET` | MAC key for the HttpOnly EIP-4361 session cookies (≥ 32 chars, `openssl rand -hex 32`). Rotating it signs every wallet out; no funds or runs are affected. | **yes** | Vercel | optional | tests | **required** (unless `API_AUTH_TOKEN` is set) | optional (`API_AUTH_TOKEN` is used) | local: a per-process key; hosted: `WALLET_SESSION_NOT_CONFIGURED` |

Sessions are bound to the host that issued them, so Production and every Preview reject each other's cookies even with a shared key.

## 3. Flow enablement (explicit per flow; nothing is on by default)

Set on the API **and** worker in Production; on Vercel for a Preview running the embedded runtime. A flow without its gate
answers `*_NOT_ENABLED`.

| Variable | Flow / networks | Preview | Prod |
| --- | --- | --- | --- |
| `GRYLOO_PUBLIC_TESTNET=record` | Uniswap v3 USDC/WETH swap — Base Sepolia, Ethereum Sepolia | recommended | as chosen |
| `GRYLOO_UNISWAP_LIQUIDITY_TESTNET=live` | Uniswap v3 concentrated liquidity — Base Sepolia, Ethereum Sepolia | recommended | as chosen |
| `GRYLOO_UNISWAP_LIQUIDITY_EXECUTION=DISABLED` | keeps liquidity Simulate/Review-only | optional | optional |
| `GRYLOO_SUPPLY_TESTNET=live` | Aave V3 Supply/Borrow/Repay/Withdraw — Base Sepolia USDC, Ethereum Sepolia WBTC; and the Supply → Borrow → Swap composition (which also needs `GRYLOO_ALCHEMY_API_KEY`) | recommended | as chosen |
| `GRYLOO_ROBINHOOD_TESTNET=live` | native test-ETH self-transfer — Robinhood Chain Testnet | recommended | as chosen |
| `GRYLOO_ETHEREUM_SEPOLIA_TRANSFER=live` | native test-ETH self-transfer — Ethereum Sepolia | recommended | as chosen |
| `GRYLOO_ROUTER_TESTNET=live` | Cross-chain Router — Base Sepolia → Arbitrum Sepolia test USDC (LI.FI or Across) | recommended | as chosen |
| `GRYLOO_ROUTER_TESTNET_EXECUTION=DISABLED` | keeps the testnet Router Simulate/Review-only | optional | optional |
| `GRYLOO_SOLANA_DEVNET=live` | Orca Whirlpools swap and liquidity — Solana Devnet | recommended | as chosen |
| `GRYLOO_SOLANA_DEVNET_EXECUTION=DISABLED` | keeps both Devnet flows Simulate/Review-only | optional | optional |
| `GRYLOO_ROUTER=live` | Cross-chain Router — Base → Arbitrum One, **Simulate/Review only** | — | as chosen |
| `GRYLOO_JUPITER=live` | Jupiter — Solana mainnet-beta, **Simulate/Review only** | — | as chosen |
| `GRYLOO_ROUTER_OWNER_EXECUTION=MAINNET_OWNER_APPROVED`, `GRYLOO_JUPITER_OWNER_EXECUTION=MAINNET_OWNER_APPROVED` | real-funds owner execution | **never** | only by explicit owner decision; not set by this build |

## 4. RPC endpoints and provider keys (optional; all HTTPS, no credentials in the userinfo part)

Each override replaces exactly one chain's public endpoint for every flow on that chain; a client never falls back to another
chain, to Mainnet or to localhost, and every response's chain identity is verified.

| Variable | Chain | Public default | Secret |
| --- | --- | --- | --- |
| `GRYLOO_BASE_SEPOLIA_RPC_URL` | Base Sepolia 84532 — Uniswap swap and liquidity, Aave, Router testnet source (BUILD-CLOUD-PARITY-001: now also Aave and the swap). Must support `eth_simulateV1`. | `https://sepolia.base.org` (Aave: `https://base-sepolia.gateway.tenderly.co`) | if keyed |
| `GRYLOO_ETHEREUM_SEPOLIA_RPC_URL` | Ethereum Sepolia 11155111 — swap, liquidity, Aave WBTC, transfer | `https://ethereum-sepolia-rpc.publicnode.com` | if keyed |
| `GRYLOO_ARBITRUM_SEPOLIA_RPC_URL` | Arbitrum Sepolia 421614 — Router testnet destination | `https://sepolia-rollup.arbitrum.io/rpc` | if keyed |
| `GRYLOO_SOLANA_DEVNET_RPC_URL` | Solana Devnet (genesis-verified) | `https://api.devnet.solana.com` | if keyed |
| `GRYLOO_BASE_RPC_URL`, `GRYLOO_ARBITRUM_RPC_URL` | Base 8453 / Arbitrum One 42161 — Router mainnet (read-only) | `https://mainnet.base.org`, `https://arb1.arbitrum.io/rpc` | if keyed |
| `GRYLOO_SOLANA_RPC_URL` | Solana mainnet-beta (genesis-verified) — Jupiter (read-only) | `https://api.mainnet-beta.solana.com` | if keyed |
| `GRYLOO_ALCHEMY_API_KEY` | Keyed Base Sepolia provider the Supply → Borrow → Swap composition requires (public endpoints rate-limit its sequential `eth_simulateV1`; sent only as a server-side Bearer header); dev-only Base observation. Without it the composition fails closed with `LENDING_PUBLIC_CREDENTIAL_NOT_CONFIGURED` | — | **yes** |
| `LIFI_API_KEY`, `ACROSS_API_KEY`, `ACROSS_INTEGRATOR_ID`, `JUPITER_API_KEY` | Provider quotas | — | **yes** (integrator id: no) |

The Robinhood Chain Testnet endpoint has no override.

## 5. Copilot

| Variable | Purpose | Secret | Preview | Prod | Default |
| --- | --- | --- | --- | --- | --- |
| `FLOFI_COPILOT` | `off`, `replay` (committed answers, no model — traced into the deployment), `live` | no | `replay` or `live` | as chosen | `off` |
| `OPENAI_API_KEY` | Required for `live`; a dedicated project key with a spend limit | **yes** | with `live` | with `live` | — (`COPILOT_NOT_CONFIGURED`) |
| `OPENAI_COPILOT_MODEL` | Required for `live`; no built-in default, no fallback | no | with `live` | with `live` | — |
| `OPENAI_COPILOT_TEMPERATURE`, `OPENAI_COPILOT_TIMEOUT_MS`, `OPENAI_COPILOT_MAX_OUTPUT_TOKENS`, `OPENAI_COPILOT_REASONING_EFFORT` | Tuning (an invalid value makes the Copilot unavailable) | no | optional | optional | 0 / 20000 / 4096 / unset |
| `FLOFI_COPILOT_TELEMETRY` | `log` / `off`: one metadata line per live request, never content | no | optional | optional | `log` |
| `FLOFI_COPILOT_LIVE_SMOKE` | Owner-only local smoke test of a live model | no | — | — | — |

## 5b. Remote MCP gateway (BUILD-MCP-001 / BUILD-MCP-002, `POST /api/mcp`, OAuth, `/approve`)

Off unless enabled. Uses no model key. OAuth, approvals and wallet links need PostgreSQL platform state (`DATABASE_URL`,
migration `0005` within the current shipped schema), with either remote or embedded flows.
Guide: [MCP.md](MCP.md).

| Variable | Purpose | Secret | Preview | Prod | Default |
| --- | --- | --- | --- | --- | --- |
| `FLOFI_MCP` | `enabled` turns the endpoint on | no | optional | as chosen | off (`404 MCP_NOT_ENABLED`) |
| `FLOFI_MCP_OAUTH` | `enabled`: FloFi's OAuth 2.1 server for consumer clients (Claude custom connectors, ChatGPT developer mode) | no | optional | `enabled` for consumer access | off (`404 MCP_OAUTH_NOT_ENABLED`) |
| `FLOFI_PUBLIC_ORIGIN` | exact public origin (`https://…`); issuer, resource `<origin>/api/mcp`, approval links. Loopback `http://` only locally | no | with OAuth (the branch alias) | with OAuth | invalid → OAuth disabled (`MCP_OAUTH_CONFIGURATION_INVALID`) |
| `FLOFI_MCP_OAUTH_SECRET` | dedicated key material (≥ 32 chars, `openssl rand -hex 32`) for token, consent, handoff, account-cookie and IP digests; refused if equal to `API_AUTH_TOKEN` or `FLOFI_SESSION_SECRET`. Rotating it signs every MCP client out and invalidates open approvals | **yes** | with OAuth (Preview only) | with OAuth | invalid/reused → OAuth disabled |
| `FLOFI_MCP_OAUTH_ACCESS` | `invite` (default) or `open` for new pseudonymous accounts | no | `invite` | `invite` or `open` | `invite` |
| `FLOFI_MCP_OAUTH_INVITES` | SHA-256 hex digests of invite codes, comma-separated (never the codes) | digests only (keep private) | with `invite` | with `invite` | no invite accepted |
| `FLOFI_MCP_CIMD_HOSTS` | hosts whose Client ID Metadata Documents are fetched (HTTPS, public addresses, no redirects, 5 KiB, 5 s) | no | optional | optional | `claude.ai,chatgpt.com` |
| `FLOFI_MCP_OAUTH_DCR`, `FLOFI_MCP_DCR_REDIRECT_HOSTS` | narrow dynamic client registration and its redirect hosts | no | optional | optional | off; `claude.ai,chatgpt.com` |
| `FLOFI_MCP_HANDOFF_TEST_FUNDS` | `enabled`/`disabled`: test-funds strategies may be handed to their owner | no | optional | optional | `enabled` |
| `FLOFI_MCP_HANDOFF_MAINNET_NETWORKS` | mainnet ids allowed for handoffs (`base`, `arbitrum-one`, `solana`); every mainnet a workflow touches must be listed | no | **leave empty** | **leave empty in BUILD-MCP-002** | empty: `MAINNET_HANDOFF_DISABLED_BY_POLICY` |
| `FLOFI_MCP_APP` | `disabled` removes the in-chat MCP App panel (the link remains) | no | optional | optional | `enabled` |
| `FLOFI_MCP_INFRAME_WALLET_HOSTS` | MCP Apps host names on which the panel shows its in-frame environment probe (diagnostics; never executes) | no | for host experiments | empty | empty |
| `FLOFI_MCP_CLIENTS` | JSON list of `{ principal, tokenSha256, wallets? }`: SHA-256 digests of static developer bearer tokens (never the tokens) and the owner wallets each may read runs of. Must never contain the digest of `API_AUTH_TOKEN`. Optional with OAuth | digests only (keep private) | optional | **refused** (`503 MCP_CONFIGURATION_INVALID`) | invalid → `503 MCP_CONFIGURATION_INVALID` |
| `FLOFI_MCP_ALLOWED_ORIGINS` | Browser origins allowed to call it (others: `403`) | no | optional | optional | none |

## 5c. Developer API (BUILD-DEVELOPER-001, `/api/developer/v1`, `/approve`)

Off unless enabled. Uses no model key. Needs PostgreSQL platform state (`DATABASE_URL`, migrations `0006` and `0007` within the
current shipped schema), with either remote or embedded flows. Missing/unusable state answers `503 DEVELOPER_STORE_UNAVAILABLE`.
Projects and sandbox keys come from the operator CLI. Guide:
[DEVELOPER.md](DEVELOPER.md).

| Variable | Purpose | Secret | Preview | Prod | Default |
| --- | --- | --- | --- | --- | --- |
| `FLOFI_DEVELOPER` | `enabled` serves the Developer API and lets `/approve` resolve `flofi_dhs_` approval links | no | optional | as chosen | off (`404 DEVELOPER_API_NOT_ENABLED`) |
| `FLOFI_PUBLIC_ORIGIN` | exact public origin of approval links (shared with MCP, above) | no | required with the API | required with the API | invalid → `503 DEVELOPER_CONFIGURATION_INVALID` |
| `FLOFI_DEVELOPER_SECRET` | dedicated key material (32–512 chars, `openssl rand -hex 32`) for API-key digests, approval-link digests and webhook signing secrets; refused if equal to `API_AUTH_TOKEN`, `FLOFI_SESSION_SECRET`, `FLOFI_MCP_OAUTH_SECRET` or `FLOFI_CHANNEL_SECRET`. Rotating it invalidates every developer key, open developer approval link and webhook secret | **yes** | with the API (Preview only) | with the API | invalid/reused → `503 DEVELOPER_CONFIGURATION_INVALID` |
| `FLOFI_DEVELOPER_DISPATCH_TOKEN_SHA256` | SHA-256 hex of the scheduler bearer for `/api/developer/v1/internal/dispatch` (Vercel Cron: the digest of `CRON_SECRET`) | digest only | optional | optional (needs an owner-added scheduler) | unset: the route does not exist |
| `FLOFI_DEVELOPER_WEBHOOK_LOOPBACK` | `ALLOW_LOCAL_ONLY`: `http://127.0.0.1` webhook endpoints, for local tests | no | **never** | **never** (refused on hosted deployments) | off |

## 5d. Card and payment providers (Mercado Pago, Woovi) — setup in [PAYMENT_PROVIDERS.md](PAYMENT_PROVIDERS.md)

Each provider is off until all of its variables are set, and its environment must match the deployment: Production uses only
production credentials; Preview, development and local servers use only test/sandbox credentials. A mismatch disables the
provider (`*_ENVIRONMENT_MISMATCH`) instead of crossing over.

| Variable | Purpose | Secret | Dev | CI | Preview | Prod | When missing |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `MERCADO_PAGO_ENVIRONMENT` | `test` or `production` (explicit) | no | `test` | — | `test` | `production` | Add card states `CARD_TOKENIZATION_PROVIDER_REQUIRED` |
| `MERCADO_PAGO_PUBLIC_KEY` | Public key for Secure Fields; sent to the browser by a server action, never inlined | no | test key | — | test key | production key | same |
| `MERCADO_PAGO_ACCESS_TOKEN` | Server-only token for the Customers/Cards API | **yes** | test token | — | test token | production token | same |
| `WOOVI_ENVIRONMENT` | `sandbox` or `production` (explicit) | no | `sandbox` | — | `sandbox` | `production` | Woovi adapter absent: `PAYMENT_PROVIDER_NOT_CONFIGURED` |
| `WOOVI_APP_ID` | Server-only Woovi App ID (`Authorization` header) | **yes** | sandbox App ID | — | sandbox App ID | production App ID | same |
| `GRYLOO_PAYMENT` | `live` enables the stablecoin → Pix flow (quote, Simulate, Review) | no | `live` to try it | — | `live` to try it | `live` | `PAYMENT_NOT_ENABLED` |
| `GRYLOO_PAYMENT_OWNER_EXECUTION` | `MAINNET_OWNER_APPROVED` additionally allows the owner-signed USDC transfer on Base; honored **only** with `WOOVI_ENVIRONMENT=production` | no | — | — | — | owner decision | `PAYMENT_EXECUTION_NOT_ENABLED` |
| `GRYLOO_PAYMENT_JOURNAL` | Absolute directory of the local payment runs (local runtime only; hosted deployments use the cloud runtime) | no | a disposable dir | — | — | — | `PAYMENT_STORAGE_NOT_CONFIGURED` |

Base reads for verifying the owner's USDC transfer use the Router's `GRYLOO_BASE_RPC_URL` (optional HTTPS override of the public
endpoint). Woovi webhooks go to `POST /api/payments/woovi/webhook`.

Saved-card bindings are MAC'd with a key derived from `FLOFI_SESSION_SECRET` (or `API_AUTH_TOKEN`); rotating it makes saved
cards un-removable at the provider from FloFi (FloFi then removes only its own copy).

## 5e. Conversational channels (BUILD-CHANNELS-001, `/api/channels/*`, `/approve`)

Off unless a provider is enabled. Every channel is an entry point with **zero financial authority**: it composes a proposal and
hands it to the owner on `/approve`; the owner's wallet proof, FloFi's fresh simulation, the Strategy Manifest Review and the owner's
own signature remain the only path to execution. Needs PR #71's shared PostgreSQL platform state host (schema migrated through
`0009_channel_conversations`; a Preview build applies it with `FLOFI_MIGRATE_ON_BUILD=preview`). Embedded and remote-flow deployments
reuse that host; `DATABASE_URL` hosts channel/approval state independently of `API_BASE_URL`. Without ready durable state, every channel route
answers `503 CHANNEL_STORE_UNAVAILABLE` / `CHANNEL_SCHEMA_NOT_INSTALLED`. Any invalid value disables what it configures (fail
closed). All server-only, never `NEXT_PUBLIC_*`. Guides: [TELEGRAM.md](TELEGRAM.md), [WHATSAPP.md](WHATSAPP.md), owner test:
[CHANNELS-OWNER-E2E.md](CHANNELS-OWNER-E2E.md), [universal signing and host/wallet acceptance](UNIVERSAL-SIGNING-OWNER-E2E.md).

**Channel Core** (shared by every provider)

| Variable | Purpose | Secret | Preview | Prod | Default |
| --- | --- | --- | --- | --- | --- |
| `FLOFI_CHANNEL_SECRET` | Channel Core key material (32–512 chars, `openssl rand -hex 32`): HKDF keys for sealing, keyed digests and the `flofi_chs_` approval links. Refused if equal to `API_AUTH_TOKEN`, `FLOFI_SESSION_SECRET`, `FLOFI_MCP_OAUTH_SECRET` or any provider secret | **yes** | required with a channel | required with a channel | invalid → `503` |
| `FLOFI_PUBLIC_ORIGIN` | (shared with §5b/§5c) the exact `https://` origin of the `/approve` links and of the webhooks; loopback `http://` only when not hosted | no | required | required | invalid → `503` |
| `FLOFI_CHANNEL_SUPPORT_CONTACT` | human escalation path shown at first contact and in HELP (e-mail or `https://` URL) | no | required | required | invalid → `503` |
| `FLOFI_CHANNEL_PRIVACY_URL` | privacy policy shown at first contact and in HELP (`https://`) | no | required | required | invalid → `503` |
| `FLOFI_CHANNEL_COPILOT` | `enabled`/`disabled`: natural language through the existing Copilot boundary (also needs `FLOFI_COPILOT`); `disabled` = exact commands only, no model call | no | optional | optional | `enabled` |
| `FLOFI_CHANNEL_SIMULATION` | `enabled`/`disabled`: the read-only simulation preview in the reply (FloFi always simulates again on `/approve`) | no | optional | optional | `enabled` |
| `FLOFI_CHANNEL_LANGUAGE` | `EN`/`PT` default reply language | no | optional | optional | `EN` |
| `FLOFI_CHANNEL_HANDOFF_TEST_FUNDS` | `enabled`/`disabled`: test-funds proposals may be handed to their owner | no | optional | optional | `enabled` |
| `FLOFI_CHANNEL_HANDOFF_MAINNET_NETWORKS` | mainnet ids a channel proposal may be handed over on | no | **leave empty** | **leave empty** | empty: mainnet refused by policy |
| `FLOFI_CHANNEL_DISPATCH_TOKEN_SHA256` | SHA-256 hex of the scheduler bearer for `/api/channels/dispatch` and `/api/channels/health` (Vercel Cron: the digest of `CRON_SECRET`; `channels-admin.ts dispatch-token` creates both) | digest only | recommended | **required** for retries and status without an open page | unset: both endpoints `404` |

**Telegram** (the live provider; a plain bot, no Mini App)

| Variable | Purpose | Secret | Preview | Prod | Default |
| --- | --- | --- | --- | --- | --- |
| `FLOFI_TELEGRAM` | `enabled` serves `/api/channels/telegram` | no | as chosen | as chosen | off (`404 TELEGRAM_NOT_ENABLED`) |
| `TELEGRAM_BOT_TOKEN` | the bot token from @BotFather (`<bot id>:<secret>`); also used by the operator CLI from your shell | **yes** | with Telegram | with Telegram | invalid → `503` |
| `TELEGRAM_WEBHOOK_SECRET` | the `secret_token` registered with setWebhook (32–256 of `A-Z a-z 0-9 _ -`, `openssl rand -hex 32`); Telegram echoes it in `X-Telegram-Bot-Api-Secret-Token` | **yes** | with Telegram | with Telegram | invalid → `503` |
| `FLOFI_TELEGRAM_ALLOWED_USERS` | SHA-256 hex digests (comma-separated, ≤ 256) of allowed Telegram user ids; others get no reply and a content-free record | digests only | with Telegram | with Telegram | empty: deny all |
| `FLOFI_TELEGRAM_API_BASE` | loopback Bot API double for tests (`http://127.0.0.1:<port>`) | no | **never** | **never** (refused when hosted) | `https://api.telegram.org` |

**WhatsApp** (implemented in full; live activation blocked by owner decision D1 until written clearance is recorded in code)

| Variable | Purpose | Secret | Preview | Prod | Default |
| --- | --- | --- | --- | --- | --- |
| `FLOFI_WHATSAPP` | `enabled` serves `/api/channels/whatsapp` | no | **unset** | **unset** | off (`404 WHATSAPP_NOT_ENABLED`) |
| `FLOFI_WHATSAPP_PROVIDER` | `fixture` (render, record, send nothing; never on a hosted deployment) or `live` (the Cloud API; only with recorded clearance) | no | — | — | `fixture` |
| `FLOFI_WHATSAPP_POLICY_CLEARANCE` | live only: must equal the clearance reference recorded in `src/channels/whatsapp/config.ts` by a reviewed change (none today: `WHATSAPP_LIVE_PROVIDER_NOT_CLEARED`) | no | — | — | unset |
| `FLOFI_WHATSAPP_ALLOWED_SENDERS` | SHA-256 hex digests (comma-separated, ≤ 256) of allowed senders' BSUID or phone digits; others get no reply and a content-free record | digests only | — | — | empty: deny all |
| `WHATSAPP_APP_SECRET`, `WHATSAPP_APP_SECRET_PREVIOUS` | the Meta app secret(s) verifying `X-Hub-Signature-256` over the raw body (rotation: current + previous) | **yes** | — | — | invalid → `503` |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | the subscription verification token (≥ 32 chars, distinct from the app secret) | **yes** | — | — | invalid → `503` |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID` | the only number and account whose deliveries are read; others are dropped | no | — | — | invalid → `503` |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_GRAPH_API_VERSION` | the Cloud API transport (system-user token; `vNN.0`); required for `live` | **yes** (token) | — | — | unset |
| `WHATSAPP_NOTIFICATION_TEMPLATE` | `<name>:<language>` of an approved Utility template with one body variable, for status notifications after the 24-hour window | no | — | — | unset: nothing is sent outside the window |

## 5f. Automations (BUILD-AUTOMATION-001, `/app/automations`, `/v1/automations/*`, `/v1/approvals/*`, `/api/automations/*`, `/approve`)

Off unless enabled. **Automated evaluation and owner-confirmed execution** (`CONFIRM_EACH_TIME`): FloFi evaluates schedules and price
conditions and asks the owner; the scheduler, the price source and every notification have zero financial authority, and execution
still needs `/approve` → wallet proof → fresh simulation → Strategy Manifest Review → the owner's own signature. Needs PostgreSQL migrated
through `0010_automations` (`AUTOMATION_SCHEMA_NOT_INSTALLED` otherwise). Any invalid value disables automations on that process only
(fail closed). All server-only, never `NEXT_PUBLIC_*`. Guide: [AUTOMATIONS.md](AUTOMATIONS.md).

**Where the variables go.** In **standard production** (Vercel BFF → Railway API → Neon + Railway worker) the **API** holds the
automation configuration and serves the workspace and automation approval links; the **worker** evaluates (its 60 s sweep is the
scheduler); **Vercel needs nothing new** (its `API_BASE_URL` / `API_AUTH_TOKEN` carry the calls; PR #71's platform-state
`DATABASE_URL` on Vercel is not used by automations). On an **embedded** web runtime (e.g. a
Preview) the web deployment holds the API's column and, without a worker, the optional dispatch.

| Variable | Purpose | Secret | Railway API (prod) | Railway worker (prod) | Embedded web (Preview) | Default |
| --- | --- | --- | --- | --- | --- | --- |
| `FLOFI_AUTOMATIONS` | `enabled` loads the automation routes (API), handlers and sweep (worker), or the workspace and dispatch (embedded web) | no | **set** | **set** | as chosen | off |
| `FLOFI_AUTOMATION_SECRET` | 32–512 chars (`openssl rand -hex 32`): HKDF keys of the approval-link scheme and the Telegram link codes. Refused if equal to `API_AUTH_TOKEN`, `FLOFI_SESSION_SECRET`, `FLOFI_MCP_OAUTH_SECRET`, `FLOFI_DEVELOPER_SECRET` or `FLOFI_CHANNEL_SECRET` | **yes** | **set** | **never** | with automations | invalid → disabled |
| `FLOFI_PUBLIC_ORIGIN` | (shared) the web origin of `/approve` and of notification links | no | the Vercel origin | the Vercel origin | required | invalid → disabled |
| `FLOFI_AUTOMATION_DISPATCH_TOKEN_SHA256` | SHA-256 hex of the bearer of the optional `/api/automations/dispatch` and `/health` (Vercel Cron: the digest of `CRON_SECRET`) | digest only | — | — | only for the optional dispatch | unset: both `404` |
| `FLOFI_AUTOMATION_HANDOFF_TEST_FUNDS` | `enabled`/`disabled`: test-funds proposals may be handed to their owner | no | optional | — | optional | `enabled` |
| `FLOFI_AUTOMATION_HANDOFF_MAINNET_NETWORKS` | mainnet ids an automation may hand to its owner | no | **leave empty** | — | **leave empty** | empty: mainnet refused by policy |
| `FLOFI_AUTOMATION_PRICE_SOURCE` | `off`, `chainlink` (read-only Base mainnet feeds) or `fixture` (tests only; refused when hosted) | no | same as worker (observable assets only; the API never queries a price) | as chosen | as chosen | `off`: price rules never trigger |
| `FLOFI_AUTOMATION_CHAINLINK_FEEDS` | `ETH=0x…,BTC=0x…,SOL=0x…`: Chainlink USD proxy addresses on **Base mainnet**, copied from data.chain.link; each is verified on-chain (chain 8453, `description()` = `<ASSET> / USD`, decimals) before use | no | with `chainlink` | with `chainlink` | with `chainlink` | — |
| `FLOFI_AUTOMATION_CHAINLINK_RPC_URL` | Base mainnet JSON-RPC (`https://`, no userinfo); only `eth_chainId` and `eth_call` are ever sent | if keyed | with `chainlink` | recommended (keyed) | optional | `GRYLOO_BASE_RPC_URL`, else `https://mainnet.base.org` |
| `FLOFI_AUTOMATION_PRICE_MAX_AGE_SECONDS` | an observation older than this (by the feed's own `updatedAt`) is stale and ignored | no | same as worker | optional | optional | `3600` |
| `FLOFI_AUTOMATION_PRICE_FIXTURE` | fixture source: absolute path under `/tmp/` | no | **never** | **never** | **never** | — |
| `FLOFI_AUTOMATION_TEST_CLOCK` | `enabled`: the bearer dispatch accepts `x-flofi-automation-now` (browser tests) | no | — | — | **never** (refused when hosted) | off |
| Channels Telegram variables (§5e) | Telegram notifications through Channel Core in the processes that serve automations | as §5e | — (not set in standard production: Telegram stays unavailable for automations, although PR #71 runs Channel Core on Vercel) | only to deliver notifications for an embedded web runtime | as §5e | no Telegram |

The worker never needs `FLOFI_AUTOMATION_SECRET`, the dispatch digest or the handoff policy variables: it mints no approval, links no
chat and serves no route. Startup logs: `automation.api_enabled` / `automation.api_disabled` (API), `automation.worker_enabled` /
`automation.worker_disabled` (worker); a disabled or failed load leaves every other route and the reconciliation running.

## 5g. Delegated execution (BUILD-AUTOMATION-002, Passkeys, Credentials → Automatic execution, `/v1/delegation/*`, `/api/delegation/dispatch`)

Off by default and fully opt-in on top of §5f. **Standard production sets none of these**, and if it did, nothing would execute:
no production custody provider (KMS/HSM) exists, so a hosted deployment refuses every session-signer provider and reports
`DELEGATED_SIGNER_UNAVAILABLE`. "Automatic within limits" is then shown as unavailable. `CONFIRM_EACH_TIME` is unchanged. Any malformed
value disables the feature (`DELEGATION_CONFIGURATION_INVALID`); nothing falls back to another mode, transport or signer.

| Variable | Purpose | Secret | Railway API (prod) | Railway worker (prod) | Embedded web / local rehearsal | Default |
| --- | --- | --- | --- | --- | --- | --- |
| `FLOFI_DELEGATION` | `enabled` serves the owner operations: passkeys, execution Credentials, delegated automations and their one authorization. These authorize nothing without an executor | no | leave unset | leave unset | as chosen | off |
| `FLOFI_PASSKEY_ORIGIN` | origin passkeys are registered for and assert; its host is the WebAuthn RP id (must be a domain, not an IP; `https://` when hosted) | no | — | — | with delegation | `FLOFI_PUBLIC_ORIGIN` |
| `FLOFI_DELEGATION_RPC_<chainId>` | per-EVM-chain read/submit JSON-RPC in production mode (`https://`, no userinfo), e.g. `FLOFI_DELEGATION_RPC_84532` | if keyed | — | — | with delegation | unset: that chain is unavailable |
| `FLOFI_DELEGATED_SIGNER` | the session-signer provider: `none`, `local-disposable` or `memory`. The last two are refused on hosted deployments (not production custody) | no | **never** | **never** | rehearsal only | `none` |
| `FLOFI_DELEGATED_SIGNER_DIR` | `local-disposable` only: an absolute directory under `/tmp/` (keys in mode-0600 files, outside Git) | no | **never** | **never** | rehearsal only | — |
| `FLOFI_DELEGATED_EXECUTION` | `enabled` runs the delegated executor in this process (requires a signer provider) | no | **never** | **never** (blocked: no custody) | rehearsal only | off |
| `FLOFI_DELEGATION_DISPATCH_TOKEN_SHA256` | SHA-256 hex of the bearer of the optional `/api/delegation/dispatch` (embedded executor without a worker) | digest only | — | — | optional | unset: `404` |
| `FLOFI_DELEGATION_HARNESS` / `_URL` | `MOCKED_LOOPBACK_ONLY` and a `http://127.0.0.1:<port>` URL: every chain is the loopback chain double (tests and rehearsals; refused when hosted) | no | **never** | **never** | tests only | off |

The executor is a separate durable work kind (`delegation.execute`). It never shares the AUTOMATION-001 dispatch or the existing
flows' worker, which keep `WORKER_SUBMISSION_FORBIDDEN`. Startup logs: `delegation.api_enabled` / `delegation.api_disabled` and
`delegation.worker_enabled` / `delegation.worker_disabled`.

## 6. Platform-provided (read, never set by hand)

`VERCEL` (`1`: hosted), `VERCEL_ENV` (`production`/`preview`/`development`), `VERCEL_GIT_COMMIT_REF` (Preview tenant derivation),
`VERCEL_GIT_COMMIT_SHA` (reported by readiness), `VERCEL_DEPLOYMENT_ID` (lease holder label), `VERCEL_REGION` (readiness),
`RAILWAY_PROJECT_ID` / `RAILWAY_ENVIRONMENT_ID` (hosted detection), `NODE_ENV`.

## 7. Local, CI and rehearsal only — never set on a hosted deployment

These select local journals, loopback MOCKED harnesses or local forks. On a hosted deployment they are refused: journals and
`/tmp` state are never used, harness gates leave the flow `off`, and fork/demo actions report themselves unavailable.

`GRYLOO_*_HARNESS=MOCKED_LOOPBACK_ONLY` (supply, lending, Jupiter, Solana Devnet, Robinhood, Uniswap liquidity, Router, Router testnet, card
provider — `GRYLOO_CARD_HARNESS` points Add card at the loopback Mercado Pago stand-in on 127.0.0.1:8555),
`GRYLOO_*_JOURNAL` (supply, public testnet, Robinhood, Jupiter, Solana Devnet, Uniswap liquidity, Router, Router testnet, liquidity,
Mode A, bridge), `GRYLOO_PUBLIC_TESTNET_READ`, `GRYLOO_BASE_OBSERVATION=live`, `GRYLOO_MODE_A`/`_PROFILE`, `GRYLOO_MODE_B`/`_PROFILE`/
`_EXECUTOR_KEY_FILE`/`_SMOKE_PROFILE`, `GRYLOO_COMPOSITION_MODE`/`_PROFILE`/`_EXECUTOR_KEY_FILE`/`_ALLOW_MOCKED_UI`/`_SMOKE_PROFILE`,
`GRYLOO_LIQUIDITY`/`_PROFILE`, `GRYLOO_COW`/`GRYLOO_COW_RUNTIME`, `GRYLOO_BRIDGE`, `FLOFI_DEVELOPER_WEBHOOK_LOOPBACK`, `FLOFI_TELEGRAM_API_BASE` (loopback Bot API double), `GRYLOO_CHANNEL_E2E`, and the
browser-suite selectors `GRYLOO_*_E2E`,
`GRYLOO_CLOUD_RUNTIME_E2E`, `FLOFI_E2E_*`, `TEST_DATABASE_URL`, `BUILD002_BROWSER_CACHE`, `GRYLOO_ANVIL_BIN`.
`GRYLOO_BASE_OBSERVATION=replay` is the one safe value on a deployment (it serves committed recordings).
