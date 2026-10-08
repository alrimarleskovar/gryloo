# Acceptance fixes 001

Recovery starts from `f2881e3` in the existing `codex/acceptance-fixes-001` worktree. The uncommitted implementation was retained and completed.

## Product behavior and causes

| Issue | Cause | Completed behavior |
| --- | --- | --- |
| 1: internal journey panel | Router diagnostics also rendered a full tutorial in normal Build | Remove that entire block, including its controls and spacing; keep header wallet, proof infrastructure, bridge runtime and evidence |
| 2: EN/PT | Settings changed a label without one complete presentation catalog; the broad audit mixed literals, technical values and messages | Central persistent locale provider and catalogs cover product messages, accessibility labels, lifecycle errors and empty states; token/network/protocol names, user workflow names and technical values remain unchanged |
| 3: wallet identity | A network label also described the wallet | EVM Default / Solana Default identities are separate from environment and actual provider network |
| 4: provider synchronization | An asynchronous connect could commit older accounts/chain after a provider event | Passive initial reads plus events, provider identity/generation/event epoch guards, verified post-switch chain reads; identity changes permanently invalidate old Review |
| 5: simulation binding | Public swap used an ad-hoc hash instead of the domain-separated contract projection | All public-swap quote creation, simulation display and Review/begin validation use `hashArtifactBytes('semantic-workflow', ...)`; economic/revision changes invalidate binding |
| 6: Build estimate | Destination cards had no read-only provider path | Debounced, cancellable, expiring canonical-bound estimates from existing adapters; drafts and semantic edits invalidate prior results; no runs, Review, signatures or financial authority |
| 7: Save | No durable owner-scoped canonical document | Verified-session BFF, PostgreSQL CAS persistence, migration 0008, strict canonical validation and owner/namespace/tenant isolation |
| 8: Your workflows | Unfinished library was placed directly in navigation; earlier Dashboard requirement was superseded | Registry navigation item opens `/app/workflows`, using the existing secondary workspace model; page owns all library states; saved/executed identities merge once; reopen returns to Build without prior quote/Review authority |

New draft IDs are generated once per server request and serialized to the persistent provider hierarchy, avoiding duplicate identities across independent visits and server/client disagreement.

The audit's “557 missing” was a collection of missing call literals/templates, not 557 proven untranslated product labels. Real lifecycle/provider messages were translated. The remaining reviewed literals are explicitly inventoried in `preserved-values.ts`. The product catalog test scans actual translation calls, excludes tests, checks placeholders and requires either a translation or a reviewed preserved value. A separate JSX audit found no unwrapped literal UI text/accessibility strings.

## Persistence and API

Migration `0008_saved_workflows.sql` adds owner-scoped canonical documents: tenant, owner namespace/account, workflow ID, display name, canonical IR, semantic revision, canonical hash, optimistic version and timestamps. Renaming increments persistence version without changing semantic revision. Existing migration ordering is preserved.

The session-verified server action exposes list/get/save through the existing backend `/v1/workflows/{list,get,save}` paths. A client address is only a selection hint; verified server principal and existing authenticated backend boundary determine access. Saved and executed records group by canonical workflow ID; execution-only entries require recoverable, validated canonical data. Runs/evidence remain in Dashboard. Build reads use `/api/build-estimate` and create no durable execution record.

Only canonical authoring state is restored. Owner approvals, simulation/quote artifacts, transaction permissions and signatures are never saved in workflow documents. Cross-chain destination reconciliation, unknown submission recovery and exact account/chain checks remain enforced.

## Canvas and network capabilities

This matrix describes existing configured capabilities, not a claim that public transactions were performed in this acceptance run. “Implemented” recovery/evidence means the existing service and tests cover it. All configured execution still requires fresh Simulate, Strategy Manifest/Review and explicit owner wallet action. Disabled deployments stay fail-closed.

| Action | Network | Canvas authoring | Build read/estimate | Simulate | Review | Owner execution capability | Recovery | Evidence | Current limitation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Swap, Uniswap | Base Sepolia | CANVAS_READY | READ_ONLY estimate | SIMULATE_REVIEW_READY | Canonical quote binding | TESTNET_EXECUTION_READY | Implemented | Implemented | Frozen supported USDC/WETH profile; live RPC/runtime needed |
| Swap, Uniswap | Ethereum Sepolia | CANVAS_READY | READ_ONLY estimate | SIMULATE_REVIEW_READY | Canonical quote binding | TESTNET_EXECUTION_READY | Implemented | Implemented | Frozen supported USDC/WETH profile; live RPC/runtime needed |
| Swap, Uniswap | Base | CANVAS_READY | READ_ONLY live estimate in existing development observation mode | Local fork; production observation only | Local fork only | EXECUTION_DISABLED on mainnet | Local fork | Local fork | No registered direct Uniswap MAINNET execution row; production live observation restriction preserved |
| Swap, Jupiter | Solana mainnet-beta | CANVAS_READY | READ_ONLY Jupiter provider | SIMULATE_REVIEW_READY | Bound quote/owner/network | MAINNET_OWNER_GATED | Implemented | Implemented | Existing Jupiter live/API setup and explicit owner-execution opt-in required |
| Swap, Orca | Solana Devnet | CANVAS_READY | READ_ONLY RPC simulation estimate | SIMULATE_REVIEW_READY | Bound quote/owner/network | TESTNET_EXECUTION_READY | Implemented | Implemented | Frozen supported SOL/devUSDC profile and live runtime required |
| Bridge, router | Base Sepolia → Arbitrum Sepolia | CANVAS_READY | Route estimate at Simulate | SIMULATE_REVIEW_READY | Canonical route Manifest | TESTNET_EXECUTION_READY | Destination reconcile/refund | Implemented | Supported direction/profile only; two chains are not globally atomic |
| Bridge, router | Base → Arbitrum One | CANVAS_READY | Route estimate at Simulate | SIMULATE_REVIEW_READY | Canonical route Manifest | MAINNET_OWNER_GATED | Destination reconcile/refund | Implemented | Existing live router plus explicit owner-execution opt-in required |
| Pool / liquidity, Uniswap | Base Sepolia | CANVAS_READY | Amount/range authoring; no swap estimate | SIMULATE_REVIEW_READY | Exact contributions/ticks/recipient | TESTNET_EXECUTION_READY | Implemented | Implemented | Frozen pool, existing live liquidity runtime and verified state required |
| Pool / liquidity, Uniswap | Ethereum Sepolia | CANVAS_READY | Amount/range authoring; no swap estimate | SIMULATE_REVIEW_READY | Exact contributions/ticks/recipient | TESTNET_EXECUTION_READY | Implemented | Implemented | Frozen pool, existing live liquidity runtime and verified state required |
| Pool / liquidity, Uniswap | Base | CANVAS_READY | Existing range authoring | Local fork only | Local fork only | EXECUTION_DISABLED on mainnet | Local fork | Local fork | Legacy LOCAL_FORK capability; no public MAINNET row |
| Pool / liquidity, Orca | Solana Devnet | CANVAS_READY | Amount/range authoring | SIMULATE_REVIEW_READY | Exact ticks/contributions | TESTNET_EXECUTION_READY | Implemented | Implemented | Frozen SOL/devUSDC pool and existing live runtime required |
| Supply, Aave | Base Sepolia; Ethereum Sepolia | CANVAS_READY | Amount authoring | SIMULATE_REVIEW_READY | Exact principal | TESTNET_EXECUTION_READY | Implemented | Implemented | USDC on Base Sepolia; WBTC on Ethereum Sepolia; live runtime and verified account state |
| Borrow, Aave | Base Sepolia; Ethereum Sepolia | CANVAS_READY | Amount authoring | SIMULATE_REVIEW_READY | Debt/collateral constraints | TESTNET_EXECUTION_READY | Implemented | Implemented | Existing collateral, safe health factor and provider simulation required |
| Repay, Aave | Base Sepolia; Ethereum Sepolia | CANVAS_READY | Amount authoring | SIMULATE_REVIEW_READY | Exact repayment | TESTNET_EXECUTION_READY | Implemented | Implemented | Existing debt and principal checks required |
| Withdraw, Aave | Base Sepolia; Ethereum Sepolia | CANVAS_READY | Amount authoring | SIMULATE_REVIEW_READY | Exact withdrawal | TESTNET_EXECUTION_READY | Implemented | Implemented | Supply balance and post-withdraw health constraints required |
| Lending composition: Supply → Borrow → Swap | Base Sepolia | CANVAS_READY | Individual Canvas node inspectors | SIMULATE_REVIEW_READY | Shared OUTPUT_REFERENCE, HF ≥ 2 | TESTNET_EXECUTION_READY | Partial failure/debt recovery | Implemented | Existing sequential provider simulation and runtime required; no automatic rollback |
| Lending composition | Ethereum Sepolia | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | No registered composition profile |
| Swap / Pool / Supply / Borrow / Repay / Withdraw / lending composition | Ethereum Mainnet | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | Wallet chain detection supported; no registered action execution profiles |
| Swap / Pool / Supply / Borrow / Repay / Withdraw / lending composition | Arbitrum One; Arbitrum Sepolia | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | Incoming router bridge above is supported; no standalone profiles for these actions |
| Bridge / Pool / Supply / Borrow / Repay / Withdraw / lending composition | Solana mainnet-beta | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | Jupiter swap above is the registered mainnet action |
| Bridge / Supply / Borrow / Repay / Withdraw / lending composition | Solana Devnet | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | Registered Orca swap/liquidity above remain supported |
| All eight requested DeFi actions | Robinhood registered mainnet/testnet | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | NOT_SUPPORTED | Network/wallet profiles preserved; no registered DeFi deployments for these actions |
| Native self-transfer (separate existing capability) | Robinhood Testnet; Ethereum Sepolia | INTERNAL_FORM_REQUIRED | Native amount only | SIMULATE_REVIEW_READY | Exact native transfer | TESTNET_EXECUTION_READY | Implemented | Implemented | Advanced Action Setup remains necessary; normal Canvas parity would be a separate build |

Sources: action-registry execution capabilities and frozen profiles; crypto action picker and Canvas constructors; existing runtime capability gates and service/compiler tests. No network support was invented and no existing mainnet capability was removed.

## Verification and remaining owner acceptance

Focused tests and disposable PostgreSQL cover race safety, canonical binding, Review invalidation, estimates, strict durable documents, isolation and restoration. Browser acceptance uses synthetic loopback providers through real API/client paths; its prices and execution records are MOCKED engineering fixtures, never public financial evidence.

### Restack onto main 043ab01 and fixes found by the full gates

The branch was restacked onto `043ab01` (BUILD-DEVELOPER-001). Main already carried the identical Next.js 16.3.8 security patch, so this change no longer modifies `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` or `scripts/bootstrap-ci.py`. Main shipped migrations 0006 (`approval_requesters`) and 0007 (`developer_platform`), so saved workflows are migration **0008** with an unchanged file digest. The approval page keeps main's developer-link wording, translated through the catalog.

Running the complete CI browser gate on the restacked tree exposed three product regressions, now fixed:

- **Approval handoffs always mismatched.** Per-request draft identities meant an MCP or developer proposal (composed on the initial `workflow-local` draft) could never hash to its handoff (`HANDOFF_WORKFLOW_MISMATCH`). The claim now returns the composition's `workflowId`, and only an untouched revision-0 draft adopts it before the proposal is applied. The server's exact hash checks for apply and shared runs are unchanged.
- **Locking an amount crashed the page.** Browser-side `hashArtifactBytes` validated locked parameters with `node:util` `isDeepStrictEqual`, which the browser bundle lacks. `workflow-contracts` now uses a local strict structural comparison with the same semantics on JSON values.
- The local-fork technical row still said `Wallet:` rather than the EVM Default identity.

Test changes for owner review (none removed or skipped). Separate visits are now separate drafts, so the chat-vs-canvas artifact test compares the IR with the workflow ID substituted and the artifacts without identity-derived hashes; the R-5/R-6 tests still verify every hash. Golden screenshots mask only values derived from the per-visit identity (hash codes, retired hashes, the displayed Workflow IR, whose identity is asserted as text). Eight baselines were regenerated after per-image review: EVM Default header, network selector, `Simulate fees`, `USD value unavailable` and the masked rows. Three consecutive runs with fresh identities passed. Stale expectations were updated: seven drawer rows, and `Simulate fees` in developer-journey.

### Integration with HOTFIX-WALLET-SELECTOR (PR #67, main f46df0b)

PR #67 merged first. This change was restacked onto it, resolving each conflict rather than choosing one branch wholesale:

- **Wallet store:** PR #67's canonical selector (`connect` → selector → `connectWith`), provider identity and persistent "no silent reuse after Disconnect" are kept. This change's provider-identity/event-epoch guards, verified post-switch chain reads and stale-Connect protection wrap them. Passive reads and wallet events require both an active provider and `passiveReuseAllowed()`.
- **Review binding:** the bound identity is account, chain, wallet revision, workflow restoration epoch and PR #67's signing-provider key together.
- **Header and Credentials:** PR #67's provider mark, unified Connect/Disconnect, saved wallet references, cards and payment connections are kept. A connected but unsaved wallet is labeled **EVM Default** or **Solana Default**, with the provider shown beneath it; saved wallets keep their owner-chosen names. The header shows the session's actual chain; Solana mainnet reads "Solana mainnet-beta" everywhere.
- **Solana panels and approval proof:** PR #67's canonical selector replaces this change's per-panel wallet-choice buttons; the text stays translated.
- **EN/PT:** the wallet selector and the rebuilt Credentials page (wallets, cards, payment connections) are now in the catalog (`pt-wallets.ts`); wallet, provider and brand names stay untranslated.
- **Tests:** wallet-synchronization races open Connect through the selector. The provider-selection race is now the owner choosing another wallet mid-Connect, because an explicit choice pins its provider.

### Gate results (local, loopback only, private network namespace)

Final combined tree: main `f46df0b` (PR #67) plus this change.

| Gate | Result |
| --- | --- |
| `pnpm check` (typecheck, lint, build, schema drift, unit) | PASS: 274 files, 2857 tests; 2 files skipped by main's own environment conditions |
| `pnpm test:postgres` (disposable PostgreSQL 18.6, pinned digest) | PASS: 31 files, 188 tests (includes the 0007 → 0008 upgrade) |
| `pnpm test:anvil`, `pnpm test:fork`, F1 offline rehearsal | PASS: 4 + 31 tests (owner-only F2 cases skipped as in CI); F1 PASS 5/5 |
| `node scripts/guarded-release-browser.mjs product` | PASS: all 19 profiles, including `workflow-acceptance` (5), `swap-read-acceptance` (2) and PR #67's `card-provider-loopback` (5) |
| MCP route presentation, developer-journey, mcp-in-chat | PASS: 11, 1 and 21 tests |
| Composition fork suites + `guarded-release-browser.mjs composition` | PASS: 3 tests and 1 profile |
| `governance_lite.py` and its unittest suite; `bootstrap-ci.py --verify-dependencies`; `schemas:check` | PASS |

GitHub CI on the pull request is authoritative. All of the above is MOCKED/loopback engineering evidence.

The owner must still validate real extension wallets and public providers, configured deployments/migration rollout, testnet funding and gas, and personally perform any desired mainnet swaps/bridges through the normal owner-gated UI. This change does not claim MAINNET_EXECUTED or real-money financial acceptance.
