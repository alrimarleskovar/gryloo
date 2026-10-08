// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the approval surface (`/approve`) this deployment serves — which requester kinds, how their approval links
 * resolve, and the shared handoff store and runtime behind them. Every FloFi surface that hands proposals to their owners registers
 * one contributor below: MCP (while its OAuth server is enabled), the Developer API (while it is enabled) and the conversational
 * channels (BUILD-CHANNELS-001, while a channel is enabled);
 * none adds a second approval page, store, secret format or claim path. With no contributor enabled, /approve answers
 * APPROVALS_NOT_ENABLED; without durable PostgreSQL state it answers APPROVAL_STORE_UNAVAILABLE (never memory, a file or /tmp).
 */
import { channelApprovalContributor } from '../channels/approval-profile.ts';
import { mcpApprovalContributor } from '../mcp/approval-profile.ts';
import { developerApprovalContributor } from '../developer/approval-profile.ts';
import { assembleApprovalSurface, createPgHandoffStore, deploymentEngineRuntime, type ApprovalContributor, type ApprovalHost, type ApprovalSurface, type CookieReader,
  type EngineRuntime } from '../platform/index.ts';
import { platformStateHost } from './platform-state-host.ts';

type Env = Readonly<Record<string, string | undefined>>;
/** The enabled contributors, in registration order. */
export function approvalContributors(env: Env): readonly ApprovalContributor[] {
  return [mcpApprovalContributor(env), developerApprovalContributor(env), channelApprovalContributor(env)].filter((c): c is ApprovalContributor => c !== null);
}
async function approvalHost(env: Env): Promise<ApprovalHost> {
  try { return await platformStateHost(env); }
  catch { throw new Error('APPROVAL_STORE_UNAVAILABLE'); }
}
/** This request's approval surface. `cookie` reads this request's cookies; `options` are test seams (a host and runtime). */
export async function approvalSurface(env: Env, cookie: CookieReader, options: { readonly host?: ApprovalHost; readonly runtime?: EngineRuntime } = {}): Promise<ApprovalSurface> {
  const contributors = approvalContributors(env);
  if (!contributors.length) throw new Error('APPROVALS_NOT_ENABLED');
  const host = options.host ?? await approvalHost(env);
  return assembleApprovalSurface(contributors.map(contribute => contribute(host, cookie)), createPgHandoffStore(host.db, host.tenantId),
    options.runtime ?? deploymentEngineRuntime(env));
}
