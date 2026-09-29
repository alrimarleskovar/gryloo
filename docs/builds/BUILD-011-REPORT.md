# BUILD-011 local implementation report — canvas and product UX

Prepared from merged BUILD-010 main `5d169748e6a44e3fb63e371a18ace2e0814d5f04` under DEC-0050. The branch remains unmerged and uncertified. The owner retains the merge decision.

## Delivered

- The Build canvas supports selection and continuous direct node dragging. Positions are browser layout metadata keyed by workflow ID, node ID and action type. Dragging does not revise the semantic IR or invalidate reviewed artifacts; semantic edits keep matching positions and prune stale ones.
- Delete and Backspace remove eligible selected nodes through `REMOVE` and eligible selected connections through `DISCONNECT`. The reducer updates both resource edges and dependency arrays. Required, locked and dependent steps and typed required connections remain protected with a readable reason. Escape clears selection. Text entry and composition suppress destructive shortcuts.
- A compact toolbox adds a real unquoted Base Swap node through `ADD_SWAP`, and Bridge, Pool, Supply, Lending and Borrow as nonexecuting typed templates through `ADD`. Existing provider-specific bridge, liquidity, CoW and composition authoring remains in the collapsed Advanced action setup disclosure.
- The selected-action inspector edits swap, bridge, pool and template parameters through the shared semantic editor and proposal flow. The left authoring column and prominent workspace build/revision/debug labels are removed. The top bar keeps functional wallet connection, chain context and concise wallet errors.

## Evidence boundary

No provider, chain, signing, financial transport, wallet authority or evidence level was added. Templates have no adapter, required capability or financial execution. Swap remains unquoted until separately reviewed; BUILD-009 and BUILD-010 financial lifecycles remain deterministic MOCKED at their existing boundaries. No testnet/mainnet execution or real-funds claim follows from this UI change.

## Local verification

- `pnpm check` passed: 13/13 typecheck packages, lint, 7/7 builds, 11 schema exports, and 452 passing unit tests (2 environment-gated skips). This includes the focused canvas layout, actions and keyboard tests.
- The default contracts browser batch passed: 37 passed and 4 Mode B environment-gated skips. It includes BUILD-009 wallet/bridge authoring, BUILD-010 Across, canvas acceptance, mock artifact, network isolation and visual snapshot coverage.
- The isolated Mode A browser regression batch passed: 13/13, including wallet authorization, fork execution, reconciliation and durable recovery.
- Both local governance programs passed: historical scope and protected-byte checks; 465 text files scanned for secret indicators, 444 authored files for email/brand/claim rules, 63 Markdown link checks, 29 protected digests, 50 decision IDs and 124 requirement IDs.
- `git diff --check` passed. Visual baselines were refreshed for the changed workspace and reviewed locally.

The standalone BUILD-009 live LI.FI route browser journey was not rerun because it depends on external quote availability. Its bridge editor/service unit coverage and the deterministic BUILD-009 browser regressions passed. The separate Mode B, CoW, liquidity and composition browser profiles remain gated on their opt-in local fixtures. Remote PR-head checks and owner merge remain separate.
