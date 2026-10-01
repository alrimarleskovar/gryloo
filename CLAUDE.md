# Working in Gryloo

The human owner authorizes repository work and decides whether to merge.
Current owner instructions take precedence; [Scope guard](docs/SCOPE_GUARD.md)
describes GOVERNANCE-LITE. Product specifications, ADRs and build plans remain
useful design context. Historical exact-path lists do not authorize future work.

- Work on a named branch, never directly on main. Deliver a PR; never merge it
  or enable automatic merging. Make focused changes and explain the diff.
- Any legitimate repository path may change. No per-build path manifest,
  governance amendment, historical baseline fetch, byte pin or phase is needed.
- Never request, print or commit credentials, private keys or seed phrases.
  Disposable local keys stay in mode-0600 files outside Git under /tmp.
- Preserve dependency integrity, the pinned toolchain, license obligations,
  tests and security gates. Do not delete or skip failing tests to make CI green.
  Explain intentional safety/test changes explicitly for owner review.
- Run focused checks during iteration and relevant browser tests for UI changes;
  run the normal CI gates before delivery. `pnpm check` runs typecheck, lint,
  build, schema drift and unit tests. `python3 scripts/governance_lite.py` and
  its unittest suite check repository safety without history or network access.
- AI proposals are never financial authority. Preserve explicit owner wallet
  authorization, no private key custody, no automatic owner signing, fail-closed
  execution, recovery, reconciliation and honest evidence levels.
- Never autonomously submit real-money transactions or silently execute on
  mainnet. Public execution using owner funds/signatures requires explicit human
  action through the reviewed wallet flow; implementation approval is separate.
- Fork/browser acceptance uses closed replay and loopback traffic. Do not turn
  an offline test into a public provider or financial execution attempt.
- Report meaningful blockers and validation results honestly. Skipped tests are
  not passes; local/mock evidence does not prove public execution or certification.

Toolchain: Node 24.21.0, pnpm 11.22.0, Foundry Anvil 1.8.3, as currently pinned.
