# BUILD-003B — Mocked Quote/State and Simulation artifact chain

Status: `IMPLEMENTATION_APPROVED` by the human owner on 2026-09-24. On that
date the owner:

- selected design choices D-1, D-2 and D-3 as recommended (§13);
- added eight acceptance requirements, traced in §5.1;
- confirmed that "exported JSON" means the complete copyable per-artifact JSON
  block, with no file-download control;
- approved two consistency corrections: the exact §11 counts (25 created and
  34 modified, 59 paths) and the permitted "not modeled" disclosures in R-1
  (§3.10);
- then explicitly approved implementation of this plan, including D-1 to D-3,
  R-1 to R-8, the exact §11 paths, the visual changes and the governance
  transition.

The approval authorizes implementation on
`codex/build-003b-mocked-artifact-chain` from baseline
`36dd05e2bcea2d9a19c7b571d2126aea0390e5dd`, the commit titled "Implement
Build 003B mocked artifact chain", an SSH push if authentication is available,
and a pull request into `main` opened with the authenticated GitHub CLI. It
does not approve merging, BUILD-003C, Mode B, live protocol access, wallet,
signing, submission or financial execution. No Claude conversation or private
memory is an authority source.

The owner asked for eight plan items. They map to the mandatory thirteen-section
template (Master Prompt §5.1) as follows:

| Requested item | Section |
|---|---|
| Objective and user-visible behavior | 1 |
| Included and excluded scope | 3 and 4 |
| Contract and artifact design | 3.1–3.9 and 7 |
| Exact proposed file changes | 11 |
| Dependency and licensing implications | 3.11 and 10 |
| Meaningful tests and acceptance criteria | 5 (owner requirements R-1 to R-8 in 5.1) and 6 |
| Governance and CI changes | 3.12 |
| Decisions requiring human input | 13 |

## 1. Single objective

For every isolated Base swap authored under BUILD-003A, generate on request a
visibly `MOCKED`, hash-linked chain: Quote/State Artifact, Artifact Set and
Simulation Bundle. The chain is bound to one Semantic Workflow IR revision and
is invalidated when that revision or its freshness no longer holds. It
authorizes nothing and executes nothing.

### User-visible behavior in the existing application

1. **Build (unchanged authoring).** The user authors a USDC↔WETH swap on Base
   through chat or the canvas form, exactly as in BUILD-003A. The footer's
   primary action changes from the disabled "Simulate unavailable" to
   **Open mocked simulation**, which switches to the Simulate tab.
2. **Simulate (new content in the existing tab).** The tab no longer says "not
   implemented". It shows the current revision and a **Generate mocked
   artifacts for revision N** button. Before generation, the page states that
   the button produces synthetic fixture data, not a market quote or a
   financial simulation.
3. **After generation**, the tab shows:
   - a chain strip: IR revision and `semanticWorkflowHash` → one Quote/State
     Artifact per swap → Artifact Set → Simulation Bundle, each with its full
     hash, a `MOCKED` badge and a `CURRENT` status;
   - a read-only copy of the canvas. Swap cards show the mocked expected and
     minimum output. Mock nodes are marked "not simulated (mock action)";
   - a result table per swap: input, expected output, minimum at the authored
     slippage, adverse outcome and the revert failure path. Values have
     explicit asset, chain and native units;
   - beside every generated number, in the table and on the graph cards, the
     `MOCKED` classification and the text "synthetic rate 1 WETH = 1,000
     USDC" (R-1);
   - an enforcement table. Maximum input, maximum slippage, the mocked minimum
     output and the prototype cap are each `NOT_ENFORCED`;
   - a "Not modeled" block: balances, allowances, gas, fees, price impact,
     liquidity, MEV, duration and USD values;
   - collapsible, copyable JSON for each artifact. The `MOCKED` provenance is
     inside the JSON itself (R-6);
   - the generation time and the 60-second mock validity deadline, as
     static text with no countdown;
   - a disabled next step: **Manifest review unavailable**. BUILD-003B stops
     before authorization.
4. **Invalidation.** An accepted amount, slippage, lock, add, remove or connect
   edit creates a new revision. The chain then shows `INVALIDATED` with the
   reason (semantic edit, revision r → r+1) and the frozen list of dependent
   artifacts. Its numbers and JSON are no longer displayed. Regeneration for
   the new revision is required. Dismissed or rejected proposals, no-ops, tab
   switches and node selection change nothing.
5. **Expiry.** Validity is re-checked whenever the chain is accessed or used
   and whenever the tab resumes (R-7). Once 60 seconds have passed, the chain
   shows `EXPIRED`, hides its numbers and JSON, and requires regeneration.
   **Refresh mocked quote** at the same revision replaces the quote, Artifact
   Set and Simulation Bundle and their hashes. The IR hash stays unchanged.
6. **Execute** stays unavailable in every chain state, including right after a
   successful generation (R-8). Its copy says that mocked artifacts cannot
   authorize execution. The workflow never leaves `DRAFT`.

The user cannot obtain a live or market quote, read a balance, connect a
wallet, see a router, spender or recipient, estimate gas or fees, review a
Manifest, sign, approve, submit or reconcile.

## 2. Relationship to v3.2

- **Sources.** Master Spec §5.2 (steps 4–6), §7.1–7.9, §9.1, §10, §16.1, §21
  Phase 2 and Gate 2. Master Prompt §2.1–2.2, §2.6, §4.1 (P6, P7, P10), Build
  003, §8.3, §9.4–9.7 and §11. ADR-0002, the canonicalization, compatibility
  and invalidation documents, and DEC-0015.
- **Preserved differentiators.** One revisioned IR stays the only authoring
  source. Observations, simulation and authority stay separate from it. The IR
  is never mutated by an artifact. AI is not involved. The artifacts are
  evidence-shaped data and never authority.
- **Product gate.** P6 (source, timestamp, validity, provenance visible) and P7
  (Simulation Bundle propagation and failure paths) are shown **only in mocked
  form**. P10 (deterministic mock labelled `MOCKED`) applies to the chain logic.
  No primitive is certified. P8, P9 and P11–P14 are untouched. Complete Build
  003 and Phase 2 remain open.
- **Dependencies and certification state.** BUILD-001 contracts, the BUILD-002
  shell and BUILD-003A authoring and lint are merged. ADR-0001 is `PROPOSED`.
  DEC-0015 permits separately approved non-executing Mode A work. BUILD-003B
  and BUILD-003C are `NOT_APPROVED`.
- **Proposed split of Build 003.** This is not a plan for BUILD-003C.

| Build 003 item | Sub-build |
|---|---|
| Create the swap through chat and canvas; prove equivalence | 003A, merged |
| Create validated Quote and State Artifacts | 003B mocked shape and links; real sources later |
| Simulate the direct-transaction path | 003B mocked chain mechanics; real simulation later |
| Policy, Manifest, enforcement matrix, payload hash, decoding, signing, submission, persistence, recovery, reconciliation, Evidence Bundle | Later, not approved |
| Injected expired quote and excessive slippage | 003B, mocked form only |
| Injected changed recipient and unknown spender | 003B rejects forged fields only |
| Injected manipulated calldata, insufficient balance, inconsistent RPC | Later, not approved |

### Planning baseline and delivery state (verified 2026-09-24)

- The working tree was clean. Local `main`, local `origin/main` and GitHub
  `main` (authenticated GitHub API) all resolve to
  `36dd05e2bcea2d9a19c7b571d2126aea0390e5dd`.
- That commit merges PR #7. The PR was merged at 2026-09-24T00:54:40Z by the
  owner account. Head `07bfae0716c4bb383a844275d0b42c840ec197f7`, base
  `14a94584b0a3119c1f6275a05b9e752dafe0a042`. The merge tree equals the head
  tree `ccff3943e7ae8273ec25de8878f96fff1903aa54`.
- PR checks passed: Governance runs 35939197467 and 35939261995, and
  contracts/app runs 35939197471 and 35939261865.
- Checks after the merge push also passed: Governance run 35940556463 (job
  107447291303) and contracts/app run 35940556433 (job 107447291249).
- `docs/builds/BUILD-003A-REPORT.md` still says remote CI was "Not performed"
  and that the SSH push failed. That was accurate when written. The report stays
  byte-identical (SHA-256
  `b03f5e13eb7d7e77ab4baee86f17274875eb80637c70949b57fa03b009047a08`). The
  merge and CI facts above are recorded in the living records instead
  (§3.12).
- The local reflog records a successful push of the BUILD-003A branch at
  2026-09-24 01:36:46 +0100 and a `pull --ff-only` of `main` at 01:54:58 +0100.
  In this planning session, `git fetch` over the same SSH remote failed with
  `Permission denied (publickey)`, and no SSH agent is reachable from the
  agent's shell. The agent therefore cannot currently push. Transport settings
  were not changed.
- The planning branch was created from that exact baseline. No remote branch
  exists.

### Planning feasibility check (not implementation evidence)

A throwaway script in the session scratchpad tested the key technical premise.
It ran on the PATH Node 25.9.0, not the pinned 24.21.0 toolchain. It used only
`globalThis.crypto.subtle`, the locked `canonicalize@5.0.0` and explicit field
projections.

- It reproduced the frozen digests of the five relevant vectors in
  `tests/compatibility/v1/hash-vectors.json`: semantic-workflow,
  quote-state-artifact, artifact-set, simulation-bundle and raw-response.
- The unchanged frozen `hashArtifactBytes` accepted an authored two-node IR and
  a mocked quote, Artifact Set and Simulation Bundle shaped as in §3.3–3.5,
  with equal digests. That function validates its input first.
- The frozen transition table rejected `DRAFT` → `AUTHORIZED`.
- Removing the `MOCKED` marker changed the quote hash.

The script is not retained. It only shows feasibility and proves nothing about
the implementation.

### Proposed requirement IDs (to be registered only after approval)

| Proposed ID | Requirement and source |
|---|---|
| B003B-QUOTE-001 | One `MOCKED` Quote/State Artifact per swap node, with synthetic provenance, freshness and hashed mock markers; §7.5, P6, P10 |
| B003B-SIMULATION-001 | `MOCKED` Simulation Bundle bound to one IR revision and one Artifact Set, with expected, minimum and adverse outputs and a failure path; §7.6, §10, P7, P10 |
| B003B-LINK-001 | Every hash and revision link is recomputed and verified; broken links fail closed; §7.1, §7.9, Gate 2 |
| B003B-HASH-001 | The browser digest equals frozen DWE-HASH v1 for every supported domain; ADR-0002, §7.9 |
| B003B-INVALIDATION-001 | Semantic edit, quote refresh, expiry and stale completion follow the frozen matrix; §7.8, `INVALIDATION_V1` |
| B003B-BOUNDARY-001 | Mocked artifacts cannot create or unlock authorization or execution; §8.5, §16.1, Prompt §8.3 |
| B003B-HONESTY-001 | Synthetic values are visibly `MOCKED`; unmodeled costs are disclosed, never estimated; §7.7, Prompt §9.4, §9.6 |
| B003B-VISUAL-001 | Reviewed visual changes, then zero-pixel regression; Prompt §9.7 |
| B003B-COMPATIBILITY-001 | Frozen schemas, fixtures, hash profile and contract packages unchanged; additive linter exports; ADR-0002 |
| B003B-SUPPLY-001 | No new registry resolution; one new direct edge to the approved `canonicalize@5.0.0` pin; Prompt §8 |
| B003B-GOVERNANCE-001 | BUILD-003A scope pinned historically and the exact BUILD-003B scope enforced; Prompt §5 |
| B003A-DELIVERY-001 | Retrospective: BUILD-003A merged through PR #7 with PR and post-merge CI passing; Prompt §5.5 |

## 3. Authorized scope

Nothing in this section is authorized until the human owner approves this plan.

### 3.1 Artifact chain and stopping point

```text
Semantic Workflow IR revision N          existing, immutable; semanticWorkflowHash
 └─ one Quote/State Artifact per swap    MOCKED; quote-state-artifact digest
     └─ Artifact Set                     artifactSetHash
         └─ Simulation Bundle            MOCKED; simulationHash
             └─ STOP. No Authorization Policy, Strategy Manifest, Execution Plan,
                payload or intent hash, Execution Journal or Evidence Bundle.
```

All three new artifacts use the frozen v1 schemas unchanged. No new wire schema
is created, and no serialized import is added. The chain is in-memory
presentation state held outside the IR. Page reload clears it, as with
BUILD-003A proposals.

Generation is always an explicit user action. It never runs automatically after
an edit. The owner selected this stopping point under D-1 (§13).

**Exported JSON (R-6).** The only artifact JSON that leaves the interface is
the per-artifact JSON block in Simulate, which the user can select and copy.
It shows the complete artifact exactly as hashed: pretty-printed, with no
wrapper and no omitted or renamed fields. `MOCKED` provenance is therefore
carried inside the JSON:

- in every artifact ID (`MOCKED.` prefix);
- in the quote's `evidence-environment` value, `sourceId`, adapter and
  uncertainty codes;
- in the simulation's adapter, uncertainty codes and notes.

Removing any of these changes the hash and breaks the chain links (C-1). The
same provenance is shown in the interface. A file-download control is not
included.

### 3.2 Contract reuse and compatibility issues

Reused unchanged: the `QuoteStateArtifact`, `ArtifactSet`, `SimulationBundle`
and `SemanticWorkflow` types (type-only imports); the three v1 JSON schemas and
the workflow schema through the existing `./schemas/v1/*.schema.json` export;
the DWE-HASH v1 profile; the `INVALIDATION` matrix; the workflow transition
table; the reference registry context; and the BUILD-003A validation and lint.

| ID | Compatibility issue found | BUILD-003B treatment |
|---|---|---|
| C-1 | Quote/State and Simulation Bundle v1 have no evidence-environment field | Carry `MOCKED` in hashed fields: normalized value `evidence-environment` = `MOCKED`, fixed `sourceId`, adapter and uncertainty codes. Stripping any of them changes the hash and breaks links. A first-class field needs a future schema/profile version under COMPATIBILITY_V1, outside this build. |
| C-2 | `chainPosition` requires a BLOCK or SLOT height | Use sentinel `BLOCK` height `0`, always paired with the `NO_CHAIN_STATE_READ` uncertainty code. Never display it as a block reference. |
| C-3 | Frozen hashing is Node-only (`node:crypto`, `Buffer`), and `schemas.ts` imports `node:util` | Add a browser-safe digest (§3.6) with differential verification against the frozen implementation. Frozen packages are untouched. |
| C-4 | Frozen shared invariants (uint256, timestamps, decimals, bounds, freshness order) are not browser-reachable | Re-check the subset these artifacts use in the chain review. Every generated artifact also passes frozen `parseArtifactBytes` in Node tests and E2E. |
| C-5 | v1 validation does not verify cross-artifact hash or revision links | The chain review recomputes all links (§3.7). No contract change. |
| C-6 | The Simulation Bundle has one `freshness` object | Use the earliest quote freshness. All quotes in one generation share it. |
| C-7 | `ARTIFACT_EXPIRED` does not list the expired quote itself | Label the expired quote `EXPIRED`. Invalidate exactly the frozen dependents. |
| C-8 | `registryValidation.result` has only `CONTRACT_VALIDATED` and `REJECTED` | Use `CONTRACT_VALIDATED` to mean "shape and registry declaration match". The UI never presents it as market or on-chain validation. |

The BUILD-003A finding `UNQUOTED_EXECUTION_UNAVAILABLE` stays unchanged. A
mocked chain is not a live quote, and the IR's `minimumAmount` stays `"0"`.

### 3.3 Mocked Quote/State Artifact profile (one per swap node)

| Field | Exact BUILD-003B value | Review rule |
|---|---|---|
| `schemaVersion` | `1.0.0` | Frozen |
| `artifactId` | `MOCKED.quote.<nodeId>.r<revision>.g<generation>` | Same `r` and `g` across the chain |
| `semanticWorkflowHash` | Digest of the source IR | Equals recomputation |
| `nodeId` | The swap node | Exactly one quote per swap node; none for mock nodes |
| `sourceId` | `mock.synthetic-fixture` | Anything else: `LIVE_SOURCE_NOT_APPROVED` |
| `adapter` | `{ "id": "mock.fixture-quote", "version": "1.0.0" }` | Exact; not a registry adapter; the registry adapter list stays empty |
| `chainId` | The node chain, `eip155:8453` | Equals node chain |
| `chainPosition` | `{ "kind": "BLOCK", "height": 0 }` | Sentinel (C-2) |
| `retrievedAt` | Local generation time, UTC, millisecond ISO | Equals `freshness.observedAt` |
| `freshness` | `expiresAt` = `observedAt` + 60 s; `maximumAgeSeconds` 60 | Exact |
| `rawResponseHash` | `raw-response` digest of the canonical fixture bytes | Equals recomputation |
| `normalizedValues` | Five entries, in order: `evidence-environment` IDENTIFIER `MOCKED`; `fixture-id` IDENTIFIER `build-003b.synthetic-rate.v1`; `amount-in` QUANTITY equal to the IR input; `rate-base` QUANTITY 1 WETH; `rate-quote` QUANTITY 1,000 USDC | Exact |
| `providerReference` | `{ "kind": "NONE" }` | ROUTE or ORDER rejected |
| `proposedContracts`, `proposedSpenders`, `proposedRecipients` | `[]` | Any entry: `AUTHORITY_FIELDS_FORBIDDEN` |
| `fees`, `gas` | `[]` | Not modeled. Any entry would be fabricated and is rejected. |
| `outputBounds` | One `amount-out` entry from §3.5 | Equals recomputation |
| `uncertainty` | Fixed ordered codes: `MOCKED_SYNTHETIC_DATA`, `SYNTHETIC_RATE`, `NO_CHAIN_STATE_READ`, `GAS_NOT_MODELED`, `FEES_NOT_MODELED`, `PRICE_IMPACT_NOT_MODELED` | Exact codes and fixed descriptions |
| `registryValidation` | `1.0.0`, `asset.swap.exact-input`, `CONTRACT_VALIDATED`, `NOT_ENFORCED` | Exact (C-8) |

The synthetic fixture is a frozen constant in the BUILD-003B review profile
(§3.7). It is not registry data and cannot be edited through chat, forms, the
IR or a query parameter. The owner selected its rate and the 60-second
validity rule under D-3.

### 3.4 Artifact Set profile

`artifactSetId` is `MOCKED.artifact-set.r<revision>.g<generation>`.
`semanticWorkflowHash` is the source IR digest. `artifacts` holds one
`{artifactId, nodeId, artifactHash}` entry per quote. Each `artifactHash` equals
the quote's recomputed digest. IDs and hashes are unique, as the frozen
invariant requires. Ordering follows the frozen hash projection.

### 3.5 Mocked Simulation Bundle profile and arithmetic

| Field | Value |
|---|---|
| `simulationId` | `MOCKED.simulation.r<revision>.g<generation>` |
| `semanticWorkflowRevision`, `semanticWorkflowHash` | Source IR revision and digest |
| `artifactSetHash` | Recomputed Artifact Set digest |
| `adapters` / `contracts` | `[mock.fixture-quote 1.0.0]` / `[]` |
| `outputs` | Per swap node, ordered by `nodeId`: `amount-out` expected, minimum and adverse |
| `propagatedOutputs` | `[]`; swap edges remain unsupported |
| `failurePaths` | Per swap: failed node, no blocked nodes, residual = the full input quantity |
| `uncertainty` | The quote codes, plus `MOCK_NODES_EXCLUDED` when mock nodes exist |
| `unsupportedAssumptions` | Fixed notes: synthetic fixture, not a financial simulation; nothing read or modeled; adverse equals the slippage minimum and anything below it is a modeled revert; mock nodes not simulated (when present) |
| `freshness` | Earliest quote freshness (C-6) |

**Arithmetic and rounding rules (R-2).** All amounts are non-negative integer
native units held as BigInt. No floating point is used, amounts never pass
through `Number`, and there is no decimal library. Display converts native
units to decimal text only by the existing string padding
(`formatHumanAmount`), never by division.

1. **Conversion rounds down.**
   `expected = floor(amountIn × rateOut / rateIn)`, where `rateIn` and
   `rateOut` are the fixture quantities of the input and output assets
   (1 WETH = 10^18 units, 1,000 USDC = 10^9 units). The remainder is
   discarded, so the mocked output is never overstated.
2. **Minimum rounds down from the rounded expected value.**
   `minimum = floor(expected × (10,000 − bps) / 10,000)`. It is never computed
   from an unrounded intermediate.
3. **Adverse equals minimum.** This is the worst outcome accepted under the
   authored bound. A move beyond it appears only as the revert failure path.
4. **Zero outputs block.** If `expected` or `minimum` is `0`, the chain gets
   the BLOCK finding `MOCKED_OUTPUT_ZERO`.
5. **Domain.** `amountIn` is 1 to the per-asset cap, which BUILD-003A already
   enforces. `bps` is 0 to 300, because any higher value is a BLOCK that makes
   generation ineligible (§3.8). The largest intermediate product is below
   10^35, far inside uint256. Outputs are still checked against uint256.

Boundary and worked vectors, all satisfying the floor properties
`expected × rateIn ≤ amountIn × rateOut < (expected + 1) × rateIn` and
`minimum × 10,000 ≤ expected × (10,000 − bps) < (minimum + 1) × 10,000`:

| Direction | Input units | bps | Expected units | Minimum units | Case |
|---|---|---|---|---|---|
| USDC→WETH | 1 | 0 | 1000000000 | 1000000000 | Smallest input |
| USDC→WETH | 1 | 300 | 1000000000 | 970000000 | Largest eligible slippage |
| USDC→WETH | 2250000 (2.25 USDC) | 50 | 2250000000000000 | 2238750000000000 | Worked example |
| USDC→WETH | 1000000000000 (cap) | 0 | 1000000000000000000000 | 1000000000000000000000 | Cap |
| USDC→WETH | 1000000000000 (cap) | 300 | 1000000000000000000000 | 970000000000000000000 | Cap at the largest eligible slippage |
| WETH→USDC | 999999999 | 0 | 0 | 0 | `MOCKED_OUTPUT_ZERO` |
| WETH→USDC | 1000000000 | 0 | 1 | 1 | Smallest nonzero output |
| WETH→USDC | 1000000000 | 1 | 1 | 0 | Minimum rounds to zero: `MOCKED_OUTPUT_ZERO` |
| WETH→USDC | 1999999999 | 0 | 1 | 1 | Conversion remainder discarded |
| WETH→USDC | 125000001000000000 | 1 | 125000001 | 124987500 | Minimum remainder discarded |
| WETH→USDC | 125000000000000000 (0.125 WETH) | 50 | 125000000 | 124375000 | Worked example |
| WETH→USDC | 1000000000000000000000 (cap) | 0 | 1000000000000 | 1000000000000 | Cap |
| WETH→USDC | 1000000000000000000000 (cap) | 300 | 1000000000000 | 970000000000 | Cap at the largest eligible slippage |

Cap-plus-one inputs and slippage of 301 bps or more never reach the arithmetic:
the first is rejected by BUILD-003A validation, and the second makes
generation ineligible. Tests confirm both. The simulation minimum never feeds
back into the IR, and the IR `minimumAmount` stays `"0"`.

### 3.6 Browser-safe digest

The digest lives in the new file `packages/reference-linter/src/artifact-digest.ts`
and is exported as:

- `digestArtifact(kind, value): Promise<string>`;
- `digestRawResponse(bytes): Promise<string>`;
- `digestSelfCheck(): Promise<void>`, which runs the R-3 self-check.

It supports exactly four structured kinds (`semantic-workflow`,
`quote-state-artifact`, `artifact-set`, `simulation-bundle`) and the
`raw-response` domain. The `payload`, `intent`, policy, manifest, plan, journal
and evidence domains are deliberately absent, and a request for one throws. The
browser therefore has no means to produce a `payloadHash` or `intentHash`.

The pipeline is:

1. BUILD-003A bounded ingress: depth 64, 1 MiB, plain objects only, no
   accessors, cycles or lone surrogates, safe integers only.
2. Closed Ajv validation against the frozen exported schema.
3. `structuredClone` and the frozen v1 ordering rules for `semantic-workflow`
   and `artifact-set`.
4. An explicit field projection that must equal the schema's `properties` keys.
5. RFC 8785 through `canonicalize@5.0.0`, encoded as UTF-8.
6. DWE-HASH framing with profile byte `0x01`.
7. SHA-256 through `globalThis.crypto.subtle`, output as `0x` plus lowercase hex.

The owner selected this design under D-2 (§13).

**Self-check (R-3).** Before every generation and every chain review, the
digest hashes the embedded v1 semantic-workflow vector and compares the result
with its known digest,
`0xb0446d65c8341fecbbd5e8bf3f3c75c540064d13c296099361d3a3e57dd0c918`. A pass
is never cached. The self-check fails if the digest differs, if
`crypto.subtle` is missing, or if hashing throws. On failure:

- generation does not start, and no artifact is built, kept or shown;
- any previously current chain is withdrawn, because it can no longer be
  verified;
- the chain status becomes `REJECTED` with `DIGEST_UNAVAILABLE`;
- Simulate shows an explicit alert (`role="alert"`): "Artifact hashing
  self-check failed (DIGEST_UNAVAILABLE). No mocked artifacts were generated."

Retrying is allowed and fails the same way while the self-check keeps failing.

**Equivalence with the frozen implementation (R-4).** The following checks run
under the pinned Node 24.21.0 and pnpm 11.22.0, both locally and in CI. The
report records the Node version printed by the test run. The §2 planning check
on Node 25.9.0 does not count.

- **Accepted inputs.** For all five supported types, every relevant v1 vector
  and every generated IR, quote, Artifact Set and Simulation Bundle must give
  a digest equal to the frozen `hashArtifactBytes` or `hashRawBytes` result.
- **Malformed inputs.** The browser digest must never accept an input that the
  frozen implementation rejects. For each structured type, a malformed corpus
  is serialized and passed to the frozen implementation, which must reject
  it, and to the browser digest, which must also reject it. The corpus
  covers:
  - a non-object root, and arrays or `null` in place of objects;
  - missing, unknown and mistyped fields;
  - non-integer, unsafe or non-finite numbers, and over-length strings;
  - lone surrogates;
  - non-canonical or invalid timestamps, and `observedAt` after `expiresAt`;
  - uint256 overflow, and inconsistent decimals for one asset;
  - duplicate IDs, and broken workflow references;
  - depth above 64, and more than 1 MiB of data.
- **Object-only malformations.** Cycles, accessors, non-plain prototypes,
  sparse arrays and symbol keys cannot be expressed as JSON bytes. The browser
  digest must reject each of them.
- **`raw-response`.** Non-`Uint8Array` input and input above 1 MiB are
  rejected by both implementations.
- **Unsupported kinds** (`payload`, `intent`, policy, manifest, plan, journal
  and evidence) are rejected.

The browser digest may be stricter than the frozen implementation. Every
stricter rule is listed in the report.

### 3.7 Chain review and validation rules

The new file `packages/reference-linter/src/mocked-chain.ts` exports:

- `MOCKED_CHAIN_PROFILE` (frozen): fixture, markers, freshness rule and codes;
- `mockedFixtureBytes(context)`: the canonical fixture bytes behind
  `rawResponseHash`;
- `mockedSwapOutputs(...)`: pure arithmetic;
- `reviewMockedArtifactChain({ chain, sourceWorkflow, currentWorkflow, nowMs }, context): Promise<ChainReview>`.

This follows the BUILD-003A precedent, where the linter pins the Base asset
profile.

`ChainReview` always carries `environment: "MOCKED"`, `executable: false`,
`authorization: "NONE"` and `enforcement: "NOT_ENFORCED"`. These are literal
types that no input can change.

**Cross-artifact references and revision binding (R-5).** A chain is bound to
exactly one source IR revision. It is valid only if every reference below holds
under recomputation with the self-checked digest:

1. For every quote, the Artifact Set and the Simulation Bundle,
   `semanticWorkflowHash` equals the digest of the source IR.
2. The Simulation Bundle's `semanticWorkflowRevision` and the `r` in every
   artifact ID equal the source IR `revision`.
3. The `g` in every artifact ID is the same.
4. Each Artifact Set entry's `artifactHash`, `artifactId` and `nodeId` equal
   the digest, ID and node of exactly one quote. There is one entry per quote,
   and each quote's node is a swap node in the source IR.
5. The Simulation Bundle's `artifactSetHash` equals the digest of the Artifact
   Set.
6. The node IDs in `outputs` and `failurePaths` are exactly the quoted swap
   nodes.
7. Each quote's `rawResponseHash` equals the digest of the fixture bytes.

Tampered or incorrectly linked chains are rejected with the codes below. A
chain that is internally valid but stale or expired is rejected for any use by
the access guard in §3.8.

**Rejections.** The review throws, fails closed, and nothing is shown as a
result in these cases:

- Malformed or oversized input, unknown fields, or schema failure:
  `MALFORMED_ARTIFACT_CHAIN`, `INVALID_QUOTE_STATE_ARTIFACT`,
  `INVALID_ARTIFACT_SET`, `INVALID_SIMULATION_BUNDLE`.
- `sourceWorkflow` fails the BUILD-003A validation, or it has a review BLOCK
  other than `UNQUOTED_EXECUTION_UNAVAILABLE`: `SOURCE_WORKFLOW_NOT_ELIGIBLE`.
- A missing or altered mock marker, source, adapter or provider reference:
  `MOCK_MARKER_REQUIRED` or `LIVE_SOURCE_NOT_APPROVED`.
- Any proposed contract, spender or recipient: `AUTHORITY_FIELDS_FORBIDDEN`.
  Any fee or gas entry: `UNMODELED_VALUE_FORBIDDEN`.
- A wrong chain, asset, decimals or amount, or an output that differs from
  `mockedSwapOutputs`: `OUTPUT_MISMATCH` or `ASSET_MISMATCH`.
- A missing, extra or duplicate quote, a quote for a mock node, or inconsistent
  `r` or `g` IDs: `NODE_COVERAGE_MISMATCH`.
- Any cross-artifact reference that differs from recomputation:
  `HASH_LINK_MISMATCH`. A revision that differs from the source IR:
  `REVISION_LINK_MISMATCH`. The references checked are listed above.
- A non-canonical timestamp, `observedAt` after `expiresAt`, or a freshness rule
  other than 60 s: `FRESHNESS_INVALID`.
- A non-empty propagation, or a failure path that differs from the profile:
  `UNSUPPORTED_PROPAGATION` or `FAILURE_PATH_MISMATCH`.

**Findings for a valid chain.** Findings are deterministic, ordered and frozen:

- `MOCKED_ARTIFACTS_NOT_EXECUTABLE`, BLOCK, always present;
- `ARTIFACTS_INVALIDATED_BY_SEMANTIC_EDIT`, BLOCK, when the current revision or
  digest differs from the source;
- `ARTIFACTS_EXPIRED`, BLOCK, when `nowMs` ≥ `expiresAt` or `nowMs` <
  `observedAt`. The app's access guard also applies the monotonic rule in
  §3.8;
- `MOCKED_OUTPUT_ZERO`, BLOCK, when the expected or minimum output is `0`
  (§3.5 rule 4).

Identical inputs yield identical output, and no input is mutated. The review is
application review, not an enforcement boundary. Assertions are not treated as
validation.

### 3.8 Chain status, state transitions and invalidation

Chain status is app-local presentation state. It is not a canonical contract,
journal entry or workflow state.

| From | Event | To |
|---|---|---|
| `EMPTY`, `INVALIDATED`, `EXPIRED`, `REJECTED` | Generate, when eligible and the self-check passes | `GENERATING`; captures revision r, the IR object, generation g, wall time t and monotonic time m |
| `CURRENT` | Refresh mocked quote (`QUOTE_REFRESH`) | `GENERATING`; the IR digest is unchanged, and the quote, set and simulation hashes change |
| `GENERATING` | Completes; revision and IR object unchanged; review passes | `CURRENT` |
| `GENERATING` | Completes after the revision changed | Previous status; the result is discarded and a notice is shown |
| Any | Self-check failure (R-3) | `REJECTED` with `DIGEST_UNAVAILABLE`; explicit alert; nothing built or kept |
| `GENERATING` | Review failure | `REJECTED`, with its code |
| `CURRENT` or `EXPIRED` | An accepted edit raises the revision (`SEMANTIC_EDIT`) | `INVALIDATED`; dependents are the frozen `SEMANTIC_EDIT` list |
| `CURRENT` | The access guard finds the chain expired (`ARTIFACT_EXPIRED`) | `EXPIRED`; dependents are the frozen `ARTIFACT_EXPIRED` list |
| Any | Tab switch, selection, dismissed or rejected proposal, no-op (`PRESENTATION_EDIT`) | Unchanged |

Generation is eligible only when:

- the workflow has at least one swap node;
- `lintWorkflow` succeeds;
- there is no BLOCK finding other than the unconditional one;
- no generation is pending.

Otherwise the control is disabled and states the exact reason, for example
slippage above 300 bps or a missing swap.

**Access guard (R-5, R-7).** Every access to or use of chain content goes
through one synchronous guard: `requireCurrentChain(chainState,
currentWorkflow, wallNowMs, monotonicNowMs)`. It is re-evaluated at that
moment and never relies on a stored flag, a timer or a countdown. Callers
include:

- rendering any number, table row, graph overlay, hash-as-current or JSON
  block;
- the summary status chip;
- Refresh;
- anything the tests read.

The guard throws `ARTIFACTS_STALE` unless both hold:

- the current revision equals `r`;
- the current IR is the same frozen object the chain was generated from.

The digest-level binding is established by the §3.7 review at generation.
IR revisions are immutable, so object identity is a strict synchronous
binding.

The guard throws `ARTIFACTS_EXPIRED` if any of these holds:

- `wallNowMs` ≥ `expiresAt`;
- `wallNowMs` < `observedAt`, meaning the clock moved backwards;
- `monotonicNowMs` − m ≥ 60,000.

The earliest condition wins, so moving the wall clock back cannot extend
validity. Wall time comes from `Date.now()` and monotonic time from
`performance.now()`.

**Tab resume.** The guard also runs on `visibilitychange`, `focus` and
`pageshow`, because background tabs throttle or suspend timers. A timer set
for `expiresAt` only triggers a re-render and is never the check itself.
No countdown is displayed. The deadline is static text.

**Non-current chains.** A stale, expired or rejected chain shows only its
revision, hashes, status, reason and dependent list. Its numbers and JSON are
hidden. An old chain never returns to `CURRENT`; only a new generation for
the current revision produces a `CURRENT` chain. The frozen
`INVALIDATION` lists are mirrored as a display constant and verified equal in
Node tests.

The canonical workflow state stays `DRAFT`. No journal entry is created, and a
mocked chain never moves the workflow to `REVIEWED`, `SIMULATED` or
`AUTHORIZED`. The frozen table rejects `DRAFT` → `AUTHORIZED`, and tests assert
this.

### 3.9 Non-authorization boundary

Mocked artifacts cannot authorize execution because of all of the following:

1. No code path creates an Authorization Policy, Strategy Manifest, Execution
   Plan, journal, Evidence Bundle, payload or intent hash. The digest has no
   such domains.
2. New governance source scans reject these contract types and schema imports,
   wallet or RPC tokens and network primitives in app and linter sources (§3.12).
   The current baseline has none of them.
3. Every artifact carries hashed `MOCKED` markers. The review rejects any
   artifact without them, so a real-looking quote cannot be displayed as
   current.
4. `ChainReview` and the lint result carry literal `executable: false`. The
   canonical state stays `DRAFT`, which the frozen table cannot move to
   `AUTHORIZED`.
5. Execute stays unavailable in every chain state, including `CURRENT` after
   a successful generation (R-8). No chain state enables any control, and
   Execute does not read chain state. After simulation the only next step is
   the disabled "Manifest review unavailable". The swap's `MODE_A` remains a
   future requirement class. Application authorization stays `NONE`.
6. The network guard remains loopback-only. Digesting is local WebCrypto.

### 3.10 Existing-screen changes and visual evidence

The only route remains `/`. Tabs remain states of `app-shell.tsx`. The visual
language, fonts and layout grid are kept, and no animation or design-system
dependency is added. Paths below are under `apps/reference-dapp/src/`.

| Deliberate visible change | Component path | Affected snapshots |
|---|---|---|
| Build label `BUILD-003B` and page title | `config/product.ts`, `app/layout.tsx` | All five existing |
| Tab-aware footer action: Build "Open mocked simulation", Simulate disabled "Manifest review unavailable", Execute disabled "Execution unavailable"; chain status chip | `components/summary-bar.tsx`, `components/app-shell.tsx` | All five existing |
| Review copy names Simulate as mocked-only | `components/review-panel.tsx` | `review-blocked` |
| Simulate: empty and ineligible states, generate and refresh controls, self-check failure alert, chain strip, read-only graph overlay, results with `MOCKED` and the synthetic rate beside every number (R-1), enforcement table, not-modeled block, artifact JSON, invalidation and expiry banners, disabled next step | New `components/simulate-panel.tsx`; `components/workflow-canvas.tsx` (read-only mode; Build rendering unchanged); `components/app-shell.tsx`; `app/globals.css` | `simulate` plus three new |
| Execute copy states that mocked artifacts cannot authorize | `components/app-shell.tsx` | `execute` |

Colors follow Master Prompt §9.1. No green appears anywhere on the chain.
Warnings use amber and blocks use red.

**Wording (R-1).** The Simulate heading and the disclaimer shown before
generation both read "Mocked artifact chain: synthetic fixture data, not a
live quote or a financial simulation". Artifacts are named "mocked quote" and
"mocked simulation", never an unqualified "quote" or "simulation". Numbers
never appear without the adjacent `MOCKED` classification and the
synthetic-rate text.

Nothing fabricated may appear: no currency sign, USD valuation, price feed,
"live" status claim, or gas or fee estimate. Explicit negative disclosures
are permitted and expected, such as "USD values: not modeled" or "not a live
quote". Honesty tests reject fabricated valuations and claims, not these
disclosures.

The visual process repeats the BUILD-003A method:

1. At exact baseline `36dd05e`, reproduce the five existing snapshots with the
   approved browser at 1440×900, en-US, light theme and reduced motion. Verify
   zero-pixel agreement.
2. Retain those images as `*-before.png`.
3. Capture after images and inspect every difference against the table above.
4. Retain strict-RGB diff images. Record the counts and hashes in the report.
5. Only then replace the baselines.

Add `simulate-current`, `simulate-invalidated` and `simulate-expired` snapshots
under a fixed Playwright clock. All runs keep `maxDiffPixels: 0` with no
masking, widened tolerance or automatic CI update. Unexplained drift is
investigated, never normalized.

### 3.11 Workspace, dependencies, browser and CI

- No new workspace package, application route or workspace configuration
  change. Generation stays app-local (`src/domain/mock-artifacts.ts`,
  `src/domain/artifact-chain.ts`), following the `mock-actions.ts` precedent.
  Digest and review stay in the linter, which is the deterministic review
  engine.
- The linter adds one direct dependency, `"canonicalize": "5.0.0"`. This is an
  approved BUILD-001 pin, already locked and already in the 245-entry
  inventory. The app gains no direct dependency.
- In `pnpm-lock.yaml`, only the `packages/reference-linter` importer changes.
  The `packages`/`snapshots` sections keep SHA-256
  `7435de8d05c530d4660ed466a2992d63ae71788a1c39e327ebb4fe611d6ac9bf`. The
  lock keeps 245 registry identities, 16 exceptions and existing patches.
- The importer is updated offline with lifecycle scripts disabled, followed by
  a frozen install. Any resolution change stops work for a human decision.
- `scripts/bootstrap-ci.py`: only the exact linter dependency dictionary and
  the expected importer text gain `canonicalize`.
- The browser remains the approved headless shell, revision 1243, SHA-256
  `a9da028861a0cf789ff25c2fed45f5f1aaf969ed9247835b6a7821a4f7af9d1d`. A cache
  is reused only with established integrity. Otherwise the unchanged bootstrap
  runs into an unused temporary directory. No Playwright installer, extra
  browser or upgrade is used.
- `contracts.yml`: the linter export check adds `digestArtifact`,
  `digestRawResponse`, `digestSelfCheck`, `reviewMockedArtifactChain`,
  `mockedSwapOutputs` and `mockedFixtureBytes`. The
  SBOM validation is unchanged: 245 registry components and five workspace
  manifests and importers.
- Toolchain: Node 24.21.0, pnpm 11.22.0, Playwright 1.63.0. All acceptance
  evidence comes from this toolchain, including the R-4 equivalence suite. The
  Playwright clock API provides deterministic expiry and tab-resume tests.

### 3.12 Governance transition after approval

No governance file changes during planning. After approval:

- **Decision.** Record the approval as the next sequential decision (number
  0019 at this baseline; re-read the register first). Include the D-1 to D-3
  selections made on 2026-09-24, the R-1 to R-8 acceptance requirements and
  the fact that the owner merged BUILD-003A through PR #7 as `36dd05e`. Add a
  marker check for it. Preserve every historical row.
- **Requirements.** Register the §2 requirement IDs. Point the BUILD-003A index
  note to B003A-DELIVERY-001. Leave historical rows unchanged.
- **Historical BUILD-003A scope.** Convert the current BUILD-003A scope check
  into a fixed Git-tree comparison from `14a94584…` to `36dd05e…`, using the
  unchanged approved create and modify sets. It rejects deletions and mode
  changes. CI fetches `36dd05e` explicitly. The BUILD-002 and amendment checks
  stay unchanged.
- **Current BUILD-003B scope.** Compare `36dd05e` to the reviewed tree, including
  staged, unstaged and untracked files, against §11. Reject deletions, symlinks,
  executable modes and unlisted paths.
- **Protected digests.** Add the BUILD-003A plan
  (`d7dbd286b087f640ba7852cc55ed9d4b0d62c7af4e4464d177c7150b46c4c4cf`) and
  report (`b03f5e13…`). Verify BUILD-003A-approved images from Git blobs at
  `36dd05e`, and the BUILD-002 images from `14a94584…`. Check the new current
  images against the report-recorded digests.
- **Records and templates.** Add the BUILD-003B plan (13 headings) and report
  (14 headings) to the required files and template checks. The allowed
  BUILD-003 document set becomes the 003A and 003B plans and reports.
- **Authority and status checks.** The authority matrix requires `BUILD-003B`
  `APPROVED` and replaces the combined row with `BUILD-003C or financial
  execution` `NOT_APPROVED`. `NEXT_BUILD.md` must retain `NONE_APPROVED` and
  the BUILD-003B authority. `STATUS.md` must contain `BUILD-003B` and
  `36dd05e2bcea2d9a19c7b571d2126aea0390e5dd`.
- **Linter manifest.** The exact dependency contract gains
  `canonicalize: 5.0.0`. The package directory set, exports and license are
  unchanged.
- **New source scans** in `apps/reference-dapp/src` and
  `packages/reference-linter/src`:
  - reject `AuthorizationPolicy`, `StrategyManifest`, `ExecutionPlan`,
    `ExecutionJournal`, `JournalEntry` and `EvidenceBundle`, and imports of
    their schema files;
  - reject `window.ethereum`, `eth_send`, `eth_sign`, `personal_sign`,
    `signTypedData`, `wagmi`, `viem`, `ethers` and `web3`;
  - reject `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
    `sendBeacon`, `dangerouslySetInnerHTML` and browser storage;
  - extend the remote-URL scan to the linter source.
- **Kept checks.** Every secret, email, link, brand, claim, identifier,
  official-text, patch, attribution, frozen-tree, package, heading and hygiene
  check stays.
- **Living records.** Update STATUS, NEXT_BUILD, AUTHORITY_MATRIX,
  EVIDENCE_LEVELS, SCOPE_GUARD, SECURITY_MODEL, the LICENSE_MAP approved-plan
  clause and README to the demonstrated state. STATUS records the merge of
  PR #7 and the run IDs in §2. `NEXT_BUILD` ends as `NONE_APPROVED`. The root
  `LICENSE` is unchanged because no path is newly populated.
- **Delivery constraint.** Both unchanged governance CI blocks were run
  locally against the planning tree, which contains only this new file. They
  reported exactly three errors, and every other check passed:
  - `BUILD-003A created path mismatch` for this file;
  - `unregistered requirement IDs` for the twelve IDs proposed in §2;
  - `unexpected BUILD-003 build document set`.

  The plan must therefore reach GitHub only together with the approved
  implementation and governance transition, as BUILD-003A did.

### 3.13 Specification coverage matrix

| Spec requirement | BUILD-003B |
|---|---|
| §7.5 source and adapter version | Mocked source and adapter, explicit |
| §7.5 chain ID and block reference | Chain ID real; block reference is a sentinel (C-2) |
| §7.5 timestamp, expiry and raw-response hash | Mocked, real local time, 60 s rule, fixture hash |
| §7.5 provider identifiers, contracts, spenders, recipients | None; any entry is rejected |
| §7.5 fees, gas assumptions, output bounds and uncertainty | Fees and gas not modeled; bounds mocked; uncertainty explicit |
| §7.5 registry validation | Shape and declaration only (C-8) |
| §7.6 one revision, exact artifact set and adapter versions | Yes, hash-verified |
| §7.6 expected, minimum and adverse outcomes; failure paths; uncertainty | Mocked |
| §7.6 propagated outputs | Empty; swaps cannot connect |
| §10.2 balances, approvals, gas, fees, exposure, budgets | Not modeled; disclosed |
| §10.2 residual assets after failure | Mocked revert path |
| §10.2 enforcement matrix | Every limit shown as `NOT_ENFORCED` |
| §10.3 scenarios 1, 2 and 4 | Mocked |
| §10.3 scenario 9 | Forged recipient, spender, contract and provider fields are rejected |
| §10.3 other scenarios | Not applicable or not modeled; disclosed |
| §9.1 stale quote or state, quote expiration, runtime fields in hashing | Chain findings and closed-schema digest |

## 4. Out of scope

- RPC, explorer, price or balance reads; live, market or route quotes; the
  Uniswap SDK or adapters; router, spender and recipient identities; calldata;
  wallets, approvals, signatures and transactions.
- Fork, testnet and mainnet environments; financial simulation; gas or fee
  estimation; USD values.
- Authorization Policy, Strategy Manifest, Execution Plan, payload or intent
  hash, journal, reconciliation and Evidence Bundle.
- Persistence, backend, API, server actions, workers and external AI.
- Artifact import, file-download or other export controls beyond the
  copyable JSON block (R-6), and chat commands for generation.
- Swap composition and propagated outputs.
- Mode B and Mode C, BUILD-003C, package publication and P-gate certification.
- Changes to v1 schemas, fixtures, the hash profile, the contract or registry
  packages, or existing linter rules. No new external resolution and no
  unrelated redesign.

## 5. Acceptance criteria

### 5.1 Owner acceptance requirements (2026-09-24)

On 2026-09-24 the owner added eight requirements. Each is specified once, in
the sections below, and each is verified by the checklist in §5.2 and the tests
in §6.

| ID | Owner requirement | Specified in | Requirement ID |
|---|---|---|---|
| R-1 | Show the synthetic rate and the `MOCKED` classification beside the generated numbers; never imply a live quote or a genuine financial simulation | §1 step 3, §3.10 (visual table and wording) | B003B-HONESTY-001 |
| R-2 | Exact integer arithmetic with explicit rounding for conversion and minimum output; both directions and boundary amounts tested | §3.5 (rules 1–5 and vector table) | B003B-SIMULATION-001 |
| R-3 | A failed hashing self-check prevents generation and shows an explicit error | §3.6 (self-check), §3.8 (transition table) | B003B-HASH-001 |
| R-4 | Every supported browser hash type is verified against the frozen implementation on the pinned toolchain, including malformed-input rejection | §3.6 (equivalence), §3.11 (toolchain) | B003B-HASH-001 |
| R-5 | Cross-artifact references are validated and the chain is bound to the exact revision; tampered, stale, expired or incorrectly linked artifacts are rejected | §3.7 (references and rejections), §3.8 (access guard) | B003B-LINK-001, B003B-INVALIDATION-001 |
| R-6 | `MOCKED` provenance is preserved in exported JSON and in the interface | §3.1 (exported JSON), §3.3–3.5 (hashed markers and IDs), §3.10 | B003B-HONESTY-001, B003B-QUOTE-001 |
| R-7 | Expiry is checked whenever artifacts are accessed or used, including after the tab resumes; a countdown alone is not enough | §3.8 (access guard and tab resume) | B003B-INVALIDATION-001 |
| R-8 | Execution stays unavailable regardless of successful mock generation | §1 step 6, §3.9 item 5 | B003B-BOUNDARY-001 |

### 5.2 Checklist

- [ ] For every swap in both directions, generation yields schema-valid v1
  artifacts that match §3.3–3.5 exactly and pass frozen `parseArtifactBytes`.
- [ ] R-1: every generated number, in the table and on the graph, has the
  `MOCKED` classification and the synthetic-rate text beside it. The wording
  follows §3.10. No currency sign, USD valuation, gas or fee estimate, "live"
  claim or green completion appears. Negative disclosures such as "USD values:
  not modeled" are shown, together with `NOT_ENFORCED`.
- [ ] R-2: arithmetic matches every §3.5 vector in both directions, follows
  rounding rules 1–5, and satisfies the floor-property oracle for randomized
  inputs. No floating point is used.
- [ ] R-3: a failed self-check prevents generation, withdraws any current
  chain and shows the explicit `DIGEST_UNAVAILABLE` alert.
- [ ] R-4: on the pinned toolchain, browser digests equal frozen digests for
  all five supported types, and every malformed input the frozen
  implementation rejects is also rejected (§3.6).
- [ ] R-5: every §3.7 reference holds for each generated chain. Each tampered
  or incorrectly linked chain is rejected without mutating state. Stale and
  expired chains are refused for every use by the §3.8 guard.
- [ ] R-6: each artifact's displayed JSON parses with frozen
  `parseArtifactBytes` and contains its `MOCKED` provenance (§3.1).
- [ ] R-7: expiry is detected on access and on tab resume without any timer
  firing, including when the wall clock moves backwards and when only
  monotonic time has advanced.
- [ ] R-8: in every chain state, including `CURRENT` right after generation,
  no enabled control can sign, approve, authorize, submit or execute. Execute
  and Manifest review remain unavailable. The workflow stays `DRAFT`. No
  authority-shaped artifact exists.
- [ ] Semantic edits, refresh and stale completion follow §3.8 and the frozen
  matrix. Presentation events, no-ops, dismissals and rejected edits never
  invalidate. Non-current chains never display numbers or JSON.
- [ ] Artifacts from equal chat-created and canvas-created IRs are identical
  under an equal clock and generation.
- [ ] Before/after/diff evidence accounts for all five changed snapshots. The
  three new states pass at zero pixels. Keyboard, labels, focus and the
  375/768/1280 widths pass.
- [ ] Frozen contracts, 10 schemas, 20 fixtures, patches, 21 upstream legal
  files and historical records (now including BUILD-003A) keep their protected
  identities.
- [ ] Registry resolutions are unchanged. Only the linter importer gains
  `canonicalize`. Dependency, license, audit and SBOM accounting pass.
- [ ] Historical and current governance gates pass, and each new scan is shown
  to fail in isolated negative copies.
- [ ] The report separates local results, remote CI and missing evidence.

## 6. Required tests

All acceptance tests run on the pinned toolchain (§3.11).

**Unit, linter.**

- R-4, accepted inputs: differential digest tests for the five supported types
  against every relevant frozen vector and against generated IRs, quotes, sets
  and bundles.
- R-4, malformed inputs: the §3.6 corpus. Frozen rejection implies browser
  rejection. Object-only malformations, `raw-response` bounds and unsupported
  kinds (including `payload` and `intent`) are rejected. The projection equals
  the schema `properties` for each type.
- R-3: the self-check runs before every generation and every review and is
  never cached. A wrong digest, a missing `crypto.subtle` and a throwing digest
  each prevent generation with `DIGEST_UNAVAILABLE`.
- R-2: `mockedSwapOutputs` reproduces every §3.5 vector in both directions. At
  least 1,000 seeded random amounts in [1, cap] per direction, with bps in
  [0, 300], satisfy the floor-property oracle. Inputs above the cap and
  slippage above 300 bps never reach the arithmetic.
- R-5: every reference in §3.7 is broken one at a time, and every rejection
  code has a test. Findings, including `ARTIFACTS_EXPIRED` for a backwards
  clock, are deterministic and ordered. Inputs are not mutated.

**Unit, app.**

- One quote per swap node and none for mock nodes, across multi-swap
  workflows.
- The chain status reducer follows every transition in §3.8, including stale
  completion through a deferred digest and self-check failure.
- R-5 and R-7, access guard:
  - stale by revision, and stale by IR object identity;
  - expired at exactly `expiresAt`;
  - a wall clock moved backwards;
  - monotonic time elapsed with the wall clock frozen;
  - every content accessor (numbers, graph overlay, JSON, chip, refresh) calls
    the guard.
- The invalidation mirror equals the frozen lists.
- Artifacts are frozen.
- Product config and copy are correct.

**Integration.**

- The app's contracts integration test parses every generated artifact with
  frozen `parseArtifactBytes` and compares `hashArtifactBytes` results.
- A refresh keeps the IR digest and changes the quote, set and simulation
  hashes. A semantic edit changes all of them.
- The frozen `invalidationFor` and `assertTransition` behave as §3.8 assumes.
- Export presence and the private `0.1.0` identity of the linter are checked.

**E2E, guarded.**

- Chat-create and canvas-create for both directions → generate. Read the
  rendered IR and each artifact's displayed JSON. In the Node runner, check
  with frozen functions the links, displayed hashes and revision, and that the
  `MOCKED` provenance is present (R-5, R-6).
- Chat-created and canvas-created artifacts are equal.
- R-1: each number cell and graph overlay has its own adjacent `MOCKED` and
  synthetic-rate text. The disclaimer and the "USD values: not modeled"
  disclosure are present. The Simulate region contains no currency sign, no
  USD-denominated amount and no unnegated "live" claim.
- R-3: an init script replaces the browser digest so the self-check fails.
  Generating then shows the explicit alert, and no artifact, number or JSON
  appears.
- R-7: install the Playwright clock and generate. Move the system time past
  `expiresAt` without running timers, then check two paths:
  - a tab-resume event (`visibilitychange` or `focus`) shows `EXPIRED`;
  - with no event, opening a JSON block or pressing Refresh finds the chain
    expired.

  A clock moved backwards also shows `EXPIRED`.
- A semantic edit invalidates. Dismissals, no-ops, stale proposals and tab and
  selection changes do not. A refresh changes the downstream hashes.
- Ineligible states: no swap, slippage 301 bps. A zero output generates a
  chain that carries the `MOCKED_OUTPUT_ZERO` BLOCK finding (§3.5 rule 4).
- R-8: after a successful generation, and in every other chain state, Execute
  is unavailable and no enabled control signs, approves, authorizes, submits or
  executes.
- Keyboard and focus, and no overflow at 375, 768 and 1280.
- The loopback guard stays clean. Updated honesty, shell and authoring specs
  pass, and all eight snapshots pass at zero pixels.

**Failure and adversarial.**

- A forged `executable: true` or an empty finding list.
- A stripped or altered `MOCKED` marker, source, adapter or provider.
- Injected spender, recipient, contract, fee or gas values.
- An inflated output; a wrong asset, decimals or chain.
- Swapped, duplicate or missing quotes, or a quote for a mock node.
- Mismatched hashes and revisions, and mixed generations.
- Expired, future-dated or malformed timestamps.
- A chain from revision r shown at revision r+1.
- A completion racing an edit; oversized or cyclic input.
- Every Build 003 injection that applies in mocked form (§2).

**Governance and CI.** In an isolated temporary copy, never the working tree,
each of these must fail: an unauthorized path; a changed BUILD-003A report
byte; an altered historical 003A tree assumption; an authority type in app
source; a wallet token in linter source; extra linter dependencies; a missing
BUILD-003B heading; an unregistered B003B ID; removal of the `BUILD-003C`
`NOT_APPROVED` row. Record Turbo, ESLint, Vitest and remote-job evidence of the
new tests.

## 7. Authority and artifacts

- **Authorization mode:** `NONE`. The node's `MODE_A` and the registry's `A`
  describe a future requirement only.
- **Enforcement:** `NOT_ENFORCED`. ADR-0001 remains `PROPOSED` and
  byte-identical. The chain review is application review.
- **Artifacts created:** in-memory `MOCKED` Quote/State Artifacts, Artifact
  Sets and Simulation Bundles. None is persisted. The only export is the
  copyable JSON block, which carries its `MOCKED` provenance (§3.1). No
  policy, manifest, plan, journal or evidence instance exists.
- **Hashes:** unchanged frozen profile. `semanticWorkflowHash`,
  quote-state-artifact digests, `artifactSetHash` and `simulationHash` are
  computed in the browser and verified against the frozen implementation. No
  `policyHash`, `manifestHash`, `payloadHash`, `intentHash`,
  `executionAttemptId` or `evidenceBundleHash` is computed.
- **Material-change invalidation:** the frozen `SEMANTIC_EDIT`,
  `QUOTE_REFRESH`, `ARTIFACT_EXPIRED` and `PRESENTATION_EDIT` classes, as in
  §3.8.
- **Revocation or cancellation:** none. Discarding or invalidating a mocked
  chain has no external effect and is never described as revocation or
  cancellation.

## 8. Security impact

- **Protected assets:** artifact-link integrity, honesty of the mocked
  evidence, the authority boundary, frozen contract compatibility and
  governance. No funds, keys or secrets are involved.
- **Trust boundaries:**
  - chat, form, command and IR input versus closed validation;
  - the frozen fixture and profile versus editable state;
  - the browser digest versus the frozen profile;
  - the client clock versus freshness (the clock is untrusted, and freshness is
    a review rule);
  - mocked evidence versus authority.
- **Threats:**
  - a synthetic value mistaken for a quote or simulation;
  - forged or stripped markers;
  - fabricated spender, recipient or router fields;
  - hash divergence between implementations;
  - a stale or expired chain shown as current, including through wall-clock
    rollback or timers throttled in a background tab;
  - a tampered or failing digest environment;
  - races between generation and edits;
  - scope drift into authority artifacts;
  - accidental network, RPC or wallet coupling;
  - input exhaustion;
  - XSS through artifact display.
- **Controls:** closed schemas and profile rules; recomputed links; a
  differential digest with a per-generation self-check; a synchronous access
  guard for revision, IR identity and wall-plus-monotonic expiry on every
  access and tab resume; literal non-executable results; the `DRAFT` state;
  unavailable Execute; React text rendering with no raw HTML; bounded input;
  the loopback guard; and the new governance source scans.
- **Limitations:** a compromised client can misrepresent the UI. Freshness uses
  local wall and monotonic clocks and enforces nothing. None of this is
  financial enforcement.

## 9. Evidence target

- **Required environment:** `MOCKED`. This proves internal chain logic only
  (P10). P6 and P7 are shown only in mocked form and are not certified.
- **Outcome status:** `NOT_APPLICABLE`. None of `CONFIRMED_NOT_RECONCILED`,
  `RECONCILED`, `INCONCLUSIVE` or `DIVERGENT` applies. There are no
  `FORK_REPRODUCED`, `TESTNET_EXECUTED` or `MAINNET_EXECUTED` claims.
- **Metadata:** asset metadata remains `NOT_ONCHAIN_VERIFIED`.
- **Reconciliation invariants:** not exercised. No transaction, receipt,
  balance or allowance exists. No Evidence Bundle is produced, because it
  requires policy, manifest, plan and journal hashes that do not exist.
- **Retained evidence:** source and tests, this plan and the report,
  before/after/diff images with pixel counts and hashes, and separately
  identified local and remote results. SBOMs remain ephemeral. The §2
  feasibility check is planning context, not evidence.

## 10. License impact

- **Affected directories:** `apps/reference-dapp/**` and
  `packages/reference-linter/**`, both already AGPL-3.0-only. Governance
  documents, workflows and scripts remain Apache-2.0. No path changes
  classification. The root `LICENSE` and all official texts are unchanged.
  `LICENSE_MAP` changes only to list the approved BUILD-003B plan.
- **New dependency edge:** `canonicalize@5.0.0` (Apache-2.0), already approved,
  locked and inventoried. Apache-2.0 code may be used in the AGPL-3.0-only
  linter and client bundle. It is unmodified, not vendored and not relicensed.
  No new registry package, no license exception change and no
  `THIRD_PARTY_NOTICES.md` change.
- **Bundling:** like Ajv under BUILD-003A, the dependency enters the local
  client bundle. Build output is untracked, and bundle distribution is not
  approved. The existing future release-compliance gate would also cover
  bundled notices.
- **Publication:** no package publication; exports are additive only.

## 11. Expected files

Paths are repository-relative. The lists are closed: 25 created and 34
modified paths, 59 in total. No other creates, deletions, renames or mode
changes are authorized.

### Create (25 paths)

```text
docs/builds/BUILD-003B-PLAN.md
docs/builds/BUILD-003B-REPORT.md
packages/reference-linter/src/artifact-digest.ts
packages/reference-linter/src/mocked-chain.ts
packages/reference-linter/test/artifact-digest.test.ts
packages/reference-linter/test/mocked-chain.test.ts
apps/reference-dapp/src/domain/mock-artifacts.ts
apps/reference-dapp/src/domain/mock-artifacts.test.ts
apps/reference-dapp/src/domain/artifact-chain.ts
apps/reference-dapp/src/domain/artifact-chain.test.ts
apps/reference-dapp/src/components/simulate-panel.tsx
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-current-chromium-linux.png
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-invalidated-chromium-linux.png
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-expired-chromium-linux.png
apps/reference-dapp/e2e/visual-evidence/build-003b/build-before.png
apps/reference-dapp/e2e/visual-evidence/build-003b/build-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003b/simulate-before.png
apps/reference-dapp/e2e/visual-evidence/build-003b/simulate-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003b/execute-before.png
apps/reference-dapp/e2e/visual-evidence/build-003b/execute-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003b/proposal-before.png
apps/reference-dapp/e2e/visual-evidence/build-003b/proposal-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003b/review-blocked-before.png
apps/reference-dapp/e2e/visual-evidence/build-003b/review-blocked-diff.png
```

### Modify (34 paths)

```text
.github/workflows/contracts.yml
.github/workflows/governance.yml
README.md
apps/reference-dapp/e2e/interface-honesty.spec.ts
apps/reference-dapp/e2e/swap-authoring.spec.ts
apps/reference-dapp/e2e/swap-authoring.spec.ts-snapshots/proposal-chromium-linux.png
apps/reference-dapp/e2e/swap-authoring.spec.ts-snapshots/review-blocked-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/build-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/execute-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/simulate-chromium-linux.png
apps/reference-dapp/src/app/globals.css
apps/reference-dapp/src/app/layout.tsx
apps/reference-dapp/src/components/app-shell.tsx
apps/reference-dapp/src/components/review-panel.tsx
apps/reference-dapp/src/components/summary-bar.tsx
apps/reference-dapp/src/components/workflow-canvas.tsx
apps/reference-dapp/src/config/product.test.ts
apps/reference-dapp/src/config/product.ts
apps/reference-dapp/src/domain/contracts.integration.test.ts
apps/reference-dapp/src/state/workflow-store.tsx
docs/AUTHORITY_MATRIX.md
docs/DECISIONS.md
docs/EVIDENCE_LEVELS.md
docs/LICENSE_MAP.md
docs/NEXT_BUILD.md
docs/REQUIREMENTS.md
docs/SCOPE_GUARD.md
docs/SECURITY_MODEL.md
docs/STATUS.md
packages/reference-linter/package.json
packages/reference-linter/src/index.ts
pnpm-lock.yaml
scripts/bootstrap-ci.py
```

### Do not touch

Every path tracked at `36dd05e2bcea2d9a19c7b571d2126aea0390e5dd` that is not
in Modify is protected byte-for-byte and mode-for-mode. That is 163 paths,
listed exhaustively below. The list includes the BUILD-003A plan and report,
all existing linter logic, the top bar, inspector, library, copilot, editor,
commands, proposal and authoring modules, the server page, the frozen
contracts, the registry, the fixtures and the legal texts.

```text
.gitignore
.node-version
.npmrc
LICENSE
LICENSES/AGPL-3.0-only.txt
LICENSES/Apache-2.0.txt
NOTICE
THIRD_PARTY_NOTICES.md
TRADEMARKS.md
apps/reference-dapp/LICENSE
apps/reference-dapp/e2e/build-roundtrip.spec.ts
apps/reference-dapp/e2e/fixtures.ts
apps/reference-dapp/e2e/network-isolation.spec.ts
apps/reference-dapp/e2e/visual-evidence/build-003a/build-before.png
apps/reference-dapp/e2e/visual-evidence/build-003a/build-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003a/execute-before.png
apps/reference-dapp/e2e/visual-evidence/build-003a/execute-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003a/simulate-before.png
apps/reference-dapp/e2e/visual-evidence/build-003a/simulate-diff.png
apps/reference-dapp/next-env.d.ts
apps/reference-dapp/next.config.ts
apps/reference-dapp/package.json
apps/reference-dapp/playwright.config.ts
apps/reference-dapp/src/app/page.tsx
apps/reference-dapp/src/components/action-library.tsx
apps/reference-dapp/src/components/artifact-inspector.tsx
apps/reference-dapp/src/components/copilot-panel.tsx
apps/reference-dapp/src/components/status-badge.tsx
apps/reference-dapp/src/components/top-bar.tsx
apps/reference-dapp/src/domain/commands.test.ts
apps/reference-dapp/src/domain/commands.ts
apps/reference-dapp/src/domain/editor.test.ts
apps/reference-dapp/src/domain/editor.ts
apps/reference-dapp/src/domain/initial-workflow.ts
apps/reference-dapp/src/domain/mock-actions.ts
apps/reference-dapp/src/domain/proposal.test.ts
apps/reference-dapp/src/domain/proposal.ts
apps/reference-dapp/src/domain/swap-authoring.test.ts
apps/reference-dapp/src/domain/swap-authoring.ts
apps/reference-dapp/tsconfig.json
docs/adr/ADR-0001-mode-b-authority.md
docs/adr/ADR-0002-canonical-contracts.md
docs/assets/1.jpeg
docs/assets/2.jpeg
docs/assets/3.jpeg
docs/builds/BUILD-000-LICENSING-AMENDMENT.md
docs/builds/BUILD-000-PLAN.md
docs/builds/BUILD-000-REPORT.md
docs/builds/BUILD-001-PLAN.md
docs/builds/BUILD-001-REPORT.md
docs/builds/BUILD-002-GOVERNANCE-AMENDMENT.md
docs/builds/BUILD-002-PLAN.md
docs/builds/BUILD-002-REPORT.md
docs/builds/BUILD-003A-PLAN.md
docs/builds/BUILD-003A-REPORT.md
docs/contracts/CANONICALIZATION_V1.md
docs/contracts/COMPATIBILITY_V1.md
docs/contracts/INVALIDATION_V1.md
docs/specs/MASTER_SPEC_V3.2.md
eslint.config.mjs
package.json
packages/action-registry/LICENSE
packages/action-registry/package.json
packages/action-registry/schemas/v1/action-registry.schema.json
packages/action-registry/src/actions.ts
packages/action-registry/src/base-assets.ts
packages/action-registry/src/capabilities.ts
packages/action-registry/src/index.ts
packages/action-registry/src/reference-registry.ts
packages/action-registry/src/schemas.ts
packages/action-registry/test/reference-registry.test.ts
packages/action-registry/test/registry.test.ts
packages/action-registry/tsconfig.json
packages/reference-linter/LICENSE
packages/reference-linter/src/context.ts
packages/reference-linter/src/rules.ts
packages/reference-linter/src/validation.ts
packages/reference-linter/test/linter.test.ts
packages/reference-linter/test/validation.test.ts
packages/reference-linter/tsconfig.json
packages/workflow-contracts/LICENSE
packages/workflow-contracts/package.json
packages/workflow-contracts/schemas/v1/artifact-set.schema.json
packages/workflow-contracts/schemas/v1/authorization-policy.schema.json
packages/workflow-contracts/schemas/v1/evidence-bundle.schema.json
packages/workflow-contracts/schemas/v1/execution-journal.schema.json
packages/workflow-contracts/schemas/v1/execution-plan.schema.json
packages/workflow-contracts/schemas/v1/quote-state-artifact.schema.json
packages/workflow-contracts/schemas/v1/semantic-workflow.schema.json
packages/workflow-contracts/schemas/v1/simulation-bundle.schema.json
packages/workflow-contracts/schemas/v1/strategy-manifest.schema.json
packages/workflow-contracts/src/artifact-set.ts
packages/workflow-contracts/src/authorization-policy.ts
packages/workflow-contracts/src/canonical.ts
packages/workflow-contracts/src/common.ts
packages/workflow-contracts/src/evidence-bundle.ts
packages/workflow-contracts/src/execution-journal.ts
packages/workflow-contracts/src/execution-plan.ts
packages/workflow-contracts/src/index.ts
packages/workflow-contracts/src/invalidation.ts
packages/workflow-contracts/src/quote-state.ts
packages/workflow-contracts/src/raw-json.ts
packages/workflow-contracts/src/revision.ts
packages/workflow-contracts/src/schemas.ts
packages/workflow-contracts/src/semantic-workflow.ts
packages/workflow-contracts/src/simulation.ts
packages/workflow-contracts/src/state-transitions.ts
packages/workflow-contracts/src/strategy-manifest.ts
packages/workflow-contracts/test/canonical.test.ts
packages/workflow-contracts/test/contracts.test.ts
packages/workflow-contracts/test/invalidation.test.ts
packages/workflow-contracts/test/raw-json.test.ts
packages/workflow-contracts/test/revision-state.test.ts
packages/workflow-contracts/tsconfig.json
patches/@streamparser__json@0.0.26.patch
patches/@xyflow__system@0.0.82.patch
pnpm-workspace.yaml
prompts/DEFI_WORKFLOW_ENGINE_MASTER_PROMPT_ASTRA_v1.2_EN.md
scripts/bootstrap-playwright.py
scripts/export-schemas.mjs
tests/compatibility/v1/action-registry.json
tests/compatibility/v1/artifact-set.json
tests/compatibility/v1/authorization-policy.json
tests/compatibility/v1/evidence-bundle.json
tests/compatibility/v1/execution-journal.json
tests/compatibility/v1/execution-plan.json
tests/compatibility/v1/hash-vectors.json
tests/compatibility/v1/invalidation-cases.json
tests/compatibility/v1/raw-json/invalid-duplicate-nested.json.txt
tests/compatibility/v1/raw-json/invalid-duplicate-root.json.txt
tests/compatibility/v1/raw-json/invalid-escaped-equivalent-key.json.txt
tests/compatibility/v1/raw-json/invalid-trailing-document.json.txt
tests/compatibility/v1/raw-json/invalid-utf8.hex
tests/compatibility/v1/raw-json/valid-distinct-nested-keys.json
tests/compatibility/v1/raw-json/valid-escaped-string-value.json
tests/compatibility/v1/revision-conflicts.json
tests/compatibility/v1/semantic-workflow.json
tests/compatibility/v1/simulation-bundle.json
tests/compatibility/v1/state-transitions.json
tests/compatibility/v1/strategy-manifest.json
third_party/licenses/caniuse-lite-1.0.30001810-LICENSE
third_party/licenses/img-sharp-libvips-darwin-arm64-1.3.3-README.md
third_party/licenses/img-sharp-libvips-darwin-x64-1.3.3-README.md
third_party/licenses/img-sharp-libvips-linux-arm-1.3.3-README.md
third_party/licenses/img-sharp-libvips-linux-arm64-1.3.3-README.md
third_party/licenses/img-sharp-libvips-linux-ppc64-1.3.3-README.md
third_party/licenses/img-sharp-libvips-linux-riscv64-1.3.3-README.md
third_party/licenses/img-sharp-libvips-linux-s390x-1.3.3-README.md
third_party/licenses/img-sharp-libvips-linux-x64-1.3.3-README.md
third_party/licenses/img-sharp-libvips-linuxmusl-arm64-1.3.3-README.md
third_party/licenses/img-sharp-libvips-linuxmusl-x64-1.3.3-README.md
third_party/licenses/img-sharp-wasm32-0.35.4-LICENSE
third_party/licenses/img-sharp-wasm32-0.35.4-README.md
third_party/licenses/img-sharp-win32-0.35.4-LICENSE
third_party/licenses/img-sharp-win32-arm64-0.35.4-README.md
third_party/licenses/img-sharp-win32-ia32-0.35.4-README.md
third_party/licenses/img-sharp-win32-x64-0.35.4-README.md
third_party/licenses/streamparser-json-MIT.txt
third_party/licenses/tslib-2.8.1-CopyrightNotice.txt
third_party/licenses/tslib-2.8.1-LICENSE.txt
third_party/licenses/xyflow-system-MIT.txt
tsconfig.base.json
turbo.json
```

## 12. Risks and rollback

- **Synthetic numbers read as market data.** Mitigation: persistent `MOCKED`
  labels, a round fixture rate named as synthetic, no USD, fees or gas, a
  "Not modeled" block, and the adjacency and wording rules of R-1.
- **Digest divergence from the frozen profile.** Mitigation: differential tests
  over vectors, generated data and malformed input on the pinned toolchain; a
  self-check before every generation; and E2E verification of rendered
  artifacts by the frozen Node implementation.
- **Stale or expired results displayed as current.** Mitigation: the access
  guard on every use and tab resume, with wall and monotonic expiry; a
  discarded-completion rule; hidden numbers and JSON on non-current chains;
  race, expiry and resume tests.
- **Scope drift toward authority artifacts.** Mitigation: an explicit stopping
  point, the absent digest domains, the new source scans and literal
  non-executable types.
- **Visual churn and clock flakiness.** Mitigation: all five changes are
  reviewed through before/after/diff evidence, and time-dependent states run
  under a fixed Playwright clock.
- **Governance regression during the transition.** Mitigation: historical
  BUILD-003A checks are pinned to Git trees and blobs, and negative tests run
  in isolated copies.
- **Delivery.** The agent's shell cannot authenticate over SSH (§2). The work
  stays committed locally until the owner pushes. Transport settings are not
  changed.
- **Rollback.** Before delivery, revise the branch's scoped changes and
  preserve unrelated work. After an authorized merge, a reviewed revert
  restores code, records and images together. Nothing is destructive, and no
  financial state exists to undo.

## 13. Questions requiring human decision

### Design decisions selected by the owner on 2026-09-24

These selections define scope. They do not authorize implementation.

| Decision | Selected option | Rejected alternatives |
|---|---|---|
| D-1: where the chain stops | Stop after the Simulation Bundle. The only next step is the disabled "Manifest review unavailable". | `MOCKED` Authorization Policy and Strategy Manifest, which would need a fabricated owner, recipients, contracts, functions, nonce, deadline and revocation epoch |
| D-2: where browser hashes are computed | A browser-safe digest in `packages/reference-linter` (WebCrypto plus the existing `canonicalize@5.0.0`), checked for equivalence against the unchanged frozen implementation (§3.6) | A loopback server action, which adds a server trust boundary; modifying the frozen contracts package |
| D-3: synthetic output presentation | One fixed rate, 1 WETH = 1,000 USDC in both directions, no spread, labelled synthetic, valid for 60 seconds | A user-entered rate; zero-output placeholders |

The owner's eight acceptance requirements, R-1 to R-8, are traced in §5.1.

### Routine choices resolved from the repository

These change only with a plan revision.

- Generation is app-local; digest and review are in the linter; no new
  package. Extraction to the reserved `packages/reference-simulation/**` waits
  for the first non-mock simulation.
- Generation is explicit and never automatic.
- The canonical state stays `DRAFT`.
- Numbers and JSON of non-current chains are hidden.
- Rounding is down; adverse equals minimum; failure is modeled as a revert.
- Generation is blocked by any BLOCK finding except the unconditional one.
- Mock nodes are excluded, with a disclosure.
- The build label is updated, and five snapshots change through the
  BUILD-003A evidence method.
- The chain is in-memory only; there is no chat command for generation.
- Findings keep the existing `WARNING` and `BLOCK` levels.
- "Exported JSON" (R-6) means the copyable per-artifact JSON block. A
  file-download control is not included. Adding one would be a scope change.

### Final scope approval recorded

On 2026-09-24 the human owner explicitly approved implementation of this
revised plan. The approval covers:

- decisions D-1 to D-3 and requirements R-1 to R-8;
- the exact §11 paths, the visual changes in §3.10 and the governance
  transition in §3.12.

The owner confirmed that "exported JSON" means the complete copyable
per-artifact JSON block, with no file-download control. The owner approved
the §11 counts (25 created, 34 modified, 59 in total) and the permitted
negative disclosures in R-1.

Routine implementation fixes within this scope are authorized. A new decision
is required before any remedy that would:

- expand scope;
- change a protected file or an external dependency resolution;
- weaken a gate;
- introduce an excluded capability.

Delivery covers the commit titled "Implement Build 003B mocked artifact
chain", a push over the configured SSH transport if authentication is
available (otherwise the commit is preserved and the manual push command is
reported), and a pull request into `main` opened with the authenticated
GitHub CLI, with its CI inspected. Authentication and transport settings are
not changed.

Merging, BUILD-003C, Mode B, live protocol access, wallet, signing, submission
and financial execution remain unapproved. ADR-0001 remains `PROPOSED`.
