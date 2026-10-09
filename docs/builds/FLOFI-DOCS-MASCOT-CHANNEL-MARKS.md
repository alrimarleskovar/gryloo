# FloFi Docs mascot and workflow channel marks

2026-10-09 · `codex/build-brand-ux-001` · existing PR #73. No merge.

## Landing channel artwork

The existing unpinned Build → Review → Execute section remains intact. Its six
entry point pills now use a FloFi conversation icon, the existing canvas
navigation geometry, and official OpenAI, Claude, WhatsApp and Telegram marks.
All visible marks fit 20px slots. OpenAI's original clear-space canvas is
retained, displayed at 40px to yield an approximately 20px mark. At 320/375px,
icons sit above labels in the same six-entry grid; larger widths use inline
alignment. Narrow-screen padding keeps the existing section height check.

OpenAI and Claude reuse the repository's verified SVGs. WhatsApp and Telegram
are byte-identical SVG members from their owners' current official downloads,
with no runtime third-party image requests. Exact source URLs, package members,
hashes and trademark terms are in
[`public/brand/channels/sources.md`](../../apps/reference-dapp/public/brand/channels/sources.md)
and the root third-party notices. No acceptance, live connection or endorsement
badge was added. Shared-workflow connectors and approval copy are preserved.

## Docs character and article motion

`DocsMascot` reuses `FloFiMascot` and `characterMotion` from the existing landing
motion utilities. The original official blue/white SVGs are unchanged. No
facial paths, silhouette, colors or anatomy were edited. The homepage keeps
its circular illustration, with a 1.75s jump/tilt/squash landing (1.5s on mobile),
a soft landing pulse, a 24s quiet idle including one occasional small bounce,
a dynamic shadow and a restrained 48s orbit with two small points.

Getting-started links and the first-workflow card trigger an encouraging jump;
API/SDK/MCP links trigger a curious tilt. Keyboard focus has the same reactions.
Opening search can trigger a brief tilt. Reactions are limited to a visible
homepage mascot and throttled; they never intercept an interaction or delay
navigation. An unfinished entrance takes precedence over reactions.

One IntersectionObserver pauses CSS motion offscreen; document visibility
pauses it in a hidden tab. The animation clock resumes instead of replaying the
intro. Reduced motion renders a static character and cancels event-driven
animation. Mobile reduces travel and illustration size. No permanent animation
frame loop, scroll listener, cursor tracker, motion dependency or React motion
state was introduced. No visible motion toggle exists.

Only the Docs article content receives a 220ms opacity/5px entrance on pathname
changes. Header and sidebar DOM remain stable. Technical articles have no
large mascot or repeated homepage introduction. Sidebar/TOC layout, article
content, product disconnect behavior, financial authorization, Earth and
landing mascot choreography were not changed by this refinement.

## Validation

Final isolated production preview: `http://127.0.0.1:3004/docs` and
`http://127.0.0.1:3004/#workflow`. The owner's development server was preserved.

- Production build, supported reference-app TypeScript check, affected-file
  ESLint and `git diff --check`: passed.
- Governance-lite: passed; governance self-tests: 19 passed.
- `workflow-story.spec.ts`: 6 passed, each covering EN/PT at
  320, 375, 390, 430, 768 and 1440px. Checks local loaded SVGs, six 20px icon
  slots, edge containment, three phases, explicit approval/signature,
  reconciliation, finite mascot entrances, no pinning, natural wheel scroll,
  no overflow, reduced motion and no console/hydration errors.
- `docs-mascot.spec.ts`: 6 passed at those same widths. Samples actual rendered
  transforms 300ms apart during the intro and 600ms apart during idle; verifies
  hover/focus/search reactions, fixed illustration bounds, paused orbit time,
  completed intro persistence, light/dark official variants, reduced motion,
  stable header/sidebar DOM and article navigation. Also exercises the hidden
  document visibility event path on desktop.
- Existing `native-docs.spec.ts`: 9 passed. Direct guides, native links, anchors,
  exact OpenAPI contract, search keyboard behavior, clipboard contents,
  previous/next, mobile navigation, themes, contrast and focus containment.

The new browser checks initially exposed lazy-image timing and CSS start-time
semantics in the assertions; these were corrected to test loaded images and
preserved animation current time. A real 320px Portuguese height increase was
fixed with more compact source pills. Existing height, scroll, security,
reduced-motion and accessibility assertions were retained. A governance unit
test invocation initially used the wrong Python import path; its direct script
invocation passed all 19 tests. No unresolved check failures remain.

## Inspected screenshot evidence

- [BUILD desktop](../../apps/reference-dapp/e2e/visual-evidence/three-step-story/story-en-1440.png)
- [BUILD mobile](../../apps/reference-dapp/e2e/visual-evidence/three-step-story/story-en-390.png)
- [Portuguese at 320px](../../apps/reference-dapp/e2e/visual-evidence/three-step-story/story-pt-320.png)
- [Docs desktop light](../../apps/reference-dapp/e2e/visual-evidence/docs-mascot/docs-light-1440.png)
- [Docs desktop dark](../../apps/reference-dapp/e2e/visual-evidence/docs-mascot/docs-dark-1440.png)
- [Docs mobile dark](../../apps/reference-dapp/e2e/visual-evidence/docs-mascot/docs-dark-390.png)
- [Docs desktop during entrance](../../apps/reference-dapp/e2e/visual-evidence/docs-mascot/docs-entrance-1440.png)

All six widths have light/dark/entrance Docs captures and EN/PT workflow
captures in the corresponding evidence folders. Functional motion verification
uses elapsed browser time and rendered transforms, rather than screenshots
alone. Browser coverage is Chromium; no public channel acceptance or wallet
execution was performed or claimed for this visual refinement.
