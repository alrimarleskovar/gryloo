# BUILD-MCP-001 — Report: FloFi Remote MCP Gateway

Date: 2026-10-06. Branch `claude/build-mcp-001` (worktree `~/projects/flofi-mcp`), from `origin/main`
`bf84bbd09afeeaabbcbfd2a9a429cc75dea30d2b`. Plan: [BUILD-MCP-001-PLAN.md](BUILD-MCP-001-PLAN.md). Operator and integrator
guide: [deploy/MCP.md](../deploy/MCP.md).

> **The external model is an untrusted interpreter and client; it never becomes financial authority.** The gateway is a new
> way into the existing deterministic engine. It authors, validates, previews and explains. Nothing it does signs, submits,
> authorizes a Review, persists a run or reads a wallet's runs without the deployment owner's grant.

## 1. Status

**IMPLEMENTATION COMPLETE — NO LIVE THIRD-PARTY CLIENT CONNECTED YET; NO FINANCIAL TRANSACTION.** Evidence level of every
simulation in this build: `MOCKED` (in-process and loopback harnesses). No public network, provider or model was called by
any test or smoke run. The Preview needs the owner's configuration (§12) before a real client can connect.

## 2. What a connected agent can do

```
user (in Claude / an MCP agent): "Bridge 5 USDC from Base Sepolia to Arbitrum Sepolia"
agent → compose_strategy { strategy: { action: bridge, sourceNetwork: base-sepolia, destinationNetwork: arbitrum-sepolia,
                                       asset: USDC, amount: "5", routing: auto } }
FloFi ← canonical IR revision 1, workflowHash 0xc852…296d, steps, "cross-chain bridge Base Sepolia USDC → Arbitrum Sepolia USDC
        (Cross-chain Router)", notes ("Default slippage 50 bps applied", "the wallet that signs … receives the funds")
agent → review_strategy { strategy, workflowHash }   → BLOCK ROUTER_ROUTE_REQUIRED (needs quote + simulation + Manifest review),
                                                        INFORMATION WALLET_NOT_CONNECTED, OWNER_APPROVAL_REQUIRED; authority NONE
agent → simulate_strategy { strategy, workflowHash, simulationSubject: 0x… }
FloFi ← read-only preview: LI.FI selected (Across available), expected/minimum output, fee, eth_simulateV1 gas per call,
        approvals needed, deadlines, canonical Simulation Bundle / Authorization Policy / Strategy Manifest (hashes, no calldata);
        persisted false, authorizable false
user  → opens the FloFi app, signs in with the wallet, re-simulates, reviews the Manifest, signs in the wallet (unchanged)
agent → get_execution_status / get_evidence { executionId }  (only if the operator granted that wallet to this credential)
```

## 3. Architecture

```
MCP client ──HTTPS POST /api/mcp, Authorization: Bearer <FloFi MCP credential>──► src/app/api/mcp/route.ts
  src/mcp/gateway.ts    FLOFI_MCP=enabled → Origin allowlist → bearer → body ≤ 64 KiB → createMcpHandler (stateless)
  src/mcp/tools.ts      9 tools, closed TypeBox/Ajv schemas via a Standard-Schema adapter, output guard, metadata logs
     ├─ src/engine/strategy-spec.ts      typed, versioned strategy contract (no address/chain/calldata inputs)
     ├─ src/engine/strategy-engine.ts    StrategySpec → existing Command → editorReducer (DApp context) → IR + hash →
     │                                   lintWorkflow, resolveWorkflowCapability, describeProposal, summarize, workflowSteps
     ├─ src/engine/capability-catalog.ts networks / assets / code capabilities from the registries and the composed IR
     ├─ src/mcp/simulation.ts            strategy → flow; allowlisted projection; assertSafeOutput
     └─ src/mcp/runtime.ts               flow-runtime.ts (remote | embedded | local | unconfigured), never a second runtime
            ├─ cloudPreview  → backend.previewFlow (embedded) | POST /v1/previews/:flow (remote) | fail closed
            └─ cloudRun / cloudRunJournal / cloudFlow(status) as the operator-granted owner wallet
backend/preview.ts      PREVIEW_METHODS (simulate; the swap's prepare) + a per-call run log; app.ts previewFlow + route
```

The facade adds no authoring semantics: it calls the same reducer, builders, validators, linter and registry the DApp's chat,
canvas and Copilot call. For all 19 supported action × network examples the MCP IR is **byte-identical** to the IR the DApp
authors from the equivalent chat sentence (`strategy-engine.test.ts`). The DApp itself is unchanged.

## 4. MCP transport and protocol

Official TypeScript SDK v2, `@modelcontextprotocol/server@2.2.0` (MIT; depends only on `@modelcontextprotocol/core@2.2.0`
and `zod@4.6.5`; published 2026-09-28, passes the 7-day release-age gate; 2.3.x is too new; v1 `@modelcontextprotocol/sdk`
rejected for its express/hono/cors dependency set). `createMcpHandler(factory, { legacy: 'stateless' })`: Streamable HTTP,
one fresh `McpServer` per request, no sessions. Verified on the wire with raw JSON-RPC against the real route: 2025-11-25 and
2025-06-18 `initialize` (SSE `message` event), `tools/list`, `tools/call`; 2026-07-28 `server/discover`, `tools/list`,
`tools/call` (JSON). It runs as an ordinary Vercel function (`maxDuration` 300 s for previews); no extra service.

## 5. Tools

Inputs (closed schemas; `additionalProperties: false` everywhere):

| Tool | Input | Output (structured) |
| --- | --- | --- |
| `get_supported_networks` | `{}` | `networks[]`: id, name, CAIP-2 `chainId`, class, funds, actions |
| `get_supported_assets` | `{ network? }` | `assets[]`: network, chainId, symbol, address/mint, decimals, actions, registry sources |
| `get_capabilities` | `{ network?, action? }` | `runtime`, `mcpExecution: NOT_AVAILABLE`, rows: actionTypes, adapters, `supportedByCode` (registry dimensions, owner-wallet execution implemented, registry environments), `demonstratedEvidence`, `deployment` (flow, mode, enabled, mocked), `mcp` (compose/validate/review/simulate, `execute: false`), a valid `example` |
| `compose_strategy` | `{ strategy }` | normalized `strategy`, `workflowHash`, `revision` 1, `fundsClass`, `workflow` (IR), `steps`, `explanation`, `summary`, `notes`, `authority` |
| `validate_strategy` | `{ strategy, workflowHash? }` | `valid`, `code`, `workflowHash`, review counts |
| `review_strategy` | `{ strategy, workflowHash? }` | `findings[]` (BLOCK / WARNING / INFORMATION; LINTER / CAPABILITY / STRATEGY), `capability`, `deployment`, `authority`, next steps |
| `simulate_strategy` | `{ strategy, workflowHash, simulationSubject }` | `flow`, `kind`, `provenance`, `observedAt`, `expiresAt`, `facts`, `canonicalArtifacts`, `persisted: false`, `authorizable: false`, `evidenceLevel` |
| `get_execution_status` | `{ executionId, journalAfter?, journalLimit? }` | status, provenance, owner, attempts (no nonce), journal page |
| `get_evidence` | `{ executionId }` | `bundleHash`, `environment`, `outcome`, schema-validated `canonicalBundle` |

`strategy` is one of eight actions (field-level contract in [MCP.md](../deploy/MCP.md) §3): `bridge`, `swap`, `supply`,
`borrow`, `repay`, `withdraw`, `add_liquidity`, `lending_composition` — the Copilot V2 authoring set. Names follow Master Spec
§14.7. Not exposed: `quote_route` (quotes are inside the preview), `create_strategy_manifest` (an authorizable Manifest needs the
wallet), `request_user_approval`, `recover_execution`, and anything that submits, signs, authorizes, begins, hands off,
reports, invalidates or takes calldata, contract addresses, keys or seed phrases. Routing is `auto | lifi | across`: `auto` is
FloFi's preference order (LI.FI first, direct Across fallback), not a best-price search, so it is not called "best".

## 6. Authentication and principal

`FLOFI_MCP=enabled` + `FLOFI_MCP_CLIENTS` (JSON `{ principal, tokenSha256, wallets? }`, ≤ 32 clients, ≤ 16 wallets each).
Only SHA-256 digests are configured; presented tokens (32–512 URL/base64 chars) are hashed and compared in constant time
against every entry. Fail closed: not enabled → 404; any malformed entry, duplicate, or a digest equal to
`sha256(API_AUTH_TOKEN)` → 503 `MCP_CONFIGURATION_INVALID`; missing/unknown/weak/non-Bearer token → 401 with
`WWW-Authenticate: Bearer realm="flofi-mcp"`; disallowed `Origin` → 403. The principal is explicit:
`{ kind: 'mcp-credential', id, tenantId (the deployment tenant, pv-<branch>-<hash> on Previews), wallets }` — the shape OAuth or
partner identity can produce later. The credential never reaches the API (the BFF→API call keeps using `API_AUTH_TOKEN`
server-side), is never logged, echoed or returned. This is a developer/Preview credential, **not** production OAuth.

## 7. Persistence model

**Stateless; no draft repository, no migration.** Durable drafts were evaluated and rejected (plan §3.1): authoring state is
browser-only today, and compose → validate → simulate → review is a pure function of a small typed spec. The client carries
the strategy spec and the `workflowHash` (canonical `semanticWorkflowHash`); every call re-derives the IR server-side, and a
mismatch is `STRATEGY_WORKFLOW_HASH_MISMATCH` (stale or altered strategy) — never a silent replacement. A client-supplied IR is
not accepted in this build. Previews persist nothing: a full embedded-runtime test asserts zero rows in all ten durable
tables after compose + simulate.

## 8. Cloud Parity integration

Runtime selection is BUILD-CLOUD-PARITY-001's `flow-runtime.ts`, extended additively (`cloudPreview`, `cloudRun`,
`cloudRunJournal`; `EmbeddedRuntime.run/journal`):

| Runtime | Discovery / compose / validate / review | `simulate_strategy` | Status / evidence |
| --- | --- | --- | --- |
| embedded (Vercel Preview: `DATABASE_URL`, no `API_BASE_URL`) | yes | in-process `backend.previewFlow` | tenant-scoped queries as the owner |
| remote (`API_BASE_URL`) | yes | `POST /v1/previews/:flow` on the API (needs an API build with this route; older API → `CLOUD_API_PREVIEW_UNAVAILABLE`) | `GET /v1/runs/:id[/journal]` and flow `status` with the owner as principal header (the API re-checks ownership) |
| local | yes | `MCP_CLOUD_RUNTIME_REQUIRED` | `MCP_CLOUD_RUNTIME_REQUIRED` |
| unconfigured (hosted, neither) | yes | `CLOUD_RUNTIME_NOT_CONFIGURED` | `CLOUD_RUNTIME_NOT_CONFIGURED` |

No localhost, file journal, `/tmp` or process-memory correctness dependency on a hosted deployment. The only process memory
is a best-effort per-instance cap of two concurrent previews (abuse protection, never relied on for safety).

## 9. Supported by code vs enabled vs MCP

`get_capabilities` keeps them apart. Examples from the registry (no claim upgraded):

| Action × network | Funds | Registry public environment | Owner-wallet execution implemented | Demonstrated evidence (registry) | MCP simulate |
| --- | --- | --- | --- | --- | --- |
| bridge base-sepolia → arbitrum-sepolia | test | PUBLIC_TESTNET | yes | none | when `crosschain-router-testnet` is enabled |
| bridge base → arbitrum-one | real | MAINNET | yes (owner opt-in gated) | none | when `crosschain-router` is enabled (read-only) |
| swap base-sepolia | test | PUBLIC_TESTNET | yes | TESTNET_EXECUTED | when `base-sepolia-swap` is enabled |
| swap base | real | none (MOCK / LOCAL_FORK only) | no | none | never (`SIMULATION_LOCAL_FORK_ONLY`) |
| add_liquidity solana-devnet | test | PUBLIC_TESTNET | yes | none | never (`SIMULATION_REQUIRES_OWNER_BROWSER`) |

"Enabled" comes from the deployment's own flow modes (`live` / `harness` / `off`); MCP execution is `NOT_AVAILABLE` for every row.

## 10. Security invariants verified

| Invariant | How it is enforced | Test |
| --- | --- | --- |
| Tool arguments are untrusted; strict schemas | closed TypeBox schemas, Ajv strict, per-branch issues (path + rule only) | `gateway.test.ts`, `strategy-engine.test.ts` |
| No raw calldata path (in or out) | no such input field (tested over `tools/list`); allowlisted projections; `assertSafeOutput` | `simulation.test.ts` (raw preview calldata/commitments/run ids absent from output; guard cases) |
| No arbitrary contract/address trust | networks/assets by enum → registry profiles; recipients/beneficiaries flagged `EXPLICIT_*` warnings | engine + gateway tests |
| No private-key, signature or wallet path | no field, no free text, no echo; secret-shaped keys never named | `strategy-engine.test.ts` (keys, mnemonic-shaped words) |
| No server signing / no submission | preview transport `observeOnly`; no send method reached | `simulation.test.ts` (recorded RPC methods, harness `sends` = 0) |
| No automatic financial submission / no arbitrary transaction tool | 9 read-only tools; unknown tools are JSON-RPC errors | `gateway.test.ts` |
| No bypass of simulation/Review/Manifest | flow `review` never called; MCP review authorizes nothing; preview not authorizable | PostgreSQL test (owner journey separate) |
| No tenant/ownership bypass | previews create no runs; reads only as granted wallets; tenant from the deployment | `reads.test.ts`, `gateway.pg.test.ts` |
| No authority widening by a parameter | no argument selects tenant, principal, grant or runtime | `reads.test.ts` (reads made only as the granted wallet) |
| Unsupported/ambiguous input fails closed | refusal codes, never a nearby mapping | `strategy-engine.test.ts` |
| No stronger evidence than recorded | registry ceilings, preview `MOCKED`/`SIMULATION_PREVIEW_NOT_EXECUTION`, Evidence Bundle copied | `capability-catalog.test.ts`, `reads.test.ts` |
| Credentials isolated | digests only, constant time, `API_AUTH_TOKEN` refused, never logged/forwarded | `gateway.test.ts`, `runtime.test.ts` |
| Zero FloFi-owned model tokens | no model client imported (static scan); no `fetch` at all for discovery/compose/validate/review/simulate-refusal, even with `OPENAI_API_KEY` set | `gateway.test.ts` |

## 11. Files

| File | Change |
| --- | --- |
| `apps/reference-dapp/src/engine/strategy-spec.ts`, `strategy-engine.ts`, `capability-catalog.ts`, `strategy-examples.ts` | New: the deterministic facade and discovery |
| `apps/reference-dapp/src/mcp/config.ts`, `gateway.ts`, `tools.ts`, `simulation.ts`, `runtime.ts` | New: the gateway |
| `apps/reference-dapp/src/app/api/mcp/route.ts` | New: `POST /api/mcp` (GET/DELETE answered after auth) |
| `apps/reference-dapp/backend/preview.ts` | New: preview methods and the per-call run log |
| `apps/reference-dapp/backend/app.ts` | Additive: `previewFlow`, route `POST /v1/previews/:flow` |
| `apps/reference-dapp/src/server/flow-runtime.ts`, `cloud-api-client.ts` | Additive: preview and owner-scoped run/journal dispatch |
| tests: `src/engine/*.test.ts`, `src/mcp/*.test.ts`, `src/mcp/gateway.test-harness.ts`, `src/mcp/gateway.pg.test.ts`, `backend/preview.test.ts` | New |
| `apps/reference-dapp/package.json`, `pnpm-lock.yaml` | `@modelcontextprotocol/server@2.2.0` (+ core 2.2.0, zod 4.6.5); `@sinclair/typebox`, `ajv` (existing BUILD-001 pins) |
| `scripts/bootstrap-ci.py`, `.github/workflows/contracts.yml` | **Intentional gate updates for owner review**: new reviewed lock hash, registry count 262 → 265, the MCP direct pin and app manifest expectation; SBOM reviewed count 262 → 265. No gate removed or weakened. |
| `docs/builds/BUILD-MCP-001-PLAN.md`, `-REPORT.md`, `docs/deploy/MCP.md`, `CLOUD.md`, `ENVIRONMENT.md`, `docs/STATUS.md` | Docs |

Not changed: the DApp UI and its authoring modules, the Copilot (001/002), flows' services, wallet/session/ownership code,
execution, recovery, reconciliation, evidence, migrations, visual baselines.

## 12. Tests and results (local, pinned toolchain: Node 24.21.0, pnpm 11.22.0, Anvil 1.8.3, headless shell 1243)

| Check | Result |
| --- | --- |
| `pnpm check` (typecheck, lint, build, schemas:check, unit) | **Passed**: 197 files passed, 2 skipped; **1,866 tests passed, 2 skipped** (the two existing skips). 46 new tests. |
| `pnpm test:postgres` (loopback cluster) | **Passed: 53/53** in 11 files, including the new `gateway.pg.test.ts` |
| Browser `router.spec.ts` / `journey.spec.ts` / `cloud-runtime.spec.ts` (MOCKED loopback, embedded runtime) | **4/4, 3/3, 2/2 passed** (no UI change; run for the runtime changes) |
| `python3 scripts/bootstrap-ci.py --verify-dependencies` | **Passed**: 265 registry entries, integrity, licenses, release ages; 16 reviewed exceptions unchanged |
| CI SBOM step (extracted from `contracts.yml`, run locally) | **Passed**: 265 exact registry components |
| `python3 scripts/governance_lite.py` (clean `git archive` export) + its unittest suite | **Passed** (982 text files); **17/17** |
| `git diff --check`, bidi-character scan | clean |
| `next build` + `next start` smoke (local runtime) | 401 without credential; 2025-11-25 handshake; 9 tools; compose hash `0xc852…296d`; simulate → `MCP_CLOUD_RUNTIME_REQUIRED` |
| `next build` + `next start` smoke (embedded runtime, disposable loopback DB, loopback MOCKED Router harness) | capabilities `simulate: true` (harness); simulate → MOCKED preview with Manifest hash; **0** execution/log/attempt/work/idempotency rows; logs metadata-only, token absent |
| `pnpm audit --audit-level low` | **FAILS — pre-existing, not caused by this build**: `source-map-js@1.2.1` (high, GHSA-68fv-2mgg-jv7q; build tooling via next/vite → postcss). `main` fails identically today (advisory GitHub-reviewed 2026-10-05T23:31Z). The fix `1.2.2` was published 2026-09-30T14:08Z and only passes the 7-day release-age gate at **2026-10-07T14:08Z**; it was not forced. CI will therefore fail its audit step until a lockfile update after that time (owner decision / follow-up). |

## 13. Preview deployment requirements

On the Preview that should serve MCP (Vercel → Environment Variables → Preview), in addition to the Cloud Parity setup
(`DATABASE_URL`, `FLOFI_SESSION_SECRET`, no `API_BASE_URL`):

1. `FLOFI_MCP=enabled`.
2. `FLOFI_MCP_CLIENTS` with one entry per client: the SHA-256 of a token generated as in [MCP.md](../deploy/MCP.md) §1; add `wallets` only for owners who agree that this
   credential may read their runs.
3. The flow modes the previews should use, e.g. `GRYLOO_ROUTER_TESTNET=live` (already set for the journey), with keyed RPC
   overrides recommended.
4. Reachability for non-browser clients: Preview protection off on the branch alias, or the client sends
   `x-vercel-protection-bypass`.
5. Redeploy; check `GET /api/flofi/readiness`, then `tools/list` with the credential.

No OpenAI/Anthropic key, migration or new service is needed. Production (remote runtime) additionally needs the Railway API
redeployed from a `main` that contains `POST /v1/previews/:flow` before `simulate_strategy` works there.

## 14. Connecting Claude / ChatGPT

See [MCP.md](../deploy/MCP.md) §2. Clients that accept a custom `Authorization` header can connect now
(Claude Code `claude mcp add --transport http … --header "Authorization: Bearer …"`, the Claude API MCP connector, the OpenAI
Responses API remote MCP tool, MCP Inspector/Cursor/`mcp-remote`). claude.ai / Claude Desktop custom connectors and ChatGPT
connectors expect OAuth (or no auth) and cannot use this static credential yet. None of these clients was exercised live in this
build; the protocol was verified with raw JSON-RPC against the real route in both protocol eras.

## 15. Known limitations

* No production OAuth/partner identity yet; consumer connectors (claude.ai, ChatGPT) cannot connect with the static credential.
* Abuse protection is minimal: auth, 64 KiB bodies, two concurrent previews per instance (not global). Put a platform rate limit
  in front for production.
* Previews: no preview for Base mainnet Uniswap (local-fork only) or Orca liquidity (needs the owner's browser-generated position
  key); the Base/Ethereum Sepolia swap and Uniswap liquidity previews return quote facts but no canonical Simulation Bundle (their
  flows do not compile one); the lending composition preview needs `GRYLOO_ALCHEMY_API_KEY` like the DApp.
* Status/evidence: only EVM-owned runs (the API principal header is EVM-only); only runs of operator-granted wallets; evidence
  comes from the durable run log (archive objects are not exposed).
* No client-supplied IR import and no template instantiation (Master Spec §14.4) yet; strategies are single actions or the one
  supported lending composition, as in the DApp.
* The `pnpm audit` failure above is pre-existing and must be cleared by a dependency update after 2026-10-07T14:08Z.
* No live MCP client, public network, provider or model was used; all simulation evidence here is `MOCKED`.

## 16. Authority statement

No merge was performed and no automatic merge was enabled. No transaction was signed, submitted or broadcast on any network;
the only "sends" in tests are the MOCKED harness wallet's, driven by the test as the owner. No private key, seed phrase or real
credential was created, printed or committed (disposable local tokens lived in mode-0600 scratch files under `/tmp` and were
deleted).
