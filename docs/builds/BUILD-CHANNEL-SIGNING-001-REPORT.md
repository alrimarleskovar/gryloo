# BUILD-CHANNEL-SIGNING-001 — implementation and validation

The implementation reuses the existing `/approve` owner journey, wallet proof/session system, unified Strategy Manifest, simulation, financial execution boundary and recoverable engine. Channels consume PR #71's unchanged PostgreSQL platform state host. No dependency, database migration, execution engine, authorization system or Manifest is added.

MCP capabilities now stay in client-only tool metadata. Models receive an account-authenticated nonsecret reference; the panel retains the secure signing-window and private mobile/fallback actions. Loading the server-recomposed proposal takes one explicit owner action and invalidates any earlier Review. Consumed-session recovery reconstructs only the proven claimant's applied authoring proposal; it restores no simulation, Review or spending authority. The panel handles refused links, concurrent clicks and sanitized progress. Channel intended Solana wallets compare case-sensitively.

Review the [focused audit/plan](BUILD-CHANNEL-SIGNING-001-PLAN.md), [flow and threat model](../deploy/UNIVERSAL-SIGNING.md), [capability matrix and four owner procedures](../deploy/UNIVERSAL-SIGNING-OWNER-E2E.md), and [PR #71 compatibility note](BUILD-CHANNEL-SIGNING-001-PR71-COMPATIBILITY.md).

## Automated validation

Local toolchain: Node `24.21.0`, pnpm `11.22.0`, Playwright headless shell revision `1243`, approved Anvil `1.8.3`, disposable databases on the existing loopback PostgreSQL container. Browser guards block external requests. No provider account, public RPC transaction or real funds were used.

| Validation | Result |
| --- | --- |
| `pnpm check` | Passed: typecheck (16 tasks), lint, production build (9 tasks), 11 schema exports, unit suite |
| Unit suite within `pnpm check` | 287 files / 2,965 tests passed; 2 files / 2 tests skipped |
| `TEST_DATABASE_URL=<loopback-admin> pnpm test:postgres` | 39 files / 252 tests passed |
| Governance unit suite | 19 tests passed |
| Governance-lite and `git diff --check` | Passed |
| `channel-signing.spec.ts` (separate disposable database) | 6 browser tests passed: ChatGPT/Claude recovery and link isolation, delayed apply response, refusal/double click, rejected proof/retry, sanitized progress |
| `mcp-in-chat.spec.ts` + `mcp-route-presentation.spec.ts` | 21 browser tests passed, including EVM, Solana and lending composition recovery |
| `developer-journey.spec.ts` | 1 browser test passed |
| `whatsapp-approve.spec.ts` + `telegram-approve.spec.ts` | 2 browser tests passed with fixture providers |
| Review/Execute browser regression (3 files) | 31 browser tests passed; no screenshot baselines changed |
| Offline fork suite (`--testTimeout=30000 --maxWorkers=2`) | 5 files / 31 tests passed; 8 files / 29 owner-input-dependent tests skipped |
| Offline synthetic F1 rehearsal | PASS: 5 fresh-process repetitions, 50 provider-equivalent requests each |

The two unit skips are existing composition-service and Mode B service owner-fixture gates: the required owner file/transcript/pinning inputs were not supplied. Fork skips likewise retain the existing owner phrase/profile/transcript prerequisites. They are not reported as passes. Browser financial execution remains rejected for MOCKED authority; positive execution/reconciliation in PostgreSQL and synthetic F1 is engineering evidence.

## Scenario evidence

| Required scenario | Automated coverage |
| --- | --- |
| Four initiation surfaces | MCP gateway/consumer handoff and App contracts; named ChatGPT/Claude browser fixtures; authenticated Telegram/WhatsApp webhook journeys, PostgreSQL and owner-page browser tests |
| Successful execution/reconciliation/status | Existing MCP and channel PostgreSQL journeys simulate, review, authorize using fixture owners, reconcile synthetic receipts and deliver consented state to the originating conversation |
| Cancellation/rejected signature | New browser close/reopen and rejected proof/retry; existing EIP-1193 exact-transaction tests distinguish REJECTED and UNKNOWN |
| Expired/revoked/superseded/stale links | Existing handoff/approval PostgreSQL suites and route presentation; fresh re-composition/policy checks |
| Wrong wallet/tenant/account/namespace/chain | Approval recovery and account fallback PostgreSQL tests; channel intended-wallet comparison; retained wallet/exact-payload and proof suites |
| Changed workflow/Manifest/freshness | Existing canonical apply-hash mismatch, stale engine and financial Review/Manifest/freshness tests; restored workflow invalidates old Review |
| Duplicate callback/click | Provider deduplication/retry PostgreSQL tests; panel concurrent click fixture; existing PostgreSQL handoff transitions |
| Network interruption/restart | New browser lost apply response then consumed-session recovery; recovery across newly constructed PostgreSQL store; retained durable financial journal/reconciliation tests |
| No channel bypass | Retained channel/MCP boundary tests, owner-page fresh simulation/Review gates, no panel iframe account/sign/send and no spend after proof/load |
| Token/model privacy | Tool text/structured result assertions, UI metadata tests, deep-link path/query privacy tests and hostile extra progress-field browser fixture |

## Live acceptance and status

The code and automated evidence are for owner review. Real ChatGPT/Claude App rendering, provider webhooks/messages and MetaMask/Phantom desktop/mobile behavior were not exercised here. Named host fixtures do not prove vendor compatibility. No live completion is claimed.

`READY_FOR_OWNER_E2E` is deployment/channel-specific and requires the actual OAuth/provider/host/wallet setup listed in the runbook. Those prerequisites were not established by this local BUILD. WhatsApp additionally remains blocked by the existing `WHATSAPP_POLICY_CLEARANCE` activation guard. `VERIFIED_COMPLETION` requires owner-run live testnet signatures, reconciliation evidence and status in each original conversation.

## Validation limitations and corrected failures

Initial sandbox runs could not use the package cache, loopback PostgreSQL/listeners or download build fonts; their required checks were rerun with tool approval. An early PostgreSQL run had obsolete expectations for private MCP links and Phantom's old domain; those tests now explicitly consume UI metadata and preserve state/security assertions. Running resource-heavy suites concurrently also caused migration/test timeouts; final normal and PostgreSQL suites ran sequentially with existing production timeouts.

An early combined browser invocation exposed fixture issues (a host constant outside the page evaluation scope and the Next.js route announcer matching a generic alert selector). These were corrected. Combining additional OAuth browser suites hit the existing per-IP registration limit; the new suite has a separate disposable-database CI invocation. No production rate limit was relaxed. The longer two-host interruption journey has a dedicated 90-second test budget.

The isolated reopen test also exposed a same-tab history navigation case that left the approval closed. The shared page now listens for `popstate` as well as `hashchange`. Both named host fixtures pass close/reopen, a lost apply response, consumed-session recovery and zero-spend checks against the rebuilt production app.

The retained EVM/Solana/lending regression suite then exposed history presenting the same consumed fragment again and discarding its recovery hint. The hint is now retained only for the same presented link; a different link clears it. The new browser journey explicitly checks that a different link cannot inherit a previous proposal's recovery hint.

## Resumed final validation (2026-10-09)

The resumed session retained the existing branch and changes at `fefda24`; no new branch/worktree or merge was made. The three previous `/tmp` log paths supplied at handover were absent. The interrupted production build reported in handover (SIGTERM/143) was not counted as a pass. Retained Playwright error contexts showed `HANDOFF_NOT_FOUND` after reload, including lending composition. A fresh production build completed with exit 0, and all 21 MCP in-chat/route tests passed, including EVM, Solana and supply → borrow → swap recovery with MOCKED execution blocked.

An additional same-document browser regression reproduced a delayed apply response restoring the old proposal after a different fragment had already cleared its recovery hint. Apply, retry, sharing and error completions now check the current approval generation before updating the page. In-flight apply tracking is scoped to that generation. The regression holds the successful server response, changes the fragment, then releases the response and requires no old proposal or workspace to appear. No server authorization, financial gate or production timeout was relaxed.

The previous local PostgreSQL container was absent; resumed tests use disposable databases on the existing loopback PostgreSQL service at port 56450. The Anvil binary matches the repository's approved SHA-256/version, and the installed browser is headless-shell revision 1243. All results in the automated-validation table were confirmed in the resumed session, including 61 final browser tests. Heavy suites ran sequentially. The sandbox again prevented the Next.js TypeScript subprocess output and loopback listeners; permitted reruns passed without changing gates.

Local retained logs: `/tmp/flofi-channel-signing-final-check.log`, `/tmp/flofi-channel-signing-final-postgres.log`, `/tmp/flofi-channel-signing-final-fork.log`, `/tmp/flofi-channel-signing-final-offline-f1.json`, and `/tmp/flofi-channel-signing-final-browser-{signing,mcp,developer,channels,review-execute}.log`. The intentional pre-fix isolation failure is in `/tmp/flofi-channel-signing-delayed-apply-before.log`. Temporary logs are local supporting artifacts; the committed report records the results independently of their continued availability.

Delivery status: `READY_FOR_OWNER_REVIEW`. Live host/provider/wallet acceptance and WhatsApp clearance remain the separate dependencies described above. No public transaction, deployment or merge was performed.
