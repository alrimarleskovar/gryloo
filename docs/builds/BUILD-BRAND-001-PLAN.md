# BUILD-BRAND-001 — Gryloo → Flofi

Date: 2026-10-02. Owner-authorized product/repository branding migration.
Base: `6cd675e41c0838fa8ac9cf3ec8e90de9442da3b9`.
Branch: `codex/build-brand-001-flofi` in its separate branding worktree.

Flofi inherits Gryloo's product and history. This change affects presentation,
not financial execution semantics. The existing typed product configuration
supplies the header name, logo alternative text and page title. The logo artwork,
layout, styling, Canvas architecture and interaction model stay the same.

## Identifier inventory and decisions

Classification was performed against the tracked base revision before editing.
The inventory covers application code, packages, scripts, CI, documentation,
fixtures and branded paths, including lowercase and uppercase spellings.

| Class | Identifiers / locations | Decision |
| --- | --- | --- |
| A — product brand | `product.name`, `product.build`, page title, header/logo alt text, current panel copy | Use Flofi. Preserve every safety message's meaning. |
| A — product brand | `apps/reference-dapp/public/flofi-logo.png` | Byte-identical copy of existing artwork; header uses the new URL. Keep `gryloo-logo.png` available for URL compatibility. |
| A — product brand | Download names `gryloo-aave-{supply,borrow,repay,withdraw}-{execution-record,evidence}.json`, `gryloo-build013-{run,evidence}.json`, `gryloo-rh-demo-001-{execution-record,evidence}.json`, `gryloo-{jupiter,solana-devnet}-*.json` | New downloads use `flofi-` prefixes. Serialized content, format tags and hashes are unchanged; downloaded historical files are not renamed. |
| A — product brand | README, contributor guidance, living master spec/prompt, current licensing presentation | Use Flofi; date the branding-only spec/prompt revision. Preserve original authorship, founder authorization, license grants and official license texts. |
| B — compatibility | All `GRYLOO_*` environment settings in application actions, runtime profiles, scripts, tests and CI | Keep existing names and exact precedence/defaults. No `FLOFI_*` aliases are implemented or advertised in this build. |
| B — compatibility | `gryloo:*` browser keys; dotted persisted state keys; `gryloo:cross-chain-runtime` event | Preserve values so recovery, saved executions and canvas preferences remain readable. |
| B — compatibility | `gryloo.*` format/profile/schema tags, adapter IDs `gryloo.template` and `gryloo.calculated-split`, `Symbol.for('gryloo.base-observation.live')` | Preserve producers and consumers, hashing and validation. No schema migration. |
| B — compatibility | `~/.gryloo`, `/home/asus/.gryloo`, `.gryloo-runtime`, configured journal paths and `gryloo-*` temporary/runtime/cache directories | Preserve existing paths. No move, deletion, copying of journals, fallback lookup or new `~/.flofi` directory. |
| B — compatibility | LI.FI `integrator: 'gryloo'`; `Gryloo/BUILD-008`, `Gryloo/BUILD-009`, Robinhood runtime/verifier user agents; `[gryloo/supply/wallet]` log prefix | Preserve provider attribution, request identity, diagnostics and replay compatibility. Coordinate any future provider-account migration separately. |
| B — compatibility | `isGrylooTestWallet`, `isGrylooCowLocalWallet`, `gryloo*TestRpc` / `grylooJupiterTestSign`, `Gryloo MOCKED Solana wallet` | Preserve test-provider identities and safety markers; only assertions on changed product copy are updated. |
| B — compatibility | Root package `defi-workflow-engine`; all `@defi-workflow-engine/*` packages; script and service module filenames | Already neutral; preserve package names, imports, exports, lockfile and commands. No Gryloo-named package or script filename needs migration. |
| B / C | Reconciler evidence prose mentioning Gryloo, verifier labels, owner-recording network names, pinned test-account descriptions, fixture names | Preserve even prose when it is emitted into evidence or names a recorded acceptance context. Do not alter regenerated evidence bytes for branding. |
| C — historical / frozen | Existing `docs/builds/**`, `docs/DECISIONS.md`, existing ADRs, archived JSON/journals/hash manifests, transcripts, compatibility vectors, screenshots/visual evidence | Byte-for-byte preservation. No snapshots or evidence are regenerated. |
| C — historical / frozen | Past entries within README, STATUS, NEXT_BUILD, REQUIREMENTS, SECURITY_MODEL, AUTHORITY_MATRIX, EVIDENCE_LEVELS and license/provenance records | Keep historical Gryloo references. Current notes distinguish Flofi without rewriting recorded facts or prior authority. |
| B / C | `alrimarleskovar/gryloo`, origin URL and historical GitHub PR links | Keep working repository references until the owner renames GitHub; preserve historical links as provenance. |

### Compatibility strategy

Retaining the existing configuration and persistent namespaces is the migration
strategy for this build. Flofi runs with the same `GRYLOO_*` configuration and
reads the same records. In particular, enablement flags remain exactly as before;
introducing a second set of financial execution gates is unnecessary for branding.
`FLOFI_*` names do not currently configure the runtime. Any future alias proposal
must separately specify conflicts, precedence and fail-closed behavior.

Owner recording scripts still refer to the established `~/.gryloo` roots for
BUILD-003F, BUILD-006 and BUILD-007. Journals supplied through existing environment
settings keep their configured paths, including `~/.gryloo/build-015-devnet` and
`~/.gryloo/rh-demo-001`. No runtime directory or secret is inspected in this build.
Schema IDs, canonical bytes and historical evidence remain valid with Flofi.

### Exact technical identifier index (base revision)

The following code/CI/script tokens are all class B and remain unchanged.
Environment-like error labels (for example `GRYLOO_ANVIL_BIN_REQUIRED`) are
included so they cannot be mistaken for new Flofi settings. Historical documents
and frozen JSON may contain additional class C names; they are not migration targets.

Environment settings and related diagnostic tokens:

- `GRYLOO_ALCHEMY_API_KEY`
- `GRYLOO_ALCHEMY_KEY_FILE`
- `GRYLOO_ALCHEMY_KEY_FILE_REQUIRED`
- `GRYLOO_ANVIL_BIN`
- `GRYLOO_ANVIL_BIN_REQUIRED`
- `GRYLOO_ANVIL_COMPAT_OUT`
- `GRYLOO_B007_INPUTS`
- `GRYLOO_BASE_OBSERVATION`
- `GRYLOO_BRIDGE`
- `GRYLOO_BRIDGE_JOURNAL`
- `GRYLOO_COMPOSITION_ALLOW_MOCKED_UI`
- `GRYLOO_COMPOSITION_ENVIRONMENT`
- `GRYLOO_COMPOSITION_EXECUTOR_KEY_FILE`
- `GRYLOO_COMPOSITION_INTERIM_TRANSCRIPT_PATH`
- `GRYLOO_COMPOSITION_INTERIM_TRANSCRIPT_SHA256`
- `GRYLOO_COMPOSITION_KEYS_INPUT`
- `GRYLOO_COMPOSITION_MODE`
- `GRYLOO_COMPOSITION_PROFILE`
- `GRYLOO_COMPOSITION_RECORDING_PROXY_PORT`
- `GRYLOO_COMPOSITION_SMOKE_PROFILE`
- `GRYLOO_COMPOSITION_SOURCE_BLOCK_HASH`
- `GRYLOO_COMPOSITION_SOURCE_BLOCK_NUMBER`
- `GRYLOO_COMPOSITION_SYNTHETIC_PINS_FILE`
- `GRYLOO_COW`
- `GRYLOO_COW_RUNTIME`
- `GRYLOO_F2_PUBLIC_PIN_FILE`
- `GRYLOO_FORK_ACCOUNT_PHRASE_FILE`
- `GRYLOO_JUPITER_E2E`
- `GRYLOO_JUPITER_HARNESS`
- `GRYLOO_JUPITER_JOURNAL`
- `GRYLOO_JUPITER_OWNER_EXECUTION`
- `GRYLOO_LENDING_E2E`
- `GRYLOO_LENDING_HARNESS`
- `GRYLOO_LENDING_JOURNAL`
- `GRYLOO_LIQUIDITY`
- `GRYLOO_LIQUIDITY_E2E`
- `GRYLOO_LIQUIDITY_JOURNAL`
- `GRYLOO_LIQUIDITY_OWNER_REPLAY`
- `GRYLOO_LIQUIDITY_PROFILE`
- `GRYLOO_LIQUIDITY_REPLAY_RUNTIME`
- `GRYLOO_MODE_A`
- `GRYLOO_MODE_A_E2E`
- `GRYLOO_MODE_A_JOURNAL`
- `GRYLOO_MODE_A_PROFILE`
- `GRYLOO_MODE_A_RUNTIME`
- `GRYLOO_MODE_A_SYNTHETIC_PINS`
- `GRYLOO_MODE_A_TRANSCRIPT`
- `GRYLOO_MODE_B`
- `GRYLOO_MODE_B_EIP2470_INITCODE`
- `GRYLOO_MODE_B_EXECUTOR_KEY_FILE`
- `GRYLOO_MODE_B_OWNER_ADDRESS`
- `GRYLOO_MODE_B_PROFILE`
- `GRYLOO_MODE_B_ROLES_MASTERCOPIES`
- `GRYLOO_MODE_B_RUNTIME`
- `GRYLOO_MODE_B_SAFE_PACKAGE`
- `GRYLOO_MODE_B_SMOKE_PROFILE`
- `GRYLOO_MODE_B_VISUAL_EVIDENCE_DIR`
- `GRYLOO_PUBLIC_TESTNET`
- `GRYLOO_PUBLIC_TESTNET_JOURNAL`
- `GRYLOO_PUBLIC_TESTNET_READ`
- `GRYLOO_ROBINHOOD_E2E`
- `GRYLOO_ROBINHOOD_HARNESS`
- `GRYLOO_ROBINHOOD_JOURNAL`
- `GRYLOO_ROBINHOOD_TESTNET`
- `GRYLOO_SOLANA_DEVNET_E2E`
- `GRYLOO_SOLANA_DEVNET_EXECUTION`
- `GRYLOO_SOLANA_DEVNET_HARNESS`
- `GRYLOO_SOLANA_DEVNET_JOURNAL`
- `GRYLOO_SOLANA_DEVNET_RPC_URL`
- `GRYLOO_SOLANA_RPC_URL`
- `GRYLOO_SUPPLY_E2E`
- `GRYLOO_SUPPLY_HARNESS`
- `GRYLOO_SUPPLY_JOURNAL`
- `GRYLOO_UNISWAP_V3_PACKAGES`

Dotted format, profile, adapter and state identifiers:

- `gryloo.across.execution-id`
- `gryloo.across.mocked.v1`
- `gryloo.anvil-compatibility.v1`
- `gryloo.base-fork-state-transcript.v1`
- `gryloo.base-observation-recordings.v1`
- `gryloo.base-observation-transcript.v1`
- `gryloo.base-observation.live`
- `gryloo.bridge-execution.v1`
- `gryloo.bridge-journal.v1`
- `gryloo.build-003f-g7-manual-wallet.v1`
- `gryloo.build-003f-owner-recording-manifest.v1`
- `gryloo.build-003f-provider-billing.v1`
- `gryloo.build-003f-recording-journal.v1`
- `gryloo.build-003f-recording-log.v1`
- `gryloo.build-003f-scenario-results.v1`
- `gryloo.build-003f.f2-public-pins.v1`
- `gryloo.build-006-offline-dry-run.v1`
- `gryloo.build-006-owner-recording-manifest.v1`
- `gryloo.build-007-independent-verification.v1`
- `gryloo.build-007-owner-recording-manifest.v1`
- `gryloo.build009.mocked.v1`
- `gryloo.build011c.mocked.v1`
- `gryloo.calculated-split`
- `gryloo.composition-journal-event.v1`
- `gryloo.composition-prepared.v1`
- `gryloo.cow-local.v1`
- `gryloo.jupiter-review.v1`
- `gryloo.jupiter-run.v1`
- `gryloo.lending-composition.v1`
- `gryloo.lending-observations.v1`
- `gryloo.lending-review.v1`
- `gryloo.lending-run.v1`
- `gryloo.liquidity-enforcement-matrix.v1`
- `gryloo.liquidity-journal.v1`
- `gryloo.liquidity-prepared.v1`
- `gryloo.liquidity-session.v1`
- `gryloo.mode-a-e2e-fixture.v1`
- `gryloo.mode-a-fork-profile.v1`
- `gryloo.mode-a-prepared.v1`
- `gryloo.mode-a-revocation.v1`
- `gryloo.mode-b-composition-enforcement.v1`
- `gryloo.mode-b-composition-permission.v1`
- `gryloo.mode-b-fork-profile.v1`
- `gryloo.mode-b-owner-session.v1`
- `gryloo.mode-b-permission.v1`
- `gryloo.mode-b-prepared.v1`
- `gryloo.native-transfer-review.v1`
- `gryloo.native-transfer-run.v1`
- `gryloo.orca-devnet-review.v1`
- `gryloo.orca-devnet-run.v1`
- `gryloo.orca-liquidity-review.v1`
- `gryloo.orca-liquidity-run.v1`
- `gryloo.supply-review.v1`
- `gryloo.supply-run.v1`
- `gryloo.template`

Colon-prefixed browser storage and event identifiers:

- `gryloo:build012a:supply`
- `gryloo:build014:jupiter`
- `gryloo:build015:orca-liquidity`
- `gryloo:canvas:`
- `gryloo:canvas:workflow-local`
- `gryloo:cross-chain-runtime`
- `gryloo:public-testnet-execution-id`
- `gryloo:rh-demo-001:transfer`
- `gryloo:toolbox-mode`

## Historical provenance

Existing BUILD reports/plans, evidence bundles, screenshots, transaction records,
hashes, old PR/build links, DEC entries and ADRs retain Gryloo wherever that was
the contemporary name. New download filenames do not change the JSON payloads.
New current-product documentation explains the transition. The original logo URL
also remains valid. Flofi makes no new acceptance or certification claim here.

## Repository rename handoff — owner action

The remote is still `https://github.com/alrimarleskovar/gryloo.git`. This build
does not rename the GitHub repository or change remotes/settings.

After the owner renames the repository to `alrimarleskovar/flofi` in GitHub:

1. Confirm existing PRs, issues, branch protection/rulesets, checks, permissions
   and links still work. Keep PR #48 open and unmerged for BUILD-013.
2. Update clone/remote configuration to
   `https://github.com/alrimarleskovar/flofi.git` in an owner-approved maintenance
   session. Linked worktrees share Git configuration: do not change the common
   remote while BUILD-013 must remain undisturbed.
3. Use the new URL in future clone instructions, badges, repository links,
   integrations and new PR references. Historical `.../gryloo/pull/...` links in
   STATUS, NEXT_BUILD and BUILD reports remain provenance; verify GitHub redirects
   rather than rewriting frozen records.
4. CI checkout already derives its remote from `github.server_url` and
   `github.repository`; it has no hard-coded owner/repository rename requirement.
   Package scopes remain `@defi-workflow-engine/*`.

## Deployment rename handoff — BUILD-CLOUD-001 remains unstarted

No tracked Railway/Vercel deployment manifest, production service project name,
or production database configuration was found in this baseline. No external
cloud inventory was accessed, so existing external resources are not asserted.
CI/harness names such as `gryloo-anvil`, `gryloo-playwright`, `gryloo-mode-a-e2e`,
`gryloo-cow-e2e`, `gryloo-build-007-inputs` and `gryloo-b007-*` are local test
infrastructure, not production deployments; preserve them in this build.

When separately authorized for CLOUD-001, use Flofi/flofi for new cloud project,
service, public site, monitoring and database display names, and connect the
then-current GitHub repository. Inventory any existing provider accounts/domains
before renaming them. Preserve configured journals/storage volumes and existing
`GRYLOO_*` settings until a reviewed compatibility migration exists. Coordinate
LI.FI's `gryloo` integrator separately; changing its name is not a UI rename.

## Explicit non-goals

- No UI redesign, CSS/layout changes, workflow or Canvas changes.
- No protocol, IR, adapter, compiler, executor, reconciler, wallet, recovery,
  evidence, network or safety-gate changes.
- No BUILD-013 debugging, stale-review investigation, public preflight or
  journal modification. BUILD-013 stays OPEN at the preserved base on
  `codex/build-013-lending-composition`; PR #48 stays open and unmerged.
- No browser/desktop automation, owner screen access, wallet actions, signing,
  chain switching, public RPC verification or financial transactions.
- No BUILD-CLOUD-001, deployment, database/service provisioning, repository
  rename, remote-setting change or merge.
- No new `TESTNET_EXECUTED` claim or historical evidence regeneration.

## Validation and delivery

Use Node 24.21.0 and pnpm 11.22.0 with a frozen, script-disabled install in this
worktree. Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm schemas:check`,
the non-fork unit suite (`pnpm test`), governance-lite and its unittest suite,
and `git diff --check`. Check historical artifacts and protected runtime code
against the base revision, and inspect the production page without a browser.
Browser, owner-recording and public execution tests are excluded by the owner's
explicit session boundary. Existing browser copy assertions are updated for CI;
historical screenshot baselines are not regenerated.

Record actual validation results before delivery. Commit and push only the new
branding branch, prepare a branding-only PR against the preserved BUILD-013
branch so its diff is reviewable, never merge, and stop after the final report.

### Recorded local results

| Check | Result |
| --- | --- |
| Frozen install, lifecycle scripts disabled | PASS; pinned Node 24.21.0 / pnpm 11.22.0; all 247 lockfile entries passed supply-chain policy verification. Lockfile unchanged. |
| `pnpm typecheck` | PASS, 13 Turbo tasks. |
| `pnpm lint` | PASS. |
| `pnpm build` | PASS, 7 tasks; optimized Next.js production build and prerender completed. |
| `pnpm schemas:check` | PASS, all 11 exports unchanged. |
| `pnpm test` | PASS, 145 test files / 1,177 tests; 2 existing conditional tests skipped (not claimed as passes). Fork tests excluded by the existing command. |
| `python3 scripts/governance_lite.py` | PASS. |
| `python3 -m unittest discover -s scripts -p test_governance_lite.py` | PASS, 17 tests. |
| `git diff --check` | PASS. |
| Protected-file comparison to base | PASS, 671 existing runtime/historical files byte-identical, including all packages, actions, server/state/domain/wallet code, scripts, CI, compatibility vectors, existing BUILD artifacts, existing ADRs and screenshots. |
| Component comparison to base | PASS: undoing only the brand substitutions and typed logo-alt expression reproduces every original component exactly. |
| Built HTML inspection (no browser) | PASS: Flofi title/header, `/flofi-logo.png`, `Flofi logo` alt text, same 36×36 dimensions; no Gryloo display copy in the initial HTML. Both logo assets have identical bytes. |
| BUILD-013 preservation | Local branch remains at the base; GitHub read-only inspection confirms PR #48 is OPEN at that same HEAD. No work was performed in its worktree. |

The first sandboxed build failed while capturing TypeScript subprocess output;
the successful retry used the same build command with subprocess access and an
explicit cache directory inside the branding worktree. The first unit run passed
1,174 tests but three Python hash-vector checks failed with `spawnSync python3
EPERM`; the unchanged full suite passed on retry with subprocess access. No test,
safety gate, source dependency, snapshot or evidence artifact was weakened or
regenerated to obtain a pass. The offline install needed missing registry metadata;
the frozen install then completed with supply-chain policies enabled.

No browser suite, owner wallet, public RPC/preflight, transaction, deployment or
cloud provisioning was used for this build. Browser assertions were updated for
the changed copy but were not executed, and existing screenshot baselines remain
untouched. This validation establishes repository compatibility, not new financial
execution evidence or visual screenshot acceptance.

Known CI limitation: the existing Playwright screenshot assertions use
`maxDiffPixels: 0` and include the product header. Preserved Gryloo-era baselines
are therefore expected to report visual differences for the Flofi text. Full
browser/visual CI is not claimed green. The draft PR records this follow-up;
future owner-authorized visual acceptance must preserve historical images and
establish separately identified Flofi baselines. This build neither relaxes the
pixel gate nor regenerates those historical artifacts.
