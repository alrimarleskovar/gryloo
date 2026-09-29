# BUILD-011B plan — editor stabilization and toolbox presentation

Approved on 2026-09-29 under DEC-0051 from merged BUILD-011 main `502d167212cdff80ad4c6740ed8bde47eace1c31`. Continue the existing worktree. BUILD-011 is frozen at that merge; this is a separate bounded amendment.

## Acceptance

- Dragging updates React Flow presentation coordinates during movement and commits layout only at drag end. Layout remains keyed by workflow and node, separate from semantic IR. Drag does not change semantic revision or invalidate CURRENT artifacts.
- Connection creation and deletion keep a mock target's `source` output reference, dependency, and resource edge consistent. Existing protected financial and composition connections remain protected.
- Nodes and edges support selection and guarded Delete, Backspace, and Escape. Text entry and IME do not trigger canvas shortcuts. The Selected Action inspector remains usable.
- Users can switch between an iconized top toolbar and floating toolbox. The choice is presentation-only and stored under the single browser key `gryloo:toolbox-mode`; existing canvas layout storage remains separately bounded. Storage failures fall back to top mode.
- Remove Technical workflow details from the default Build workspace and the Demo assistant badge from the Copilot header. Keep the collapsed workflow JSON disclosure in Review and preserve global Demo mode honesty.
- Run focused canvas and browser acceptance, historical regressions, `pnpm check`, governance, contracts/reference-app checks, and `git diff --check`. Commit, push, and open one unmerged PR. Owner decides merge.

## Authority boundary

No financial execution authority, provider or chain integration, evidence level, public transaction, real funds, or next functional build is approved. Existing MOCKED, local-fork, wallet, provider, and read-only boundaries remain in force. The toolbox preference cannot enter semantic workflow state or authorization decisions.

## Exact expected files

Create:
docs/builds/BUILD-011B-PLAN.md
docs/builds/BUILD-011B-REPORT.md
Modify:
.github/workflows/governance.yml
apps/reference-dapp/e2e/bridge.spec.ts
apps/reference-dapp/e2e/canvas-ux.spec.ts
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts
apps/reference-dapp/e2e/swap-authoring.spec.ts
apps/reference-dapp/e2e/swap-authoring.spec.ts-snapshots/proposal-chromium-linux.png
apps/reference-dapp/e2e/swap-authoring.spec.ts-snapshots/review-blocked-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/build-chromium-linux.png
apps/reference-dapp/src/app/globals.css
apps/reference-dapp/src/components/artifact-inspector.tsx
apps/reference-dapp/src/components/copilot-panel.tsx
apps/reference-dapp/src/components/review-panel.tsx
apps/reference-dapp/src/components/workflow-canvas.tsx
apps/reference-dapp/src/domain/canvas-keyboard.test.ts
apps/reference-dapp/src/domain/canvas-layout.test.ts
apps/reference-dapp/src/domain/canvas-layout.ts
apps/reference-dapp/src/domain/editor.test.ts
apps/reference-dapp/src/domain/editor.ts
docs/AUTHORITY_MATRIX.md
docs/DECISIONS.md
docs/NEXT_BUILD.md
docs/REQUIREMENTS.md
docs/SCOPE_GUARD.md
docs/STATUS.md
Delete:
none
