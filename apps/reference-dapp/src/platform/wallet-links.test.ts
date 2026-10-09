// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { walletDeepLinks } from './wallet-links.ts';

describe('universal owner wallet navigation', () => {
  const origin = 'https://flofi.test', secret = 'flofi_chs_' + 'x'.repeat(43), url = `${origin}/approve#${secret}`;
  it('keeps the MetaMask capability in a fragment, outside the redirect HTTP request', () => {
    const target = new URL(walletDeepLinks(url, origin).metamask);
    expect(target.hash).toBe('#' + secret);
    expect(target.pathname + target.search).not.toContain(secret);
    expect(target.pathname).toBe('/dapp/flofi.test/approve');
  });
  it('never encodes a secret in Phantom’s documented browse path', () => {
    const target = new URL(walletDeepLinks(url, origin).phantom);
    expect(target.origin).toBe('https://phantom.com');
    expect(decodeURIComponent(target.pathname.slice('/ul/browse/'.length))).toBe(origin + '/approve');
    expect(target.href).not.toContain(secret);
    expect(target.searchParams.get('ref')).toBe(origin);
  });
  it.each(['https://evil.test/approve', 'https://flofi.test/execute', 'https://flofi.test/approve?token=secret',
    'https://user:password@flofi.test/approve', 'javascript:alert(1)', 'http://flofi.test/approve'])('refuses unexpected targets: %s', target => {
    expect(() => walletDeepLinks(target, origin)).toThrow('APPROVAL_LINK_INVALID');
  });
});
