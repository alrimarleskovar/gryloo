# BUILD-MCP-002 — Report: consumer OAuth, trusted approval handoff and in-chat execution

Date: 2026-10-06. Branch `claude/build-mcp-002`, **stacked** on the BUILD-MCP-001 head `4b99acc9700cbb34d3ed25a73780c96a28c21418`
(PR #63, open) by explicit owner authorization; `origin/main` is `bf84bbd`. No PR is open for this branch yet: once #63 merges
it is rebased onto the new `main`, the full suite is re-run, and then the PR is opened. Nothing was merged. No real financial
transaction was signed or sent; every execution in this build ran on MOCKED loopback chains.

> The model remains an untrusted interpreter. OAuth authentication is not wallet ownership; an MCP account is not financial
> authority; an approval link is not financial authority. Only the user's own wallet authorizes execution, inside FloFi's
> existing flows (wallet proof → fresh simulation → Strategy Manifest Review → explicit approval → wallet signature). FloFi and
> the model never hold a key and never sign.

## 1. What was built

```
Claude / ChatGPT (MCP client, untrusted interpreter)
  │ OAuth 2.1 (CIMD or narrow DCR, PKCE S256, consent + invite)        │ MCP: Bearer flofi_at_…
  ▼                                                                     ▼
/.well-known/oauth-*  /oauth/{authorize,token,revoke,register}     /api/mcp (resource server)
        │                                                           ├ token → pseudonymous account + scopes (PostgreSQL, every request)
        │                                                           ├ 401 resource_metadata challenge · 403 insufficient_scope step-up
        │                                                           └ tools: strategy · approval · runs (+ app-only panel tools)
        └────────── PostgreSQL 0005_mcp_oauth: accounts · clients · authorizations · grants · tokens · handoffs · wallet links · limits
request_user_approval → handoff (PENDING, digest of the fragment secret) → MCP App panel ui://flofi/approval-panel.html
panel "Connect wallet & execute in FloFi" → open_approval_session → ui/open-link → FloFi /approve#<secret> (signing window)
/approve → EIP-4361 or Sign-In With Solana proof → claim (re-compose, re-check) → existing proposal card → existing flow panel
        → fresh simulation → Strategy Manifest Review → explicit approval → the owner's wallet signs → reconciliation → evidence
panel ← get_execution_progress (runs bound by owner, flow, time and exact workflow hash, only while shared) → ui/update-model-context
```

| Area | Files |
| --- | --- |
| Migration | `packages/cloud-runtime/migrations/0005_mcp_oauth.sql`, `src/migrations.ts` (shipped identity) |
| OAuth server | `apps/reference-dapp/src/mcp/oauth/{config,crypto,store,pg-store,cimd,consent-page,server,routes,runtime,state}.ts`; routes `src/app/.well-known/*`, `src/app/oauth/*` |
| Resource server | `src/mcp/gateway.ts`, `src/mcp/config.ts`, `src/mcp/tools.ts` |
| Gates and plans | `src/mcp/execution.ts` |
| Handoff | `src/mcp/handoff/{store,service,links}.ts`, `src/app/approve-action.ts`, `src/app/approve/page.tsx`, `src/components/approval-handoff.tsx` |
| Wallet proof | `src/server/wallet-session.ts` (SIWS beside EIP-4361), `src/server/session-principal.ts`, `src/app/wallet-session-action.ts`, `src/wallet/solana-wallet.ts`, `src/components/wallet-proof.tsx` |
| Wallet links | `src/app/connections-action.ts`, `src/app/connections/page.tsx`, `src/components/connections-panel.tsx` |
| MCP App panel | `src/mcp/app/panel.ts` |
| Step lists | `src/engine/strategy-spec.ts`, `src/engine/strategy-engine.ts` |
| Shared app shell | `src/components/app-providers.tsx` (the provider tree of `/`, reused by `/approve`) |
| Tests | `src/mcp/oauth/*.test.ts`, `src/mcp/handoff/*.pg.test.ts`, `src/mcp/app/panel.pg.test.ts`, `src/mcp/execution.test.ts`, `src/mcp/step-list.test.ts`, `src/server/solana-session.test.ts`, `e2e/mcp-in-chat.spec.ts` (+ `mcp-fixtures.ts`) |

## 2. Policy checks (OpenAI, Anthropic)

Re-checked on 2026-10-06 **before implementation** (details in the plan, §2): neither platform explicitly prohibits this use
for private, custom-connector or developer-mode integrations. The money-movement exclusions apply to the ChatGPT Directory
("Execution of money transfers, crypto transfers, or investment trades") and the Anthropic Software Directory ("Software that
transfers money, cryptocurrency, or other financial assets"); this build targets neither. The general usage policies require
human review of high-stakes financial decisions (OpenAI) and, for finance as a high-risk use case, human-in-the-loop and AI
disclosure (Anthropic); the design keeps every decision with the owner's review and wallet signature and discloses AI
involvement on the consent page, `/approve` and the panel. Anthropic's agentic guidance prohibits "unauthorized, illegal, or
fraudulent financial transactions (such as brokerage …)": the regulatory classification of FloFi needs the owner's legal
review before any production or mainnet use. **The owner must re-check both policies immediately before the live acceptance
session** (owner decision 6); if either explicitly prohibits this use, stop.

## 3. Changes to BUILD-MCP-001 behaviour (for owner review)

1. A **production** deployment refuses static developer credentials (`FLOFI_MCP_CLIENTS` → `503 MCP_CONFIGURATION_INVALID`);
   development and Previews keep them. The MCP-001 test that simulated "hosted" with `VERCEL=1` (production by FloFi's own
   rule) now uses a Preview; the hosted-runtime assertion is unchanged.
2. With OAuth enabled, `FLOFI_MCP_CLIENTS` is optional.
3. The MCP-001 "no model client" guard matched the string `openai` anywhere; it now targets model clients precisely (SDK
   imports, API hosts, API-key variables, the Copilot), because `openai/outputTemplate` is ChatGPT's MCP Apps metadata
   namespace, not a client. A stronger recursive guard (`src/mcp/oauth/no-model.test.ts`) covers every MCP-002 surface.
4. The gateway reports a tool that does not exist for the principal (an approval tool for a static credential) as unknown
   (JSON-RPC `-32602`), as MCP-001 expects, rather than as a scope problem.
5. `get_capabilities`, `compose_strategy`, `validate_strategy` and `review_strategy` gained fields (four facts, execution
   plan, step-list contract); single-action outputs keep every MCP-001 field. Tool inputs accept a v2 step list too.
6. The output guard additionally rejects any OAuth token, code or consent value.
7. `src/app/page.tsx` renders the same provider tree through `AppProviders` (no behavioural change; the CI browser group and
   visual baselines pass unchanged).

No safety or test gate was weakened; no test was skipped or deleted.

## 4. Mainnet Activation Path

Mainnet handoffs are disabled by **policy only** (`FLOFI_MCP_HANDOFF_MAINNET_NETWORKS` empty → `MAINNET_HANDOFF_DISABLED_BY_POLICY`).
OAuth, tool schemas, the handoff schema, the database, StrategySpec, the IR, approval URLs, the account model, the Manifest
flow, execution status, wallet links and capability discovery contain nothing testnet-specific: an isolated test enables a
mainnet network by policy and the same composition, plan and handoff proceed with `REAL_FUNDS` intact, still needing the
owner's wallet signature.

### A. Solana mainnet (Jupiter swap)

| Dimension | State |
| --- | --- |
| Supported by code | Yes: flow `jupiter-swap`, registry row `jupiter.swap-v2` on `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` (MAINNET), owner-wallet execution implemented (Wallet Standard `solana:signTransaction`); MCP plan `SINGLE_FLOW`. |
| Provider dependency | Jupiter Swap API v2 (`JUPITER_API_KEY`), a keyed Solana mainnet RPC (`GRYLOO_SOLANA_RPC_URL`). |
| Deployment gate | `GRYLOO_JUPITER=live` (Simulate/Review) and `GRYLOO_JUPITER_OWNER_EXECUTION=MAINNET_OWNER_APPROVED` (`info.executionEnabled`). |
| Policy gate | `FLOFI_MCP_HANDOFF_MAINNET_NETWORKS=solana`. |
| Simulation | The flow's own fresh quote + transaction simulation in FloFi; MCP's preview is read-only and never authorizable. |
| Owner signature | The owner's wallet in FloFi; the handoff claim needs a **Sign-In With Solana** proof (new in this build). |
| Reconciliation | The flow's observe/reconcile (signature status, balance deltas) → Evidence Bundle. |
| Evidence | None demonstrated on mainnet (`NONE_DEMONSTRATED`); MOCKED evidence only for the MCP path. |
| Missing certification | Session-bound run ownership for the Solana flows (the router flows have it; Jupiter binds the owner argument, the handoff binds the SIWS wallet); keyed RPC; an owner-signed mainnet run with independent verification; a registry evidence update; the owner's legal review; the policy listing. |

### B. EVM mainnet (Cross-chain Router, Base → Arbitrum One USDC)

| Dimension | State |
| --- | --- |
| Supported by code | Yes: flow `crosschain-router`, registry row `flofi.router` `asset.bridge` on `eip155:8453` (MAINNET), `eth_simulateV1`, LI.FI or direct Across, session-bound runs (`ROUTER_OWNERSHIP`); MCP plan `SINGLE_FLOW`; public read-only preflight done in BUILD-ROUTER-001. |
| Provider dependency | Keyed Base and Arbitrum One RPCs supporting `eth_simulateV1` (`GRYLOO_BASE_RPC_URL`, `GRYLOO_ARBITRUM_RPC_URL`; the public Base RPC rate-limits), LI.FI (`LIFI_API_KEY`), Across (`ACROSS_API_KEY`, `ACROSS_INTEGRATOR_ID`). |
| Deployment gate | `GRYLOO_ROUTER=live` and `GRYLOO_ROUTER_OWNER_EXECUTION=MAINNET_OWNER_APPROVED`. |
| Policy gate | `FLOFI_MCP_HANDOFF_MAINNET_NETWORKS=base,arbitrum-one` (every mainnet the workflow touches). |
| Simulation | Fresh route and `eth_simulateV1` in FloFi; route-bound Strategy Manifest. |
| Owner signature | The owner's EVM wallet signs the exact approval and deposit; EIP-4361 session and claim. |
| Reconciliation | Destination fill observed on Arbitrum One; reconciled Evidence Bundle. |
| Evidence | None on mainnet; the MCP path is MOCKED only. |
| Missing certification | Keyed RPCs; an owner-signed mainnet run with independent verification and a registry evidence update; the owner's legal review; the policy listing. Other EVM mainnet paths (Uniswap swap/liquidity on Base, Aave on mainnet, Ethereum mainnet) have no MAINNET registry rows and need engine builds first. |

## 5. Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC-1 Consumer OAuth with a Claude custom connector and ChatGPT developer mode | **Protocol complete; live connection NOT YET DONE (owner-run)** | Discovery, CIMD (the real Claude, Claude Code and ChatGPT documents), consent, PKCE, token, refresh, revocation, 401/403 verified by PostgreSQL tests and in a real browser (DCR loopback client). No Preview with these variables existed during the build. |
| AC-2 Authoring of one-action and multi-step strategies | Done | `step-list.test.ts`, gateway tests |
| AC-3 In-chat execution (EVM testnet, Solana devnet, lending composition) through the best verified adapter | **Done in a mocked MCP Apps host on MOCKED chains**; live hosts NOT YET | `e2e/mcp-in-chat.spec.ts`: router testnet (2 wallet signatures), Orca devnet swap with SIWS (1 signature), lending composition (5 signatures); signing window adapter (B); only the owner's (test) wallet signs |
| AC-4 `/approve` fallback | Done | The text result carries the link; the browser suite drives `/approve` directly |
| AC-5 Wallet-environment matrix | Partially (see §6) | Owner experiments pending |
| AC-6 Authority invariants | Done | no signing/sending tool; output guard; mainnet policy tests; isolated policy-enabled test; no-model regression |
| AC-7 Mocked E2E with a minimal MCP Apps host (EVM + Solana) | Done | `e2e/mcp-in-chat.spec.ts` (5 tests), in the CI browser stage |

## 6. Wallet-environment matrix (AC-5)

| Host | Platform | Namespace | Adapter | Status |
| --- | --- | --- | --- | --- |
| Minimal MCP Apps test host (Chromium) | desktop | EVM | B signing window | **VERIFIED (mocked host, MOCKED chain)** |
| Minimal MCP Apps test host (Chromium) | desktop | Solana | B signing window | **VERIFIED (mocked host, MOCKED chain)** |
| any | any | EVM, Solana | E `/approve` link | **VERIFIED (browser, MOCKED chains)** |
| Claude web / desktop | desktop | EVM, Solana | B signing window (`ui/open-link`; Claude asks for confirmation unless allowlisted) | NOT TESTED (owner) |
| ChatGPT (developer mode) | desktop | EVM, Solana | B signing window (`ui/open-link`, `openExternal` fallback with `redirect_domains`) | NOT TESTED (owner) |
| Claude / ChatGPT mobile | iOS, Android | EVM | C MetaMask in-app browser (`metamask.app.link/dapp/…`; fragment survival unverified) | NOT TESTED (owner) |
| Claude / ChatGPT mobile | iOS, Android | Solana | C Phantom in-app browser (`phantom.app/ul/browse/<encoded>`) | NOT TESTED (owner) |
| Claude / ChatGPT | any | EVM, Solana | A in-frame wallet | NOT SUPPORTED as execution (probe only, on hosts listed in `FLOFI_MCP_INFRAME_WALLET_HOSTS`) |
| any | any | any | D WalletConnect/Reown | NOT SUPPORTED (deferred by owner decision) |

If the owner's experiments show that B, C and E are insufficient for a reliable ChatGPT or Claude journey, stop and report
(owner decision 8); WalletConnect/Reown would be the follow-up.

## 7. Tests and exact results

Run locally on 2026-10-06 (Node 24.21.0, pnpm 11.22.0, loopback PostgreSQL 18, Chromium headless shell 1243), branch head
before this report commit:

| Gate | Result |
| --- | --- |
| `pnpm check` (typecheck, lint, build, schemas:check, unit) | **Passed**: 202 files passed, 2 skipped; **1,908 tests passed, 2 skipped** (the two existing skips). 42 new unit tests. An earlier run started while a parallel `tsc` was busy timed out 8 timer-heavy service tests (router testnet, Uniswap liquidity, Jupiter, Ethereum Sepolia lending, Solana Devnet, Robinhood, lending composition); the same 7 files passed alone (128/128) and the clean full run above passed. |
| `pnpm test:postgres` | **Passed**: 17 files, **109 tests** (56 new: OAuth store 13, authorization server 18, OAuth resource server 8, handoff 12, in-chat journey 1, panel resource 4). |
| `e2e/mcp-in-chat.spec.ts` (`GRYLOO_MCP_E2E=EMBEDDED_LOOPBACK_ONLY`) | **5 passed**: EVM router journey, Solana Devnet with SIWS, lending composition (5 signatures), cross-user + `/connections`, mainnet refusal. |
| CI browser group (18 specs incl. visual baselines) | **53 passed, 4 skipped** (unchanged by this build). |
| `jupiter.spec.ts` / `solana-devnet.spec.ts` + `solana-liquidity.spec.ts` / `journey.spec.ts` / `cloud-runtime.spec.ts` | **9 / 13 / 3 / 2 passed** (fixture and shared-shell changes do not regress them). |
| `python3 scripts/governance_lite.py` + unittest | Passed on a clean export (see the delivery message). |
| `pnpm audit --audit-level low` | **Fails on `main` and here** on the pre-existing `source-map-js` advisory (GHSA-68fv-2mgg-jv7q; fix eligible after 2026-10-07T14:08Z). Not weakened. |

New tests by concern:

- OAuth: state required, PKCE S256 only (`plain`, missing, short and wrong verifiers refused), exact redirect matching (RFC 8252
  loopback exception only), `iss` on every redirect, resource/audience binding (another origin or tenant refuses the token),
  code expiry (60 s), single use and replay (revokes the grant and its tokens), access-token expiry and revocation (immediate),
  refresh rotation, racing reuse refused harmlessly, later reuse revokes the family, family cap, scope narrowing and step-up
  (`403 insufficient_scope`, batch smuggling refused), unsupported grants, malformed metadata documents, SSRF (allowlisted HTTPS
  hosts, every resolved address public — loopback, private, link-local, CGNAT, metadata, documentation, multicast, NAT64,
  6to4, Teredo, mapped — pinned connection, no redirects, size and time bounds), consent CSRF (token + cookie + `Origin`;
  `Origin: null` refused), invite codes, abuse limits, no credential in any log line or tool output, fail-closed configuration
  and store.
- Identity: claims need a server-verified wallet session of the workflow's namespace (EIP-4361 / SIWS: wrong key, altered
  message, claimed address, malformed signature, expiry, origin, cross-namespace sessions refused); a second wallet cannot
  take a claimed proposal; status sharing defaults off outside the creating account's browser; run reads need a wallet link
  created with both sessions and an explicit click, revoked links stop at once, an execution id alone grants nothing.
- Handoff: expired, replayed, cross-account, cross-tenant, modified strategy (hash), stale (engine no longer reproduces), engine
  version recorded, invalid capability (no owner-wallet flow), mainnet blocked by policy, testnet allowed, isolated policy-enabled
  mainnet proceeding with REAL_FUNDS intact, supersession, cap, revocation, database-enforced forward-only states, no calldata,
  transaction, signature, token or key in any output, no automatic execution (only `mode`/`info` are read; the only "sends"
  in every journey are the owner's wallet transactions).

## 8. Known limitations

- No live Claude or ChatGPT connection, no live MCP Apps host and no public chain were exercised; evidence is MOCKED.
- The in-frame wallet adapter is a diagnostic probe, not an execution path.
- Deep-link fragment handling inside MetaMask/Phantom in-app browsers is unverified.
- Claude shows a confirmation before `ui/open-link` unless the destination is allowlisted; ChatGPT's acceptance of
  `ui/open-link` versus `openExternal` is unverified.
- A Preview tenant is per branch: OAuth state survives redeploys of the branch, not other branches; the per-run E2E OAuth
  secret makes no state survive between CI runs.
- Rate limits are fixed windows sized for private/Preview use; production should add a platform firewall.
- General multi-step sequences are composed and reviewed per step but not executable (`MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED`);
  the sequential runner is the immediate follow-up and needs no schema, handoff or panel redesign.
- Solana flows do not bind runs to a wallet session (the router flows do); the handoff binds the claim to the SIWS wallet.
- `pnpm audit` fails on `main` and on this branch because of the pre-existing `source-map-js` advisory (fix eligible after
  2026-10-07T14:08Z); the gate was not weakened.

## 9. Owner actions

1. Preview variables (CLOUD.md "Remote MCP gateway"): `FLOFI_MCP=enabled`, `FLOFI_MCP_OAUTH=enabled`,
   `FLOFI_PUBLIC_ORIGIN=https://<branch alias>`, `FLOFI_MCP_OAUTH_SECRET`, `FLOFI_MCP_OAUTH_INVITES`, the testnet flows; leave
   `FLOFI_MCP_HANDOFF_MAINNET_NETWORKS` empty; disable Vercel Authentication for Previews.
2. Re-check the OpenAI and Anthropic policies.
3. Claude: add a custom connector with `<alias>/api/mcp`; ChatGPT: developer mode → create an app with the same URL. Ask for a
   Base Sepolia bridge and a Solana Devnet swap; approve in the panel; complete in FloFi with a testnet wallet; check that the
   status returns to the chat. Record each cell of §6.
4. Decide on the in-frame probe hosts, deep links and whether a WalletConnect follow-up is needed.

## 10. Final delivery items

1. **Branch**: `claude/build-mcp-002` (stacked on `claude/build-mcp-001` @ `4b99acc`).
2. **Final commit**: the head of `claude/build-mcp-002` that contains this report (a document cannot name its own SHA; see
   `git log` and the delivery message).
3. **PR**: not opened (owner instruction: only after PR #63 merges and this branch is rebased onto the new `main`).
4. **OAuth**: OAuth 2.1 authorization code + PKCE S256 for public clients per the MCP authorization specification 2026-07-28:
   RFC 9728 protected resource metadata, RFC 8414 server metadata, Client ID Metadata Documents, RFC 7591 (narrow, optional),
   RFC 7009 revocation, RFC 8707 resource binding, RFC 9207 `iss`, RFC 6750 challenges, refresh-token rotation.
5. **ChatGPT**: protocol-compatible (its CIMD document accepted as a public client; `iss`; `none` auth; `openai/*` UI metadata);
   live developer-mode connection not yet exercised (owner).
6. **Claude**: protocol-compatible (CIMD with `none`, 401 challenge on the first request, `invalid_grant` on refresh failures,
   first authorization server only, Claude Code loopback redirects); live custom-connector connection not yet exercised (owner).
7. **Client registration**: CIMD on allowlisted hosts (default `claude.ai`, `chatgpt.com`) with an SSRF-guarded fetch and a
   PostgreSQL cache; narrow DCR off by default; no `private_key_jwt`, no secrets.
8. **Scopes**: `flofi.strategy`, `flofi.approval`, `flofi.runs` (step-up; linked wallets only).
9. **Account identity**: a pseudonymous FloFi account created at consent (invite code on Preview), no email, no wallet;
   HttpOnly account cookie; distinct from the OAuth grant and from any wallet proof.
10. **Wallet linking**: `/connections`, account cookie + fresh EIP-4361/SIWS session + explicit click; 30 days; revocable;
    tenant-scoped; capped; gates `get_execution_status`/`get_evidence` (`ACCOUNT_LINKED_WALLET`).
11. **`request_user_approval`**: input `{strategy, workflowHash}` (v1 or v2); output `approvalId`, `approvalUrl`,
    `workflowHash`, `expiresAt`, `status`, `networkEnvironment`, `fundsClass`, `executionPlan`, `steps`, `authority: "NONE"`,
    `requires` (Open FloFi, Prove wallet ownership, Fresh simulation, Strategy Manifest Review, Explicit wallet signature),
    `walletNamespace`, `gates`, `summary`, `preExecution`; never calldata, transactions, signatures, tokens or keys.
12. **Handoff lifecycle**: PENDING (15 min) → CLAIMED (one wallet; 10 min) → APPLIED; terminal EXPIRED, SUPERSEDED, REVOKED,
    STALE; forward-only and never revived (database trigger); fragment secret stored as a digest; five-minute approval sessions
    for the panel; runs bound by owner, flow, time and exact workflow hash, shared only by the owner's choice.
13. **Persistence**: migration `0005_mcp_oauth` (8 tenant-scoped tables, digests only), shipped identity pinned; embedded
    PostgreSQL only; bounded retention.
14. **Environment variables**: §1 of [MCP.md](../deploy/MCP.md) and [ENVIRONMENT.md](../deploy/ENVIRONMENT.md) §5b.
15. **Tests**: §7.
16. **Adversarial tests**: §7 ("New tests by concern").
17. **Testnet policy**: allowed by default (`FLOFI_MCP_HANDOFF_TEST_FUNDS=enabled`), subject to code support and deployment.
18. **Mainnet policy**: refused by default with `MAINNET_HANDOFF_DISABLED_BY_POLICY` while `supportedByCode`,
    `enabledByDeployment` and `demonstratedEvidence` stay visible; an isolated policy enables it with no schema change.
19. **Solana mainnet**: §4 A.
20. **EVM mainnet**: §4 B.
21. **Known limitations**: §8.
22. **No merge occurred**: nothing was merged, and automatic merge was not enabled.
23. **No real financial transaction occurred**: every execution in this build used MOCKED loopback chains; no transaction was
    signed or sent on any public network, mainnet or testnet.
