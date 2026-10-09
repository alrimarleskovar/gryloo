// SPDX-License-Identifier: AGPL-3.0-only
/** PR #71 compatibility: actual webhook handler uses its shared durable host with remote financial flows. Provider is a fixture. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';
import { platformStateHost } from '../server/platform-state-host.ts';
import { approvalSurface } from '../server/approval-surface.ts';
import { readChannelDeployment } from './registry.ts';
import { channelHost, channelRuntime } from './runtime.ts';
import { recordingRuntime } from './core/engine.test-harness.ts';
import { handleWhatsAppWebhook } from './whatsapp/handler.ts';
import { fixtureTransport, type FixtureRecord } from './whatsapp/transport.ts';
import { inbound, webhookRequest, whatsAppEnv } from './whatsapp/fixtures.test-harness.ts';
import type { Database } from '@defi-workflow-engine/cloud-runtime';

let t: TestDatabase;
const pools = new Set<Database>();
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await Promise.allSettled([...pools].map(db => db.close())); await t?.drop(); });

it('shares PR #71’s pool and tenant across channel requests and /approve, with no injected state host', async () => {
  const { env, appSecret } = whatsAppEnv({ DATABASE_URL: t.url, TENANT_ID: 'channel-signing', API_BASE_URL: 'https://api.example',
    API_AUTH_TOKEN: 'remote fixture token'.padEnd(48, '.') });
  const platform = await platformStateHost(env); pools.add(platform.db);
  const deployment = readChannelDeployment(env); if (!deployment.ok) throw new Error(deployment.code);
  const host = await channelHost(env, deployment.deployment.core); if ('code' in host) throw new Error(host.code);
  expect(host).toBe(platform);
  expect(host.tenantId).toBe('channel-signing');
  expect(channelRuntime(env, deployment.deployment.core, host).platform.runtime.kind).toBe('remote');
  const calls: string[] = [], sent: FixtureRecord[] = [], runtime = recordingRuntime(calls);
  const response = await handleWhatsAppWebhook(webhookRequest(inbound([{ text: 'bridge 1 USDC from Base Sepolia to Arbitrum Sepolia via auto slippage 50 bps' }]), appSecret),
    { env, runtime, transport: fixtureTransport(sent), interpreter: null, logger: null });
  expect(response.status).toBe(200);
  const surface = await approvalSurface(env, () => undefined, { runtime });
  const rows = (await t.db.query('SELECT handoff_id, requester_kind FROM mcp_handoffs WHERE tenant_id = $1', [host.tenantId])).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]!.requester_kind).toBe('CHANNEL_CONVERSATION');
  expect(surface.handoffs).toBeDefined();
  expect(await channelHost(env, { ...deployment.deployment.core, tenantId: 'wrong-tenant' })).toEqual({ code: 'CHANNEL_STORE_UNAVAILABLE' });
  expect(calls).not.toContain('EXECUTION_PATH');
  expect(await channelHost({ ...env, DATABASE_URL: undefined }, deployment.deployment.core)).toEqual({ code: 'CHANNEL_STORE_UNAVAILABLE' });
});
