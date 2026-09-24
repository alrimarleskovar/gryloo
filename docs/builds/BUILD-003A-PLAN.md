# BUILD-003A — Uniswap swap authoring and deterministic lint

Status: `IMPLEMENTATION_APPROVED` by the human owner on 2026-09-24 (DEC-0018).

This plan incorporates the owner's attached O-1–O-14 decisions and the subsequent
clarification of O-4 and O-7. The original planning authorization permitted only the local branch and this
file. The human owner subsequently approved the entire plan, its exact Section 11
file scope and governance transition, and authorized implementation, commit,
SSH push and PR creation (DEC-0018). This approval does not extend to execution
or later sub-builds.

## 1. Single objective

Author the same isolated, exact-input USDC↔WETH swap intent on Base through the
existing Build screen's chat and canvas, and produce deterministic review findings
without quotes, simulation, authorization, or execution.

## 2. Relationship to v3.2

- Master Spec: §5.1, §6.1, §6.4, §7.2–7.4, §7.8–7.9, §8.5, §9 and Phase 2.
  Master Prompt: Build 003, P1–P5, and §5.1's thirteen-section plan template.
- Preserved differentiators: one revisioned Semantic Workflow IR; proposals need
  explicit application; user locks and stale revisions are respected; financial
  artifacts remain separate; AI is never financial authority.
- Product gate: authoring/schema/round-trip/lint evidence for P1–P5 only. This
  sub-build does not certify the Uniswap primitive, complete Build 003, or claim
  P6–P14. It does not mark Phase 0 complete.
- Dependencies: BUILD-001 contracts and BUILD-002 shell are merged. The governance
  amendment is merged, and DEC-0015 permits separately approved non-executing
  authoring while ADR-0001 stays `PROPOSED`; DEC-0016 includes the linter here.
- Planning baseline: local `main`, local `origin/main`, and live GitHub `main`
  all resolve to `14a94584b0a3119c1f6275a05b9e752dafe0a042`. The initial working
  tree was clean; no BUILD-003A plan or local/remote branch existed. Live remote
  verification used the authenticated GitHub branch API after shell Git could
  not authenticate. No remote branch was created.
- Planning branch: `codex/build-003a-swap-authoring-lint`, created from that exact
  baseline. No Claude conversation or private memory is an authority source.
- The requirement IDs below were registered after DEC-0018. This plan table
  states targets, not claims of completed work:

| Proposed ID | Requirement and source |
|---|---|
| B003A-REGISTRY-001 | Exact action/capability declarations and immutable asset context; §7.4 |
| B003A-AUTHORING-001 | Both Base pair directions through existing chat/canvas; §5.1, §6.1 |
| B003A-REVISION-001 | Explicit proposals, locks, conflicts and invalidation; §7.8 |
| B003A-VALIDATION-001 | Runtime validation of malformed and forged inputs; §7.4, §9 |
| B003A-LINT-001 | Deterministic prototype review rules, no execution authority; P5, §8.5 |
| B003A-EQUIVALENCE-001 | Actual surface inputs and mixed-edit equivalence; P2–P4 |
| B003A-HONESTY-001 | Accurate non-executing UI and evidence labels; §7.7 |
| B003A-VISUAL-001 | Reviewed visual changes and zero-pixel subsequent regression; Prompt §9.7 |
| B003A-COMPATIBILITY-001 | Frozen wire/hash behavior and additive exports; ADR-0002 |
| B003A-SUPPLY-001 | Existing resolutions, approved browser, ephemeral SBOM; Prompt §8 |
| B003A-GOVERNANCE-001 | Historical scope checks and current exact scope both preserved; Prompt §5 |

## 3. Authorized scope

The human owner approved the complete implementation scope in this section on
2026-09-24 (DEC-0018).

### 3.1 Registry and asset identity

Add these named exports to the existing root API of the private Apache-2.0
`@defi-workflow-engine/action-registry@0.1.0`: `referenceRegistry` and
`baseAssetRegistry`. Preserve every existing export and export-map entry.
No existing schema, fixture, canonical projection, or package version changes.

| Field | Exact value |
|---|---|
| registryId | `reference.registry` |
| registryVersion / schemaVersion | `1.0.0` / `1.0.0` |
| Capability ID / version | `swap.direct-transaction` / `1.0.0` |
| Capability status / enforcement | `DECLARED_ONLY` / `NOT_ENFORCED` |
| Action ID / actionType | `asset.swap.exact-input` |
| Action version / actionSchemaVersion | `1.0.0` / `1.0.0` |
| Node class | `ACTION` |
| Declared execution kind / authorization mode | `DIRECT_TRANSACTION` / `A` |
| Swap node requiredAuthorizationClass | `MODE_A`, describing a future requirement only |
| Current application authorization | `NONE` |
| Allowed chain | Base mainnet identifier `eip155:8453` |
| Protocol constraint | `uniswap` |
| Adapter constraints | Empty adapter list; no adapter is implemented or selected |
| Arbitrary targets | `false` |

Registry input ports are `amount-in` (`AMOUNT_UNITS`, required) and `asset-out`
(`ASSET_REF`, required); output port is `amount-out` (`AMOUNT_UNITS`, required).
The typed asset constant is immutable context, not a new wire schema and not a
user-editable IR field. Freeze nested objects at runtime, not merely with a
TypeScript readonly assertion. The generic action amount minimum is `1` native
unit; per-asset maxima below are authoritative and checked separately.

| Asset | Canonical address in IR | Decimals | BUILD-003A authoring cap | Native-unit cap |
|---|---|---|---|---|
| USDC | `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` | 6 | 1,000,000 USDC | `1000000000000` |
| WETH | `0x4200000000000000000000000000000000000006` | 18 | 1,000 WETH | `1000000000000000000000` |

Addresses use the existing canonical lowercase representation. Symbols are
display metadata, not substitutes for chain/address identity. WETH means the
wrapped ERC-20, not native ETH; reject ETH aliases, USDbC, other assets, other
chains, identical input/output assets and inconsistent decimals. The caps are
prototype input constraints, not financial safety guarantees, and must not
automatically carry into an execution-enabled build.

### 3.2 First-party evidence and its limits

The following values and source bytes were checked during planning on 2026-09-23.
No RPC, explorer contract call, wallet, quote or transaction was used. The
implementation report must repeat the authoritative-value/provenance check and
record the retrieval time, source URL, evidence class and observed digest.

| Fact | Source and classification |
|---|---|
| Base chain ID 8453 | [Base connection documentation](https://docs.base.org/get-started/connect-to-base.md), first-party network documentation |
| Base WETH address | [Base contract table](https://docs.base.org/specifications/reference/base-contracts.md), first-party deployment-address documentation, Base Mainnet row |
| Base USDC address and symbol | [Circle USDC contract directory](https://developers.circle.com/stablecoins/usdc-contract-addresses.md), first-party issuer address documentation, Base Mainnet row |
| USDC six decimals | [Circle general USDC documentation](https://github.com/circlefin/skills/blob/58ab8648bb1ae9d037a3bf5197ad3bb01262f5b1/plugins/circle/skills/use-usdc/SKILL.md#the-6-decimal-rule), general first-party documentation with an EVM example; not Base on-chain verification |
| WETH symbol and 18 decimals | [Optimism WETH98 source](https://github.com/ethereum-optimism/optimism/blob/0f476b44a3a284855361685b97baeb4bfb26729b/packages/contracts-bedrock/src/universal/WETH98.sol), commit-pinned first-party source-code evidence, lines 28 and 73–74 |

The full Optimism commit is
`0f476b44a3a284855361685b97baeb4bfb26729b`. Raw source URL:
[WETH98.sol at the pinned commit](https://raw.githubusercontent.com/ethereum-optimism/optimism/0f476b44a3a284855361685b97baeb4bfb26729b/packages/contracts-bedrock/src/universal/WETH98.sol).
It provides source-code evidence for the selected metadata, not proof that Base's
deployed WETH bytecode or live storage matches that source. Both assets retain
`NOT_ONCHAIN_VERIFIED`. The Circle document is used as evidence only; its
transaction instructions do not authorize transactions in this build.

| Retrieved bytes | Observed SHA-256 |
|---|---|
| Base connection Markdown | `cda7b0c411633a7b0b114f69425d90fdc6cff6a6d2a2a744af45698d80a49abb` |
| Base contracts Markdown | `3fcc1679b649edd56fb8fac98278d5414a66f6206176158b01d1b234692f5282` |
| Circle contract directory Markdown | `15a692cfa55bba37f19e2470f4d759fe2b24ebd690669341d89e9894c1b3a3c2` |
| Circle pinned raw general documentation | `234b616ac688a71a464757c9f77af2973d029ce9c30b49bcf12d87a38d6c7b42` |
| Optimism pinned raw Solidity source | `e6bd6c08c89b5bdd62e17e16c8c3ae1d12b550a376a4710888b9e68c95e62d30` |

Circle's pinned raw URL is
[the general USDC document](https://raw.githubusercontent.com/circlefin/skills/58ab8648bb1ae9d037a3bf5197ad3bb01262f5b1/plugins/circle/skills/use-usdc/SKILL.md).
Digests identify retrieved bytes; they are not publisher signatures or on-chain
proof. A changed webpage digest alone is not a changed token identity. Compare
the authoritative values and relevant supporting passages. Investigate changed
values or unavailable evidence; do not invent replacement evidence, silently
change assets, or call RPC to resolve uncertainty. Retain factual citations and
short metadata only, without copying upstream Solidity into original packages.

### 3.3 Semantic node and authoring behavior

- Use the frozen Semantic Workflow IR schema. The swap has an `amount-in`
  QUANTITY containing the input asset and native-unit amount, an `asset-out`
  ASSET input, and one `amount-out` expected output with the output asset and
  `minimumAmount: "0"`. There are no runtime or quote fields in IR.
- Add one `MAXIMUM_INPUT` constraint matching the user's exact input amount and
  one explicit `MAXIMUM_SLIPPAGE_BPS` constraint. Do not add a fabricated quote
  or a positive minimum-output promise. Failure policy is `ABORT`.
- Swap nodes declare `requiredCapabilities: ["swap.direct-transaction"]`.
  New swap nodes have empty dependencies and no resource edges or output-reference
  inputs. Reject all connections involving swap nodes, including dependencies,
  incoming/outgoing edges and references introduced by forged commands or IR.
  This is a temporary BUILD-003A limitation, not a permanent workflow restriction.
- Preserve the initial mocked workflow and existing mock actions. Isolated swap
  nodes may coexist with them, with chain and mock status clearly distinguished.
  Do not describe mocked nodes as real Base operations. Preserve existing mock
  editing behavior; do not use mock edges as evidence of executable composition.
  The existing mock CONNECT representation is not a typed financial resource
  flow. Report any whole-workflow contract failure honestly and require a valid
  candidate workflow before applying a swap edit; do not silently rewrite legacy
  mock graphs or broaden the frozen contract to make a review pass.
- Direction is selected at creation: USDC→WETH or WETH→USDC. Changing direction
  requires removing an unlocked node and creating another. No wrapping/unwrapping.
- The existing action library opens a creation form with an explicit direction,
  a blank human-decimal amount and a blank integer-bps slippage field. Both fields
  are required. There is **no prefilled amount or slippage value**. The direction
  may initially show USDC→WETH and must appear explicitly in the proposal diff.
- Deterministic local chat supports `swap <amount> USDC to WETH on Base slippage
  <bps> bps` and the reversed pair, plus `set <node-id> amount <amount>` and
  `set <node-id> slippage <bps> bps`. Preserve the existing mock commands and
  `explain`. Case-insensitive asset/keyword matching does not change numeric text.
  This is a documented command grammar, not unrestricted natural-language AI.
- The swap inspector edits human-decimal amounts and explicit slippage, shows
  integer native units, addresses, decimals, chain, prototype caps and provenance
  limitations. The existing amount lock applies across both surfaces; only the
  canvas can unlock it. A locked input has no overlapping editable bound; unlock
  restores the registry-derived bound, never a caller-provided widened bound.
- Proposals show exact before/after values, node/direction, asset identities,
  amount in human and native units, slippage, base revision, locks and review
  findings. Any visible prefill introduced later needs explicit plan revision
  and inclusion in that diff. Dismissal makes no semantic change.
- Accepting an authoring proposal applies one immutable revision through the
  shared reducer. Reject stale revisions and revision overflow without replacing
  the current workflow. A no-op does not increment the revision. Recompute review
  findings on every accepted semantic edit; never display an old revision's
  findings as current. Form state, pending diffs and review results stay outside IR.

### 3.4 Deterministic linter and runtime ingress

Create private ESM `@defi-workflow-engine/reference-linter@0.1.0`, AGPL-3.0-only.
Its export map contains exactly `.` (types/import) and `./package.json`, with
`files: ["dist", "LICENSE"]`. Root named exports include `lintWorkflow`,
`validateAuthoringWorkflow`, `createReviewContext` and their result/context types.
No new serialized artifact or wire schema is introduced.

The browser must not import Node-only contract hashing/parser entrypoints.
The existing server-rendered `src/app/page.tsx` imports the approved registry
constants and supplies their serializable context to `WorkflowProvider` at build
time. The provider validates and recursively freezes that context once, outside
the editable workflow/command path. It cannot be set by chat, a form, a query
parameter or an IR field. Runtime linter code imports the frozen workflow JSON
schema via its existing public schema export and the already-approved Ajv
`8.20.0`; workspace contract/registry types use type-only imports. Enable JSON
module support in the new package's own tsconfig. Node-only frozen raw ingress
and hashing are exercised in integration tests, not bundled into the browser.

Validate runtime inputs as `unknown` before access, arithmetic, lint or mutation:

1. Bound input before parsing or BigInt conversion: chat at most 1,024 code units;
   human amount at most 80 ASCII characters; integer amount at most 78 digits;
   slippage text at most five digits; object graph at most 1 MiB equivalent
   serialized data and depth 64, with existing schema node/port/edge limits.
   Reject cycles, non-plain objects, accessors and malformed primitives at object
   ingress. Use bounded traversal, not unbounded serialization to measure size.
2. Use closed command shapes and closed frozen schemas, without coercion,
   additional-field removal or defaults. Reject unknown/runtime fields, unsafe
   numbers, non-integer revisions, unsupported action/version/capability/protocol,
   unknown assets and mismatched chain/address/decimals throughout inputs,
   outputs, constraints, bounds and locked values. Assertions are not validation.
3. Reject duplicate node IDs, registry action/capability IDs, port names, output
   IDs, locked parameter names, bound names and edges; unknown graph endpoints,
   dangling output references, mismatched input/output references, self-edges,
   cycles and incompatible asset flow. Validate registry context structurally
   and semantically before use; no caller-supplied declaration creates authority.
4. Convert decimal amounts with string splitting/padding and BigInt only. Accept
   `0` or a nonzero-leading integer part, optionally followed by a nonempty
   decimal fraction with at most the asset's decimals, then require positive
   native units. Reject signs, exponent notation, whitespace within the field,
   commas, Unicode digits, NaN/Infinity, leading zeros, empty fractions, excessive
   precision, uint256 overflow and amounts above the asset cap. Never round.
5. Reject invalid bounds: malformed amounts, minimum above maximum, wrong asset,
   unknown parameter, locked-and-editable overlap, mismatched locked value,
   minimum below one unit, or maximum above the trusted per-asset cap. Missing
   or narrowed IR bounds cannot disable the registry cap. Check actual amounts
   against the intersection of trusted bounds and any valid narrower user bound.
6. Slippage is an explicit integer number in IR. Reject negative, non-integer,
   non-finite, string/coerced or otherwise malformed values and values outside
   the frozen 0–10,000 bps schema domain. Duplicate or missing constraints produce
   a blocking finding; creation/edit commands cannot silently synthesize them.

Untrusted serialized artifacts still use the unchanged BUILD-001 raw-byte
parser before object/schema validation, including duplicate decoded JSON keys.
No JSON import UI or alternate serialized parser is added. Object validation
does not claim to detect duplicate keys already discarded by another parser.
Cross-check valid authored outputs with `parseArtifactBytes` in Node tests.

| Slippage input | BUILD-003A review result |
|---|---|
| 0 bps | `WARNING` |
| 1–100 bps | No threshold warning |
| 101–300 bps | `WARNING` |
| 301–10,000 bps | `BLOCK` |
| Missing or duplicated constraint | `BLOCK` |
| Negative, non-integer, malformed, or outside schema domain | Reject as invalid input |

These are prototype review rules for this build only, not recommendations,
certified financial safety limits, guaranteed safe execution settings, or
defaults for future execution.

Findings have stable codes, severity, node/field location and deterministic
ordering. The result links to the reviewed revision and always declares
`executable: false` and `enforcement: NOT_ENFORCED`. It contains no timestamps,
network results or mutable authority state. Identical inputs/context yield
identical findings without mutating either input.

Every swap receives an explicit unquoted/execution-unavailable blocking finding.
The zero minimum is an **unquoted placeholder**, never a guaranteed output. A
forged positive minimum is rejected for this authoring profile and cannot remove
the unconditional execution-unavailable state. A valid authoring proposal may be
saved with visible review BLOCK findings (for example slippage above 300 bps),
but malformed structure/amounts/metadata/bounds cannot be applied. Saving intent
is distinct from execution readiness. No review result, even a forged empty
finding list, enables simulation, signatures or execution.

### 3.5 Existing-screen changes and visual evidence

There is exactly one application route involved: `/`, implemented at
`apps/reference-dapp/src/app/page.tsx`. Build, Simulate and Execute are existing
tab states in `app-shell.tsx`, not separate routes. Do not create `/swap-authoring`.
Retain the existing visual language and responsive layout; no new design system,
fonts, animation framework or unrelated restyling is included.

| Expected visible change | Existing component path under `apps/reference-dapp/src/` | Affected baseline |
|---|---|---|
| Accurate BUILD-003A title, Base authoring context and non-executing copy | `config/product.ts`, `app/layout.tsx`, `components/top-bar.tsx`, `components/app-shell.tsx` | Build, Simulate, Execute |
| Add swap entry and direction/amount/slippage creation form; retain mocks | `components/action-library.tsx` | Build; new proposal state |
| Swap card shows pair, chain, amount and unquoted state; hides swap connection handles; footer distinguishes mock and swap nodes | `components/workflow-canvas.tsx` | Build after creation; new review state |
| Swap amount/slippage editing, lock behavior, native units and trusted metadata | `components/artifact-inspector.tsx` | Build selected swap; new review state |
| Local grammar/help and explicit proposal diff with current findings | `components/copilot-panel.tsx` | Build; new proposal state |
| Revision-linked deterministic findings and unavailable execution explanation | new `components/review-panel.tsx`, existing `components/app-shell.tsx` | Build; new review state |
| Accurate authoring counts and unavailable-button accessible label | `components/summary-bar.tsx` | Build, Simulate, Execute |
| CSS limited to the added forms, diff and findings, including responsive overflow/focus states | `app/globals.css` | Build and new states; shared-shell differences only as listed above |

The three existing baselines are exactly
`apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/build-chromium-linux.png`,
`apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/simulate-chromium-linux.png`
and `apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/execute-chromium-linux.png`.
The owner selected O-1 Option B: intentional changes above supersede the prior
requirement that these current screenshots stay byte-identical. Simulate/Execute
behavior, disabled controls and lack of financial functionality are preserved.

Before implementation UI changes, reproduce the three baseline screens at the
exact main baseline with the approved browser and existing 1440×900, en-US,
light, reduced-motion settings. Verify zero-pixel agreement; record browser/OS
identity. Retain those images in the exact before-image paths in §11. Capture
after images using the same settings, calculate changed-pixel counts, and retain
the three diff images. The after images become the three existing baseline files
only after inspection confirms every difference matches this table. Record the
mapping, counts and image hashes in the report. Investigate any other change;
do not normalize environment drift or unrelated defects into replacement images.
Add deterministic snapshots for a pending reverse-direction proposal and a
selected swap with blocking review findings. All subsequent tests retain
`maxDiffPixels: 0`, with no widened tolerances, masking or automatic CI updates.

### 3.6 Workspace, dependencies, browser and CI

Inspection of the baseline establishes:

| Gate | Existing inclusion | Exact implementation change |
|---|---|---|
| Workspace discovery | `pnpm-workspace.yaml` includes `packages/*` | No configuration change |
| Typecheck/build | Root scripts run Turbo; tasks depend on `^build` | New package declares `build: tsc -p tsconfig.json` and `typecheck: tsc -p tsconfig.json --noEmit`; add app workspace dependency |
| Lint | Root ESLint command includes `packages` and application source/E2E | No root script or ESLint change |
| Tests | Root Vitest command is `vitest run packages apps/reference-dapp/src` | New tests under the exact §11 package/app test paths are automatically discovered |
| E2E | Playwright `testDir: ./e2e` | Add the exact swap spec; preserve guarded fixture and existing specs |
| Remote CI | `contracts.yml` runs all root gates and the app E2E suite | Keep these commands; add explicit linter discovery/output checks and SBOM workspace accounting |

The new linter depends only on the two existing workspace packages at
`workspace:0.1.0` and existing registry dependency `ajv: 8.20.0`. Add the linter
to the app at `workspace:0.1.0`. There are no new external versions or registry
resolutions. Lockfile changes are confined to the linter importer and the app
workspace link/importer. Keep the full `packages` and `snapshots` sections,
integrities, peers, patch identities and 245 registry entries unchanged.

`scripts/bootstrap-ci.py` currently compares the app dependency dictionary
exactly; minimally admit the one linter workspace link and validate the new
importer's exact dependencies. Keep all direct external pins, release-age,
integrity, graph-route, 16-exception license and 245-entry checks. No permissive
workspace-prefix wildcard in place of an exact approved package inventory.

Use the already-approved Node 24.21.0, pnpm 11.22.0 and Playwright 1.63.0. No
installation occurs during planning. After approval, update only workspace
links/importers offline with lifecycle scripts disabled, inspect the restricted
diff, then run the frozen install and existing gates. Any resolution discrepancy
requires investigation and explicit scope approval before substitution.

The existing browser cache is
`/tmp/gryloo-build-002-browser/chromium_headless_shell-1243`. Reuse it if integrity
and executable identity can be established using the approved verification
mechanism/evidence. A directory name or version string alone is not an integrity
proof. Inspection found that `scripts/bootstrap-playwright.py` verifies downloads
but has no cache-verification mode and deletes its downloaded archive. Therefore
reuse is conditional on sufficient retained approved integrity evidence, not
assumed from cache existence. If that evidence is unavailable, use the unchanged
approved bootstrap at an unused temporary destination ending in the same revision.
Do not download merely because the build number changed and do not delete the
existing cache. Keep the `BUILD002_BROWSER_CACHE` environment variable for
compatibility; it names the approved browser revision, not current product scope.

Approved archive: Linux x64 headless shell revision 1243, version 153.0.8010.12,
119,809,080 bytes, SHA-256
`a9da028861a0cf789ff25c2fed45f5f1aaf969ed9247835b6a7821a4f7af9d1d`.
Preserve the approved URL, single redirect, archive-entry checks, extraction
controls and executable-version verification. Its classification stays
`LOCALLY_OBSERVED_HUMAN_APPROVED`, not publisher-issued integrity proof.
No Playwright installer, extra browser, FFmpeg, OS package or browser upgrade.

Preserve the loopback-only browser request guard, its synthetic negative proof,
blocked service workers, disabled telemetry, lifecycle scripts and automatic
browser downloads. Static metadata research is not application network access.

SBOM: a planning-time run of the existing pinned pnpm against the unchanged
lockfile confirmed CycloneDX 1.6 with 245 registry components, zero workspace
components in `components`, and root `defi-workflow-engine@0.1.0` in
`metadata.component`. The temporary output was removed immediately (observed
SHA-256 `0ef7cb3beb2e0aba5930d2155f8c2bdbcedb93ff1dd2920b0a1a69c14900f105`).
This verifies baseline generator behavior, not the future linter importer.
`contracts.yml` currently rejects every component outside that exact registry
set; it must not misclassify a new workspace component as a new registry package
or silently discard it. After adding the importer, run the same pinned
`pnpm sbom --sbom-format cyclonedx --sbom-spec-version 1.6 --lockfile-only` and
inspect actual output. Keep exact equality for the 245 registry identities and
their 16 reviewed license exceptions. Account separately for workspace
components emitted by this pnpm version: only the root, workflow-contracts,
action-registry, reference-dapp and reference-linter identities at `0.1.0` are
permitted, with their manifest licenses and valid dependency references. Validate
the root metadata component separately. If workspace components are omitted by
the generator, report that limitation and validate the exact workspace manifest
and lock-importer inventory independently; do not claim inclusion. This is an
output-format check, not permission to change dependency resolutions. Reject
duplicates, unknown identities, missing registry entries and unsupported license
claims. Log registry/workspace counts and the final SBOM digest, then remove the
temporary SBOM; no retained/uploaded SBOM is authorized.

### 3.7 Governance transition after approval

Do not modify any governance file during this plan-only task. After approval:

- Allocate the next available sequential decision IDs. At the planning baseline
  the next number is 0018; re-read the register at implementation start. Record
  the actual approval and O-1–O-14 choices then, preserving all historical rows.
  Do not fabricate an approval date or insert references to unregistered IDs.
- Register the B003A requirement IDs above. Extend both requirement-reference
  and register validation patterns consistently to support a lettered sub-build,
  retaining existing numeric IDs and duplicate/reference checks.
- Preserve historical BUILD-002 scope by comparing Git trees at
  `fb285da4ea4efaaae5b839974b669b3c8335ddd7` and
  `606174f0bd944e5a1c31baf8dad685d7558b7cc8`. Preserve amendment scope and its
  license-map-only correction by reading trees/blobs at that BUILD-002 merge
  and `14a94584b0a3119c1f6275a05b9e752dafe0a042`, not current files.
- Add a separate exact BUILD-003A scope comparison from the latter baseline to
  the reviewed current tree, using §11 and rejecting deletes, unexpected modes,
  symlinks and unlisted paths. Explicitly fetch the historical commits needed by
  shallow CI. Include staged, unstaged and untracked files in local checks.
- Keep the old visual hashes checked against historical Git blobs; check new
  current baselines against the approved images/report and zero-pixel E2E tests.
  Do not turn off protected-byte checks globally to permit visual changes.
- Retain secret, email, relative-link, brand, unsupported-claim, identifier,
  official-license, patch, attribution, frozen-schema/fixture, package and heading
  checks; include the new 13-section plan and 14-section report in heading checks.
  Extend exact package/manifest and AGPL classification lists only for the linter.
- Evolving current STATUS, NEXT_BUILD, AUTHORITY_MATRIX, LICENSE_MAP and scope
  checks must reflect BUILD-003A's actual approved/implemented state, not require
  amendment-era `NONE_APPROVED` throughout implementation. Keep the full Build
  003 execution scope, BUILD-003B/003C, Mode B and publication unapproved. At
  completion, NEXT_BUILD contains `NONE_APPROVED` unless separately authorized.
- Preserve all historical approval and license facts; update root LICENSE only
  to truthfully include the newly populated AGPL reference-linter path. No grant
  or official license text changes. Keep permanent records and README accurate.

## 4. Out of scope

RPC, live protocol/price/balance/allowance calls, live quotes or route selection,
Uniswap SDK/adapters, router addresses, calldata, spender/recipient selection,
wallet connection, approvals, signing, transaction submission, fork/testnet/mainnet
execution, financial simulation, policy/Manifest compilation, persistence,
Execution Journal/reconciliation implementations, SDK publication, backend/API,
workers, external AI services, swaps connected to any other node, Mode B/C,
BUILD-003B/003C and P6–P14 certification are excluded. No new wire schemas,
canonicalization changes, external resolutions, generalized token registry,
automatic slippage defaults, dedicated route or unrelated visual redesign.

## 5. Acceptance criteria

- [ ] Exact registry declarations validate against the unchanged registry schema;
  metadata and provenance match §3.1–3.2 and remain `NOT_ONCHAIN_VERIFIED`.
- [ ] Both directions can be created from actual chat text and canvas controls;
  amount/slippage edits, explicit diffs, apply/dismiss, locks, no-ops and stale
  revisions behave identically through the one reducer.
- [ ] Runtime validation rejects the malformed/forged cases in §3.4 without
  mutation, silent coercion, exception leakage or enabled execution controls.
- [ ] Trusted caps cannot be widened through editable bounds, forged metadata,
  removed constraints, an alternate context supplied as input, or direct reducer
  calls. Caps and slippage thresholds are identified as BUILD-003A prototypes.
- [ ] Slippage boundaries exactly match the table; missing slippage has no silent
  default. All swaps remain unquoted and execution-unavailable, including forged
  positive minimum-output and forged review-result attempts.
- [ ] Swap edges, dependencies and output-reference links are rejected regardless
  of entry path; existing mock controls remain available as mocked features.
- [ ] Review output is deterministic, immutable, revision-linked, separate from
  IR, and explicitly not an enforcement boundary.
- [ ] Equivalent real surface edit sequences produce equal canonical semantic
  hashes and values at equal revision; mixed editing and conflict cases pass.
- [ ] Simulate and Execute remain unavailable; interface labels remain `MOCKED`,
  `NONE`, `NOT_ENFORCED`, `NOT_APPLICABLE`, with authoring/lint described as
  implemented only after the corresponding tests pass.
- [ ] Before/after/diff evidence accounts for all three changed baselines, the
  new authoring states are covered, and subsequent visual runs pass at zero pixels.
- [ ] The new package demonstrably participates in typecheck, build, lint, unit
  test discovery and remote CI; compiled declarations/root exports resolve and
  the production browser bundle does not require Node builtins.
- [ ] Frozen contracts, 10 schemas, 20 compatibility fixtures, patches, 21 copied
  upstream legal files and historical records retain their protected identities.
- [ ] Registry lock entries/resolutions remain exactly unchanged; workspace links
  are exact; dependency/license/audit and honest SBOM accounting pass.
- [ ] Historical and current governance gates both pass without discarded checks;
  every path has exactly one license classification.
- [ ] The implementation report records actual local and remote evidence, missing
  evidence and limits separately. No remote CI success is claimed from local runs.

## 6. Required tests

**Unit:** validate/deep-freeze the registry and asset constants; exact amount
parsing at one native unit, each cap and cap-plus-one; both asset decimal scales;
registry immutability; deterministic findings and stable ordering; all slippage
boundaries (0, 1, 100, 101, 300, 301, 10,000, 10,001), missing/duplicated values;
proposal diff fidelity; lock/unlock, remove, no-op and revision conflict behavior.

**Integration:** validate authored workflows with unchanged `parseArtifactBytes`;
hash via unchanged `hashArtifactBytes`; ensure material edits change semantic
hashes and revision, rejected edits preserve both, and review-only changes do not
enter semantic hashes. Run existing schema-export and fixture/hash regressions.
Compare browser-safe validation with frozen contract validation for supported
authoring inputs; stricter temporary authoring restrictions must be explicit.
Check linter root/package.json exports and private `0.1.0` package identity.

**E2E:** type the documented chat command, inspect its proposed diff and apply;
separately create the same swap by clicking the library form, selecting direction
and entering the same amount/slippage. Read each actual rendered IR and compare
canonical hashes in the Node test runner. Do this for both directions. Also
compare chat-create→canvas-edit→chat-edit with canvas-create→chat-edit→canvas-edit
using equal edits/revision counts. Exercise dismissed proposals, stale proposals
after a canvas edit, locked chat edits and warnings/blocks at the visible surface.
Do not substitute two calls to the same factory for surface equivalence evidence.
Preserve existing shell, keyboard, accessible-name, responsive-overflow,
round-trip, interface-honesty, request-isolation and zero-pixel checks.

**Failure/adversarial:** unknown/runtime fields; arrays/null as objects;
accessors/cyclic or excessive input; duplicate IDs/ports/constraints; dangling
and cyclical graph references; wrong asset addresses/chains/decimals;
malformed/overlong/negative/zero/overflow amounts; precision loss attempts;
non-integer slippage; invalid/narrowed/widened bounds; mismatched locks; forged
registry/context fields in commands/IR; tampered action/version/capability;
unquoted zero/positive output; forged success findings; all swap edge directions;
stale revision and overflow. Invalid changes preserve the prior immutable state.

**Governance/CI:** prove each restored control still runs, including targeted
negative checks in an isolated temporary copy for unauthorized paths, protected
byte mutation, malformed/duplicate/unregistered IDs, altered historical scope,
wrong linter license/export and unexpected workspace dependency. Do not modify
the working tree to inject those failures. Record new package discovery in Turbo
task output, ESLint coverage, Vitest file output and remote job logs; preserve
frozen install, schemas:check, dependency review/audit and ephemeral SBOM checks.

## 7. Authority and artifacts

- Authorization mode: `NONE`. `MODE_A` on the node and `A` in declarations mean a
  future required authorization class, never an existing signature or permission.
- Enforcement mechanism: `NOT_ENFORCED`; ADR-0001 remains byte-identical and
  `PROPOSED`. Deterministic lint is application review, not financial enforcement.
- Created/changed data: immutable Semantic Workflow IR revisions, declarative
  registry constants, local proposals and ephemeral review results. No Quote/State
  Artifact, Simulation Bundle, Authorization Policy, Strategy Manifest, Execution
  Plan, Execution Journal or Evidence Bundle instance is produced.
- Hashes: existing `semanticWorkflowHash` profile in tests; no new hash domain or
  alternative normalization. Use the existing projection and raw ingress.
- Material-change invalidation: amount, slippage, asset, node, lock/bound or
  semantic graph edits obey the frozen invalidation model. Recompute current
  review; hypothetical downstream artifacts would be invalidated, not fabricated.
- Revocation/cancellation: dismissing a proposal or removing an unlocked authored
  node has no on-chain effect and is never described as financial cancellation.

## 8. Security impact

- Protected assets: intent integrity, review truthfulness, frozen contract
  compatibility, source provenance and governance; no funds or keys are handled.
- Trust boundaries: untrusted chat/forms/commands/IR versus closed runtime
  validation; compiled immutable registry context versus editable fields; draft
  intent versus financial authority; first-party documents versus deployed state.
- Threats: metadata spoofing, bound widening, ambiguous decimal parsing, stale
  proposal application, hidden runtime fields, overlong inputs, invalid graphs,
  false execution readiness and accidental browser network/Node-runtime coupling.
- Controls: §3.4 validation, trusted caps, lock/revision checks, immutable context,
  deterministic lint, unconditional unavailable execution, loopback isolation,
  unchanged supply-chain controls and historical/current exact-scope gates.
- Limitation: a compromised client can misrepresent UI; this build has no
  independent financial enforcement. Review findings and caps cannot claim one.

## 9. Evidence target

- Interface/integration label: `MOCKED`. Authoring and deterministic lint will be
  implemented and tested code, while chat remains a local command parser and
  protocol interaction is absent.
- Build financial evidence environment: `NOT_APPLICABLE`; financial outcome:
  `NOT_APPLICABLE`. No `FORK_REPRODUCED`, `TESTNET_EXECUTED`, `MAINNET_EXECUTED`,
  confirmed or reconciled claim.
- Metadata status: `NOT_ONCHAIN_VERIFIED`, with the distinct source classes in
  §3.2. No source-code digest is presented as proof of a deployed contract.
- Reconciliation invariants: not exercised; no transaction, balance effect,
  allowance effect, receipt or independent reconciliation exists.
- Retained implementation evidence: source/tests, unchanged compatibility
  vectors, exact plan/report, before/after/diff images and report pixel counts,
  source URLs/commits/digests and separately identified local/remote results.
  SBOMs remain ephemeral. Planning research is not implementation test evidence.

## 10. License impact

- `packages/action-registry/` additions: eligible original Apache-2.0 declarative
  material; no copied upstream contract implementation.
- `packages/reference-linter/`: AGPL-3.0-only reference implementation; LICENSE
  is an exact copy of `LICENSES/AGPL-3.0-only.txt`, not the Apache package license.
- `apps/reference-dapp/` source, tests, baselines and visual evidence remain
  AGPL-3.0-only, with its existing official LICENSE unchanged.
- Governance/docs/tooling remain in their existing classifications. Update
  LICENSE_MAP and root routing only to reflect the now-populated linter after
  approval, without relicensing existing paths or changing grants.
- No new external dependency version or license exception. Ajv 8.20.0 already
  belongs to the approved MIT registry inventory. Existing optional-platform
  licensing evidence and future Sharp/libvips release-compliance gate remain.
- Existing frozen package export maps, versions and LICENSE copies are preserved;
  additive named exports do not publish a package or alter a wire schema.

## 11. Expected files

All paths below are repository-relative. The lists are closed: no deletes,
renames, alternative locations or additional files are authorized by this plan.
These are the approved implementation paths relative to the verified main
baseline. No additional paths or deletions are authorized.

### Create

```text
docs/builds/BUILD-003A-PLAN.md
docs/builds/BUILD-003A-REPORT.md
packages/action-registry/src/reference-registry.ts
packages/action-registry/src/base-assets.ts
packages/action-registry/test/reference-registry.test.ts
packages/reference-linter/package.json
packages/reference-linter/tsconfig.json
packages/reference-linter/LICENSE
packages/reference-linter/src/index.ts
packages/reference-linter/src/context.ts
packages/reference-linter/src/validation.ts
packages/reference-linter/src/rules.ts
packages/reference-linter/test/linter.test.ts
packages/reference-linter/test/validation.test.ts
apps/reference-dapp/src/domain/swap-authoring.ts
apps/reference-dapp/src/domain/swap-authoring.test.ts
apps/reference-dapp/src/domain/proposal.ts
apps/reference-dapp/src/domain/proposal.test.ts
apps/reference-dapp/src/components/review-panel.tsx
apps/reference-dapp/e2e/swap-authoring.spec.ts
apps/reference-dapp/e2e/swap-authoring.spec.ts-snapshots/proposal-chromium-linux.png
apps/reference-dapp/e2e/swap-authoring.spec.ts-snapshots/review-blocked-chromium-linux.png
apps/reference-dapp/e2e/visual-evidence/build-003a/build-before.png
apps/reference-dapp/e2e/visual-evidence/build-003a/build-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003a/simulate-before.png
apps/reference-dapp/e2e/visual-evidence/build-003a/simulate-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003a/execute-before.png
apps/reference-dapp/e2e/visual-evidence/build-003a/execute-diff.png
```

### Modify

```text
packages/action-registry/src/index.ts
apps/reference-dapp/package.json
apps/reference-dapp/src/app/page.tsx
apps/reference-dapp/src/app/layout.tsx
apps/reference-dapp/src/app/globals.css
apps/reference-dapp/src/config/product.ts
apps/reference-dapp/src/config/product.test.ts
apps/reference-dapp/src/domain/commands.ts
apps/reference-dapp/src/domain/commands.test.ts
apps/reference-dapp/src/domain/editor.ts
apps/reference-dapp/src/domain/editor.test.ts
apps/reference-dapp/src/domain/contracts.integration.test.ts
apps/reference-dapp/src/state/workflow-store.tsx
apps/reference-dapp/src/components/action-library.tsx
apps/reference-dapp/src/components/artifact-inspector.tsx
apps/reference-dapp/src/components/copilot-panel.tsx
apps/reference-dapp/src/components/workflow-canvas.tsx
apps/reference-dapp/src/components/app-shell.tsx
apps/reference-dapp/src/components/summary-bar.tsx
apps/reference-dapp/src/components/top-bar.tsx
apps/reference-dapp/e2e/interface-honesty.spec.ts
apps/reference-dapp/e2e/visual-shell.spec.ts
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/build-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/simulate-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/execute-chromium-linux.png
pnpm-lock.yaml
scripts/bootstrap-ci.py
.github/workflows/contracts.yml
.github/workflows/governance.yml
LICENSE
README.md
docs/AUTHORITY_MATRIX.md
docs/DECISIONS.md
docs/EVIDENCE_LEVELS.md
docs/LICENSE_MAP.md
docs/NEXT_BUILD.md
docs/REQUIREMENTS.md
docs/SCOPE_GUARD.md
docs/SECURITY_MODEL.md
docs/STATUS.md
```

### Do not touch

Every baseline path not in Modify is protected byte-for-byte and mode-for-mode.
The exhaustive protected baseline inventory is listed below.
All unlisted new paths are prohibited. In particular no new application route,
schema, compatibility fixture, dependency patch, upstream license copy, managed
service or executable adapter is included.

```text
.gitignore
.node-version
.npmrc
LICENSES/AGPL-3.0-only.txt
LICENSES/Apache-2.0.txt
NOTICE
THIRD_PARTY_NOTICES.md
TRADEMARKS.md
apps/reference-dapp/LICENSE
apps/reference-dapp/e2e/build-roundtrip.spec.ts
apps/reference-dapp/e2e/fixtures.ts
apps/reference-dapp/e2e/network-isolation.spec.ts
apps/reference-dapp/next-env.d.ts
apps/reference-dapp/next.config.ts
apps/reference-dapp/playwright.config.ts
apps/reference-dapp/src/components/status-badge.tsx
apps/reference-dapp/src/domain/initial-workflow.ts
apps/reference-dapp/src/domain/mock-actions.ts
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
packages/action-registry/src/capabilities.ts
packages/action-registry/src/schemas.ts
packages/action-registry/test/registry.test.ts
packages/action-registry/tsconfig.json
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

- **Misleading financial readiness:** static assets, declared Mode A and a valid
  amount could look executable. Always show unquoted/unavailable state and keep
  the execution boundary absent, even with forged positive minimums or findings.
- **Browser incompatibility:** existing contract root imports use Node builtins.
  Keep runtime hashing/raw parsing in Node tests and compiled registry delivery
  at the existing server-page boundary; test production browser bundling early.
- **Accidental governance regression:** separate historical revision checks from
  current approved-scope checks, with negative verification before acceptance.
- **Visual drift:** investigate unexpected differences; retain before images and
  only accept approved changes before updating zero-pixel baselines.
- **Unavailable provenance or cache evidence:** report precisely what is missing;
  do not substitute source values or claim browser integrity from a version string.
- **Rollback:** before delivery, revise the branch's scoped changes while
  preserving unrelated user work. After an authorized merge, use a reviewed
  revert restoring the baseline code, documentation and visual images together;
  no destructive reset or history rewrite. There is no financial state to undo.

## 13. Questions requiring human decision

O-1–O-14 are resolved by the attached owner decisions, with O-4 and O-7 supplied
explicitly in the follow-up reply. The concrete choices are recorded above:
existing-screen Option B; commit-pinned Optimism source; general Circle evidence;
exact identifiers; both directions; build-only caps and thresholds; immutable
typed registry; additive private exports; honest labels; temporary swap-edge
rejection; sequential decisions only after approval; value-aware evidence
rechecks; and linter exports `.` and `./package.json`.

At plan-writing time there was no remaining product-scope blocker.
Implementation tests, browser integrity revalidation, source rechecks and remote
CI were then future acceptance work; their actual outcomes belong in the
BUILD-003A report. The amendment-era CI initially forbade BUILD-003 files.
The approved implementation makes the historical/current transition in §3.7
while preserving the historical checks.

The required decision was supplied explicitly by the human owner on 2026-09-24
and recorded as DEC-0018. No future execution-enabled build is approved by it.
