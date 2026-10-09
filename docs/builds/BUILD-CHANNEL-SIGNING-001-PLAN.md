# BUILD-CHANNEL-SIGNING-001 — focused implementation plan

Baseline: clean `codex/build-channel-signing-001` worktree at `fefda24`, the merge of PR #71. The owner's current instruction supersedes the older request to create a worktree or treat #71 as open. Other listed worktrees will not be changed; no automatic merge.

Audit: GOVERNANCE-LITE, `CLAUDE.md`, the reference DApp's `AGENTS.md` and installed Next.js server-action/security guides were read. Existing MCP, channel, approval, wallet proof, workflow, Manifest and recovery paths are reused. The shared approval store is `mcp_handoffs` in PostgreSQL, including all requester kinds. PR #71's `platformStateHost` is the state host; financial runtime selection stays separate.

Focused changes:

1. Route channel state through the existing platform state host, including remote-flow deployments. Keep tenant/schema checks, pool ownership, migrations and execution architecture unchanged.
2. Remove approval capabilities from model-visible MCP results. Put private signing links in tool-result `_meta`; expose an account-authenticated, nonsecret universal fallback. Reuse existing OAuth account cookies and handoff sessions, never new authorization.
3. Improve the MCP panel's wallet choices, host refusal handling, duplicate-click protection and sanitized status reporting. Keep in-frame signing disabled. Verify wallet browser-link contracts against primary provider documentation; do not add WalletConnect without a demonstrated need.
4. Improve the shared owner page: mobile browser handoff controls, clear proof-versus-transaction wording, one explicit proposal-load action, direct navigation to simulation, cancellation and safe interruption/reload recovery. Every execution still goes through the existing simulation, Manifest Review, owner approval, wallet signature and reconciliation.
5. Add security and PostgreSQL coverage plus guarded browser tests for the four entry surfaces, failure/retry paths, account/wallet isolation, model-context secrecy and status consent. Preserve the existing mainnet and mocked-authority gates.
6. Document flow/threat model, capability/evidence matrix, four owner E2E procedures, #71 compatibility and external dependencies. Run normal CI validations and relevant guarded browser/fork tests; report failures/skips honestly. Commit and open a PR against `main`, without merging.

Acceptance levels: `READY_FOR_OWNER_REVIEW` means implementation and recorded automated checks; `READY_FOR_OWNER_E2E` additionally requires the channel/provider/host deployment prerequisites. Verified completion requires owner-run live host and wallet journeys with reconciled testnet evidence. Loopback fixtures do not establish live compatibility. WhatsApp's existing policy-clearance gate remains in force.
