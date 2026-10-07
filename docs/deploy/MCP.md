# FloFi Remote MCP Gateway — operator and integrator guide (BUILD-MCP-001)

The gateway is `POST /api/mcp` on the FloFi web deployment (Next.js route, Vercel function). It speaks the Model Context
Protocol over Streamable HTTP through the official TypeScript SDK v2 (`@modelcontextprotocol/server` 2.2.0): the 2026-07-28
revision and, statelessly, the 2025-era revisions current clients use (2025-11-25, 2025-06-18, 2025-03-26). Each request gets
a fresh server instance; nothing is kept between requests. Design and evidence: [plan](../builds/BUILD-MCP-001-PLAN.md),
[report](../builds/BUILD-MCP-001-REPORT.md).

> The connected model is an untrusted interpreter. No tool signs, submits, approves a Review, or accepts calldata, contract
> addresses, keys or seed phrases. Execution always needs the owner to open the FloFi app, re-simulate, review the Strategy
> Manifest and sign with their own wallet.

## 1. Enable it (server-side variables, never `NEXT_PUBLIC_*`)

| Variable | Required | Meaning |
| --- | --- | --- |
| `FLOFI_MCP` | yes | `enabled`. Anything else: the endpoint answers `404 MCP_NOT_ENABLED`. |
| `FLOFI_MCP_CLIENTS` | yes | JSON array, 1–32 entries: `{"principal":"dev-alice","tokenSha256":"<64 hex>","wallets":["0x…"]}`. `principal`: 3–64 chars `[a-z0-9_-]`. `tokenSha256`: SHA-256 (hex) of the client's bearer token — the token itself is never stored server-side. `wallets` (optional, ≤ 16, lower-case EVM addresses): the only owners whose runs this credential may read with `get_execution_status` / `get_evidence`. Any malformed entry, duplicate principal or digest, or a digest equal to `sha256(API_AUTH_TOKEN)` disables the endpoint (`503 MCP_CONFIGURATION_INVALID`). |
| `FLOFI_MCP_ALLOWED_ORIGINS` | no | Comma-separated browser origins (e.g. a hosted MCP inspector). A request carrying any other `Origin` header is refused (`403`). Server-to-server clients send no `Origin`. |

The gateway uses the deployment's existing runtime ([ENVIRONMENT.md](ENVIRONMENT.md)): `simulate_strategy`,
`get_execution_status` and `get_evidence` need the embedded runtime (Preview: `DATABASE_URL`, no `API_BASE_URL`) or the
remote runtime (`API_BASE_URL` + `API_AUTH_TOKEN`; the Railway API must run a build that includes `POST /v1/previews/:flow`).
A preview of a flow works only where that flow is enabled (`GRYLOO_ROUTER_TESTNET=live`, …). Discovery, compose, validate
and review work on every runtime. No OpenAI or Anthropic key is used or needed.

Generate a credential locally and give the token to the client owner over a private channel:

```sh
umask 077
TOKEN=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')     # ≥ 32 chars; shorter tokens never authenticate
printf '%s' "$TOKEN" > /tmp/flofi-mcp-token                      # mode 0600, outside Git
printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1                 # → tokenSha256 for FLOFI_MCP_CLIENTS
```

Rotate by adding the new digest, moving the client, then removing the old entry. Revoke by removing the entry.

**Vercel Preview reachability.** MCP clients cannot pass Vercel Authentication. Use the branch alias with Deployment
Protection disabled for Previews, or have the client also send `x-vercel-protection-bypass: <bypass secret>`.

## 2. Connect a client

The credential is a static bearer token (`Authorization: Bearer <token>`), so the client must let you set a header.

| Client | How |
| --- | --- |
| Claude Code | `claude mcp add --transport http flofi https://<host>/api/mcp --header "Authorization: Bearer $TOKEN"` |
| Claude API (MCP connector) | an `mcp_servers` entry of type `url` with `url: https://<host>/api/mcp` and the token as its authorization token |
| OpenAI Responses API (remote MCP tool) | a tool of type `mcp` with `server_url: https://<host>/api/mcp` and an `Authorization: Bearer …` header |
| Any MCP client with custom headers (Cursor, MCP Inspector, `mcp-remote --header …`) | Streamable HTTP URL `https://<host>/api/mcp` + the header |
| claude.ai / Claude Desktop custom connectors, ChatGPT connectors | **Not yet**: these consumer connectors expect OAuth (or no auth). OAuth / partner identity is a later build; the principal model is ready for it. |

These connection paths follow each client's documented remote-MCP support; BUILD-MCP-001 verified the wire protocol with raw
JSON-RPC requests (both protocol eras) against the real route, not with a live third-party client.

## 3. Tools

Every tool input is a closed JSON Schema (no additional properties). Errors are `{ ok: false, code }` results; schema
violations name the path and rule, never the value.

| Tool | Input | Notes |
| --- | --- | --- |
| `get_supported_networks` | `{}` | CAIP-2 ids, mainnet/testnet/devnet, actions per network |
| `get_supported_assets` | `{ network? }` | exact token address / mint and decimals per network; one symbol may be two tokens |
| `get_capabilities` | `{ network?, action? }` | registry verdict, demonstrated evidence, deployment enablement, what MCP can do (`execute: false` always) |
| `compose_strategy` | `{ strategy }` | canonical IR revision 1, `workflowHash`, steps, deterministic explanation |
| `validate_strategy` | `{ strategy, workflowHash? }` | authoring rules + hash binding (`STRATEGY_WORKFLOW_HASH_MISMATCH`) |
| `review_strategy` | `{ strategy, workflowHash? }` | BLOCK / WARNING / INFORMATION findings; authorizes nothing |
| `simulate_strategy` | `{ strategy, workflowHash, simulationSubject }` | the flow's own simulation as a read-only preview; nothing stored; no calldata returned |
| `get_execution_status` | `{ executionId, journalAfter?, journalLimit? }` | only runs owned by the credential's granted wallets; anything else is `RUN_NOT_FOUND` |
| `get_evidence` | `{ executionId }` | the Evidence Bundle with its own environment and outcome; owner-scoped |

A `strategy` is one of: `bridge` (`sourceNetwork` base-sepolia → `destinationNetwork` arbitrum-sepolia, or base →
arbitrum-one; `asset` USDC; `amount`; `routing` auto|lifi|across; `slippageBps`; optional `recipient`), `swap` (`network`
base | base-sepolia | ethereum-sepolia | solana | solana-devnet; `inputAsset`, `outputAsset`, `amount`, `slippageBps`),
`supply` / `borrow` / `repay` (`network` base-sepolia (USDC) | ethereum-sepolia (WBTC); `asset`, `amount`, `beneficiary`),
`withdraw` (`network`, `asset`, `amount`), `add_liquidity` (`network` base-sepolia | ethereum-sepolia | solana-devnet;
`maxAmounts` of exactly the pool's two assets; `range` `{ unit: price|tick, lower, upper }`; `slippageBps`),
`lending_composition` (base-sepolia; `asset` USDC; `supplyAmount`, `borrowAmount`; `outputAsset` WETH; `owner`). Amounts
are decimal strings. `get_capabilities` returns a valid example per action and network.

## 4. Operations

Logs: one `mcp.tool` line per call with `principal`, `tenant`, `tool`, `outcome` code and `duration_ms` — never the token,
arguments, addresses or results; `mcp.unauthorized` and `mcp.configuration_invalid` warnings carry no detail. Abuse limits in
this build: 64 KiB request bodies and at most two concurrent simulation previews per function instance (best effort; a
platform firewall/rate limit in front of `/api/mcp` is recommended for production).
