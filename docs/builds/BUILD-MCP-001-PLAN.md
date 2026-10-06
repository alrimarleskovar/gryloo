# BUILD-MCP-001 — Plan: FloFi Remote MCP Gateway

Date: 2026-10-06. Branch `claude/build-mcp-001` (worktree `~/projects/flofi-mcp`), from `origin/main`
`bf84bbd09afeeaabbcbfd2a9a429cc75dea30d2b` (BUILD-CLOUD-PARITY-001 merged as PR #62).

> **The external model is an untrusted interpreter and client. It never becomes financial authority.** MCP is a new
> way to reach the existing deterministic engine, not a second engine. It authors, validates, previews and explains.
> It never signs, submits, authorizes a Review or reads a wallet's runs unless the deployment owner granted that read.

## 1. Inspection: what exists at `bf84bbd`

| Area | State |
| --- | --- |
| Master Spec | §14.2: MCP is an official surface; approval stays outside the model on a trusted surface. §14.7 names narrow tools (`get_supported_networks`, `get_supported_assets`, `quote_route`, `compose_strategy`, `simulate_strategy`, `review_strategy`, `create_strategy_manifest`, `request_user_approval`, `get_execution_status`, `recover_execution`) and forbids private keys and any `send_arbitrary_transaction`. §14.5: an Execution ID grants no access by itself. §13.1 item 18 places MCP in the Partner Gateway. |
| Authoring | Pure, React-free domain modules. `editorReducer(state, Command, ReviewContext)` is the one reducer for chat, canvas and Copilot. `commandIsValid` gives each command a closed shape, the `create*Node` builders enforce the network/asset profiles, and `validateAuthoringWorkflow` enforces the closed IR schema plus the per-profile validators. `describeProposal`, `summarize` and `workflowSteps` explain an IR deterministically. |
| Copilot (001/002) | Natural language → OpenAI → strict intent → planners → exact grammar → the same `Command`s. The MCP path does not touch it: the host model interprets, so FloFi needs no model call. |
| Review Engine (§9.1) | `lintWorkflow` (BLOCK/WARNING findings) and `resolveWorkflowCapability` over `executionCapabilityRegistry` (per action, adapter, chain and environment: capability flags, requirements, demonstrated evidence ceiling). |
| Flows | `backend/flows.ts`: 10 cloud flows with strict argument validators, enablement (`flowMode`), projectors and evidence extractors. Every `simulate` (and the swap's `prepare`) quotes, reads chain state, runs `eth_simulateV1` (or the Solana equivalent), compiles the canonical artifacts and **saves a durable run bound to the account argument**. The Router flows also bind every run to the wallet session principal (`ROUTER_OWNERSHIP`). |
| Flow `review` | Not a read-only step: it moves the run to `AUTHORIZED` (the owner's acceptance of the Manifest). MCP must never call it. |
| Runtime selection | `flow-runtime.ts`: `remote` (API_BASE_URL → Railway API), `embedded` (DATABASE_URL on a hosted deployment → the same `createBackend` inside the Vercel function), `local` (development; file journals), `unconfigured` (hosted with neither → `CLOUD_RUNTIME_NOT_CONFIGURED`). Preview tenant `pv-<branch>-<sha8>`. |
| Read model | `createRunQueries` (tenant-scoped `getRun`, keyset-paginated `journal`, `evidence` metadata). API routes `GET /v1/runs/:id[/journal|/evidence]` hide another wallet's run as `RUN_NOT_FOUND` when a principal header is present. |
| Authoring state | Browser only ("Conversation / proposal state: browser only", Cloud Parity matrix). Server actions receive the workflow on each call and re-validate it. |
| Credentials | `API_AUTH_TOKEN` is the internal BFF→API bearer. The wallet session is an HttpOnly cookie. No external client identity exists. |

## 2. Architecture

```
Claude / ChatGPT / any MCP client (untrusted interpreter)
  │  HTTPS POST /api/mcp   Authorization: Bearer <FloFi MCP credential>   (never API_AUTH_TOKEN)
  ▼
Next.js route  apps/reference-dapp/src/app/api/mcp/route.ts
  ├─ enablement (FLOFI_MCP=enabled) · Origin allowlist · body ≤ 64 KiB · bearer → McpPrincipal {id, tenant, readable wallets}
  └─ @modelcontextprotocol/server createMcpHandler (stateless, one McpServer per request, JSON responses)
        9 tools, strict schemas, read-only annotations
        │
        ├─ discovery / compose / validate / review ──► src/engine/strategy-engine.ts   (pure, shared deterministic facade)
        │                                              StrategySpec → existing Command → editorReducer (DApp context)
        │                                              → canonical IR + semanticWorkflowHash → lintWorkflow
        │                                              → resolveWorkflowCapability → describeProposal / workflowSteps
        │
        ├─ simulate ──► flow-runtime.cloudPreview(flow, args)
        │                 embedded: backend.previewFlow   remote: POST /v1/previews/:flow (API)   local/unconfigured: fail closed
        │                 = the flow's UNCHANGED simulate/prepare on an observe-only transport and a per-call run log
        │                   that is discarded: no durable run, no owner binding, no Review commitment anyone can authorize
        │                 → allowlisted projection (canonical Simulation Bundle / Manifest / quote facts; never calldata)
        │
        └─ status / evidence ──► flow-runtime.cloudRun / cloudRunJournal / cloudFlow(status)
                                  owner-scoped: only runs owned by a wallet the deployment owner granted to this credential
```

The DApp keeps its own entry points (`propose`, inspectors, Copilot) on the same reducer, linter and registry; the facade
only composes those functions, so the MCP output for a strategy is byte-identical to what the DApp chat authors for the
equivalent sentence (tested).

## 3. Decisions

### 3.1 Persistence: stateless strategy contract (no draft repository)

Durable drafts were evaluated. Rejected for this build:

* Authoring state is browser-only today; a server draft store would be a new product state the DApp does not share.
* compose → validate → simulate → review needs no server state: composition is a pure function of a small typed spec.
* A draft table means a migration, tenant/principal scoping, quotas and garbage collection for state no other surface uses.

Chosen: the client carries the typed **strategy spec** (not the IR). Every tool re-derives the canonical IR server-side
from the spec with the same deterministic reducer, and returns `workflowHash` (the canonical `semanticWorkflowHash`).
`simulate_strategy` requires the `workflowHash` from `compose_strategy`; validate/review accept it optionally. A mismatch
is `STRATEGY_WORKFLOW_HASH_MISMATCH` (the spec changed, or FloFi's authoring changed between deployments): the stale-revision
conflict of §7.8 without a store. MCP never accepts a client-supplied IR in this build, so a model cannot hand-edit IR
fields (asset addresses, adapters, protocol contracts). No process memory, `/tmp` or migration is involved.

### 3.2 Simulation: read-only preview of the existing services

Calling the flows' durable `simulate` from MCP would bind a run to a caller-supplied address (and, for the Router, would
require impersonating a wallet session principal). Instead `createBackend` gains `previewFlow(flow, args)`: the flow's
unchanged `simulate` (`prepare` for the EVM swap) built on the backend's own paced transport wrapped `observeOnly` and on a
run log that lives only for that call. The service code, validators, provider routing, simulation, artifact compilation
and Manifest are exactly the ones the DApp uses. Nothing is persisted, the ephemeral run id is never returned, and the
returned Review commitment is not authorizable anywhere. The simulation account is a **simulation subject** (whose public
balances and allowances the read uses), not an owner, principal or authorization. The owner re-simulates in the DApp under
their wallet session before any Review.

Runtime parity: `embedded` runs it in-process, `remote` calls a new bearer-protected API route `POST /v1/previews/:flow`
(the flows' enablement and keys live in the API), `local` and `unconfigured` fail closed (`MCP_CLOUD_RUNTIME_REQUIRED`,
`CLOUD_RUNTIME_NOT_CONFIGURED`). Local development uses `FLOFI_RUNTIME=embedded` with a database, as Cloud Parity does.

Output is an allowlisted projection: schema-validated canonical artifacts (Simulation Bundle, Strategy Manifest, quote
artifact; their schemas carry hashes and selectors, never calldata) plus explicit per-flow quote facts. Calldata,
transactions, signatures, nonces and the run id never leave the server.

### 3.3 Status and evidence: owner-scoped reads

An Execution ID (run id) is only a lookup key. `FLOFI_MCP_CLIENTS` grants each credential a list of EVM wallets it may
read (owner-configured, server-side, never a tool argument). A run is visible only if its durable owner is one of them;
anything else, including a nonexistent id, is `RUN_NOT_FOUND`. Reads go through the same runtime selection: embedded uses
the tenant-scoped queries, remote calls the existing `GET /v1/runs/:id` and `/journal` with the granted wallet as the
principal header (so the API enforces ownership again), and evidence comes from the durable run record through the flow's
read-only `status` method. Evidence environment and status are copied verbatim from the Evidence Bundle; nothing is
upgraded. Solana-owned runs are not readable through MCP in this build (the API principal header is EVM-only).

### 3.4 Authentication

`FLOFI_MCP=enabled` plus `FLOFI_MCP_CLIENTS` (JSON: `principal`, `tokenSha256`, optional `wallets`). The server stores only
SHA-256 digests of high-entropy bearer tokens and compares in constant time. Fail closed: missing configuration → 404
`MCP_NOT_ENABLED`; invalid configuration → 503 `MCP_CONFIGURATION_INVALID`; a configured digest equal to
`sha256(API_AUTH_TOKEN)` is a configuration error; missing/unknown token → 401. Tokens are never logged, echoed or
returned; logs carry the principal id, tool, outcome code and duration only. The principal type
`{ kind: 'mcp-credential', id, tenantId, wallets }` is what OAuth or partner identity would produce later. This is a
developer/Preview credential, not production OAuth.

### 3.5 Transport and SDK

`@modelcontextprotocol/server@2.2.0` (official TypeScript SDK v2, MIT; depends only on `@modelcontextprotocol/core@2.2.0`
and `zod`). Published 2026-09-28, so it passes the 7-day `minimumReleaseAge`; 2.3.x is too new. v1
(`@modelcontextprotocol/sdk`) was rejected: it pulls express, hono, cors and more. `createMcpHandler` serves the 2026-07-28
revision and, statelessly, the 2025-era protocol current clients speak; one fresh server per request, no sessions,
`responseMode: 'json'`. That fits a Vercel function; no second service is needed. Tool schemas use the repo's existing
TypeBox + Ajv (already approved pins) through a small Standard-Schema adapter, so no direct zod dependency is added.
Dependency gates (`scripts/bootstrap-ci.py` lock hash, package count and direct pins; the SBOM step's reviewed count) are
updated explicitly for the new MIT packages.

### 3.6 Tools (naming follows Master Spec §14.7)

| Tool | Input | Output | Notes |
| --- | --- | --- | --- |
| `get_supported_networks` | `{}` | networks with CAIP-2 id, class (mainnet/testnet/devnet), test funds, actions | from registries and authoring profiles |
| `get_supported_assets` | `{ network? }` | assets with chain, address/mint, decimals, actions, source registry | from the same profiles authoring uses |
| `get_capabilities` | `{ network?, action? }` | per action × network: supported by code, MCP surface, deployment enablement, evidence ceiling | derived by running the registry on the IR FloFi composes |
| `compose_strategy` | `{ strategy }` | normalized spec, canonical IR, `workflowHash`, steps, explanation | deterministic; unsupported → fail closed |
| `validate_strategy` | `{ strategy, workflowHash? }` | valid / errors with codes and field paths | no values echoed |
| `simulate_strategy` | `{ strategy, workflowHash, simulationSubject }` | read-only preview projection | needs an enabled flow and a cloud runtime |
| `review_strategy` | `{ strategy, workflowHash? }` | Block / Warning / Information findings, capability blockers, next steps | deterministic lint; never authorizes |
| `get_execution_status` | `{ executionId, journalAfter?, journalLimit? }` | run status, attempts, journal page | owner-scoped |
| `get_evidence` | `{ executionId }` | Evidence Bundle with its own environment/status, hash, archive metadata | owner-scoped |

Not exposed: `quote_route` (quotes are part of the preview), `create_strategy_manifest` (only an authorizable Manifest
would make sense, and that needs the wallet), `request_user_approval`, `recover_execution`, and anything that submits,
signs, authorizes, begins, hands off, reports, invalidates or accepts calldata, keys or seed phrases.

Strategy actions (the Copilot V2 authoring set): `bridge` (Cross-chain Router, Base Sepolia → Arbitrum Sepolia or Base →
Arbitrum One), `swap` (Uniswap v3 on Base, Base Sepolia, Ethereum Sepolia; Jupiter on Solana; Orca on Solana Devnet),
`supply`/`borrow`/`repay`/`withdraw` (Aave V3: Base Sepolia USDC, Ethereum Sepolia WBTC), `add_liquidity` (Uniswap v3 on
Base Sepolia / Ethereum Sepolia, Orca on Solana Devnet), `lending_composition` (Supply → Borrow → Swap on Base Sepolia).
Routing is `auto | lifi | across`: `auto` is FloFi's preference order (LI.FI first, direct Across fallback), not a
best-price search, so it is not called "best".

## 4. Security invariants and how they are enforced

1. Arguments are untrusted: strict closed schemas (no additional properties, enums, patterns, length bounds).
2. No calldata, contract address, adapter or chain id input: the spec names networks and assets by enum; FloFi maps them to
   registry profiles.
3. No private key, seed phrase, signature or wallet path: no such field exists, no free text exists, outputs never echo
   rejected values.
4. No submission: the preview transport is `observeOnly`; no tool reaches `begin`, `handoff`, `report`, `submit` or `review`.
5. No Review authorization: the flow `review` method is never called; MCP Review is the deterministic linter.
6. No tenant or ownership bypass: previews create no runs; status/evidence require an owner-granted wallet.
7. No authority widening: a recipient or beneficiary is a reviewed parameter with a warning, never trusted; no argument
   selects a tenant, principal, wallet grant or runtime.
8. Honest evidence: preview provenance, capability ceilings and Evidence Bundle levels are copied, never upgraded.
9. No model tokens: the MCP path imports no Copilot or model client (tested statically and at runtime).

## 5. Tests

Unit (no network): facade compose/parity with the DApp chat grammar for every action, determinism, fail-closed inputs
(network, asset, amount, slippage, pairs, extra fields, injected keys/calldata), capability derivation, auth configuration
and token handling, hash conflicts, preview projections free of calldata, previews on MOCKED in-process chains through
`createBackend` (Router testnet and mainnet, Aave, Uniswap liquidity) proving no durable write and no send method, remote
and embedded runtime dispatch, status/evidence isolation, zero OpenAI/Anthropic requests. Protocol: raw JSON-RPC over the
real route handler (initialize, tools/list, tools/call, unknown tool, auth failures). PostgreSQL: embedded runtime with a
real run created by the owner's wallet session → MCP status/evidence visible only with the grant, invisible to another
credential and another tenant, and previews leaving zero rows. Then `pnpm check`, governance-lite and the relevant suites.

## 6. Out of scope

Billing, x402, subscriptions, quotas beyond the per-instance simulation cap, partner console, widget, SDK, webhooks,
marketplace, Mode C, any MCP execution or approval request, mainnet execution, production OAuth, Web UI changes, dashboard.
