// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001 browser suite: database reads that see only what one spec created. The suite shares its database with the MCP and
 * Developer journeys, the other channel's spec and (when FLOFI_E2E_DATABASE_URL is reused) earlier runs, so a spec never reads "the
 * latest" or "the only" handoff: it resolves its own from the approval link it received, by the same keyed digest the server stores
 * (the secret itself is never stored or queried), or from the rows it can prove are new.
 */
import { createDatabase } from '@defi-workflow-engine/cloud-runtime';
import { approvalSecretDigest } from '../src/platform/approval-links.ts';
import { channelApprovalScheme } from '../src/channels/core/approval.ts';
import { channelKeys } from '../src/channels/core/crypto.ts';

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const db = createDatabase({ connectionString: process.env.FLOFI_E2E_DATABASE_URL!, maxConnections: 1 });
  try { return (await db.query(sql, params)).rows as T[]; } finally { await db.close(); }
}
export type ChannelHandoff = { readonly handoff_id: string; readonly requester_kind: string; readonly requester_ref: string; readonly account_id: string | null;
  readonly grant_id: string | null; readonly client_name: string; readonly status: string; readonly share_status: boolean };
const HANDOFF = 'SELECT handoff_id, requester_kind, requester_ref, account_id, grant_id, client_name, status, share_status FROM mcp_handoffs';

/** Every handoff id present now: a spec's own handoffs are the ones missing from this snapshot. */
export const handoffIds = async (): Promise<string[]> => (await query<{ handoff_id: string }>('SELECT handoff_id FROM mcp_handoffs')).map(r => r.handoff_id);
/** The handoffs created since `before` for one channel client, oldest first. */
export const newHandoffs = (clientName: string, before: readonly string[]) =>
  query<ChannelHandoff>(`${HANDOFF} WHERE client_name = $1 AND NOT (handoff_id = ANY($2::text[])) ORDER BY created_at, handoff_id`, [clientName, before]);
/** The one handoff an approval link (`…/approve#flofi_chs_…`) belongs to. */
export async function handoffOfLink(url: string): Promise<ChannelHandoff> {
  const secret = new URL(url).hash.slice(1), key = process.env.FLOFI_E2E_CHANNEL_SECRET;
  if (!key) throw new Error('CHANNEL_E2E_SECRETS_MISSING');
  const rows = await query<ChannelHandoff>(`${HANDOFF} WHERE secret_digest = $1`, [approvalSecretDigest(channelApprovalScheme(channelKeys(key)), secret)]);
  if (rows.length !== 1) throw new Error(`CHANNEL_E2E_LINK_HANDOFF_${rows.length}`);
  return rows[0]!;
}
