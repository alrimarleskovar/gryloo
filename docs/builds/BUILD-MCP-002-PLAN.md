# BUILD-MCP-002 — Plan: Consumer OAuth, trusted handoff and in-chat execution

Date: 2026-10-06. Branch `claude/build-mcp-002` (worktree `~/projects/flofi-mcp-002`), **intentionally stacked** on the
BUILD-MCP-001 head `4b99acc9700cbb34d3ed25a73780c96a28c21418` (PR #63, open) by explicit owner authorization. `origin/main`
is `bf84bbd`. No PR is opened while #63 is unmerged; afterwards: fetch, rebase onto the new `main` (keeping the MCP-001
architecture), rerun the full suite, then open one PR. Nothing is merged by the agent.

> **The model remains an untrusted interpreter.** OAuth authentication does not imply wallet ownership. An MCP account
> does not imply financial authority. A handoff URL does not imply financial authority. Only the user's own wallet
> authorizes financial execution, through FloFi's existing flows: wallet proof → fresh authoritative simulation →
> Strategy Manifest → explicit approval → wallet signature. The MCP server and the model never hold a key and never sign.

## 1. Target journey

```
user asks ChatGPT / Claude
 → compose_strategy (one transaction = a one-step workflow; or an ordered step list)
 → validate / review / simulate_strategy (read-only preview)
 → request_user_approval  ──► approval object (authority NONE) + MCP App panel "Connect wallet & execute"
 → panel opens a FloFi-controlled signing surface (signing window, wallet deep link, or /approve fallback)
 → user proves wallet ownership (EIP-4361 for EVM, Sign-In With Solana for Solana)
 → handoff claimed → the existing DApp proposal card → the existing flow panel:
   fresh authoritative simulation → Strategy Manifest Review → explicit Approve → wallet signature → execution
 → reconciliation → Evidence Bundle
 → status/evidence back in the chat panel (get_execution_progress) and to the model (only via a wallet link)
```

There is no MCP-specific execution path: the handoff only places a re-composed proposal into the DApp's existing
`propose()`; everything after it is the unchanged per-capability flow.

## 2. Policy re-check before implementation (2026-10-06)

| Source | Finding | Effect |
| --- | --- | --- |
| OpenAI Usage Policies (effective 2025-10-29; archived copy 2026-10-04, openai.com refuses automated fetches) | No prohibition of crypto or financial apps for private/developer use. Prohibits "automation of high-stakes decisions in sensitive areas without human review" incl. "financial activities and credit", and "tailored advice that requires a license … without appropriate involvement by a licensed professional". | Allowed with safeguards: every financial step needs the human's review and wallet signature; FloFi composes what the user asks and gives no tailored investment advice. |
| OpenAI Plugin guidelines (developers.openai.com) | Scope: "plugins listed in the ChatGPT Directory". Lists "Execution of money transfers, crypto transfers, or investment trades" as not allowed. | Directory submission is excluded (owner decision 6). Developer mode is outside this scope. |
| OpenAI Commerce policies (updated 2026-09-29) | Scope: "product listings and merchant participation in OpenAI's shopping experiences"; bans crypto sales there. | Not used. |
| Anthropic Usage Policy (effective 2025-09-15) | Finance ("financial decisions, including investment advice …") is a High-Risk Use Case: human-in-the-loop for advice/decisions affecting consumers and **disclosure of AI involvement**. | The panel and `/approve` disclose that the proposal was produced with an AI assistant and is not advice; the owner decides and signs. |
| Anthropic agentic-use guidance (support article 12005017) | Prohibits agents that "Engage in unauthorized, illegal, or fraudulent financial transactions (such as brokerage or investment advisory activities) or payment processing". | Transactions are authorized by the user's own wallet signature; FloFi is non-custodial and never signs. Regulatory classification (brokerage, money transmission) needs the owner's legal review before any production or mainnet use. |
| Anthropic Software Directory Policy (2026-04-15) | Directory only: "Software that transfers money, cryptocurrency, or other financial assets" is unsupported. Custom connectors are not reviewed. | Directory submission is excluded. |

Neither platform explicitly prohibits this use for private, custom-connector or developer-mode integrations, so the
build proceeds. The check is repeated before live acceptance (owner decision 6).

## 3. What exists at `4b99acc` (MCP-001)

- `POST /api/mcp`: SDK `@modelcontextprotocol/server` 2.2.0 stateless handler; static bearer credentials
  (`FLOFI_MCP_CLIENTS`, SHA-256 digests, operator-granted read wallets). Nine read-only tools.
- `src/engine`: pure StrategySpec (v1, one action) → existing `Command` → `editorReducer` → canonical IR + hash; review
  over the linter and the execution capability registry; `codeCapabilities()` with `supportedByCode` and
  `demonstratedEvidence`.
- Wallet session: EIP-4361 only (`wallet-session.ts`), EVM-only principal; Solana connects through Wallet Standard with
  no sign-in proof. Router flows bind runs to the session (`ROUTER_OWNERSHIP`).
- Durable state: PostgreSQL (`packages/cloud-runtime`, migrations 0001–0004, tenant-scoped), embedded runtime on hosted
  deployments; Preview tenant per branch.
- SDK 2.2.0 supports `_meta` on tools and `registerResource`, which is enough for an MCP Apps (`io.modelcontextprotocol/ui`)
  panel without new dependencies.

## 4. Architecture

```
Claude custom connector / ChatGPT developer mode
  │ OAuth 2.1 (PKCE S256, CIMD or narrow DCR)          │ MCP over HTTPS  Authorization: Bearer flofi_at_…
  ▼                                                     ▼
/.well-known/oauth-authorization-server          /api/mcp  (resource server)
/.well-known/oauth-protected-resource/api/mcp      ├ enablement · Origin · body ≤ 64 KiB
/oauth/authorize (validate → consent → code)       ├ access token → McpPrincipal {account, client, grant, scopes, tenant}
/oauth/token (code / refresh rotation)             ├ tools/call scope check → 403 insufficient_scope (HTTP)
/oauth/revoke · /oauth/register (DCR, off)         └ SDK stateless handler: model tools + app-only tools + ui:// resource
        │                                                   │
        └──────────── PostgreSQL (0005_mcp_oauth) ──────────┘   accounts · clients · authorizations · grants · tokens
                                                                handoffs · wallet links · rate limits   (tenant-scoped)
request_user_approval ─► handoff (PENDING, secret hash) ─► approvalUrl <origin>/approve#<secret>
MCP App panel (ui://flofi/execution-panel) ─► open_signing_session ─► signing window / deep link ─► /approve
/approve (FloFi origin) ─► wallet proof ─► claim ─► propose(command) ─► existing flow panel ─► wallet signs
```

### 4.1 Authorization server (same Next.js deployment)

- Issuer and resource come from `FLOFI_PUBLIC_ORIGIN` only (never from request headers). Resource = `<origin>/api/mcp`.
- PRM (RFC 9728) at `/.well-known/oauth-protected-resource/api/mcp` (and the root form); one `authorization_servers`
  entry (Claude uses only the first).
- AS metadata (RFC 8414): `response_types_supported: ["code"]`, `grant_types_supported: ["authorization_code",
  "refresh_token"]`, `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["none"]`,
  `client_id_metadata_document_supported: true`, `authorization_response_iss_parameter_supported: true`,
  `scopes_supported`, `revocation_endpoint`, and `registration_endpoint` only when DCR is enabled. No
  `private_key_jwt` (no evidence it is needed; ChatGPT's CIMD also lists `none`).
- `/oauth/authorize`: `response_type=code`, `client_id`, exact `redirect_uri`, `state` (required), `code_challenge` +
  `code_challenge_method=S256` (anything else refused), `scope` ⊆ supported, `resource` = our resource (absent → the
  only resource; any other value → `invalid_target`). Errors before the client and redirect are validated render a page
  and never redirect. A valid request becomes a single-use pending authorization (10 min) and a consent page.
- Consent page: server-rendered HTML with no script, `frame-ancestors 'none'`, `form-action 'self'`, `no-store`,
  `noindex`, `no-referrer`. Shows the client name, the **redirect hostname**, a warning for localhost-only redirects,
  the scopes in plain words, "this does not connect a wallet and authorizes no transaction", and the invite-code field
  when required. CSRF: a per-request random token in an HttpOnly SameSite=Strict cookie and in the form, stored as a
  hash on the pending row; the POST also requires `Origin` = our origin.
- Approve → account (existing account cookie, else a new pseudonymous `mcpacct_…`), grant, authorization code (60 s,
  single use, bound to client, redirect, PKCE challenge, scopes, resource) → `302 redirect_uri?code&state&iss`.
  Deny → `access_denied` with `state` and `iss`.
- `/oauth/token`: authorization_code (client_id, redirect_uri and code_verifier must match; code replay revokes the
  grant's tokens) and refresh_token (rotation on every use; a reused refresh token within 10 s gets `invalid_grant`
  only, later reuse revokes the whole family). Access token 15 min, refresh family capped at 30 days. `no-store`.
  Errors per RFC 6749 §5.2; refresh failures are always `invalid_grant` (Claude expects it).
- `/oauth/revoke` (RFC 7009): always 200; revokes the token (refresh → the family).
- CIMD: `client_id` is an HTTPS URL on an allowlisted host (`FLOFI_MCP_CIMD_HOSTS`, default `claude.ai,chatgpt.com`).
  Fetch: HTTPS on 443 only, DNS resolved once and every address checked against private, loopback, link-local,
  CGNAT, multicast and reserved ranges, the connection pinned to the checked address, no redirects, 5 KiB cap,
  5 s timeout, `application/json`. The document must have `client_id` equal to the URL, `redirect_uris`, and
  `token_endpoint_auth_method` `none` (or a listed `none`); cached in PostgreSQL (1 h, bounded).
- DCR (RFC 7591), off by default (`FLOFI_MCP_OAUTH_DCR=enabled`): public clients only (`none`), `authorization_code`
  + `refresh_token`, redirect URIs on `FLOFI_MCP_DCR_REDIRECT_HOSTS` (default `claude.ai,chatgpt.com`) or loopback;
  rate-limited; unused clients expire after 30 days.

### 4.2 Tokens and secrets

- Opaque `flofi_at_<43 base64url>` / `flofi_rt_<43>` / codes `flofi_code_<43>`, 256-bit random. Only HMAC-SHA-256
  digests are stored, keyed by HKDF(`FLOFI_MCP_OAUTH_SECRET`, label per purpose). Tokens never appear in logs, URLs,
  tool output or anything forwarded to the internal API; hashes are never returned.
- `FLOFI_MCP_OAUTH_SECRET` (≥ 32 chars) is dedicated: equal to `API_AUTH_TOKEN` or `FLOFI_SESSION_SECRET` → configuration
  invalid (fail closed). The browser account cookie and handoff secrets use separate HKDF labels.
- Every MCP request validates the token against PostgreSQL (revocation is immediate). Store unavailable →
  `MCP_OAUTH_STORE_UNAVAILABLE` (503), never a fallback.

### 4.3 Resource server and scopes

| Scope | Grants | Never grants |
| --- | --- | --- |
| `flofi.strategy` | discovery, compose, validate, review, simulate | anything about a wallet |
| `flofi.approval` | `request_user_approval`, `get_approval_status`, app-only panel tools | authority over funds |
| `flofi.runs` | `get_execution_status`, `get_evidence` for runs of **wallets linked to the account** | ownership; a link is created only on FloFi with both proofs |

The first 401 asks for `flofi.strategy flofi.approval`; `flofi.runs` is requested by step-up (403
`insufficient_scope` with `scope` and `resource_metadata`). The gateway parses the bounded JSON-RPC body before the SDK,
so the scope check is an HTTP 403, as the MCP spec requires. Tools carry `securitySchemes` (and the `_meta` mirror).
The MCP-001 static bearer stays as a development/partner path and is refused (configuration invalid) on a production
deployment.

### 4.4 Identity and wallet proof

- Three separate things: the OAuth connection (grant), the pseudonymous FloFi account (`mcp_accounts`, no email, no
  wallet; HttpOnly `flofi_mcp_account` cookie, HMAC-sealed, 30 days), and wallet proofs.
- Wallet principals are namespace-neutral `{namespace: 'eip155' | 'solana', address}`.
- EVM: the existing EIP-4361 session, unchanged.
- Solana: **Sign-In With Solana** — server-issued challenge (sealed, single-use, 5 min) → the wallet signs the exact
  SIWS text with Wallet Standard `solana:signMessage` → Ed25519 verification with `node:crypto` → HttpOnly
  `flofi_solana_session` (same key family, namespace-tagged, host-bound, 8 h). The statement says it authorizes no
  transaction and moves no funds.
- Wallet link (`mcp_wallet_links`): created on a FloFi page that sees the account cookie **and** a fresh wallet
  session **and** an explicit consent click; 30 days; revocable on `/connections`; tenant-scoped. A wallet address or an
  execution id alone grants nothing; without a link, status and evidence are indistinguishable from not found.

### 4.5 `request_user_approval` and the handoff

- Input `{strategy, workflowHash}`. The server re-composes, requires the same hash, refuses review BLOCK findings,
  evaluates the execution plan (§4.7) and the four gates (§4.8), caps pending handoffs (5 per account), and stores the
  normalized strategy, never client-built IR.
- Output: `approvalId`, `approvalUrl` (`<origin>/approve#<secret>`), `workflowHash`, `expiresAt`, `status`,
  `networkEnvironment`, `fundsClass`, `steps`, `authority: "NONE"`, `requires: ["Open FloFi", "Prove wallet ownership",
  "Fresh simulation", "Strategy Manifest Review", "Explicit wallet signature"]`. Never calldata, unsigned transactions,
  signatures, session tokens or keys.
- Handoff: random 256-bit secret in the URL **fragment** (never sent to servers or logs), stored as an HMAC digest;
  tenant- and account-scoped; integrity-bound to the workflow hash and the engine version; single purpose.
- States: `PENDING` (15 min) → `CLAIMED` (bound to the proving wallet; must be applied within 10 min) → `APPLIED`;
  terminal `EXPIRED`, `SUPERSEDED` (a newer request for the same account and workflow hash), `REVOKED` (user or
  account action), `STALE` (engine output no longer reproduces the hash). Terminal states never revive; transitions
  are compare-and-set in PostgreSQL.
- `/approve` (FloFi origin; `no-store`, `noindex`, `no-referrer`, `frame-ancestors 'none'`) reads the fragment, shows:
  that the proposal is **external** and its originating client, network and funds class, the step list, the strategy
  summary, the workflow hash, "nothing is authorized yet", the REAL_FUNDS warning when applicable, and the AI-involvement
  disclosure. Then: connect wallet → prove ownership → claim (server re-composes and re-checks hash, gates and engine
  version) → `propose(command)` into the existing workflow store → the existing proposal card and flow panel. The
  applied IR's hash is checked against the handoff before the proposal is shown.

### 4.6 In-chat panel and wallet adapters

- MCP App resource `ui://flofi/execution-panel` (`text/html;profile=mcp-app`), attached to `request_user_approval`
  through `_meta.ui.resourceUri` (and `openai/outputTemplate`). Vanilla TypeScript bundled into one HTML document,
  speaking the MCP Apps postMessage protocol directly (`ui/initialize`, `tools/call`, `ui/open-link`,
  `ui/update-model-context`); `window.openai` only as an optional enhancement. CSP: no `connectDomains`, no
  `frameDomains`; all data goes through the host bridge.
- App-only tools (`_meta.ui.visibility: ["app"]`, hidden from the model): `open_signing_session` (fresh single-use
  5-minute signing URL for this handoff) and `get_execution_progress` (handoff state, step list, bound runs and their
  reconciled status for the panel). `get_approval_status` is model-visible.
- Adapters (one chain-neutral interface `WalletAdapter {id, namespaces, available(), open(signingUrl)}`):
  - A. In-frame wallet — implemented with a probe, **off by default**; enabled per host only after a documented
    experiment and owner sign-off. Never claimed without that evidence.
  - B. FloFi signing window — default on desktop: `ui/open-link` to the signing URL.
  - C. Mobile wallet deep links — Phantom (`phantom.app/ul/browse/…`) and MetaMask (`metamask.app.link/dapp/…`)
    in-app browsers, which inject their own provider.
  - D. WalletConnect/Reown — deferred (non-OSI licence, new external service); the interface leaves room for it.
  - E. `/approve` — universal fallback: the approval URL is always in the text result for hosts without MCP Apps.
- Status back to chat: the panel polls `get_execution_progress` and, when reconciled, sends `ui/update-model-context`
  with the run id, status, evidence environment and bundle hash (no transaction data beyond the public hash).
- Status sharing to the account is a toggle on `/approve`: on by default only when the same browser holds the creating
  account's cookie, otherwise off until the user opts in. It covers only runs started from that handoff by the claiming
  wallet.

### 4.7 Multi-step: the step-list contract (owner decision: option a)

- StrategySpec v2 `{version: 2, steps: [step, …]}` (1–8 steps; each step is a v1 action body). v1 stays accepted and is
  a one-step workflow. Composition applies each step's existing `Command` to the same editor state, in order; the IR,
  hash, review, handoff, panel, Manifest and evidence views are all step lists from day one.
- Execution plan: one executable step → its flow; the lending shape (supply → borrow → swap on Base Sepolia,
  `lending_composition`) → the existing `lending-composition` flow; anything else → `execute: false` with
  `MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED` in capabilities, review and `request_user_approval`. Authoring, validation,
  review and per-step simulation still work, honestly labelled.
- The follow-up sequential runner (step → simulate → sign → execute → reconcile → next, with restart/recovery and
  whole-workflow evidence) plugs into the same plan (`SEQUENTIAL` kind) without schema or UI redesign: handoff rows,
  panel and progress already carry per-step state.

### 4.8 Mainnet: disabled by policy only

Discovery and `request_user_approval` report four independent facts per capability: `supportedByCode`,
`enabledByDeployment` (flow mode and the flow's own `executionEnabled`), `enabledByPolicy`, `demonstratedEvidence`
(reported, never a gate). Policy: `FLOFI_MCP_HANDOFF_TEST_FUNDS=enabled` (default) and
`FLOFI_MCP_HANDOFF_MAINNET_NETWORKS` (empty by default; every mainnet network a workflow touches must be listed).
A blocked mainnet handoff returns `MAINNET_HANDOFF_DISABLED_BY_POLICY`. Nothing in OAuth, tool schemas, the handoff
schema, the database, StrategySpec, IR, URLs, the account model, the Manifest flow, execution status, wallet links or
discovery is testnet-specific. An isolated test enables a mainnet network by policy with mocked flows and proves the
same schema proceeds, REAL_FUNDS survives, nothing executes automatically and the signature remains mandatory.

### 4.9 Storage

Migration `0005_mcp_oauth.sql`, every key starting with `tenant_id`, no plaintext secret:
`mcp_accounts`, `mcp_oauth_clients` (CIMD cache and DCR), `mcp_oauth_authorizations` (pending consent and codes),
`mcp_oauth_grants`, `mcp_oauth_tokens` (access and refresh, family, rotation chain), `mcp_handoffs`, `mcp_wallet_links`,
`mcp_rate_limits`. Bounded retention by opportunistic purges (expired rows older than 7 days; handoffs 30 days). Store
interfaces (`OAuthStore`, `HandoffStore`, `WalletLinkStore`, `RateLimiter`) have one PostgreSQL implementation; the
embedded runtime provides the database. `remote` runtime → `MCP_OAUTH_STORE_UNAVAILABLE`; no process memory, `/tmp` or
file is ever used for correctness.

### 4.10 Rate and abuse limits (fixed windows in PostgreSQL; documented; fail closed)

registration 10/h per IP digest; authorize 30/10 min per IP digest; token 60/10 min per client; handoff creation
20/h per account; CIMD fetches 30/h per host; simulations keep the per-instance concurrency cap and add 30/h per
account. IPs are stored only as HMAC digests. No billing.

### 4.11 Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `FLOFI_MCP_OAUTH` | off | `enabled` turns on the AS and token authentication |
| `FLOFI_PUBLIC_ORIGIN` | — | exact `https://host` (loopback `http` only locally); issuer and resource base |
| `FLOFI_MCP_OAUTH_SECRET` | — | dedicated ≥ 32-char secret; refused if equal to `API_AUTH_TOKEN`/`FLOFI_SESSION_SECRET` |
| `FLOFI_MCP_OAUTH_ACCESS` | `invite` | `invite` or `open` (new accounts) |
| `FLOFI_MCP_OAUTH_INVITES` | — | comma-separated SHA-256 digests of invite codes |
| `FLOFI_MCP_CIMD_HOSTS` | `claude.ai,chatgpt.com` | CIMD hosts |
| `FLOFI_MCP_OAUTH_DCR` / `FLOFI_MCP_DCR_REDIRECT_HOSTS` | off / `claude.ai,chatgpt.com` | narrow DCR fallback |
| `FLOFI_MCP_HANDOFF_TEST_FUNDS` | `enabled` | test-funds handoffs |
| `FLOFI_MCP_HANDOFF_MAINNET_NETWORKS` | empty | mainnet networks allowed by policy |
| `FLOFI_MCP_APP` | `enabled` | attach the MCP App panel |
| `FLOFI_MCP_INFRAME_WALLET_HOSTS` | empty | hosts where the in-frame wallet adapter is offered (after experiments) |

No `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` dependency (regression test).

## 5. Acceptance criteria

- **AC-1 Consumer OAuth** — a Claude custom connector and ChatGPT developer mode connect through discovery, consent and
  token exchange, list tools and call them (owner-run on the Preview; Claude Code, the MCP Inspector and raw HTTP
  supplement but never substitute).
- **AC-2 Authoring** — one-action and multi-step strategies compose, validate, review and simulate; unsupported
  sequences are refused honestly.
- **AC-3 In-chat execution** (formal) — from the conversation, the user reaches execution with their own wallet: an
  EVM public-testnet path, a Solana devnet path and the lending composition, through the best **verified** adapter per
  host; only the user's wallet signs; no in-frame wallet claim without an experiment.
- **AC-4 `/approve` fallback** works for hosts without MCP Apps.
- **AC-5 Wallet-environment matrix** — hosts × platforms × namespaces × adapters, each VERIFIED / NOT SUPPORTED / NOT
  TESTED with evidence. If B, C and E are insufficient for a reliable ChatGPT or Claude journey, stop and report.
- **AC-6 Authority invariants** — no signing/sending tool; no calldata to the model; fresh simulation, Manifest and
  approval before each signature; mainnet refused by policy; the isolated policy-enabled mainnet test; no LLM API call.
- **AC-7 Mocked E2E** — Playwright with a minimal MCP Apps host harness: OAuth → compose → approval → panel → signing
  window → wallet proof → existing flow on MOCKED chains → reconciled status back in the panel (EVM and Solana).

## 6. Tests

Unit + PostgreSQL (`*.pg.test.ts`) + Playwright, covering the brief's list: OAuth (state, PKCE and verifier, non-S256,
redirect mismatch, issuer/`iss`, resource/audience, code expiry and replay, access-token expiry and revocation, refresh
rotation and replay, tenant isolation, scope and 403 step-up, malformed metadata, SSRF, unsafe redirect, leakage);
identity (wallet claim needs proof, link needs both sessions and consent, revoked link, execution id grants nothing);
handoff (expired, replayed, cross-user, cross-tenant, modified strategy, stale hash, engine change, invalid capability,
mainnet blocked, testnet allowed, no calldata/tx/signature/key path, no automatic execution); output (no tokens in URLs,
logs or structured responses). Gates: `pnpm check`, `pnpm test:postgres`, relevant Playwright groups,
`python3 scripts/governance_lite.py` and its unittest suite.

## 7. Phases

0. Worktree, branch, policy re-check, this plan.
1. Store, migration 0005, token crypto, configuration.
2. Authorization server and consent page.
3. Resource server, scopes, 401/403 and the gateway integration.
4. Policy gates and capability discovery (four facts).
5. Chain-neutral wallet proof, Sign-In With Solana.
6. Handoff, `request_user_approval`, `/approve`, claim → `propose`.
7. MCP App panel, app-only tools, adapters, mocked host harness.
8. Status sharing, run binding, wallet links, `/connections`.
9. Step-list contract (v2) and execution plans.
10. Docs (`docs/deploy/MCP.md`, `ENVIRONMENT.md`, `CLOUD.md`, `docs/STATUS.md`), report with "Mainnet Activation
    Path", Preview set-up for the owner, policy re-check before live acceptance.

## 8. Exclusions

Automatic execution by the model; arbitrary transaction or calldata tools; key handling; custody; server signing;
mainnet transactions; Mode C; x402; billing; subscriptions; partner console; marketplace; Dashboard; unrelated UI
redesign; WalletConnect/Reown; directory submission.

## 9. Risks and owner actions

- Live acceptance (AC-1, AC-3, AC-5) needs the owner: Preview environment variables, connecting claude.ai and ChatGPT
  developer mode, testnet wallets and signatures. The agent never signs.
- ChatGPT plan eligibility for developer mode could not be verified (help centre refuses automated fetches).
- Host iframes may block popups and injected wallets; the in-frame adapter stays off until proven.
- A Preview tenant is per branch: OAuth state survives redeploys of the branch, not across branches.
- Legal review of the regulatory classification before production or mainnet.
