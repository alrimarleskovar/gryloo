# FloFi Remote MCP Gateway — operator and integrator guide (BUILD-MCP-001, BUILD-MCP-002)

BUILD-CHANNEL-SIGNING-001 updates approval transport: model-visible results now carry an account-authenticated, nonsecret
`/approve#apr_…` reference; private capability URLs are delivered to the panel only in tool-result `_meta['flofi/approval']`.
The public fallback requires the browser that completed FloFi OAuth. See [universal signing](UNIVERSAL-SIGNING.md) and the
[host/wallet capability matrix and four owner E2E procedures](UNIVERSAL-SIGNING-OWNER-E2E.md). In-frame signing remains disabled.

The gateway is `POST /api/mcp` on the FloFi web deployment (Next.js route, Vercel function). It speaks the Model Context
Protocol over Streamable HTTP through the official TypeScript SDK v2 (`@modelcontextprotocol/server` 2.2.0): the 2026-07-28
revision and, statelessly, the 2025-era revisions current clients use (2025-11-25, 2025-06-18, 2025-03-26). Each request gets
a fresh server instance; nothing is kept in memory between requests. Design and evidence: [MCP-001 plan](../builds/BUILD-MCP-001-PLAN.md)
and [report](../builds/BUILD-MCP-001-REPORT.md); [MCP-002 plan](../builds/BUILD-MCP-002-PLAN.md) and [report](../builds/BUILD-MCP-002-REPORT.md).

> The connected model is an untrusted interpreter. No tool signs, submits, approves a Review, or accepts calldata, contract
> addresses, keys or seed phrases. OAuth authentication is not wallet ownership, an MCP account is not financial authority, and
> an approval link is not financial authority. Execution always happens in FloFi: the owner proves their wallet, runs a fresh
> simulation, reviews the Strategy Manifest, approves explicitly and signs with their own wallet.

## 1. Enable it (server-side variables, never `NEXT_PUBLIC_*`)

| Variable | Required | Meaning |
| --- | --- | --- |
| `FLOFI_MCP` | yes | `enabled`. Anything else: the endpoint answers `404 MCP_NOT_ENABLED`. |
| `FLOFI_MCP_OAUTH` | for consumer clients | `enabled`: FloFi's OAuth 2.1 authorization server (section 2). Needs PostgreSQL platform state (`DATABASE_URL`), with either remote or embedded flows. |
| `FLOFI_PUBLIC_ORIGIN` | with OAuth | The exact public origin, e.g. `https://flofi-git-claude-build-mcp-002-….vercel.app`. Issuer, resource (`<origin>/api/mcp`) and approval links derive from it, never from request headers. `http://` only for loopback on a local server. |
| `FLOFI_MCP_OAUTH_SECRET` | with OAuth | ≥ 32 characters (`openssl rand -hex 32`), dedicated: refused if equal to `API_AUTH_TOKEN` or `FLOFI_SESSION_SECRET`. Keys the token, consent, handoff, account-cookie and IP digests (one HKDF key each). |
| `FLOFI_MCP_OAUTH_ACCESS` | no | `invite` (default): a new pseudonymous FloFi account needs an invite code. `open`: anyone may create one. |
| `FLOFI_MCP_OAUTH_INVITES` | with `invite` | Comma-separated SHA-256 hex digests of invite codes (`printf '%s' "$CODE" \| sha256sum`). Codes are never configured in clear. |
| `FLOFI_MCP_CIMD_HOSTS` | no | Hosts whose Client ID Metadata Documents are accepted. Default `claude.ai,chatgpt.com`. |
| `FLOFI_MCP_OAUTH_DCR` / `FLOFI_MCP_DCR_REDIRECT_HOSTS` | no | `enabled` turns on narrow dynamic registration (public clients; redirect URIs on the listed hosts, default `claude.ai,chatgpt.com`, or loopback). Off by default. |
| `FLOFI_MCP_HANDOFF_TEST_FUNDS` | no | `enabled` (default) or `disabled`: whether test-funds strategies may be handed to their owner. |
| `FLOFI_MCP_HANDOFF_MAINNET_NETWORKS` | no | Empty (default): every mainnet handoff is refused with `MAINNET_HANDOFF_DISABLED_BY_POLICY`. A comma list of mainnet ids (`base`, `arbitrum-one`, `solana`) enables exactly those; every mainnet a workflow touches must be listed. A testnet name here is a configuration error. |
| `FLOFI_MCP_APP` | no | `enabled` (default): attach the in-chat MCP App panel to `request_user_approval`. `disabled`: link only. |
| `FLOFI_MCP_INFRAME_WALLET_HOSTS` | no | MCP Apps host names (`hostInfo.name`) on which the panel offers its in-frame environment probe (diagnostics only; never executes). Empty by default. |
| `FLOFI_MCP_CLIENTS` | development/Preview only | Static developer credentials of BUILD-MCP-001: JSON `[{"principal":"dev-alice","tokenSha256":"<64 hex>","wallets":["0x…"]}]`. **Refused on a production deployment** (`503 MCP_CONFIGURATION_INVALID`). Optional when OAuth is enabled. They keep the read-only MCP-001 tools and cannot request approvals. |
| `FLOFI_MCP_ALLOWED_ORIGINS` | no | Comma-separated browser origins (e.g. a hosted MCP inspector). Any other `Origin` header is refused (`403`). Server-to-server clients send no `Origin`. |

OAuth, approvals and wallet links live in the deployment's PostgreSQL (migration `0005_mcp_oauth`, applied by the normal
migration step; a Preview with `FLOFI_MIGRATE_ON_BUILD=preview` applies it on build). The shared platform-state host supports
`API_BASE_URL` + `API_AUTH_TOKEN` + pooled `DATABASE_URL`: OAuth/accounts/handoffs connect directly to PostgreSQL while financial
previews and owner-scoped reads still use Railway. Without usable/current PostgreSQL, state operations fail closed with
`MCP_OAUTH_STORE_UNAVAILABLE`; nothing falls back to memory or files. See [ENVIRONMENT.md §1](ENVIRONMENT.md).
No OpenAI or Anthropic key is used or needed: the client's own model interprets, FloFi only computes.

**Vercel Preview reachability.** MCP clients and the consent page cannot pass Vercel Authentication. Use the branch alias
with Deployment Protection disabled for Previews.

## 2. Connect a consumer client (OAuth)

FloFi is its own authorization server (MCP authorization spec 2026-07-28):

| Endpoint | Standard |
| --- | --- |
| `GET /.well-known/oauth-protected-resource/api/mcp` | RFC 9728: `resource` = `<origin>/api/mcp`, one `authorization_servers` entry, scopes |
| `GET /.well-known/oauth-authorization-server` | RFC 8414: `code` + PKCE `S256` only, `token_endpoint_auth_methods_supported: ["none"]`, `client_id_metadata_document_supported: true`, `authorization_response_iss_parameter_supported: true` |
| `GET/POST /oauth/authorize` | consent page (script-free, no framing, CSRF-bound), invite code for new accounts, `code` + `state` + `iss` redirect |
| `POST /oauth/token` | `authorization_code` (exact client, redirect, verifier, resource) and `refresh_token` (rotation; reuse detection) |
| `POST /oauth/revoke` | RFC 7009 |
| `POST /oauth/register` | RFC 7591, only with `FLOFI_MCP_OAUTH_DCR=enabled` |

An unauthenticated `/api/mcp` request gets `401` with `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/api/mcp", scope="flofi.strategy flofi.approval"`;
a tool outside the token's scopes gets `403 insufficient_scope` (the client can step up).

| Client | How |
| --- | --- |
| Claude (claude.ai web/desktop custom connector; Free: 1 connector, Pro, Max; Team/Enterprise: added by an Owner) | Settings → Connectors → Add custom connector → URL `<origin>/api/mcp`. Claude uses its Client ID Metadata Document (`https://claude.ai/oauth/mcp-oauth-client-metadata`, callback `https://claude.ai/api/mcp/auth_callback`). The consent page opens; enter the invite code; Allow. |
| ChatGPT developer mode | Settings → Apps & Connectors → Advanced → Developer mode → Create → URL `<origin>/api/mcp`, authentication OAuth. ChatGPT's CIMD (`https://chatgpt.com/oauth/BpZIpxL-aggt/client.json`) lists `none` besides `private_key_jwt`; FloFi treats it as a public client with PKCE. |
| Claude Code | `claude mcp add --transport http flofi <origin>/api/mcp` → OAuth in the browser (CIMD `https://claude.ai/oauth/claude-code-client-metadata`, loopback callback on any port, RFC 8252). |
| Developer/partner with a static credential (development, Preview) | `Authorization: Bearer <token>` from `FLOFI_MCP_CLIENTS` (section 7). |

Revoke a connection from the client (it calls `/oauth/revoke`) or by revoking the refresh token; a revoked or expired token
stops working on the next request. Access tokens live 15 minutes; a refresh family at most 30 days. The exact menus of each
client change over time; these paths follow the clients' documentation as of 2026-10-06 and were not exercised with the live
clients in BUILD-MCP-002 (see the report's consumer acceptance section).

## 3. Scopes and tools

| Scope | Tools |
| --- | --- |
| `flofi.strategy` | `get_supported_networks`, `get_supported_assets`, `get_capabilities`, `compose_strategy`, `validate_strategy`, `review_strategy`, `simulate_strategy` |
| `flofi.approval` | `request_user_approval`, `get_approval_status`; app-only (MCP Apps visibility `["app"]`, hidden from the model): `open_approval_session`, `get_execution_progress` |
| `flofi.runs` | `get_execution_status`, `get_evidence` — only runs of wallets the account **linked on FloFi** (`/connections`) |

Every tool input is a closed JSON Schema. Errors are `{ ok: false, code }`; schema violations name the path and rule, never the value.

| Tool | Input | Notes |
| --- | --- | --- |
| `get_capabilities` | `{ network?, action? }` | per action × network: `supportedByCode`, `enabledByDeployment`, `enabledByPolicy`, `demonstratedEvidence`; whether the caller can request an approval; the step-list contract |
| `compose_strategy` | `{ strategy }` | canonical IR, `workflowHash`, steps, explanation, `executionPlan` |
| `validate_strategy` / `review_strategy` | `{ strategy, workflowHash? }` | authoring rules + hash binding; BLOCK / WARNING / INFORMATION findings; authorize nothing |
| `simulate_strategy` | `{ strategy, workflowHash, simulationSubject }` | the flow's own simulation, read-only; one step at a time; never calldata |
| `request_user_approval` | `{ strategy, workflowHash }` | re-composes and re-checks; returns `approvalId`, the nonsecret `approvalUrl` (`<origin>/approve#apr_…`), `workflowHash`, `expiresAt`, `status`, `networkEnvironment`, `fundsClass`, `steps`, `authority: "NONE"`, `requires`, `preExecution`; attaches the panel. Private capability URLs are delivered to the panel through client-only `_meta`, outside model-visible content. |
| `get_approval_status` | `{ approvalId }` | PENDING / CLAIMED / APPLIED / EXPIRED / SUPERSEDED / REVOKED / STALE, and the runs started from it while the owner shares them |
| `get_execution_status`, `get_evidence` | `{ executionId, … }` | owner-scoped; anything not readable is `RUN_NOT_FOUND` |

A `strategy` is a version 1 single action — `bridge`, `swap`, `supply`, `borrow`, `repay`, `withdraw`, `add_liquidity`,
`lending_composition` (fields as in the `get_capabilities` examples) — or a version 2 workflow `{ "version": 2, "steps": [ … ] }`
of 1–8 such actions. One step is exactly version 1 (same hash). Supply → borrow → swap of the borrowed USDC on Base Sepolia is
the existing lending composition. Any other sequence is composed and reviewed per step and refused for execution with
`MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED` until the sequential runner exists.

## 4. The approval journey

1. The assistant composes (and optionally simulates), then calls `request_user_approval`. FloFi refuses a hash mismatch, a
   genuine review blocker, a path no existing flow executes with the owner's wallet, a flow the deployment has not enabled, or
   funds the policy does not allow — with the four facts in the refusal.
2. The user sees the FloFi panel in the chat (hosts with MCP Apps) or the approval link (every host). The panel shows the proposal
   as FloFi's workflow visual (BUILD-WORKFLOW-VISUAL-PRESENTATION-001); the result also carries the same picture as standard MCP
   image content and a readable summary with the public Open in FloFi link, after the unchanged JSON text block. `compose_strategy`
   adds the summary (no picture). `structuredContent.visual` is the presentation model; it never replaces `workflowHash`.
3. **Review with your wallet in FloFi** opens a fresh, five-minute FloFi approval link (`ui/open-link`) in the browser: the
   signing window. MetaMask's mobile link carries the private capability in the fragment. Phantom opens the public FloFi
   landing page; the owner pastes the private approval link into its browser. The model-visible fallback (`/approve#apr_…`)
   requires the requesting account's existing browser cookie or an already-proven owner resuming an applied proposal.
4. `/approve` shows that the proposal is external, from which client, its network, funds class, steps, summary, workflow hash,
   the REAL_FUNDS warning when relevant, the AI disclosure, and that nothing is authorized. The owner proves a wallet
   (EIP-4361 or Sign-In With Solana), loads the proposal (FloFi re-composes it and re-checks hash, engine, deployment and
   policy) and restores it to their workflow with one explicit **Load proposal** action. **Continue to simulation** opens
   FloFi's existing flow: fresh simulation, Strategy Manifest Review,
   explicit approval, the wallet's own signature, reconciliation, evidence.
5. The panel follows the run (`get_execution_progress`) and, once reconciled, puts the status and the evidence environment and
   bundle hash into the model's context. Status is shared with the requesting account only while the owner leaves the
   **Share** box checked (default: checked only in the browser that holds that account).

The approval secret travels only in the URL fragment, is stored as a digest, expires (15 minutes; a claim must be applied
within 10), is bound to one account, tenant, workflow hash and engine version, and works for one wallet. Terminal states never
revive. In-frame wallets inside a host iframe are **not** an execution path: on listed hosts the panel only reports what its
iframe can see (diagnostics for the owner's experiments).

## 5. Wallet links (`/connections`)

In the browser that holds the FloFi account (the consent cookie), prove a wallet and click **Link** to let that account's MCP
connections read the wallet's runs (`flofi.runs`). Links expire after 30 days and can be removed there; `/connections` also
withdraws open approval requests. A link never lets anyone sign or move funds.

## 6. Mainnet

Disabled by **policy only**. `get_capabilities` and every refusal report `supportedByCode`, `enabledByDeployment`,
`enabledByPolicy` and `demonstratedEvidence` separately, so a mainnet path shows as supported by code (Jupiter on Solana; the
Cross-chain Router Base → Arbitrum One) yet refused with `MAINNET_HANDOFF_DISABLED_BY_POLICY`. Enabling one later is the flow's
own owner-execution switch (`GRYLOO_JUPITER_OWNER_EXECUTION` / `GRYLOO_ROUTER_OWNER_EXECUTION=MAINNET_OWNER_APPROVED`), keyed
RPCs, demonstrated evidence and `FLOFI_MCP_HANDOFF_MAINNET_NETWORKS` — no schema, migration or tool change. See the report's
"Mainnet Activation Path".

## 7. Static developer credentials (BUILD-MCP-001)

Generate a credential locally and give the token to the client owner over a private channel:

```sh
umask 077
TOKEN=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')     # ≥ 32 chars; shorter tokens never authenticate
printf '%s' "$TOKEN" > /tmp/flofi-mcp-token                      # mode 0600, outside Git
printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1                 # → tokenSha256 for FLOFI_MCP_CLIENTS
```

Use it as `Authorization: Bearer <token>` (Claude Code `--header`, the Claude API MCP connector, the OpenAI Responses API
remote MCP tool, MCP Inspector). Rotate by adding the new digest, moving the client, then removing the old entry. Not on
production deployments.

## 8. Operations and limits

Logs: `mcp.tool` per call (principal id — a grant id for OAuth — tenant, tool, outcome code, duration) and `mcp.oauth.*`
events (client name, grant type, refusal reason) — never a token, code, secret, argument, address or result. Limits (fixed
windows in PostgreSQL, IPs stored only as keyed digests): authorize 30 / 10 min per IP; consent decisions 20 / 10 min per IP;
invite attempts 10 / h per IP; token 600 / 10 min per IP; registration 10 / h per IP; CIMD fetches 30 / h per host; approval
requests 20 / h and 5 open per account; simulations 30 / h per account and two concurrent per function instance; request
bodies 64 KiB. A platform firewall/rate limit in front of `/api/mcp` and `/oauth/*` is still recommended for production.
Retention: expired tokens, requests and caches are purged after 7 days, counters after 1 day, handoffs after 30 days.
