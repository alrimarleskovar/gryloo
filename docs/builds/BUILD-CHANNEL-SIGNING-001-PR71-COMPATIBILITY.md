# PR #71 compatibility — BUILD-CHANNEL-SIGNING-001

Verified through GitHub and Git: [PR #71](https://github.com/alrimarleskovar/gryloo/pull/71) merged at `2026-10-08T22:42:46Z`; its merge commit is `fefda242e4abea5b8be5db57a9b8a09adbd2b65a`. `origin/main` matched that commit at the audit. This existing isolated worktree starts there. No other worktree is changed and no merge is performed.

The shared `src/server/platform-state-host.ts` is reused unchanged. Embedded deployments retain the embedded runtime's database. Remote-flow deployments use its configuration-keyed PostgreSQL pool, shipped-schema verification, tenant provisioning, failed-startup eviction and no fallback. `API_BASE_URL` still selects financial execution independently of platform state.

This build changes only the channel consumer to call that host, closing the remaining embedded-only assumption in channel webhooks, scheduled dispatch, readiness and approval pings. All consumers keep tenant equality and installed-channel-schema checks. MCP and Developer already use the host. No database, migration, parallel store, execution engine, wallet authorization or Manifest schema is introduced.

`channels/runtime.pg.test.ts` runs an actual signature-verified fixture webhook without an injected host under a remote-flow configuration; it asserts shared pool identity, tenant isolation, durable CHANNEL_CONVERSATION handoff creation and fail-closed missing DATABASE_URL. `/approve` uses the same host. The remote financial transport itself is tested separately by #71's retained state-host suite; the new webhook test uses a recording engine seam and claims no live remote execution.

The only shared-store extension is a read-only `forClaimant` query over existing columns of `mcp_handoffs`, scoped to tenant, exact proven wallet namespace/address and APPLIED status. It restores an already applied authoring proposal after an interrupted browser response; it cannot claim, renew a handoff capability, preserve a Review or authorize spending. Existing consumed-session behavior remains intact.

#71's tests that read MCP handoff tokens now read the UI-only `_meta` field explicitly and also assert the model-visible text contains no token. The original host/schema/recovery/tenant assertions remain. This is an intentional output-security change, not a state-host redesign.
