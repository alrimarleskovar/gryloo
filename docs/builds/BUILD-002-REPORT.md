# BUILD-002 — Report

Status: **LOCAL_ACCEPTANCE_PASSED**. Validation date: 2026-09-23.
Branch: `codex/build-002-visual-shell`. Baseline:
`fb285da4ea4efaaae5b839974b669b3c8335ddd7`.

The approved private Gryloo reference shell uses one shared revisioned
Semantic Workflow IR across local mock chat, action library and React Flow
canvas. Build interactions are functional. Simulate and Execute remain
unavailable shells. Authorization mode is `NONE`, enforcement
`NOT_ENFORCED`, UI behavior `MOCKED` and financial outcome
`NOT_APPLICABLE`. No wallet, transaction, signing, financial execution,
Mode B or BUILD-003 was implemented.

## Scope and later exact license approval

The owner approved the consolidated BUILD-002 plan, exact two-declaration
XYFlow compatibility patch, named ReactFlow import correction and upstream
MIT notice. The owner then reviewed the complete 245-package diagnostic
inventory below and explicitly approved the **exact 16 identities** by name,
version, SPDX expression, registry SRI, dependency route and platform/optional
classification. This superseded the earlier conditional ten-libvips-only
boundary. No general LGPL, compound SPDX, CC-BY-4.0 or 0BSD allowlist was
introduced.

`scripts/bootstrap-ci.py --verify-dependencies` now scans every locked
registry package without short-circuiting; it requires 245 package and
snapshot entries, all approved direct pins, exact rejected set, matching
registry integrity, seven-day release age, full license expression and
reviewed path/platform data. Its full run passed with zero unreviewed
packages. The dependency evidence SHA-256 was
`20aca46436a4692cef9ec7c2c04f7a91f9e0bf2d9768f8ca11e21f5f4ba177ea`.

## Complete non-short-circuit license-policy inventory


The diagnostic reader applied the **existing** allowlist and exact BUILD-001
tooling exceptions to all 245 package blocks in the current `pnpm-lock.yaml`.
It fetched all 245 registry version manifests without stopping at the first
rejection, compared every registry SRI with the lockfile, then downloaded each
of the 16 rejected archives and recomputed its SHA-512 SRI. All metadata and
archive checks completed without discrepancy. The 16 rejections below are the
complete observed set under the original policy. The owner subsequently approved the exact 16
observed identities; the updated full verifier passed without another rejection.

Every path in the table begins with the application's direct dependency
`apps/reference-dapp → next@16.3.5`. “sharp” is the pinned optional
`sharp@0.35.4` dependency of Next. “freebsd-wasm32” is
`@img/sharp-freebsd-wasm32@0.35.4`, also optional. The WASM package also has an
alternate optional path through `@img/sharp-webcontainers-wasm32@0.35.4`.
“Selected” means present in the current Linux x64 glibc installation.
`@img/sharp-wasm32` has no declared OS, CPU or libc restriction but is not
selected because its optional platform parents are absent.

| Exact package | SPDX license expression | Registry SRI (SHA-512) | Dependency path after direct Next | Optional | Declared OS / CPU / libc | Selected |
|---|---|---|---|---|---|---|
| `@img/sharp-libvips-darwin-arm64@1.3.3` | `LGPL-3.0-or-later` | `sha512-suTBPTDGrI9WodccaDdwZItTSaBYASlBk1NSfElSHrUfzu3szG6lvIF58+WiFvnfzuK8ZBFS5zE00PxqxnRiPg==` | `sharp -> @img/sharp-libvips-darwin-arm64@1.3.3` | yes | darwin / arm64 / none | no |
| `@img/sharp-libvips-darwin-x64@1.3.3` | `LGPL-3.0-or-later` | `sha512-FVJZ5mITMobmXIz/hPDTw0EintTW5H3WfrxwLqEqjiIihlu+hVRyGrFQ60xl0Lxn7Bt3zdpevPaQi0HEzqz9fw==` | `sharp -> @img/sharp-libvips-darwin-x64@1.3.3` | yes | darwin / x64 / none | no |
| `@img/sharp-libvips-linux-arm64@1.3.3` | `LGPL-3.0-or-later` | `sha512-0DaL0A6Xu6sQSQFwe4iVCrKWU2cCTItnRsYsCdxAMm9NF6twAA9BKnoqy4hqz4+azQ0JHuA26qiUKsf1XJ/v5A==` | `sharp -> @img/sharp-libvips-linux-arm64@1.3.3` | yes | linux / arm64 / glibc | no |
| `@img/sharp-libvips-linux-arm@1.3.3` | `LGPL-3.0-or-later` | `sha512-3rbU4vqXXc3hY/OiXdl52xZvT0F1yEngWfvqudtPJg/KkyiaQw2DRsFrNzpmLvfavbwOq3qXn36GP8obHRULQA==` | `sharp -> @img/sharp-libvips-linux-arm@1.3.3` | yes | linux / arm / glibc | no |
| `@img/sharp-libvips-linux-ppc64@1.3.3` | `LGPL-3.0-or-later` | `sha512-cdn1OvUBwsXhbC0zSzJnNzf5MZ/mTrobawDvNXBTxe8VtqKAm0sRuEY2Evzovb/w9JMk4TvRxqt1mekSuJz64w==` | `sharp -> @img/sharp-libvips-linux-ppc64@1.3.3` | yes | linux / ppc64 / glibc | no |
| `@img/sharp-libvips-linux-riscv64@1.3.3` | `LGPL-3.0-or-later` | `sha512-HjPVx7yKz+0lqdhDlTw1tt90wamBoxhiXpvl1XZpJLiHH4RCJ5yDTqH+VlYPv2fwFs89JFw4c1IexYOcQUi4IQ==` | `sharp -> @img/sharp-libvips-linux-riscv64@1.3.3` | yes | linux / riscv64 / glibc | no |
| `@img/sharp-libvips-linux-s390x@1.3.3` | `LGPL-3.0-or-later` | `sha512-neWLh+3yCNThxnfy3c4BbVBeGgt9aftno+XbT56iK28RgeDs3UOFWviLWlUu0bArYVYJaFDK+RRohbicUNCm8Q==` | `sharp -> @img/sharp-libvips-linux-s390x@1.3.3` | yes | linux / s390x / glibc | no |
| `@img/sharp-libvips-linux-x64@1.3.3` | `LGPL-3.0-or-later` | `sha512-4vKmvAst9nrowcqquKFAyZJUDolUaIp8uRiN0mWFguJ1IplC9/pitXtlnnlU4aa/eJw3J7i67V+pwUL+wZGdsA==` | `sharp -> @img/sharp-libvips-linux-x64@1.3.3` | yes | linux / x64 / glibc | yes |
| `@img/sharp-libvips-linuxmusl-arm64@1.3.3` | `LGPL-3.0-or-later` | `sha512-Y9kQaLMuNoB0bPYOOdcZMaseNrFpPodIWWMrx+CZyydf2xn68j9WYc6sWWRrDwNkzCQjKYfc68L7jKjGlHMibw==` | `sharp -> @img/sharp-libvips-linuxmusl-arm64@1.3.3` | yes | linux / arm64 / musl | no |
| `@img/sharp-libvips-linuxmusl-x64@1.3.3` | `LGPL-3.0-or-later` | `sha512-fj8Mv0HHfD1Rr+4I68+3agJynxDWtBFgicTbSOb9Bke6pIwzGcJ+RX/yHjmiEGFMCavY/dxvem7MyNaJF+wDiw==` | `sharp -> @img/sharp-libvips-linuxmusl-x64@1.3.3` | yes | linux / x64 / musl | no |
| `@img/sharp-wasm32@0.35.4` | `Apache-2.0 AND LGPL-3.0-or-later AND MIT` | `sha512-zQnl4Kwp7Q6NHsENtU2T/00Zi+w3AQNwz3+UaTyVBy2FpXrzXzGjndpK61onhZjRtRpQXxCTeqw19bVyXOh7jA==` | `sharp -> freebsd-wasm32 -> @img/sharp-wasm32@0.35.4` | yes | none / none / none | no |
| `@img/sharp-win32-arm64@0.35.4` | `Apache-2.0 AND LGPL-3.0-or-later` | `sha512-iNdlBX9gLVvqe2I3uIJSIKTq6wckP/DYxZtcqxm09x5Gi24DnFBmPAWZmr60ZyYMG0xlzo6goG3670ar+RXvRw==` | `sharp -> @img/sharp-win32-arm64@0.35.4` | yes | win32 / arm64 / none | no |
| `@img/sharp-win32-ia32@0.35.4` | `Apache-2.0 AND LGPL-3.0-or-later` | `sha512-kqRsbaa5CS6KHlpxnN7WhE6vAAugXyZButpRdvDWetlv6Qv4N9WTcrWzF7tXfB9T7MsoadqdI8hmwLq6UlLvtw==` | `sharp -> @img/sharp-win32-ia32@0.35.4` | yes | win32 / ia32 / none | no |
| `@img/sharp-win32-x64@0.35.4` | `Apache-2.0 AND LGPL-3.0-or-later` | `sha512-XtmnYhBcrORsJ4XJngyzr/EWP0hRZLAZRFaApdKuviyqF78+ylxh2y06ZmtULAMOnObJ3ucpN0AcwSWnMowTRg==` | `sharp -> @img/sharp-win32-x64@0.35.4` | yes | win32 / x64 / none | no |
| `caniuse-lite@1.0.30001810` | `CC-BY-4.0` | `sha512-TITQPUkaz+aVk5GL6NhOdwk1aEaNTSDPsGFWrTuhKGtjTF70jL/Oht2W4c6rXUe5fu7Ie19VIahAXHIIiWWNeg==` | `caniuse-lite@1.0.30001810` | no | none / none / none | yes |
| `tslib@2.8.1` | `0BSD` | `sha512-oJFu94HQb+KVduSUQL7wnpmqnfmLsOA/nAh6b6EH0wCEoK0/mPeXU6c3wKDV83MkOuHPRHtSXKKU99IBazS/2w==` | `@swc/helpers@0.5.23 -> tslib@2.8.1` | no | none / none / none | yes |

All 16 archives are unmodified registry material: their tarball bytes matched
the registry/lock SRI, no patch targets them, and the repository tracks or
vendors none of their source or binary files. For the three rejected packages
installed in this environment (`@img/sharp-libvips-linux-x64`, `caniuse-lite`,
and `tslib`), every installed package file also matched its verified archive
member byte-for-byte. None of these library bytes is committed by Gryloo.
The other rejected platform packages are absent from this installation.

The ten `@img/sharp-libvips-*` archives each contain a platform-specific
shared library (`.so` or `.dylib`) and a `README.md` licensing section. None
contains a file named LICENSE, LICENCE, COPYING, NOTICE or
third-party-notice. The verified README digests below identify the licensing
text actually present; no license text was reconstructed. All ten complete supplied READMEs were
preserved byte-for-byte in the third-party license directory.
The three Windows sharp packages include DLLs and their own LICENSE file.
The remaining packages have the exact notice files listed below.

| Exact package | Relevant file or verified absence | SHA-256 |
|---|---|---|
| `@img/sharp-libvips-darwin-arm64@1.3.3` | No named license/notice file; `README.md` licensing section | `47083f1ae7e990f74a56f576bcb8434051cb84ed1982fa57932720869e5147fe` |
| `@img/sharp-libvips-darwin-x64@1.3.3` | No named license/notice file; `README.md` licensing section | `bbb84e1fa86b44508e893afe1a84a640cd452c0e671f001256959352bfacb7e5` |
| `@img/sharp-libvips-linux-arm64@1.3.3` | No named license/notice file; `README.md` licensing section | `b05efaa208519f349746a54ee195c433ab8e5c250847a257c984c7a9dc68df20` |
| `@img/sharp-libvips-linux-arm@1.3.3` | No named license/notice file; `README.md` licensing section | `8562d3e04aa8abf13264a8a27152cc5e9da7269984961871008cab475e0f2e63` |
| `@img/sharp-libvips-linux-ppc64@1.3.3` | No named license/notice file; `README.md` licensing section | `6cf3175d5bf6b5335de0b062b1c000809c273a88e093e8c3a41d690b4a0f639e` |
| `@img/sharp-libvips-linux-riscv64@1.3.3` | No named license/notice file; `README.md` licensing section | `913086c8cc5ff42f3394bdc8b45fb574ce75c3fb8cb8f4e5817338f751935b92` |
| `@img/sharp-libvips-linux-s390x@1.3.3` | No named license/notice file; `README.md` licensing section | `978760ba002481940b97aeb87450c96cbb985d3607dbc30a4b3ad5cf0e1c484e` |
| `@img/sharp-libvips-linux-x64@1.3.3` | No named license/notice file; `README.md` licensing section | `4f87b4934d26d52ed65a42e96bfe88e75ac98dbd3bc302b50fe6c07d22e42630` |
| `@img/sharp-libvips-linuxmusl-arm64@1.3.3` | No named license/notice file; `README.md` licensing section | `1a42557691426812906e98442b6575bd3fd509a3a0ea53d28e9ce52c2ccbb243` |
| `@img/sharp-libvips-linuxmusl-x64@1.3.3` | No named license/notice file; `README.md` licensing section | `2948195d2a4f5bb3c9cdc22ac4184e38b63c8319c2753d454571cf7b31482b17` |
| `@img/sharp-wasm32@0.35.4` | `LICENSE` | `73ba74dfaa520b49a401b5d21459a8523a146f3b7518a833eea5efa85130bf68` |
| `@img/sharp-win32-arm64@0.35.4` | `LICENSE` | `dc1f5d2d43c5531dfe0acaf4e950ea5dbe3e61e1850cf0e983bda7efc10d6693` |
| `@img/sharp-win32-ia32@0.35.4` | `LICENSE` | `dc1f5d2d43c5531dfe0acaf4e950ea5dbe3e61e1850cf0e983bda7efc10d6693` |
| `@img/sharp-win32-x64@0.35.4` | `LICENSE` | `dc1f5d2d43c5531dfe0acaf4e950ea5dbe3e61e1850cf0e983bda7efc10d6693` |
| `caniuse-lite@1.0.30001810` | `LICENSE` | `fd3a263fe19ed8faa9068b43abaebafc02c77897b0c6fc09abc04bb592e5f16e` |
| `tslib@2.8.1` | `CopyrightNotice.txt` | `da16ddb65f8ca390998fb99223d0112498b56b45784d00afd77ff8ce1ac4de8b` |
| `tslib@2.8.1` | `LICENSE.txt` | `210b19e543130388c68654b7497e967119ce17145f66ab7d85688fbd70f08751` |

## Preserved upstream legal and attribution evidence

The 16 archive SRIs were independently recomputed and matched the registry
and lockfile. Every installed file of the three selected packages matched
its verified archive member byte-for-byte. The rejected set is ten
libvips platform packages at 1.3.3, four Sharp WASM/Windows packages at
0.35.4, `caniuse-lite@1.0.30001810` and `tslib@2.8.1`. The
Sharp/libvips packages are optional platform libraries, including inactive
targets, and remain in both dependency evidence and the SBOM. None of their
source or binary files is committed or vendored as Gryloo-authored code.

The verified archives supplied 21 relevant legal/README file mappings,
preserved in 19 distinct byte-identical files under `third_party/licenses/`.
Three Windows Sharp LICENSE members were proved byte-identical and map to
one copy. The exact package, archive filename, original internal path,
SPDX expression and each preserved SHA-256 are listed in
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
The ten libvips archives contain complete README licensing tables but no
separately named LICENSE, COPYING, NOTICE or third-party-notice file.
The WASM/Windows Sharp packages retain their compound `AND` expressions
and supplied license/README materials; `caniuse-lite` remains CC-BY-4.0
with attribution and `tslib` remains 0BSD with its exact upstream notice.

Gryloo-authored application code remains AGPL-3.0-only. The review is
dependency-governance evidence, not universal legal certification. Any
future distributable artifact, container, desktop package or deployment
bundle conveying a Sharp/libvips binary requires a separate release-compliance
gate before publication, covering all applicable notices,
corresponding-source availability and user replacement/relink rights.

## Local acceptance evidence

| Gate | Observed result |
|---|---|
| Original baseline and branch | Clean main baseline `fb285da4ea4efaaae5b839974b669b3c8335ddd7`; BUILD-002 branch retained. |
| Toolchain and strict settings | Exact verified Node 24.21.0 and pnpm 11.22.0; strict app typecheck, `skipLibCheck: false` and exact optional types retained. |
| Patch and notices | Exact XYFlow patch and upstream MIT digests below; application LICENSE byte-identical to official AGPL text. |
| Complete dependency verifier | 245 packages and snapshots, 16 exact reviewed exceptions, zero other violations; full registry integrity, SPDX and release-age checks passed. |
| Frozen installation | `pnpm install --frozen-lockfile --ignore-scripts` passed with verified toolchain and browser-download/telemetry controls. |
| Complete regression | `pnpm check` passed: 5/5 typecheck tasks, lint without diagnostics, 3/3 builds, ten schema exports and 89/89 tests across ten files. |
| Production build | Next.js 16.3.5 generated three static pages with telemetry and browser downloads disabled. |
| Browser interaction and accessibility | Five guarded production-browser tests passed for round-trip state, honest unavailable stages, semantics, keyboard interactions and layout. |
| Network isolation | Ordinary tests allowed only loopback; the dedicated synthetic negative attempt was recorded, aborted before egress and made the clean assertion fail as expected. |
| Visual baselines | Three approved screenshots were generated previously; all three comparisons passed with updates disabled and zero differing pixels. Browser source/configuration was not changed by the license/governance update. |
| Vulnerability audit | `pnpm audit --audit-level low`: no known vulnerabilities found at verification time. |
| Ephemeral SBOM | CycloneDX 1.6 lockfile-only output: 245 exact components; all 16 exceptions retain actual license expressions, including inactive platforms. Enriched SBOM SHA-256 `94c65c5e5e9300c0ca60b6067b5fe9ce6436e7594320746aed6ff5abf561380f`; temporary file removed. |
| Workflow and governance | Both workflow YAML files parsed; local exact-scope, protected-baseline, licensing and notice-hash job passed. |
| BUILD-001 historical CI | [Governance](https://github.com/alrimarleskovar/gryloo/actions/runs/35848167604) and [Build 001 contracts](https://github.com/alrimarleskovar/gryloo/actions/runs/35848167502) passed previously; no BUILD-002 remote CI result is claimed. |

Final exact-scope comparison found 60 created paths and 18 modified
baseline paths, all within the approved inventory. Protected baseline bytes
were unchanged. Gryloo-authored staged files passed Git whitespace checks.
A full staged whitespace check reports upstream trailing spaces and CRLF in
some byte-identical legal/README copies; those upstream bytes were deliberately
preserved, and every such file is checked by its reviewed SHA-256. The full
legal material was not normalized or edited. Temporary Playwright output was
removed, and no SBOM was retained. Repository Markdown links and Python
syntax passed local checks.

The updated contracts workflow performs the frozen install, full 245-package
verifier, aggregate regression, vulnerability audit, approved guarded browser
suite and temporary SBOM validation. The governance workflow checks the exact
BUILD-002 create/modify scope against the protected baseline, AGPL application
license, patch and legal copy hashes, attribution map and no remote
application source URL. No external GitHub Action is used.

## Browser, telemetry and network evidence


```text
Playwright: 1.63.0
Revision: 1243
Browser: Google Chrome for Testing 153.0.8010.12
Platform: Linux x64
Archive: chrome-headless-shell-linux64.zip
Bytes: 119809080
SHA-256: a9da028861a0cf789ff25c2fed45f5f1aaf969ed9247835b6a7821a4f7af9d1d
Entries: 287
Classification: LOCALLY_OBSERVED_HUMAN_APPROVED
```

Requested source:
`https://cdn.playwright.dev/builds/cft/153.0.8010.12/linux64/chrome-headless-shell-linux64.zip`

The single approved HTTP 307 redirect terminated at:
`https://storage.googleapis.com/chrome-for-testing-public/153.0.8010.12/linux64/chrome-headless-shell-linux64.zip`

The prior bootstrap verified redirect, size, digest, archive structure, safe
extraction and executable version, then removed the ZIP and staging data. Its
validated browser cache is outside the repository and was reused successfully
for the resumed production-browser comparison. No Playwright installer, full
Chromium, FFmpeg, other browser, OS package installation, video or trace was
invoked. The digest is locally observed and human approved for BUILD-002 only;
it is not a publisher-issued checksum or independent provenance proof.

`NEXT_TELEMETRY_DISABLED=1` and `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` were set for
the recovered successful unit/build/E2E commands and the resumed browser, lint
and dependency commands. The production server's package script and Playwright
webServer environment explicitly retain both controls. Skill telemetry was not
invoked during resumption.

The shared fixture installs HTTP and WebSocket routes before creating a page,
allows only origin `http://127.0.0.1:3000`, blocks service workers, records and
aborts disallowed requests, and requires ordinary tests to have zero unexpected
attempts. The sole negative test requires exactly its synthetic URL and proves
the clean assertion throws. Ordinary suites do not acknowledge unexpected
requests. The final governance source scan passed.

## Exact compatibility evidence


The existing type-only Next block supplies `URLPatternInput` and
`URLPatternOptions` in `apps/reference-dapp/next.config.ts`. It installs no
runtime polyfill and requires re-review when Next, TypeScript or Node types
change. The named ReactFlow import is the published component export.

The actual pnpm 11.22.0 generated patch is preserved without normalizing its
hunk-header context. It touches only `dist/esm/types/nodes.d.ts` and
`dist/umd/types/nodes.d.ts` in `@xyflow/system@0.0.82`, adding the approved
`Omit<NodeBase, 'measured'>` intersection to `InternalNodeBase`. No runtime
JavaScript or package metadata is changed. Workspace/lock registration uses
the actual patch digest; all versions and strict compiler settings remain pinned.

```text
Predicted textual patch SHA-256 — SUPERSEDED, revoked, never committed:
94d05d099013e0ca15f4cf4df1d0f82370762dc6ca62b46f3956411bae7be45c
Approved pnpm-generated patch SHA-256:
4420c4eab49ef56325c7cb81898894b1c9f08fe39621216e8cf77532ce98f6d5
Original @xyflow/system@0.0.82 registry SRI:
sha512-4DKnL3CGtCGLRSmgDqaajRVgeksMXq/Yw4wPfdMfm7JvdIiWHGzVYOfFUztiATwdBXZqUU6HhehwUdbV9G23PQ==
XYFlow upstream MIT notice SHA-256 — complete recovered and recomputed digest:
023119ac20fb1c8c9930abe0bcd196989a1960388529a96fc43cebf96f07c9ff
Node archive SHA-256:
fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6
pnpm archive SRI:
sha512-H/hwxMYTPf2I+yr8Rt0T1H8JyXlLQ4xv20fKmMrzvBY4HuC+k6CRuOOCTPAfiJ9G19niCRD7C+GrD7W6qA3WIQ==
BUILD-001-REPORT.md protected SHA-256:
2ec375e280a98110e34a63ff60a10c43073ca99a8372777fddba2d0d5e552fa4
ADR-0001 protected SHA-256:
a7e516263a51d9e71120e7eef164afd2655950d0ed902349a7cddc4cccbb8396
AGPL-3.0-only text and app LICENSE SHA-256:
0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0
```

The XYFlow patch remains a third-party MIT declaration patch, and
`third_party/licenses/xyflow-system-MIT.txt` is the byte-identical upstream notice;
neither is Gryloo-authored Apache-2.0 material. The Next block and original app
code/tests remain within the private AGPL-3.0-only app boundary. The license map, plan amendment and governance workflow are updated.

## Final boundary

The final scope, protected-byte, authored-file whitespace and temporary-output
checks passed before the local commit. A local commit,
push attempt and pull request are delivery actions after local acceptance;
this report does not claim BUILD-002 remote CI or a merge. The previously
observed SSH transport returned `Permission denied (publickey)`; a later
push attempt must report its actual result without substituting another
transport.
