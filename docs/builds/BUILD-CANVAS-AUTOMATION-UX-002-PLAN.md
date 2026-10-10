# BUILD-CANVAS-AUTOMATION-UX-002 plan

Repository: `alrimarleskovar/gryloo`. Branch: `codex/build-canvas-automation-ux-002`.
Baseline: `974a7acad6b117662d986254b9bc9e9be6e2a356` (merged execution continuity build).

## Problem and architecture

The Canvas currently offers simulation while principal Review and continuation
actions live below it. Use the existing shared `projectReview`,
`projectExecution`, `canContinueExecution`, execution lifecycle and recovery
projections to select one Canvas action. Specialized stores retain their
simulation and submission methods and every authority guard. Review remains
visible with Manifest, permissions, limits, wallet/network, warnings and details.

Mapping: no current simulation → Simulate; simulation busy → Simulating;
valid Review → Approve & Continue; accepted Review → Execute workflow;
wallet request → Waiting for wallet; recorded execution → reconciliation/status;
safe next request → existing explicit continuation; uncertain/recovered run →
existing observation-only recovery; completed → result with no financial CTA.
Expiry and semantic changes continue to revoke authority.

Internal `AUTOMATION_RULE` handoffs keep the durable approval record, occurrence,
owner proof, claim policy, exact canonical workflow and hash verification. The
owner's Review in FloFi action enters the normal workspace with a compact
provenance notice. External MCP/developer/channel requesters retain `/approve`
presentation and explicit proof/load semantics.

Extend the existing Copilot V2 interpretation with a typed AutomationDraft.
Ground assets, side, amount, network, time and threshold against the current
request; clarify missing material values. Normalize through existing Automation
validation and capability checks. Show the exact preview in chat; only explicit
Create automation calls existing `createAutomation`. Rejection/dismissal creates
nothing. All stored rules remain `CONFIRM_EACH_TIME` and use the same persistence
and scheduler as workspace authoring. Never infer mainnet or a BTC execution route.

## Sequence and certification

1. Inspect the listed components, stores, handoffs, Automation domain and Copilot.
2. Add focused failing UI/lifecycle and authoring regressions before implementation.
3. Implement shared Canvas projection; run representative swap/router/Aave/Solana
   and Review/Execute/continuity checks.
4. Implement internal entry; prove exact workflow-hash continuity and external
   proposal isolation, including backend owner/claim checks.
5. Implement chat drafts, grounding, preview and explicit confirmation using the
   existing server operation; test EN/PT DCA, both price directions, daily watch,
   clarifications, capability refusal and zero financial requests.
6. Run focused tests after each part, relevant browser/Automations/Copilot suites,
   responsive guards, continuity recovery regressions, PostgreSQL as applicable,
   `pnpm check`, governance and diff checks. Capture local visual evidence.
7. Inspect remote state read-only after takeover; preserve the owner-authoritative
   local branch without pull, rebase or merge. Certify the final tree, document
   results and limitations, then push and create one non-draft PR. Do not merge.

## Boundaries

No production environment change, public-chain transaction, autonomous financial
execution, key custody, dependency addition or weakening of Review, Manifest,
wallet-signature, recovery, reconciliation or execution authority. Browser and
wallet acceptance uses isolated synthetic/local fixtures. Historical reports
remain untouched. PR title:
`BUILD-CANVAS-AUTOMATION-UX-002: unify Canvas lifecycle and Automation authoring`.

## Additional owner-approved authoring scope

Inventory every Advanced action setup form against Canvas parity. Remove the
entire normal-product compatibility area (no replacement disclosure). Preserve
canonical domain/runtime/recovery/evidence implementations. Supply, Borrow,
Repay, Withdraw, swaps, Router, liquidity and lending composition already use
Canvas authoring; audit exact networks/providers. Native self-transfer on
Robinhood Testnet/Ethereum Sepolia requires Canvas/inspector parity first.
Legacy/mock-only compositions remain engineering capabilities, not product
claims. Update product browser authoring to Canvas and record the parity matrix
in the report.

## Additional owner-approved Simulate cleanup

Normal Simulate uses the Canvas and result summary with concise human-readable
Review details in the summary. Remove normal-product raw Manifest JSON, duplicate
Review workspace, artifact/mock generation, Base observation panels and local
rehearsal diagnostics. Preserve all stores, artifact generation/binding,
observation implementations and dedicated test harnesses. Add regressions for
surface absence and continued availability of authorization limits.

## Closure certification — 2026-10-10

All five approved product goals are complete in the preserved worktree. Closing
changes were limited to demonstrated stale browser expectations, required
snapshot updates and documentation. No new feature or unrelated UX redesign
was added.

Current certification: `pnpm check` (3091 passed, two existing skips), PostgreSQL
(302 passed), 23 guarded product profiles (200 cases), external approval (41
cases), scoped Canvas/layout/parity (62 cases), composition browser (one case)
and closed composition compiler/executor/reconciler (three cases). Anvil passed
four cases with ten existing opt-in skips; offline fork checks passed 31 cases
with 29 existing opt-in skips. The five-process F1 rehearsal, dependency/audit,
SBOM, transcript/export checks, governance and repository gates passed. Exact
reruns certify corrected cases without redundantly repeating unchanged green
profiles. The report records the fixture audit and unrelated optional baseline
styling/history limitations, which are not counted as passes.

The review inventory contains 145 source/document files, including ten audited
screenshots. The pre-existing generated Python cache stays local and is excluded
from the commit. Delivery follows the authorized single BUILD-002 commit,
branch push and one non-draft PR; owner review retains all merge authority.
