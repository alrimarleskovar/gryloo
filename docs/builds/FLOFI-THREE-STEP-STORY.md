# FloFi — three-step product story

2026-10-09 · `codex/build-brand-ux-001` · existing PR #73. Leave unmerged for owner review.

## Change

Replaced the primary Intent / Strategy / Review / Execute / Verify storytelling scene with three simultaneously readable cards: **Build → Review → Execute**. The desktop section previously reserved `400vh`, pinned a full-screen scene and derived a React stage index on scroll. The mascot observed that index separately and reacted to five intermediate states. That geometry and double choreography created the long, rigid experience.

Removed pinning entirely, the artificial scroll height, scroll-progress state, scroll/resize listeners in `WorkflowStory`, hidden stage panels and the duplicated five-stage mobile timeline. Desktop now shows three horizontal cards; tablet uses compact stacked rows; phones show three vertical cards. Everything remains available without JavaScript, without watching an animation and under reduced motion.

- **Build:** Chat, Canvas, GPT, Claude, WhatsApp and Telegram feed one shared FloFi workflow. Copy refers to connected channels, without claiming public activation of every integration.
- **Review:** simulation, permissions and limits sit within a Strategy Manifest with explicit user approval. Material changes require fresh review.
- **Execute:** the owner's wallet signature precedes execution. Tracking and reconciliation are smaller follow-through details inside this card; Verify is not another scroll stage.

Short EN/PT copy, official FloFi artwork, colors and typography remain consistent with the landing. This is an illustrative explanation; no interactive financial control or authorization behavior was added or changed. Other landing sections, infrastructure diagrams, Earth, navigation, CTAs, README and the native Docs implementation are preserved.

## Mascot and performance

Each card has a small official mascot accent in normal document flow. A single IntersectionObserver marks each card once and immediately unobserves it. The local body makes one 750ms transform entrance, then stays still. It has no perpetual idle loop, stage jump, scroll progress or React state update. Scrolling away and back does not restart its entrance.

Excluded these three local docks from the existing global traveler and pointer handlers. Removed the old workflow stage mutation observer, sticky-section geometry reads, five-stage guide and forced micro-step reactions. The mascot's intro, interactions and movement elsewhere remain intact. The existing feature flag still controls mascot availability. Live reduced motion disables the entrances and keeps all content readable. No motion toggle was added.

## Validation

- Production Next.js build with mascot flag enabled and TypeScript checks: passed.
- Supported app TypeScript and affected ESLint: passed.
- Six focused production Playwright cases at **320, 375, 390, 430, 768 and 1440px**, each covering EN and PT: passed.
- Checks require three readable phases, no fixed/sticky descendants, no hidden stage panels, native wheel movement beyond 550px for a 600px wheel input, immediate continuation to the next section, no overflow and no console/hydration errors.
- All six widths also check explicit approval/signature copy, visible official mascots, finite finished entrances, unchanged animation start times after scrolling, and static reduced-motion fallback. Desktop story height is below 1100px; stacked layouts stay below 2000px.
- Clean production screenshots for both languages and every width were captured and opened for inspection: [three-step-story evidence](../../apps/reference-dapp/e2e/visual-evidence/three-step-story/). Development captures were replaced by production captures.

Updated the two existing landing story tests and the related mascot tests to assert the new three-phase behavior. Retained their reduced-motion, explicit authorization, no-overflow, artwork, network-isolation and no-Pause-control checks. Broader final regression results are recorded with [the main integration](BUILD-BRAND-UX-001-MAIN-INTEGRATION.md).

Preview: **http://127.0.0.1:3004/#workflow** (isolated production, mascot enabled). The owner's separate development server was not restarted or stopped.

```bash
FLOFI_MOTION_TEST_ORIGIN=http://127.0.0.1:3004 FLOFI_STORY_EVIDENCE=1 \
  BUILD002_BROWSER_CACHE=/home/asus/.cache/ms-playwright/chromium_headless_shell-1243 \
  pnpm --filter @defi-workflow-engine/reference-dapp exec playwright test \
  --config playwright.motion.config.ts workflow-story.spec.ts
```

Browser validation used Chromium and native input behavior. No cross-device frame-rate certification is claimed; the implementation removes the section's scroll-linked work and artificial pinning rather than asserting a hardware-independent FPS number.
