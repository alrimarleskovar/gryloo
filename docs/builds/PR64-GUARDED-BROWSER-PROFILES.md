# PR #64 guarded engineering browser profiles

The release gate runs `node scripts/guarded-release-browser.mjs product` and,
after the existing pinned BUILD-007 harness and contract fork tests,
`node scripts/guarded-release-browser.mjs composition`. Local verification and
GitHub use these same commands, profile environment values, pinned Chromium,
network guard, production build, and assertions. Only the isolated app port,
local database port, and absolute cache/runtime paths differ between machines.

Production Review deliberately rejects MOCKED financial simulations. A browser
test that expects a MOCKED simulation to authorize and execute cannot certify
the approved product. The former positive financial specs remain in the repo
as engineering diagnostics, with their assertions intact; they are not reported
as passing release coverage. They have no new skips, fixmes, ignored assertions,
or directory exclusions. This changes engineering profile selection, not the
supported product, provider truth, authorization, Manifest, or deployment scope.

| Existing engineering profile / diagnostic specs | Required browser coverage | Required lifecycle coverage |
| --- | --- | --- |
| Supply, Supply recovery, Borrow, Repay, Withdraw, Ethereum Sepolia Supply | `release-provenance.spec.ts`: five current authoring/simulation paths, exact amounts/chains/assets, disabled shared Review/Execute, zero sends and no Evidence across reload. Original unsafe Borrow and insufficient Repay simulation cases also run unchanged. | Full compiler/executor/reconciler and app Supply/lending service suites in `pnpm test`; relevant PostgreSQL persistence suites. |
| Lending composition | `release-financial-provenance.spec.ts`, `lending`: atomic three-action graph, economic bounds, MOCKED rejection, zero requests across reload. | Lending composition compiler/executor/reconciler/service tests; composed cloud PostgreSQL recovery, intent identity and tenant isolation. |
| Jupiter, Solana Devnet swap, Solana liquidity | Same spec, `jupiter`, `solana-devnet`, `solana-liquidity`: correct quote chain, minimum output or exact ticks/contribution, MOCKED rejection, zero signatures/broadcasts across reload. | Jupiter and Orca compiler/executor/reconciler/service tests, including exact signed message, chain binding, expiry, uncertainty and no replay. |
| Robinhood transfer, Ethereum Sepolia transfer | Same spec, `transfer`: both chains/amounts, MOCKED rejection, zero wallet requests and no change in harness broadcasts. | Native transfer service/compiler/executor/reconciler tests and backend tests. |
| Uniswap liquidity | Same spec, `uniswap`: exact approval amounts, ticks and owner recipient; shared Review refuses authority. | Uniswap liquidity full-journey, restart, duplicate, ambiguous response, replacement, deadline and independent receipt tests. |
| Router, Journey | Same spec, `router`, `journey`: real UI authoring, provider route steps and minimum received; MOCKED cannot authorize a bridge or claim Evidence. | Router quote/simulation/observation distinctions, recipient binding, exact transactions, in-flight/recovery and wallet-session/privacy service tests. |
| Cloud runtime | Same spec, `cloud`: embedded runtime on a freshly migrated disposable loopback PostgreSQL database, MOCKED simulation persisted with no attempts, no claimed reconciliation, zero sends across reload. | Mandatory full PostgreSQL suite tests actual durability, concurrency, restart, completed-step preservation and tenant isolation. |
| Mode A synthetic fork | `release-fork-provenance.spec.ts`: both swap directions, exact browser verification, MOCKED rejection, exact prepared payloads, zero requested transactions, empty pending pool and no submission-attempt journal files. | Existing mandatory Anvil compatibility and frozen offline fork/compiler/executor/reconciler gates. |
| BUILD-007 delegated composition | `release-composition-provenance.spec.ts`: current contextual authoring, exact preparation from the pinned FORK_REPRODUCED local source, Manifest and shared Review required, explicit Review neither fabricates installed delegated authority nor signs/installs/executes; Execute stays blocked and reload invalidates authority; passive wallet only. | Existing three digest-pinned composition fork contract suites remain mandatory. |
| CoW loopback | Existing `cow-intent.spec.ts` and `cow-recovery.spec.ts`, unchanged; supported local signed-order and recovery coverage. | Existing CoW service/executor/reconciler suites. |
| Legacy Mode B browser diagnostics | Original `mode-b-adversarial.spec.ts` / `mode-b-fork.spec.ts` require a separately configured pinned profile. They previously contributed four declared skips to the default CI invocation. They remain independently runnable. | Mandatory delegated policy, compiler, executor and composition fork tests; shared Review/Execute component/browser safety checks. |

The direct Across, BUILD-009 and cross-chain composition default browser tests
now check the current visible product boundary. Direct demo lifecycle assertions
remain enforced by `across-service.test.ts`, executor Across tests,
`build009-run.test.ts`, `cross-chain-liquidity-action.test.ts` and cross-chain
compiler/executor/reconciler tests. These browser tests do not fabricate a
completed bridge, recovery state, NFT, financial fee, transaction hash or Evidence.

The default guarded product profile preserves the current observation,
canvas, keyboard, authoring, capability, interface honesty, network isolation
and strict screenshot checks, and adds contextual proposal checks. Existing
Review/Execute/recovery browser component suites exercise authorization expiry,
binding invalidation, explicit action, duplicate requests, completed steps,
truthful partial outcomes and evidence with isolated component fixtures. These
are engineering component tests, not live provider or deployed wallet acceptance.

No local or CI result is owner product acceptance. `https://flofi.xyz`
Testnet/Devnet acceptance is **PENDING OWNER TEST**. Mainnet acceptance is
**PENDING AFTER TESTNET PASS**. Historical financial diagnostic failures and
unrun positive cases remain historical failures/unrun cases in the certification
reports; passing this engineering release gate does not turn them into passes.
