# FloFi final landing structure — PR #73

The public `/` page now has exactly three main sections, followed immediately
by the existing footer:

1. **Many ways in. One clear path.** — Build / Review / Execute, the primary hero.
2. **Supported networks** — existing network cards and capability boundaries.
3. **For Builders** — existing execution infrastructure and developer links.
4. **Footer** — FloFi identity, retained product/network/developer/Docs anchors,
   source code and repository license links.

## Implementation

- `marketing/page.tsx`: removes the old introductory preview, scenarios,
  standalone review and final-vision sections and their private render helpers.
  The measured infrastructure diagram is retained without changing its SVG
  geometry or ports. Header and footer anchors now target the three retained
  sections. Developer documentation links to `/docs`, the builder CTA to
  `/docs/developer-api`, and product CTAs to `/app`.
- `marketing/workflow-story.tsx`: promotes the existing three-card story to
  the sole `h1` hero, adds Launch FloFi and Explore Docs buttons, and integrates
  the existing official hero mascot dock. All six existing channel icons,
  review requirements and explicit wallet-signature messaging are retained.
- `marketing/landing.module.css`: adapts the existing composition for the hero,
  retains the responsive card layout and infrastructure styles, and uses a
  container query to stack icon/label pairs when individual BUILD pills need
  more room. The convergence SVG fills its container without letterboxing.
  Narrow-header spacing, Portuguese hero density, footer wrapping and tablet
  orbit bounds are refined. The 320px Portuguese hero measures approximately
  1,960px, within the unchanged 2,000px compact-story test budget.
- `marketing/landing-copy.ts`: preserves EN/PT content, adds translated Docs,
  source and license labels, updates page titles and labels Tempo as
  **Upcoming / Em breve**. Network support still explicitly varies by action.
- `marketing/landing-motion.tsx`: retains the finite entrance observer and
  removes the obsolete preview pointer-depth handlers and halo scroll listener.

The FloFi Alive controller, official vector assets and reusable motion utilities
remain intact. It now follows three global docks: hero, networks and
infrastructure. Workflow cards retain their separate short, once-only local
entrances. There is no pinning, progress timeline, scroll gate or Pause Motion
control. Live and initial reduced-motion preferences remain respected.

The Earth artwork, provenance, `EarthAtmosphere` component and its animation CSS
remain available. They are not mounted on `/`: the retired final-vision section
is not retained as a fourth marketing section. The reusable scenarios component
also remains available. Native Docs implementation, the product README, product
routes, PR #72 channel signing and all financial/security code are unchanged.
Commit `68249fad76f515dee9c953cb42df115492f191dd` remains an ancestor of this branch.

## Browser validation and screenshots

Production preview: **http://127.0.0.1:3004/**, built directly with
`FLOFI_DOCS_PREVIEW=true NEXT_PUBLIC_FLOFI_MASCOT_MOTION=true` into `.next-docs`.
The owner's existing development server was left running.

Chromium checks cover **320, 375, 390, 430, 768, 1024, 1440 and 1920px**, in EN/PT.
Infrastructure checks additionally cover its 900/901px responsive boundary,
changing card dimensions and a transformed SVG container. Endpoint/edge gaps,
shared junctions and samples along every actual curve are checked; no connector
crosses a card interior. The shared geometry assertion is unchanged.

Checks verify the exact section order, visible first-screen headline and CTAs,
real header/footer anchor navigation, all six loaded local channel icons,
network labels/availability, native Docs links, natural wheel scrolling,
keyboard access, no horizontal overflow, mascot/heading separation, actual
changing intro poses, no intro replay, hover reactions and live reduced motion.
No browser errors or hydration warnings were observed. Separate desktop/mobile
browser smoke checks followed the hero CTAs to the real `/app` shell and `/docs`.

Evidence is saved in
[`final-landing`](../../apps/reference-dapp/e2e/visual-evidence/final-landing/):

- `workflow-{en,pt}-{width}.png`, `networks-{en,pt}-{width}.png`, and
  `developers-{en,pt}-{width}.png`: all eight widths, both languages.
- `full-{en,pt}-{390,1440}.png`: complete mobile and desktop page compositions.
- `intro-{390,1440}-{first,second,settled}.png`: different actual entrance poses
  and the settled hero. Sampled animation clocks were about 233ms and 800ms;
  transform matrices changed at both sizes and the headline remained stable.

Actual screenshots were inspected across all eight widths, including the full
desktop/mobile composition, narrow Portuguese hero, tablet layout, networks,
and attached infrastructure connectors. The tablet orbital accent was tightened
after inspection so its edge remains inside the viewport.

## Checks and intentional test changes

- Repository `pnpm check`: passed. TypeScript: 16 tasks; ESLint; production build:
  9 tasks; schema drift: 11 exports; unit tests: **2,965 passed, 2 existing skips**
  across 287 passing test files and two skipped files.
- Final isolated application production build: passed. The root Turbo runner
  filters the preview environment variables, so its normal `.next` build was
  supplemented by the direct `.next-docs` build used for browser evidence.
- Final application TypeScript and affected-file ESLint: passed.
- Landing, mascot, workflow and infrastructure browser checks: **43 passed**.
- Native Docs regression: **15 passed** — routes, search, exact code copying,
  internal links/anchors, themes, mobile navigation, accessibility, homepage
  mascot and stable article navigation.
- Governance-lite and its **19 self-tests**: passed. `git diff --check`: passed.

Obsolete tests for the removed dark final-vision diagram and its Earth animation
were replaced with the selected-section checks and retained-asset availability
check. Tests for the deleted illustrative authorization button now require its
absence and explicit approval/wallet-signature copy. Actual product execution
button, wallet dismissal, provenance and sensitive-route security assertions
remain intact. Docs tests now assert the single developer CTA and the new
native documentation links, rather than a duplicate CTA in the deleted section.

Iteration caught a 320px Portuguese height overflow, cross-module mascot sizing
specificity and a live reduced-motion assertion that ran before React cleanup.
Layout/CSS fixes preserve the original height budget. The media-change test now
waits for the existing `data-alive="still"` state and still requires zero
animations. No retries, skipped failures, relaxed budgets or security gate
changes were introduced.

Coverage is local Chromium browser evidence, not public financial execution or
cross-browser certification. No new dependency, real transaction, new PR,
force-push or PR merge was performed.
