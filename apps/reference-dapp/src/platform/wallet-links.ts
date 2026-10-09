// SPDX-License-Identifier: AGPL-3.0-only
/** Browser-only navigation helpers. Never encode a capability in a provider's URL path or query. */
export function walletDeepLinks(url: string, origin: string) {
  const target = new URL(url), base = new URL(origin);
  if (target.origin !== base.origin || target.pathname !== '/approve' || target.search || target.username || target.password
    || !(target.protocol === 'https:' || target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname))) throw new Error('APPROVAL_LINK_INVALID');
  // Phantom's documented browse contract puts the encoded URL in the HTTP path. Open only the public landing page; the owner
  // pastes the full approval link inside the wallet browser. Never send a capability to a third-party redirect server.
  const plain = `${target.origin}${target.pathname}`;
  return { phantom: `https://phantom.com/ul/browse/${encodeURIComponent(plain)}?ref=${encodeURIComponent(base.origin)}`,
    metamask: `https://metamask.app.link/dapp/${plain.replace(/^https?:\/\//, '')}${target.hash}` };
}
