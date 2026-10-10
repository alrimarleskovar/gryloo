# BUILD-EXECUTION-CONTINUITY-001 plan

Baseline: `7841d5657ec9a816140a180081178e2abbc27246` on
`codex/build-execution-continuity-001`, repository `alrimarleskovar/gryloo`.

## Scope and proof

1. Reproduce false Review invalidation before changing production code, using the
   existing hook and wallet/browser harnesses.
2. Trace shared wallet synchronization, Review binding, explicit continuation,
   durable attempts and recovery. Treat production observations supplied by the
   owner as evidence to explain, not as a claim of a live reproduction.
3. Bind Review to semantic wallet authority. Passive reads and duplicate events
   preserve authority; genuine provider/account/chain transitions and explicit
   disconnect advance a monotonic epoch even when React batches a round trip.
4. Preserve exact workflow, Manifest, policy, restoration and expiry guards.
   Continuation starts only the next unattempted request after explicit owner
   action. Unknown submission stays in recovery; reload recovers the existing run.
5. Prove Base Sepolia approval → swap, router/testnet approval → bridge deposit,
   and an existing Aave multi-request path using loopback synthetic fixtures.
6. Run focused tests, relevant browser and recovery suites, governance, then
   the constituent `pnpm check` gates (typecheck, lint, build, schema drift and
   tests). Run PostgreSQL tests if shared runtime behavior changes.
7. Inspect latest `origin/main`, integrate safely if needed, verify scope, document
   all gates and prepare one non-draft PR. Do not merge.

## Authority invariants

- Same provider object, normalized account and normalized chain preserve Review
  across `eth_accounts`, `eth_chainId`, duplicate wallet events and transaction
  completion synchronization.
- Account, chain or provider transitions retire old authority irreversibly.
  A → B → A and disconnect → same-address reconnect cannot revive it.
- Workflow edits/restoration, changed Manifest/policy and expiration retain their
  existing invalidation behavior.
- Wallet event/race counters protect asynchronous reads independently of the
  semantic authority epoch.
- Every financial transaction requires an explicit owner action and wallet
  confirmation. No duplicate or automatic second transaction is introduced.

## Constraints

No public-chain submission, real-money/mainnet transaction, production environment
change, dependency addition, unrelated PR/worktree change, or
BUILD-CANVAS-AUTOMATION-UX-002 work. Preserve the Automations, Canvas, Copilot and
`/approve` visual journeys. Historical build reports remain untouched.
