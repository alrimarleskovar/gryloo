# BUILD-006 report — isolated Uniswap v3 liquidity on a Base fork

**Status:** IMPLEMENTATION COMPLETE LOCALLY; owner-operated Base recording PENDING; not certified. **Authority:** DEC-0036 and the [approved BUILD-006 plan](BUILD-006-PLAN.md). **Baseline:** synchronized main and origin/main `4a402dd6be956fee0e3df001b8ad0f356f625937`. **Branch:** `codex/build-006-uniswap-liquidity`.

## Delivered implementation

The additive `asset.liquidity.uniswap-v3` action enters the existing chat/canvas Semantic Workflow IR as one isolated node. Immutable range and native-unit limits stay in the IR. Source pool state, quote, simulation, token ID, the exact Mode A payload, the attempt journal and evidence are separate artifacts.

The reference service runs on local chain 31337. Before compiling a payload it verifies:

- the factory-derived pool and five code pins;
- the Position Manager's factory and WETH relations;
- token order, fee and tick spacing.

It builds reviewed finite approvals and mint, increase, decrease, collect and eligible burn calls, each needing its own wallet signature. It persists every attempt before requesting the wallet and freezes unknown results. Recovery scans sender, nonce and raw signed bytes, then reconciles the receipt, ownership, position, token balances, allowances and observed fees. A canonical Execution Journal and an Evidence Bundle are written only with their actual environment label. BUILD-007 composition and Mode B liquidity are excluded.

A distinct read-only Base recorder and closed replay verifier implement the approved limits: one attempt, 1,500 requests, 39,000 reserved CU, 30 minutes and 400 ms single-flight spacing. The owner must operate the real recording after the offline dry run, pinned-tool preflight, a current Free-plan report and a fresh private credential. It involves no public-chain transaction, production wallet or real funds. A Base read alone supplies no transaction-outcome evidence.

### Accounts

The BUILD-003F disposable phrase was deliberately deleted after certification. BUILD-006 does not reuse or depend on it. `liquidity-recording.mjs prepare-accounts` generates BUILD-006's own disposable local accounts through a pipe-only Anvil generator inside an isolated network namespace. The phrase is written only to a mode-0600 file under `~/.gryloo/build-006/accounts/`, outside Git; only the public pins are printed.

| Item | Value |
|---|---|
| Public-pin SHA-256 | `5b4ac05fd5082cf0662e9f6dec1dbf1f5bf3808fe9e65662d6fd9b696b3fce23` |
| Owner (index 0) | `0xff942d9e1ebf47b1d963406798a2b9cc3cb1d6cb` |
| Setup (index 1) | `0x7561ee6c56c8f92c1094184ca7c64965ee3b83bd` |

The BUILD-003F public pins, certified transcript and runtime files are byte-identical.

The protected Mode A replay server reads the BUILD-003F account path. The owner-local browser acceptance therefore runs inside a private mount namespace, with the BUILD-006 account directory bind-mounted over that path for the test processes only. No file on disk changes, and the mount ends with the namespace.

## Defects found and corrected before recording

| Defect | Effect | Correction |
|---|---|---|
| The account generator expected a line break after `Mnemonic:`. The pinned Anvil prints the phrase on the same line. | `prepare-accounts` could never succeed. | Parser matches the real banner; the generator uses a temporary HOME. |
| `liquidity-service.test.ts` imported `@noble/curves` and `@noble/hashes`, which `reference-dapp` does not declare. They resolved only through a stray `/home/asus/node_modules`. | Typecheck fails with repository-confined resolution, as CI does. | The test signs through the declared `reference-executor` helper. |
| Node type stripping cannot resolve the app's extensionless relative imports. | `liquidity-service.ts` failed to load under Node, so the recording and replay lifecycle had never executed. | `liquidity-harness.mjs` registers a resolve hook scoped to existing `.ts` files inside `apps/reference-dapp/src`. |
| After a wallet request, including a lost response, the request button stayed enabled. | UI fail-open, although the server already refused a second attempt on a frozen or pending journal. | A prepared review is consumed by its first attempt; acceptance clears after any request. |
| The Copilot HELP string gained an invalid liquidity example. | Two protected zero-pixel visual baselines changed. | HELP is byte-identical to the baseline; the command grammar is unchanged. |
| The earlier dry run exercised only three proxy requests. | Weaker than the plan's offline dry-run gate. | Replaced by the full rehearsal below. |

## Offline dry run (`MOCKED` engineering evidence only)

The dry run builds a synthetic loopback chain-8453 source containing:

- the existing synthetic Base token, quoter and router set;
- the published Uniswap v3 factory and Position Manager creation code, pinned by SHA-256, installed at the Base addresses;
- a canonical pool, init-code hash `0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54`, seeded with separate full-range liquidity.

The complete lifecycle then runs through the real recording proxy with its loopback provider, on BUILD-006's accounts. The transcript is validated, and a closed replay runs with the source stopped.

Result: `COMPLETE`, then `REPLAY_BYTE_IDENTICAL`, with 122 synthetic proxy requests and 3,172 reserved synthetic CU. Twelve separately signed operations were each independently `RECONCILED`: WETH and USDC approvals, mint, WETH reset and re-approvals, increase, partial decrease, collect, full decrease, final collect and burn.

The Uniswap npm inputs are integrity-verified temporary files outside Git; see the [license map](../LICENSE_MAP.md). No provider request was made. This does not establish Base behaviour.

## Gates

| Gate | Result |
|---|---|
| `pnpm check` typecheck, lint, build and schema drift | Pass, with repository-confined module resolution in a loopback-only namespace. |
| Unit and compatibility suite | 388 passed, 1 skipped: the existing BUILD-004 Mode B service smoke, which needs an owner profile. This was a full serial run on the pre-commit tree. Earlier `pnpm check` runs on this host had 7–10 fsync-latency timeouts at 5 s, all in fsync-heavy tests. Most were in untouched BUILD-004/005 file-store, Mode B and CoW tests; the others were the two liquidity-service journal tests. One full run and every isolated rerun passed. This is recorded as host I/O jitter, not as a pass of those runs. |
| Governance (both workflow steps, extracted from the current workflow file) | Pass. |
| CI-equivalent browser suite, MOCKED synthetic fork | 29 passed and 4 skipped, then 13/13, then 9/9. The protected zero-pixel visual baselines pass unchanged. |
| Liquidity browser specs on the dry-run transcript (MOCKED) | 2/2: full lifecycle, and lost response → freeze → restart → exact-nonce scan → reconcile. |
| Offline dry run and closed replay | Pass (`MOCKED`), above. |
| Recorder preflight | Pending, after the final commit. |
| Owner-operated read-only Base recording and credential-free transcript | Pending. No BUILD-006 transcript exists. |
| Byte-identical chain-31337 replay of the Base transcript and independent reconciliation | Pending. Maximum target remains `FORK_REPRODUCED`. |
| Owner-local browser acceptance on the Base transcript | Pending. |
| Dependency audit and registry metadata checks | Not run locally; they need the network. |
| Remote push/PR checks, owner merge and post-merge checks | Not run. The owner retains merge and certification. |

Offline mocked checks establish at most `MOCKED` engineering evidence. BUILD-006 has no `FORK_REPRODUCED` result until the new transcript, byte-identical replay and independent lifecycle reconciliation all pass. The BUILD-003/004 certified fork results and the BUILD-005 certified mocked result are unchanged.

## Risks and recovery

Any of the following stops the affected operation:

- a missing deployment or pool;
- changed code, tick, allowance or owner;
- a stale review;
- inconsistent RPC;
- a reverted transaction;
- an unknown broadcast;
- a fee discrepancy.

A lost wallet response never causes a second send. The signed bytes and nonce must be found and independently read back, or the attempt stays frozen.

A failed recording consumes its one approved attempt. The session directory keeps credential-free stop evidence: the journal, the request log and any scenario results. Another attempt needs a new owner decision. Deleting a journal cannot roll back confirmed local effects. If final acceptance fails, the liquidity profile stays disabled and only the demonstrated evidence level is reported.
