# BUILD-013 — Advanced lending composition report

**Implementation evidence: MOCKED. Public execution remains gated; no public owner signature or transaction was requested or submitted by this work.** A discovered compatible pool and public quote do not demonstrate the composed workflow. Public completion is not claimed. See the [approved finite scope](BUILD-013-PLAN.md).

## Implemented behavior

One finite Base Sepolia workflow supplies exact Aave USDC, checks HF ≥ 2.0, borrows that same USDC at variable rate mode 2, and swaps exactly the typed borrowed output to WETH. Chat and Canvas share the closed three-node IR and explicit proposal acceptance. Review exposes collateral/debt/HF and wallet balances at every checkpoint, exact input/expected/minimum output, slippage, fees, variable interest, owner approvals, step state and non-atomic failure consequences. Economic edits retire authority and require new committed artifacts and Review.

The complete public path is validated before any owner call, including Supply. The runtime requires canonical exact-token infrastructure/pool discovery, liquidity/quote/minimum, stateful sequential simulation without overrides, safe Aave configuration/capacity/HF, fresh consistent state, sufficient owner funding and bounded fees. It repeats checks at Review, preparation and handoff; no fallback is allowed.

Five possible owner calls use durable PREPARED/SUBMITTING/PENDING/CONFIRMED transitions, fsynced extending records, shared nonce/economic reservations, strict predecessor reconciliation and observation-only unknown recovery. Reload recovery never sends. Completed BUILD-012 EIP-7702 nonce use is accepted only with fresh positive authority/canonical proof. Partial Borrow completion retains explicit debt, USDC, HF and allowances, without repeating Supply/Borrow or auto compensation. The independent read-only verifier reconstructs ABI, rereads canonical owner execution through a separate provider and proves the composed balances, principal, exposure, fees, ordering and journal linkage.

No Manifest or frozen schema change. Existing hashes, exact payloads, spend/gas/fee bounds, provider/chain/contract policy and HF/checkpoint risk rules bind the finite economics. Mode A enforcement remains application-level; it cannot guarantee against market movement after wallet handoff or ongoing liquidation. Generalized policy/budget machinery retains its existing honest enforcement markers.

## Public route and blocker

Preserved read-only artifacts:

- [Route discovery](BUILD-013-ROUTE-READONLY.json), SHA-256 `02d6911e7ada32379068523c9aa2c3cab0d2cc457d45e9fd93ef35a1caa07edc`.
- [Original public preflight](BUILD-013-PREFLIGHT-READONLY.json), SHA-256 `3b9e9c80306888baf3e18e3fecdd8d52c83705019a68431d0b395ac16f7dc933`.

The exact Aave USDC is `0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f`, **not** the Circle USDC from the existing public swap profile. Independent official Base/Tenderly reads found fee-500 pool `0x9d9203f8a29c600d567b240692db569b77d1f4a9`, with WETH/token0 and Aave USDC/token1, active liquidity and a positive exact-input quote. Official deployment sources and matching code fingerprints are recorded. No pool was deployed, funded or modified, and no asset conversion was introduced.

The original owner-address preflight made 62 read-only requests. All three bounded `eth_simulateV1` attempts returned `-32005` rate limits. It correctly stopped **PUBLIC_EXECUTION_BLOCKED / LENDING_SEQUENTIAL_SIMULATION_UNAVAILABLE** before any transaction. The full-path gate has not been bypassed. These historical point-in-time reads are preserved, not refreshed in place, and do not authorize execution.

A separate [implementation recheck](BUILD-013-PREFLIGHT-READONLY-RECHECK.json), SHA-256 `0f22fe40824de3360430ed04952311d9bd8ed6bcf4683a5dfc31e6598541e256`, again found the full path **PUBLIC_EXECUTION_BLOCKED / LENDING_SEQUENTIAL_SIMULATION_UNAVAILABLE**: all three bounded sequential simulation attempts returned the same `-32005` rate limit. No signing/submission RPC exists in this CLI. The compatible route exists, but the required sequential public simulation cannot currently be proven with the configured public provider. This is a provider/simulation blocker, not a claim that no compatible pool exists. **READY_FOR_OWNER_EXECUTION has not been reached.**

## Validation record

Local validation uses Node 24.21.0, pnpm 11.22.0, verified Anvil 1.8.3 and Playwright 1.63.0 / headless shell revision 1243. The test transport is explicitly MOCKED and loopback only; its documented disposable fixture signatures are not public owner execution.

- Finite semantic, compiler, policy/Manifest, simulation, executor/recovery, reconciliation/evidence and independent tamper tests.
- Guarded browser tests for Canvas/Chat, full composition, upstream execution gate, HF/chain/drift/minimum blocks, unknown Borrow reload, route loss after Borrow, failed Swap exposure, duplicate clicks and semantic authority invalidation.
- BUILD-012 Supply/Borrow/Repay/Withdraw unit and browser regressions.
- Standard typecheck/lint/production build, eleven unchanged schema exports, governance/self-tests, dependency verification/audit/SBOM, Anvil and offline fork regression gates.

Passed on the preserved implementation before any upstream integration:

| Gate | Result |
| --- | --- |
| `pnpm check` | PASS: typecheck, lint, production build, 11 schema exports; **1094 tests passed / 2 existing skips**, 138 passing test files |
| BUILD-013 semantic/service coverage | **41 focused cases** within the full suite, including all five unknown-submission/restart boundaries, legacy nonce proof and independent evidence tampering |
| Guarded BUILD-013 browser | **15/15 PASS**, including five explicit synthetic owner calls, partial/failure exposure and duplicate/reload protection |
| BUILD-012A/B/C/D guarded browser regression | **44/44 PASS**: Supply, Borrow, Repay, Withdraw, refusal, chain/account changes, semantic edits and restart recovery |
| Governance | PASS; **17/17** self-tests |
| Exact dependency verification | **247** registry components/integrities/release ages and **16** reviewed license exceptions verified; no external dependency added |
| Security audit | No known vulnerabilities at the required low threshold |
| CycloneDX 1.6 | Exact **247** components, eight workspace manifests/importers and reviewed licenses validated; ephemeral SBOM removed by the unchanged verifier |
| Anvil compatibility | **4 passed / 10 owner-input cases skipped**, not claimed as passes |
| Offline fork suite | **31 passed / 29 environment/owner-input skips**, not claimed as passes |

BUILD-013 demonstrates MOCKED engineering execution. It claims neither a real fork reproduction of this new path nor public composed execution. The primitive fork regression suite retains its own evidence scope.

Sandbox restrictions initially blocked Node child processes, independent Python subprocess tests, network metadata checks and browser libraries. Production/browser/subprocess gates use the unchanged pinned toolchain outside that restriction; no gate or dependency was disabled. The first new browser iteration also found incorrect test navigation and asynchronous assertion races; those tests were corrected without weakening application guards.

## Integrated closure and CI timeout investigation

The preserved handoff had HEAD and remote branch at `dd0e97d`, MERGE_HEAD at `ce78992`, staged main integration and a separate unstaged SPDX correction in `execution-capabilities.ts`. Closure retained both layers and the merge ancestry. A fresh remote inspection confirmed these branch/main heads and existing PR #48; no reset, history rewrite or duplicate PR was used.

[CI run 37018814071](https://github.com/alrimarleskovar/gryloo/actions/runs/37018814071/job/110876285075) failed exactly at `apps/reference-dapp/src/server/lending-composition-service.test.ts:107`: “Borrow success / route disappearance exposes debt, residual USDC, HF and allowance without repeating prior steps; explicit fresh continuation only”, after 30.922 seconds against the unchanged 30-second limit. This test uses the closed in-memory lending RPC, not a public provider. The saved original log is `.turbo/build013-ci-original-failure.log`.

CPU profiling found repeated parsing, canonical hashing and validation of every historical run snapshot on each load and both sides of each extending write. This BUILD-013 runtime cost grows with the journal and explains the slower CI continuation case; it is separate from the public simulation rate limit. The fix keeps one private, completely validated serialized prefix per service instance. Every operation still reads the file and compares its bytes; only an identical prefix reuses prior validation. New snapshots and predecessor transitions are fully validated. Changed history or a restart receives full validation. Live RPC proofs, owner authority, simulation, persistence/fsync and all original test assertions remain unchanged. A new regression rejects historical tampering and changed prior-attempt fields after both warm loads and restart, checks caller isolation and ensures rejected bytes cannot poison subsequent valid appends.

Diagnostic local runs reduced the continuation case from 6.418 to 1.763 seconds and the complete service suite from 37.78 seconds (20 cases) to 15.42 seconds (21 cases). Sampled validation CPU fell from 4.933 to 0.543 seconds. These are local measurements, not public execution evidence or a promise about another runner's timings. Logs are `.turbo/build013-closure-focused-before.log`, `.turbo/build013-closure-focused-after.log` and `.turbo/build013-closure-profile-after.log`; diagnostic CPU profiles remain outside Git under `/tmp`.

Final integrated local checks passed: typecheck, lint, production build, 11 unchanged schema exports and **1,144 unit/contract tests with two existing skips**; Governance-Lite and **17/17** self-tests; whitespace checks; exact **247** registry components and **16** reviewed license exceptions; low-threshold audit with no known vulnerabilities; and the unchanged ephemeral CycloneDX validator. Anvil compatibility passed **4 cases / 10 owner-input skips**, offline fork regressions passed **31 cases / 29 environment/owner-input skips**, and the synthetic F1 rehearsal passed all **five** runs. Skips are not passes.

The broad guarded browser regression passed **53 cases / four existing Mode B environment skips**, including the unchanged visual baselines. Its first local run found seven screenshot mismatches because Arial resolved to DejaVu Sans: this environment lacked Liberation Sans. The verified Ubuntu Liberation font package was extracted under `/tmp`; rerunning with that font configuration passed without changing product CSS, snapshots or pixel assertions. A fork run initially collided with the concurrent browser harness on its fixed ports; running the unchanged fork gates after browser teardown passed. These environment failures and their follow-up logs are retained under `.turbo/build013-closure-*`.

The final combined browser sequence also passed **15/15 BUILD-013 lending cases**, **44/44 BUILD-012 Supply/Borrow/Repay/Withdraw regressions**, and **7/7 Robinhood transfer regressions**, on the final integrated production build. These use scripted disposable fixture wallets and loopback harnesses; they establish MOCKED engineering behavior only. Logs are `.turbo/build013-closure-browser-lending.log`, `.turbo/build013-closure-browser-primitives.log` and `.turbo/build013-closure-browser-robinhood.log`.

Preservation checks compared **51** Robinhood/native-transfer source/evidence and all historical BUILD-012 documents against `ce78992`, with zero byte differences. Shared main integration retains Robinhood behavior alongside lending; the three BUILD-013 read-only JSON hashes above are unchanged. The separate RH-DEMO worktree and generated untracked Python cache are not product changes. Public execution remains **PUBLIC_EXECUTION_BLOCKED**, and READY_FOR_OWNER_EXECUTION has not been reached. PR #48 remains the sole owner-review delivery; remote CI must be inspected for the pushed closure head, independently of the earlier failed run.

## Owner boundary and conditional steps

There is **no owner execution instruction to follow while the public gate is blocked**. Keep the existing durable journal and recovery state. A fresh read-only full-path preflight must first pass; write any new transcript to a different file. Implementation approval is not authority to bypass the gate or submit public transactions.

After a fresh complete gate proves readiness, the minimum owner flow is:

1. Run the DApp with a persistent `GRYLOO_SUPPLY_JOURNAL` shared with existing Aave execution/recovery; connect your own wallet on Base Sepolia. No harness flag and no private key belong in production configuration.
2. Author Supply 0.1 Aave USDC → Borrow 0.01 Aave USDC → Swap borrowed USDC to WETH, 50 bps. Accept the proposal, Simulate, and explicitly accept the complete Review showing the current pool, minimum output and fee cap.
3. Only after separate explicit owner execution authorization, click and sign each displayed exact call: optional Pool approval 100000, Supply 100000, Borrow 10000, optional router approval 10000, Swap 10000 with the reviewed minimum. Wait for reconciliation before the next owner click. A new expired/changed Review needs fresh explicit acceptance; completed steps are excluded.
4. Download the composed Evidence Bundle and execution record. Run `node scripts/verify-lending-composition.mjs --evidence <export.json> <new-verification.json>` read-only through the official Base endpoint. Preserve both archives; require RECONCILED and INDEPENDENTLY_RECONCILED before claiming public composed completion.

Required test assets are at least 0.1 of the **exact Aave USDC**, plus the displayed full ETH network fee budget. No prefunding of WETH or pool liquidity is required or authorized. Maximum principal effect for the default pilot is +0.1 USDC collateral, +0.01 USDC variable debt (plus uncapped future interest), −0.1 wallet USDC net after successful Swap, and +actual WETH output ≥ reviewed minimum. Borrow's 0.01 USDC is consumed by Swap, with all recipients the owner. Optional allowances are exact S/B; existing larger allowances and any failure residuals are displayed. Network cost cannot exceed the accepted root budget without blocking the continuation. Partial completion can leave debt and borrowed USDC; the owner controls any later separate economic action.

## Delivery and preservation

Work remains on `codex/build-013-lending-composition`, initially from `7003856`. The complete interrupted implementation was first preserved in `dd0e97d26ab6285e8f088f23e350255cb7c4a9ca` and pushed. [PR #48](https://github.com/alrimarleskovar/gryloo/pull/48) then reported CONFLICTING/DIRTY against main. Only after that concrete blocker was established, the later `ce78992bdb135c96caf55da90880c7aa0591958a` Robinhood demo merge was integrated under the owner's strictly-necessary exception, using a merge rather than rewriting history. Shared UI, commands and export conflicts retain both paths. Robinhood-specific source/evidence and historical BUILD-012 files match main byte-for-byte; the RH-DEMO worktree is untouched. One focused PR remains open, without merge or automatic merging. Public composed completion and certification remain pending explicit owner execution and independent reconciliation.
