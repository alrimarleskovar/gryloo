# BUILD-004 — Finite Mode B authority: report

**Status: LOCAL ACCEPTANCE COMPLETE — READY FOR THE OWNER'S MERGE DECISION.** Implementation, automated local acceptance and the owner-operated injected-wallet session (§8) have passed. Not yet done:

- remote CI on the final pushed head of PR #13;
- the owner's merge decision;
- post-merge checks.

Until those pass and are recorded, BUILD-004 is not complete and not certified; ADR-0001 stays `ACCEPTANCE_PENDING`. The maximum evidence is `FORK_REPRODUCED` on local chain 31337. There is no public-chain, production, provider or real-funds result.

- **Authority:** DEC-0031 (plan and D-1) and DEC-0032 (Amendment A-1, [plan §14](BUILD-004-PLAN.md)).
- **Baseline:** `05910364feac7f9fe0856a5c2c197eeeb12db902`.
- **Branch:** `codex/build-004-plan`.

## 1. What a user can now do

With `GRYLOO_MODE_B=fork` on a local chain-31337 fork, a user can:

1. author one Base WETH/USDC swap in chat or on the canvas;
2. run a fork quote and a chained simulation, covering six owner installation calls plus the delegated swap;
3. review a finite Mode B permission: owner and threshold, Safe, executor, Router02 target and selector, exact nested parameters, cumulative cap, minimum output, protocol expiry, gas payer and code pins;
4. sign six distinct owner transactions through an injected wallet: enable the module, scope the target, install the exact function, set a one-time allowance, assign the executor, and approve the finite Router02 allowance;
5. close the browser while a separate worker, restarted in a fresh process, executes the single permitted call;
6. see the independently reconciled result;
7. revoke with four owner signatures and see `REVOCATION_CONFIRMED`, a disabled module, the role removed and a zero residual allowance.

A local pause never revokes.

## 2. How to test locally

All runs are offline inside `unshare -rn --pid --fork --mount-proc` with loopback only. Hide any `node_modules` above the repository, for example by bind-mounting an empty directory over it, so resolution matches CI's frozen install. They use pinned Node 24.21.0, pnpm 11.22.0 and Anvil 1.8.3.

1. Supply the digest-pinned external inputs listed in plan §14:
   - `GRYLOO_MODE_B_SAFE_PACKAGE` (extracted `@safe-global/safe-contracts` 1.4.1);
   - `GRYLOO_MODE_B_ROLES_MASTERCOPIES`;
   - `GRYLOO_MODE_B_EIP2470_INITCODE`.
2. Start the fork: `node apps/reference-dapp/e2e/fork/mode-b-harness.mjs serve` with `GRYLOO_ANVIL_BIN` and an absolute `/tmp/...` `GRYLOO_MODE_B_RUNTIME`. It prints `MODE_B_FORK_READY <profile> <key file>`.
3. Run the browser specs from `apps/reference-dapp` under the unchanged Playwright config:
   - set `GRYLOO_MODE_B=fork`, `GRYLOO_MODE_B_PROFILE` and `GRYLOO_MODE_B_EXECUTOR_KEY_FILE`;
   - run `playwright test e2e/mode-b-fork.spec.ts e2e/mode-b-adversarial.spec.ts`.
4. Run the fork tests with `GRYLOO_MODE_B_SMOKE_PROFILE=<profile>`: `vitest run --no-file-parallelism` over the three `mode-b.fork.test.ts` files and `apps/reference-dapp/src/server/mode-b-service.test.ts`.

Without a profile, all Mode B browser and fork tests **skip**. That is what CI runs, and a skip is not a pass.

## 3. Evidence on the final tree (2026-09-27)

| Gate | Result |
|---|---|
| Real Mode B browser specs, profile set, clean fork, strict zero-pixel, no snapshot update | **4/4 passed in two consecutive runs** (v12, v13) on the final code. Each run used a freshly built fork with new random keys, the wallet answered nonces as numbers as MetaMask does, and module resolution was confined to the repository (see §5) |
| Mode B fork tests: executor direct bypass, compiler read-back, reconciler | 4/4 passed serialized on one clean fork, together with the Mode B service fork smoke. The reconciler test installs with MetaMask-style wallet-chosen fees through the service's confirmation path |
| `pnpm check` (typecheck, lint, build, schema check, unit tests), Turbo cache bypassed | Passed; 346 unit tests passed, 1 skipped (the profile-gated Mode B service smoke) |
| Full browser suite, Mode B off (CI-equivalent) | 42 passed; the 4 Mode B specs skipped as designed |
| CI fork step offline | `test:anvil` 4 passed / 10 skipped (owner-secret); `test:fork` 30 passed / 24 skipped (owner-secret and profile-gated); F1 five-pass rehearsal PASS; transcript static check passed |
| Governance workflow, both steps, run locally | Passed |
| SBOM, CI step run offline | 247 exact registry components, 16 reviewed exceptions |
| Dependency verification | Local manifest and edge checks raised no violation. Registry metadata, release-age checks and `pnpm audit` passed remotely on PR #13 head `e013361` (all four checks green), before the two owner-session fixes |

**Direct-call boundary (executor fork test).** Each rejection must be an onchain revert of a mined transaction. RPC refusals do not count. The following reverted:

- wrong target, selector, token and receiver;
- one native unit above the amount;
- a wrong protocol deadline;
- nonzero value and delegatecall;
- an executor transferring Roles ownership;
- an executor using the owner Safe signature;
- an executor changing the Safe fallback handler;
- an expired deadline;
- a replay after the one-time budget was consumed;
- a call after revocation.

Two further cases held:

- a foreign-chain (8453) signature was refused;
- two same-block competing calls produced exactly one success and one revert.

The worker executed after a fresh-process restart and reconciled as `RECONCILED`.

**Read-back (compiler fork test).**

- The on-chain `ScopeFunction` event bytes equal the compiled arguments.
- The one-time allowance is `{refill 0, period 0, balance 1}`.
- The module is enabled and the executor is a member.
- The Router02 approval equals the input amount.
- The permission hash recomputes, and it binds the deployed Safe and Roles code.

**Reconciliation (reconciler fork test).**

- Observations read directly from the chain, with the signer recovered from mined raw bytes, give `RECONCILED`.
- The same observations against a different review, Roles code, owner or minimum output give `DIVERGENT`.
- A real reverted replay gives `REVERTED`.
- An unsent transaction gives `INCONCLUSIVE`.

## 4. Local fork construction and its limits

The certified BUILD-003F transcript (`ebf4daaf…`) is served strictly closed and never synthesizes a response. Plan §14 records how local-only accounts, the relinked Roles instance and its CREATE2 condition pointers are declared, and the owner-selected `LOCAL_SETUP_NOT_BASE_OBSERVED` slots:

- WETH `balanceOf(Safe)` = 2 WETH, backed by ETH;
- WETH `allowance(Safe, Router02)` = 0;
- USDC `balanceOf(Safe)` = 0.

The Safe's starting token state is therefore locally asserted, not observed on Base. The Roles runtime is the official 2.1.0 bytecode relinked to local libraries and a local ERC-2470 factory; ADR-0001 pins its identity.

## 5. Corrections to the earlier working checkpoint

An earlier session's checkpoint claimed local passes that did not hold on independent re-run:

- **Replay extension.** Its fork read through `/tmp/.../replay-extension.mjs`, which answered any unrecorded WETH/USDC storage slot, and fresh accounts found by a timing heuristic, with zeros. That extension was removed; nothing from it is evidence.
- **Roles ownership.** Its Roles instance began EOA-owned and its module pre-enabled. Its Mode B baselines and one service smoke test encoded that state and failed on the clean fork. Both were corrected.
- **Substituted config.** The visual-shell failure it reported came from a substitute `/tmp` Playwright configuration with missing Mode A server settings. Under the real configuration the committed baselines match at zero pixels and are unchanged.
- **Dependency edges.** It stated that only the six workspace edges and the lockfile changed. In fact `reference-executor` also gained direct `@noble/curves` and `@noble/hashes` 2.4.0 edges; Amendment A-1 now records them.
- **Mode A heading.** It changed the shared Mode A Execute heading, which broke protected Mode A browser baselines (8 failures in the full suite). The original Mode A heading is restored; Mode B has its own heading.
- **Undeclared imports (found by remote CI on PR #13).** `mode-b-fork.spec.ts` imported `@noble/curves` and `@noble/hashes`, which `reference-dapp` does not declare. Remote CI's frozen install correctly failed the app typecheck. Locally, TypeScript and Node resolved them from an unrelated `node_modules` in the owner's home directory, outside the repository, at noble 1.9.7 rather than the pinned 2.4.0. The earlier local browser runs v3–v6 therefore signed test owner transactions with an unpinned library; they are superseded. The spec now signs through the declared `reference-executor` signer, whose expected-signer check proves that the key derives the profile owner. Every local check was then repeated with that directory hidden: `pnpm check`, the Mode B specs, the Mode B fork tests and the full browser suite.
- **Wallet nonce shape (found in the owner session).** The Mode B owner step accepted the wallet's pending nonce only as a lowercase hex string. MetaMask answered from its own nonce tracker, possibly as a number, so the first attempt stopped with `WALLET_NONCE_INVALID` before any send. The chain showed owner nonce 0 and an empty txpool. The step now accepts a non-negative safe integer or a hex count, and the fork spec's wallet answers with a number.
- **Mode A fee profile applied to Mode B (found in the owner session).** MetaMask chose its own EIP-1559 fees (priority 1.005 gwei). The Mode B confirmation path decoded the mined transaction with the Mode A exact-payload decoder, which requires a fixed priority fee. So a valid, mined step-1 transaction was never journaled, and a retry reverted without changing state. `decodeModeBSignedTransaction` in the Mode B reconciler module keeps these checks: chain, hash, canonical encoding, signature, zero value and empty access list. It binds signer, target and calldata but not wallet fees. The Mode A decoder is unchanged. The automated tests had signed only at the Mode A fee; the reconciler fork test and new unit cases now cover wallet-chosen fees.
- **Spec defects.** The real `mode-b-fork.spec.ts` could not restart the worker under the real config, because Vite's root was wrong. It also allowed a 100-pixel tolerance, against the plan's zero-pixel rule. Both are fixed. Per-run values (hashes, expiry, the disposable owner address and salt-dependent gas) are masked, and the owner address is rendered in fixed-width `code`.

## 6. Visual evidence

With Mode B off, the Build, Simulate and Execute shells are pixel-identical to the committed baselines. Each Mode B screen was inspected before recording. The `*-before.png` files are those baselines; each `*-diff.png` is a strict-RGB diff against the Mode B-enabled capture.

| Screen | Before SHA-256 | After SHA-256 (not retained) | Diff SHA-256 | Changed pixels |
|---|---|---|---|---:|
| Build | `2ec8ad78533569bc6c1e63541c953ab3fcd5fd2c2629df740bdbf608b4c32cfe` | `0e014fa0681778f23ee2af2cabf266526ac3068e9de4cadbdcaae49235043775` | `1c131b401fd0e977c76851ea89d85c3eb517cb46866f7506fb8cca72304c0c08` | 36398 |
| Simulate | `756b86bb99e6801ac57abb8858bb088f0f301dad9a34832fe3b2fe1c3bb74a71` | `72040737346db854d4881393e38dc46e603817a35b008f9814de49e3704fc8ca` | `4467542f327b6d3576700e94b89bb8b53505b3d1543ccabe2848db7f21b7a07e` | 1046507 |
| Execute | `b458412ccf601775746d401a7bfd39ed5a224a8b41be179d6af8f1addebbfb3c` | `7d488cb472ba33bfbf7fb2f3c3e63ee094b99f9350f389b1da57265b52bc0de5` | `0df7fbcdf6ae4d8a76f61a87944aaa23f98cfd1719e8419b7052c248ae296134` | 859783 |

Known cosmetic issues, left unchanged because their files are outside the approved path set:

- the header still reads `BUILD-003F REFERENCE` (from `src/config/product.ts`);
- with Mode B on, the summary bar wraps onto two lines;
- long calldata blocks are clipped inside fixed-height boxes.

## 7. Remaining for completion and BUILD-005

1. **Remote CI** on the final pushed head of PR #13 must pass.
2. **Merge:** the owner decides.
3. **Post-merge checks** must pass. A records-only commit then marks BUILD-004 `COMPLETE / CERTIFIED: FORK_REPRODUCED`, and `NEXT_BUILD.md` points to BUILD-005 (the CoW signed-intent adapter) planning.

These limits remain beyond this build and do not block it:

- the gas cap is enforced only at the worker gateway;
- production executor key management;
- a live provider;
- a formal audit;
- public-chain deployment.

## 8. Owner-operated injected-wallet acceptance (2026-09-27)

The owner operated MetaMask in Brave on local chain 31337. The account was `0x8ef12e4e2fd397c227492019f626b5d1c5e41b3b`, the disposable BUILD-003F G7 account. The certified transcript records its Base state as balance 0, nonce 0 and no code. The harness only added 100 test ETH for gas. The harness held no owner key; the wallet signed every owner transaction. Wallet and browser versions were not reported for this session.

- **Attempt 1.** Stopped with `WALLET_NONCE_INVALID` before any send; nothing was mined. Fixed in `02c8fe7` (§5).
- **Attempt 2.** Step 1 was mined but not journaled because of the fee-profile defect; the owner's retry reverted. Only the Roles module was enabled, and no role, scope or allowance existed. The fork was discarded and the defect fixed in `311fb10` (§5).
- **Attempt 3 (acceptance run, fresh fork).**
  1. The owner signed six exact installation transactions (nonces 0–5), then closed the tab.
  2. A supervisor started a separate worker process after installation: process A submitted the executor call and exited at `PENDING`, and a fresh process B resumed it to `CONFIRMED` and `RECONCILED`, with no browser involvement.
  3. The owner reopened the app, saw the recovered `RECONCILED` state, and signed four exact revocations (nonces 6–9). The app showed `REVOCATION_CONFIRMED`.
  4. The independent key-free verifier (`mode-b-harness.mjs verify`) re-read every transaction from the fork and returned **PASS** with no findings. Result SHA-256: `4123fa38dd281bb094a7d436cf02320b0aadd8f0425a1ce561ec7ea3347529c6`.

| Step | Transaction | Signer / nonce | Exact |
|---|---|---|---|
| Enable Roles module in Safe | `0x2645b579a0bacc80754e25b6b6b087b29e2c9c847fa3db9f785ae9db20b5c7ca` | owner / 0 | yes |
| Scope Router02 target | `0x610d604d85d71f1817da30d0b6ef3fc21c9ac6d5003ffe2a647d3d090bb74595` | owner / 1 | yes |
| Install exact scoped function | `0x1b76cce3fb84e15014e4e842b4971bb2de60cd29bdb33e7e251c1c1a975d00a4` | owner / 2 | yes |
| Set one-time allowance | `0xd9df5d87054126c85698866a3fea077eacbea48c15ff4ace2ae6c4fd24e17bda` | owner / 3 | yes |
| Assign executor role | `0x11d4b2fdee75f3693732148f36b9ad3c764e04ca5de5a536c8a023d0bb8d0dab` | owner / 4 | yes |
| Approve finite Router02 allowance | `0x93343a9a387da685c0a7434c2fdba89e0309c51904b46796c127c5d3acd83e76` | owner / 5 | yes |
| Executor swap | `0xeaa087b51b9806f8caa29cd1859ad11571289da6a22279743987b2bd3e71f85d` | executor / 0 | yes |
| Remove executor role | `0x70af67ae0b1bb572e2b36e5c0b8e73ec8c910f9cac74bf9b80bd3d7591a80bae` | owner / 6 | yes |
| Disable executor module in Roles | `0x3540a57a13f93d3923f8d4f84a3eb12c8eb7f759aa9aa37737f940574f8071f0` | owner / 7 | yes |
| Disable Roles module in Safe | `0x5e294dc5f1d61cb6ed33342334db70c1445636a6a9a9ea535514b6916dddef34` | owner / 8 | yes |
| Clear residual Router02 allowance | `0x5569347e5110a4333732bcfae42f7eb4b0fca9febf011c75ce7878bad90f3616` | owner / 9 | yes |

Step 1 has the same hash as attempt 2's step 1. On each fresh fork the state, nonce, fees and calldata were identical, and the wallet's signature is deterministic.

**Execution.**

- Execution: `exec-f9b29b51c026eb40895ff412`.
- Permission hash: `0x3ca5a2a528537f45f8c0efac341285dda8882385028b548fa717ab3c782e39de`.
- Swap: 1 WETH in on fee tier 500. The Safe's WETH went from 2 to 1 (LOCAL_SETUP funding), and its USDC from 0 to **2,686.073513**, exactly the quoted output and above the 2,659.212777 minimum.
- Reconciliation: `RECONCILED`, with remaining budget 0 and residual allowance 0.

Chain readback after revocation: Roles module disabled in the Safe, executor removed from Roles, and Router02 allowance 0.

**Owner-operated injected-wallet acceptance: PASS** (local chain 31337, `FORK_REPRODUCED`).

**Is BUILD-004 complete? Not yet.** It is ready for the owner's merge decision once remote CI on the final head passes. Completion follows the post-merge checks.
