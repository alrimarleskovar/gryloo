# BUILD-BRAND-UX-001 — recovery audit

**Superseded public-page requirement:** the owner subsequently required removal of public Devnet/testnet/sandbox presentation. The landing's recorded-execution section was removed, not relabeled as mainnet. The public page now uses real-asset product illustrations and network identities, with Tempo explicitly coming next. Historical evidence and all in-app safety labels remain accurate. See [current handoff](BUILD-BRAND-UX-001-HANDOFF.md).

Audited on 2026-10-09 in the existing `codex/build-brand-ux-001` working tree, based on `fefda242e4abea5b8be5db57a9b8a09adbd2b65a`. No reset, checkout replacement, route rollback, unrelated worktree edit or development-server shutdown was performed. A binary tracked diff and all 28 initially untracked files were saved under `/tmp/flofi-brand-recovery-{start.patch,untracked-start.tar.gz}` before implementation resumed.

## Completed work retained

- Public `/` landing with bilingual copy, isolated marketing styles, product illustrations, developer links, recorded Devnet evidence and the supplied closing artwork.
- Persistent product workspace at `/app`; mobile Canvas/Copilot focus shortcuts; responsive toolbar, dialog and evidence presentation.
- Product-oriented README and exact preservation of its previous prose in `README-ENGINEERING-HISTORY.md`, with only relative links rebased.
- Design compatibility report, attribution and third-party license exclusions.
- Official identity assets: all four existing symbols/wordmarks match the supplied `tokensandlogo/assets` files byte-for-byte. Marketing uses approved blue `#2343D9`, navy `#041B3D`, muted text `#4B5B73`, border `#D9E2EC`, Outfit and IBM Plex Mono. The established product themes and financial state colors are retained.

## Route migration

The eight deleted files were moved into `(product)`, which does not add a URL segment. Seven were byte-identical at recovery; `/connections` differed only in the relative import required by its new location. `/app/agents`, `/app/credentials`, `/app/dashboard`, `/app/dashboard/runs/[runId]`, `/app/passkeys`, `/app/workflows`, `/approve` and `/connections` remain registered. `/app` replaces the former builder entry at `/`.

The original provider hierarchy, per-request workflow identity and persistent workspace now live in the product layout. API, OAuth and server-action files were not migrated or modified. Approval metadata, dynamic rendering, duration and the existing no-frame/no-referrer/no-index/no-store headers are retained. Build navigation and saved-workflow return expectations correctly use `/app`.

Recovery found one deployment issue: explicit replay-fixture tracing still targeted the now-static `/`. This must follow the product and approval routes so serverless product requests retain their recorded fixtures.

## E2E integrity

All 95 modified E2E files were compared with HEAD. Existing bodies and assertions are preserved after normalizing builder entry/return URLs (`/` → `/app`), including secondary browser variables in the ownership and recovery suites. The only non-routing changes are appended mobile Review and Execute cases. No test was removed, skipped or softened. The shared loopback network guard, CSP, secret handling, mocked provenance gates, wallet isolation, signature checks, expiry/invalidation and execution counters are unchanged. The guarded runner adds the new brand suite without removing a profile.

## Incomplete or broken work at recovery

The earlier logs record passing typecheck, lint, build and 2,956 unit tests, but those are prior-run evidence. The browser checkpoint records **42 passed / 8 failed**:

- Four mobile brand cases: the Copilot input remained 14px because an existing selector overrode the attempted 16px rule.
- Four mobile Review cases: the explicit approval control remained 40px in the component harness because the new rule depended on an `.app-shell` ancestor.

The initial evidence folder contains desktop builder and desktop/mobile landing images, but lacks the intended completed mobile builder captures. Full route/security regressions, motion verification, final validation, the build report and PR remain to be completed.

The resumed work fixes component selector specificity and portable Review touch sizing, updates product fixture tracing, verifies the actual application in a browser and records final outcomes in `BUILD-BRAND-UX-001-REPORT.md`. Financial stores, backend authorization, contracts, execution adapters and dependency versions remain outside this change.

## Findings during resumed verification

The first resumed run confirmed the input and Review fixes. It exposed an incorrect accessible-name selector in the new wallet test (`Connect wallet` instead of the actual `Connect a wallet`) and an overly broad new route assertion: MCP error/account pages legitimately use an `.app-shell` wrapper without mounting the workflow workspace. Those new assertions were corrected to use the actual title and check the absence of workflow navigation, canvas and execution controls. Original E2E assertions were retained.

The subsequent mobile dialog test exposed a real existing interaction bug: global canvas shortcuts intercepted Escape after a card had been selected, preventing native wallet-dialog dismissal. The canvas now respects handled events and dialog/menu focus. Regression coverage checks that Delete in the wallet dialog preserves the card and workflow revision, Escape dismisses the dialog, selection persists and focus returns to its trigger. Authorization logic is unchanged.

The owner's crypto-visual refinement is included in this same build. Marketing scenarios now use familiar assets and ecosystem names, with illustration/roadmap labels. Actual application labels and recorded Devnet evidence are preserved.
