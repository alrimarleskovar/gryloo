# Security model

Current product name: **Flofi** (formerly Gryloo); see the
[branding transition](builds/BUILD-BRAND-001-PLAN.md). Historical entries below
retain the name used at the time. Runtime identifiers remain compatible.

## Governance-lite migration

Repository source changes now use owner PR review and ordinary CI under [GOVERNANCE-LITE](SCOPE_GUARD.md). Historical source digests, path authorization and build-phase procedures below describe the old model and no longer constrain future implementation. Product authorization, financial execution, recovery, reconciliation, evidence and dependency controls remain in force. The current secret check reuses the old credential families, allows documented placeholders and never prints matched values. Its basic patterns cannot detect every secret; owner review remains necessary.

## BUILD-DEVELOPER-001 developer API boundary

A developer API key authenticates an **integration**, never a wallet or a person, and is no financial authority: the Developer
API (`/api/developer/v1`) has no route that prepares, authorizes, hands off, reports or submits a flow action, and its runtime
port is limited to flow mode/info, owner-scoped run reads and the read-only simulation preview (a journey test records every flow
call). Execution still requires the end user, on FloFi's `/approve`, to prove their wallet (EIP-4361 or Sign-In With Solana),
load the re-composed proposal and run FloFi's unchanged flow: fresh simulation, Strategy Manifest Review, explicit approval,
their own wallet signature. Keys are server-side only: requests carrying `Origin` or `Sec-Fetch-Site` are refused and no CORS
headers exist. Keys are 256-bit opaque credentials stored as HMAC digests under an HKDF key of a dedicated
`FLOFI_DEVELOPER_SECRET` (refused if it equals another deployment secret), looked up on every request, so revocation is
immediate. Strategies are immutable in the database; an approval is bound by a database trigger to one strategy revision and its
exact workflow hash, and the owner's workflow must hash exactly to it before the proposal is applied; runs of an edited workflow
are never attributed to the approval. Run status and evidence reach a project only while the owner shares them (off by default);
absent, unshared and other projects' resources answer identical `404`s; every query is scoped by tenant, project and environment
from the authenticated principal. Approval-link secrets travel only in the URL fragment and are stored as digests; webhook
secrets are derived and never stored; neither is ever stored in idempotency records. Responses pass the platform output guard
(no calldata, transactions, signatures or secrets); logs carry ids and route templates, never keys, bodies, addresses or URLs.
Webhooks are notifications derived from durable state: no state transition reads a delivery, deliveries are leased (no duplicate
concurrent attempt) and signed (Standard Webhooks), and the transport delivers only to public HTTPS addresses re-resolved per
attempt through a pinned socket without redirects. Sandbox credentials are test-funds only (mainnet strategies refused at
creation); live credentials are refused and cannot be issued. Intentional changes for owner review: the shared approval surface
`/approve` no longer requires MCP OAuth to be enabled (it serves every registered requester kind through per-surface link schemes
and keys), and its AI-involvement line is requester-aware (developer proposals are disclosed as third-party, not AI). No new
registry dependency; the SDK is an empty-importer workspace package (Apache-2.0).

## BUILD-CLOUD-001 cloud boundary

The cloud API and workers run the same services as the in-process server actions and add no authority: no key,
signature, seed phrase or transaction submission path exists on any server, and the RPC clients keep their
read-only method allowlists. The owner still signs in the browser wallet after the API has durably recorded
PREPARED and SUBMITTING; workers only observe (never a PREPARED attempt) and reconcile. Browser input is untrusted:
the API accepts only validated IDs, the authoring workflow and wallet results, and every transition is re-validated
against the durable log. Economic identities (owner nonce, exact call) are database primary keys, so a second
economic attempt cannot be prepared from any process. Fenced leases stop a stale holder from writing after
takeover; append-only history tables reject UPDATE/DELETE; reads verify length and SHA-256. The API requires a
bearer token in production (constant-time comparison), returns only allowlisted error codes and is reached
server-to-server by the Vercel BFF, so the browser keeps `connect-src 'self'`. Logs are structured and redacted
(tokens, authorization headers, credential-bearing URLs, signatures). Secrets come only from the environment.
Intentional control change for owner review: inside the separately deployed backend, Robinhood live reads are
enabled by `GRYLOO_ROBINHOOD_TESTNET=live` alone instead of also requiring `NODE_ENV=development`, the Base Sepolia swap
by `GRYLOO_PUBLIC_TESTNET=record` alone (same reason), and Aave Supply public reads require the new explicit
`GRYLOO_SUPPLY_TESTNET=live`. In shared storage every swap mutation, including Review and wallet results, runs under
the run lease, and swap snapshots are kept as append-only history instead of one overwritten file. Solana flows keep
their reviewed model: the owner's wallet signs in the browser and the API verifies the exact reviewed bytes and signature,
persists the signature, then relays those owner-signed bytes once, only on the browser's explicit submit. Worker
processes use a transport that rejects `sendTransaction`, `eth_sendRawTransaction` and `eth_sendTransaction`
unconditionally. Jupiter mainnet-beta execution stays off unless the owner sets `GRYLOO_JUPITER_OWNER_EXECUTION`. The in-process server action gates are unchanged.
Tenant attribution is configuration-based (`TENANT_ID`); per-user authentication remains future work and needs no
schema change. Dependency control: `pg@8.23.0` and `@types/pg@8.23.1` (MIT) plus 13 MIT/ISC transitive packages
were added to the reviewed inventory (247 → 262 registry packages) with no new license exception.

## BUILD-007 composition boundary

The Safe owner is the root authority; a disposable local executor receives two one-use Roles permissions after separately reviewed owner transactions. The worker may submit only fixed swap and mint calls from the prepared Manifest, persists an attempt before submission, and reconciles the swap before choosing a bounded mint amount. Unknown submission stays `INCONCLUSIVE` without guessing or retrying a send. A successful swap with failed mint leaves assets in the Safe and requires owner review; no automatic swap-back occurs. The new Base source recording is read-only, single-flight, limited to 1,500 provider requests, 39,000 reserved listed CU and 30 minutes, and stops on the first provider or policy error. Its credential was owner created outside Git after credential-free preflight and removed after the stopped attempt (2 reads / 52 reserved CU). The one-attempt authority is exhausted. Certified BUILD-003–006 evidence is preserved.

## Build 000 posture

BUILD-000 has authorization mode `NONE`, no assets under execution, and no
financial functionality. It protects governance integrity, provenance, secrets,
future trust boundaries, IP status, and brand identity.

## Trust boundaries

- Human approval versus AI proposals.
- Canonical specification and prompt versus implementation.
- Proposed ADRs versus approved decisions.
- Application checks and monitoring versus independent enforcement.
- Public repository content versus private managed operations.
- Repository workflow versus third-party automation.

## Threats and controls

Source mutation is controlled by a byte digest; scope drift by the registry and
scope guard; false authority claims by the authority matrix; premature Mode B
selection by `PROPOSED` status; secret disclosure by basic pattern checks;
supply-chain exposure by using no external workflow actions; misleading evidence
by explicit `NOT_APPLICABLE` statuses; licensing ambiguity by DEC-0008 and the preserved licensing amendment; and
unapproved advancement by the next-build gate.

This document does not claim that future runtime threats are mitigated.

## BUILD-001 contract boundary

Authorization mode remains `NONE`; financial enforcement is `NOT_ENFORCED`.
Contracts describe intent, observations, requests for authority, and execution
records. Validating those descriptions grants no financial permission.

Untrusted serialized artifacts enter through `parseArtifactBytes`. Fatal UTF-8
decoding rejects invalid bytes and BOM. The reviewed tokenizer feeds a bounded
grammar and decoded-key guard before object construction: duplicate keys,
escape-equivalent aliases, trailing documents, malformed JSON, and unpaired
surrogates are rejected. Closed schemas then validate shapes and links. Native
monetary quantities use integer strings; unsafe numeric values are rejected.
Object-only validation cannot establish whether original JSON had duplicate keys.

Explicit field projections and length-framed domain separation bind canonical
artifact meaning. Revision conflicts, invalidation, and impossible hierarchical
transitions fail closed. These functions neither persist state nor authorize
retry, signature, submission, cancellation, or reconciliation.

Fixed Node and pnpm archives are verified before extraction. Direct versions
and registry integrities are pinned; new resolutions observe a seven-day release
age, strict peers, and license review. CI disables lifecycle scripts, checks the
frozen lockfile, audits dependencies, and validates an ephemeral SBOM. No
third-party Actions, automatic package-manager substitution, or retained SBOM
artifact is claimed. Dependency or parser discrepancies require human review.

Governance preserves baseline source, legal, historical, and asset bytes,
enforces the exact authorized path list, scans repository sources for basic
secret indicators, and requires explicit approval before any subsequent build.
These checks supplement review; they cannot detect all secrets or future
runtime vulnerabilities.

The BUILD-002 reference application is a local-only mocked shell. Browser
tests abort and report every unexpected external request; a dedicated negative
test proves the guard fails on an intercepted synthetic attempt. The locked
dependency verifier checks all 245 registry entries, including optional
platform packages, and pins 16 reviewed exceptions by exact identity, SPDX,
SRI and graph route. Future distribution of Sharp/libvips binaries has a
separate release-compliance gate.

## Governance controls after the BUILD-002 amendment

The BUILD-002 governance rewrite kept its exact-scope, protected-byte,
licensing, patch and attribution checks. It omitted the BUILD-001
secret-indicator, email, Markdown-link, identifier, brand, unsupported-claim,
official-text digest, package-export and heading checks. From the BUILD-002
merge until this amendment, CI did not run those controls. The
[BUILD-002 governance amendment](builds/BUILD-002-GOVERNANCE-AMENDMENT.md)
(DEC-0014) keeps every BUILD-002 check and restores the omitted ones for the
current tree:

- basic secret indicators in every text file, including upstream copies;
- email addresses in Gryloo-authored text, except the two approved patch
  file names;
- relative links in Gryloo-authored Markdown outside fenced code blocks;
- well-formed, unique and registered decision and requirement IDs, gap-free
  decision numbers, and existing ADR files for every ADR reference;
- deprecated names in Gryloo-authored files outside the Master Prompt and the
  governance check itself, and unsupported claims in the README and application
  source;
- official license-text digests and sizes, exact license copies, and digests
  for the specification, prompt, ADRs, historical build records, contract
  profiles, legal notices, assets and visual baselines;
- frozen v1 schema, compatibility-fixture and upstream-legal trees, package
  identities and exports, schema identifiers and strict JSON parsing;
- plan and report headings where the template applies;
- output hygiene: no tracked generated output, local environment file, SBOM,
  CLA file or unapproved manifest, and no whitespace errors in changes.

These remain basic pattern and digest checks. They supplement review and
cannot detect every secret, claim, license issue or runtime vulnerability.
Upstream legal copies are exempt from the checks that concern Gryloo-authored
text but remain pinned by digest and scanned for secret indicators.

## BUILD-003A non-executing authoring boundary

Untrusted chat text, form values, commands and candidate workflow objects are
validated before mutation. The Base registry context is created outside the
editable path and recursively frozen. Exact decimal conversion uses bounded
strings and integers; review findings are deterministic and revision-linked.
Every swap remains unquoted and execution-unavailable, even if a caller forges
review results. The browser request guard still permits only loopback traffic.

The linter is application review, not independent financial enforcement. A
compromised client can misrepresent this UI; no execution authority or financial
safety guarantee exists. The exact BUILD-003A scope gate supplements the
historical BUILD-002 and amendment checks without changing protected files.

## BUILD-003B mocked artifact boundary

The browser digest mirrors the frozen DWE-HASH v1 profile for four artifact
kinds and the raw-response domain only; it has no payload, intent or authority
domain. It runs a known-vector self-check before every generation and review;
a failure prevents generation and shows an explicit error. Differential tests
on the pinned toolchain require equal digests and that every input the frozen
implementation rejects is rejected too.

The chain review recomputes every cross-artifact hash and revision link and
rejects tampered, mislinked, authority-bearing or fee- and gas-bearing mocked
artifacts. One synchronous access guard binds content to the exact IR revision
and object and checks expiry by wall clock, backwards clock and monotonic time
on every access and when the tab resumes. Non-current chains hide their numbers
and JSON.

These are application review controls in a client that a compromised browser
could misrepresent. Mocked provenance and hashes are not proof of authenticity
and are not independent financial enforcement. New governance scans reject
authority types, wallet and RPC tokens, network primitives, raw HTML injection
and browser storage in the application and linter sources.

## BUILD-003C read-only observation boundary

The local server alone can send allowlisted JSON-RPC reads to Base when explicitly enabled in development. The browser stays same-origin under a `connect-src 'self'` CSP and the unchanged E2E network guard. The server permits only chain/head/final-block checks, hash-pinned `eth_getCode` and hash-pinned `eth_call` to fixed Base USDC, WETH, factory and QuoterV2 targets with six selectors. Every state read has `{ "blockHash": H, "requireCanonical": true }`; an unsupported form stops the read with no block-number fallback. Size, timeout, rate, attempt, request and breaker limits fail closed. Replay mode makes no network request.

The provider sees the local server IP, request timing, token pair, exact input amount and queried contracts; it sees no user wallet address or browser cookie. The public endpoint is rate-limited and unsuitable for production use. Two HTTP 429 responses stopped its recording at 2/4 attempts and 24/84 requests. DEC-0021 approved Alchemy Free as the sole read provider with a server-only Bearer credential on the fixed `/v2` URL and a separate 3-attempt/63-request cap. The original Alchemy `eth_chainId` request returned HTTP 403, preserving its stopped attempt-1 files at 1/3 attempts and 1/63 requests. The owner reported that the app then had no active network, enabled Base Mainnet only, and approved the DEC-0022 carried-counter continuation. Owner-run attempts 2 and 3 returned 42 HTTP 200 responses, verified both EIP-1898 pinned methods and produced the two required transcripts. Final Alchemy use is 3/3 attempts and 43/63 requests. No further live request is authorized. The credential-free fixture, transcripts and logs contain no key, serialized authorization header or Bearer marker; the key value was never inspected. No paid plan or charge is authorized. The [BUILD-003C report](builds/BUILD-003C-REPORT.md) records the separate immutable stop evidence, final hashes and local acceptance. Observations remain `NOT_EVIDENCE`, never authorization inputs and never a financial execution result.

## BUILD-003D G5 recording incident (provisional; the full BUILD-003D section follows at G8)

The single owner-run G5 recording attempt, on 2026-09-24, sent two Base Mainnet reads with the owner's Bearer credential and then stopped fail-closed. Both reads were `eth_getBlockByNumber` calls answered with HTTP 200.

**Credential containment.**

- The credential stayed in the owner's proxy process.
- Scans of every preserved journal, log and script found no key, Bearer marker, authorization text or keyed provider path.
- The agent never read the credential and made no live request.

**Weakness exposed by the stop.** The stop was fail-closed but opaque. The proxy closed its own listener, and the wrapper discarded the proxy's output, so the rejected request was recorded nowhere.

**Repair.**

- The repository repair adds pre-spawn port and upstream checks, event-driven readiness, and cleanup of child processes on interruption.
- Error tails now quote stderr only, because Anvil's stdout banner lists dev-account keys.
- Anvil now receives a minimal environment, with no inherited proxy, Foundry payment or credential variables.
- The pinned Anvil v1.8.3 contains a payment-capable MPP transport for HTTP 402 challenges. It stays unreachable while Anvil talks only to the loopback proxy, and the proxy never relays HTTP 402.

**Proposed proxy corrections (Amendment 5).**

- a durable, credential-free stop detail;
- a listener kept open after a stop;
- no provider send after a stop or after a client disconnect;
- pacing measured at the send.

**Amendment 5 approval.** The owner approved Amendment 5 on 2026-09-24. The attempt-2 proxy adds a monotonic pacing clock, because the WSL2 wall clock stepped by seconds. It also binds its loopback port before activating the journal.

**Amendment 6 accounts.** Anvil's public default accounts were found to carry EIP-7702 delegations on Base, so Amendment 6 replaces them with pinned, public, test-only Gryloo accounts:

- The phrase lives only in the e2e harness, verified against its pinned digest. It is never in browser, app or package source, and never in logs, errors or evidence.
- The accounts are used only inside the local chain-31337 fork and are never funded on a public network.
- The empty-code rule is unchanged: a delegated account is refused, never cleared.

Recording remains owner-run: the agent prepared and validated the entrypoints offline, with a synthetic credential only. Observations and recordings are not authorization inputs.

**Attempt 3 and closure.** Attempt 3 selected clean Amendment 6 accounts. It then stopped because the fixture read a transaction receipt before Anvil's asynchronous automine had executed the transaction.

- **What was sent.** 34 provider requests were reserved. Every request was a hash-pinned state read or an approved block read.
- **What stayed local.** No transaction was submitted outside the local fork, and no credential, key or test phrase appears in any evidence.
- **Closure.** BUILD-003D closes under Option B (DEC-0025). Its delivered code has no wallet bridge, no server fork transport and no broadcast path. The updated governance forbids Mode A imports into the application or linter until BUILD-003F.

## BUILD-003D acceptance boundary (DEC-0026)

The local Base fork, Anvil, synthetic accounts and replay tools are acceptance infrastructure only. They are not Gryloo production runtime, deployment architecture or an end-user flow. Gryloo remains a global online non-custodial multichain product. Production signing occurs in user wallets; production browser, server, API, SDK, MCP and multitenant storage must never request or hold a mnemonic or private key. The delivered fork harness contains no phrase or reconstruction input. Future owner-secret revalidation requires an untracked mode-0600 file and a separately approved BUILD-003F procedure; BUILD-003D has no remaining recording authority.

## BUILD-003F owner-controlled fork boundary

The historical Amendment 6 mnemonic was never delivered to the owner and is not a prerequisite. F2 generated disposable local test material under isolated owner control; the current F3–G7 account material stayed in a mode-0600 file outside the repository. The harness re-derived ten public addresses and compared the private public-pin manifest before fork startup. Only pinned Anvil v1.8.3 in the approved local test boundary could receive the disposable phrase in temporary `--mnemonic` argv. These accounts and keys are permanently compromised test material and must never hold public-chain funds or authority.

For the single real F3 recording, only the local proxy read a newly rotated credential from an owner-owned mode-0600 file after the pinned preflight. The fixed Alchemy Free Base Mainnet endpoint received allowlisted, finalized hash-pinned state reads under durable one-shot caps; the credential never entered Anvil, the app, browser, Git or transcript. The file was removed at completion. The transcript and replay are credential-free; replay and CI use no provider key or external route. Exact-value scans of Git/workspace, accessible shell histories and process argv/environment found no credential occurrence, and the transcript scan found no exact phrase or credential pattern.

F5's server path is opt-in, same-origin and loopback-only; mocked and observed artifacts cannot enter Mode A execution. G7's named MetaMask wallet imported the disposable test account through an owner-controlled private flow. The app neither read that key nor signed/broadcast for the owner; it requested two separately reviewed EIP-1193 signatures on chain 31337. Independent G7 verification re-read signed bytes and receipts from the fork and returned `RECONCILED:EXACT` with zero residual allowance. Local-fork evidence does not establish public-chain safety, mainnet execution or production custody. The private phrase remains outside Git until BUILD-003F closes and must then be deleted.

## BUILD-004 finite local authority

DEC-0031 selects Safe 1.4.1 and Zodiac Roles 2.1.0 for one disposable local-fork owner and a distinct disposable executor. Roles constrains the exact Router02 target, selector, nested call parameters, zero value, call operation and one-time allowance; Uniswap enforces the fixed deadline and minimum output. The owner retains broader Safe authority. The executor key is confined to a mode-0600 temporary local file and is never an owner key. The browser requests each owner transaction through an injected wallet; a browser unload does not stop the separate worker. An unknown submission freezes automatic retry. Chain-confirmed role removal, module disabling and router-allowance zeroing establish revocation. Final owner wallet acceptance and production key management are outside the automated local proof.

## BUILD-005 local signed-intent security boundary

The CoW adapter is off unless `GRYLOO_COW=loopback` and an absolute runtime directory are configured. Its scripted orderbook persists only to that disposable local directory. The browser accepts only an injected provider explicitly marked as the Gryloo disposable local test wallet and checks chain 8453 and account at connect and signature time. The key exists in the browser-test fixture process only, never in the DApp server or repository. The server independently verifies EOA EIP-712 signatures and exact Manifest-linked order limits. It fsyncs an append-only posting attempt before sending and performs UID lookup only after ambiguity or restart. A missing order never triggers a speculative second post. Cancellation is separately signed and is pending until observed; settlement requires consistent scripted receipt, trade, balances, fee and allowance. All outcomes are `MOCKED` engineering evidence. This profile gives no assurance for public CoW transport, solver behavior, public-chain settlement, production wallets, escrow, or real funds.

## BUILD-006 approved local liquidity boundary

DEC-0036 authorizes only a chain-31337 Mode A user-wallet liquidity lifecycle and one conditional owner-operated read-only Base recording. The model and server receive no owner key; each approval and liquidity operation requires exact reviewed EIP-1559 authorization. Pool, Position Manager, tokens, tick spacing and source state must be verified before compiling payloads. Finite allowances, persist-before-submission attempts, fail-closed unknown-result recovery and independent owner/token ID/liquidity/balance/fee/allowance reconciliation are acceptance gates. The recording requires offline preflight, Free-plan and fresh private credential checks and a permanent stop at the first failure or the fixed caps. It conveys no public-chain write, production wallet, real-funds or Mode B liquidity authority. The implementation keeps mutable pool and position reads outside the semantic IR, pins all five contract bytecodes on a hash-pinned fork block, and rejects a moved head or changed owner/allowance before submission. Browser requests compare decoded calldata and unsigned EIP-1559 fields with the reviewed operation; the server persists the attempt before any wallet request. A lost wallet response freezes submission until signed bytes, nonce, receipt and independently repeated position and balance reads agree. The owner recorder accepts only the fresh private credential through its child proxy, with one attempt and durable request/CU accounting.

## BUILD-012A Supply boundary

Supply review binds canonical revision, account, chain, asset, native-unit amount, beneficiary, exact Pool/spender, actual allowance requirement, calldata, nonce and gas budget. Fresh deployment/allowance/token/gas reads precede execution. Only the owner-triggered injected-wallet request submits, once per durable economic step. Finite approval and Supply are separately observed. Permanent nonce intent leases and bounded account/nonce transaction discovery prevent uncertain-result retransmission. Independent transaction, event, canonical receipt and historical scaled aToken/index reads are required; ambiguity never reconciles. Read-only simulation verifies exact approval and a bounded allowance-state override without changing chain state. The MOCKED loopback harness cannot produce public maturity.

## BUILD-CHANNELS-001 conversational channel boundary

A conversational channel (Telegram live; WhatsApp implemented but policy-blocked) is an entry point into the shared platform. It has no financial authority. A channel message, including "yes", "confirm" or "execute", never authorizes, claims, applies, signs or submits anything. A sender id or a typed address is never wallet ownership; a typed address is only the strategy's intended wallet, which narrows who may claim on `/approve`, where the EIP-4361 / Sign-In With Solana proof stays mandatory.

The only bridge to execution is a platform approval with `requester_kind = 'CHANNEL_CONVERSATION'`. It has no MCP account and no grant. Its `flofi_chs_` secret travels only in the URL fragment of one delivered message, is never stored or logged (the platform keeps its digest), lasts 15 minutes, is view/claim scoped, and is revoked whenever the pending proposal is replaced. After the claim, FloFi's unchanged flow applies: fresh simulation, Strategy Manifest Review, explicit approval and the owner's wallet signature. Runs are visible to the conversation only while the owner shares them, and only as public facts.

Webhooks are authenticated before parsing: WhatsApp by HMAC-SHA256 over the exact raw bytes, Telegram by its secret token, both constant-time. Keys and seed phrases are refused before anything is stored. Message text exists only as a short-lived AES-256-GCM payload, enforced by database CHECK constraints. Records are content-free keyed digests, and logs are allowlisted closed codes. The interpreter is the existing untrusted Copilot boundary; the approval-side code (contributor, status ping) is model-free. Delivery failures never block or change execution, reconciliation or evidence. A send whose outcome is unknown (a timeout, a crash mid-send) is never sent again; providers reach the network only through one bounded HTTPS helper with fixed origins and no redirects. The scheduled dispatch and the readiness endpoint exist only behind a bearer whose SHA-256 is configured, and the operator CLI never prints a secret. A source-level boundary test checks that nothing reachable from any channel entry point signs, holds a key, submits a transaction, runs an execution flow or claims/applies an approval. WhatsApp's live path is complete but cannot be activated without written policy clearance recorded in code by a reviewed change (owner decision D1, WhatsApp Business Messaging Policy §4); its fixture provider never runs on a hosted deployment.

## BUILD-AUTOMATION-001 automation boundary

Automations are automated evaluation and owner-confirmed execution (`CONFIRM_EACH_TIME`, the only value the database admits). The scheduler (`/api/automations/dispatch`, bearer-only, constant-time digest check, 404 when unconfigured), the evaluator, the price source and every notification hold no key, sign nothing and submit nothing; a source-level boundary test checks the import closure of the scheduler for signing, key custody, execution flows and approval decisions. In production the Railway worker hosts that evaluation (`FLOFI_AUTOMATIONS=enabled` on the worker): it builds only the work runtime — no automation keys, no engine runtime, no owner service — so it cannot mint an approval, run a flow, sign or submit, and its flow services keep their observe-only transports (`WORKER_SUBMISSION_FORBIDDEN`). The Railway API serves the owner's automation operations (`/v1/automations/*`) and automation approval links (`/v1/approvals/*`) behind its bearer token: the owner is the server-to-server `x-flofi-workflow-owner` header the BFF sets from the verified wallet session (the saved-workflow convention), the proven wallets of an approval call travel in `x-flofi-wallet-principals` (set only by the BFF from the HttpOnly cookies), every query is scoped to that owner, and the routes make no flow call beyond the read-only `mode`/`info` gates (a test records every call). Both processes load the shared modules on plain Node through one resolution rule scoped to extensionless relative imports inside `apps/reference-dapp/src`, installed only when automations are enabled there. The price transport can send only `eth_chainId` and `eth_call` (anything else is refused before a byte leaves the process); Chainlink feeds are configuration, verified on-chain (chain, description, decimals) before use, and stale or failed observations change no state. A price observation only feeds a deterministic comparison with edge (fire once per crossing) and cooldown semantics.

An evaluation produces at most one occurrence per trigger event: a unique `(rule, trigger_key)` key, the rule's row lock, fenced work-item leases and re-checks under the lock (state, due time) make duplicate schedulers, competing workers, retries, crashes and a pause while queued safe. An occurrence is a proposal. Its only bridge to execution is a platform approval with `requester_kind = 'AUTOMATION_RULE'`, minted only when the owner opens the occurrence in their own verified FloFi session (`flofi_auhs_`, digest stored, 15 minutes, view/claim only); its claim policy accepts only the automation owner's proven wallet while the rule is ACTIVE without attention and the occurrence still holds that approval. Reopening or dismissing an occurrence withdraws its current approval first, transactionally; an approval the owner already applied completes the occurrence instead, so one occurrence never yields a second proposal and an applied one keeps counting against the limits. A rule's definition, limits and expiry are immutable in the database, and its bound action changes only with a version increase. The stored strategy must re-compose to its workflow hash, and FloFi's unchanged flow follows: fresh simulation, Strategy Manifest Review, explicit approval, the owner's wallet signature. An automation's action is bound by value to a canonical StrategySpec and hash; a saved-workflow edit or an engine change stops proposals until the owner's explicit, limit-checked rebind. Every owner operation re-verifies the HttpOnly wallet session for the named owner and scopes each query to tenant, namespace and account. Notifications (in-app; Telegram through the existing Channel Core after a one-time, single-use link code) carry no approval secret — the output guard admits only the owner's own workspace link — and their delivery never changes an occurrence. Mainnet is refused by policy unless explicitly listed; the fixture price source and the test clock are refused on hosted deployments. Logs carry ids, closed codes and counts only.
