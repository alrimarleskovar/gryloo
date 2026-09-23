# BUILD-002 — Gryloo visual shell and shared state

Status: **APPROVED** by the human owner on 2026-09-23 for BUILD-002 only.
This records the supplied final consolidated plan. Its prior proposed wording
and approval gate are superseded by the explicit implementation approval below.
The supplied preflight observations are historical evidence, not a claim that
this implementation has already rerun the browser or passed its gates.

## Implementation authorization

Start from clean, synchronized main at
`fb285da4ea4efaaae5b839974b669b3c8335ddd7`. Use only branch
`codex/build-002-visual-shell`. The exact create/modify scope below is approved;
every other tracked baseline file is protected. In particular preserve all
BUILD-000/BUILD-001 plans and reports, packages, schemas, exports, fixtures,
hashes, compatibility evidence, ADRs, source specifications, assets and legal
texts. ADR-0001 remains PROPOSED and byte-identical.

The private AGPL-3.0-only reference application, shared immutable reducer,
deterministic mocked chat, React Flow canvas, unavailable Simulate/Execute
shells, and current governance updates are approved. No wallet, backend,
financial execution, Mode B or BUILD-003 implementation is authorized.
Only the exact dependency versions below may be used.

The browser identity, bootstrap, telemetry, network isolation, licensing,
governance, CI, validation, ephemeral SBOM and stop conditions below are
approved. The human explicitly accepts the limited initial-acquisition
authenticity gap for this exact BUILD-002 archive only. Its classification is
LOCALLY_OBSERVED_HUMAN_APPROVED, never publisher-issued authentication.

Run complete BUILD-001 and BUILD-002 validation, including unit, integration,
contract, E2E, accessibility, visual, governance, workflow syntax, whitespace,
dependency integrity, audit, license, ephemeral SBOM, telemetry, network
isolation, exact changed-file scope and protected bytes. Remove the approved
ephemeral SBOM after validation. Report only demonstrated evidence in
BUILD-002-REPORT.md. Stop immediately on a stated stop condition or required
scope deviation.

Only after every local gate passes, create one commit and attempt a push and
pull request, both titled:
`Implement Build 002 Gryloo visual shell and shared state`.
If SSH authentication is unavailable, stop after the clean local commit and
provide the exact manual push command. Do not merge or begin another build.

## Approved network-test clarification

Every external request originating from application code is prohibited and
must fail the relevant test even when intercepted. The dedicated negative
guard self-test may create exactly one deliberate synthetic external-request
attempt solely to prove the guard records, aborts and reports it. Interception
must happen before egress; the request must never reach its destination.
This is the sole exception to the zero-attempt assertion and exists only
inside that negative self-test. Ordinary application and E2E tests cannot
suppress, acknowledge or permit unexpected requests.

## Supplied consolidated plan and preflight

## Two-download evidence

| Requested sourceRedirect chainFinal URLBytesSHA-256 |                                                                |                                                                                                                    |             |                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------ |
| Playwright CDN                                      | HTTP 307 from `cdn.playwright.dev` to `storage.googleapis.com` | `https://storage.googleapis.com/chrome-for-testing-public/153.0.8010.12/linux64/chrome-headless-shell-linux64.zip` | 119,809,080 | `a9da028861a0cf789ff25c2fed45f5f1aaf969ed9247835b6a7821a4f7af9d1d` |
| Chrome for Testing storage                          | No redirect                                                    | `https://storage.googleapis.com/chrome-for-testing-public/153.0.8010.12/linux64/chrome-headless-shell-linux64.zip` | 119,809,080 | `a9da028861a0cf789ff25c2fed45f5f1aaf969ed9247835b6a7821a4f7af9d1d` |

Exact requested URLs:

```
https://cdn.playwright.dev/builds/cft/153.0.8010.12/linux64/chrome-headless-shell-linux64.zip

https://storage.googleapis.com/chrome-for-testing-public/153.0.8010.12/linux64/chrome-headless-shell-linux64.zip
```

The files were compared byte for byte and were identical.

The response metadata also agreed:

```
Content-Length: 119809080
Last-Modified: Tue, 25 Aug 2026 22:30:09 GMT
ETag: "9a8eb6135b1cda56de8f547776291e35"
x-goog-hash: md5=mo62E1sc2lbej1R3dikeNQ==
```

The MD5 and ETag are informational storage metadata. They are not being treated as independent authenticity evidence.

Google’s [exact Chrome for Testing manifest](https://googlechromelabs.github.io/chrome-for-testing/153.0.8010.12.json) identifies:

- browser version `153.0.8010.12`;
- Chromium source revision `1681091`;
- the same Linux x64 headless-shell storage URL.

The SRI-verified `playwright-core@1.63.0` package identifies:

- Playwright browser revision `1243`;
- browser version `153.0.8010.12`;
- archive `chrome-headless-shell-linux64.zip`;
- archive root `chrome-headless-shell-linux64`;
- executable `chrome-headless-shell-linux64/chrome-headless-shell`.

The package’s registry SRI was independently recomputed and matched:

```
sha512-rYCsBF/M5HjUch52bbtVONEFjv6Xu8sm8h72dNlR5bzIE1fvC/bxgspzkjSfU+MweEMmPM8KJebG6nnyxo5mCg==
```

The archive contained:

- exactly 287 entries;
- one top-level directory: `chrome-headless-shell-linux64`;
- no absolute paths, parent traversal, or backslash paths;
- the expected executable exactly where declared.

Running the temporary executable produced:

```
Google Chrome for Testing 153.0.8010.12
```

The temporary directory and downloads were removed automatically after inspection.

## Authenticity classification

The accepted digest must be recorded as:

```
Archive:
chrome-headless-shell-linux64.zip

Playwright:
1.63.0

Playwright browser revision:
1243

Browser:
Google Chrome for Testing 153.0.8010.12

Platform:
Linux x64

Byte size:
119809080

SHA-256:
a9da028861a0cf789ff25c2fed45f5f1aaf969ed9247835b6a7821a4f7af9d1d

Integrity classification:
LOCALLY_OBSERVED_HUMAN_APPROVED
```

The matching downloads do not provide independent cryptographic provenance. The Playwright CDN redirected to the same Google storage object used by the direct download. Initial acceptance therefore relies on:

- HTTPS;
- the SRI-verified Playwright npm package identifying the exact browser version and archive;
- the official Chrome for Testing manifest confirming the exact storage URL;
- two matching observations through the declared official entry points;
- explicit human acceptance of the limited authenticity gap.

This acceptance applies only to:

```
BUILD-002
@playwright/test 1.63.0
Linux x64
Playwright revision 1243
Chrome for Testing 153.0.8010.12
chrome-headless-shell-linux64.zip
119809080 bytes
SHA-256 a9da028861a0cf789ff25c2fed45f5f1aaf969ed9247835b6a7821a4f7af9d1d
```

It does not authorize reuse in BUILD-003 or later. Any archive, version, platform, URL, revision, size, or digest change requires a fresh human decision.

## Headless-shell-only design

Only Chromium headless shell is required for the proposed BUILD-002 screenshots and E2E tests.

The Playwright configuration will:

```
browserName: chromium
headless: true
launchOptions.executablePath:
  <approved-cache>/chromium_headless_shell-1243/
  chrome-headless-shell-linux64/chrome-headless-shell
video: off
trace: off
serviceWorkers: block
```

Screenshots use Chromium’s native screenshot support and do not require FFmpeg. The tests do not require full Chromium.

The dependency installation and CI environment will set:

```
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
```

The following are expressly prohibited:

- `playwright install`;
- `playwright install --with-deps`;
- `@playwright/browser-chromium`;
- full Chromium;
- FFmpeg;
- Firefox;
- WebKit;
- ChromeDriver;
- auxiliary Playwright executables;
- package lifecycle browser downloads;
- OS package installation performed to make the browser work.

If the runner lacks a required library, implementation stops for review.

## Revised bootstrap requirements

The proposed `scripts/bootstrap-playwright.py` will contain immutable constants for:

```
Playwright version: 1.63.0
Playwright revision: 1243
Browser version: 153.0.8010.12
Platform: linux-x64
Archive: chrome-headless-shell-linux64.zip
Byte size: 119809080
SHA-256: a9da028861a0cf789ff25c2fed45f5f1aaf969ed9247835b6a7821a4f7af9d1d
Classification: LOCALLY_OBSERVED_HUMAN_APPROVED
```

Its behavior is fixed as follows:

1. Require an explicit destination argument. It has no home-directory or repository default.
2. In CI, use:
   ```
   $RUNNER_TEMP/gryloo-playwright/chromium_headless_shell-1243
   ```
3. Download only:
   ```
   https://cdn.playwright.dev/builds/cft/153.0.8010.12/linux64/chrome-headless-shell-linux64.zip
   ```
4. Allow only this redirect:
   ```
   HTTP 307
   cdn.playwright.dev
   →
   storage.googleapis.com/chrome-for-testing-public/153.0.8010.12/linux64/chrome-headless-shell-linux64.zip
   ```
5. Allow only HTTPS, the two exact hosts, and the exact approved paths. Reject:
   - HTTP downgrade;
   - query strings or fragments;
   - additional redirects;
   - different status codes;
   - different hosts or paths;
   - proxy-supplied alternative destinations.
6. Stream into a uniquely created temporary file under the approved destination parent.
7. Count bytes and calculate SHA-256 while downloading.
8. Reject before opening the ZIP unless both size and SHA-256 match.
9. Reject:
   - encrypted entries;
   - absolute paths;
   - `..` traversal;
   - backslashes or NUL characters;
   - duplicate normalized paths;
   - symbolic links, devices, sockets, or other special entries;
   - more or fewer than 287 entries;
   - any top-level entry other than `chrome-headless-shell-linux64`;
   - a missing or duplicate expected executable.
10. Extract into a newly created staging directory under the approved cache location.
11. Resolve every extraction target and verify it remains below the staging directory before writing.
12. Set executable permission only on:
    ```
    chrome-headless-shell-linux64/chrome-headless-shell
    ```
13. Run that executable with `--version` and require exactly:
    ```
    Google Chrome for Testing 153.0.8010.12
    ```
14. Move the validated staging directory into the approved cache location only after every check succeeds.
15. Remove the archive and partial staging data after success or failure.
16. Print the version, revision, source and final URL, size, digest, executable path, and integrity classification.
17. Never invoke Playwright’s installer or download another executable.

The SHA-256 check protects subsequent CI runs against deviation from the exact human-reviewed bytes. It does not retroactively create publisher authentication for the first observation.

## Network and telemetry controls

The consolidated plan retains these mandatory controls:

```
NEXT_TELEMETRY_DISABLED=1
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
```

`NEXT_TELEMETRY_DISABLED=1` must be set at CI job scope and explicitly present during:

- Next production build;
- unit and integration tests;
- application runtime used by E2E;
- Playwright E2E execution.

Product code may contain no:

- remote fonts;
- analytics;
- telemetry;
- remote images;
- external CSS or scripts;
- external APIs;
- live data;
- network-backed model or chat service;
- asset CDN references.

Every E2E suite must use a shared guarded fixture that:

- permits requests only when `new URL(request.url()).origin` is exactly `http://127.0.0.1:3000`;
- installs the guard before creating or navigating a page;
- rejects `localhost`, alternate ports, alternate protocols, and all other origins;
- aborts unexpected requests;
- records each unexpected request;
- fails the test during teardown even when the request was successfully blocked;
- creates the browser context with `serviceWorkers: "block"`;
- rejects and records every WebSocket attempt, including same-origin attempts;
- opens no unguarded popup or secondary context.

The negative guard test will deliberately attempt an external request, verify that it was aborted and recorded, and verify that the standard zero-unexpected-request assertion throws. Ordinary E2E tests cannot suppress or acknowledge unexpected requests.

Governance will also scan the reference application for remote URL literals and remote resource declarations. The exact loopback test origin and documented source citations are the only reviewed exceptions.

## Final consolidated BUILD-002 scope

The build objective remains the Gryloo visual shell and shared Semantic Workflow IR state:

- typed Gryloo product configuration;
- white Build → Simulate → Execute layout;
- functional Build tab;
- unavailable Simulate and Execute shells;
- deterministic local mock chat;
- React Flow canvas;
- one shared immutable Semantic Workflow IR store;
- `baseRevision` conflict handling;
- locked-parameter handling;
- visible `MOCKED`, `NONE`, `NOT_ENFORCED`, and `NOT_APPLICABLE` states;
- automated bidirectional round-trip proof.

No wallet, backend, database, API, LLM, quote, protocol adapter, financial simulation, signing, transaction, execution, reconciliation, Mode B implementation, or package publication is included.

### Exact create list

```
apps/reference-dapp/LICENSE
apps/reference-dapp/package.json
apps/reference-dapp/tsconfig.json
apps/reference-dapp/next-env.d.ts
apps/reference-dapp/next.config.ts
apps/reference-dapp/playwright.config.ts
apps/reference-dapp/src/app/layout.tsx
apps/reference-dapp/src/app/page.tsx
apps/reference-dapp/src/app/globals.css
apps/reference-dapp/src/config/product.ts
apps/reference-dapp/src/config/product.test.ts
apps/reference-dapp/src/domain/commands.ts
apps/reference-dapp/src/domain/commands.test.ts
apps/reference-dapp/src/domain/editor.ts
apps/reference-dapp/src/domain/editor.test.ts
apps/reference-dapp/src/domain/contracts.integration.test.ts
apps/reference-dapp/src/domain/mock-actions.ts
apps/reference-dapp/src/domain/initial-workflow.ts
apps/reference-dapp/src/state/workflow-store.tsx
apps/reference-dapp/src/components/app-shell.tsx
apps/reference-dapp/src/components/top-bar.tsx
apps/reference-dapp/src/components/action-library.tsx
apps/reference-dapp/src/components/workflow-canvas.tsx
apps/reference-dapp/src/components/copilot-panel.tsx
apps/reference-dapp/src/components/artifact-inspector.tsx
apps/reference-dapp/src/components/status-badge.tsx
apps/reference-dapp/src/components/summary-bar.tsx
apps/reference-dapp/e2e/fixtures.ts
apps/reference-dapp/e2e/build-roundtrip.spec.ts
apps/reference-dapp/e2e/interface-honesty.spec.ts
apps/reference-dapp/e2e/network-isolation.spec.ts
apps/reference-dapp/e2e/visual-shell.spec.ts
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/build-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/simulate-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/execute-chromium-linux.png
scripts/bootstrap-playwright.py
docs/builds/BUILD-002-PLAN.md
docs/builds/BUILD-002-REPORT.md
```

### Exact modify list

```
.gitignore
.github/workflows/contracts.yml
.github/workflows/governance.yml
README.md
package.json
pnpm-workspace.yaml
pnpm-lock.yaml
turbo.json
eslint.config.mjs
scripts/bootstrap-ci.py
docs/STATUS.md
docs/NEXT_BUILD.md
docs/DECISIONS.md
docs/REQUIREMENTS.md
docs/SCOPE_GUARD.md
docs/SECURITY_MODEL.md
docs/AUTHORITY_MATRIX.md
docs/EVIDENCE_LEVELS.md
docs/LICENSE_MAP.md
```

No container, Dockerfile, container workflow, checksum manifest, full-browser cache, video, trace, or FFmpeg path is added.

Application code and tests under `apps/reference-dapp/**` are AGPL-3.0-only. Its `LICENSE` is a byte-identical copy of `LICENSES/AGPL-3.0-only.txt`. Bootstrap, CI, root configuration, and governance files remain Apache-2.0.

The proposed dependency set remains:

```
next 16.3.5
react 19.3.0
react-dom 19.3.0
@xyflow/react 12.11.6
@playwright/test 1.63.0
@types/react 19.3.0
@types/react-dom 19.3.0
```

The existing BUILD-001 versions, Node 24.21.0, pnpm 11.22.0, strict peers, seven-day release age, lifecycle-script prohibition, audit, license review, and ephemeral SBOM requirements remain unchanged.

## Revised stop conditions

All earlier stop conditions remain. Implementation must additionally stop if:

- the archive digest is described as authoritative or publisher-issued;
- the integrity classification differs from `LOCALLY_OBSERVED_HUMAN_APPROVED`;
- the source URL, redirect, final URL, archive name, platform, revision, browser version, byte size, or SHA-256 differs;
- a redirect leaves the exact approved host and path allowlist;
- archive validation finds an unsafe, duplicate, special, missing, or structurally unexpected entry;
- the reported executable version differs;
- the runner requires installation of system libraries;
- Playwright attempts to locate, install, or download a managed browser;
- full Chromium, FFmpeg, Firefox, WebKit, ChromeDriver, video, trace, or another executable is requested;
- an unexpected HTTP, HTTPS, WebSocket, service-worker, font, image, API, analytics, or telemetry request occurs;
- an unexpected request is ignored because it was blocked;
- the shared network guard is bypassed by any E2E suite;
- `NEXT_TELEMETRY_DISABLED=1` or `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` is absent from a required process;
- the browser archive or risk decision is proposed for BUILD-003 or later;
- any financial, wallet, protocol, simulation, signing, submission, or execution feature enters scope;
- a protected file or BUILD-001 compatibility artifact changes.

## Protected history and current-state correction

[BUILD-001-REPORT.md](BUILD-001-REPORT.md) remains byte-identical. Its current working-tree and `HEAD` digest is:

```
2ec375e280a98110e34a63ff60a10c43073ca99a8372777fddba2d0d5e552fa4
```

Updating [STATUS.md](../STATUS.md) and [NEXT_BUILD.md](../NEXT_BUILD.md) during BUILD-002 remains the approved mechanism for recording the completed BUILD-001 merge and remote CI. BUILD-000 and BUILD-001 reports remain historical evidence.



## Human-approved Next declaration compatibility exception (2026-09-23)

The human owner explicitly approved only this exact type-only block in the
existing `apps/reference-dapp/next.config.ts` file:

```ts
/**
 * BUILD-002 compatibility shim for a declaration defect in next@16.3.5.
 *
 * The published Next declaration references URLPatternInput and
 * URLPatternOptions as globals, while TypeScript 5.9.3 and the installed
 * @types/node@24.13.4 do not provide both names globally.
 *
 * This is type-only. It does not install or polyfill URLPattern and has no
 * runtime effect. Remove and re-review it when Next, TypeScript, or Node type
 * versions change.
 */
declare global {
  type URLPatternInput = string | URLPatternInit;
  type URLPatternOptions = import("node:url").URLPatternOptions;
}
```

The SRI-verified published `next@16.3.5` declaration references
`URLPatternInput` and `URLPatternOptions` as free globals. TypeScript 5.9.3
standard libraries and installed `@types/node@24.13.4` do not provide both
globally. The app's TypeScript project includes `next.config.ts`; the separate
BUILD-001 package projects do not include it. The block creates types only,
installs no package or URLPattern runtime polyfill, and changes no emitted
JavaScript. Remove and re-review it when Next, TypeScript, or Node type
versions change. All versions and strict compiler settings remain pinned.

## Approved license-evidence scope amendment

After the exact two-file XYFlow declaration patch and MIT notice were approved,
the owner reviewed the complete 245-package non-short-circuit inventory and
approved an exact 16-package license exception. The earlier conditional
ten-libvips-only boundary is superseded. Every reviewed record is pinned by
name, version, SPDX expression, registry SRI, graph route, platform and optional
status in `scripts/bootstrap-ci.py`. All packages retain their real license
classifications in dependency evidence and the ephemeral SBOM.

The create scope above additionally includes `THIRD_PARTY_NOTICES.md`,
`patches/@xyflow__system@0.0.82.patch`, the XYFlow MIT notice and the 19 exact
upstream files mapped in `THIRD_PARTY_NOTICES.md`. The root NOTICE and all
other baseline files remain protected. The reference app is AGPL-3.0-only.

Any future distributable artifact conveying a Sharp/libvips binary requires
a separate release-compliance gate for notices, corresponding-source
availability and replacement/relink rights before publication. BUILD-002
dependency review is not universal legal certification.
