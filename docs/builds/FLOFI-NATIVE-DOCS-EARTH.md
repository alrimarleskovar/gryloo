# FloFi native Docs and planetary surface motion

2026-10-09 · `codex/build-brand-ux-001` · existing [PR #73](https://github.com/alrimarleskovar/gryloo/pull/73). Do not merge.

## Native documentation

The Next.js app now owns `/docs`. Its server-rendered home and articles use official FloFi assets, Outfit / IBM Plex Mono, and the existing blue/navy palette. The isolated docs shell provides grouped desktop navigation, a mobile modal, breadcrumbs, desktop table of contents, compact mobile article contents, working section anchors, previous/next links, tutorials, callouts, tables, highlighted code and exact-source clipboard copying.

Full-text search indexes article titles, headings, prose, tables and code locally. It needs no external service or account. Ctrl/Cmd+K opens the native dialog; arrows and Enter navigate results; Escape closes it. Dialog focus stays contained and returns to its trigger. Themes initially follow the system preference and persist an explicit selection separately from product settings. Reading areas have no animation. Keyboard, landmarks, body/link contrast and reduced motion are covered by browser checks.

Article content is editorially summarized from verified repository documentation, contracts and SDK implementation. Every article links its primary sources. The API's ten public endpoints match `docs/developer/API.md`; the downloadable `/docs/api-reference.json` is checked for exact JSON equality with the repository OpenAPI contract. Developer integration is explicitly operator-enabled, server-side and sandbox-only, with controlled/MOCKED evidence. The SDK remains a private workspace package. MCP live consumer acceptance is not claimed. Tempo remains upcoming. No endpoint, financial authority or network integration was added.

Routes:

- `/docs`
- `/docs/getting-started`
- `/docs/your-first-workflow`
- `/docs/chat-visual-builder`
- `/docs/supported-networks`
- `/docs/simulation`
- `/docs/strategy-manifest`
- `/docs/wallet-authorization`
- `/docs/execution-verification`
- `/docs/developer-api`
- `/docs/typescript-sdk`
- `/docs/mcp-integrations`
- `/docs/security`
- `/docs/architecture`

Landing header/footer Docs links now open `/docs`. Both developer integration CTAs open `/docs/developer-api`. Launch FloFi and existing Open Builder CTAs retain `/app`. Source code and primary-source links are secondary links to GitHub. The redesigned root README is unchanged; all its local links were checked and remain valid. No canonical production docs origin has been confirmed, so no preview URL was added to the README.

## Earth root cause and implementation

The original 1672×941 PNG is flattened cinematic artwork, not a spherical texture. The previous ±0.7% / 48-second drift was too slight, and its CSS animation declaration was conditional on `NEXT_PUBLIC_FLOFI_MASCOT_MOTION=true`. Its visibility observer did work, but the feature flag could leave no Earth animation to activate.

`earth-atmosphere.tsx` now uses a single responsive SVG coordinate space with the **unchanged original image** as its stationary background. A feathered mask follows the existing curved horizon and confines two additional passes of that same artwork to the terrain. Each statically overscanned image preserves aspect ratio and travels from (-125, 42) to (125, -42) SVG units over 60 seconds. The second pass is offset by 30 seconds. Opacity fades each pass out before its reset; both move in the same direction, so there is no visible rectangular spin or positional snap-back. Screen blending reveals the original surface detail, with separate restrained lighting and atmosphere changes. The original illuminated rim, sky, contrast overlay and content remain stationary.

This represents **apparent planetary surface rotation and relighting**, not genuine 3D spherical rotation. No unrelated globe, generated replacement, new texture download, WebGL, canvas, animation library or animated blur was introduced. Motion uses CSS transforms and opacity. Shared SVG geometry maintains masking through responsive changes; smaller mobile rendering reduces physical travel naturally. Overscan covers the full translated range without exposing image boundaries.

Earth motion runs by default under `prefers-reduced-motion: no-preference`, independently of the mascot flag. The observer and `visibilitychange` handler pause CSS animation when the bottom section is offscreen or the tab is hidden, retaining the animation clock on resume. Reduced motion shows the original still artwork. There is no Play/Pause control. Mascot implementation and infrastructure diagrams are unchanged.

## Validation and evidence

Browser evidence is in [native-docs-earth](../../apps/reference-dapp/e2e/visual-evidence/native-docs-earth/):

- `docs-home-{light,dark}-{390,768,1440}.png`
- `docs-api-{light,dark}-{390,768,1440}.png`
- `earth-{1440,390}-t0.png`, `-t5.png`, `-t10.png`
- `earth-{1440,390}-reduced.png`

These are actual Chromium captures, not mocked component renders or forced animation poses. Earth captures wait on the running animation clock at five and ten seconds after the initial capture. Production evidence is captured with the mascot flag **disabled**. Screenshots were opened and inspected at the requested widths; the mask was refined after comparison exposed weak mobile terrain detail. Surface transform changes exceed 40 SVG units over ten seconds; its matrix retains identity scale/rotation. The stationary original image has no animation. Offscreen pause/resume, tab-visibility handling, live reduced-motion changes, no overflow and no Pause control are checked.

Passing local checks:

- **11 distinct production Docs/Earth cases** across focused runs: direct navigation to home and all 13 articles, source-file and native-link/anchor validity, 404 behavior, exact OpenAPI download, search, copying, keyboard navigation, themes, contrast, responsive layouts and Earth timing/visibility. No browser errors or hydration warnings in the passing checks.
- **8/8 existing guarded production landing/product-entry regressions** at 320, 375, 390, 430, 768, 1024 and 1440px, plus the desktop scroll story. Existing network isolation and disabled illustrative authorization assertions remain.
- **7 distinct flag-enabled motion/diagram regressions** across focused runs: mascot pointer and workflow reactions, PT/reduced motion, both diagrams at 390/768/1440px, measured geometry through resizes/transforms, and Earth motion. A DOM-mutation test was synchronized with the diagram's hydration/measurement readiness; its geometry and console assertions were retained.
- Supported app TypeScript check, affected ESLint, isolated production build with TypeScript checks enabled, governance-lite, and all **19 governance self-tests** pass.
- README local link check and `git diff --check` pass.

Iteration failures were corrected: duplicate HTTP-method table keys, accessible search trigger naming, Escape behavior inside a search input, waiting for theme/hydration readiness, and testing the actual flag-off DOM (which omits mascot attributes). An early isolated build found duplicate generated route globals; the isolated preview now uses its own TypeScript configuration with identical inherited checks and excludes only other generated build directories. No error suppression or release-gate bypass was added.

The PR's earlier contracts/app workflow had a failing guarded-browser step before this change; that unrelated full suite was not rerun during this visual/docs task. Fresh remote CI remains a separate requirement. No merge or new PR was performed.

## Preview and reproduction

- Current isolated production preview: **http://127.0.0.1:3004/docs**
- Bottom Earth: **http://127.0.0.1:3004/#about** (mascot flag disabled)
- Existing development preview: **http://127.0.0.1:3001/docs** (mascot enabled; Fast Refresh)

Existing owner's servers were left running. `FLOFI_DOCS_PREVIEW=true` selects `.next-docs` and a dedicated preview TypeScript config; normal production output/configuration remains unchanged.

```bash
FLOFI_DOCS_PREVIEW=true NEXT_PUBLIC_FLOFI_MASCOT_MOTION=false \
  pnpm --filter @defi-workflow-engine/reference-dapp build
FLOFI_DOCS_PREVIEW=true NEXT_PUBLIC_FLOFI_MASCOT_MOTION=false \
  pnpm --filter @defi-workflow-engine/reference-dapp start --port 3004
FLOFI_DOCS_TEST_ORIGIN=http://127.0.0.1:3004 FLOFI_MOTION_EXPECT_ENABLED=false \
  FLOFI_DOCS_EVIDENCE=1 BUILD002_BROWSER_CACHE=/home/asus/.cache/ms-playwright/chromium_headless_shell-1243 \
  pnpm --filter @defi-workflow-engine/reference-dapp exec playwright test --config playwright.docs.config.ts
```

Limitations: docs are currently English; search is a compact local index with up to nine results, not a hosted search service. Editorial summaries require maintenance as contracts evolve, with linked primary records retained. Browser validation used Chromium; it is not an independent accessibility audit or cross-browser certification. The Earth effect intentionally remains an approximation using the supplied flat artwork. Wallet, execution, authorization, evidence and other application functionality were not changed.
