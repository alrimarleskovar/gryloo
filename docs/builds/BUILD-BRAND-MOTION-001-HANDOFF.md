# BUILD-BRAND-MOTION-001 — FloFi Alive handoff

Updated: 2026-10-09. **The checkpoint below is historical; its remaining implementation and validation work is complete in [Final visual refinement](FLOFI-FINAL-VISUAL-REFINEMENT.md). Pause/resume UI was removed at the owner’s request; reduced-motion and the environment flag remain.** Worktree: `/home/asus/projects/flofi-brand-ux`; branch: `codex/build-brand-ux-001`; starting HEAD: `9e68c19`. Update existing [PR #73](https://github.com/alrimarleskovar/gryloo/pull/73); do not open another PR or merge. Preserve BUILD-BRAND-UX-001 and its validation/evidence.

## Completed / scoped audit

- Git status was clean. Read only landing components/styles, app instructions, relevant bundled Next.js CSS/Fast Refresh/environment guides, focused landing tests and prior handoff.
- Verified the actual `/mnt/c/Users/ASUS/Desktop/WORLD/tokensandlogo.zip` with Python `zipfile`: `assets/2edaac5d207cd190feac7f3a3f18cee6.svg` equals existing `public/brand/flofi-symbol-light.svg` byte for byte (SHA-256 `fa3865d2b9078a2f8830f9c2ad0d7beeecca823930eb40ca0b68e1ec95b818b6`). White `assets/fb842e26e70eab9f94a1f4a4124ddfde.svg` equals `flofi-symbol-dark.svg` (`3ad472fc52de192b43a0da61c48cf2a0b2515d84c65ef3341b5451f4e363111b`). Both 877 bytes, viewBox `50 5 370 345`, three body paths, two eyes, one smile. Reuse these unchanged; no substitute artwork or invented limbs.
- Existing native React/CSS/IntersectionObserver motion has no animation dependency. Preserve current section order: hero → capabilities → networks → workflow → review → infrastructure → closing.

## Implementation direction / components

- A reusable official-asset character, reserved section docks and a shared native animation controller; desktop travel between docks, compact section-specific mobile choreography.
- Intro once per tab session, optional skip/pause, readable/clickable content throughout. Distinct idle/jump/look/travel/celebrate states; illustrative workflow steps keep user authorization explicit.
- `NEXT_PUBLIC_FLOFI_MASCOT_MOTION=true` enables the experiment; unset/false retains the existing landing. No backend or provider changes, dependency installation or asset redesign.
- Created `flofi-mascot.tsx` (exact blue/white images), `mascot-animations.ts` (jump/look/celebrate keyframes), `mascot-journey.tsx` (docks, desktop travel, mobile-local scenes, observers/controls/intro), and isolated `mascot-motion.module.css`. Wired hero, five capabilities, networks, workflow, review, infrastructure and final CTA without reordering sections or changing existing copy.
- Desktop intro 2.6s / mobile 1.8s with momentum, anticipation, squash/stretch, tilt and brand accent. Once-per-tab storage, skip, scroll-to-skip, reduced-motion/live-preference fallback, pause/resume, pointer cooldown and cleanup implemented. Workflow guide keeps “You authorize” distinct and never enables the disabled review illustration.
- Isolated preview is running on **3001**, with `FLOFI_MOTION_PREVIEW=true` selecting ignored `.next-motion`; the original server on **3000** responded HTTP 200 and remains running. No restart/termination was performed. Fast Refresh configuration is unchanged.

## Remaining work

1. Complete browser-based visual/refinement checks of intro and section choreography. Focused `brand-motion-001.spec.ts` and `playwright.motion.config.ts` are implemented; use only this config for motion iteration.
2. Validate flag on/off, six widths, pointer/workflow/CTA, intro session and reduced motion; inspect captures. Run final production builds and original focused landing regressions.
3. Complete affected lint/governance, report/preview instructions and this handoff; commit/push same branch and update PR #73.

## Known issues / tests

- Initial app typecheck caught two strict indexed-access issues; corrected and subsequent typecheck passed. Initial affected lint passed. First dev browser iteration used stale “Launch app”/“Supported networks” selectors; corrected to existing “Launch FloFi”/“Networks”. That initial run is not passing validation. Browser refinement is ongoing.
- Public Next.js flags are frozen at build time. Enable via environment before starting a separate preview server; use another port so the original server stays intact. No test-only runtime flag bypass.
- Reuse previous checks from `BUILD-BRAND-UX-001-HANDOFF.md`; do not rerun the full repository/E2E suite.

## Next exact actions

Use the running flag-on preview at `http://127.0.0.1:3001`. Exact start command for future sessions: `FLOFI_MOTION_PREVIEW=true NEXT_PUBLIC_FLOFI_MASCOT_MOTION=true pnpm --filter @defi-workflow-engine/reference-dapp dev --port 3001`. Preserve both development servers. Run scoped browser checks with `BUILD002_BROWSER_CACHE=/home/asus/.cache/ms-playwright/chromium_headless_shell-1243 pnpm --filter @defi-workflow-engine/reference-dapp exec playwright test --config playwright.motion.config.ts`; optional `FLOFI_MOTION_EVIDENCE=1` saves scene captures. Original flag-off server remains on 3000.
