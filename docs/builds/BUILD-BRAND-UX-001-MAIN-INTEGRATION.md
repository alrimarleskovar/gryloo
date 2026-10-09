# PR #73 — reintegration after PR #72

2026-10-09 · `codex/build-brand-ux-001` · [existing PR #73](https://github.com/alrimarleskovar/gryloo/pull/73).

## Preservation and merge

Inspected the branch, working changes and current PR before integration. The native Docs and stronger bottom Earth implementation were saved in recoverable checkpoint `039e351` (`Add native FloFi docs and animated planetary surface`). A local patch and untracked-file inventory were also retained under `/tmp`. No worktree reset, discarded modifications, rebase, force push, new PR or merge into main was performed.

Fetched `origin`; its latest main was exactly `68249fad76f515dee9c953cb42df115492f191dd`, the PR #72 merge. Integrated it in normal merge commit `0301e01`, with the published PR history retained. Main remains an ancestor of the branch; there are no unresolved conflicts.

The sole textual conflict was the Copilot input: PR #73's mobile `enterKeyHint="send"` and PR #72's native readiness `disabled` guard were both preserved. Reviewed the automatically merged shell, product workspace, styles, application routes and financial tests. The shell keeps native inert/readiness gating and simulation continuation requests, along with mobile workspace navigation and `/app` routing.

Two newly introduced main-branch browser tests still opened `/` as the product. Updated only their destination to `/app`: the held-script canvas initialization regression and the held-price Uniswap proposal regression. Their original interaction, exact-bound, semantic-state and zero-send assertions remain intact.

## Security and product boundaries

Approval actions, approval handoff, platform, MCP and channel implementation files are identical to merged main. No signing route, wallet proof, recovery capability, tenant/account boundary, expiry, financial authorization, execution adapter or reconciliation policy was relaxed. Kept private MCP capabilities in client metadata, account-authenticated nonsecret references, case-sensitive Solana owner checks, explicit proposal loading, generation-checked asynchronous completion, and consumed-handoff recovery limited to proven-owner authoring. Fresh simulation, Strategy Manifest review and owner wallet authorization remain required.

Preserved the landing, both measured infrastructure diagrams, official mascot, motion flag, mobile controls and product-focused README. Native Docs now additionally summarize the merged universal signing/recovery behavior and link its primary runbook. Docs and Earth implementation details, routes, preview commands and visual evidence are in [the native Docs/Earth report](FLOFI-NATIVE-DOCS-EARTH.md).

## Validation

Validation is performed on the merged branch, using isolated `.next-docs` production output so the owner's development server remains running. Browser financial fixtures use synthetic loopback chains and disposable PostgreSQL databases. No external provider call, real message, public transaction or owner funds are involved.

- Workspace TypeScript: all 16 tasks passed.
- ESLint: passed.
- Isolated production build, including TypeScript: passed.
- Schema exports: all 11 verified.
- Governance-lite, whitespace and all 19 governance self-tests: passed.
- Focused unit regressions: 116 files / 1,211 tests passed (channel, MCP, platform, wallet, authoring/review, recovery and execution).
- Focused PostgreSQL regressions: 20 files / 144 tests passed (channels, MCP, platform approvals/handoffs and approval surface).
- Native Docs/Earth production browser suite: 11/11 passed, with fresh screenshots in both themes at 390/768/1440px and Earth at 0/5/10 seconds on desktop/mobile.
- Existing guarded landing, product entry and desktop scroll regressions: 8/8 passed, covering 320/375/390/430/768/1024/1440px.
- Mobile Copilot/canvas/wallet dismissal and migrated-route/header regressions: 5/5 passed.
- Mascot-enabled motion/diagram regressions: 7/7 passed, including live geometry resize, PT, reduced motion and Earth activation.

The real-browser captures were opened and inspected. Original horizon/sky geometry and text remain stable while terrain detail and lighting change. No exposed image boundaries, horizontal overflow, detached connectors, console errors or hydration warnings occurred in these passing UI checks. Flag-off production and flag-on development checks both retain reduced-motion behavior. No visible or hidden focusable Pause motion control exists.

Signing browser validation initially encountered shared fixture-port collisions at 8552, 8554 and 8557 before tests could start. Other local services were left untouched; no existing server was reused and no guard was weakened. The runner waited for the ports to remain clear, then ran sequential profiles on fresh disposable databases.

Final additional results:

- **`pnpm check` passed**: 16 TypeScript tasks, ESLint, nine build tasks, 11 schema exports, 287 unit files / 2,965 tests. Two existing owner-fixture tests remain skipped, not counted as passes.
- Channel signing: **6/6** browser cases passed, including ChatGPT/Claude recovery, delayed-response isolation, rejected proof/retry and capability privacy.
- MCP in-chat and dedicated routes: **21/21** browser cases passed.
- WhatsApp/Telegram approval handoffs: **2/2** passed with fixture providers only.
- Developer API/SDK approval handoff: **1/1** passed.
- Review/Execute, canvas, credentials and replay observations: **61 distinct cases passed across focused runs**. The first aggregate run passed 59 and exposed two read-only layout failures; the corrected two-case run passed with all original geometry and security assertions.
- Read-only canvas component regression: **20/20** tests passed.
- Uniswap financial provenance and held-price/keyboard submission race: **2/2** browser cases passed, preserving exact ticks, amounts, recipient and zero-send assertions.
- Final three-step story: **6/6** production cases, each covering EN/PT and reduced motion at the six requested widths.
- Final complete landing/mobile file: **15/15** passed.
- Final complete mascot/diagram/Earth files: **24/24** passed against the production page.
- Post-story production builds, final app TypeScript and affected ESLint: passed.

The MCP route regression found that the existing “Go to FloFi” return action still opened the new public landing. It now opens `/app`, preserving the product-return contract and all dedicated-route validation assertions.

The read-only canvas failures exposed a 21px navigator/Back-to-Build overlap at 1280px. The read-only Review/Execute canvas now explicitly uses the intended 1024px compact threshold; the authoring canvas retains its default 800px threshold. An intermediate diagnostic test-threshold change was reverted. The original 1024/400px synchronization, non-overlap, responsive geometry, branding and zero-execution assertions are retained. No financial or workflow behavior changed.

The owner's subsequent three-step storytelling request is delivered separately in commit `4a55605`; see [the three-step report](FLOFI-THREE-STEP-STORY.md). It replaces the long pinned sequence without changing Docs, infrastructure or Earth implementation.

## Review status

PR #73 remains for owner review. No merge or automatic merge is authorized. Live vendor hosts, WhatsApp policy clearance, real mobile wallet apps and owner-signed public network acceptance remain separate from loopback engineering evidence.
