# FloFi — complete cinematic closing restoration

Branch: `codex/build-brand-ux-001` · existing PR #73 · 2026-10-09.

## Restored composition

Recovered `VisionVisual` and the complete closing-section markup from `4489194`
(the parent of the landing simplification, `a668fc1`). The final order is
Build / Review / Execute → Supported Networks → For Builders → The Road Ahead
→ footer.

The closing section restores the original eyebrow, two-part headline with its
explicit line break, Outfit typography and original responsive sizes, white and
lavender hierarchy, description, supporting text, and both CTAs. The description
uses the owner's exact `wallets, dapps and intelligent agents` wording, with the
corresponding PT copy. Launch FloFi opens `/app`; Build with FloFi opens the native
`/docs/developer-api` page.

The restored dark diagram uses the existing corrected `ConnectedFlow` engine,
not historical disconnected SVG paths. Agent, Wallet and App converge at one
junction and reach the FloFi core's input port. The official FloFi symbol,
Execution layer label, output port and Onchain finance destination are restored.
The original white mascot dock uses the existing journey controller and assets.

The original `closing-horizon-v2.png`, feathered surface mask,
60-second overlapping travelling passes, half-cycle offset, atmospheric lighting,
visibility pausing and reduced-motion behavior from `b67adaf` remain intact.
The backdrop lives in the closing section; the compact navy footer follows it.
Stacked layouts use a fixed gradient transition so longer content cannot place
lavender text over a pale background. A bottom fade blends the artwork into the
footer. Neither adjustment changes Earth animation keyframes. A passive scroll listener
pauses only the Earth layers during native scrolling and resumes the same clock
180ms after the last scroll event. The unchanged static artwork stays visible;
travelling overlays stop painting while paused. This avoids expensive masked painting while
scroll input is active, without intercepting input or changing scroll position.

The three approved main sections, Docs implementation, product/mobile UX,
README, dependencies, and mascot animation implementation are unchanged.
No scroll interception or Pause Motion control was added.

## Validation

- Production Chromium: 50 focused landing, mascot, diagram, workflow, and Earth
  cases passed. EN/PT layout checks also cover 320, 375, 430, 900, 901 and 1024px.
- Both diagrams connect every exterior port within 1px, have the expected
  junction degrees, and avoid card interiors. Live resize, altered card sizes,
  ancestor scale/translation, and reduced motion pass.
- Closing screenshots and checks cover **390, 768, 1440 and 1920px**, both locales,
  reduced motion, two cycle-reset boundaries and real elapsed movement at 0/5/10s.
  The fixed artwork does not rotate; surface transforms retain identity scale and
  rotation. No missing images, console errors, hydration failures, text overflow,
  horizontal page overflow, or blocked CTA hit targets were observed.
- Both closing CTAs were clicked at 390/1440px and opened their actual product and
  developer API pages. Native wheel input moves the page through the closing
  scene; the footer is below the full content.
- Eight existing guarded landing/product-entry checks passed. All 15 distinct
  native Docs and Docs mascot cases passed; the landing navigation assertion was
  updated to validate both Build with FloFi links.
- Final footer fade and scroll pause: focused landing/Earth checks and
  screenshots refreshed. Sustained native wheel input verifies pause and resume.
- Repository TypeScript: 16 tasks passed. ESLint and production app build passed.
  Governance-lite and its 19 self-tests passed; whitespace checks passed.

Native scroll-frame measurements from the final Earth run (milliseconds):

| Width | Median | p95 | Maximum |
| --- | --- | --- | --- |
| 390px | 16.7 | 16.8 | 16.8 |
| 768px | 16.7 | 16.8 | 16.8 |
| 1440px | 16.7 | 16.7 | 16.8 |
| 1920px | 16.7 | 16.8 | 33.4 |

These are local headless Chromium measurements, not a guarantee for every device.
The measured surface travel over ten elapsed seconds is 45.1–46.8 SVG units, with
identity scale/rotation and the original 60-second cycle.

Active, stationary-scene frame timing is recorded separately in
`idle-frame-timing.json`:

| Width | Median | p95 | Maximum |
| --- | --- | --- | --- |
| 390px | 16.7 | 16.8 | 16.8 |
| 768px | 33.3 | 33.4 | 33.5 |
| 1440px | 50.0 | 83.3 | 83.4 |
| 1920px | 66.7 | 133.3 | 150.0 |

Chromium's system information reports SwiftShader, software rasterization and
disabled GPU compositing; the host has no `/dev/dxg` hardware GPU device. Full
Chromium also uses software rendering here. Large-viewport active-scene results
therefore do **not** establish 60fps performance on physical desktop devices.
Hardware-GPU smoothness remains a validation limitation. Native scrolling stays
responsive because the travelling overlays pause during scroll input. The fixed
horizon, slow continuous texture travel and invisible cycle resets passed the
rendered-motion checks; the original mask, asset and keyframes were preserved.

## Recovered failure and final validation

The interrupted preview was not running when this session resumed. The latest
18:38 production output was in `.next-docs`; `.next` was an older 16:23 build
without the closing section. The preview must use `FLOFI_DOCS_PREVIEW=true` on
port 3004. HTTP 200 and the actual `#about`/Earth markup were verified before
rerunning the affected Earth test.

The recorded 1920px failure in `/tmp/flofi-closing-final-validation.log` was an
exact animation-clock assertion after requesting a visibility pause: the clock
advanced 33ms while the browser's pause operation was still pending. A twelve-cycle
probe confirmed that `playState === 'paused'` can coincide with `pending === true`.
Once the pause committed, the clock remained exactly fixed in every sample.
The test now waits for all four Earth animations to be paused with no pending
operation before taking its baseline. Exact clock equality, activation, rendered
pixel movement, coverage, resume and reduced-motion assertions remain enforced.
No application workaround or assertion tolerance was introduced for this race.

Current-session checks:

- Earth: **7/7 passed**; `/tmp/flofi-closing-resume-enabled-earth.log`, against
  the final mascot-enabled production build. The prior current-session Earth
  run also passed all seven cases.
- Landing/mascot/connected diagrams/workflow: **43/43 passed**;
  `/tmp/flofi-closing-resume-regressions.log`.
- Guarded landing/product entry: **8/8 passed**;
  `/tmp/flofi-closing-resume-product-ready.log`. Their fixtures require
  `FLOFI_E2E_APP_PORT=3004`; an initial run with the default 3108 origin failed
  with connection refused before loading the app.
- Affected native Docs navigation: **1/1 passed**;
  `/tmp/flofi-closing-resume-docs.log`. Other Docs/mascot cases retain the prior
  passing evidence above; they were not rerun unnecessarily.
- Repository TypeScript: **16/16 tasks passed**; lint and the final changed-test
  lint passed. All **11 schema exports** verified.
- Production build: **9/9 tasks passed**;
  `/tmp/flofi-closing-resume-enabled-build.log`. `FLOFI_DOCS_PREVIEW=true NEXT_PUBLIC_FLOFI_MASCOT_MOTION=true pnpm build --env-mode=loose` passes the
  existing preview-directory and mascot variables through Turbo and builds into
  `.next-docs`, preserving other local server output. The sandbox
  attempt compiled but could not parse its TypeScript subprocess output; the
  unchanged build checks passed outside the sandbox.
- Normal unit gate: **2,965 passed, 2 existing skips**, with 287 passing files;
  `/tmp/flofi-closing-resume-unit-approved.log`. The sandboxed attempt was stopped
  after subprocess failures; the unchanged normal gate passed outside the sandbox.
- Governance-lite and **19/19 self-tests** passed; whitespace passed.

The refreshed EN/PT, normal-motion, reduced-motion and elapsed-time screenshots
were opened for visual inspection. The footer follows the composition, both
CTAs stay reachable, and the connected diagram stacks correctly on mobile.
The approved hero, networks, builders, Docs and product implementations were
preserved.

At the recovered `b67adaf` head, GitHub governance/contracts checks passed.
Vercel reported **“The build exceeded Vercel’s 45-minute limit.”** Its logs stopped
during the optimized Next build without a compilation error. This prior hosting
failure does not establish an Earth application defect. New-head checks must be
read after pushing this correction; PR #73 stays open and unmerged for the
separate merge-monitoring process.

## Evidence

[`cinematic-closing`](../../apps/reference-dapp/e2e/visual-evidence/cinematic-closing/)
contains section captures in EN/PT, Earth timestamps, reduced-motion captures,
cycle-reset captures, footer transitions, full landing captures, and measured
animation, active-scene and scroll-frame data.

Validation uses local Chromium and the isolated production app preview. Pushing
updates the existing PR and triggers its GitHub/Vercel checks. PR #73 stays
unmerged for the existing merge-monitoring process.
