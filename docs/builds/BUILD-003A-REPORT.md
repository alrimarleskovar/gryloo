# BUILD-003A — Implementation report

Status: **LOCAL_ACCEPTANCE_PASSED**. Branch:
`codex/build-003a-swap-authoring-lint`. Baseline:
`14a94584b0a3119c1f6275a05b9e752dafe0a042`. Implementation was explicitly
approved by the human owner on 2026-09-24 (DEC-0018) under the exact scope of
[the plan](BUILD-003A-PLAN.md). This report separates local observations from
remote CI and unavailable evidence.

## 1. Approved objective

Author isolated, exact-input USDC↔WETH swap intent on Base through the existing
Build chat and canvas, with deterministic review findings. No quote, protocol
adapter, wallet, signing, financial simulation or execution is included.

## 2. What was implemented

The existing single route `/` now offers both swap directions through an empty
amount/slippage form and the documented local chat grammar. Both surfaces use
one revisioned Semantic Workflow IR reducer. Changes are proposals with exact
diffs; dismissal, locks, stale revision rejection, no-op handling and removal
remain local and non-executing. The browser receives a validated, recursively
frozen registry context from the server page. The new private
`@defi-workflow-engine/reference-linter@0.1.0` validates unknown inputs with
closed schemas and bounded traversal, then emits deterministic, revision-linked
findings. Every swap has an unquoted/execution-unavailable BLOCK finding.

## 3. What was not implemented

There is no RPC, explorer call by the application, Uniswap SDK or adapter, live
quote, route, router address, calldata, wallet, approval, signature, transaction,
financial simulation, journal, backend, external model or connected swap graph.
Mode B and BUILD-003B/003C remain unapproved. ADR-0001 remains `PROPOSED`.
The UI and linter do not enforce financial limits outside this prototype client.

## 4. Changes by component

- Action Registry: additive `referenceRegistry` and `baseAssetRegistry` named
  exports; Base `eip155:8453`, USDC and WETH addresses, decimals and prototype
  caps; capability `swap.direct-transaction` is `DECLARED_ONLY` and
  `NOT_ENFORCED`.
- Reference linter: `lintWorkflow`, `validateAuthoringWorkflow` and
  `createReviewContext` root exports with exact `.` and `./package.json` export
  map, AGPL-3.0-only package license, Ajv 8.20.0 and workspace links.
- Reference app: local grammar, proposal/review UI, shared reducer, responsive
  form, inspector, isolated canvas card and unavailable execution states.
- CI/governance: historical BUILD-002 and amendment Git-tree checks retained;
  separate exact BUILD-003A scope, visual hashes, linter inventory and truthful
  SBOM workspace accounting added. Existing secret, license, patch, schema,
  dependency and network controls remain active.

## 5. Evidence and tests

### Local results

The pinned local toolchain was Node 24.21.0 and pnpm 11.22.0. The offline
`pnpm install --frozen-lockfile --ignore-scripts --offline` passed for five
workspace projects. `pnpm lint`, `pnpm typecheck`, `pnpm build`,
`pnpm schemas:check` and `pnpm test` passed during implementation; the final
unit/integration result was 108 tests across 15 files. Turbo discovered the new
linter in typecheck/build (seven typecheck tasks and four build packages). The
production Next build compiled and prerendered `/` without Node-only browser
imports. The final guarded Playwright run passed 13 tests, including actual chat/canvas
equivalence in both directions, mixed edits, stale/locked proposals, a
375/768/1280-pixel responsive check and all five zero-pixel snapshots.

The compiled linter declarations and root `lintWorkflow`,
`validateAuthoringWorkflow` and `createReviewContext` exports resolved with
Node. The unchanged schema exporter verified ten schema bytes. The dependency
verifier checked all 245 registry identities, integrities, licenses and release
ages, including exactly 16 reviewed exceptions, with evidence SHA-256
`20aca46436a4692cef9ec7c2c04f7a91f9e0bf2d9768f8ca11e21f5f4ba177ea`.
`pnpm audit --audit-level low` found no known vulnerabilities at the time of
verification. The lockfile's package/snapshot section matches the baseline
SHA-256 `7435de8d05c530d4660ed466a2992d63ae71788a1c39e327ebb4fe611d6ac9bf`.

The pinned pnpm CycloneDX 1.6 generator emitted 245 registry components and
zero workspace components. CI separately verifies the exact five workspace
manifests/importers and valid dependency references. The normalized temporary
SBOM SHA-256 was
`16ecdb9a0b467a80ff6b8c900fc50d1c77547a64d5126c40f008462a3de6e93c`;
that CI script removed its SBOM file. This is an omission in generator output,
not evidence that workspace packages appeared as SBOM components.

The two local governance blocks passed: exact historical BUILD-002 and amendment
Git trees, exact current BUILD-003A paths/modes/protected bytes, then 183 text
files scanned for basic secret indicators, 162 authored files for email, brand
and claim rules, 29 Markdown files for links, 23 protected digests, 18
sequential decision IDs and 60 requirement IDs. An isolated temporary checkout
passed unchanged, rejected nine deliberate negative cases (unauthorized path,
protected byte, malformed/duplicate/unregistered decision IDs, altered
historical baseline, wrong linter license/export and unexpected dependency),
then passed unchanged again. The main working tree was not mutated by these
negative tests.

### Remote CI

Not performed. The local implementation commit exists, but `git push -u origin
codex/build-003a-swap-authoring-lint` failed over the configured SSH remote with
`Permission denied (publickey)` and `ssh_askpass: exec(/usr/bin/ssh-askpass): No
such file or directory`. No remote branch or PR was created by this attempt, so
there is no remote GitHub Actions result to inspect. A local pass is not a claim
about remote CI.

### Checks not performed or limited

No on-chain contract call, deployed bytecode comparison or live token storage
check was performed. Asset metadata remains `NOT_ONCHAIN_VERIFIED`. There is no
financial simulation or outcome evidence. The dependency audit is a point-in-time
registry result, not a guarantee against future advisories. The browser archive
integrity is a locally observed, human-approved digest, not a publisher-issued
signature.

## 6. Acceptance criteria

Local authoring, immutable registry, input validation, deterministic review,
semantic equivalence, non-executing interface, visual regression, package
participation, dependency, governance negative and full regression gates passed.
Remote CI could not be inspected because SSH authentication blocked the push.
No P6–P14 or complete Build 003 certification is claimed.

## 7. Security

The new authoring path validates untrusted objects and commands before arithmetic
or mutation, bounds text and object depth/size, rejects unknown runtime fields,
forged metadata, invalid graph links and unsafe decimal amounts, and checks
trusted per-asset caps. Zero output is an unquoted placeholder. Review findings
are advisory and cannot authorize execution. The browser suite retains a
loopback-only request guard with a synthetic negative proof; service workers and
browser downloads remain blocked. No secret, wallet or fund-handling path exists.

## 8. Licenses

The added declarative Registry files are original Apache-2.0 material. The
reference linter and app files are AGPL-3.0-only; the linter LICENSE is an exact
copy of `LICENSES/AGPL-3.0-only.txt`. Existing official legal texts, 21 upstream
legal copies and two declaration-only patches remain protected. No package is
published, no dependency is relicensed, and no new external resolution is added.

## 9. Source provenance and browser integrity

At 2026-09-23 23:51:32 UTC, static first-party source bytes were retrieved and
values rechecked. This is source documentation evidence only; no RPC, wallet or
explorer contract call was used.

| Source and classification | Observed SHA-256 | Value check |
|---|---|---|
| [Base connection Markdown](https://docs.base.org/get-started/connect-to-base.md), network documentation | `cda7b0c411633a7b0b114f69425d90fdc6cff6a6d2a2a744af45698d80a49abb` | Base mainnet chain ID `8453` unchanged |
| [Base contracts Markdown](https://docs.base.org/specifications/reference/base-contracts.md), deployment-address documentation | `b082dfce170ba19675fff00387c24171f0d16a818fa6cb0c8c00f2f512a0214f` | Base Mainnet WETH9 `0x4200000000000000000000000000000000000006` unchanged; page bytes differ from the plan's observed digest `3fcc1679b649edd56fb8fac98278d5414a66f6206176158b01d1b234692f5282` |
| [Circle USDC directory](https://developers.circle.com/stablecoins/usdc-contract-addresses.md), issuer address documentation | `15a692cfa55bba37f19e2470f4d759fe2b24ebd690669341d89e9894c1b3a3c2` | Base USDC address unchanged |
| [Circle pinned general USDC document](https://raw.githubusercontent.com/circlefin/skills/58ab8648bb1ae9d037a3bf5197ad3bb01262f5b1/plugins/circle/skills/use-usdc/SKILL.md), general metadata guidance | `234b616ac688a71a464757c9f77af2973d029ce9c30b49bcf12d87a38d6c7b42` | Six-decimal general USDC metadata; not Base on-chain proof |
| [Optimism pinned WETH98 source](https://raw.githubusercontent.com/ethereum-optimism/optimism/0f476b44a3a284855361685b97baeb4bfb26729b/packages/contracts-bedrock/src/universal/WETH98.sol), source code | `e6bd6c08c89b5bdd62e17e16c8c3ae1d12b550a376a4710888b9e68c95e62d30` | WETH symbol and 18 decimals; not deployed Base bytecode proof |

The approved Linux x64 headless shell revision 1243 was downloaded afresh to a
new temporary cache. The unchanged bootstrap verified 119,809,080 archive bytes,
SHA-256 `a9da028861a0cf789ff25c2fed45f5f1aaf969ed9247835b6a7821a4f7af9d1d`,
287 archive entries, the single approved redirect and executable version
153.0.8010.12. Classification remains `LOCALLY_OBSERVED_HUMAN_APPROVED`.

## 10. Visual evidence

An isolated detached checkout of exact baseline `14a94584...` passed all three
original visual tests at zero pixels with the verified browser, 1440×900,
en-US, light and reduced motion. Its baseline images are retained as the three
`*-before.png` files. The three new after images were inspected against the
plan's visible-change table before replacing the baseline files. The retained
diffs use strict RGB equality; Playwright uses its own comparator, so its
reported changed-pixel counts differ. Subsequent zero-pixel Playwright checks
passed. The two new proposal and blocked-review snapshots were inspected and
passed zero-pixel reruns.

| State | Before SHA-256 | After SHA-256 | Diff SHA-256 | Strict RGB changed pixels |
|---|---|---|---|---:|
| Build | `fd4de5d84235195275014aae5098a5921f62aabb2839d6f1594b13a04cadbbe3` | `96c85d8e90d5d7d4316814a71ce39db2364d598d63060f17ce8e8c9dab7a05d5` | `d00a8f71341dfbf317b46c3dcb63adb9022c82e99c5c895aca5c9f9b67b2cc67` | 104596 |
| Simulate | `0e584bbb8974f692ca729599f0e0f58e4b640b5c35f71e153a9571424ba71efb` | `71e8e6a6a22e48f99be3a1b21ef970bc6a7af340d7eb4c3c1511c7cb32ba6dd1` | `403a85b1918c7a9f1e30cb5acf8b56603b27b78234d28d14ea202d0aa091c7f9` | 20427 |
| Execute | `dd4431f3088baae3a089fb064fe555853b0a7d77fdb236b1ccf8b6a59817fa5b` | `210de9abc83fb0863073a0326f4ff8a8fcd7733795bf195c190b1f3830322e2c` | `6d17b728f01cc7b3ec8919ddfc3a0d95eb05cd0377b7697b98ec86409de46a83` | 20436 |

The new proposal snapshot SHA-256 is
`28135facd0c1647e4a51fc65851d56afb468caf1b28d54ccf578eee8df26d466`;
the selected blocked-review snapshot is
`8007847673d2e2eb3f9a43a2518db469023c61b2c21921a735ca99d2f35a7164`.
The reviewed changes are the approved title/copy, Base form, proposal and review
states, mock/swap distinctions, and unavailable-stage wording. A clipped swap
card and hidden proposal controls were found in the first new snapshots and fixed
before these final snapshots were accepted.

## 11. Demonstrable state

Current application evidence labels are `MOCKED`, `NONE`, `NOT_ENFORCED` and
`NOT_APPLICABLE`. Both directions can be authored locally with explicit amount
and slippage, but neither can be quoted, simulated, signed or executed. The
linter's BLOCK findings are review only and do not certify a Uniswap primitive.

## 12. Technical debt and limits

The existing mock CONNECT representation is not a typed financial resource flow;
its whole-workflow contract failures are reported rather than silently rewritten.
Swap connections are intentionally rejected in this build. Asset caps and
slippage thresholds are BUILD-003A prototype authoring rules and require a
separate decision before any execution-enabled design. The client is not an
independent enforcement boundary.

## 13. Later options — NOT APPROVED

BUILD-003B/003C, live protocol integration, Mode B and any financial execution
require a separate plan and decision. No work on them was begun here.

## 14. Delivery and human decision

DEC-0018 authorized the named implementation commit, SSH push and PR into
`main`; it did not authorize merging. The local implementation commit is
`07de8f4` (`Implement Build 003A swap authoring and deterministic lint`). The
configured `origin` uses GitHub SSH transport. The SSH push failed with `Permission denied (publickey)`; transport and authentication
settings were left unchanged. The local branch and commit are retained. After
SSH access is restored, the manual command is
`git push -u origin codex/build-003a-swap-authoring-lint`. The PR into `main`
and remote CI remain unperformed. No merge was attempted.
