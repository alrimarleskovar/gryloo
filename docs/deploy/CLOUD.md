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
| `GRYLOO_PUBLIC_TESTNET=record` | to enable | Base Sepolia read-only RPC for the exact-profile Uniswap v3 USDC/WETH swap (the public online swap acceptance path). |

A flow without its enablement variable answers `*_PUBLIC_TESTNET_NOT_ENABLED`. The `*_HARNESS=MOCKED_LOOPBACK_ONLY`
variables exist only for tests and must never be set in a deployment.

### Frontend (Vercel, server-side only — never `NEXT_PUBLIC_*`)

| Variable | Meaning |
| --- | --- |
| `API_BASE_URL` | Public HTTPS URL of `flofi-api`, e.g. `https://flofi-api-production.up.railway.app`. Setting it switches the Base Sepolia swap, Robinhood transfer and Aave Supply server actions to forward to the API. |
| `API_AUTH_TOKEN` | Same value as the API's token. |

The browser keeps talking only to its own origin (CSP `connect-src 'self'`). Flows that are not cloud-enabled
keep their existing `GRYLOO_*` gates; leave those unset on Vercel so they stay disabled (their journals would
otherwise live on an ephemeral serverless filesystem).

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
