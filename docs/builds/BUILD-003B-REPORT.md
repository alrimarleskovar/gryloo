# BUILD-003B — Report

Status: **LOCAL_ACCEPTANCE_PASSED**. Branch:
`codex/build-003b-mocked-artifact-chain`. Baseline:
`36dd05e2bcea2d9a19c7b571d2126aea0390e5dd`, the merge of BUILD-003A through
PR #7. The human owner explicitly approved implementation on 2026-09-24
(DEC-0019) under the exact scope of [the plan](BUILD-003B-PLAN.md). This report
separates local observations, remote CI and evidence that is unavailable.
Mocked provenance and hashes identify synthetic data. They are not proof of
authenticity and not independent financial enforcement.

## 1. Approved objective

For every isolated Base swap authored under BUILD-003A, generate on request a
visibly `MOCKED`, hash-linked chain: Quote/State Artifact, Artifact Set and
Simulation Bundle. The chain is bound to one Semantic Workflow IR revision and
is invalidated when that revision or its freshness no longer holds. It
authorizes nothing and executes nothing.

## 2. What was implemented

- **Generation.** The existing Simulate tab has an explicit **Generate mocked
  artifacts for revision N** control. It builds one `MOCKED` Quote/State
  Artifact per swap node, an Artifact Set and a Simulation Bundle, using the
  unchanged v1 schemas, a fixed synthetic rate of 1 WETH = 1,000 USDC in both
  directions and a 60-second validity window. Every artifact ID starts with
  `MOCKED.`. The quote also carries hashed `evidence-environment`, source,
  adapter and uncertainty markers.
- **Arithmetic.** Integer native units only. Conversion and minimum both round
  down, the minimum is computed from the rounded expected value, adverse equals
  minimum, and a zero expected or minimum output adds the BLOCK finding
  `MOCKED_OUTPUT_ZERO`.
- **Browser-safe digest.** The linter's new digest reproduces the frozen
  DWE-HASH v1 profile over WebCrypto and the locked `canonicalize@5.0.0`. It
  supports four artifact kinds plus `raw-response`, has no payload, intent or
  authority domain, and runs a known-vector self-check before every generation
  and review. A failed self-check builds nothing and shows an explicit
  `DIGEST_UNAVAILABLE` alert.
- **Chain review.** It recomputes every cross-artifact reference, binds the
  chain to one exact source revision, and rejects tampered, mislinked,
  authority-bearing and fee- or gas-bearing artifacts with specific codes. Its
  results always carry literal `executable: false`, `MOCKED`, `NONE` and
  `NOT_ENFORCED`.
- **State.** An app-local state machine handles generation, invalidation by
  semantic edit, expiry, refresh and discarded stale completions. One
  synchronous access guard checks revision, IR identity, wall clock, backwards
  clock and monotonic time on every access and on `visibilitychange`, `focus`
  and `pageshow`. A timer only triggers a re-check; there is no countdown.
- **Interface.** A read-only graph with `MOCKED` outputs, a results table where
  every generated number shows `MOCKED` and "synthetic rate 1 WETH = 1,000
  USDC" beside it, an all-`NOT_ENFORCED` enforcement table, a "Not modeled"
  disclosure (including "USD values: not modeled"), copyable artifact JSON and
  a disabled Manifest review. Execute stays unavailable in every chain state,
  and the workflow stays `DRAFT`.
- **Governance.** BUILD-003A scope is now a historical Git-tree check. The
  exact 59-path BUILD-003B scope is enforced, with new source scans, image
  digests and records.

## 3. What was not implemented

There is no live or market quote, RPC, balance or pool read, router, spender or
recipient, calldata, Authorization Policy, Strategy Manifest, Execution Plan,
payload or intent hash, journal, Evidence Bundle, wallet, signature, submission,
financial simulation, gas or fee estimate, USD valuation, persistence, file
download, backend, server action or external model. BUILD-003C and Mode B were
not started. ADR-0001 remains `PROPOSED`. No P-gate is certified; P6 and P7
appear only in mocked form.

## 4. Changes by component

- **Frontend:**
  - new `simulate-panel.tsx`;
  - a read-only mode in `workflow-canvas.tsx` (Build rendering unchanged);
  - a tab-aware footer and chain chip in `summary-bar.tsx`;
  - Simulate and Execute copy in `app-shell.tsx`;
  - review copy, the `BUILD-003B` label and page title;
  - styles limited to the new elements.
- **Backend:** none.
- **Semantic IR and artifacts:**
  - `mock-artifacts.ts` builds the chain;
  - `artifact-chain.ts` holds status, transitions, the access guard and the
    frozen invalidation mirror;
  - the linter adds `artifact-digest.ts` and `mocked-chain.ts` with additive
    root exports;
  - v1 schemas, fixtures, the hash profile and the contract and registry
    packages are unchanged.
- **Policy, Manifest and authority:** none. The canonical workflow state stays
  `DRAFT`.
- **Journal, reconciliation and evidence:** none.
- **Adapters:** none. `mock.fixture-quote` is a synthetic fixture identifier,
  not an adapter.
- **Security:** closed validation, recomputed links, the self-check, the
  access guard and new governance source scans.
- **DevOps:**
  - `governance.yml`: historical BUILD-003A and current BUILD-003B scope,
    image digests, templates, markers and scans;
  - `contracts.yml`: linter export check;
  - `bootstrap-ci.py`: the linter's exact dependency and importer text;
  - `pnpm-lock.yaml`: three importer lines.
- **Documentation:** the plan's approval record and this report, DEC-0019,
  the requirement index including B003A-DELIVERY-001, and updated status,
  next-build, authority, evidence, scope, security, license-map and README
  records.

## 5. Evidence and tests

### Local results

All runs used the pinned toolchain, bootstrapped fresh for this build by the
unchanged `scripts/bootstrap-ci.py`:

- Node v24.21.0, archive SHA-256
  `fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6`;
- pnpm 11.22.0, SRI
  `sha512-H/hwxMYTPf2I+yr8Rt0T1H8JyXlLQ4xv20fKmMrzvBY4HuC+k6CRuOOCTPAfiJ9G19niCRD7C+GrD7W6qA3WIQ==`.

The approved headless shell was downloaded afresh by the unchanged
`scripts/bootstrap-playwright.py`: revision 1243, 119,809,080 bytes, SHA-256
`a9da028861a0cf789ff25c2fed45f5f1aaf969ed9247835b6a7821a4f7af9d1d`, 287
entries, executable version 153.0.8010.12. Its classification stays
`LOCALLY_OBSERVED_HUMAN_APPROVED`.

| Requirement | Test | Result | Environment | Outcome status | Evidence |
|---|---|---|---|---|---|
| Baseline reproduction | Existing suite at `36dd05e` before any change; strict RGB comparison of five snapshots | PASS | MOCKED | NOT_APPLICABLE | 13/13 tests; 0 changed pixels in all five |
| B003B-SUPPLY-001 | Frozen offline install, lockfile diff, dependency verifier, audit, SBOM | PASS | MOCKED | NOT_APPLICABLE | Only three linter-importer lines added. Resolved sections keep SHA-256 `7435de8d05c530d4660ed466a2992d63ae71788a1c39e327ebb4fe611d6ac9bf`. The verifier checked 245 entries and 16 exceptions, with evidence SHA-256 `20aca46436a4692cef9ec7c2c04f7a91f9e0bf2d9768f8ca11e21f5f4ba177ea` (identical to BUILD-003A). No known vulnerabilities at the time. The SBOM had 245 registry components and zero workspace components (five manifests and importers checked separately); final-run temporary SHA-256 `7e98df34306dcab4fc52b84778834be5cbac6aed73909ca9c037965e60d5ee8b`. An earlier run on the same unchanged lockfile produced a different digest, so the digest identifies only that temporary output. The file was removed afterwards. |
| B003B-COMPATIBILITY-001 | Typecheck, lint, build, schema drift | PASS | MOCKED | NOT_APPLICABLE | 7 typecheck tasks, ESLint clean, 4 build packages, 10 schema exports byte-verified |
| B003B-HASH-001 (R-3, R-4) | `artifact-digest.test.ts` on Node 24.21.0 | PASS | MOCKED | NOT_APPLICABLE | Five frozen vectors and authored workflows equal. Malformed corpus: more than 90 serialized cases rejected by both implementations. Object-only malformations rejected. `raw-response` bounds equal. Unsupported kinds rejected. Self-check fails closed and is never cached. |
| B003B-SIMULATION-001 (R-2) | `mocked-chain.test.ts` arithmetic | PASS | MOCKED | NOT_APPLICABLE | All 13 plan vectors; 1,000 seeded amounts per direction satisfy the floor-property oracle; cap-plus-one and ineligible slippage rejected |
| B003B-LINK-001 (R-5) | Chain review tamper table | PASS | MOCKED | NOT_APPLICABLE | 45 single mutations, each rejected with its code and no mutation of input; stale, expired and backwards-clock findings |
| B003B-INVALIDATION-001 (R-5, R-7) | `artifact-chain.test.ts` | PASS | MOCKED | NOT_APPLICABLE | Every transition including discarded stale completion; guard for revision, identity, wall, backwards and monotonic expiry; mirror equals frozen matrix |
| B003B-QUOTE-001 (R-6) | Frozen-contract integration test | PASS | MOCKED | NOT_APPLICABLE | Every generated artifact passes frozen `parseArtifactBytes`; review hashes equal frozen `hashArtifactBytes`; refresh keeps the IR hash only |
| Unit and integration suite | `pnpm test` | PASS | MOCKED | NOT_APPLICABLE | 19 files and 155 tests passed (BUILD-003A ended at 15 files and 108 tests) |
| Linter package | Compiled root export and self-check (CI command) | PASS | MOCKED | NOT_APPLICABLE | Nine function exports resolve; profile frozen; self-check passes |
| B003B-HONESTY-001, B003B-BOUNDARY-001 (R-1, R-8) | `mock-artifact-chain.spec.ts` | PASS | MOCKED | NOT_APPLICABLE | Six labelled values each carry `MOCKED` and the rate. Negative disclosures are present, with no currency or USD amount and no unnegated "live". No enabled authority control. Execute unavailable after generation. |
| R-3, R-7 in the browser | E2E self-check failure and clock tests | PASS | MOCKED | NOT_APPLICABLE | Replaced digest shows the explicit alert with nothing generated. Expiry is detected on `visibilitychange`, `focus`, JSON access and Refresh with no timer fired, including with a backwards clock. |
| R-5, R-6 in the browser | E2E frozen verification of rendered JSON | PASS | MOCKED | NOT_APPLICABLE | Both directions: displayed hashes, links and revision verified with frozen functions; chat and canvas artifacts identical |
| Full browser suite | Guarded Playwright, two consecutive runs | PASS | MOCKED | NOT_APPLICABLE | 23 tests passed in each of three full runs: two consecutive runs after baseline acceptance and a final run on a forced fresh build. All eight snapshots passed at zero pixels, and the loopback guard stayed clean. |
| B003B-VISUAL-001 | Before, after and diff review, then zero-pixel reruns | PASS | MOCKED | NOT_APPLICABLE | See the visual evidence below |
| B003B-GOVERNANCE-001 | Both governance blocks on the final tree, plus isolated negative copies | PASS | MOCKED | NOT_APPLICABLE | Block 1: historical BUILD-002, amendment and BUILD-003A trees plus the exact current BUILD-003B scope, modes, protected bytes, source scans and legal hashes passed. Block 2: 195 text files scanned for secret indicators, 174 authored files for email, brand and claim rules, 31 Markdown files link-checked, 25 protected digests, 19 decision IDs and 72 requirement IDs. 14 isolated negative mutations were each rejected with the expected message; the unchanged copy passed before and after; the working tree was not mutated. |
| Test strength | Two deliberate source mutations, then restored | PASS | MOCKED | NOT_APPLICABLE | Removing the authority-field check and the monotonic expiry rule each failed a test; files restored byte-for-byte |

No row claims `FORK_REPRODUCED`, `TESTNET_EXECUTED`, `MAINNET_EXECUTED` or any
financial outcome.

### Browser digest rules stricter than the frozen implementation

For JSON-serializable input, the browser digest applies the same byte, depth,
token, key, number, surrogate, schema and invariant limits as the frozen raw
ingress path. It is stricter only for input that JSON bytes cannot express:

- objects with a null prototype, which the frozen object path accepts;
- `undefined`, function, bigint and symbol values;
- any non-`Uint8Array` raw-response input;
- every kind other than the four artifact kinds and `raw-response`.

The chain review additionally enforces the closed BUILD-003B mocked profile.

### Visual evidence

| State | Before SHA-256 | Accepted SHA-256 | Diff SHA-256 | Strict RGB changed pixels |
|---|---|---|---|---:|
| Build | `96c85d8e90d5d7d4316814a71ce39db2364d598d63060f17ce8e8c9dab7a05d5` | `c21899cdb7f355bd5d7391906ebe3961d1e3c34ae575dd2f034424532e377268` | `40a51337a88a6227663b798d10494fd481dbc3124fbd3324fde1e5a6807f66cf` | 17574 |
| Simulate | `71e8e6a6a22e48f99be3a1b21ef970bc6a7af340d7eb4c3c1511c7cb32ba6dd1` | `575822399c07b491d36b056c19addf4020e46e7bbef4e873bec340cd897988ea` | `ba74043f49a951811fa54003e71bbe50ea5980541eb8cc3a80c148af08927acc` | 642842 |
| Execute | `210de9abc83fb0863073a0326f4ff8a8fcd7733795bf195c190b1f3830322e2c` | `73d2e48cc04228c5ed48aa2154607958515a86272f9425f9e23c8d39af8bc395` | `6ee103b3cce42a69b32469d1dfe91e23aac043b3b01b5b594de3e34c6471b0e5` | 38054 |
| Proposal | `28135facd0c1647e4a51fc65851d56afb468caf1b28d54ccf578eee8df26d466` | `4ba686dbcb28391da053ca0701fa922ac594046d42202752507718fed83ac97e` | `0a474b203554a4cb0ae7f5b6a3f8bec3a3b3a4eb978a351b2099854541f8eb63` | 17574 |
| Review blocked | `8007847673d2e2eb3f9a43a2518db469023c61b2c21921a735ca99d2f35a7164` | `029f95d9577900a8f5988df6c522ad54a2517a2ad93d55134adc47261be6170d` | `9cab8b3fb632af696ffdcfbef63df40bda24ce195bdc03e318469193faf2b29a` | 22988 |

The method followed the approved plan:

- The five before images are the baselines at `36dd05e`. Fresh captures from
  the unchanged build, with the verified browser at 1440×900, en-US, light
  theme and reduced motion, were pixel-identical to them.
- After images were captured the same way and inspected against the approved
  table. Every difference is one of:
  - the `BUILD-003B` top-bar label, which shifts the centred tab text by a
    subpixel;
  - the tab-aware footer action and chain chip;
  - the review copy;
  - the Execute copy;
  - the new Simulate content (the page height grows from 900 to 1010 pixels).
- No other region changed.
- Playwright then wrote the accepted baselines. Each is pixel-identical to the
  inspected after image.

The three new snapshots were inspected before acceptance:

- `simulate-current`: `352547e98c9f1504ed64e6f25e41fe2efa35009f774f105bd2ca5d49f018eaa3`
- `simulate-invalidated`: `df82b185fc2b0ad087ed4924ae2aa329a2db2a0aa79673dbd829c5c0f14f2467`
- `simulate-expired`: `e4b907e663f7e9383390fb6ab38f3832666c6c54a947cecf49c59f46b8344707`

All eight snapshots then passed twice at `maxDiffPixels: 0`, with no masking or
widened tolerance.

### Remote CI

Not part of this commit. The push and pull-request CI results are reported with
the delivery, separately from this local record. A local pass is not a claim
about remote CI.

### Checks not performed or limited

- No on-chain read, deployed bytecode comparison, market data or financial
  simulation was performed; asset metadata remains `NOT_ONCHAIN_VERIFIED`.
- The audit is a point-in-time registry result.
- The browser archive digest is locally observed and human-approved, not a
  publisher signature.
- Expiry uses the local clocks and is application review, not enforcement.
- The "every content accessor calls the guard" property is shown by
  construction (the panel, graph overlay, JSON, chip and Refresh read content
  only through `checkChainAccess`) and by E2E access paths, not by a React
  component test.

## 6. Acceptance criteria

- [x] Schema-valid v1 artifacts match the profile in both directions and pass
  frozen `parseArtifactBytes`.
- [x] R-1: every generated number has `MOCKED` and the synthetic rate beside
  it. Negative disclosures are shown, and nothing fabricated appears.
- [x] R-2: exact round-down arithmetic, every vector and the floor-property
  oracle, in both directions.
- [x] R-3: a failed self-check prevents generation, withdraws any chain and
  shows the explicit alert.
- [x] R-4: equal digests on the pinned toolchain, and frozen rejection implies
  browser rejection.
- [x] R-5: every reference is recomputed; tampered or mislinked chains are
  rejected; stale and expired chains are refused for use.
- [x] R-6: displayed JSON parses with frozen ingress and carries `MOCKED`
  provenance.
- [x] R-7: expiry is detected on access and resume without timers, including
  backwards and monotonic cases.
- [x] R-8: Execute and Manifest review are unavailable in every chain state;
  the workflow stays `DRAFT`; no authority-shaped artifact exists.
- [x] Semantic edits, refresh and stale completion follow the frozen matrix;
  presentation events, no-ops, dismissals and rejected edits do not
  invalidate.
- [x] Chat-created and canvas-created artifacts are identical.
- [x] Five changed snapshots are accounted for; three new states pass at zero
  pixels; keyboard and 375/768/1280 checks pass.
- [x] Protected identities are unchanged: frozen contracts, 10 schemas, 20
  fixtures, patches, 21 upstream legal files and historical records including
  BUILD-003A.
- [x] Registry resolutions are unchanged; only the linter importer changed;
  dependency, license, audit and SBOM checks pass.
- [x] Historical and current governance gates pass, and the new scans fail in
  isolated negative copies.
- [ ] Remote CI — not performed within this commit; see §5.

## 7. Security

- **Threats tested:**
  - forged markers, sources, adapters and providers;
  - injected spender, recipient, contract, fee and gas values;
  - inflated outputs and wrong assets or chains;
  - coverage, revision and generation mismatches, and hash-link tampering;
  - stale, expired, backwards-clock and racing completions;
  - failing digest environments;
  - malformed, oversized, cyclic and object-only inputs;
  - forged `executable` fields.
- **Authority bypasses tested outside the UI:** not applicable. No authority
  exists. Chain-review tests call the linter directly, outside the UI.
- **Effective enforcement locations:** none. Every limit is `NOT_ENFORCED`;
  the chain review and access guard are application review.
- **Remaining active permissions:** none.
- **Findings:** during design review, the Next.js route announcer also has
  `role="alert"`, so one E2E selector was narrowed to the error banner. No
  product defect was found.
- **Open findings:** none.
- **Secrets and logs reviewed:** YES. Governance secret and email scans
  passed, and no credentials were used or stored.

## 8. Licenses

- **AGPL code changed:** `apps/reference-dapp/**` and
  `packages/reference-linter/**`, both already AGPL-3.0-only with unchanged
  official LICENSE copies.
- **Apache code changed:** governance documents, workflows, the verifier and
  the lockfile.
- **Dependencies added:** one direct edge from the linter to the approved,
  locked, unmodified `canonicalize@5.0.0` (Apache-2.0). No new registry
  resolution and no license-exception change.
- **Incompatibilities found:** none. Bundle distribution remains unapproved.

## 9. Deviations from the plan

- **Two additive linter exports.** `digestSelfCheck` and `mockedFixtureBytes`
  are needed to run the R-3 self-check before building and to derive
  `rawResponseHash` without duplicating the fixture. They live in the approved
  files, and the plan text lists them. Export maps, versions and packages are
  unchanged.
- **E2E wording.** The plan bullet listing "output zero" as ineligible was
  corrected to match the plan's §3.5 rule 4: a zero output generates a chain
  carrying the BLOCK finding.
- **Plan counts and disclosures.** The owner-approved consistency corrections
  (the 25/34/59 counts and permitted negative disclosures) were recorded in the
  plan before implementation.
- **Additional rejection codes.** Beyond the plan's list, the arithmetic
  helper reports `INVALID_ARITHMETIC_INPUT`, `INVALID_ASSET_PAIR`,
  `INVALID_AMOUNT`, `AMOUNT_OUT_OF_RANGE` and `SLIPPAGE_NOT_ELIGIBLE`, and the
  digest reports specific ingress codes. All are fail-closed and stricter, not
  broader.

## 10. Demonstrable state

- **What can be demonstrated, and under which authorization mode:** local
  authoring and a `MOCKED` artifact chain, under authorization mode `NONE`.
- `MOCKED`: the interface, the artifact chain, its links, freshness and
  invalidation.
- `FORK_REPRODUCED`, `TESTNET_EXECUTED`, `MAINNET_EXECUTED`: none.
- `CONFIRMED_NOT_RECONCILED`, `RECONCILED`, `INCONCLUSIVE`, `DIVERGENT`: none.

## 11. Technical debt created

- **Stale footer label.** The Build canvas footer still reads "Swap connections
  unavailable in BUILD-003A". The statement is still true, but it is left as
  is to keep Build rendering unchanged, as approved.
- **Duplicated hash profile.** The browser digest is a second implementation of
  the frozen profile, kept honest by differential tests. A future
  browser-compatible contract entry point would remove the duplication.
- **Profile location.** The mocked profile lives in the linter. The first
  non-mock quote or simulation should move generation to the reserved
  `packages/reference-simulation/**`.
- **No first-class environment field.** v1 Quote/State and Simulation Bundle
  schemas have no evidence-environment field (C-1); a future schema version
  should add one.

## 12. Suggestions for the next build — NOT APPROVED

1. **Record the BUILD-003B delivery facts** in a small records-only change after
   merge, as B003A-DELIVERY-001 did for BUILD-003A.
   - Benefit: truthful living records.
   - Cost: low.
   - Risk: low.
   - Relationship to v3.2: governance truthfulness.
   - Recommendation: implement, or fold into the next approved build.
2. **Plan BUILD-003C** (Policy, Manifest, exact payload, decoding and fork
   evidence) only after an ADR choosing the fork environment and data sources.
   - Benefit: moves Phase 2 toward Mode A payload fidelity.
   - Cost: high.
   - Risk: financial-surface expansion.
   - Relationship to v3.2: Build 003 and Gate 3.
   - Recommendation: defer until explicitly requested.

## 13. Next-build options

- **Option A — recommended:** review and merge PR delivery for BUILD-003B, then
  a records-only update of the delivery facts.
- **Option B:** prepare a BUILD-003C plan for review only.
- **Option C — defer:** keep `NONE_APPROVED`.

## 14. Required human decision

After reviewing the BUILD-003B pull request and its CI, do you want to merge it
and then approve a records-only update of its delivery facts, without starting
BUILD-003C?
