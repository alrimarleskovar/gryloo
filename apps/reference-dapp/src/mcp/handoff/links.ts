// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: wallet links (`mcp_wallet_links`). A link lets a pseudonymous FloFi account read — through MCP, with the
 * `flofi.runs` scope — the runs of a wallet whose owner proved control of it on FloFi and explicitly agreed, in a browser that also
 * holds that account. It is revocable, expires (30 days), tenant-scoped and capped. A link is never ownership and never financial
 * authority: it only widens what `get_execution_status` and `get_evidence` may show. A wallet address or an execution id alone
 * grants nothing.
 */
import type { Database, Row } from '@defi-workflow-engine/cloud-runtime';
import { newId } from '../oauth/crypto.ts';
import type { WalletRef } from './store.ts';

export const LINK_DAYS = 30;
export const MAX_ACTIVE_LINKS = 16;
export type WalletLink = { readonly linkId: string; readonly namespace: WalletRef['namespace']; readonly address: string; readonly createdAt: Date; readonly expiresAt: Date };
export interface WalletLinkStore {
  /** Creates (or renews) the account's link to a wallet proven in this request. */
  readonly link: (accountId: string, wallet: WalletRef, now: Date) => Promise<{ readonly ok: true; readonly link: WalletLink } | { readonly ok: false; readonly code: 'MCP_WALLET_LINK_LIMIT' }>;
  readonly active: (accountId: string, now: Date) => Promise<readonly WalletLink[]>;
  readonly revoke: (accountId: string, linkId: string, now: Date) => Promise<boolean>;
}
const linkOf = (row: Row): WalletLink => ({ linkId: String(row.link_id), namespace: row.namespace as WalletRef['namespace'], address: String(row.address),
  createdAt: row.created_at as Date, expiresAt: row.expires_at as Date });

export function createPgWalletLinkStore(db: Database, tenantId: string): WalletLinkStore {
  return {
    link: (accountId, wallet, now) => db.transaction(async tx => {
      await tx.query('SELECT 1 FROM mcp_accounts WHERE tenant_id = $1 AND account_id = $2 FOR UPDATE', [tenantId, accountId]);
      await tx.query(`UPDATE mcp_wallet_links SET revoked_at = $5 WHERE tenant_id = $1 AND account_id = $2 AND namespace = $3 AND address = $4 AND revoked_at IS NULL`,
        [tenantId, accountId, wallet.namespace, wallet.address, now]);
      const count = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM mcp_wallet_links WHERE tenant_id = $1 AND account_id = $2 AND revoked_at IS NULL AND expires_at > $3`,
        [tenantId, accountId, now])).rows[0]!.n;
      if (count >= MAX_ACTIVE_LINKS) return { ok: false, code: 'MCP_WALLET_LINK_LIMIT' } as const;
      const expiresAt = new Date(now.getTime() + LINK_DAYS * 86_400_000), linkId = newId('wlk');
      await tx.query(`INSERT INTO mcp_wallet_links (tenant_id, link_id, account_id, namespace, address, proof, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [tenantId, linkId, accountId, wallet.namespace, wallet.address, wallet.namespace === 'solana' ? 'SIWS' : 'EIP4361', now, expiresAt]);
      return { ok: true, link: { linkId, namespace: wallet.namespace, address: wallet.address, createdAt: now, expiresAt } } as const;
    }),
    async active(accountId, now) {
      return (await db.query(`SELECT link_id, namespace, address, created_at, expires_at FROM mcp_wallet_links WHERE tenant_id = $1 AND account_id = $2 AND revoked_at IS NULL
        AND expires_at > $3 ORDER BY created_at DESC`, [tenantId, accountId, now])).rows.map(linkOf);
    },
    async revoke(accountId, linkId, now) {
      return (await db.query(`UPDATE mcp_wallet_links SET revoked_at = $4 WHERE tenant_id = $1 AND account_id = $2 AND link_id = $3 AND revoked_at IS NULL`,
        [tenantId, accountId, linkId, now])).rowCount === 1;
    },
  };
}
