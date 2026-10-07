// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: MCP's part of the shared approval model (`src/platform`):
 *
 *   link scheme   the BUILD-MCP-002 `flofi_hs_` links, digested with the MCP OAuth handoff key, so existing links keep working and they
 *                 resolve MCP-account handoffs only
 *   rules         a 15-minute window, at most 5 open requests per account, 20 requests per hour, and a newer request for the same
 *                 workflow supersedes the older one
 *   /approve      the MCP handoff policy (FLOFI_MCP_HANDOFF_*), no extra claim rule (any proven wallet of the workflow's namespace), and
 *                 the browser's MCP account cookie, so the creating account's own browser shares run status by default
 *
 * MCP contributes to /approve only while its OAuth server is enabled; the page itself no longer depends on MCP.
 */
import { approvalLinkScheme, HANDOFF_RATE, HANDOFF_SECONDS, MAX_PENDING_HANDOFFS, type ApprovalContributor, type ApprovalLinkScheme, type CookieReader,
  type HandoffRules } from '../platform/index.ts';
import { readHandoffPolicy } from './execution.ts';
import { readOAuthConfig, type OAuthConfig } from './oauth/config.ts';
import { TOKEN_PREFIX, unsealValue } from './oauth/crypto.ts';
import { createPgOAuthStore } from './oauth/pg-store.ts';
import { ACCOUNT_COOKIE } from './oauth/server.ts';
import type { McpOAuthStore } from './oauth/store.ts';

type Env = Readonly<Record<string, string | undefined>>;
export const MCP_HANDOFF_RULES: HandoffRules = Object.freeze({ handoffSeconds: HANDOFF_SECONDS, maxPending: MAX_PENDING_HANDOFFS, rate: HANDOFF_RATE,
  supersedeSameWorkflow: true });
export const mcpApprovalLinkScheme = (config: OAuthConfig): ApprovalLinkScheme => approvalLinkScheme(TOKEN_PREFIX.handoff, config.keys.handoff, ['MCP_ACCOUNT']);

/** The pseudonymous MCP account of this browser (the OAuth consent cookie), if it is still active here. */
async function browserAccount(config: OAuthConfig, oauth: McpOAuthStore, cookie: CookieReader): Promise<string | null> {
  const value = unsealValue<{ a: string; d: string; e: number }>('ma1', cookie(ACCOUNT_COOKIE), config.keys.account, Math.floor(Date.now() / 1000));
  if (!value || value.d !== new URL(config.origin).host || !/^mcpacct_[a-z2-7]{26}$/.test(value.a)) return null;
  return await oauth.accountActive(value.a) ? value.a : null;
}

/** MCP's contribution to /approve, or null while MCP OAuth is not enabled on this deployment. */
export function mcpApprovalContributor(env: Env): ApprovalContributor | null {
  const config = readOAuthConfig(env);
  if (!config.enabled) return null;
  return (host, cookie) => {
    const oauth = createPgOAuthStore(host.db, host.tenantId);
    return { scheme: mcpApprovalLinkScheme(config), profiles: { MCP_ACCOUNT: { policy: readHandoffPolicy(env),
      viewerRequester: async () => { const account = await browserAccount(config, oauth, cookie); return account ? { kind: 'MCP_ACCOUNT', ref: account } : null; } } } };
  };
}
