# BUILD-CANVAS-AUTOMATION-UX-002 — implementation and verification

Repository: `alrimarleskovar/gryloo`.
Branch: `codex/build-canvas-automation-ux-002`.
Baseline: `974a7acad6b117662d986254b9bc9e9be6e2a356`.
Scope: the five owner-approved Canvas/Automation UX goals, including removal of
normal Build compatibility forms and normal Simulate engineering clutter.

## Takeover and preservation

The interrupted session left HEAD at the baseline, with 91 modified tracked files
and 15 untracked paths. Nothing was staged. The existing plan was present; no
report existed. The complete staged/unstaged diffs and new source files were
inspected before edits. The inherited implementation already contained the
shared Canvas lifecycle projection, internal Automation handoff presentation,
typed chat drafts, compact authorization details and native-transfer authoring.

The takeover retained that implementation and the worktree/branch. No reset,
checkout, clean, pull, rebase or merge was performed. Read-only remote inspection
found main at the same baseline, with no published build branch or existing PR.
The pre-existing modified `scripts/__pycache__/test_governance_lite.cpython-314.pyc`
is deliberately preserved locally and excluded from the source commit.

Remaining problems resolved during takeover included Next's private-folder rule
for the engineering route (the route directory now uses `%5F_engineering`), chat
proposal buttons overflowing the chat scroll area, insufficient grounding of
network/USD threshold interpretations, request/check lock error handling, and a
completed saved execution incorrectly preventing authoring a new workflow.
Native transfer amount-only edits now use the existing reviewed transfer command
without requiring network reselection. Completed legacy records without their
canonical plan remain results and cannot be treated as a new workflow.
Browser fixtures were updated to use Canvas authoring or the explicitly gated
engineering harness, and approved surface changes received updated snapshots.

At the second account handoff on 2026-10-10, the current branch was still
`codex/build-canvas-automation-ux-002` and HEAD was still the original baseline.
There were no build commits and no staged files: 123 tracked files were modified
and 18 files were untracked (including both build documents). The full status,
unstaged/staged diffs, recent log, remotes, source and added tests were inspected
before editing. Read-only GitHub inspection again found main at the baseline,
no published build branch and no PR. This worktree remained authoritative.

The latest inherited guarded browser run had five failures. Two navigation-copy
expectations had already been corrected locally. The remaining three reproduced:
two fixtures lacked the passive wallet environment required by the existing
asset-selection policy, and the WETH selection used an incorrectly nested
Playwright locator. Those fixture corrections retained canonical workflow/hash
and zero financial wallet-request assertions; nine focused browser cases passed.
The second takeover also added the missing Portuguese Transfer review label,
checked it in the browser, and localized generated chat rule names using the
existing Automation catalog and the typed interpretation's language.
The full default browser profile then exposed one more migrated fixture: a
Robinhood mainnet wallet tried to select Base Sepolia, which the existing wallet
environment policy correctly excludes. The corrected case asserts that exclusion,
authors a Base swap and retains its zero switch/sign/send assertion.
Saved-workflow restoration and normal Simulate layout cases were also migrated
from the removed Review workspace to the compact disclosure and Canvas action.
The restoration case retains exact canonical persistence, owner isolation and
fresh-Review requirements; engineering artifact checks explicitly enter the
gated harness instead of expecting diagnostics on the normal product route.
The guarded runner now selects `e2e/automations.spec.ts` explicitly: Playwright's
substring matching otherwise also selected the new Copilot Automation file in
the non-Copilot profile. The chat suite retains its separate replay-only profile
and fail-closed replay requirement.

The finalization takeover again found HEAD at the original baseline, with no
BUILD-002 commits or staged files: 124 tracked modifications (including the
excluded Python cache) and 18 untracked source/document files. The requested
status, branch, HEAD, history, complete diffs and new files were audited before
changes. Features were treated as complete; finalization retained the existing
implementation and confined remaining changes to demonstrated acceptance
failures and documentation. Remote main remained at the baseline and no build
PR existed. No pull, rebase, reset, clean or merge was performed.

The fixture audit found only lifecycle-copy/action-location changes, removal of
normal engineering disclosures, explicit engineering-route migrations, Canvas
authoring/parity corrections, and Automation/chat assertions and replay cases.
The ten image changes reflect those approved surfaces. No unrelated fixture
change or UX redesign was retained. The modified tracked Python cache remains
local and is excluded from staging and the build commit. The generated local
`next-env.d.ts` development type-path change was excluded from the commit;
the closing production build regenerated its baseline contents. No local
generated cache or log is included.

The closing takeover found 128 modified tracked files, no staged files and 18
untracked entries, with HEAD still at the original baseline and no BUILD-002
commit or published PR. It preserved the worktree and treated features as
complete. Certification was restarted on the current tree after the latest
normal-header engineering guard fix, rather than counting earlier browser or
unit logs as proof of that change. A read-only GitHub check again found main at
the baseline and no build branch or PR.

The closing fixture audit removed unrelated estimate stubbing, fiat-size and
undo/redo assertion changes from the optional composer source/destination test;
its previous local version was preserved under `/tmp`. Only its required Canvas
CTA rename remains. No required release profile or CI test selection was
removed or weakened. The ten screenshot changes were compared against the
baseline: five observation/artifact engineering screenshots retain their
guarded diagnostics with the shared lifecycle; two swap authoring screenshots
remove Advanced setup/duplicate Review; three shell screenshots reflect the
shared Canvas and compact authorization disclosure. No bulk regeneration was
performed during closing certification. The final header guard additionally
required refreshing only the five existing normal-product swap/shell baselines;
their actual/diff images showed removal of the technical header and its vertical
space. The five engineering baselines were retained unchanged from the audited
implementation.

## One Canvas lifecycle

`projectCanvasAction` projects existing Review, execution, continuation and
recovery authority. `useExecutionControls` stays mounted across stages, so stage
navigation cannot clear a wallet request lock. `CanvasLifecycleAction` is the
shared primary action in Build, Simulate and Execute.

| State | Canvas action/result |
| --- | --- |
| Authored workflow, no current simulation | Simulate workflow |
| Simulation in flight | Simulating workflow… |
| Current validated simulation and Manifest Review ready | Approve & Continue |
| Accepted Review and existing runtime ready | Execute workflow |
| Explicit wallet request in progress | Waiting for wallet… |
| Reconciliation/check in progress | Reconciling… |
| Recoverable interrupted/uncertain recorded execution | Recover execution |
| Confirmed prefix with an unattempted suffix | Existing guarded continuation; fresh simulation/Review when required |
| Completed execution | Execution completed and result/evidence; no financial CTA |

Clicks re-project authority using the current clock. Existing Manifest/quote
binding, wallet/network checks, expiry, provenance checks, mainnet acknowledgement
and runtime guards remain in place. An unresolved saved run retains recovery
even when the editor changes. A completed run stays a result for its workflow;
an explicitly edited new workflow may start a fresh simulation.

The normal summary footer owns no lifecycle button. Normal Simulate renders
`ReviewAuthorizationDetails`, which contains no approval action. Normal Execute
also suppresses the lower primary action when Canvas owns it. The existing
Review and Execute component defaults remain available to focused harnesses.

Representative projection tests exercise public swap, Router/Bridge, Aave Supply
and Solana Devnet swap through Simulate → Approve & Continue → Execute workflow,
including expiry, waiting and reconciliation, with zero authority calls from
projection. Browser acceptance exercises both EVM public swap paths and the
durable local execution continuity path; specialized MOCKED profiles remain
blocked at the production financial authorization boundary.

## Internal Automation enters the normal Canvas

Only the server-resolved `AUTOMATION_RULE` requester uses compact internal
presentation. Choosing Review in FloFi is the owner's explicit load choice.
FloFi still resolves/claims the exact occurrence and handoff, verifies owner
proof, restores the canonical workflow through the existing invalidating editor
path and verifies its exact hash before exposing the normal workspace.

Occurrence ID, handoff/approval ID, requester identity, owner binding, canonical
workflow hash and audit records remain intact. A reload resumes the same applied
handoff without granting Review authority. Simulation, Manifest Review, approval
and wallet execution remain separate explicit actions. External requester kinds
retain the external proposal hero and explicit Load proposal experience.

`automations.spec.ts` checks the durable occurrence/handoff/workflow hash before
and after load/reload, absence of the external Automation hero, normal Canvas
simulation and approval, and zero wallet financial calls. External Developer,
MCP and channel suites verify the separate `/approve` experience.

## Chat Automation authoring

The model returns an untrusted, strictly parsed `AutomationDraft`, without
authority fields. Deterministic grounding requires the requested asset, side,
input amount/token, named network, time or USD threshold. Open clarification
answers may complete the active request; unrelated later requests cannot inherit
its fields. Missing material values produce clarification. Unsupported routes,
BTC trades, mismatched input assets and unavailable deployment capabilities fail
closed. Financial networks are never inferred from a missing network.

Grounded inputs pass the existing `validateAutomationInput` and `routeStrategy`.
The visible proposal shows schedule/timezone or crossing, asset, action, network,
slippage, per-execution spend and confirmation mode. ETH routes explain WETH;
enabled real-funds routes show their existing funds classification.

Only the explicit Create automation click calls the same owner-scoped
`createAutomation` action as the Automations workspace. Owner proof remains
required. There is no second backend, persistence shape or scheduler. Durable
rules remain `CONFIRM_EACH_TIME`. Dismiss calls no create action. Neither model
interpretation nor rule creation simulates financial execution, approves,
executes, signs a financial request or submits a financial transaction.

EN/PT DCA, EN price below/above, PT daily watch and missing-field/network/BTC
browser cases check the durable existing rule definition, explicit confirmation,
dismiss-with-no-rule, zero execution runs, unchanged workflow revision and zero
wallet sign/send calls during authoring. Unit cases additionally cover EN watch,
PT price crossing, invented amount/side/time/network, non-USD and absent price
units, wrong condition asset, unsupported network and clarification continuity.

## Advanced action setup capability audit

The entire compatibility form area is absent from normal Build. The original
forms were moved intact into `test-utils/engineering-authoring.tsx`; runtime,
recovery, reconciliation, evidence and canonical constructors were retained.

| Former form/capability | Normal product authoring and disposition |
| --- | --- |
| EVM USDC/WETH swap, both directions | CANVAS_READY: Swap card, network/asset picker, amount Review/Apply and inspector slippage; existing constructors |
| Jupiter/Solana mainnet swap | CANVAS_READY: Swap card's Solana profile; existing mainnet acknowledgement and capability guards |
| Orca/Solana Devnet swap | CANVAS_READY: Swap card's Devnet profile; no mainnet fallback |
| Router Base → Arbitrum | CANVAS_READY: Bridge card, routing/network settings and canonical Router workflow; deployment/execution restrictions preserved |
| Router Base Sepolia → Arbitrum Sepolia | CANVAS_READY: same Bridge card and testnet network selection |
| Aave Supply, Borrow, Repay, Withdraw | CANVAS_READY: individual cards and inspectors; Base Sepolia USDC/Ethereum Sepolia WBTC profiles preserved |
| Supply → Borrow → Swap | CANVAS_READY: existing composition toolbar proposal and contextual Review/Apply |
| Uniswap v3 testnet liquidity | CANVAS_READY: Pool card, contributions, range and inspector; existing Base/Ethereum Sepolia constructors |
| Orca Devnet liquidity | CANVAS_READY: Pool card's Solana Devnet profile, contributions/range and existing constructor |
| Robinhood Testnet/Ethereum Sepolia native self-transfer | Former INTERNAL_FORM_REQUIRED gap resolved: normal Transfer card, supported network picker, amount Review/Apply, editable inspector/history; same `CONNECTED_OWNER` self-transfer constructor |
| Direct Across deposit/fill/refund demo | Existing NOT_USER_FACING simulated demo; form retained in opted-in harness, real Across remains Router |
| Base → Optimism LI.FI bridge demo | Existing NOT_USER_FACING MOCKED execution demo; retained in harness |
| Base → Arbitrum → WETH bridge/swap demo | Existing NOT_USER_FACING MOCKED execution/reconciliation; retained in harness |
| Base → Arbitrum → Uniswap position / cross-chain liquidity | Existing NOT_USER_FACING MOCKED rehearsal; retained in harness |
| CoW signed-intent choice | Existing LOCAL_ONLY scripted orderbook, refused hosted; retained in harness with signature/recovery implementation |
| Base local-fork position / swap → position composition | Existing local rehearsal/Mode B capability, refused hosted; retained in harness with range, minima, recipient, recovery and evidence |

The local/demo classifications above come from the existing
`BUILD-CLOUD-PARITY-001-MATRIX.md`; this build does not promote them to financial
product authority. No supported public-product authoring capability was removed
merely to remove its form. Native transfers remain constrained to the two
already-supported test networks and the connected owner.

## Normal Simulate cleanup and engineering preservation

Normal Simulate contains the Canvas, expected result, route, fees, slippage,
warnings/limits and one Canvas lifecycle action. Its concise authorization
disclosure exposes wallet, network, permissions, maximum spend, slippage,
minimum received and expiry when available. Required warnings/provenance and
fail-closed limitations remain user visible.

It does not mount the duplicate Review workspace, raw Strategy Manifest JSON,
mocked artifact controls/state, Base observation panel, local fork diagnostics
or engineering badges. Manifest generation/binding, artifact/quote stores,
observations, simulation, reconciliation, evidence and CI harnesses remain.

`/__engineering` requires both `FLOFI_ENGINEERING_UI=LOOPBACK_ONLY` and a loopback
Host, and rejects Vercel, Railway and hosted deployment flags. Normal `/app`
does not render diagnostics even when the opt-in is set. The harness is absent
from product navigation. Its workflow probe is read-only and also gated.
Ten server guard unit cases cover opt-in, loopback/invalid hosts and hosted rejection. Three header cases additionally prove that even available fork status stays absent from normal Build/Simulate/Execute while opted-in engineering presentation remains usable.

Responsive browser checks at 1440, 768 and 390 pixels prove normal surface
absence, compact authorization information, CTA containment and no horizontal
overflow. Ten committed screenshot baselines reflect the approved removal and
Canvas action changes; branding, typography, colors and mascot were preserved.

## Verification

All financial acceptance uses disposable local infrastructure, synthetic RPC,
scripted test-wallet confirmations and closed replay transcripts. Browser guards
reject external HTTP/WebSocket requests. MOCKED financial observations are never
reported as public-chain authorization evidence. Existing opt-in skips are
reported separately and are not passes.

The closing `pnpm check` certified the final application/domain/runtime source.
Subsequent edits were confined to browser fixture expectations and the five
inspected normal-product screenshots. Fresh browser TypeScript and focused
fixture lint checks cover those edits. The guarded product certification uses
21 passing profiles plus the last two profiles resumed with CI's required
disposable CoW runtime setting; no application or shared fixture changed between
those profile runs. Later external fixture corrections affect only their own
profiles, which are rerun below.

| Gate | Result |
| --- | --- |
| Focused lifecycle, transfer, chat, Review/control/engineering and continuity unit checks | PASS; included in full suite |
| `pnpm check` | PASS on the closing tree: type checking, lint, build, 11 exported schemas; 3091 unit tests passed, 2 existing opt-in tests skipped |
| Final browser-test type checking and lint | PASS |
| `pnpm test:postgres` on local disposable PostgreSQL | PASS: 302 tests, 46 files |
| `pnpm test:anvil` with approved Anvil 1.8.3 | PASS: 4 tests; 10 existing opt-in tests skipped |
| `pnpm test:fork` offline CI profile | PASS: 31 tests; 29 existing opt-in tests skipped |
| Closed composition compiler/executor/reconciler fork checks | PASS: 3 tests, 3 files |
| Offline F1 rehearsal | PASS: 5 fresh processes, 50 replay requests each |
| Closed Base/liquidity/composition transcript verification | PASS |
| Built reference-linter exported API and hashing self-check | PASS |
| Ephemeral CycloneDX 1.6 SBOM validation | PASS: 265 exact registry components, ten workspace manifests/importers and 16 reviewed exceptions |
| Locked dependency verification | PASS: 265 locked versions, integrity/release-age/license checks with existing approved exceptions |
| `pnpm audit --audit-level low` | PASS: no known vulnerabilities |
| Guarded product browser profiles | PASS: 23 profiles, 200 cases; 21 profiles plus the environment-only CoW/card resume |
| External Developer/MCP/channel `/approve` browser profiles | PASS: 41 cases across OAuth-off route, Developer SDK/webhooks, OAuth-on routes/MCP, signing, WhatsApp and Telegram; 18 unchanged MCP/route cases plus all three corrected exact reload cases |
| Additional Canvas/layout, numeric-entry and wallet profiles | PASS: 62 scoped cases, including 60 unchanged passing cases and the corrected exact Advanced Settings case plus the previously unrun Delete case |
| Composition provenance browser profile | PASS: one profile/case; shared Canvas approval reaches disabled Execute without connecting a financial wallet or installing delegated authority |
| Governance-lite, self-tests and diff checks | PASS: 19 governance self-tests, 22 CI self-tests, current-tree safety scan and whitespace checks |

The three BUILD-EXECUTION-CONTINUITY-001 production UI/API/durable browser cases
passed: confirmed approval survives harmless wallet sync before explicit swap;
reload recovers the same confirmed prefix and refreshes Review without resending
approval; a lost second wallet response stays uncertain across sync/reload and
never blindly retries. Full unit/PostgreSQL coverage also retains the prior
continuity authority/recovery regressions.

No autonomous financial transaction, public-chain transaction or production
environment change occurred. Scripted confirmations submit only to local
synthetic/offline test networks. SIWE/sign-in ownership proofs authorize no
financial transaction. No deployment, migration on production or merge is part
of this build.

## Finalization failure audit

| Exact case/gate | Expected versus actual; classification; smallest correction |
| --- | --- |
| Original five guarded failures (`execution-capabilities`, `interface-honesty`, `public-testnet`, `swap-authoring`, `mock-artifact-chain`) | Migrated Canvas/navigation and wallet/locator fixtures; the current cases plus Robinhood coverage pass in the 24-case focused run. No legacy UI was restored. |
| `release-financial-provenance.spec.ts`, cloud transfer | One SIMULATED record expected, two MOCKED/SIMULATED records with zero attempts observed. Stale fixture clicked Canvas Simulate and diagnostic Simulate again. Removed the redundant diagnostic click; exact cloud case passes, preserving durable provenance/no-send/no-reconciliation assertions. |
| `bridge-network-picker.spec.ts`, Light side pickers | Fiat unavailable label overlapped the token picker (right edge 669 versus picker x 536). Real Canvas presentation defect: allow that label to wrap within its existing column. Exact case passes against a fresh production build. |
| `bridge-network-picker.spec.ts`, wallet network changes | Legacy navigation-button expectation assumed Simulate enabled with no Router provider. New CTA performs simulation and correctly stays disabled. Fixture asserts that refusal plus available stage navigation, retaining exact network/draft/Review invalidation checks. |
| `canvas-action-setup.spec.ts`, unconfigured Swap | Stale fixture assumed zero unquoted output and a normal Advanced setup JSON reader; use the existing gated read-only IR probe, preserve unavailable output, exact atomic amount and rejected-edit assertions, and distinguish navigation from provider-backed simulation. Exact Swap case passes. |
| `canvas-navigator.spec.ts`, Light geometry | Stale fixture assumed the same navigator breakpoint in all stages; existing Simulate/Execute uses 1024 pixels to clear the additional Back to Build action, while Build uses 800. Assert each existing mode's exact width, centering and clearance, waiting for React Flow's resize state. The retry also exposed a real header guard gap: asynchronously loaded fork details leaked into normal Simulate. Propagate the already server-validated engineering flag to TopBar; normal headers omit the disclosure while the engineering route preserves it. Three stage-specific guard unit cases pass. |
| `canvas-navigator.spec.ts`, Light lending fit/drag | Stale fixture clicked Apply before opening the required visible proposal review. Use the existing explicit Review/Apply helper; exact fit/drag case passes with unchanged revision and graph assertions. |
| `card-amount-review.spec.ts`, Swap Review/Apply | Stale navigation CTA expectation enabled simulation without a Swap/Router provider. Assert accepted canonical authoring and available stage inspection separately from disabled provider-backed simulation; exact Swap case passes with zero financial wallet requests. |
| `simulate-cleanup.spec.ts`, Canvas CTA anchors | Stale normal technical-panel/artifact expectations; normal route now asserts complete absence and retains desktop/mobile placement. Artifact JSON, observations and fork tooling are verified after explicit engineering entry using native disclosure state. Exact case passes. |
| `simulate-product-workspace.spec.ts`, current workflow/read-only cards | Stale navigation click attempted unavailable provider-backed simulation. Use the stage navigation for honest unsimulated presentation; keep canonical amount, readonly cards, safety details, absent duplicate approval and zero wallet requests. Exact case passes. |
| `simulate-product-workspace.spec.ts`, anchors and failure presentation | Stale 60-pixel inset replaced with the shared Canvas's exact 12-pixel right anchor. The failure fixture was actually a successful MOCKED simulation; explicitly give the disposable fixture zero balance to exercise insufficient balance, preserving blocking warnings and disabled approval. Both exact cases pass. |
| `simulate-shell.spec.ts`, stage navigation | Stale legacy execution workspace and normal diagnostic assertions; verify the shared Canvas in Simulate/Execute, absent diagnostics, disabled MOCKED approval, preserved revision and accepted Build selection. Exact case passes. |
| `simulate-workflow-canvas.spec.ts`, lending projection | Stale direct Apply click and normal engineering disclosure; explicitly review/apply the authoring proposal, inspect via stage navigation and assert no normal technical controls. Exact case passes with unchanged graph, read-only behavior and zero sign/send requests. |
| `simulate-workflow-canvas.spec.ts`, edited artifacts and mobile lending | Stale normal diagnostic access and navigation-as-simulation clicks; enter guarded engineering explicitly, preserve artifact JSON, return to normal route and inspect revised cards via stage navigation. Responsive lending uses visible Review/Apply. All four projection cases pass. |
| `stage-workspace-layout.spec.ts`, Light standard | Stale last-button locator, unconditional Execute expectation and identical navigator breakpoint. Select the lifecycle button by its action attribute, navigate for inspection, assert exact existing breakpoint sizes/clearance and forbid enabled financial actions. Exact case and all six layout/theme variants pass. |
| `wallet-environment.spec.ts`, Solana connected environment | Stale connection through removed diagnostics. Connect explicitly through the normal wallet selector; normal technical panel remains absent. Both Devnet/mainnet header and Bridge cases pass without signing. |
| First parallel fork invocation | Fixed local RPC ports were occupied by browser fixtures; environment collision, no source defect. Repeated exact compiler cases and full offline fork gate sequentially; 19/31 passes respectively, with existing opt-in skips separate. |
| Closing `interface-honesty.spec.ts`, local-fork label | Stale expectation clicked normal-header engineering details after the guard correctly removed them. Assert normal absence, enter the explicitly gated route, retain every fork/Manifest/no-execution assertion. Exact case passes. |
| Closing swap/shell visual cases | Shared capture fixture required a normal fork badge. Check badges only on engineering routes and forbid normal technical headers. Inspected screenshot diffs show the removed header and its vertical space; refreshed only five existing normal baselines. All four exact cases pass without snapshot-update mode. |
| Closing `brand-ux-001.spec.ts`, 430px product entry | One immediate overflow assertion failed during concurrent unit/PostgreSQL/browser work; the unchanged exact case passes. No layout or fixture change was made for this non-reproduced failure. |
| Closing CoW profile | All nine cases refused to start because the local command omitted `GRYLOO_COW_RUNTIME`, which CI sets explicitly. Environment issue: supplied a disposable `/tmp` runtime and resumed the two remaining profiles. CoW's nine and card provider's five cases pass; the prior 21 green profiles retain identical source. |
| Closing Developer/MCP/channel simulation fixtures | Developer expected one prepared execution but observed two: Canvas Simulate and diagnostic Simulate were both clicked. Remove the redundant Router/lending invocation from Developer and the adjacent MCP/WhatsApp/Telegram fixtures, retaining durable status, webhook, no-reconciliation/evidence and zero financial-send assertions. |
| Closing MCP EVM/Solana/lending reload cases | Diagnostics had explicitly entered `/__engineering`, then the fixture reloaded that route while expecting the external hero. Fixture/harness issue: return to the original external approval URL for the full-document owner restoration check. All three exact cases pass with unchanged proof/load/fresh-Review and zero-send assertions; the other 18 MCP/route cases already passed on identical relevant source. |
| Closing Canvas Advanced Settings case | Stale direct Apply click bypassed the existing visible proposal review. The pre-audit backup confirmed this was inherited, not introduced by the fixture audit. Use the shared explicit Review/Apply helper. The exact case and the previously unrun Delete regression pass; the other 60 scoped cases already passed on identical relevant source. |
| Closing composition provenance case | Stale post-approval expectation looked for the removed lower `Review approved` button. Assert the disabled Canvas `Execute workflow` action; preserve zero wallet sends, explicit execution-wallet connection, delegated-authority refusal, recovery and no-evidence assertions. The exact browser case passes; three unchanged closed composition compiler/executor/reconciler cases pass separately. |

## Known limitations

An optional, non-release-gate `composer-product-cleanup.spec.ts` styling case
(`swap has quiet editable values and opens settings only explicitly`) expects
bold Outfit/negative tracking, whereas baseline and current CSS both specify
IBM Plex Mono, weight 500 and normal tracking. The extra run exposed that stale
baseline assertion; BUILD-002 does not change those fonts, weight or tracking.
It is not counted as a pass. Unrelated styling fixtures and typography were
preserved, consistent with the scope restriction. Required authoring/parity and
release browser profiles are certified in the verification table above.

The optional `workflow-composer.spec.ts` one-row toolbar case also has a stale
baseline assertion: baseline/current mobile CSS both wrap the primary and utility
groups below 800 pixels. After adding the approved Transfer action to its exact
action inventory, the test reaches that unchanged wrapping mismatch. It is not
counted as a pass. The existing mobile layout is preserved; normal Transfer
reachability and Canvas parity are checked independently.

The same optional file's source/destination styling/history case retains its
baseline assertions after removing unrelated churn. Its zero unquoted-output,
fiat-height and undo/redo assumptions are outside BUILD-002 certification; it
is not counted as a pass. The required guarded release profiles are unchanged,
and separate current Canvas authoring, history, numeric-entry and parity cases
cover the supported product behavior.

Chat browser certification uses closed EN/PT model replays; it does not certify
a live model/provider or authorize one. BTC remains observable without a trade
route. Supported trade routes remain subject to the deployment's existing
capabilities and owner proof. All executable rules remain `CONFIRM_EACH_TIME`.

Synthetic/MOCKED protocol profiles prove authoring, presentation and authority
refusal, not public-chain financial execution. Positive local continuity and
recovery use explicit scripted wallet confirmations on disposable infrastructure.
Owner-only live/public-chain and pinned-secret opt-in cases remain skipped where
reported; their skips are not passes. Local/demo capabilities in the parity
inventory remain confined to engineering purposes.

## Exact source change inventory

145 source/document files changed against the baseline. The inventory includes this report.

```text
apps/reference-dapp/e2e/acceptance-swap-read.spec.ts
apps/reference-dapp/e2e/acceptance-workflows.spec.ts
apps/reference-dapp/e2e/across.spec.ts
apps/reference-dapp/e2e/automations.spec.ts
apps/reference-dapp/e2e/base-observation.spec.ts
apps/reference-dapp/e2e/base-observation.spec.ts-snapshots/observation-expired-chromium-linux.png
apps/reference-dapp/e2e/base-observation.spec.ts-snapshots/observation-recorded-chromium-linux.png
apps/reference-dapp/e2e/borrow.spec.ts
apps/reference-dapp/e2e/brand-ux-001.spec.ts
apps/reference-dapp/e2e/bridge-network-picker.spec.ts
apps/reference-dapp/e2e/bridge.spec.ts
apps/reference-dapp/e2e/build-empty-mascot.spec.ts
apps/reference-dapp/e2e/build009.spec.ts
apps/reference-dapp/e2e/canvas-action-setup.spec.ts
apps/reference-dapp/e2e/canvas-automation-ux.spec.ts
apps/reference-dapp/e2e/canvas-cta.spec.ts
apps/reference-dapp/e2e/canvas-navigator.spec.ts
apps/reference-dapp/e2e/canvas-ux.spec.ts
apps/reference-dapp/e2e/card-amount-review.spec.ts
apps/reference-dapp/e2e/card-numeric-entry.spec.ts
apps/reference-dapp/e2e/ci-layout-diagnostic.spec.ts
apps/reference-dapp/e2e/composer-product-cleanup.spec.ts
apps/reference-dapp/e2e/composition-fixtures.ts
apps/reference-dapp/e2e/composition-fork.spec.ts
apps/reference-dapp/e2e/contextual-proposals.spec.ts
apps/reference-dapp/e2e/copilot-automations.spec.ts
apps/reference-dapp/e2e/copilot.spec.ts
apps/reference-dapp/e2e/copilot/replay-v2.json
apps/reference-dapp/e2e/cow-intent.spec.ts
apps/reference-dapp/e2e/cow-recovery.spec.ts
apps/reference-dapp/e2e/cross-chain-liquidity-recovery.spec.ts
apps/reference-dapp/e2e/cross-chain-liquidity.spec.ts
apps/reference-dapp/e2e/dashboard-foundation.spec.ts
apps/reference-dapp/e2e/developer-journey.spec.ts
apps/reference-dapp/e2e/ethereum-sepolia-transfer.spec.ts
apps/reference-dapp/e2e/execute-product-workspace.spec.ts
apps/reference-dapp/e2e/execute-workflow.spec.ts
apps/reference-dapp/e2e/execution-capabilities.spec.ts
apps/reference-dapp/e2e/execution-continuity.spec.ts
apps/reference-dapp/e2e/fixtures.ts
apps/reference-dapp/e2e/global-product-polish.spec.ts
apps/reference-dapp/e2e/interface-honesty.spec.ts
apps/reference-dapp/e2e/journey.spec.ts
apps/reference-dapp/e2e/jupiter-fixtures.ts
apps/reference-dapp/e2e/jupiter.spec.ts
apps/reference-dapp/e2e/lending-composition.spec.ts
apps/reference-dapp/e2e/liquidity-fork.spec.ts
apps/reference-dapp/e2e/liquidity-recovery.spec.ts
apps/reference-dapp/e2e/mcp-in-chat.spec.ts
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-current-chromium-linux.png
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-expired-chromium-linux.png
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-invalidated-chromium-linux.png
apps/reference-dapp/e2e/mode-a-adversarial.spec.ts
apps/reference-dapp/e2e/mode-a-fixtures.ts
apps/reference-dapp/e2e/mode-a-fork.spec.ts
apps/reference-dapp/e2e/mode-b-adversarial.spec.ts
apps/reference-dapp/e2e/mode-b-fork.spec.ts
apps/reference-dapp/e2e/product-typography-logo.spec.ts
apps/reference-dapp/e2e/public-testnet.spec.ts
apps/reference-dapp/e2e/release-composition-provenance.spec.ts
apps/reference-dapp/e2e/release-financial-provenance.spec.ts
apps/reference-dapp/e2e/release-fork-provenance.spec.ts
apps/reference-dapp/e2e/release-provenance.spec.ts
apps/reference-dapp/e2e/release-safety-fixtures.ts
apps/reference-dapp/e2e/repay.spec.ts
apps/reference-dapp/e2e/robinhood-network.spec.ts
apps/reference-dapp/e2e/robinhood-transfer.spec.ts
apps/reference-dapp/e2e/router.spec.ts
apps/reference-dapp/e2e/simulate-cleanup.spec.ts
apps/reference-dapp/e2e/simulate-product-workspace.spec.ts
apps/reference-dapp/e2e/simulate-shell.spec.ts
apps/reference-dapp/e2e/simulate-workflow-canvas.spec.ts
apps/reference-dapp/e2e/solana-devnet-fixtures.ts
apps/reference-dapp/e2e/solana-devnet.spec.ts
apps/reference-dapp/e2e/solana-liquidity.spec.ts
apps/reference-dapp/e2e/stage-workspace-layout.spec.ts
apps/reference-dapp/e2e/stocks-pool-authoring.spec.ts
apps/reference-dapp/e2e/supply-fixtures.ts
apps/reference-dapp/e2e/swap-authoring.spec.ts
apps/reference-dapp/e2e/swap-authoring.spec.ts-snapshots/proposal-chromium-linux.png
apps/reference-dapp/e2e/swap-authoring.spec.ts-snapshots/review-blocked-chromium-linux.png
apps/reference-dapp/e2e/telegram-approve.spec.ts
apps/reference-dapp/e2e/theme-amount-display.spec.ts
apps/reference-dapp/e2e/token-pill-containment.spec.ts
apps/reference-dapp/e2e/uniswap-liquidity.spec.ts
apps/reference-dapp/e2e/visual-shell.spec.ts
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/build-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/execute-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/simulate-chromium-linux.png
apps/reference-dapp/e2e/wallet-environment.spec.ts
apps/reference-dapp/e2e/wallet-provider.spec.ts
apps/reference-dapp/e2e/whatsapp-approve.spec.ts
apps/reference-dapp/e2e/withdraw.spec.ts
apps/reference-dapp/e2e/workflow-composer.spec.ts
apps/reference-dapp/playwright.config.ts
apps/reference-dapp/src/app/(product)/%5F_engineering/page.tsx
apps/reference-dapp/src/app/(product)/layout.tsx
apps/reference-dapp/src/app/globals.css
apps/reference-dapp/src/components/action-library.tsx
apps/reference-dapp/src/components/app-shell.tsx
apps/reference-dapp/src/components/approval-handoff.tsx
apps/reference-dapp/src/components/artifact-inspector.tsx
apps/reference-dapp/src/components/canvas-lifecycle-action.tsx
apps/reference-dapp/src/components/composer-card.tsx
apps/reference-dapp/src/components/copilot-ai.tsx
apps/reference-dapp/src/components/copilot-automation-proposal.tsx
apps/reference-dapp/src/components/copilot-panel.tsx
apps/reference-dapp/src/components/execute-workspace.test.tsx
apps/reference-dapp/src/components/execute-workspace.tsx
apps/reference-dapp/src/components/execution-timeline.tsx
apps/reference-dapp/src/components/product-shell.test.tsx
apps/reference-dapp/src/components/product-workspace.tsx
apps/reference-dapp/src/components/review-workspace.test.tsx
apps/reference-dapp/src/components/review-workspace.tsx
apps/reference-dapp/src/components/simulate-panel.tsx
apps/reference-dapp/src/components/simulate-workspace.tsx
apps/reference-dapp/src/components/summary-bar.tsx
apps/reference-dapp/src/components/top-bar.tsx
apps/reference-dapp/src/components/workflow-canvas.tsx
apps/reference-dapp/src/domain/canvas-action-setup.ts
apps/reference-dapp/src/domain/canvas-authoring.ts
apps/reference-dapp/src/domain/canvas-lifecycle.test.ts
apps/reference-dapp/src/domain/canvas-lifecycle.ts
apps/reference-dapp/src/domain/canvas-transfer.test.ts
apps/reference-dapp/src/domain/copilot-authoring.ts
apps/reference-dapp/src/domain/copilot-automation.test.ts
apps/reference-dapp/src/domain/copilot-automation.ts
apps/reference-dapp/src/domain/copilot-conversation.ts
apps/reference-dapp/src/domain/copilot-intent-v2.ts
apps/reference-dapp/src/domain/crypto-action-picker.ts
apps/reference-dapp/src/domain/editor-history.ts
apps/reference-dapp/src/domain/execution-lifecycle.ts
apps/reference-dapp/src/i18n/pt.ts
apps/reference-dapp/src/server/copilot-service.ts
apps/reference-dapp/src/server/engineering-ui.test.ts
apps/reference-dapp/src/server/engineering-ui.ts
apps/reference-dapp/src/state/execution-controls.test.ts
apps/reference-dapp/src/state/execution-controls.ts
apps/reference-dapp/src/test-utils/engineering-authoring.tsx
apps/reference-dapp/src/test-utils/engineering-probe.tsx
apps/reference-dapp/src/test-utils/execute-acceptance-harness.tsx
docs/builds/BUILD-CANVAS-AUTOMATION-UX-002-PLAN.md
docs/builds/BUILD-CANVAS-AUTOMATION-UX-002-REPORT.md
scripts/guarded-release-browser.mjs
```
