// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: migration 0006 upgrades BUILD-MCP-002 handoffs in place. A database holding 0005 handoffs in every state is
 * migrated; every row becomes an MCP-account requester (ref = its account) with an empty context, the BUILD-MCP-002 store forms and
 * the generic ones find the same rows, an MCP-shaped insert that names no requester still works, and the forward-only transitions
 * and immutability rules still hold (now also for the requester columns).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertSchemaCurrent, loadMigrations, migrate, SHIPPED_MIGRATIONS } from '@defi-workflow-engine/cloud-runtime';
import { createTestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';
import { newId } from '../mcp/oauth/crypto.ts';
import { createPgHandoffStore, type WalletRef } from './index.ts';

const PLAN = JSON.stringify({ kind: 'SINGLE_FLOW', flow: 'crosschain-router-testnet', reason: null, steps: [], networks: ['base-sepolia', 'arbitrum-sepolia'],
  networkEnvironment: 'PUBLIC_TESTNET', fundsClass: 'TEST_FUNDS' });
const WALLET: WalletRef = { namespace: 'eip155', address: '0x' + '1'.repeat(40) };

describe('BUILD-DEVELOPER-001 migration 0006 compatibility', () => {
  it('upgrades BUILD-MCP-002 handoffs in place; old and new store forms agree; transitions and immutability still hold', async () => {
    const t = await createTestDatabase({ migrated: false });
    try {
      const all = await loadMigrations();
      expect(all.map(m => m.name)).toEqual(['execution_core', 'swap_attempt_states', 'solana_identities', 'owner_run_history', 'mcp_oauth', 'approval_requesters']);
      await migrate(t.db, all.slice(0, 5));
      const account = newId('mcpacct'), grant = newId('grt');
      await t.db.query(`INSERT INTO mcp_accounts (tenant_id, account_id) VALUES ('default', $1)`, [account]);
      await t.db.query(`INSERT INTO mcp_oauth_grants (tenant_id, grant_id, account_id, client_id, client_name, scopes, resource) VALUES ('default', $1, $2,
        'https://claude.ai/oauth/mcp-oauth-client-metadata', 'Claude', ARRAY['flofi.strategy', 'flofi.approval'], 'https://flofi.test/api/mcp')`, [grant, account]);
      // BUILD-MCP-002 rows, written with the 0005 column set only.
      const insert = (status: string, extra: string, values: string) => {
        const id = newId('apr'), digest = randomBytes(32);
        return t.db.query(`INSERT INTO mcp_handoffs (tenant_id, handoff_id, account_id, grant_id, client_id, client_name, secret_digest, strategy, workflow_hash, engine_version,
          network_environment, funds_class, plan, status, expires_at${extra}) VALUES ('default', $1, $2, $3, 'https://claude.ai/oauth/mcp-oauth-client-metadata', 'Claude', $4,
          '{"action":"bridge"}', $5, 'flofi-engine-2', 'PUBLIC_TESTNET', 'TEST_FUNDS', $6, '${status}', now() + interval '10 minutes'${values})`,
        [id, account, grant, digest, '0x' + '2'.repeat(64), PLAN]).then(() => ({ id, digest, status }));
      };
      const claimedCols = ', claimed_namespace, claimed_address, claimed_at, claim_expires_at', claimedVals = `, 'eip155', '${WALLET.address}', now(), now() + interval '10 minutes'`;
      const rows = [await insert('PENDING', '', ''), await insert('CLAIMED', claimedCols, claimedVals), await insert('APPLIED', claimedCols + ', applied_at', claimedVals + ', now()'),
        await insert('REVOKED', ', ended_at', ', now()'), await insert('EXPIRED', ', ended_at', ', now()')];

      await migrate(t.db, all);
      expect(await assertSchemaCurrent(t.db, SHIPPED_MIGRATIONS)).toBe(6);
      const upgraded = (await t.db.query(`SELECT handoff_id, status, requester_kind, requester_id, requester_ref, requester_context, account_id, grant_id FROM mcp_handoffs
        ORDER BY created_at, handoff_id`)).rows;
      expect(upgraded).toHaveLength(5);
      for (const row of upgraded) expect(row).toMatchObject({ requester_kind: 'MCP_ACCOUNT', requester_id: null, requester_ref: account, requester_context: {}, account_id: account,
        grant_id: grant });

      const store = createPgHandoffStore(t.db, 'default'), scope = { kind: 'MCP_ACCOUNT' as const, ref: account }, now = new Date();
      expect((await store.forAccount(rows[0]!.id, account, now))?.status).toBe('PENDING');
      expect((await store.forRequester(rows[0]!.id, scope, now))?.requesterKind).toBe('MCP_ACCOUNT');
      expect((await store.listForAccount(account, now, 20)).map(h => h.handoffId).sort()).toEqual((await store.listForRequester(scope, now, 20)).map(h => h.handoffId).sort());
      expect((await store.bySecret(rows[1]!.digest, now, ['MCP_ACCOUNT']))?.claimed).toEqual(WALLET);
      expect((await store.claim(rows[0]!.digest, WALLET, now, 600, () => ({ ok: true, share: false }))).handoff?.status).toBe('CLAIMED');
      expect((await store.apply(rows[1]!.digest, WALLET, now)).handoff?.status).toBe('APPLIED');

      const update = (id: string, set: string) => t.db.query(`UPDATE mcp_handoffs SET ${set} WHERE tenant_id = 'default' AND handoff_id = $1`, [id]);
      await expect(update(rows[3]!.id, `status = 'PENDING'`)).rejects.toThrow('MCP_HANDOFF_TERMINAL');
      await expect(update(rows[0]!.id, `requester_context = '{"x":1}'`)).rejects.toThrow('MCP_HANDOFF_IMMUTABLE');
      await expect(update(rows[0]!.id, `requester_kind = 'CHANNEL_CONVERSATION'`)).rejects.toThrow('MCP_HANDOFF_IMMUTABLE');
      await expect(update(rows[2]!.id, `status = 'CLAIMED'`)).rejects.toThrow('MCP_HANDOFF_TRANSITION_INVALID');

      // An MCP-shaped insert that names no requester (as BUILD-MCP-002 writes it) is an MCP-account row.
      const late = await insert('PENDING', '', '');
      expect((await t.db.query(`SELECT requester_kind, requester_ref FROM mcp_handoffs WHERE handoff_id = $1`, [late.id])).rows[0]).toEqual({ requester_kind: 'MCP_ACCOUNT',
        requester_ref: account });
    } finally { await t.drop(); }
  });
});
