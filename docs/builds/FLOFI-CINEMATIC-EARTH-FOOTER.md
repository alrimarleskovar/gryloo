# FloFi — cinematic Earth footer restoration

Branch: `codex/build-brand-ux-001` · existing PR #73 · 2026-10-09.

The simplification removed the rendered closing scene, leaving the original artwork and its improved animation available but unused. This correction mounts that artwork inside the existing semantic footer. The main page still contains exactly `#workflow`, `#networks`, and `#developers`, followed immediately by the footer. No closing product story, heading, duplicate CTA, or fourth marketing section returns.

## Implementation

- `apps/reference-dapp/src/components/marketing/page.tsx` renders `EarthAtmosphere` inside the existing footer. Its logo, translated navigation, native Docs link, source link, License link, and closing line remain intact.
- `earth-atmosphere.tsx` observes its nearest footer or section, with an element fallback, instead of assuming a section ancestor. Visibility and hidden-tab changes pause and resume the existing CSS animation clocks. The centered, aspect-preserving SVG crop keeps the diagonal horizon recognizable on mobile and wide desktops.
- `landing.module.css` gives only the footer a full-width, restrained 460–600px desktop composition and a 520px mobile composition. Its gradient begins with For Builders' existing light background color, passes through FloFi blue, and ends in deep navy. The original horizon fades into that atmosphere; the lower navy overlay protects text contrast. Links retain their 44px minimum height and receive a lavender keyboard-focus outline and readable hover color.

The three approved sections, infrastructure geometry, workflow cards, channel logos, mascot controller, Docs, README, wallet routes, signing, and financial authorization code are unchanged. `/flofi/closing-horizon-v2.png` is unchanged. No new art, dependencies, runtime external images, canvas, WebGL, scroll handler, or frame-driven React state was introduced.

## How the planet moves

The source is a flattened 1672×941 image, so this is **apparent planetary rotation, not a newly rendered 3D globe**. The restored component reuses the newer 60-second surface treatment already in this branch, rather than the old ±0.7% background drift:

1. The original image and illuminated horizon remain stationary.
2. A feathered SVG mask confines two enlarged copies of the original image to the curved planetary surface.
3. Both copies travel in the same direction from `(-125, 42)` to `(125, -42)` SVG units over 60 seconds. Their cycles are staggered by 30 seconds and crossfade before an invisible reset. Nothing spins the rectangular artwork or reverses the surface direction.
4. Restrained moving illumination and atmospheric opacity provide depth. Overscan covers the entire viewBox throughout both cycles, preventing exposed image edges.

Earth motion is independent of `NEXT_PUBLIC_FLOFI_MASCOT_MOTION`. It runs when the footer is visible and the tab is active, pauses without resetting its clock, and becomes the original static image under `prefers-reduced-motion: reduce`. The decorative layers cannot receive pointer events or focus. No motion control was added.

## Browser evidence

Real Chromium production previews were inspected at 390, 768, 1440, and 1920px. These captures use actual elapsed animation time from the initial visible frame; animations were not disabled for the captures.

| Width | Initial | +5 seconds | +10 seconds |
| --- | --- | --- | --- |
| 390 | [T0](../../apps/reference-dapp/e2e/visual-evidence/cinematic-earth-footer/footer-390-t0.png) | [T5](../../apps/reference-dapp/e2e/visual-evidence/cinematic-earth-footer/footer-390-t5.png) | [T10](../../apps/reference-dapp/e2e/visual-evidence/cinematic-earth-footer/footer-390-t10.png) |
| 768 | [T0](../../apps/reference-dapp/e2e/visual-evidence/cinematic-earth-footer/footer-768-t0.png) | [T5](../../apps/reference-dapp/e2e/visual-evidence/cinematic-earth-footer/footer-768-t5.png) | [T10](../../apps/reference-dapp/e2e/visual-evidence/cinematic-earth-footer/footer-768-t10.png) |
| 1440 | [T0](../../apps/reference-dapp/e2e/visual-evidence/cinematic-earth-footer/footer-1440-t0.png) | [T5](../../apps/reference-dapp/e2e/visual-evidence/cinematic-earth-footer/footer-1440-t5.png) | [T10](../../apps/reference-dapp/e2e/visual-evidence/cinematic-earth-footer/footer-1440-t10.png) |
| 1920 | [T0](../../apps/reference-dapp/e2e/visual-evidence/cinematic-earth-footer/footer-1920-t0.png) | [T5](../../apps/reference-dapp/e2e/visual-evidence/cinematic-earth-footer/footer-1920-t5.png) | [T10](../../apps/reference-dapp/e2e/visual-evidence/cinematic-earth-footer/footer-1920-t10.png) |

The same evidence directory contains:

- `transition-{width}.png`: actual For Builders → footer viewport.
- `footer-{width}-reduced.png`: static reduced-motion fallback.
- `motion-{width}.json`: measured elapsed times, transforms, opacity, unchanged layout, and surface movement exceeding 40 SVG units over ten seconds.
- `seam-{390,1440}-{29990,30010,59990,60010}.png`: deterministic browser animation-clock sampling immediately before/after both reset points, separately from the real elapsed-time captures above.
- `surface-pixel-comparison.json`: raw RGB comparisons in a lower-right surface region (74–97% of image width, 50–64% of image height), excluding the atmospheric sky and navigation. The rendered surface changes over five and ten seconds; seam differences are much smaller. These measurements supplement direct screenshot inspection rather than claiming a true 3D surface.

## Validation

- Required `pnpm check`: passed TypeScript, whole-repository ESLint, production builds, 11 schema exports, and **2,965 unit tests**. Two existing owner-fixture tests remain skipped. The full suite ran once.
- Final isolated production build with mascot motion enabled: passed after matching the footer's first gradient color to For Builders. Final application TypeScript and affected-file ESLint: passed.
- Focused landing browser suite: **48 passed**, covering mascot intro/interactions/reduced motion, official channel artwork, connector geometry and resizing, natural scrolling, all eight landing widths (320–1920px), EN/PT, anchors, CTAs, and the restored footer.
- Separate real production build with the mascot flag disabled: **5 footer tests passed**, including real 0/5/10-second motion at all four requested widths, visibility pause/resume, reduced motion, and surface coverage through both cycle resets. The flag is absent from that build, rather than removed from the DOM by the test.
- Final footer and three-section browser checks after the gradient refinement: **14 passed**. Evidence was recaptured from this final build.
- Governance-lite and **19 self-tests**: passed. `git diff --check`: passed.

No horizontal overflow, layout shift during the measured animation, broken image responses, browser errors, hydration warnings, detached infrastructure connectors, or scroll gates were observed. Footer links are visible, hit-testable, and keyboard accessible; all landing anchors still navigate to their retained sections. Cycle coverage checks ensure neither travelling image exposes its bounds, and the resetting pass is effectively transparent while the other remains visible. This is focused rendered-browser evidence, not a hardware-wide frame-rate certification or a financial execution acceptance claim.

Local review: **http://127.0.0.1:3004/**. The owner's separate development server on port 3001 was left running. Delivery updates PR #73 only; merging remains the owner's decision.
