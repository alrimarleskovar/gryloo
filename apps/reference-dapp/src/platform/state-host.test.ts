// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { developerEnv, ORIGIN } from '../developer/developer.test-harness.ts';
import { handleDeveloperRequest } from '../developer/http.ts';
import { oauthEnv } from '../mcp/oauth/oauth-test-harness.ts';
import { mcpStateHost } from '../mcp/oauth/runtime.ts';
import { handleOAuthRequest } from '../mcp/oauth/server.ts';
import { approvalSurface } from '../server/approval-surface.ts';
import { createEmbeddedRuntime, flowRuntimeKind } from '../server/flow-runtime.ts';
import { serverlessPostgresConfig } from '../server/postgres-config.ts';
import { platformStateHost } from '../server/platform-state-host.ts';

const REMOTE = { API_BASE_URL: 'https://api.example', API_AUTH_TOKEN: 'platform state test token '.padEnd(48, '.') };
describe('BUILD-PLATFORM-STATE-001 fail-closed configuration', () => {
  it('keeps flows remote and returns the existing public store errors without PostgreSQL', async () => {
    expect(flowRuntimeKind(REMOTE)).toBe('remote');
    await expect(platformStateHost(REMOTE)).rejects.toThrow('DATABASE_URL_REQUIRED');
    const developer = await handleDeveloperRequest(new Request(ORIGIN + '/api/developer/v1/capabilities', {
      headers: { authorization: `Bearer flofi_sk_test_${'a'.repeat(43)}` },
    }), { env: developerEnv(REMOTE) });
    expect(developer.status).toBe(503);
    expect(await developer.json()).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE', reason: 'DEVELOPER_STORE_UNAVAILABLE' } });
    await expect(mcpStateHost(REMOTE)).rejects.toThrow('MCP_OAUTH_STORE_UNAVAILABLE');
    const oauth = await handleOAuthRequest('token', new Request(ORIGIN + '/oauth/token', { method: 'POST', body: 'grant_type=x',
      headers: { 'content-type': 'application/x-www-form-urlencoded' } }), { env: oauthEnv(REMOTE) });
    expect([oauth.status, await oauth.json()]).toEqual([503, { error: 'temporarily_unavailable', code: 'MCP_OAUTH_STORE_UNAVAILABLE' }]);
    await expect(approvalSurface(developerEnv(REMOTE), () => undefined)).rejects.toThrow('APPROVAL_STORE_UNAVAILABLE');
  });

  it.each(['', 'mysql://db/state', 'postgres://', 'postgres://db/state#fragment', 'not a URL'])('rejects an invalid database URL (%s) on both paths', async databaseUrl => {
    const env = { DATABASE_URL: databaseUrl };
    await expect(platformStateHost({ ...REMOTE, ...env })).rejects.toThrow('DATABASE_URL_REQUIRED');
    await expect(createEmbeddedRuntime({ ...env, FLOFI_RUNTIME: 'embedded' })).rejects.toThrow('DATABASE_URL_REQUIRED');
  });

  it.each(['0', '21', '-1', '1.5', 'NaN', 'Infinity'])('rejects an invalid pool limit (%s) consistently', async max => {
    const env = { DATABASE_URL: 'postgres://db/state', DATABASE_POOL_MAX: max };
    await expect(platformStateHost({ ...REMOTE, ...env })).rejects.toThrow('DATABASE_POOL_MAX_INVALID');
    await expect(createEmbeddedRuntime({ ...env, FLOFI_RUNTIME: 'embedded' })).rejects.toThrow('DATABASE_POOL_MAX_INVALID');
  });

  it('shares the serverless pool bounds/default and validates deployment identity before opening a pool', async () => {
    for (const value of [undefined, '', '1', '20']) {
      const config = serverlessPostgresConfig({ DATABASE_URL: 'postgresql://db/state', DATABASE_POOL_MAX: value });
      expect(config.maxConnections).toBe(value ? Number(value) : 3);
    }
    await expect(platformStateHost({ ...REMOTE, DATABASE_URL: 'postgres://db/state', TENANT_ID: 'Invalid Tenant' })).rejects.toThrow('TENANT_ID_INVALID');
    await expect(platformStateHost({ ...REMOTE, DATABASE_URL: 'postgres://db/state', VERCEL_ENV: 'preview' })).rejects.toThrow('PREVIEW_BRANCH_UNKNOWN');
  });
});
