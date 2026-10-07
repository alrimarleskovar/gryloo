# Flofi cloud deployment (BUILD-CLOUD-001)

Flofi runs as a modular monolith in three process types built from this repository:

| Process | Command | Scale | Initial host |
| --- | --- | --- | --- |
| Frontend + BFF (Next.js) | Vercel build of `apps/reference-dapp` | N (serverless) | Vercel |
| API | `node apps/reference-dapp/backend/main.ts api` | N replicas | Railway service `flofi-api` |
| Worker | `node apps/reference-dapp/backend/main.ts worker` | N replicas | Railway service `flofi-worker` |
| Migrations | `node apps/reference-dapp/backend/main.ts migrate` | one-shot | Railway pre-deploy of `flofi-api` |

PostgreSQL (initially Neon) is the only source of truth for execution state. Evidence exports go to an
S3-compatible bucket. No component holds a key, signs, or submits transactions: the owner's browser wallet
does, after the API has durably recorded PREPARED and SUBMITTING. Every provider below is replaceable by
configuration; nothing in the financial core references a vendor.

## Environment reference

All values are secrets or configuration supplied by the hosting platform. Never commit them.

### API and worker (Railway)

| Variable | Required | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL URL used at runtime. Neon: the **pooled** connection string with `sslmode=require`. |
| `DATABASE_MIGRATION_URL` | recommended | Direct (unpooled) URL used only by `migrate`. Defaults to `DATABASE_URL`. |
| `DATABASE_POOL_MAX` | no | Connections per process (default 10). Keep `replicas × pool` under the database limit. |
| `API_AUTH_TOKEN` | API, yes in production | Bearer token the BFF presents. ≥32 characters (`openssl rand -hex 32`). The API refuses to start in production without it. |
| `NODE_ENV` | yes | `production` (set by the Docker image). |
| `PORT`, `HOST` | no | Listener (Railway injects `PORT`; default `0.0.0.0:8080`). |
| `TENANT_ID` | no | Tenant for this deployment (default `default`). |
| `WORKER_ID`, `WORKER_CONCURRENCY` | no | Worker identity in logs/leases (default host-pid-random) and parallel items (default 4). |
| `OBJECT_STORE_ENDPOINT` | worker, yes | S3-compatible HTTPS endpoint, e.g. `https://<account>.r2.cloudflarestorage.com` or `https://s3.<region>.amazonaws.com`. |
| `OBJECT_STORE_BUCKET` | worker, yes | Bucket for evidence objects (private). |
| `OBJECT_STORE_REGION` | no | Signing region (`auto` for R2; the AWS region for S3). |
| `OBJECT_STORE_ACCESS_KEY_ID`, `OBJECT_STORE_SECRET_ACCESS_KEY` | worker, yes | Credentials scoped to that bucket only (read + write objects). Set on the API too to serve verified evidence. |
| `OBJECT_STORE_FORCE_PATH_STYLE` | no | `false` for virtual-hosted style; default path style. |
| `OBJECT_STORE_PREFIX` | no | Key prefix inside the bucket. |
| `EVIDENCE_DIRECTORY` | dev only | Local filesystem evidence store instead of object storage. |
| `GRYLOO_ROBINHOOD_TESTNET=live` | to enable | Robinhood Chain Testnet read-only RPC for the self-transfer flow. |
| `GRYLOO_SUPPLY_TESTNET=live` | to enable | Base Sepolia read-only RPC for the Aave Supply/Borrow/Repay/Withdraw flow. |
| `GRYLOO_SOLANA_DEVNET=live` | to enable | Solana Devnet read/relay transport for the Orca swap and Orca liquidity flows (valueless test tokens). `GRYLOO_SOLANA_DEVNET_RPC_URL` optionally names an HTTPS Devnet RPC; `GRYLOO_SOLANA_DEVNET_EXECUTION=DISABLED` keeps them Simulate/Review-only. |
| `GRYLOO_JUPITER=live` | to enable | Jupiter mainnet-beta **Simulate/Review only**. `JUPITER_API_KEY` (secret) and `GRYLOO_SOLANA_RPC_URL` are optional. Real-funds execution additionally requires the owner's explicit `GRYLOO_JUPITER_OWNER_EXECUTION=MAINNET_OWNER_APPROVED`; never set it for a demo. |
| `GRYLOO_PUBLIC_TESTNET=record` | to enable | Base Sepolia read-only RPC for the exact-profile Uniswap v3 USDC/WETH swap (the public online swap acceptance path). |
| `GRYLOO_UNISWAP_LIQUIDITY_TESTNET=live` | to enable | Base Sepolia read-only RPC (`eth_simulateV1`, receipts, nonce discovery) for the Uniswap v3 USDC/WETH concentrated-liquidity flow (`uniswap-liquidity`; test tokens, owner wallet signs each approval and the mint). `GRYLOO_BASE_SEPOLIA_RPC_URL` optionally names an HTTPS Base Sepolia RPC that supports `eth_simulateV1`; `GRYLOO_UNISWAP_LIQUIDITY_EXECUTION=DISABLED` keeps it Simulate/Review-only. No new service, database migration or secret. |
| `GRYLOO_ROUTER=live` | to enable | Cross-chain Router (`crosschain-router`, BUILD-ROUTER-001): Base mainnet → Arbitrum One USDC through LI.FI or direct Across, **quotes, simulation and Review only**. Read-only Base/Arbitrum RPC (`eth_simulateV1`, `eth_getLogs`, receipts) and server-side LI.FI/Across quote and status reads. The public Base RPC rate-limits `eth_call` bursts (HTTP 429), so set `GRYLOO_BASE_RPC_URL` (and optionally `GRYLOO_ARBITRUM_RPC_URL`) to keyed HTTPS endpoints that support `eth_simulateV1`. `ACROSS_API_KEY`, `ACROSS_INTEGRATOR_ID` (`0x` + 4 hex) and `LIFI_API_KEY` are optional secrets. Real-funds execution additionally requires the owner's explicit `GRYLOO_ROUTER_OWNER_EXECUTION=MAINNET_OWNER_APPROVED` on both API and worker; never set it for a demo. No new service, database migration or required secret. |
| `GRYLOO_ROUTER_TESTNET=live` | to enable | BUILD-JOURNEY-001 permissionless journey: the same Cross-chain Router on public testnets (`crosschain-router-testnet`), Base Sepolia → Arbitrum Sepolia **test USDC**, quotes, simulation, Review and owner-wallet execution for **any** signed-in wallet (no allowlist, no operator step). Public read-only RPCs by default (`https://sepolia.base.org`, `https://sepolia-rollup.arbitrum.io/rpc`); `GRYLOO_BASE_SEPOLIA_RPC_URL` / `GRYLOO_ARBITRUM_SEPOLIA_RPC_URL` optionally name keyed HTTPS endpoints (the Base Sepolia one must support `eth_simulateV1`). LI.FI and the Across **testnet** API are queried server-side; `LIFI_API_KEY` is optional. `GRYLOO_ROUTER_TESTNET_EXECUTION=DISABLED` keeps it Simulate/Review-only. Set it on **both** API and worker. Migration `0004` (an index) runs in the normal pre-deploy `migrate`. No new service or required secret. |

A flow without its enablement variable answers `*_PUBLIC_TESTNET_NOT_ENABLED`. The `*_HARNESS=MOCKED_LOOPBACK_ONLY`
variables exist only for tests and must never be set in a deployment.

### Frontend (Vercel, server-side only — never `NEXT_PUBLIC_*`)

| Variable | Meaning |
| --- | --- |
| `API_BASE_URL` | Public HTTPS URL of `flofi-api`, e.g. `https://flofi-api-production.up.railway.app`. Setting it switches every cloud-backed flow's server actions (Base Sepolia swap, Base Sepolia Uniswap liquidity, Aave Supply family, Robinhood transfer, Solana Devnet swap and liquidity, Jupiter, Cross-chain Router) to forward to the API. |
| `API_AUTH_TOKEN` | Same value as the API's token. It also keys the wallet-session cookies (HKDF, separate label) unless `FLOFI_SESSION_SECRET` is set. |
| `FLOFI_SESSION_SECRET` | Optional, ≥ 32 characters (`openssl rand -hex 32`): a key for the wallet-session cookies separate from `API_AUTH_TOKEN`. Rotating it signs every wallet out (no funds or runs are affected). |
| `FLOFI_COPILOT` | Optional. `off` (default), `live` (AI interpretation through the OpenAI Responses API) or `replay` (committed test answers, no model; not for production). |
| `OPENAI_API_KEY` | Required for `FLOFI_COPILOT=live`. Server-only; never `NEXT_PUBLIC_*`. Use a dedicated OpenAI project key with a spend limit. |
| `OPENAI_COPILOT_MODEL` | Required for `FLOFI_COPILOT=live`: the model ID the owner chooses (no built-in default). It must support strict JSON-schema structured outputs in the Responses API. |
| `OPENAI_COPILOT_TEMPERATURE` | Optional, default `0`; set `omit` for models that reject the parameter. |
| `OPENAI_COPILOT_TIMEOUT_MS` | Optional (BUILD-COPILOT-002), 5000–60000, default 20000. An invalid value makes the Copilot unavailable rather than using another limit. |
| `OPENAI_COPILOT_MAX_OUTPUT_TOKENS` | Optional (BUILD-COPILOT-002), 256–16384, default 4096 for the conversational protocol. Reasoning models count reasoning tokens here. |
| `OPENAI_COPILOT_REASONING_EFFORT` | Optional (BUILD-COPILOT-002): `minimal`, `low`, `medium` or `high`, sent only when set and only for models that accept it. |
| `FLOFI_COPILOT_TELEMETRY` | Optional (BUILD-COPILOT-002): `log` or `off`. By default live requests log one metadata line each (model, outcome code, intent kind, duration, token counts); never prompts, transcripts, addresses, cookies or keys. |

**Wallet sessions (BUILD-JOURNEY-001).** A user signs one EIP-4361 message with their own wallet (`personal_sign`); the BFF
verifies the signer and sets HttpOnly, SameSite=Strict, Secure cookies (8 h session, 5 min challenge). The verified address
is forwarded to the API in the server-to-server `x-flofi-wallet-principal` header; Router runs are bound to it, so a wallet
only sees and operates its own runs (`/v1/runs*` are filtered to it). Requests made with the bearer token but no principal
(operators) keep tenant-wide read access. The session never authorizes a transaction: every wallet request still needs the
user's Review, Manifest acceptance, Execute click and signature.

**Flofi Copilot (BUILD-COPILOT-001).** With `FLOFI_COPILOT=live`, text that the exact chat grammar does not recognize is
sent from the Next.js server (never the browser) to `https://api.openai.com/v1/responses` with strict structured output,
no tools and `store: false`. The answer is an untrusted intent: Flofi validates it, checks every amount, address and
mainnet against the user's own words, and turns it into an exact-grammar command that the user still has to apply,
simulate, review and sign. A misconfigured `live` mode (missing key or model) leaves the exact grammar working and
reports `COPILOT_NOT_CONFIGURED`. The per-process limits (2 concurrent, 30 per minute) are not a global quota on
serverless instances; rely on the OpenAI project's spend limit.

**Conversational Copilot (BUILD-COPILOT-002).** The browser now sends a bounded transcript (≤ 16 messages, ≤ 8 user turns)
with `version: '2'` and receives a strict `CopilotIntentV2`. The model never receives the workflow, wallet addresses or
Flofi state; Flofi resolves references, writes read-only answers and builds proposals itself. There is still no default
model and no model fallback. Before enabling it in production, run the owner-only smoke test once with the chosen model:
`FLOFI_COPILOT_LIVE_SMOKE=1 FLOFI_COPILOT=live OPENAI_API_KEY=… OPENAI_COPILOT_MODEL=… pnpm test:copilot-live` (local shell; the
key stays in your environment). It checks that the strict schema is accepted and prints latency and token counts. It
makes no blockchain request.

The browser keeps talking only to its own origin (CSP `connect-src 'self'`). Flows that are not cloud-enabled
keep their existing `GRYLOO_*` gates; leave those unset on Vercel. Since BUILD-CLOUD-PARITY-001 a hosted deployment also
refuses them itself: local journals and `/tmp` state are never used, MOCKED harness gates leave a flow `off`, and the
local-only rehearsals (the BUILD-010 Across demo, CoW loopback, the BUILD-008 bridge, local forks) report themselves
unavailable. The Supply → Borrow → Swap composition runs on the cloud runtime as flow `lending-composition` (enabled with
`GRYLOO_SUPPLY_TESTNET=live`, on the Aave family's shared storage) and needs the keyed `GRYLOO_ALCHEMY_API_KEY`.

## Vercel Preview on the embedded runtime (BUILD-CLOUD-PARITY-001)

Railway deploys `main` only, so a Preview that forwards to the Railway API runs `main`'s backend and shares Production's
tenant. A Preview can instead run the **same backend inside its own Vercel functions** (`src/server/flow-runtime.ts`): set a
`DATABASE_URL` and no `API_BASE_URL`. Every request may land on a different function instance; all execution state, leases,
idempotency and evidence live in PostgreSQL. Each Preview branch gets its own tenant (`pv-<branch>-<hash>`), sessions are bound
to the Preview's host, and nothing signs or submits: the user's wallet does. The complete variable reference is
[ENVIRONMENT.md](ENVIRONMENT.md).

Owner setup, once (Vercel → Project `flofi` → Settings):

1. **Database**: a PostgreSQL database that is **not** Production's (for example the Neon integration, which creates a
   branch per Preview). Environment Variables → *Preview* only: `DATABASE_URL` (pooled), optionally `DATABASE_MIGRATION_URL`
   (direct), and `FLOFI_MIGRATE_ON_BUILD=preview` so each Preview build applies the shipped migrations itself.
2. **Session**: `FLOFI_SESSION_SECRET` (Preview only; `openssl rand -hex 32`).
3. **Capabilities** (Preview only): `GRYLOO_PUBLIC_TESTNET=record`, `GRYLOO_UNISWAP_LIQUIDITY_TESTNET=live`,
   `GRYLOO_SUPPLY_TESTNET=live`, `GRYLOO_ETHEREUM_SEPOLIA_TRANSFER=live`, `GRYLOO_ROBINHOOD_TESTNET=live`,
   `GRYLOO_ROUTER_TESTNET=live`, `GRYLOO_SOLANA_DEVNET=live`; optionally `FLOFI_COPILOT=live` with `OPENAI_API_KEY` and
   `OPENAI_COPILOT_MODEL`, `GRYLOO_ALCHEMY_API_KEY` for the lending composition, and keyed RPC overrides (recommended:
   the public Base Sepolia endpoint drops read bursts from Vercel's shared egress). Make sure `API_BASE_URL` is **not** set for
   Preview.
4. **Reachability**: Deployment Protection → disable Vercel Authentication for Preview deployments, or create a *Protection
   Bypass for Automation* secret for automated checks (keep it in your own shell as `VERCEL_AUTOMATION_BYPASS_SECRET`).
5. Redeploy the Preview. Check `https://<preview>/api/flofi/readiness?probe=networks`: `runtime.status` must be `READY`, each
   enabled flow `live`, each network `REACHABLE`. `node scripts/cloud-preview-smoke.mjs https://<preview>` runs the same
   read-only checks plus read-only server actions; `FLOFI_CLOUD_PARITY_ORIGIN=https://<preview> pnpm test:cloud-remote` sweeps
   every capability (no-signature Simulates and fail-closed probes). Previews are reachable on the branch alias
   (`flofi-git-<branch>-…vercel.app`) when protection exempts it.

A user then needs no terminal: open the Preview URL → connect a wallet → select the testnet → author → Simulate → Review the
Manifest → sign in the wallet. Reconciliation is request-driven on the embedded runtime (reopening a run observes the chain);
there is no background worker on a Preview, and Vercel Cron does not run for Previews.

## Remote MCP gateway (BUILD-MCP-001, BUILD-MCP-002)

`POST /api/mcp` exposes the deterministic engine to MCP clients: discovery, compose, validate, review, a read-only simulation
preview, owner approvals handed to FloFi (`request_user_approval` → `/approve`) and owner-scoped status/evidence — never
signing, submission or approval by the model. It runs in the same Vercel function runtime as the rest of the app and needs no
new service. Consumer clients (Claude custom connectors, ChatGPT developer mode) authenticate through FloFi's own OAuth server
(`/.well-known/*`, `/oauth/*`); its state (pseudonymous accounts, grants, token digests, approval handoffs, wallet links, abuse
counters) lives in this deployment's PostgreSQL (migration `0005_mcp_oauth`, tenant-scoped, digests only). The remote runtime
(`API_BASE_URL`) has no OAuth store and fails closed (`MCP_OAUTH_STORE_UNAVAILABLE`). Setup, clients and tools: [MCP.md](MCP.md).

Owner setup for a consumer Preview (Preview-only variables, on top of the embedded runtime above):

1. `FLOFI_MCP=enabled`, `FLOFI_MCP_OAUTH=enabled`, `FLOFI_PUBLIC_ORIGIN=https://<branch alias>` (exactly the URL you will give
   the clients, no trailing slash).
2. `FLOFI_MCP_OAUTH_SECRET` = `openssl rand -hex 32` (different from `FLOFI_SESSION_SECRET` and `API_AUTH_TOKEN`; the
   deployment refuses a reused value).
3. Invite: choose a code, keep it private, set `FLOFI_MCP_OAUTH_INVITES` to `printf '%s' "$CODE" | sha256sum | cut -d' ' -f1`.
4. Leave `FLOFI_MCP_HANDOFF_MAINNET_NETWORKS` unset (mainnet handoffs disabled by policy). Enable the testnet flows you want to
   hand off (`GRYLOO_ROUTER_TESTNET=live`, `GRYLOO_SOLANA_DEVNET=live`, `GRYLOO_SUPPLY_TESTNET=live`, …).
5. Redeploy (the build applies migration `0005`), then check `https://<alias>/.well-known/oauth-authorization-server` and that
   `POST https://<alias>/api/mcp` without a token answers `401` with a `resource_metadata` challenge.

## Developer API (BUILD-DEVELOPER-001)

`/api/developer/v1/*` lets third-party server applications use the same engine through server-side API keys: capability
discovery, immutable strategies, validation, a read-only simulation preview, approval handoffs to `/approve`, and the status and
evidence of runs their end users choose to share, with signed webhooks — never signing, submission or Review approval by the
developer. It runs in the same Vercel function runtime and needs no new service. Its state (projects, key digests, strategies,
events, webhook endpoints and deliveries, usage counters) lives in this deployment's PostgreSQL (migration
`0007_developer_platform`, tenant-scoped, digests only); developer approvals are rows of the shared approval handoff table
(migration `0006_approval_requesters`). The remote runtime (`API_BASE_URL`) fails closed (`DEVELOPER_STORE_UNAVAILABLE`).
Webhook delivery is request-driven on a Preview (Vercel Cron does not run there): events go out after developer requests and
`/approve` actions, or when an owner-configured scheduler calls the internal dispatch endpoint. Enabling it on a Preview:
`FLOFI_DEVELOPER=enabled`, `FLOFI_PUBLIC_ORIGIN`, a dedicated `FLOFI_DEVELOPER_SECRET` (Preview-only), redeploy, then create a
project and a sandbox key with the operator CLI using `--preview-branch <branch>`. Setup, CLI and scheduler:
[DEVELOPER.md](DEVELOPER.md).

## Owner-only setup (credentials and approvals)

These steps need the owner's accounts. The repository already contains everything else.

1. **Neon** — create a project (choose a region close to the Railway region) and a database `flofi`.
   Copy the pooled and the direct connection strings.
2. **Object storage** — create a private bucket (Cloudflare R2, AWS S3, Railway bucket or MinIO) and an access
   key limited to that bucket.
3. **Railway** — create a project from the GitHub repository and branch to deploy:
   * service `flofi-api`: Settings → Config-as-code path `deploy/railway/api.railway.json`; variables from the
     table above; Networking → generate a public domain. The pre-deploy command runs migrations.
   * service `flofi-worker`: config path `deploy/railway/worker.railway.json`; same database and object-store
     variables; no public domain.
4. **Vercel** — import the repository; Root Directory `apps/reference-dapp` (the `vercel.json` there installs the
   digest-verified Node 24.21.0 / pnpm 11.22.0 toolchain and builds the workspace); set `API_BASE_URL` and
   `API_AUTH_TOKEN` for Production; deploy.
5. **Verify** (no wallet needed): `curl https://<api>/healthz` → `{"ok":true}`; `curl https://<api>/readyz` →
   `{"ok":true}`; `curl -H "authorization: Bearer <token>" https://<api>/v1/runs` → `{"ok":true,...}`; open the
   Vercel URL from another computer.
6. **Make the frontend public** — Vercel previews of this project are behind Vercel Authentication (SSO). For a
   public URL either promote/assign a Production domain or disable Deployment Protection for the chosen
   environment (Vercel → Project → Settings → Deployment Protection).
7. **Owner wallet acceptance — public online swap** (explicit owner action, Base Sepolia only), from a computer
   that is not the development machine, with a wallet holding ≥ 2 test USDC and a little test ETH on Base
   Sepolia: open the public URL → Build a Swap (2 USDC → WETH, 0.5 % slippage) → Simulate → Review → Execute;
   approve the exact USDC approval in the wallet; close the tab; reopen the URL in another browser and confirm
   the approval was reconciled by the worker; refresh the quote, Review again, Execute the swap and sign it;
   close the tab again; after the worker reconciles, reopen and download the Evidence Bundle. Restart the
   `flofi-api` and `flofi-worker` services in Railway at any point to confirm nothing is lost. Agents never
   perform this step.

8. **Permissionless testnet journey (BUILD-JOURNEY-001)** — deploy this revision to `flofi-api` and `flofi-worker` with
   `GRYLOO_ROUTER_TESTNET=live` on both (migration `0004` applies in pre-deploy), keep `API_BASE_URL`/`API_AUTH_TOKEN` on Vercel,
   and make the frontend URL public (step 6). Verify without a wallet: the Build stage shows "Permissionless testnet journey";
   `curl -H "authorization: Bearer <token>" https://<api>/v1/runs?flow=crosschain-router-testnet` → `{"ok":true,...}`.
   Acceptance is performed by an **external user** with their own wallet (never an agent, never a team key): Base Sepolia ETH
   from a public faucet and 0.5–5 test USDC from Circle's faucet (https://faucet.circle.com); open the public URL → Connect →
   Sign in → "Bridge 1 USDC from Base Sepolia to Arbitrum Sepolia" → Simulate → Review → Accept → Execute the approval and the
   deposit in the wallet → close the tab / restart `flofi-api` and `flofi-worker` → reopen (any browser), sign in, open the run
   from "Your runs" → wait for `RECONCILED` (Across testnet relayer fill at both safe heads) → download the Evidence Bundle.

## Operations

* **Migrations** are explicit (`migrate`), serialized by an advisory lock, checksum-verified and recorded in
  `schema_migrations`. API and worker refuse to start when the schema is behind (`SCHEMA_NOT_MIGRATED`).
  Use the direct URL for migrations behind a transaction pooler.
* **Scaling**: add API or worker replicas freely. Workers claim with `SKIP LOCKED`; runs are protected by fenced
  leases; API instances share nothing but the database.
* **Restarts**: SIGTERM stops claiming and drains in-flight items (Railway `drainingSeconds` 90). A killed worker's
  items are reclaimed after their lease (60 s); its run leases expire after 30 s.
* **Attention**: an item that exhausts its observation budget (500 deliveries or 7 days) becomes `DEAD` and sets
  `execution_runs.attention_required`; it is never resubmitted. Query:
  `SELECT tenant_id, run_id, status, error_code FROM execution_runs WHERE attention_required;`
* **Logs** are one JSON object per line with `trace_id`/`span_id` (W3C), `tenant_id`, `run_id`, `flow`,
  `action`, `worker_id`, `work_kind` and redacted values. Ship them to any collector.
* **Retention**: the sweeper deletes `DONE` work items after 14 days and expired idempotency keys. Execution
  logs, journal entries and evidence metadata are append-only and never deleted by the application.
* **Importing a local run**: `node apps/reference-dapp/backend/main.ts import-journal <flow> <absolute dir> <run id>`
  validates the local JSONL log with the full flow validator and copies the identical bytes.

## Portability

| Replace | With | Change needed |
| --- | --- | --- |
| Railway | ECS/Fargate, Kubernetes, Fly, any OCI host | Run the same image with the same three commands and variables. |
| Neon | Aurora/RDS/Cloud SQL/self-hosted PostgreSQL ≥ 14 | `DATABASE_URL`. No extensions are required. |
| Bucket provider | S3, R2, GCS (S3 interop), MinIO | `OBJECT_STORE_*`. |
| PostgreSQL work queue | SQS/PubSub | Add a relay from `work_items` and a consumer adapter; handlers and dedupe keys are unchanged. |
| Vercel | Any Next.js host | Set `API_BASE_URL` and `API_AUTH_TOKEN` server-side. |
