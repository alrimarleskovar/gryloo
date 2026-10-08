// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `POST /api/payments/woovi/webhook` — Woovi stablecoin-payout events (see `src/server/payment-webhook.ts`). The signature is
 * verified before anything else; a verified event only makes FloFi re-read the payout from Woovi's API. No secret, URL or
 * upstream message is ever returned.
 */
import { paymentRunLocator, receiveWooviWebhook, WOOVI_WEBHOOK_MAX_BYTES } from '../../../../../server/payment-webhook';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

export async function POST(request: Request): Promise<Response> {
  if (Number(request.headers.get('content-length') ?? '0') > WOOVI_WEBHOOK_MAX_BYTES) return Response.json({ code: 'WEBHOOK_TOO_LARGE' }, { status: 413, headers });
  try {
    const outcome = await receiveWooviWebhook({ rawBody: await request.text(), signature: request.headers.get('x-webhook-signature'), env: process.env,
      locator: () => paymentRunLocator(process.env) });
    return Response.json({ code: outcome.code }, { status: outcome.status, headers });
  } catch {
    return Response.json({ code: 'WEBHOOK_UNAVAILABLE' }, { status: 503, headers });
  }
}
