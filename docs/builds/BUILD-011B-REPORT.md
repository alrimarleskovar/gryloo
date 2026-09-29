# BUILD-011B local implementation report — editor stabilization

Prepared under DEC-0051 from merged BUILD-011 main `502d167212cdff80ad4c6740ed8bde47eace1c31`. This branch is unmerged; owner approval is required for merge.

## Delivered

- Drag positions remain live in React Flow and persist to separate canvas layout storage at drag end. Semantic revision and artifact validity remain unchanged by movement.
- Mock action connections keep edge, dependency, and target output reference in sync. Protected financial/composition connections remain guarded.
- Top toolbar and floating toolbox modes use action icons and an optional presentation-only browser preference. Technical workflow details leave the default Build workspace; Review retains a collapsed JSON disclosure. Copilot no longer labels itself Demo assistant; global Demo mode labels remain.
- Existing selected-action inspection, keyboard/input/IME guards, wallet, provider, and evidence boundaries remain in force.

## Verification

- `pnpm check` passed with pinned Node 24.21.0 and pnpm 11.22.0: 13/13 typecheck tasks, lint, 7/7 build tasks, 11 schema exports, 452 unit tests passed and 2 environment-gated skips.
- Both governance programs passed. The exact-scope program froze BUILD-011 at `502d167212cdff80ad4c6740ed8bde47eace1c31` and accepted only the BUILD-011B path set and exact toolbox storage calls. Persistent controls scanned 467 text files, 446 authored files, 65 Markdown files, 29 protected digests, 51 decision IDs and 129 requirement IDs.
- Default guarded browser profile: 42 passed, 4 environment-gated Mode B skips. It covered BUILD-009 wallet, BUILD-010 Across, canvas and keyboard acceptance, artifact integrity, network isolation and visual baselines.
- Isolated Mode A browser profile: 13/13 passed. CoW loopback browser profile: 9/9 passed. BUILD-007 composition fork tests: 3/3 passed; composition browser profile: 3/3 passed with digest-pinned fixture inputs.
- Anvil compatibility: 4 passed, 10 owner-environment skips. General fork suite: 31 passed, 29 gated skips. Five-pass offline rehearsal, frozen Mode A/liquidity/composition transcript validation, screenshot-diff self-test, and dependency audit passed.
- Registry integrity, release age and license verification passed for 247 dependencies and 16 reviewed exceptions. The ephemeral CycloneDX 1.6 SBOM passed the CI validator for 247 exact components and was removed. `git diff --check` passed.
- The standalone live LI.FI browser journey and owner-only/local fixture profiles outside the default repository CI batch were not run; this change adds no live provider authority. Remote PR-head CI is tracked separately after push.

No certification or merge is asserted here. Owner approval is required for merge.
