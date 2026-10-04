// SPDX-License-Identifier: AGPL-3.0-only
import { verifyTempoSignedEnvelope } from '@defi-workflow-engine/reference-compiler/tempo-envelope';
import type { TempoReview } from '@defi-workflow-engine/reference-compiler';
type Provider = { request(input: { method: string; params?: unknown[] }): Promise<unknown> };
/** Two-stage wallet boundary: inspect exact signed bytes before any broadcast. Never downgrade to type 2. */
export async function requestTempoPayment(provider: Provider, review: TempoReview, handoff: (hash: string) => Promise<void>, current: () => boolean,
  now = Date.now): Promise<string> {
  async function guard() {
    if (!current() || now() >= Date.parse(review.expiresAt)) throw new Error('TEMPO_REVIEW_STALE');
    const chain = await provider.request({ method: 'eth_chainId' }), accounts = await provider.request({ method: 'eth_accounts' });
    if (chain !== '0xa5bf' || !Array.isArray(accounts) || String(accounts[0]).toLowerCase() !== review.account) throw new Error('TEMPO_WALLET_CHANGED');
    if (!current() || now() >= Date.parse(review.expiresAt)) throw new Error('TEMPO_REVIEW_STALE');
  }
  await guard();
  const signed = await provider.request({ method: 'eth_signTransaction', params: [review.transaction] });
  const raw = typeof signed === 'string' ? signed : signed && typeof signed === 'object' && 'raw' in signed ? String(signed.raw) : '';
  const verified = verifyTempoSignedEnvelope(raw, review.transaction);
  await guard();
  await handoff(verified.hash); // Durable hash before broadcast; a lost response stops here.
  await guard();
  const hash = await provider.request({ method: 'eth_sendRawTransaction', params: [raw] });
  if (hash !== verified.hash) throw new Error('TEMPO_WALLET_RESULT_UNKNOWN');
  return verified.hash;
}
