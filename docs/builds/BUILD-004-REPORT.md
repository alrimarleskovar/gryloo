# BUILD-004 — Finite Mode B authority: report

**Status: IN PROGRESS / ACCEPTANCE_PENDING.** Implementation and automated local acceptance pass on the final working tree. The following have **not** happened:

- the owner-operated injected-wallet session;
- push, pull request and remote CI;
- the merge decision and post-merge checks.

BUILD-004 is therefore not complete and not certified. The maximum evidence is `FORK_REPRODUCED` on local chain 31337. There is no public-chain, production, provider or real-funds result.

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

All runs are offline inside `unshare -rn --pid --fork --mount-proc` with loopback only. They use pinned Node 24.21.0, pnpm 11.22.0 and Anvil 1.8.3.

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
| Real Mode B browser specs, profile set, clean fork, strict zero-pixel, no snapshot update | **4/4 passed in four consecutive runs** (v3–v6), each on a freshly built fork with new random keys |
| Mode B fork tests: executor direct bypass, compiler read-back, reconciler | 4/4 passed serialized on one clean fork, together with the Mode B service fork smoke |
| `pnpm check` (typecheck, lint, build, schema check, unit tests) | Passed; 344 unit tests passed, 1 skipped (the profile-gated Mode B service smoke) |
| Full browser suite, Mode B off (CI-equivalent) | 42 passed; the 4 Mode B specs skipped as designed |
| CI fork step offline | `test:anvil` 4 passed / 10 skipped (owner-secret); `test:fork` 30 passed / 24 skipped (owner-secret and profile-gated); F1 five-pass rehearsal PASS; transcript static check passed |
| Governance workflow, both steps, run locally | Passed |
| SBOM, CI step run offline | 247 exact registry components, 16 reviewed exceptions |
| Dependency verification | Local manifest and edge checks raised no violation. Registry metadata, release-age checks and `pnpm audit` need the network and were **not run**; they are left to remote CI |

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

1. **Owner-operated wallet session.** One local session with a real injected wallet on chain 31337: install, worker execution, reconciliation and revocation. This has not been performed.
2. **Delivery.** Commit review, push and one pull request. The agent shell cannot push over SSH, so the owner pushes.
3. **Remote CI.** It must pass, including `pnpm audit` and registry verification.
4. **Merge.** The owner decides; then post-merge CI runs.

Only after all four may BUILD-004 be marked complete, and `NEXT_BUILD.md` then points to BUILD-005 (the CoW signed-intent adapter) planning. Limits that remain beyond this build:

- the gas cap is enforced only at the worker gateway;
- production executor key management;
- a live provider;
- a formal audit;
- public-chain deployment.

**Is BUILD-004 complete? No.**
