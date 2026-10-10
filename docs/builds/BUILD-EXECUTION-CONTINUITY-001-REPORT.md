# BUILD-EXECUTION-CONTINUITY-001 report

Date: 2026-10-10. Repository: `alrimarleskovar/gryloo`.
Branch: `codex/build-execution-continuity-001`.
Baseline: `7841d5657ec9a816140a180081178e2abbc27246` (PR #75).

The shared wallet now preserves Review across passive synchronization and
duplicate wallet events. Genuine authority transitions still permanently retire
the old Review. A confirmed approval can continue to the next unattempted swap
after another explicit owner action and wallet confirmation. Recovery reuses the
recorded run and its confirmed attempts.

Implementation and the listed local acceptance gates are complete.
Public-chain production acceptance requires the owner's reviewed wallet flow;
this report does not claim a live transaction or production deployment.

## Proven root cause

`review-authorization.ts` includes the shared wallet's `revision` in the identity
bound to the current simulation. On the baseline, `build009-wallet-store.tsx`
incremented that counter on every passive synchronization, account event, chain
event and connection completion. Its `accountsChanged` handler also cleared the
chain even when the account stayed identical. Those harmless events therefore
latched `wallet.changed`, made `projectReview().bindingValid` false and closed
`canContinueExecution()` after an already confirmed transaction.

The fix retains `revision` as a monotonic semantic authority epoch. A synchronous
ref compares the signing provider object, normalized account and normalized
chain before React can batch transitions. Only a real transition or explicit
disconnect advances the epoch. Separate `generation` and `events` counters still
reject stale asynchronous reads. Duplicate account events keep the known chain.
Discovery refining the same provider's public display key does not change
authority; replacing its object does, even with the same RDNS and address.

Two recovery defects compounded the problem for public swaps. Fresh quotes reuse
the same execution ID, so the old binding's wallet-change latch survived a
successful `/refresh`. Review readiness also required zero attempts, which
prevented reviewing a refreshed quote after a confirmed approval. Public Review
now binds to execution ID **and Manifest hash**, and fresh Review is eligible
only before any attempt or after confirmed approval attempts. The refreshed
quote clears acceptance, so old approval authority is never revived.

A reload also left the editor on its initial mock template. Recovery now restores
the recorded canonical workflow only over the untouched initial template. An
owner edit or an already open workflow takes precedence. Recovery remains
observation-only until fresh simulation and explicit Review; that simulation
refreshes the existing run instead of preparing another approval.

The owner's supplied `CONFIRMED / has_evidence=false` example is consistent with
an approval-only intermediate run. An HTTP 200 from `/refresh` proves that the
refresh request succeeded; it does not establish that the client accepted the
new Review or requested the swap. The supplied production run was not modified
or independently replayed during this build.

## Red/green regression proof

The original focused wallet regression failed on the baseline before the fix.
The final regression files were also copied into a separate `git archive` of the
exact baseline, using the installed dependencies and unchanged package builds.
No production patch was included in that archive. This command selected the
three decisive assertions:

```sh
vitest run \
  apps/reference-dapp/src/state/wallet-review-continuity.test.tsx \
  apps/reference-dapp/src/state/review-authorization.test.ts \
  --maxWorkers=2 \
  --testNamePattern 'preserves accepted Review across|preserves consumed Review binding|allows Review of a refreshed public quote'
```

| Baseline assertion | Observed failure |
| --- | --- |
| Passive synchronization preserves accepted Review | `bindingValid`: expected `true`, received `false` |
| Synchronization preserves next-request eligibility | `canContinueExecution`: expected `true`, received `false` |
| Fresh quote on the same run can receive new Review | `wallet.changed`: expected `false`, received `true` |

Baseline result: **3 assertion failures**, 20 unselected tests. The same three
files on the fixed tree pass **28 tests**; no regression is skipped.

## Required proofs

| Requirement | Test and result |
| --- | --- |
| A. Passive identity stability | Real shared provider + Review hook: repeated `session()` / `eth_accounts` / `eth_chainId`, `connect`, identical account and chain events, canonical chain spelling and same-object discovery refinement preserve the epoch and binding |
| B. Genuine changes | Account, chain and provider transitions, provider replacement with identical RDNS, EIP-1193 disconnect and FloFi reset revoke Review. Account/chain round trips occur before a render; disconnect/reset reconnect to the same address. Rereading the old identity does not revive Review; a new simulation binding is required |
| Workflow/Manifest/policy/expiry | Restoration and expiration remain covered in the new wallet suite. Existing Review/execution presentation tests retain exact workflow/hash, invalid Manifest, changed/invalid policy, stale runtime, wrong network and click-time expiry guards |
| C. Base Sepolia approval → swap | Chromium + production Next build + real server actions + embedded API + disposable PostgreSQL; scripted MetaMask provider and HTTPS loopback chain. Approval confirmation, duplicate events, explicit continuation and a separate second confirmation produce two confirmed attempts and reconciled evidence |
| D. No duplicates | Stage navigation and rerenders keep one approval; two same-turn continuation clicks produce one next request. Reload after approval restores the same run, refreshes its quote and submits only the swap. Lost second wallet response remains `UNKNOWN` across sync/reload with no continuation/retry CTA and no third send |
| E. Router/Bridge | Shared wallet hook + Base Sepolia → Arbitrum Sepolia router service/harness: confirmed approval, harmless sync, recovered service, explicit deposit, destination reconciliation and `MOCKED` evidence; exactly two sends. A repeated begin while the next attempt is active is refused |
| F. Aave lending | Shared Review + lending service/harness: `POOL_APPROVAL → SUPPLY → BORROW → ROUTER_APPROVAL → SWAP`, each explicitly begun/reported, with harmless synchronization and fresh service instances between steps; five sends, completed/reconciled `MOCKED` evidence, no replay |

The swap browser test asserts the intermediate database state
`CONFIRMED / has_evidence=false`, then the final state
`RECONCILED / has_evidence=true`, with exactly `APPROVAL` and `SWAP` attempts.
It reads the append-only durable log, validates the evidence schema and content
hash, and checks input spent `1000000`, output received `500000000000000`, and
remaining allowance `0`. The UI shows both transaction references and restores
the saved result after reload. The separate worker archive is asynchronous;
PostgreSQL runtime tests cover its persistence and verification.

All financial proof here is synthetic/local. The unchanged public-swap service
labels its bundle `TESTNET_EXECUTED` because it uses the public profile; the test
replaces that profile's RPC with a closed loopback fixture. This is engineering
evidence, not a public-chain execution claim. Router and lending retain honest
`MOCKED` provenance; their fixtures receive no product UI execution authority.

## Gates

Toolchain: Node `24.21.0`, pnpm `11.22.0`; dependencies and lockfile unchanged.

| Gate | Result |
| --- | --- |
| New focused regressions | PASS — 3 files, 28 tests |
| Existing lifecycle/recovery/service suite | PASS — 20 files, 350 tests |
| `pnpm test` | PASS — 297 files / 3040 tests; 2 pre-existing optional fixture tests skipped, not counted as passes |
| `pnpm typecheck` | PASS — all 16 tasks |
| `pnpm lint` and guarded-runner ESLint | PASS |
| `pnpm build` | PASS — all 9 tasks |
| `pnpm schemas:check` | PASS — 11 exports |
| Chromium execution continuity | PASS — all 3 scenarios, 1.6 min |
| Existing Review/Execute browser suites | PASS — 39 tests |
| Wallet environment browser suite | PASS — 5 tests |
| Wallet selector and passive provider routing | PASS — 10 tests (7 selector, 3 provider routing) |
| Lending provenance browser gate | PASS — MOCKED cannot grant Review or submit |
| `pnpm test:postgres` | PASS — 46 files / 302 tests |
| Governance-lite | PASS; 19 governance self-tests and 22 CI self-tests passed |
| `git diff --check` | PASS |
| GitHub Contracts / Governance | Required PR checks; final live results are recorded in the PR checks and delivery response |

Initial sandbox runs could not open loopback ports or execute required child
processes. The normal suites were rerun with approved host execution; their
assertions and gates were preserved. Browser iteration corrected selectors to
the existing interface and checked the public swap's actual stored `UNKNOWN`
state and durable bundle. No product copy or layout changed for the tests.

An additional exploratory combined browser run initially passed 49 of 57 tests.
Six provider diagnostics failed at setup because that invocation omitted the
mandatory lending fixture profile. Two selector tests expected header labels
that were already obsolete on the baseline. Three literal selector expectations
were updated to the current baseline; all seven selector tests and three passive
provider tests then passed under the correct fixture profile. No authority,
provider-selection or explicit-confirmation assertion was relaxed.

The three historical positive lending UI diagnostics are intentionally outside
the existing guarded release profiles: they expect `MOCKED` simulations to grant
production Review, which the unchanged provenance guard refuses. Their results
were reproduced under the correct profile: all three fail at the disabled Review
CTA with `A simulation that can authorize this workflow is required before
approval.` They are not counted as passes. The required lending provenance gate passed and proves
that mock simulations cannot authorize a wallet request; the new lending
continuity proof runs through the shared wallet hook and service harness.

## Exact changed files

Production behavior:

- `apps/reference-dapp/src/state/build009-wallet-store.tsx`
- `apps/reference-dapp/src/state/review-authorization.ts`
- `apps/reference-dapp/src/state/public-testnet-store.tsx`

Regression tests and isolated test infrastructure:

- `apps/reference-dapp/src/state/wallet-review-continuity.test.tsx`
- `apps/reference-dapp/src/state/review-authorization.test.ts`
- `apps/reference-dapp/src/state/public-testnet-store.test.tsx`
- `apps/reference-dapp/e2e/execution-continuity.spec.ts`
- `apps/reference-dapp/e2e/journey-fixtures.ts`
- `apps/reference-dapp/e2e/public-swap-read-serve.ts`
- `apps/reference-dapp/e2e/wallet-selector.spec.ts`
- `apps/reference-dapp/playwright.config.ts`
- `scripts/guarded-release-browser.mjs`

Build documentation:

- `docs/builds/BUILD-EXECUTION-CONTINUITY-001-PLAN.md`
- `docs/builds/BUILD-EXECUTION-CONTINUITY-001-REPORT.md`

The guarded browser runner adds one opt-in continuity profile and scrubs its
environment flag between profiles. It removes no existing gate. The synthetic
RPC refuses send methods; a separate opt-in `/control` endpoint mutates only the
local fixture after the test's explicit scripted owner confirmation.

## Delivery boundaries

No autonomous public-chain financial transaction, signing, broadcast or blind
retry was performed. Every next request still requires an explicit owner action
and wallet confirmation. UNKNOWN recovery semantics and submission locks remain
in force. No mainnet execution, key custody, production variable or migration
change was introduced. MCP execution remains disabled and wallet execution
stays inside FloFi.

No Automations-specific lifecycle patch or work from
`BUILD-CANVAS-AUTOMATION-UX-002` is included: no Canvas CTA redesign, internal
Automation approval redesign or Copilot automation authoring. No unrelated PR
was modified. This PR must remain unmerged until owner authorization.
