# BUILD-MCP-002 integration on current main

Integrated 2026-10-07 on branch `claude/build-mcp-002`; authoritative main:
`a23a77d2a1ea93decc6904ea039d7fe4278240aa`. Original branch head:
`8f9650a1f86cee96c16577f4a89f63a7920a33e1`. Rebase boundary:
`4b99acc9700cbb34d3ed25a73780c96a28c21418`. Only the 13 MCP-002 commits were replayed;
MCP-001 was already merged in PR #63 and was not replayed or duplicated.

## Conflicts and exact resolutions

| File | Resolution |
| --- | --- |
| `apps/reference-dapp/src/app/page.tsx` | Kept current main byte-for-byte: the root layout owns the persistent product workspace and the page returns null. Rejected MCP-002’s duplicate provider/shell mount. |
| `apps/reference-dapp/src/app/globals.css` | Kept every current-main CSS byte in order, including `copilot-notice` using `var(--blue)`. Appended only new approval selectors; replaced their two hardcoded colors and white button text with existing theme variables. No existing selector changed. |
| `.github/workflows/contracts.yml` | Kept current main’s guarded product/composition browser gates and all other release, security and SBOM gates. Added only the MCP-002 in-chat browser command. Did not restore the old unguarded browser command list. |

## Integration regressions corrected

- `/approve` now mounts its handoff inside current main’s `ProductWorkspace` provider tree. Its route returns null and the redundant new `AppProviders` file is removed. The canonical app shell and existing stores mount once and remain persistent.
- The new sensitive-page CSP retains current main’s `connect-src 'self'` alongside `frame-ancestors 'none'`; browser coverage checks the delivered header.
- The new approval styles use current main’s theme variables. The unchanged main Review theme assertion exposed this integration failure; its source and expectations were preserved.
- The three new MCP browser lifecycle cases now use main’s visible `Simular Fees`, technical disclosure and shared Review/Execute controls. They verify the MOCKED authorization boundary, zero wallet transactions, prepared/simulated status returned to the panel/model context, and exactly one app shell. No old main test or snapshot changed. The separate MCP PostgreSQL journey retains positive mocked owner-driven execution and reconciliation coverage.

## Reconciliation with main

Package manifests, lockfile, dependency verifier, governance implementation/self-tests and waiver metadata are byte-identical to main: 265 registry identities, 16 reviewed license exceptions, nine workspace manifests/importers. All 23 current-main screenshot snapshots are byte-identical, as are the root page/layout, app shell and guarded browser runner. `source-map-js@1.2.2`, both PostCSS overrides, the existing sharp security resolution and the exact owner-approved temporary Colosseum waiver are retained. Audit remains enforced at `low` without exclusions.

Migrations 0001–0004 and their shipped identities are unchanged. MCP adds only `0005_mcp_oauth.sql`, with shipped SHA-256 `7130a683de4f7e7ec28158cfcf2022f1fdc9583b6f47b540f39f97b4803115da`. OAuth, approval and wallet-link environment documentation extends current main’s embedded PostgreSQL runtime documentation. Mainnet handoff policy remains empty/disabled. No production secrets, Vercel configuration, public-chain transaction or merge was performed.

## UX/UI file inventory and reasons

| File | Reason |
| --- | --- |
| `apps/reference-dapp/src/components/product-workspace.tsx` | Existing UX file: import and route-conditional handoff mount inside the existing provider tree, needed to integrate MCP without duplicating the current main shell or stores. Existing provider hierarchy and `AppShell` props are unchanged. |
| `apps/reference-dapp/src/app/globals.css` | Existing UX file: additive styles exclusively for new `.approval-*` elements. The entire current-main stylesheet is an unchanged prefix. |
| `apps/reference-dapp/src/app/approve/page.tsx` | New MCP approval route and sensitive-page metadata; delegates UI to the persistent workspace. |
| `apps/reference-dapp/src/app/connections/page.tsx` | New wallet-link management route. |
| `apps/reference-dapp/src/components/approval-handoff.tsx` | New external proposal display, wallet proof and explicit handoff claim/application. |
| `apps/reference-dapp/src/components/connections-panel.tsx` | New account approval/wallet-link management controls. |
| `apps/reference-dapp/src/components/wallet-proof.tsx` | New EVM/Solana ownership-proof controls shared by the two new routes. |
| `apps/reference-dapp/src/mcp/app/panel.ts` | New in-chat MCP App approval/status panel and signing-session handoff. |
| `apps/reference-dapp/src/mcp/oauth/consent-page.ts` | New consumer OAuth consent page. |

Supporting integration changes: `next.config.ts` adds sensitive-page security headers for the two new routes; `wallet-session-action.ts`, `wallet-session.ts`, `session-principal.ts` and `solana-wallet.ts` add Solana ownership proof while retaining EVM behavior. `playwright.config.ts`, `e2e/jupiter-fixtures.ts` and `e2e/lending-fixtures.ts` add only MCP harness/sign-in support. All existing visual components, app-shell interactions, copy, layouts and snapshots are unchanged.

## Validation

Final local integration gates passed on Node 24.21.0 and pnpm 11.22.0, with loopback PostgreSQL, the approved Chromium headless shell and pinned Anvil. Logs/evidence are ephemeral under `.tmp/mcp002-integration/` and are excluded from Git.

| Gate | Final result |
| --- | --- |
| `pnpm check` | PASS: 15 typecheck tasks, lint, 8 build tasks, 11 schema exports, 241 unit files passed, 2 existing files skipped; 2,539 tests passed and 2 existing tests skipped. Re-run on the final CSP/header assertion source. |
| PostgreSQL | PASS: 109 tests in 17 files, including all MCP OAuth, approval, panel and positive owner-driven mocked execution suites. |
| Focused MCP/wallet/cloud-runtime units | PASS: 147 tests in 20 files; these are a subset of the full unit total, not additional unique tests. |
| MCP browser/in-chat | PASS: 5 cases on the final production build, including the delivered sensitive-page CSP assertions. EVM, Solana and lending retain current main’s MOCKED authorization block; wallet links, cross-wallet refusal and mainnet policy refusal pass. |
| Current main guarded product browser | PASS: 128 tests across all 16 unchanged profiles, including strict existing snapshots, Review/Execute/recovery, cloud runtime and CoW. |
| Relevant wallet browser | PASS: 8 unchanged chain/environment, EIP-6963 connection/discovery and no-wallet cases. The three historical provider financial execution diagnostics remain unchanged and were not counted as release passes, consistent with main’s MOCKED authorization policy. |
| Pinned composition contract suites | PASS: 3 tests in 3 files, with the unchanged digest-pinned closed replay harness. |
| Current main guarded composition browser | PASS: 1 case using the unchanged runner/profile. |
| Offline fork | PASS: 31 tests; 29 existing owner/profile-dependent skips. |
| Anvil compatibility | PASS: 4 tests; 10 existing owner-dependent skips. Included in the offline fork invocation too. |
| Governance-lite/self-tests | PASS: final tree scanner, 19 unchanged self-tests, zero secret findings. |
| Dependency verification | PASS: 265 exact registry identities/integrities/release ages, 16 reviewed license exceptions; only the exact existing temporary `source-map-js@1.2.2` waiver. |
| Audit | PASS: unchanged `pnpm audit --audit-level low`, zero vulnerabilities. |
| CycloneDX 1.6 SBOM | PASS: 265 exact registry components, valid dependency reference graph, nine separately verified workspace manifests/importers, 16 reviewed exceptions. Main’s validator was used verbatim; the ephemeral SBOM was removed. |
| Main preservation | PASS: all 23 existing screenshot files, root page/layout, app shell, locked dependencies, governance controls and migrations 0001–0004 match main byte-for-byte; main’s complete CSS is an unchanged prefix. |
| Whitespace | PASS: working diff and complete PR diff against current main. |

Dependency evidence SHA-256: `75b8acce7acf25c7933a625621d2a2c5ab3296e310f8601fe11956d6f505edeb`.
Validated ephemeral SBOM SHA-256: `6ce05dd906dd26e7136acda0a9f73d1a38d081b56da0cbfa4a6f07d4d0997cb8`.

Earlier attempts encountered shared loopback-port collisions and the new approval CSS theme regression. The final isolated reruns above pass. The first new browser assertions expected PREPARED for every flow; the unchanged backend correctly reports SIMULATED for Solana and lending, and the assertions now use those exact states.

Authoritative main’s CI run `37620473242` timed out in the unchanged Uniswap provenance case. That exact case passes in this branch’s normal guarded product run; no current-main test or UX code was altered to address the transient failure. GitHub checks and mergeability must be inspected on the final pushed PR head; local results do not assert that CI is green.

## Exact files changed from authoritative main

77 files; paths from `git diff --name-only origin/main` (including this report).

- `.github/workflows/contracts.yml`
- `apps/reference-dapp/e2e/jupiter-fixtures.ts`
- `apps/reference-dapp/e2e/lending-fixtures.ts`
- `apps/reference-dapp/e2e/mcp-constants.ts`
- `apps/reference-dapp/e2e/mcp-fixtures.ts`
- `apps/reference-dapp/e2e/mcp-in-chat.spec.ts`
- `apps/reference-dapp/next.config.ts`
- `apps/reference-dapp/playwright.config.ts`
- `apps/reference-dapp/src/app/.well-known/oauth-authorization-server/route.ts`
- `apps/reference-dapp/src/app/.well-known/oauth-protected-resource/api/mcp/route.ts`
- `apps/reference-dapp/src/app/.well-known/oauth-protected-resource/route.ts`
- `apps/reference-dapp/src/app/approve-action.ts`
- `apps/reference-dapp/src/app/approve/page.tsx`
- `apps/reference-dapp/src/app/connections-action.ts`
- `apps/reference-dapp/src/app/connections/page.tsx`
- `apps/reference-dapp/src/app/globals.css`
- `apps/reference-dapp/src/app/oauth/authorize/route.ts`
- `apps/reference-dapp/src/app/oauth/register/route.ts`
- `apps/reference-dapp/src/app/oauth/revoke/route.ts`
- `apps/reference-dapp/src/app/oauth/token/route.ts`
- `apps/reference-dapp/src/app/wallet-session-action.ts`
- `apps/reference-dapp/src/components/approval-handoff.tsx`
- `apps/reference-dapp/src/components/connections-panel.tsx`
- `apps/reference-dapp/src/components/product-workspace.tsx`
- `apps/reference-dapp/src/components/wallet-proof.tsx`
- `apps/reference-dapp/src/engine/strategy-engine.ts`
- `apps/reference-dapp/src/engine/strategy-spec.ts`
- `apps/reference-dapp/src/mcp/app/panel.pg.test.ts`
- `apps/reference-dapp/src/mcp/app/panel.ts`
- `apps/reference-dapp/src/mcp/config.ts`
- `apps/reference-dapp/src/mcp/execution.test.ts`
- `apps/reference-dapp/src/mcp/execution.ts`
- `apps/reference-dapp/src/mcp/gateway.test-harness.ts`
- `apps/reference-dapp/src/mcp/gateway.test.ts`
- `apps/reference-dapp/src/mcp/gateway.ts`
- `apps/reference-dapp/src/mcp/handoff/handoff.pg.test.ts`
- `apps/reference-dapp/src/mcp/handoff/journey.pg.test.ts`
- `apps/reference-dapp/src/mcp/handoff/links.ts`
- `apps/reference-dapp/src/mcp/handoff/service.ts`
- `apps/reference-dapp/src/mcp/handoff/store.ts`
- `apps/reference-dapp/src/mcp/oauth/cimd.ts`
- `apps/reference-dapp/src/mcp/oauth/config.ts`
- `apps/reference-dapp/src/mcp/oauth/consent-page.ts`
- `apps/reference-dapp/src/mcp/oauth/crypto.ts`
- `apps/reference-dapp/src/mcp/oauth/foundation.test.ts`
- `apps/reference-dapp/src/mcp/oauth/gateway-oauth.pg.test.ts`
- `apps/reference-dapp/src/mcp/oauth/no-model.test.ts`
- `apps/reference-dapp/src/mcp/oauth/oauth-test-harness.ts`
- `apps/reference-dapp/src/mcp/oauth/pg-store.pg.test.ts`
- `apps/reference-dapp/src/mcp/oauth/pg-store.ts`
- `apps/reference-dapp/src/mcp/oauth/routes.ts`
- `apps/reference-dapp/src/mcp/oauth/runtime.ts`
- `apps/reference-dapp/src/mcp/oauth/server.pg.test.ts`
- `apps/reference-dapp/src/mcp/oauth/server.ts`
- `apps/reference-dapp/src/mcp/oauth/state.ts`
- `apps/reference-dapp/src/mcp/oauth/store.ts`
- `apps/reference-dapp/src/mcp/runtime.ts`
- `apps/reference-dapp/src/mcp/simulation.test.ts`
- `apps/reference-dapp/src/mcp/simulation.ts`
- `apps/reference-dapp/src/mcp/step-list.test.ts`
- `apps/reference-dapp/src/mcp/tools.ts`
- `apps/reference-dapp/src/server/flow-runtime.ts`
- `apps/reference-dapp/src/server/session-principal.ts`
- `apps/reference-dapp/src/server/solana-session.test.ts`
- `apps/reference-dapp/src/server/wallet-session.ts`
- `apps/reference-dapp/src/wallet/solana-wallet.ts`
- `docs/STATUS.md`
- `docs/builds/BUILD-MCP-002-INTEGRATION.md`
- `docs/builds/BUILD-MCP-002-PLAN.md`
- `docs/builds/BUILD-MCP-002-REPORT.md`
- `docs/deploy/CLOUD.md`
- `docs/deploy/ENVIRONMENT.md`
- `docs/deploy/MCP.md`
- `packages/cloud-runtime/migrations/0005_mcp_oauth.sql`
- `packages/cloud-runtime/src/migrations.ts`
- `packages/reference-compiler/src/jupiter-mock.ts`
- `packages/reference-reconciler/test/test-wallet.ts`
