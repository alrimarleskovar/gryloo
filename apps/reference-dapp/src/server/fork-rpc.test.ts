// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createForkRpc, FORK_RPC_LIMITS, FORK_RPC_METHODS } from './fork-rpc';

type Init = { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal };
function scripted(reply: (request: { method: string; id: number }) => { status?: number; text: string }) {
  const seen: { url: string; body: { method: string; id: number; params: unknown[] } }[] = [];
  const fetchImpl = async (url: string, init: Init) => {
    const body = JSON.parse(init.body) as { method: string; id: number; params: unknown[] };
    seen.push({ url, body });
    const out = reply(body);
    return { ok: (out.status ?? 200) === 200, status: out.status ?? 200, text: async () => out.text };
  };
  return { seen, fetchImpl };
}
const ok = (result: unknown) => ({ id }: { id: number }) => ({ text: JSON.stringify({ jsonrpc: '2.0', id, result }) });

describe('local-fork RPC adapter', () => {
  it('accepts only an explicit loopback HTTP URL', () => {
    for (const url of ['http://localhost:8545', 'https://127.0.0.1:8545', 'http://127.0.0.2:8545', 'http://127.0.0.1:0',
      'http://127.0.0.1:70000', 'https://base-mainnet.g.alchemy.com/v2', 'http://127.0.0.1:8545/', 'http://user@127.0.0.1:8545']) {
      expect(() => createForkRpc({ url }), url).toThrow(/^FORK_RPC_URL_REFUSED$/);
    }
    expect(() => createForkRpc({ url: 'http://127.0.0.1:8545' })).not.toThrow();
  });

  it('refuses every signing, broadcast and state-changing method before any request', async () => {
    const { seen, fetchImpl } = scripted(ok('0x1'));
    const call = createForkRpc({ url: 'http://127.0.0.1:8545', fetchImpl });
    for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'eth_sign', 'eth_signTransaction', 'personal_sign',
      'eth_signTypedData_v4', 'anvil_setCode', 'anvil_setBalance', 'anvil_impersonateAccount', 'evm_mine', 'evm_revert',
      'wallet_switchEthereumChain', 'eth_accounts', 'debug_traceTransaction']) {
      await expect(call(method, []), method).rejects.toThrow(/^FORK_RPC_METHOD_REFUSED$/);
    }
    expect(seen).toHaveLength(0);
    expect(FORK_RPC_METHODS.some(method => /send|sign|anvil_set|evm_|impersonate/.test(method))).toBe(false);
  });

  it('returns results for allowed reads with a fresh request id each time', async () => {
    const { seen, fetchImpl } = scripted(ok('0x7a69'));
    const call = createForkRpc({ url: 'http://127.0.0.1:8545', fetchImpl });
    expect(await call('eth_chainId')).toBe('0x7a69');
    expect(await call('eth_chainId', [])).toBe('0x7a69');
    expect(seen.map(item => item.body.id)).toEqual([1, 2]);
    expect(seen.every(item => item.url === 'http://127.0.0.1:8545')).toBe(true);
  });

  it('fails closed on transport, HTTP, size, JSON, id and shape errors', async () => {
    const cases: [ReturnType<typeof scripted>['fetchImpl'], RegExp][] = [
      [async () => { throw new Error('connection refused'); }, /^FORK_RPC_UNAVAILABLE$/],
      [scripted(() => ({ status: 502, text: '' })).fetchImpl, /^FORK_RPC_HTTP_502$/],
      [scripted(() => ({ text: 'x'.repeat(FORK_RPC_LIMITS.maxResponseBytes + 1) })).fetchImpl, /^FORK_RPC_RESPONSE_TOO_LARGE$/],
      [scripted(() => ({ text: '{not json' })).fetchImpl, /^FORK_RPC_RESPONSE_INVALID$/],
      [scripted(({ id }) => ({ text: JSON.stringify({ jsonrpc: '2.0', id: id + 1, result: '0x1' }) })).fetchImpl, /^FORK_RPC_RESPONSE_INVALID$/],
      [scripted(({ id }) => ({ text: JSON.stringify({ jsonrpc: '2.0', id }) })).fetchImpl, /^FORK_RPC_RESPONSE_INVALID$/],
      [scripted(() => ({ text: '[]' })).fetchImpl, /^FORK_RPC_RESPONSE_INVALID$/],
    ];
    for (const [fetchImpl, code] of cases) {
      await expect(createForkRpc({ url: 'http://127.0.0.1:8545', fetchImpl })('eth_chainId')).rejects.toThrow(code);
    }
  });

  it('keeps a sanitized RPC error so a quoter revert stays recognizable without echoing input', async () => {
    const { fetchImpl } = scripted(({ id }) => ({ text: JSON.stringify({ jsonrpc: '2.0', id,
      error: { code: 3, message: 'execution reverted: <script>alert(1)</script> "quoted"' } }) }));
    const error = await createForkRpc({ url: 'http://127.0.0.1:8545', fetchImpl })('eth_call', [{}, 'latest']).then(() => null, (reason: Error) => reason);
    expect(error?.message).toMatch(/^FORK_RPC_ERROR:execution reverted: scriptalert\(1\)script quoted$/);
  });

  it('refuses a request body above the limit before sending it', async () => {
    const { seen, fetchImpl } = scripted(ok('0x1'));
    const call = createForkRpc({ url: 'http://127.0.0.1:8545', fetchImpl });
    await expect(call('eth_call', [{ data: `0x${'00'.repeat(FORK_RPC_LIMITS.maxRequestBytes)}` }, 'latest'])).rejects.toThrow(/^FORK_RPC_REQUEST_TOO_LARGE$/);
    expect(seen).toHaveLength(0);
  });
});
