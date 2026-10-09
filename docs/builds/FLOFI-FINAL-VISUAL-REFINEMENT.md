# FloFi final visual refinement

2026-10-09 · `codex/build-brand-ux-001` · existing [PR #73](https://github.com/alrimarleskovar/gryloo/pull/73). Leave unmerged.

## Implementation

- `page.tsx` uses `ConnectedFlow` for both the light execution infrastructure and the dark planetary scene (`#about` in this implementation). Existing source labels, official FloFi assets, protocol examples, landing copy and CTAs remain.
- `connected-flow.tsx` keeps all paths in one SVG per diagram. CSS Grid positions the cards; explicit exterior ports define source, core and destination anchors. Bounding rectangles are translated with the inverse SVG screen matrix, including ancestor scale/translation. ResizeObserver watches cards and grid groups, font readiness schedules a measurement, and resize work coalesces into one animation frame. There is no ongoing measurement loop or React animation-frame state.
- Three smooth input curves meet one junction, followed by one trunk into FloFi. A separate output trunk branches to Orca/Solana and Aave/Ethereum in the light diagram, and connects to Onchain finance in the dark scene. Source interior lines and disconnected connector fragments are removed. Ports and junctions are small and consistent.
- Light flow stacks at 900px; the dark scene stacks at 760px. Mobile sources form three readable cards above FloFi, with connected destinations below. Light-only responsive port rules cannot change the dark flow's orientation.
- `earth-atmosphere.tsx` reuses the unchanged `closing-horizon-v2.png`. It is flattened artwork, so the effect is **apparent orbital drift**, not spherical rotation. A closed 48-second CSS transform cycle moves a slightly overscanned image beneath stationary masking/contrast gradients, with subtle atmospheric opacity/translation. Mobile amplitude is smaller. No scaling animation, rectangular spinning, canvas, WebGL, animated filters or third-party dependency.
- Earth motion pauses offscreen and when the document is hidden. CSS reduced-motion rules stop it, connector signals and character animation. `NEXT_PUBLIC_FLOFI_MASCOT_MOTION` gates the Earth, finite connector signals and existing mascot experience.
- `mascot-journey.tsx` and `mascot-motion.module.css` remove pause/resume text, state, event handler and UI. A transient **Skip intro** action remains only while the nonblocking intro plays; its container disappears afterward. Skipping moves focus to the launch link. Intro, jumps, pointer responses, scroll/section choreography and explicit workflow authorization remain.
- The pre-existing uncommitted mascot components, docks, scoped preview configuration and tests were preserved and completed on this branch. No product authorization logic, wallet behavior, route, financial store, execution adapter, dependency version or documentation website was changed.

## Browser validation

- Actual Chromium production rendering in EN/PT at **320, 375, 390, 430, 768, 900, 901, 1024 and 1440px**. Both diagrams: every path endpoint meets its anchor within 1px; all ports touch their card edges; junction degrees are correct; sampled curves never cross card interiors; labels fit; no page overflow.
- Live resize across orientation boundaries, changed source padding/card height, and a translated/scaled diagram also retain correct geometry.
- **24 distinct production motion/visual cases pass across focused runs**: initial production run 23 passed/1 failed on an animation-clock timing assumption; corrected Earth and refreshed 390/1440 captures passed 3/3. No complete repository browser suite was rerun.
- Existing guarded `brand-ux-001.spec.ts` landing/product-entry and normal-motion regressions: **8/8 passed** against the production build, retaining keyboard, language persistence, real asset loading, financial authorization and network-isolation assertions. Diagram assertions were extracted into a shared helper and strengthened for both diagrams, edge anchors and interior crossings.
- Earth evidence captures two real animation timestamps at least eight animation-seconds apart. Computed transform changes with translation only, remains below 15px displacement, and keeps identity scale/rotation. Offscreen pause, live reduced-motion changes, restored animation, and smaller mobile motion pass.
- Default flag-on animation, once-per-tab intro, skipping, mascot travel, jumps/section reactions, pointer look, workflow stage guide, CTA reachability, official blue/white artwork, disabled illustrative authorization and reduced-motion states pass. No pause/resume control or empty persistent control container exists.
- Browser checks record no console errors, hydration warnings, unexpected external requests or horizontal overflow. Visual inspection covered desktop light/dark sections, 320px and 390px diagrams, tablet flow, primary hero, reduced motion and both Earth timestamps.

## Evidence

Production screenshots: [`final-visual-refinement`](../../apps/reference-dapp/e2e/visual-evidence/final-visual-refinement/). Includes all nine widths for both diagrams, desktop/mobile sections and primary hero, reduced-motion presentations, and `earth-t0-1440.png` / `earth-t8-1440.png`. Earlier landing/mascot artifacts remain intact.

## Checks and preview

- Supported app typecheck (`next typegen && tsc --noEmit`): passed.
- Affected ESLint and whitespace checks: passed.
- Production flag-on build: passed. Sandboxed compilation initially could not spawn Next's TypeScript `--showConfig` subprocess; approved execution passed without bypassing checks.
- Governance-lite and **19/19 self-tests**: passed. Generated tracked Python bytecode was restored to its original bytes.
- Initial focused browser iteration found an incorrect PT selector, an existing pointer test that hovered an already-hovered card, and the real 768–900px shared-port style collision. All were corrected; subsequent focused validation passed. The first sandboxed browser attempt could not launch Chromium and is not counted as a validation pass.
- Flag-off production build: passed. Focused production browser fallback: **19 passed / 5 intentionally skipped** (the skipped cases require enabled mascot/signal animation). Both diagrams remain connected in EN/PT at all nine widths; mascot docks/controller and Earth animations are absent/static as intended.

Flag-on Fast Refresh preview: `http://127.0.0.1:3001`, using `FLOFI_MOTION_PREVIEW=true NEXT_PUBLIC_FLOFI_MASCOT_MOTION=true pnpm --filter @defi-workflow-engine/reference-dapp dev --port 3001`. It uses ignored `.next-motion`; the owner's separate server was never stopped. Public feature flags are compiled at startup/build time.

Focused browser command: `BUILD002_BROWSER_CACHE=/home/asus/.cache/ms-playwright/chromium_headless_shell-1243 pnpm --filter @defi-workflow-engine/reference-dapp exec playwright test --config playwright.motion.config.ts`. Set `FLOFI_MOTION_TEST_ORIGIN` to an isolated loopback production preview and `FLOFI_MOTION_EXPECT_ENABLED=false` for a build made with the flag off. `FLOFI_MOTION_EVIDENCE=1` captures screenshots.
