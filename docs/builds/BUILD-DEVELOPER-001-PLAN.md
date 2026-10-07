# BUILD-DEVELOPER-001 — Plan: FloFi for Developers (Developer API, SDK, webhooks)

Date: 2026-10-07. Branch `claude/build-developer-001` (worktree `~/projects/flofi-developer`), **stacked** on
`claude/build-mcp-002` at `8f9650a` (itself stacked on BUILD-MCP-001, PR #63, open). `origin/main` is `bf84bbd`. Nothing is
merged, rebased or published by the agent.

**Status:** owner-reviewed on 2026-10-07 and approved with two adjustments (§0). Implementation has **not** started. The first
implementation commit is the shared platform extraction (§2).

> **An API key is not financial authority.** A developer credential authenticates an *integration*, never a wallet and never a
> person. It can discover capabilities, compose, validate, simulate, hand a strategy to its owner, and read what the owner chose
> to share. It cannot sign, submit, approve a Review or move funds, because no endpoint exists that does so. Execution still
> needs the end user, in FloFi, to prove their wallet, run a fresh simulation, review the Strategy Manifest, approve explicitly
> and sign with their own wallet. FloFi and the developer never hold a key and never sign.

**For agentic workers:** implement task by task (§25) with superpowers:executing-plans or
superpowers:subagent-driven-development. Every task is test-first and ends green with its own commit. Step-level code is
written per task against the interfaces fixed here.

**Goal:** a third-party server application integrates FloFi end-to-end with minimal code — discovery → immutable strategy →
validate → simulate → hand-off to the user → the user's own wallet flow in FloFi → status → evidence → signed webhook — over the
**same** engine, handoff and execution path as the FloFi web app and MCP.

**Architecture:** BUILD-DEVELOPER-001 first extracts the engine logic embedded in `src/mcp/tools.ts` into a shared
`src/platform/` layer (MCP behaviour unchanged). It then adds one new transport, `/api/developer/v1`. That transport is a
framework-free handler like `src/mcp/gateway.ts` and calls only `src/platform`. A dependency-free TypeScript SDK sits on top.
Approvals reuse the MCP-002 handoff persistence and state machine, generalized behind requester-neutral platform interfaces,
then `/approve`, the claim → `propose()` bridge and the unchanged flow panels. Webhooks are notifications derived from durable
state, never inputs to it.

**Tech stack:** Next.js 16.3.6 route handler (Node runtime), TypeBox + Ajv (existing), PostgreSQL via
`@defi-workflow-engine/cloud-runtime` (embedded runtime), `node:crypto`. **No new registry dependency.**

## Global constraints

- Toolchain: Node 24.21.0, pnpm 11.22.0, Foundry Anvil 1.8.3 (pinned). No new registry package. The lockfile changes only by
  one workspace importer (the SDK).
- Work on `claude/build-developer-001`. Never merge or enable auto-merge. Never rebase onto `main` unless asked. Never rewrite
  MCP-001/MCP-002 history. Never modify another worktree's branch (including CHANNELS).
- No real financial transaction. No production or live credential. Mainnet stays disabled.
- Do not modify the parallel UX/rebrand implementation (§22). No `/developers` or `/app/*` frontend.
- No secret, key, seed phrase, API key, webhook secret or approval secret in logs, URLs (except the approval fragment), error
  bodies, webhook payloads, idempotency records or Git.
- Do not delete, skip or weaken tests or gates. Every existing MCP-001/002 assertion passes unchanged.
- Evidence stays honest: acceptance for this build is MOCKED plus local integration (PostgreSQL + loopback browser).

---

## 0. Owner decisions (2026-10-07) and acceptance criterion

| # | Decision | Status |
| --- | --- | --- |
| D1 | Server-side API keys; no OAuth client credentials now | **APPROVED** |
| D3 | The existing StrategySpec (v1/v2) is the public strategy contract; no second developer-facing language | **APPROVED** |
| D4 | Developer access to end-user execution status/evidence requires explicit user opt-in on the approval flow, **default OFF** | **APPROVED** |
| D5 | Reuse and extend the existing handoff persistence (no parallel handoff system), **with** a generalized service/domain boundary so the Developer API never permanently depends on MCP semantics or naming; backward compatibility preserved where required | **APPROVED WITH CONDITION** (§2, §9) |
| D7 | The SDK and public OpenAPI artifacts are Apache-2.0; the server stays AGPL-3.0-only | **APPROVED** |
| Adj. 1 | BUILD-DEVELOPER-001 **owns** the shared platform extraction; its first implementation commit is that extraction | **INCORPORATED** (§2) |
| Adj. 2 | Reduce the implementation MVP to the shortest complete third-party E2E; defer the rest | **INCORPORATED** (§6, §7, §27) |

The recommendations not explicitly addressed (D2 namespace, D6 webhook design, D8 sandbox-only, D9 embedded runtime, D10
operator CLI, D11 asynchronous events) proceed as written under the overall plan approval, trimmed to the MVP. The owner may
revisit any of them before its task. D12 (intended wallet) is **deferred** by the MVP reduction.

**Primary acceptance criterion (Colosseum):** *"A third-party server application can integrate FloFi end-to-end with minimal
code while FloFi remains the single execution truth and the developer credential has zero financial authority."*

Required E2E (all MOCKED chains, local integration):

```
developer authentication → capability discovery → create immutable StrategySpec → validate → simulate
  → create approval handoff → existing FloFi user approval / wallet flow → execution status → evidence retrieval
  → signed webhook notification
```

## 1. What exists and what is reused

| Concern | Existing component (path under `apps/reference-dapp/` unless noted) | Use |
| --- | --- | --- |
| StrategySpec v1/v2 | `src/engine/strategy-spec.ts` (`StrategyInputSchema`, closed, versioned; v2 = 1–8 steps) | **As is**: the public contract |
| Canonical IR + hashes | `src/engine/strategy-engine.ts` (`composeWorkflow`, `composeWorkflowBound`, `semanticWorkflowHash`, `workflowSequenceHash`, lending collapse) | as is |
| Validation / review | `reviewComposition` (linter + capability registry + strategy warnings) | as is |
| Capability discovery | `src/engine/capability-catalog.ts` (`codeCapabilities`, `supportedNetworks`, `supportedAssets`) | as is, behind a public projection |
| Execution plans + four facts | `src/mcp/execution.ts` (`executionPlan`, `workflowPlan`, `evaluateWorkflowGates`, `policyGate`, `handoffFindings`, `ENGINE_VERSION`) | as is, via `src/platform` |
| Simulation preview | `src/mcp/simulation.ts` (`previewPlan`, `projectSimulation` allowlists, `assertSafeOutput`), `McpRuntime.preview` → `backend/preview.ts` | as is, via `src/platform` |
| Runtime selection | `src/server/flow-runtime.ts`, `src/mcp/runtime.ts` (`deploymentRuntime`, `embeddedMcpRuntime`; the interface is transport-neutral despite its name) | as is, re-exported under neutral names |
| Handoff persistence + state machine | `src/mcp/handoff/store.ts` (`mcp_handoffs`: PENDING → CLAIMED → APPLIED; terminal EXPIRED/SUPERSEDED/REVOKED/STALE; forward-only DB trigger; compare-and-set in row locks) | **extended** (requester kinds, §9, §17) |
| Handoff service | `src/mcp/handoff/service.ts` (`requestApproval`, `verifyHandoff`, `approvalView`, `sharedRuns`, `approvalProgress`) | **moved** behind a requester-neutral boundary (§2) |
| `/approve` + claim bridge | `src/app/approve-action.ts`, `src/app/approve/page.tsx`, `src/components/approval-handoff.tsx` | origin-aware key dispatch and copy (§9) |
| Wallet ownership proof | `src/server/wallet-session.ts` (EIP-4361 + SIWS), `src/server/session-principal.ts` | as is |
| Run status / evidence reads | `McpRuntime.run/journal/evidence/runs/record`; projections inline in `src/mcp/tools.ts` | extracted (§2) |
| Credentials / ids / digests | `src/mcp/oauth/crypto.ts` (`newCredential`, `credentialOf`, HMAC `credentialDigest`, `newId`), `src/mcp/oauth/config.ts` (`deriveKey`, `publicOrigin`) | reused; new prefixes |
| Rate limits | `mcp_rate_limits` fixed windows (`McpOAuthStore.allow`) | reused via an extracted `fixedWindow()` (Task 4) |
| SSRF-guarded HTTPS | `src/mcp/oauth/cimd.ts` (`isPublicAddress`, `pinnedHttpsGet`) | extracted to `pinnedHttpsRequest()` for webhook POSTs (Task 6) |
| Request idempotency | `packages/cloud-runtime/src/idempotency.ts` (`api_idempotency`; REPLAY / CONFLICT / IN_PROGRESS; 24 h) | as is |
| Tenancy | `src/server/deployment.ts` (`deploymentTenant`, per-Preview-branch tenant) | as is; projects nest inside it |
| Durable store host | `src/mcp/oauth/runtime.ts` (`mcpStateHost`: embedded PostgreSQL only, else fail closed) | same rule |
| Test templates | `src/mcp/gateway.test-harness.ts`, `src/mcp/handoff/journey.pg.test.ts` (embedded runtime + MOCKED router harness), `e2e/mcp-in-chat.spec.ts` | developer journey tests |

Not reused: the MCP OAuth authorization server and MCP pseudonymous accounts. They model a consumer delegating to a chat
client, not an integrator's backend (§5).

Constraint carried forward: the embedded runtime has **no background worker**. `docs/deploy/CLOUD.md` records that
reconciliation is request-driven on a Preview and that Vercel Cron does not run for Previews. Webhook dispatch is designed for
this (§11).

## 2. Shared platform extraction — owned by BUILD-DEVELOPER-001 (first implementation commit)

BUILD-DEVELOPER-001 owns the extraction of the reusable engine logic out of the MCP transport into `src/platform/`. **The first
implementation commit after this plan is exactly that extraction**, and nothing else. It is the shared foundation that
BUILD-CHANNELS-001 (and any later surface) consumes instead of performing a competing extraction. Coordination with the
CHANNELS worktree is handled separately by the owner. This build documents ownership and does not modify that branch.

### 2.1 Commit-1 rules

- No new Developer API behaviour: no route, migration, configuration, UI or documentation change.
- MCP behaviour is preserved exactly: every MCP tool output, error code, `_meta`, scope check and log event is byte-identical.
- No test file changes except two **new** platform tests. Every existing MCP-001/002 assertion (unit, PostgreSQL, browser)
  passes unchanged.
- No UI changes. `approve-action.ts`, `approval-handoff.tsx` and `/approve` are untouched; they keep importing the existing
  module path, which becomes a compatibility re-export.
- The commit is independently reviewable. The diff touches only `src/platform/**` (new), `src/mcp/tools.ts` and
  `src/mcp/handoff/service.ts`.

### 2.2 Commit-1 file list (exact)

**New — `apps/reference-dapp/src/platform/`**

| File | Content (moved or extracted; no new semantics) |
| --- | --- |
| `index.ts` | The single import surface for non-MCP consumers. Re-exports the modules below and, **under neutral names**, the shared modules that still physically live under `src/mcp/`: from `execution.ts` (`executionPlan`, `workflowPlan`, `evaluateGates`, `evaluateWorkflowGates`, `policyGate`, `handoffFindings`, `ENGINE_VERSION`, types `ExecutionPlan`, `PlanStep`, `Gates`, `HandoffPolicy`); from `simulation.ts` (`previewPlan`, `strategyFlow`, `projectSimulation`, `assertSafeOutput`, type `SimulationView`); from `runtime.ts` (type `EngineRuntime` = `McpRuntime`, `deploymentEngineRuntime`, `embeddedEngineRuntime`); from `handoff/store.ts` (types `HandoffStore`, `HandoffRecord`, `HandoffStatus`, `WalletRef`); from `oauth/crypto.ts` (`newCredential`, `credentialOf`, `credentialDigest`, `newId`). |
| `refusal.ts` | `PlatformRefusal` (closed code + `extra`) and `refuse(code, extra?)`, the neutral counterpart of MCP's `ToolFailure`. |
| `strategy.ts` | From `tools.ts`: `composeWorkflowOrRefuse(strategy, hash?)` (was `composedWorkflow`), `composeSingleStep(strategy, hash, multiStepCode)` (was `composed`), `stepViews` (was `stepsOf`), `reviewCounts`, `MULTI_STEP_PLAN`, `validateStrategy(strategy, hash?)` (the `validate_strategy` computation), `reviewWorkflow(workflow)` (per-step reviews used by `review_strategy`). |
| `capabilities.ts` | From `tools.ts`: `memoizedRuntime`, `capabilityFacts(runtime, policy, filter)` → per row `{ row, plan, flow, mode, previewable, previewUnavailableReason, gates }`. Surface fields (MCP's `mcp: {…, approvalHandoff}` block) stay in the adapter. |
| `preview.ts` | From `tools.ts`: `simulatePreview(runtime, composition, subject, { budget? })`: plan → subject-namespace check → shared concurrency cap → optional budget → `runtime.preview` → `projectSimulation`. It holds the **one** per-instance concurrency counter (`MAX_CONCURRENT_SIMULATIONS = 2`) shared by every surface. Neutral refusals: `SIMULATION_BUSY`, `SIMULATION_RATE_LIMITED`. |
| `executions.ts` | From `tools.ts`: `findOwnedRun(runtime, wallets, executionId)` (absent ≡ not granted → `RUN_NOT_FOUND`), `executionStatusView(run, journalPage)`, `evidenceView(runtime, run, owner)`, `pickRow`. |
| `approvals.ts` | **Moved** from `src/mcp/handoff/service.ts`, plus the session minting extracted from `tools.ts`. It is the requester-neutral approval service: `ApprovalRequester` (commit 1 implements one variant, `{ kind: 'mcp-account', accountId, grantId, clientId, clientName }`); neutral `ApprovalDeps` (`origin`, `handoffKey`, `handoffs: HandoffStore`, `allow`, `runtime`, `policy`, `now`) instead of `OAuthConfig`/`McpState`; `requestApproval(deps, requester, strategy, hash)`, `approvalStatus`, `approvalProgress`, `sharedRuns`, `verifyHandoff`, `approvalView`, `approvalUrl(origin, secret)`, `planNamespace`, constants; `openApprovalSession(deps, approvalId, accountId)` and `walletDeepLinks(url, origin)` from `tools.ts`. Rate-limit bucket names and the store calls are unchanged. |
| `boundary.test.ts` | Layering guard: `src/platform/**` imports only `src/engine/**`, `src/domain/**` (types and helpers used by the engine), workspace packages, `node:*`, and the shared modules listed in `index.ts`. It never imports MCP transport or auth (`gateway`, `tools`, `config`, `oauth/{server,config,pg-store,cimd,consent-page,routes,runtime,state}`, `app/*`), Next.js, React or any model SDK. |
| `preview.test.ts` | The shared concurrency cap counts every caller together; neutral codes; the budget is consulted after the busy check and before the counter increments (MCP's order). |

**Modified**

| File | Change |
| --- | --- |
| `src/mcp/tools.ts` | Handlers delegate to `src/platform`. Output assembly, wording, `nextSteps`, `_meta`, scope checks, `accessBasis` and MCP error codes stay here. The `register` catch treats `PlatformRefusal` like `ToolFailure` and maps neutral codes to the existing MCP codes (`SIMULATION_BUSY → MCP_SIMULATION_BUSY`, `SIMULATION_RATE_LIMITED → MCP_SIMULATION_RATE_LIMITED`, `HANDOFF_RATE_LIMITED → MCP_HANDOFF_RATE_LIMITED`, `HANDOFF_PENDING_LIMIT → MCP_HANDOFF_LIMIT`), so outputs stay byte-identical. `walletDeepLinks` stays exported (re-export). |
| `src/mcp/handoff/service.ts` | Becomes a backward-compatible re-export of `src/platform/approvals.ts`; every existing export name is kept, so `approve-action.ts`, `approval-handoff.tsx` (type import) and the MCP tests are untouched. |

**Explicitly unchanged in commit 1:** `gateway.ts`, `config.ts`, `oauth/**`, `app/panel.ts`, `execution.ts`, `simulation.ts`,
`runtime.ts`, `handoff/store.ts`, `handoff/links.ts`, everything under `src/app/**` and `src/components/**`, all existing
tests, migrations, workflows and docs.

**Not in commit 1 (on purpose):**

- **Physically moving** `execution.ts`, `simulation.ts`, `runtime.ts` and `oauth/crypto.ts` into `src/platform/`. That waits
  until MCP-002 has merged, to avoid widening its rebase. Consumers never notice, because they import `src/platform` only.
- The handoff **persistence** generalization (schema change, Task 2).
- `fixedWindow` (Task 4) and `pinnedHttpsRequest` (Task 6), which arrive with their first consumer.

### 2.3 Commit-1 gates

1. `pnpm check`: typecheck, lint, build, schemas, unit tests including every MCP unit test unchanged, plus the two new tests.
2. `pnpm test:postgres`: MCP OAuth, handoff, journey and panel PostgreSQL tests unchanged.
3. `mcp-in-chat.spec.ts` (5 tests) under `GRYLOO_MCP_E2E=EMBEDDED_LOOPBACK_ONLY`, unchanged.
4. `python3 scripts/governance_lite.py` and its unittest suite on a `git archive` export.
5. `git diff --stat HEAD~1` lists only the files above, and `git diff HEAD~1 -- '*.test.ts' '*.spec.ts'` shows only the two new
   files.

### 2.4 How later surfaces consume it

Developer code (and later CHANNELS) imports **only** `src/platform`; a guard test in Task 4 forbids `src/developer/**` from
importing `src/mcp/**`. A new requester kind is a new `ApprovalRequester` variant plus a value of the persisted
`requester_kind` (§17). It is not a new handoff system, column family or service.

## 3. Architecture

```
FloFi Web ───────────────┐
ChatGPT / Claude ─ MCP ──┤   src/mcp/gateway.ts + tools.ts  (thin adapters after commit 1)
Channels (future) ───────┤   (consumes src/platform)
Third-party server ─ SDK ┴─► /api/developer/v1/*   src/developer/http.ts: key → principal → scope → limits → idempotency
                                   │
                                   ▼
                     src/platform/  (one shared engine service)
     compose ─► canonical IR + workflowHash ─► validation/review ─► execution plan + four facts ─► simulation preview
                                   │
          approval handoff (mcp_handoffs; requester_kind MCP_ACCOUNT | DEVELOPER_PROJECT; immutable, forward-only)
                                   │  approvalUrl = <origin>/approve#<secret>      (authority NONE)
                                   ▼
     /approve (FloFi origin) ─► wallet proof (EIP-4361 / SIWS) ─► claim (re-compose, re-check, CAS) ─► propose(command)
                                   ▼
     existing flow panel ─► fresh simulation ─► Strategy Manifest Review ─► explicit approval ─► OWNER WALLET SIGNS
                                   ▼
     execution ─► recovery ─► reconciliation ─► Evidence Bundle             (unchanged flows: one execution truth)
                                   │
     state ─► developer_events (dedupe key) ─► signed webhook deliveries (retried)        ◄── notifications only
     GET /v1/approvals/:id · /v1/executions/:id · /evidence   (owner-shared runs only)
```

The Developer API never calls a flow method that prepares, authorizes, hands off, reports or submits. Its runtime calls are
limited to `mode`, `info`, `status` (read as the claimant owner), `runs`, `previewFlow` and run/journal reads; a test enforces
this (§24).

## 4. The smallest new abstraction: the Developer Project

```
deployment tenant (existing: default | pv-<branch>-<hash>)
  └─ developer project  prj_…   operator-set display name, status, plan (free; pro/enterprise reserved)
       └─ environment: sandbox   (production reserved; no live credential in this build)
            ├─ API keys            key_…  flofi_sk_test_…, scopes, status, last used
            ├─ strategies          str_…  immutable canonical strategy + workflowHash + engineVersion
            ├─ approvals           apr_…  mcp_handoffs rows with requester_kind DEVELOPER_PROJECT
            ├─ events              evt_…  derived, deduplicated (internal)
            ├─ webhook endpoints   whe_…  + deliveries whd_… (internal)
            └─ usage               daily counters (internal, write-side only)
```

There are no organizations, teams, users or roles. The operator (owner) creates projects and keys with a CLI (§18).

## 5. Identity and authority

| Identity | Proven by | Grants | Never grants |
| --- | --- | --- | --- |
| **Developer project / API key** | `Authorization: Bearer flofi_sk_test_…` (HMAC digest lookup) | discovery, compose, validate, simulate, create approval handoffs, read own resources, read owner-shared executions | wallet ownership, a wallet session, a signature, Review approval, submission, another project's data |
| **FloFi end-user account** | not involved: the developer path creates no FloFi account; MCP's `mcp_accounts` stay MCP-only | — | — |
| **Wallet** | EIP-4361 / SIWS proof on the FloFi origin (HttpOnly session) | claim of one approval; the owner's own Review and signature | anything to the developer beyond what the owner opts in to share |

**D1 (approved):** server-side secret API keys. They are 256-bit opaque credentials stored as HMAC-SHA-256 digests keyed by
HKDF of a dedicated secret, with typed prefixes and fail-closed configuration (MCP-002 primitives). Keys are **server-side
only**: a request carrying an `Origin` header is refused (403, `BROWSER_ORIGIN_FORBIDDEN`), no CORS headers are sent, and the
SDK refuses to construct in a browser.

| Invariant | Enforcement | Test (§24) |
| --- | --- | --- |
| No private keys / seed phrases accepted | closed schemas; StrategySpec has no key fields; unknown keys refused without echo | `rejects-secret-shaped-fields` |
| No signing keys stored | no such column or endpoint; webhook secrets derived, not stored | schema review + `no-signing-surface` |
| Manifest Review not bypassable | no route reaches `review`/`begin`/`handoff`/`report`; approvals end in `/approve` → `propose()` → the existing panel | `developer-api-never-calls-mutating-flow-methods` |
| Wallet signature not bypassable | the only "sends" in every journey are the owner's wallet transactions | journey: `sends === owner signatures` |
| No invisible mutation of an approved strategy | immutable `developer_strategies`; extended handoff immutability trigger; INSERT trigger (approval hash = strategy hash) | `strategy-immutable`, `approval-binds-strategy-hash` |
| Canonical calldata not replaceable | developers never send or receive calldata; the flow builds it at Review, bound to the Manifest commitment; `assertSafeOutput` on every response | `no-calldata-in-any-response` |
| API auth is not wallet ownership | the principal has no wallet field; claims read only HttpOnly wallet sessions | `api-key-is-not-a-wallet-session` |
| No cross-project / cross-tenant access | every query scoped by `(tenant_id, project_id, environment)` from the principal; foreign ids → 404 identical to absent | `tenant-isolation` |
| No secrets or session tokens in logs / webhooks | allowlisted log fields; payload guard; regex sweep of captured logs and payloads | `no-secret-leakage` |
| Webhook retries cannot duplicate execution | webhooks are outputs only; events derive from state; `webhook-id` is stable across retries | `webhook-replay-changes-nothing` |

## 6. MVP API: 10 public endpoints + 1 internal

**Namespace:** `https://<deployment>/api/developer/v1/…`. It sits next to `/api/mcp` and stays distinct from the internal
Railway `/v1/*`. One catch-all route file delegates to the framework-free `handleDeveloperRequest(request, options)`.

**Conventions:**

- JSON in and out; bodies ≤ 64 KiB; closed request schemas (unknown fields or query parameters → 400); decimal-string amounts.
- Typed ids: `str_`, `apr_`, `evt_`, `whe_`, `whd_`, `key_`, `prj_` + 26 base32 characters.
- Every response carries `request-id: req_…` and `cache-control: no-store`.
- `Idempotency-Key` is accepted on every creating POST (§12).
- `authority: "NONE"` appears on strategies, simulations and approvals.
- Breaking changes go to `/v2`; additive fields may appear in v1.

**Scopes (MVP):** `strategies`, `approvals`, `executions`, `webhooks`. A new key gets all four. Discovery needs only a valid
key. No scope can execute, sign, submit or approve a Review.

| # | Method & path | Scope | E2E step | Engine operation reused |
| --- | --- | --- | --- | --- |
| 1 | `GET /v1/capabilities?network=&action=` | any valid key | authentication + discovery | `capabilityFacts` → public projection: action, networks, fundsClass, operations (compose/validate/simulate/approve) with reasons, availability (four facts), plan kind, example strategy |
| 2 | `POST /v1/strategies` | `strategies` | create immutable StrategySpec | `composeWorkflowOrRefuse` → persist immutable → strategy with inline validation and availability |
| 3 | `POST /v1/strategies/:id/validate` | `strategies` | validate | re-compose with the **current** engine (`STRATEGY_STALE` if the hash no longer reproduces) + review findings + availability now |
| 4 | `POST /v1/strategies/:id/simulate` | `strategies` | simulate | `simulatePreview` with `{simulationSubject}`; read-only, nothing persisted, never authorizable |
| 5 | `POST /v1/approvals` | `approvals` | create approval handoff | `requestApproval` (developer requester) → `{approvalUrl, …}` |
| 6 | `GET /v1/approvals/:id` | `approvals` | follow the user's progress | `approvalProgress` (lazy expiry, owner-shared executions) |
| 7 | `GET /v1/executions/:id` | `executions` | execution status | `executionStatusView` on an owner-shared run |
| 8 | `GET /v1/executions/:id/evidence` | `executions` | evidence retrieval | `evidenceView` (validated canonical Evidence Bundle) |
| 9 | `POST /v1/webhook-endpoints` | `webhooks` | signed webhook notification | endpoint + secret (shown once) |
| 10 | `DELETE /v1/webhook-endpoints/:id` | `webhooks` | secret replacement | the only developer-side way to retire a compromised or rotated secret (rotation by replacement, §11.4) |
| int. | `POST /api/developer/v1/internal/dispatch` | scheduler bearer (not an API key) | webhook delivery when no request triggers it | bounded event sync + delivery sweep (§11.5) |

**D3 (approved):** v1 accepts exactly `StrategyInputSchema`. The brief's illustrative example becomes:

```ts
const strategy = await flofi.strategies.create({ strategy: { version: 2, steps: [
  { action: 'supply', network: 'base-sepolia', asset: 'USDC', amount: '100', beneficiary: user },
  { action: 'borrow', network: 'base-sepolia', asset: 'USDC', amount: '20',  beneficiary: user },
  { action: 'swap',   network: 'base-sepolia', inputAsset: 'USDC', outputAsset: 'WETH', amount: '20' },
] } });
// FloFi recognises this exact shape as its Base Sepolia lending composition: executionPlan.kind === 'COMPOSITE_FLOW'.
// Aave v3 is the only lending protocol on these networks, so `protocol` is implied. Other multi-step shapes are composed,
// validated and reviewed, but approval reports CAPABILITY_NOT_SUPPORTED / MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED until the
// sequential runner (MCP-002 follow-up) exists.
const validation = await flofi.strategies.validate(strategy.id);
const simulation = await flofi.strategies.simulate(strategy.id, { simulationSubject: user });
const approval   = await flofi.approvals.create({ strategyId: strategy.id, workflowHash: strategy.workflowHash });
// → { id, strategyId, workflowHash, status: 'PENDING', approvalUrl, expiresAt, authority: 'NONE', requires: [...] }
```

Responses (abridged):

```jsonc
// POST /v1/strategies
{ "id": "str_…", "object": "strategy", "environment": "sandbox", "strategy": { /* canonical, normalized StrategyInput */ },
  "workflowHash": "0x…", "engineVersion": "flofi-engine-2", "fundsClass": "TEST_FUNDS", "networkEnvironment": "PUBLIC_TESTNET",
  "steps": [{ "index": 0, "action": "supply", "network": "base-sepolia", "destinationNetwork": null, "kind": "…", "protocol": "…", "stepWorkflowHash": "0x…" }],
  "executionPlan": { "kind": "COMPOSITE_FLOW", "reason": null },
  "validation": { "valid": true, "summary": { "block": 0, "warning": 2, "information": 3 }, "findings": [ … ], "preExecution": [ "…" ] },
  "availability": { "executable": true, "reason": null, "supportedByCode": true, "enabledByDeployment": true, "enabledByPolicy": true,
                    "demonstratedEvidence": "NONE_DEMONSTRATED" },
  "summary": "…", "explanation": [ … ], "notes": [ … ], "createdAt": "…", "authority": "NONE" }
// GET /v1/approvals/:id
{ "id": "apr_…", "object": "approval", "strategyId": "str_…", "workflowHash": "0x…", "status": "APPLIED", "expiresAt": "…",
  "statusShared": true, "executions": [{ "id": "…", "status": "…", "reconciled": true, "terminal": true,
  "evidence": { "environment": "MOCKED", "outcome": "…", "bundleHash": "0x…" } }], "authority": "NONE" }
```

No internal structures are exposed: no flow names, flow modes, adapter ids, editor commands or the IR document. Public views
are explicit allowlist mappers (`src/developer/views.ts`) with TypeBox response schemas, which also generate the OpenAPI
document.

## 7. Eventual v1 contract (documented, deferred from this build)

These keep the same conventions and are additive; none is needed for the E2E:

| Deferred endpoint | Purpose |
| --- | --- |
| `GET /v1/me` | key introspection (any authenticated call already proves the key) |
| `GET /v1/networks`, `GET /v1/assets` | flat discovery lists (capability rows already carry networks and example strategies) |
| `GET /v1/strategies/:id`, strategy and approval lists | retrieval convenience (the create response is complete) |
| `POST /v1/approvals/:id/link`, `POST /v1/approvals/:id/revoke` | fresh link and early withdrawal (approvals expire in 15 min) |
| `GET /v1/events`, `GET /v1/events/:id` | event browsing / polling |
| `GET /v1/webhook-endpoints[/:id]`, `PATCH`, `POST …/rotate-secret`, `POST …/test`, `GET …/deliveries`, redelivery | endpoint management, in-place rotation, test pings, delivery browsing |
| `GET /v1/usage` | usage reporting (the counters are recorded from day one) |

## 8. Strategy immutability and approval binding (exactly how MCP-002 is reused)

1. `POST /v1/strategies` stores the **canonical normalized** strategy, `workflowHash`, `ENGINE_VERSION` and plan in
   `developer_strategies`. A `BEFORE UPDATE` trigger raises, and no update endpoint exists. A changed strategy is a **new**
   strategy id with a new hash.
2. `POST /v1/approvals` requires `{strategyId, workflowHash}`. A different hash → 409 `STRATEGY_CHANGED`.
3. The server re-composes the stored strategy with the current engine (`composeWorkflowBound`); if that no longer reproduces
   the hash → 409 `STRATEGY_STALE` (MCP-002 `STALE`). It then evaluates the four facts and `handoffFindings` (blockers → 422
   `REVIEW_BLOCKED`). This is the same platform path `request_user_approval` uses after commit 1.
4. The handoff is an `mcp_handoffs` row with `requester_kind = 'DEVELOPER_PROJECT'`, `project_id`, `environment` and
   `strategy_id`. It holds its own copy of the canonical strategy, hash, engine version and plan. The **existing** immutability
   trigger (extended to the new columns) forbids changing any of them. A new INSERT trigger requires `workflow_hash` to equal
   the referenced strategy's hash, in the same project, so the database binds an approval to one immutable strategy revision.
5. The approval URL is `<origin>/approve#flofi_dhs_<43>`. The secret travels only in the fragment, and the row keeps an HMAC
   digest under the developer key.
6. `/approve` re-verifies (`verifyHandoff`) on view, and again inside the row lock on claim. The claim binds the proving wallet
   immutably.
7. The claim returns the re-composed authoring `Command` → `propose()`. `markApprovalApplied` requires the editor workflow to
   hash exactly to the handoff hash (`HANDOFF_WORKFLOW_MISMATCH`).
8. The existing flow then runs: fresh authoritative simulation → route-bound Strategy Manifest → explicit approval → wallet
   signature. An edit in FloFi produces another workflow. `sharedRuns` binds only runs whose reviewed workflow hashes
   **exactly** to the approval's, so an edited execution is never reported as this approval's.

## 9. Approval handoff for the developer requester

- **Service boundary (D5 condition):** the Developer API calls only `src/platform/approvals.ts` with
  `ApprovalRequester = { kind: 'developer-project', projectId, environment, projectName, strategyId }` (added in Task 2 next to
  `mcp-account`). The store interface is requester-neutral (`create`, `forRequester`, `claim`, `apply`, `openSession`,
  `bindRuns`, `setSharing`, `purge`). MCP's `forAccount` stays as a compatibility wrapper.
- **Persistence and backward compatibility:** the table name `mcp_handoffs` and the trigger messages (`MCP_HANDOFF_*`) are
  kept, because existing MCP PostgreSQL tests assert them and query the table directly. They are adapter details behind the
  platform store. A rename to `approval_handoffs` can come later in one migration plus one store file.
- **Creation:** PENDING window 15 min, claim window 10 min (MCP values, not configurable in the MVP). Pending cap per project
  and environment: 100. **No supersession** for developer requesters, because many end users may share one workflow hash.
  Idempotent replays never return a stored secret (§12).
- **`/approve`** (Task 5):
  - `approve-action.ts` dispatches on the secret prefix through a small platform key registry (`flofi_hs_` → MCP key,
    `flofi_dhs_` → developer key; a disabled surface → `HANDOFF_NOT_FOUND`). It works when either surface is enabled.
  - `approvalView` gains `requesterKind`.
  - `approval-handoff.tsx` (the build's only UI edit, with existing CSS classes) shows for developer approvals: "EXTERNAL
    PROPOSAL · FROM <PROJECT NAME> (third-party app registered with FloFi)" and "Created by <name>, not by FloFi. It is not
    financial advice; you decide, and only your wallet can sign." MCP copy is unchanged.
- **Status sharing (D4, approved):** the checkbox "Share this execution's status and evidence with <name>" is **OFF by
  default**. Without it, the developer sees approval states only (claimed / applied / ended), never the wallet, runs or
  evidence. The user can change it after the claim (`setApprovalSharing`).
- After claim, apply and sharing changes, `/approve` schedules (`after()`) the event sync for that approval (§11.3).

## 10. Execution status and evidence

- An execution is a FloFi run. The developer learns its id from `GET /v1/approvals/:id` or from events.
- `GET /v1/executions/:id` resolves through `mcp_handoffs` (`requester_kind = 'DEVELOPER_PROJECT'`, this project and
  environment, `share_status`, `run_ids @> {id}`), then reads the run **as the claimant owner** (existing owner-scoped reads).
  Absent, unshared and foreign runs all return 404 `NOT_FOUND`.
- Projection: `status`, `reconciled`, `terminal`, `errorCode`, `provenance`, the claimant wallet (shared), `attempts[]`
  (`step`, `state`, `transactionHash`, `reconciled`), the evidence summary, timestamps. Never calldata, unsigned transactions,
  nonces, Review commitments or journal internals.
- Evidence: the extracted `evidenceView`. The canonical bundle is schema-validated, and environment and outcome are copied,
  never upgraded.

## 11. Events and webhooks

### 11.1 Event types (asynchronous state changes only)

| Type | When | Data (never secrets, calldata or tokens) |
| --- | --- | --- |
| `approval.claimed` | a wallet proved ownership and claimed | approval id, strategy id, workflowHash; wallet only if shared |
| `approval.applied` | the proposal was loaded into the user's FloFi workflow | same |
| `approval.ended` | EXPIRED / REVOKED / STALE (`data.status`) | same |
| `execution.started` | a shared run bound to the approval is first observed | execution id, status |
| `execution.failed` | terminal with an error, not reconciled | execution id, errorCode |
| `execution.reconciled` | reconciled with evidence | execution id, evidence environment, outcome, bundleHash |

Envelope: `{ "id": "evt_…", "type", "apiVersion": "v1", "environment", "createdAt", "data": {…} }`. Ordering is not
guaranteed. `data` is a hint; consumers fetch the resource for current state.

### 11.2 Notifications, not authority

No FloFi state transition reads a webhook response. A failing endpoint never blocks or alters approvals, claims, runs or API
responses. A test pins an endpoint to `500` and shows identical handoff and run outcomes.

### 11.3 Production: derived, convergent, deduplicated

`syncDeveloperEvents(handoff)` derives the events implied by the current handoff and run state (runs from the existing
`sharedRuns`). It inserts the missing ones with `ON CONFLICT (tenant_id, project_id, dedupe_key) DO NOTHING`, using keys such as
`execution.reconciled:<run>`, and fans out one delivery per active subscribed endpoint in the same transaction. It is
idempotent and race-safe across serverless instances.

### 11.4 Signing and secrets

- **Standard Webhooks headers:** `webhook-id: evt_…` (stable across retries), `webhook-timestamp`, and
  `webhook-signature: v1,<base64 HMAC-SHA256(secret, id.timestamp.body)>`. FloFi adds `flofi-delivery-id`,
  `flofi-delivery-attempt` and `user-agent: FloFi-Webhooks/1`.
- **Derived secrets, nothing stored:** `whsec_ + base64(HMAC-SHA256(HKDF(FLOFI_DEVELOPER_SECRET, 'webhook'), tenant:endpoint:1))`.
  The secret is returned once, at creation. The trailing version input `1` lets in-place rotation (deferred) be added later
  without changing existing secrets.
- **Rotation in the MVP is by replacement:** create a new endpoint, switch the receiver to accept both secrets
  (`verifyWebhook({ secret: [old, new] })`), then delete the old endpoint. Duplicate notifications during the overlap share one
  `webhook-id`.
- **Consumers** verify the signature, reject timestamps outside ±5 min, and deduplicate on `webhook-id`.

### 11.5 Delivery, retries and triggers

- **Transport:** `pinnedHttpsRequest` POST.
  - HTTPS on port 443 only, with DNS resolved per attempt and every address checked as public (rebinding-safe).
  - Pinned socket, no redirects, 10 s timeout, response read ≤ 1 KiB and discarded.
  - Registration refuses non-HTTPS URLs, private IP literals, userinfo and fragments.
  - `http://127.0.0.1` is allowed only with `FLOFI_DEVELOPER_WEBHOOK_LOOPBACK=ALLOW_LOCAL_ONLY` on a non-hosted deployment.
- **Retries:** success = 2xx. Otherwise retries run at +30 s, 2 min, 10 min, 30 min, 1 h, 3 h, 6 h, 12 h and 24 h, with ±20 %
  jitter: ten attempts in about two days, then `DEAD`. Claims use `FOR UPDATE SKIP LOCKED` with a lease, so no attempt is sent
  twice.
- **Triggers (the embedded runtime has no worker):**
  1. `after()` on developer API requests (≤ 3 approvals synced, ≤ 5 deliveries, ≤ 5 s);
  2. `after()` on `/approve` transitions;
  3. the internal dispatch endpoint, for Vercel Cron on production or any scheduler. Adding a cron entry is an owner action.

  On a Preview without a scheduler, events appear on the developer's next API call or the user's next `/approve` action. This
  latency limit is documented. `GET /v1/approvals/:id` always computes fresh state.
- **Observability (MVP):** delivery rows are durable (status, attempts, last HTTP status, last error code, next attempt) and
  visible through the operator CLI and structured logs (ids, type, attempt, outcome; never the URL or secret). The
  developer-facing delivery API is deferred.

## 12. Idempotency

- `api_idempotency` (`createIdempotencyStore`) is reused with scope `developer/<project-body>/<environment>/<operation>` and
  `requestHash(scope, body)`. Retention is 24 h.
- Same key with the same request returns the stored response, with an `idempotent-replayed: true` header.
- Same key with a different request → 409 `IDEMPOTENCY_CONFLICT`. A concurrent duplicate → 409 `IDEMPOTENCY_IN_PROGRESS`
  (retryable). Failures release the key.
- **Covered:** `POST /strategies`, `POST /approvals`, `POST /webhook-endpoints`. `DELETE` is naturally idempotent.
- **Secrets are never stored in idempotency records.**
  - The stored approval response has `approvalUrl: null`; a replay mints a fresh 5-minute session link through the platform's
    `openApprovalSession`.
  - A stored endpoint response omits `secret`; a replay returns `secret: null` with `secretAlreadyIssued: true`.
  - Tests assert that no `flofi_dhs_` or `whsec_` value lands in `api_idempotency`.
- The SDK sends a UUID `Idempotency-Key` on these POSTs and reuses it across its own retries.

## 13. Rate limits and usage readiness

| Limit (plan `free`) | Value |
| --- | --- |
| API requests per project × environment | 300 / min |
| Simulations | 30 / h, plus the shared per-instance concurrency cap (2) for every surface |
| Approval creations | 60 / h; pending cap 100 |
| Webhook endpoints | 5 per project × environment |

- Counters use the `mcp_rate_limits` fixed windows through `src/platform/fixed-window.ts`. Over a limit → 429 `RATE_LIMITED`
  with `Retry-After`.
- The project has a `plan` column (`free`; `pro`/`enterprise` reserved) mapped to a limits table in code. Future plans are
  data, not code.
- **Usage is metered write-side only** (`developer_usage`, daily upserts) because history cannot be recreated later:
  `strategy.create`, `simulation.run` (network), `approval.create`, `execution.reconciled` (network × protocol, counted once
  when its event is produced), `webhook.delivery` (outcome). No usage API, billing, invoices or pricing in this build.

## 14. Environments and mainnet policy

| Environment | In this build | Behaviour |
| --- | --- | --- |
| local / mock | implemented | `FLOFI_RUNTIME=embedded` + local DB, MOCKED harness flows; tests and E2E; loopback webhooks allowed |
| sandbox | implemented | `flofi_sk_test_…` keys; **TEST_FUNDS only**: a strategy touching a mainnet network is refused at creation (`MAINNET_DISABLED`, `SANDBOX_TEST_FUNDS_ONLY`); any embedded-runtime deployment |
| production | reserved | `environment` column and the `flofi_sk_live_` prefix exist; live keys are **refused** (`LIVE_MODE_DISABLED`) and cannot be issued |
| mainnet-enabled production | not built | would need live keys, a deployment and per-project mainnet allowlist, the flow's owner-execution switch, and the MCP-002 "Mainnet Activation Path" prerequisites (keyed RPC, owner-signed evidence, legal review) |

The developer `HandoffPolicy` for sandbox is `{testFunds: true, mainnetNetworks: []}`, evaluated by the existing `policyGate`.
Nothing in the schemas, tables, URLs or SDK is testnet-specific.

## 15. Tenant isolation

- Every developer row's key begins with `(tenant_id, project_id[, environment])`.
- Every store method takes the **principal**, never a client-supplied project id, and every SQL statement filters by it.
  Developer handoffs are reached only through `forRequester` with the project and environment.
- Foreign or absent ids → 404 `NOT_FOUND` with byte-identical bodies (ids are 128-bit random).
- Deployment tenants isolate everything again, as for MCP.
- Event fan-out and dispatch filter by project and environment in SQL.

## 16. TypeScript SDK (D7, approved)

Package `packages/developer-sdk`:

- private workspace package `@defi-workflow-engine/developer-sdk` 0.1.0, **Apache-2.0**;
- zero runtime dependencies, ESM, Node ≥ 20 and edge runtimes;
- npm name `@flofi/sdk`; publication deferred.

```ts
import { FloFi, verifyWebhook, FloFiError } from '@flofi/sdk';
const flofi = new FloFi({ apiKey: process.env.FLOFI_API_KEY!, baseUrl: 'https://<deployment>' });
flofi.capabilities.list({ network, action });
flofi.strategies.create({ strategy }, { idempotencyKey? }); flofi.strategies.validate(id); flofi.strategies.simulate(id, { simulationSubject });
flofi.approvals.create({ strategyId, workflowHash });   // or approvals.create({ strategy }) with the object returned by create
flofi.approvals.get(id); flofi.executions.get(id); flofi.executions.evidence(id);
flofi.webhookEndpoints.create({ url, events? }); flofi.webhookEndpoints.delete(id);
const event = await verifyWebhook({ payload: rawBody, headers, secret });   // Standard Webhooks; ±300 s; secret may be an array
```

- **Thin:**
  - typed client and types; auth header; JSON; timeouts (60 s default, 300 s for simulate);
  - `FloFiError {status, code, reason, requestId, issues}`;
  - safe retries only: network errors, 429, 502/503/504 honouring `Retry-After`, and only for GETs and POSTs carrying an
    idempotency key;
  - automatic idempotency keys, a browser guard (`FLOFI_SDK_SERVER_ONLY`) and an injectable `fetch`.
- **No business logic:** no composition, validation, hashing or schema checks.
- **Parity is tested, not duplicated:**
  - an app-side type test asserts the SDK types are mutually assignable with the server's TypeBox `Static` types;
  - an app-side contract test drives the SDK against the real handler through the injected `fetch`.

## 17. Storage: migration `0006_developer_platform.sql`

Every table key starts with `tenant_id`. Only keyed digests are stored; there is no plaintext credential and no reversible
secret.

| Table / change | Columns (abridged) | Notes |
| --- | --- | --- |
| `ALTER mcp_handoffs` | `+ requester_kind` `MCP_ACCOUNT` / `DEVELOPER_PROJECT` (default `MCP_ACCOUNT`); `+ project_id`, `+ environment`, `+ strategy_id`; `account_id`, `grant_id` nullable | CHECK per kind (`MCP_ACCOUNT` ⇒ account + grant, no project; `DEVELOPER_PROJECT` ⇒ project + environment + strategy, no account/grant); composite FK `(tenant, project, strategy)` → strategies; INSERT trigger: `workflow_hash` = strategy's; transition trigger replaced (new columns immutable; `MCP_HANDOFF_*` messages kept); partial index for developer rows. Existing rows become `MCP_ACCOUNT` unchanged. Later requester kinds (e.g. a channel) extend the CHECK in their own migration. |
| `developer_projects` | `project_id ^prj_[a-z2-7]{26}$`, `display_name` (1–64, printable, operator-set), `status`, `plan` | disabling a project disables all its keys at once |
| `developer_api_keys` | `key_id`, `project_id`, `environment`, `key_digest bytea(32) UNIQUE`, `hint` (last 4), `scopes text[]` ⊆ the four scopes, `status`, `created_at`, `revoked_at`, `last_used_at` | the environment fixes the prefix (`flofi_sk_test_` ↔ sandbox, `flofi_sk_live_` ↔ production) |
| `developer_strategies` | `strategy_id`, `project_id`, `environment`, `strategy jsonb ≤ 16 KiB`, `workflow_hash`, `engine_version`, `funds_class`, `network_environment`, `plan jsonb`, `created_at`; `UNIQUE (tenant_id, project_id, strategy_id)` | `BEFORE UPDATE` → raise; CHECK: sandbox ⇒ TEST_FUNDS |
| `developer_events` | `event_id`, `project_id`, `environment`, `type`, `dedupe_key`, `approval_id`, `execution_id`, `data jsonb ≤ 16 KiB`, `created_at`; `UNIQUE (tenant_id, project_id, dedupe_key)` | retention 30 d |
| `developer_webhook_endpoints` | `endpoint_id`, `project_id`, `environment`, `url` (https ≤ 2048), `event_types text[]`, `status`, `created_at`, `deleted_at` | cap 5 active |
| `developer_webhook_deliveries` | `delivery_id`, `project_id`, `endpoint_id`, `event_id`, `status` PENDING/SUCCEEDED/DEAD, `attempts`, `next_attempt_at`, `claimed_until`, `last_attempt_at`, `last_status`, `last_error`; `UNIQUE (tenant_id, endpoint_id, event_id)` | retention 30 d |
| `developer_usage` | PK `(tenant_id, project_id, environment, day, metric, dimension)`, `count bigint` | kept |

Reused unchanged: `mcp_rate_limits` (buckets `dev:<prj>:<env>:<metric>`) and `api_idempotency`. The identity of 0006 is pinned
in `SHIPPED_MIGRATIONS`. The number assumes no other branch takes 0006 first (§22).

## 18. Configuration and operator tooling

| Variable | Default | Meaning |
| --- | --- | --- |
| `FLOFI_DEVELOPER` | off | `enabled` serves `/api/developer/v1`; otherwise 404 `DEVELOPER_API_NOT_ENABLED` |
| `FLOFI_DEVELOPER_SECRET` | — | dedicated, ≥ 32 chars; HKDF labels `flofi/developer/{api-key,handoff,webhook}/v1`; refused (fail closed) if equal to `API_AUTH_TOKEN`, `FLOFI_SESSION_SECRET` or `FLOFI_MCP_OAUTH_SECRET` |
| `FLOFI_PUBLIC_ORIGIN` | — | shared with MCP: the approval URL base (exact origin, never request headers) |
| `FLOFI_DEVELOPER_DISPATCH_TOKEN_SHA256` | — | optional: digest of the scheduler bearer for the internal dispatch endpoint |
| `FLOFI_DEVELOPER_WEBHOOK_LOOPBACK` | — | `ALLOW_LOCAL_ONLY`: `http://127.0.0.1` endpoints on non-hosted deployments only (tests/E2E) |

The Developer API requires the **embedded runtime** (`DATABASE_URL`, no `API_BASE_URL`). On the remote runtime it answers 503
`SERVICE_UNAVAILABLE` with reason `DEVELOPER_STORE_UNAVAILABLE`, and never falls back. It needs no new external service and no
model API key.

**Operator CLI** `apps/reference-dapp/backend/developer-admin.ts`:

- Commands: `create-project --name`, `create-key --project` (sandbox only), `revoke-key --key`, `list-keys --project`,
  `disable-project`, `deliveries --project` (read-only delivery state).
- It uses `DATABASE_URL`, an explicit `--tenant` (or `--preview-branch`) and `FLOFI_DEVELOPER_SECRET`.
- It prints a new key **once**, to the operator's own terminal. The agent runs it only against disposable test databases and
  never prints a real key.

## 19. Errors and observability

Error body: `{ "error": { "code", "reason", "message", "issues"?, "requestId" } }`.

- `code` is a small, stable public set.
- `reason` is the classified engine or gate code.
- `issues` are `{path, rule}`, never values.
- No stack traces, provider bodies, SQL, hostnames or secrets.

| HTTP | `code` | Typical `reason` |
| --- | --- | --- |
| 400 / 413 | `INVALID_REQUEST` | malformed JSON, unknown field or query, body too large |
| 400 | `INVALID_STRATEGY` | `STRATEGY_SCHEMA_INVALID`, engine refusal codes |
| 401 | `UNAUTHORIZED` | missing, malformed, unknown or revoked key; disabled project (all indistinguishable) |
| 403 | `FORBIDDEN` | `INSUFFICIENT_SCOPE`, `BROWSER_ORIGIN_FORBIDDEN`, `LIVE_MODE_DISABLED` |
| 403 | `MAINNET_DISABLED` | `SANDBOX_TEST_FUNDS_ONLY`, `MAINNET_HANDOFF_DISABLED_BY_POLICY` |
| 404 | `NOT_FOUND` | absent or another project's |
| 409 | `STRATEGY_CHANGED` / `STRATEGY_STALE` | hash mismatch / engine no longer reproduces |
| 409 | `IDEMPOTENCY_CONFLICT` / `IDEMPOTENCY_IN_PROGRESS` | — |
| 410 | `APPROVAL_EXPIRED` | — |
| 422 | `CAPABILITY_NOT_SUPPORTED` | `MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED`, `OWNER_EXECUTION_NOT_IMPLEMENTED`, `FLOW_NOT_ENABLED_IN_DEPLOYMENT`, `SIMULATION_LOCAL_FORK_ONLY` |
| 422 | `REVIEW_BLOCKED` | blocker codes |
| 422 | `SIMULATION_FAILED` | the flow's classified code |
| 429 | `RATE_LIMITED` | metric |
| 503 | `SERVICE_UNAVAILABLE` | `DEVELOPER_STORE_UNAVAILABLE`, `CLOUD_RUNTIME_NOT_CONFIGURED`, `SIMULATION_BUSY` (+ `Retry-After`) |
| 500 | `INTERNAL_ERROR` | — |

Logs (`flofi-developer`) carry: request id, tenant, project, key id, environment, route **template**, status, code, duration.
They never carry the Authorization header, bodies, query values, addresses, approval URLs, webhook URLs or secrets.

## 20. Documentation (MVP)

| Document | Audience | Content |
| --- | --- | --- |
| `docs/developer/README.md` | integrators | what FloFi for Developers is; the authority model on one page |
| `docs/developer/QUICKSTART.md` | integrators | the E2E below with the SDK and curl |
| `docs/developer/API.md` + `docs/developer/openapi.json` | integrators | the 10 endpoints, errors; authentication and environments sections (split into `AUTHENTICATION.md` / `ENVIRONMENTS.md` when the contract grows); OpenAPI 3.1 generated from the TypeBox schemas and drift-checked by a unit test |
| `docs/developer/WEBHOOKS.md` | integrators | events, envelope, verification (SDK and manual), retries, ordering, dedupe, rotation by replacement, latency |
| `docs/deploy/DEVELOPER.md` + `ENVIRONMENT.md` §5c + a `CLOUD.md` paragraph | operator | enabling, secrets, CLI, scheduler, limits |
| `docs/STATUS.md`, `docs/SECURITY_MODEL.md`, `docs/AUTHORITY_MATRIX.md` (row: "Developer API key — no financial authority"), `docs/LICENSE_MAP.md` (SDK + `docs/developer/**` Apache-2.0) | owner | status, boundaries, licensing |
| `docs/builds/BUILD-DEVELOPER-001-REPORT.md` | owner | the evidence categories of §26 |

**Quickstart:**

1. Get a sandbox key from the operator CLI. A bad key fails the next call with `UNAUTHORIZED`.
2. Call `capabilities.list({ network: 'base-sepolia' })` and pick a row whose `operations.approve` is true.
3. Create the strategy with `strategies.create` and read `executionPlan` and `validation`.
4. Re-validate with `strategies.validate` before handing off. `STRATEGY_STALE` means the engine changed.
5. Simulate with `strategies.simulate`, passing the user's public address. This is a preview, never an authorization.
6. Register a webhook endpoint with `webhookEndpoints.create` and store the secret.
7. Create the approval with `approvals.create`, passing `workflowHash`, and open `approvalUrl` for the user.
8. The user proves their wallet in FloFi and optionally shares status. They then run the fresh simulation, review the Strategy
   Manifest and sign.
9. Receive `approval.*` / `execution.*` webhooks and verify each with `verifyWebhook`, or poll `approvals.get`.
10. Call `executions.get` and `executions.evidence`. The evidence environment states what was proven.

## 21. Future developer portal (documented, not built)

The UX branch already reserves `/app/credentials` and `/app/agents` (placeholder pages inside the product shell). A portal
belongs there after that branch merges. It needs:

- project and key management;
- environments and the live-key request flow;
- usage and limits;
- webhooks (endpoints, secrets, delivery log, test, redeliver);
- an execution log (approvals → executions → evidence);
- docs links and team access.

It would call the same store functions as the CLI.

## 22. Parallel work and overlap

| Branch | Overlap | Handling |
| --- | --- | --- |
| `codex/build-product-ux-001` (UX/rebrand, base `1cf923f`, 253 files) | `src/app/{page,layout}.tsx`, `globals.css`, `src/app/app/**`, shell components, `workflow-store.tsx`, `domain/commands.ts`, ~80 e2e specs and baselines | **Not touched.** The only UI edit (Task 5) is `approval-handoff.tsx`, an MCP-002 file absent from that branch, using existing CSS classes. |
| `claude/build-channels-001` (same base `8f9650a`; its plan is uncommitted in its own worktree, read here, not modified) | Its plan independently proposes: (a) a requester-generic `requestApproval`; (b) migration `0006_channels.sql` adding a `channel` column to `mcp_handoffs` and making `grant_id` nullable; (c) `/approve` working without MCP OAuth through a key fallback; (d) an optional `approval-handoff.tsx` progress ping; (e) `after()` sweeps | **This build owns (a)** in commit 1 (`ApprovalRequester`, `src/platform/approvals.ts`). (b), (c) and the requester-neutral store land in Tasks 2 and 5, and CHANNELS can consume them as a new requester kind and a new key prefix in the registry instead of a parallel `channel` column and fallback. Remaining risk in the "Remaining overlap" list below. |
| `claude/build-mcp-002` → `main` (after #63) | this branch must be re-stacked (`git rebase --onto`) | MCP edits are limited to delegation in `tools.ts` and the `service.ts` re-export (commit 1), plus the store generalization (Task 2); MCP assertions are unchanged |

**Remaining overlap with BUILD-CHANNELS-001** (for the owner to coordinate in the other worktree):

1. **Migration number and handoff schema.** Both plans claim `0006` and both alter `mcp_handoffs`, with different
   discriminators (`requester_kind` here, `channel` there). Whichever merges second must renumber. If CHANNELS follows this
   design, it adds a requester kind (e.g. `CHANNEL_CONVERSATION`: account set, grant null) in its own migration instead of a
   `channel` column.
2. **`/approve` key handling.** CHANNELS planned "MCP key when enabled, else `FLOFI_CHANNEL_SECRET`". This build introduces a
   prefix-keyed registry, where CHANNELS would register its own prefix and key.
3. **`approval-handoff.tsx`.** This build makes copy origin-aware (Task 5). CHANNELS' optional D5-3 ping touches the same file.
   That is a small textual conflict risk.
4. **Self-directed claim rule.** CHANNELS refuses claims when a strategy address differs from the claimant. This build defers
   its analogue (D12). Both fit the existing `claim(…, decide)` callback per requester kind, so no new hook is needed.
5. **Timing.** If CHANNELS implements before commit 1 lands, it would re-do the extraction. Ownership is documented here, and
   coordination is the owner's.

## 23. File-touch list

**Commit 1:** exactly §2.2.

**MVP, Tasks 2–8 (expected)**

New:

- `packages/cloud-runtime/migrations/0006_developer_platform.sql`
- `apps/reference-dapp/src/platform/{handoff-store.ts, approval-keys.ts, fixed-window.ts, pinned-https.ts}` + tests.
  `handoff-store.ts` is the requester-neutral interface plus the PostgreSQL implementation moved from
  `src/mcp/handoff/store.ts`, which becomes a re-export.
- `apps/reference-dapp/src/developer/{config.ts, keys.ts, store.ts, pg-store.ts, http.ts, router.ts, schemas.ts, views.ts, errors.ts, events.ts, webhooks.ts, dispatch.ts, openapi.ts, test-harness.ts}`
- `apps/reference-dapp/src/developer/resources/{capabilities,strategies,approvals,executions,webhook-endpoints}.ts`
- Tests:
  - unit: `src/developer/{config,keys,errors,views,webhooks,openapi,parity,sdk-parity,no-secret,boundary}.test.ts`
  - PostgreSQL: `src/developer/{store,auth,isolation,idempotency,limits,strategies,approvals,executions,events,webhooks,journey}.pg.test.ts`
- `apps/reference-dapp/src/app/api/developer/v1/[...path]/route.ts`
- `apps/reference-dapp/backend/developer-admin.ts` + `developer-admin.pg.test.ts`
- `apps/reference-dapp/e2e/developer-journey.spec.ts`, `apps/reference-dapp/e2e/developer-fixtures.ts`
- `packages/developer-sdk/{package.json, LICENSE, README.md, tsconfig.json}`, `src/{index,client,http,errors,types,webhooks}.ts`,
  `test/{client,retries,webhooks,browser-guard}.test.ts`
- `docs/developer/{README,QUICKSTART,API,WEBHOOKS}.md`, `docs/developer/openapi.json`, `docs/deploy/DEVELOPER.md`,
  `docs/builds/BUILD-DEVELOPER-001-REPORT.md`

Modified:

- `src/mcp/handoff/store.ts`: re-export of the platform store (Task 2).
- `src/platform/approvals.ts`, `src/platform/index.ts`: developer requester variant (Task 2).
- `src/mcp/oauth/crypto.ts`: credential kind `flofi_dhs_` and id prefixes `prj`, `key`, `str`, `evt`, `whe`, `whd`, `req`.
- `src/mcp/oauth/pg-store.ts`: `allow` delegates to `fixedWindow`.
- `src/mcp/oauth/cimd.ts`: `pinnedHttpsGet` built on `pinnedHttpsRequest`.
- `src/mcp/simulation.ts`: the output guard also rejects `flofi_sk_`, `flofi_dhs_` and `whsec_`.
- `src/app/approve-action.ts`: key registry, `requesterKind`, `after()` event sync.
- `src/components/approval-handoff.tsx`: origin-aware copy and share label (the only UI edit).
- `apps/reference-dapp/playwright.config.ts`: developer env behind the existing embedded-loopback harness flag.
- `packages/cloud-runtime/src/migrations.ts`: identity of 0006.
- `.github/workflows/contracts.yml`: SBOM workspace inventory (SDK, Apache-2.0), importer set, E2E spec list.
- `scripts/bootstrap-ci.py`: only if its importer checks require it (verified in Task 7).
- `pnpm-lock.yaml`: one workspace importer.
- `docs/deploy/{ENVIRONMENT,CLOUD}.md` and `docs/{STATUS,SECURITY_MODEL,AUTHORITY_MATRIX,LICENSE_MAP}.md`.

**Not touched:**

- `src/app/{page,layout}.tsx`, `globals.css`, `src/app/app/**`, every other component;
- `src/state/**`, `src/domain/**`, `src/engine/**`, `src/wallet/**`, `src/server/**`;
- `backend/{app,flows,main,preview}.ts`;
- `packages/{workflow-contracts,action-registry,reference-*}`;
- visual baselines.

## 24. Test plan (MVP)

| Concern | Tests (unit unless `.pg` / E2E) |
| --- | --- |
| Platform extraction (commit 1) | every MCP unit, pg and E2E test unchanged; `boundary.test`; `preview.test` |
| Credential creation / verification | `keys.test` (format, prefix → environment, digest, malformed → 401 before any DB call); `developer-admin.pg` (create, list shows hint only) |
| Revoked credential | `auth.pg`: revoke → next request 401 (no cache); disabled project → 401; live prefix → 403 `LIVE_MODE_DISABLED` |
| Invalid scope | `auth.pg`: each route × missing scope → 403 `INSUFFICIENT_SCOPE` |
| Tenant isolation | `isolation.pg`: project A × every B resource id (strategy via validate/simulate/approve, approval, execution, evidence, endpoint delete) → identical 404; two deployment tenants |
| Capability discovery | rows equal `codeCapabilities()` + gates; sandbox marks mainnet unavailable; no flow names or adapters leak |
| Strategy creation + StrategySpec parity | `strategies.pg` (v1, v2, lending collapse, general 2-step → not executable, schema errors with paths, sandbox mainnet refused); `parity.test`: for every `STRATEGY_EXAMPLES` entry (15 today) + v2 shapes, REST hash ≡ MCP `compose_strategy` ≡ `composeWorkflow` |
| Validation | findings equal `reviewComposition`; injected engine change → `STRATEGY_STALE` |
| Simulation | view equals MCP `simulate_strategy` on MOCKED flows; subject namespace; budget → 429; busy → 503 |
| Approval handoff creation | `approvals.pg`: happy path, `STRATEGY_CHANGED`, `STRATEGY_STALE`, `REVIEW_BLOCKED`, `CAPABILITY_NOT_SUPPORTED` reasons, pending cap, no supersession |
| workflowHash immutability | `store.pg`: UPDATE on strategies raises; handoff immutable columns raise; INSERT with a hash ≠ strategy raises; edited workflow → `HANDOFF_WORKFLOW_MISMATCH` |
| API key cannot execute | `journey.pg`: spy on `backend.callFlow`; the Developer API calls only `mode`, `info`, `status`, `runs` + `previewFlow`; harness `sends` = owner signatures; secret-shaped fields → 400 |
| Cross-user / cross-developer | a second wallet cannot take a claimed approval (existing); project B cannot read A's execution even with its id |
| Idempotency | `idempotency.pg`: replay → same id + header; different body → 409; concurrent → 409; approval replay → fresh link; no `flofi_dhs_`/`whsec_` in `api_idempotency` |
| Rate limiting | `limits.pg`: requests, simulations, approvals, endpoints → 429 + `Retry-After`; usage rows incremented once per operation |
| Webhook signing | deterministic vector checked against an independent `node:crypto` computation; SDK `verifyWebhook` accepts it and rejects a tampered body, a stale timestamp and a wrong secret; accepts a secret array |
| Webhook retries | `webhooks.pg` (fake clock, in-memory transport): schedule and jitter bounds, `DEAD` after 10, success stops retries |
| Duplicate safety | `events.pg`: sync twice and concurrently → one event per dedupe key; two dispatchers → one attempt per slot; `webhook-id` stable across retries; replaying a payload changes no handoff or run |
| Secret replacement | create endpoint B, delete A: A's deliveries stop, B's signatures verify only with B's secret |
| Execution status / evidence | `executions.pg`: unshared → 404 and `executions: []`; shared → equals the extracted views |
| Testnet / mainnet separation | sandbox REAL_FUNDS refused at creation; live keys refused; no mainnet path reachable |
| No secret leakage | captured logs, error bodies, webhook payloads and idempotency rows contain no `flofi_sk_`, `whsec_`, `flofi_dhs_`, `flofi_at_`, URL or unshared address; `assertSafeOutput` on every response |
| SDK type / runtime | `packages/developer-sdk/test/*` (safe retries only, idempotency key reused, errors, timeouts, browser guard); `sdk-parity.test` (types ≡ server `Static`); SDK ↔ handler contract via injected `fetch` |
| **Third-party E2E (mocked)** | `journey.pg`: the fixture server app on the SDK runs the full chain (authentication → discovery → create → validate → simulate → webhook endpoint → approval → wallet-proven claim (store, as the server does) with sharing on → the owner's unchanged router journey on MOCKED Base Sepolia/Arbitrum Sepolia → reconciliation → dispatch → `execution.reconciled` verified with the SDK → execution status → evidence) |
| **Browser E2E** | `e2e/developer-journey.spec.ts` (embedded loopback runtime): the same chain through the real `/approve` page (wallet proof, share checkbox OFF by default then ON, flow panel, mock wallet), with a loopback webhook receiver verifying signatures |

**Gates before delivery:**

- `pnpm check` and `pnpm test:postgres`;
- `mcp-in-chat.spec.ts` + `developer-journey.spec.ts` under `GRYLOO_MCP_E2E=EMBEDDED_LOOPBACK_ONLY`, and the CI browser group;
- `python3 scripts/governance_lite.py` and its unittest suite on a `git archive` export;
- `pnpm audit --audit-level low`, not weakened. The pre-existing `source-map-js` fix is eligible from 2026-10-07T14:08Z, and its
  resolution belongs on `main`.

Run gates alone: timer-heavy service tests flake when run alongside `tsc` or Playwright.

## 25. Implementation tasks

Each task is test-first, ends green, and is its own commit.

1. **Shared platform extraction.** Exactly §2. *Produces:* `src/platform` with `composeWorkflowOrRefuse`,
   `composeSingleStep`, `validateStrategy`, `reviewWorkflow`, `capabilityFacts`, `simulatePreview`, `findOwnedRun`,
   `executionStatusView`, `evidenceView`, `ApprovalRequester`, `requestApproval`, `approvalProgress`, `verifyHandoff`,
   `approvalView`, `openApprovalSession`, `walletDeepLinks`, and the neutral re-exports. *Gate:* §2.3.
2. **Handoff persistence generalization + migration 0006.** SQL and its identity pin; the requester-neutral
   `src/platform/handoff-store.ts` (moved PostgreSQL implementation, `src/mcp/handoff/store.ts` re-export, `forAccount`
   wrapper); `requester_kind`; the `developer-project` requester variant; no supersession for it; developer tables. *Gate:* MCP
   handoff and journey pg tests unchanged; new migration, immutability and binding pg tests.
3. **Developer config, API keys, store, operator CLI.**
4. **HTTP boundary + the ten endpoints.** Covers enablement, Origin refusal, body bound, key → principal, scopes, request id,
   `fixedWindow` limits and usage counters, idempotency, error mapping, logging, the `schedule` seam (`after()`), the route
   file, and the boundary test that `src/developer/**` never imports `src/mcp/**`. Includes parity and isolation tests.
5. **`/approve` developer requester.** Key registry by prefix, `requesterKind`, origin-aware copy, sharing OFF by default,
   post-transition `after()` sync.
6. **Events + webhooks.** `syncDeveloperEvents`, fan-out, Standard Webhooks signing, derived secrets, `pinnedHttpsRequest`
   extraction, the dispatcher (claim/lease, schedule, `DEAD`) and the internal dispatch endpoint.
7. **SDK + OpenAPI.** `packages/developer-sdk`; CI SBOM and importer inventory; license map; `openapi.ts` + drift test; type
   parity; SDK ↔ handler contract tests.
8. **Journeys, docs, report.** `journey.pg.test.ts`, `developer-journey.spec.ts`, developer and operator docs, status and
   security docs, the report with the §26 categories; full gates; push the branch. No PR until the owner says so: the branch is
   stacked on unmerged work.

## 26. Acceptance criteria and report categories

- **AC-0 (Colosseum):** a third-party server application integrates FloFi end-to-end with minimal code. FloFi remains the
  single execution truth, and the developer credential has zero financial authority. Shown by the two journeys in §24.
- **AC-1:** commit 1 extracts the shared platform with MCP behaviour unchanged (§2.3).
- **AC-2:** every invariant in §5 has a passing test; no route reaches a mutating flow method.
- **AC-3:** StrategySpec, hash, validation, simulation and gate parity with MCP and the DApp engine.
- **AC-4:** the tenant isolation matrix passes; no secret appears in logs, payloads, errors or idempotency rows.
- **AC-5:** webhooks are signed, replay-protected, retried with bounded backoff, duplicate-safe, replaceable and never authority.
- **AC-6:** sandbox is test-funds only; live keys and mainnet are refused.
- **AC-7:** the browser journey through `/approve` passes on the embedded loopback runtime, and MCP E2E is unchanged.

The report keeps these categories separate:

- **implemented**;
- **mocked:** all chain execution;
- **local integration tested:** PostgreSQL and the loopback browser;
- **live public testnet tested:** expected NOT DONE unless the owner runs a Preview session with a testnet wallet, since only
  the owner signs;
- **production-ready:** expected NO (scheduler, legal review, portal, live-key policy);
- **mainnet-ready:** NO;
- **not yet done:** §27.

## 27. Deferred (explicit)

**Endpoints:** the convenience and management endpoints of §7.

**Platform management:**

- developer portal UI and self-serve signup; organizations, teams, roles;
- production/live credentials; key IP allowlists and expiry policies;
- usage API, billing, invoices, pricing;
- in-place webhook secret rotation, test events, delivery browsing and redelivery, endpoint auto-disable;
- date-based version headers.

**Approval options:**

- approval TTL options; return URLs after approval;
- the intended-wallet constraint (D12);
- a client reference field;
- sharing management for wallet owners on `/connections`.

**Contract extensions:**

- exposing the IR;
- a `protocol` assertion field;
- OAuth client credentials and user-delegated "Sign in with FloFi";
- publishable/client-side keys.

**Distribution and runtime:**

- npm publication of `@flofi/sdk` and SDKs in other languages;
- developer state on the remote runtime (Railway API) and worker-driven dispatch;
- a Vercel Cron entry.

**Execution scope:**

- the general sequential multi-step runner (MCP-002 follow-up), so general sequences stay
  `MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED`;
- WalletConnect;
- mainnet enablement and its legal review.

**Cleanup:** after MCP-002 merges, physically moving `src/mcp/{execution,simulation,runtime}.ts` and `oauth/crypto.ts` into
`src/platform`, and optionally renaming `mcp_handoffs`.

## 28. Risks

- **Stacking depth:** this branch sits on two unmerged PRs, and each upstream rebase forces a re-stack. Mitigation: commit 1
  is delegation-only, and the MCP edits are small.
- **CHANNELS overlap:** see the "Remaining overlap" list in §22, especially the 0006 number and the handoff discriminator.
- **Webhook latency on Previews:** dispatch is request-driven; production needs a scheduler (owner action).
- **Phishing:** the project display name appears on `/approve`. In this build names are operator-set; a self-serve portal
  needs verification.
- **Regulatory:** third parties steering users to sign DeFi transactions through FloFi needs the owner's legal review before
  production or mainnet (as noted in MCP-002).
- **CI audit:** the pre-existing `source-map-js` advisory may still block `pnpm audit` until `main` updates its lockfile. It is
  not weakened here.
