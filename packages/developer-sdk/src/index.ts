// SPDX-License-Identifier: Apache-2.0
/**
 * FloFi Developer SDK: a thin TypeScript client for the FloFi Developer API v1 (server-side only, zero runtime dependencies).
 *
 *   const flofi = new FloFi({ apiKey: process.env.FLOFI_API_KEY!, baseUrl: 'https://<your FloFi deployment>' });
 *   const strategy = await flofi.strategies.create({ strategy: { action: 'bridge', sourceNetwork: 'base-sepolia', … } });
 *   const approval = await flofi.approvals.create({ strategy });   // send approval.approvalUrl to your user
 *   const event = await verifyWebhook({ payload: rawBody, headers, secret: process.env.FLOFI_WEBHOOK_SECRET! });
 *
 * FloFi remains the only execution truth, and your API key has zero financial authority: only the end user's own wallet, in FloFi,
 * after a fresh simulation and the Strategy Manifest Review, can sign anything.
 */
export { API_PATH, FloFi, SDK_VERSION, type FloFiOptions, type RequestOptions } from './client.js';
export { FloFiError, FloFiWebhookError, type Issue } from './errors.js';
export { verifyWebhook, type VerifyWebhookOptions, type WebhookHeaders } from './webhooks.js';
export type * from './types.js';
