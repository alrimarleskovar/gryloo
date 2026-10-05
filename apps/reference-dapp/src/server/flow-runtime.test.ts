// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deploymentEnvironment, deploymentTenant, isHostedDeployment } from './deployment.ts';
import { cloudFlow, cloudFlowMode, cloudRuns, flowRuntimeKind } from './flow-runtime.ts';
import { flowMode } from '../../backend/flows.ts';

const VERCEL_PREVIEW = { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'claude/build-cloud-parity-001' };
afterEach(() => { vi.restoreAllMocks(); });

describe('BUILD-CLOUD-PARITY-001 deployment identity', () => {
  it('recognises hosted deployments and keeps local development and tests local', () => {
    expect(isHostedDeployment({})).toBe(false);
    expect(isHostedDeployment({ NODE_ENV: 'production' })).toBe(false); // `next start` in the browser suites
    for (const env of [{ VERCEL: '1' }, { RAILWAY_PROJECT_ID: 'p' }, { RAILWAY_ENVIRONMENT_ID: 'e' }, { FLOFI_DEPLOYMENT: 'hosted' }]) expect(isHostedDeployment(env)).toBe(true);
    expect(deploymentEnvironment(VERCEL_PREVIEW)).toBe('preview');
    expect(deploymentEnvironment({ VERCEL: '1', VERCEL_ENV: 'production' })).toBe('production');
    expect(deploymentEnvironment({ RAILWAY_PROJECT_ID: 'p' })).toBe('production');
    expect(deploymentEnvironment({})).toBe('local');
  });
  it('gives every Preview branch its own stable tenant and keeps TENANT_ID for production and local', () => {
    const a = deploymentTenant(VERCEL_PREVIEW);
    expect(a).toMatch(/^pv-claude-build-cloud-parity-001-[0-9a-f]{8}$/);
    expect(deploymentTenant({ ...VERCEL_PREVIEW, VERCEL_DEPLOYMENT_ID: 'dpl_other' })).toBe(a);      // a redeploy shares state
    expect(deploymentTenant({ ...VERCEL_PREVIEW, VERCEL_GIT_COMMIT_REF: 'codex/build-product-ux-001' })).not.toBe(a);
    expect(deploymentTenant({ ...VERCEL_PREVIEW, VERCEL_GIT_COMMIT_REF: 'Claude/Build-Cloud-Parity-001' })).not.toBe(a); // the hash keeps case-distinct refs apart
    // A Preview ignores TENANT_ID, so a variable shared with Production can never merge their state.
    expect(deploymentTenant({ ...VERCEL_PREVIEW, TENANT_ID: 'default' })).toBe(a);
    expect(deploymentTenant({ ...VERCEL_PREVIEW, VERCEL_GIT_COMMIT_REF: 'x'.repeat(250) })).toMatch(/^[a-z0-9][a-z0-9_-]{0,62}$/);
    expect(deploymentTenant({ ...VERCEL_PREVIEW, VERCEL_GIT_COMMIT_REF: '///' })).toMatch(/^pv-branch-[0-9a-f]{8}$/);
    expect(() => deploymentTenant({ VERCEL: '1', VERCEL_ENV: 'preview' })).toThrow('PREVIEW_BRANCH_UNKNOWN');
    expect(deploymentTenant({ VERCEL: '1', VERCEL_ENV: 'production' })).toBe('default');
    expect(deploymentTenant({ TENANT_ID: 'acme' })).toBe('acme');
    expect(() => deploymentTenant({ TENANT_ID: 'Bad Tenant' })).toThrow('TENANT_ID_INVALID');
  });
});

describe('BUILD-CLOUD-PARITY-001 flow runtime selection', () => {
  it('selects remote, embedded, local or unconfigured from the environment', () => {
    expect(flowRuntimeKind({})).toBe('local');
    expect(flowRuntimeKind({ GRYLOO_SUPPLY_JOURNAL: '/tmp/x' })).toBe('local');
    expect(flowRuntimeKind({ API_BASE_URL: 'https://api.example' })).toBe('remote');
    expect(flowRuntimeKind({ ...VERCEL_PREVIEW, API_BASE_URL: 'https://api.example', DATABASE_URL: 'postgres://db/x' })).toBe('remote');
    expect(flowRuntimeKind({ ...VERCEL_PREVIEW, DATABASE_URL: 'postgres://db/x' })).toBe('embedded');
    expect(flowRuntimeKind({ FLOFI_RUNTIME: 'embedded', DATABASE_URL: 'postgres://db/x' })).toBe('embedded');
    // Locally a DATABASE_URL alone (e.g. exported for the backend) does not change how the dev server runs.
    expect(flowRuntimeKind({ DATABASE_URL: 'postgres://db/x' })).toBe('local');
    expect(flowRuntimeKind(VERCEL_PREVIEW)).toBe('unconfigured');
    expect(flowRuntimeKind({ VERCEL: '1', GRYLOO_SUPPLY_JOURNAL: '/tmp/journal' })).toBe('unconfigured');
    expect(flowRuntimeKind({ FLOFI_RUNTIME: 'embedded' })).toBe('unconfigured');
  });
  it('a hosted deployment without a runtime fails closed and never reaches a local journal', async () => {
    const env = { ...VERCEL_PREVIEW, GRYLOO_SUPPLY_JOURNAL: '/tmp/journal', GRYLOO_SUPPLY_TESTNET: 'live' };
    expect(await cloudFlow('aave-supply', 'simulate', [{}, '0x' + '1'.repeat(40)], { env })).toEqual({ ok: false, code: 'CLOUD_RUNTIME_NOT_CONFIGURED' });
    expect(await cloudFlowMode('aave-supply', env)).toBe('off');
    expect(await cloudRuns('crosschain-router-testnet', '0x' + '1'.repeat(40), env)).toEqual({ ok: false, code: 'CLOUD_RUNTIME_NOT_CONFIGURED' });
  });
  it('local mode leaves the call to the in-process development service', async () => {
    expect(await cloudFlow('aave-supply', 'status', ['supply-' + '0'.repeat(32)], { env: {} })).toBeNull();
    expect(await cloudFlowMode('aave-supply', {})).toBeNull();
    expect(await cloudRuns('crosschain-router-testnet', '0x' + '1'.repeat(40), {})).toBeNull();
  });
  it('remote mode forwards to the configured API with the server-only token and the verified principal', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ ok: true, value: 'live' }), { status: 200 }));
    const principal = '0x' + 'a'.repeat(40);
    const env = { API_BASE_URL: 'https://api.example', API_AUTH_TOKEN: 't'.repeat(40) };
    expect(await cloudFlow('crosschain-router-testnet', 'info', [], { env, principal })).toEqual({ ok: true, value: 'live' });
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe('https://api.example/v1/flows/crosschain-router-testnet/info');
    expect(init?.headers).toMatchObject({ authorization: `Bearer ${'t'.repeat(40)}`, 'x-flofi-wallet-principal': principal });
    expect(await cloudFlowMode('crosschain-router-testnet', env)).toBe('live');
  });
  it('an embedded runtime with an unusable configuration fails closed with a classified code', async () => {
    expect(await cloudFlow('aave-supply', 'mode', [], { env: { ...VERCEL_PREVIEW, DATABASE_URL: 'mysql://db/x' } })).toEqual({ ok: false, code: 'DATABASE_URL_REQUIRED' });
    expect(await cloudFlow('aave-supply', 'mode', [], { env: { VERCEL: '1', VERCEL_ENV: 'preview', DATABASE_URL: 'postgres://db/x' } }))
      .toEqual({ ok: false, code: 'PREVIEW_BRANCH_UNKNOWN' });
    expect(await cloudFlow('aave-supply', 'mode', [], { env: { ...VERCEL_PREVIEW, DATABASE_URL: 'postgres://db/x', DATABASE_POOL_MAX: '500' } }))
      .toEqual({ ok: false, code: 'DATABASE_POOL_MAX_INVALID' });
    expect(await cloudFlow('aave-supply', 'mode', [], { env: { ...VERCEL_PREVIEW, DATABASE_URL: 'postgres://db/x', EVIDENCE_DIRECTORY: '/tmp/evidence' } }))
      .toEqual({ ok: false, code: 'EVIDENCE_STORE_FILESYSTEM_FORBIDDEN' });
  });
  it('a hosted deployment never points a flow at a loopback MOCKED harness', () => {
    const harness = { GRYLOO_SUPPLY_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_ROUTER_TESTNET_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_SOLANA_DEVNET_HARNESS: 'MOCKED_LOOPBACK_ONLY' };
    expect(flowMode('aave-supply', harness)).toBe('harness');
    for (const hosted of [{ VERCEL: '1' }, { RAILWAY_PROJECT_ID: 'p' }]) {
      expect(flowMode('aave-supply', { ...harness, ...hosted })).toBe('off');
      expect(flowMode('aave-supply', { ...harness, ...hosted, GRYLOO_SUPPLY_TESTNET: 'live' })).toBe('off');
      expect(flowMode('crosschain-router-testnet', { ...harness, ...hosted })).toBe('off');
      expect(flowMode('orca-liquidity', { ...harness, ...hosted })).toBe('off');
    }
    expect(flowMode('aave-supply', { VERCEL: '1', GRYLOO_SUPPLY_TESTNET: 'live' })).toBe('live');
  });
});
