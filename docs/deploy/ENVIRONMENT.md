# Flofi runtime environment reference (BUILD-CLOUD-PARITY-001)

Every variable the reference app, the backend and the build read, per environment. Values are supplied by the hosting platform or
your own shell; none is committed. **No variable is `NEXT_PUBLIC_*`, and none may be**: everything below is read on the server,
and the browser only talks to its own origin (CSP `connect-src 'self'`).

Columns: **Dev** = local `next dev`/`next start` on WSL; **CI** = the GitHub Actions suites; **Preview** = a Vercel Preview
deployment; **Prod** = Vercel Production + the Railway API/worker. `—` means leave unset. "Hosted" means Vercel, Railway or
`FLOFI_DEPLOYMENT=hosted`.

## 1. Runtime selection and durable state

| Variable | Purpose | Secret | Where | Dev | CI | Preview | Prod | Default / when missing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `API_BASE_URL` | Forward every cloud flow to the remote Flofi API (`remote` runtime). HTTPS only (loopback HTTP allowed for tests). | no | Vercel | — | tests set a loopback URL | — (see note 1) | **required** (Railway API URL) | unset: embedded or local runtime |
| `API_AUTH_TOKEN` | Bearer token between the BFF and the API (≥ 32 chars); also keys wallet sessions when `FLOFI_SESSION_SECRET` is unset. | **yes** | Vercel + API | — | test value | — | **required** (same value on both) | API refuses to start in production without it |
| `DATABASE_URL` | PostgreSQL. API/worker: required. Vercel: selects the **embedded** runtime on a hosted deployment. Use the provider's **pooled** endpoint, `sslmode=require`. | **yes** | API, worker, Vercel (embedded) | — (or with `FLOFI_RUNTIME=embedded`) | disposable loopback DBs only | **required** for a working Preview — a database separate from Production | API/worker: **required**; Vercel: — | hosted without it and without `API_BASE_URL`: every flow `CLOUD_RUNTIME_NOT_CONFIGURED` |
| `DATABASE_MIGRATION_URL` | Direct (unpooled) URL used only by `migrate`. | **yes** | API pre-deploy, Vercel build | — | — | optional | recommended | `DATABASE_URL` |
| `DATABASE_POOL_MAX` | Connections per process. Embedded runtime: 1–20, default 3; API/worker: 1–100, default 10. | no | all servers | — | — | optional | optional | 3 (Vercel) / 10 (API) |
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

Off unless enabled. Uses no model key. OAuth, approvals and wallet links need the embedded runtime (PostgreSQL, migration `0005`).
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

## 6. Platform-provided (read, never set by hand)

`VERCEL` (`1`: hosted), `VERCEL_ENV` (`production`/`preview`/`development`), `VERCEL_GIT_COMMIT_REF` (Preview tenant derivation),
`VERCEL_GIT_COMMIT_SHA` (reported by readiness), `VERCEL_DEPLOYMENT_ID` (lease holder label), `VERCEL_REGION` (readiness),
`RAILWAY_PROJECT_ID` / `RAILWAY_ENVIRONMENT_ID` (hosted detection), `NODE_ENV`.

## 7. Local, CI and rehearsal only — never set on a hosted deployment

These select local journals, loopback MOCKED harnesses or local forks. On a hosted deployment they are refused: journals and
`/tmp` state are never used, harness gates leave the flow `off`, and fork/demo actions report themselves unavailable.

`GRYLOO_*_HARNESS=MOCKED_LOOPBACK_ONLY` (supply, lending, Jupiter, Solana Devnet, Robinhood, Uniswap liquidity, Router, Router testnet),
`GRYLOO_*_JOURNAL` (supply, public testnet, Robinhood, Jupiter, Solana Devnet, Uniswap liquidity, Router, Router testnet, liquidity,
Mode A, bridge), `GRYLOO_PUBLIC_TESTNET_READ`, `GRYLOO_BASE_OBSERVATION=live`, `GRYLOO_MODE_A`/`_PROFILE`, `GRYLOO_MODE_B`/`_PROFILE`/
`_EXECUTOR_KEY_FILE`/`_SMOKE_PROFILE`, `GRYLOO_COMPOSITION_MODE`/`_PROFILE`/`_EXECUTOR_KEY_FILE`/`_ALLOW_MOCKED_UI`/`_SMOKE_PROFILE`,
`GRYLOO_LIQUIDITY`/`_PROFILE`, `GRYLOO_COW`/`GRYLOO_COW_RUNTIME`, `GRYLOO_BRIDGE`, and the browser-suite selectors `GRYLOO_*_E2E`,
`GRYLOO_CLOUD_RUNTIME_E2E`, `FLOFI_E2E_*`, `TEST_DATABASE_URL`, `BUILD002_BROWSER_CACHE`, `GRYLOO_ANVIL_BIN`.
`GRYLOO_BASE_OBSERVATION=replay` is the one safe value on a deployment (it serves committed recordings).
