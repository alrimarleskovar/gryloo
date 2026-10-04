// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { pacedReadRpc, routerMode, routerRpcUrl, routerRuntime, ROUTER_ARBITRUM_RPC_METHODS, ROUTER_BASE_RPC_METHODS } from './router-runtime';

describe('BUILD-ROUTER-001 router runtime', () => {
  it('is off unless explicitly enabled; the MOCKED harness always wins; owner execution is a separate opt-in', () => {
    expect(routerMode({})).toBe('off');
    expect(routerMode({ GRYLOO_ROUTER: 'live' })).toBe('live');
    expect(routerMode({ GRYLOO_ROUTER: 'live', GRYLOO_ROUTER_HARNESS: 'MOCKED_LOOPBACK_ONLY' })).toBe('harness');
    expect(routerRuntime('live', { GRYLOO_ROUTER: 'live' }).executionEnabled).toBe(false);
    expect(routerRuntime('live', { GRYLOO_ROUTER: 'live', GRYLOO_ROUTER_OWNER_EXECUTION: 'yes' }).executionEnabled).toBe(false);
    expect(routerRuntime('live', { GRYLOO_ROUTER: 'live', GRYLOO_ROUTER_OWNER_EXECUTION: 'MAINNET_OWNER_APPROVED' })).toMatchObject({ executionEnabled: true, provenance: 'PUBLIC_MAINNET' });
    expect(routerRuntime('harness', {})).toMatchObject({ provenance: 'MOCKED' });
  });
  it('allowlists only read methods and accepts only HTTPS overrides without credentials', () => {
    for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'eth_sign', 'personal_sign'])
      expect([...ROUTER_BASE_RPC_METHODS, ...ROUTER_ARBITRUM_RPC_METHODS]).not.toContain(method);
    expect(routerRpcUrl(undefined, 'https://mainnet.base.org')).toBe('https://mainnet.base.org');
    expect(routerRpcUrl('https://rpc.example.org/v1', 'x')).toBe('https://rpc.example.org/v1');
    for (const bad of ['http://rpc.example.org', 'https://user:pass@rpc.example.org', 'not a url']) expect(() => routerRpcUrl(bad, 'x')).toThrow('ROUTER_RPC_CONFIGURATION_INVALID');
  });
  it('paces reads through one queue and retries only transport failures', async () => {
    const calls: string[] = [], sleeps: number[] = [];
    let failures = 2;
    const rpc = pacedReadRpc(async method => { calls.push(method); if (method === 'flaky' && failures-- > 0) throw new Error('PUBLIC_RPC_UNAVAILABLE');
      if (method === 'reverted') throw new Error('PUBLIC_RPC_RESPONSE_INVALID'); return method; }, { sleep: async ms => { sleeps.push(ms); } });
    expect(await Promise.all([rpc('a', []), rpc('flaky', []), rpc('b', [])])).toEqual(['a', 'flaky', 'b']);
    expect(calls).toEqual(['a', 'flaky', 'flaky', 'flaky', 'b']);
    expect(sleeps.filter(ms => ms >= 500 && ms % 500 === 0)).toEqual([500, 1000]);
    await expect(rpc('reverted', [])).rejects.toThrow('PUBLIC_RPC_RESPONSE_INVALID');
    expect(calls.filter(c => c === 'reverted')).toHaveLength(1);
  });
});
