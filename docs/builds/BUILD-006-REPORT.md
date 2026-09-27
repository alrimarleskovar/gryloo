# BUILD-006 report — isolated Uniswap v3 liquidity on a Base fork

**Status:** LOCAL ACCEPTANCE COMPLETE / READY FOR OWNER MERGE DECISION. `FORK_REPRODUCED` is demonstrated on local chain 31337; BUILD-006 is not certified. Remote PR CI, the owner's merge decision, post-merge checks and certification remain separate gates. **Authority:** DEC-0036 and the [approved BUILD-006 plan](BUILD-006-PLAN.md). **Baseline:** synchronized main and origin/main `4a402dd6be956fee0e3df001b8ad0f356f625937`. **Branch:** `codex/build-006-uniswap-liquidity`.

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

## Owner-operated read-only Base recording

The owner ran the single approved attempt on 2026-09-28. It was preceded by the final-bytes dry run and the preflight at commit `c670889e6fcfad990df072cd5f84e15252ea1e67`, with manifest digest `1e1e5b80eab226e43d51edfc5ff52c1609ba2cf1c3b5d6c8a1422e637095279c` over 77 pinned files, the pinned Node and Anvil, and the BUILD-006 account pins. The owner's wrapper pre-checks passed, and the recording completed within every cap. The attempt is spent; no further recording is authorized.

| Item | Value |
|---|---|
| Status | `COMPLETE`; proxy journal `COMPLETE`, no stop reason |
| Source block | Base 51,880,679, hash `0x0d14cd088d8bbdbfaea625f16ef852666d8545774621c67bbf00d6f48db532cc` |
| Provider requests / reserved CU | 207 / 5,382 of 1,500 / 39,000 |
| Credential | Wiped and removed by the recorder (`credentialFileRemoved: true`); it never entered the transcript, logs or this repository |
| Transcript | `apps/reference-dapp/e2e/fork/liquidity-transcript.json`, SHA-256 `c9a02102422df5a333d67bdf869a4f1b75ae2ec314d1e834872d92c86ea95805` |
| Scenario results | SHA-256 `dbfda0fa3e177aeac2800f2313b7e1cdfc36e2ad8050485d6d99d276006e8da0`, lifecycle `COMPLETE`, 12 steps |

The transcript pins the factory-derived Base USDC/WETH 0.05% pool `0xd0b53d9277642d899df5c87a3966a349a798f224` and five code hashes:

| Contract | Code SHA-256 |
|---|---|
| Pool | `0x0d14cff6e9be9c1cf4ff7a4856a44e5d17b8a92db7e1f41f2fb5e73ad8b5419a` |
| Position Manager | `0x54aa74382a5aade77e59efffb53208ca5c3d3a679daa2853881381e04b25c48d` |
| Factory | `0x8545609892cc8d7d608dd4420ee110ab98448730570824fb029228e33846d28c` |
| USDC | `0x98d785fcb1bf847f287adc2310759fd94cc13e754b974bc72131382e8266f607` |
| WETH | `0x667c900c2c6da80d452501a9c6332e046384a0c438c3334ce6f71c86dd7b8735` |

Base reads are `NOT_EVIDENCE` for transaction outcomes. Every transaction ran only on the local fork, and local funding is `LOCAL_SETUP_NOT_BASE_OBSERVED`.

## Closed replay and independent reconciliation

All of the following ran inside loopback-only network namespaces, with no credential, provider or external route.

1. **Static transcript validation, the CI gate.** Format, ordered requests, per-entry digests, counts and budget, and the identity hash bound to the BUILD-006 public pins all pass. The transcript contains no credential or authorization text.
2. **Closed replay (`replay-verify`).** Result `REPLAY_BYTE_IDENTICAL`; the scenario digest equals the recorded `dbfda0fa…e8da0`. The executor fork test's separate replay run also passed. All three BUILD-006 fork test files pass: 3/3, none skipped.
3. **Independent verifier.** The owner-local script is outside Git, SHA-256 `66fa48f93364184cd4fc5957b68b58d59b873127eaae523f7c2080d62efc07e0`. It replays the transcript closed again and keeps that fork alive. It then checks each of the 12 steps from raw JSON-RPC and its own decoding, without the liquidity service or reconciler code:
   - keccak of the raw transaction equals its hash, and the signer recovered from the EIP-1559 signature is the owner;
   - chain 31337, zero value and an empty access list;
   - consecutive nonces 0–11, with the expected target and selector;
   - a successful receipt within the gas limit;
   - Uniswap `IncreaseLiquidity` and `Collect` amounts equal the owner's WETH/USDC balance deltas read at the receipt block and the block before;
   - exact finite allowances with their Approval logs;
   - NFT #6104987 minted to the owner and later burned, after which `ownerOf` reverts;
   - each step's transaction hash, payload, Manifest, Evidence Bundle and amounts equal the recording.

   Result: `PASS`, with no failures. The first run reported one false failure: the verifier compared the recorded pool pins with key-order-sensitive JSON while the recorded document is canonicalized. The comparison was fixed and the whole verification rerun from scratch.

| Operation | Outcome | WETH delta (wei) | USDC delta (units) | Observed ETH fee (wei) |
|---|---|---|---|---|
| Approve WETH | `RECONCILED` / `EXACT_APPROVAL` | 0 | 0 | 279,265,880,575 |
| Approve USDC | `RECONCILED` / `EXACT_APPROVAL` | 0 | 0 | 335,701,880,575 |
| Mint (ticks −197,510 to −197,310) | `RECONCILED` / `EXACT_MINT` | −71,611,536,694,464,784 | −200,000,000 | 2,498,738,056,219 |
| Reset WETH allowance | `RECONCILED` / `EXACT_APPROVAL` | 0 | 0 | 147,433,880,575 |
| Approve WETH | `RECONCILED` / `EXACT_APPROVAL` | 0 | 0 | 279,265,880,575 |
| Approve USDC | `RECONCILED` / `EXACT_APPROVAL` | 0 | 0 | 335,701,880,575 |
| Increase | `RECONCILED` / `EXACT_INCREASE` | −71,611,536,694,464,784 | −200,000,000 | 1,112,713,880,575 |
| Partial decrease (50%) | `RECONCILED` / `EXACT_DECREASE` | 0 | 0 | 883,273,880,575 |
| Collect | `RECONCILED` / `EXACT_COLLECT` | +71,611,536,694,464,783 | +199,999,999 | 808,710,737,756 |
| Full decrease | `RECONCILED` / `EXACT_DECREASE` | 0 | 0 | 854,473,880,575 |
| Final collect | `RECONCILED` / `EXACT_COLLECT` | +71,611,536,694,464,783 | +199,999,999 | 601,170,737,756 |
| Burn NFT | `RECONCILED` / `EXACT_BURN` | 0 | 0 | 426,421,880,575 |

Honest residues:

- **Rounding.** The net lifecycle effect is −2 wei WETH and −2 USDC units, the Uniswap rounding the pool retains.
- **Allowance.** A finite residual WETH allowance of 28,388,463,305,535,216 wei stays with the Position Manager; the USDC allowance is 0. The UI shows it, and a separately reviewed `RESET_WETH` can remove it.
- **Fees.** No swap ran, so no trading fee accrued. The collected amounts are withdrawn principal and are not presented as earned fees. The receipts carry no L1 fee field, so each fee comes from the L1Block state and the signed bytes; the observed ETH balance decrease equals it exactly.

## Real-transcript browser acceptance

Both liquidity specs ran on the Base transcript, with the environment `FORK_REPRODUCED`, no synthetic pins, the recorded owner and pool, and transcript `c9a02102…`. They passed 2/2 in each of two consecutive loopback-only runs:

- the full lifecycle, with one exact wallet signature per operation and no non-loopback request;
- lost wallet response → frozen submission → restart → exact-nonce scan → `RECONCILED`.

The wallet was the automated injected test adapter, signing through the fork's unlocked disposable account. No manual MetaMask session was run, and none is claimed.

## Evidence ceiling

Transcript validation, the closed byte-identical replay and independent lifecycle reconciliation all passed. BUILD-006 has therefore demonstrated **`FORK_REPRODUCED` on local chain 31337** for the one isolated Uniswap v3 Base USDC/WETH Mode A liquidity lifecycle.

This is not a certification. Certification needs remote CI on the PR head, the owner's merge decision, post-merge checks and a separate owner decision. It carries no public-chain, testnet, mainnet, real-funds, production-wallet, Mode B liquidity or BUILD-007 composition claim.

## Gates

| Gate | Result |
|---|---|
| `pnpm check` typecheck, lint, build and schema drift | Pass, with repository-confined module resolution in a loopback-only namespace. |
| Unit and compatibility suite | On the final evidence bytes, including the transcript, a full serial run gives 388 passed and 1 skipped: the existing BUILD-004 Mode B service smoke, which needs an owner profile. On this host, parallel `pnpm check` runs repeatedly hit 5 s fsync-latency timeouts in fsync-heavy journal tests. The last run had 6, in the unchanged BUILD-005 CoW tests and the two liquidity-service tests. Isolated and serial reruns pass. This is recorded as host I/O jitter, not as a pass of those parallel runs; remote CI is the authoritative parallel run. |
| Governance (both workflow steps, extracted from the current workflow file) | Pass. |
| CI-equivalent browser suite, MOCKED synthetic fork | 29 passed and 4 skipped, then 13/13, then 9/9. The protected zero-pixel visual baselines pass unchanged. |
| Liquidity browser specs on the dry-run transcript (MOCKED) | 2/2: full lifecycle, and lost response → freeze → restart → exact-nonce scan → reconcile. |
| Offline dry run and closed replay | Pass (`MOCKED`), above. |
| Offline dry run on the final pre-recording commit `c670889` | Pass (`MOCKED`): 12 steps, `REPLAY_BYTE_IDENTICAL`, 122 synthetic requests. |
| Recorder preflight | Pass; manifest `1e1e5b80…279c`. |
| Owner-operated read-only Base recording and credential-free transcript | Pass: `COMPLETE`, 207 requests and 5,382 CU, credential removed. |
| Byte-identical chain-31337 replay of the Base transcript and independent reconciliation | Pass: `REPLAY_BYTE_IDENTICAL`, fork tests 3/3, independent verifier `PASS`. |
| Owner-local browser acceptance on the Base transcript | Pass, 2/2 in each of two runs (automated test wallet). |
| Dependency audit and registry metadata checks | Not run locally; they need the network. The contracts/app CI workflow runs registry integrity, license and release-age checks, the low-threshold audit and the CycloneDX SBOM. |
| Remote push/PR checks, owner merge and post-merge checks | Not run. The owner retains merge and certification. |

Offline mocked checks establish at most `MOCKED` engineering evidence. The `FORK_REPRODUCED` result rests on the recorded transcript, byte-identical replay and independent reconciliation above. The BUILD-003/004 certified fork results and the BUILD-005 certified mocked result are unchanged.

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
