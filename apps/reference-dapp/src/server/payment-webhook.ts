// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Woovi stablecoin-payout webhooks. A webhook is only a hint: its RSA-SHA256 signature over the raw body is verified against
 * Woovi's published keys before anything else happens, and a verified one only makes FloFi re-read the payout through Woovi's
 * API (`observe`). Nothing in the body is taken as settlement, and an unsigned or unknown request never touches a run.
 */
import { createFileExecutionStorage, utf8 } from '@defi-workflow-engine/reference-executor';
import { embeddedRuntime, flowRuntimeKind } from './flow-runtime.ts';
import { createPaymentFlowService, paymentOrderIndex, PAYMENT_RUN_ID } from './payment-flow-service.ts';
import { paymentMode, paymentRuntime } from './payment-runtime.ts';
import { createWooviPixPaymentAdapter, verifyWooviWebhook, wooviConfiguration, wooviWebhookCorrelationId } from './woovi-pix-adapter.ts';

type Env = Readonly<Record<string, string | undefined>>;
export const WOOVI_WEBHOOK_MAX_BYTES = 65_536;
export type WebhookOutcome = { readonly status: number; readonly code: string; readonly state?: string };
/** Where the deployment keeps its payment runs: the index lookup and a re-read of one run. */
export type PaymentRunLocator = { readonly runForOrder: (providerOrderId: string) => Promise<string | null>;
  readonly observe: (runId: string) => Promise<{ readonly state: string }> };

const KEY_TTL_MS = 600_000;
let keyCache: { readonly appId: string; readonly keys: readonly string[]; readonly at: number } | null = null;

export async function receiveWooviWebhook(input: { readonly rawBody: string; readonly signature: string | null; readonly env: Env;
  readonly locator: () => Promise<PaymentRunLocator | WebhookOutcome>; readonly fetchImpl?: typeof fetch; readonly now?: () => number }): Promise<WebhookOutcome> {
  const now = input.now ?? Date.now;
  if (paymentMode(input.env) === 'off') return { status: 503, code: 'PAYMENT_NOT_ENABLED' };
  const woovi = wooviConfiguration(input.env);
  if (!woovi.configured) return { status: 503, code: woovi.code };
  if (new TextEncoder().encode(input.rawBody).length > WOOVI_WEBHOOK_MAX_BYTES) return { status: 413, code: 'WEBHOOK_TOO_LARGE' };
  const adapter = createWooviPixPaymentAdapter(woovi, { fetchImpl: input.fetchImpl ?? fetch });
  const keys = async (fresh: boolean) => {
    if (fresh || !keyCache || keyCache.appId !== woovi.appId || now() - keyCache.at > KEY_TTL_MS)
      keyCache = { appId: woovi.appId, keys: await adapter.webhookPublicKeys(), at: now() };
    return keyCache.keys;
  };
  let verified: boolean;
  try {
    verified = verifyWooviWebhook(input.rawBody, input.signature, await keys(false))
      // Key rotation: one refresh of Woovi's published keys before refusing.
      || verifyWooviWebhook(input.rawBody, input.signature, await keys(true));
  } catch { return { status: 503, code: 'WEBHOOK_KEYS_UNAVAILABLE' }; }
  if (!verified) return { status: 401, code: 'WEBHOOK_SIGNATURE_INVALID' };
  let body: unknown;
  try { body = JSON.parse(input.rawBody); } catch { return { status: 400, code: 'WEBHOOK_BODY_INVALID' }; }
  const correlationId = wooviWebhookCorrelationId(body);
  // Verified but not a FloFi payout event (for example Woovi's registration test): acknowledged, nothing else happens.
  if (!correlationId) return { status: 200, code: 'WEBHOOK_IGNORED' };
  const locator = await input.locator();
  if ('status' in locator) return locator;
  const runId = await locator.runForOrder(correlationId);
  if (!runId) return { status: 200, code: 'WEBHOOK_PAYOUT_UNKNOWN' };
  try { return { status: 200, code: 'WEBHOOK_OBSERVED', state: (await locator.observe(runId)).state }; }
  // Workers and the owner's own observation retry; Woovi redelivers too. Never a 2xx claim of what was not observed.
  catch { return { status: 503, code: 'PAYMENT_OBSERVATION_UNAVAILABLE' }; }
}

/** The deployment's payment runs, on the same runtime the server action uses (local files or the embedded cloud runtime). */
export async function paymentRunLocator(env: Env): Promise<PaymentRunLocator | WebhookOutcome> {
  const kind = flowRuntimeKind(env);
  if (kind === 'unconfigured') return { status: 503, code: 'CLOUD_RUNTIME_NOT_CONFIGURED' };
  // The remote API's own workers reconcile in-flight runs; this web deployment holds no run storage to look the payout up in.
  if (kind === 'remote') return { status: 202, code: 'WEBHOOK_DEFERRED_TO_RUNTIME' };
  if (kind === 'embedded') {
    const runtime = await embeddedRuntime(env), storage = runtime.backend.storage('pix-payment', runtime.tenantId);
    const observer = runtime.backend.service('pix-payment', runtime.tenantId, true);
    return { runForOrder: async id => { const bytes = await storage.log.read(paymentOrderIndex(id)), run = bytes ? utf8(bytes).trim() : '';
      return PAYMENT_RUN_ID.test(run) ? run : null; }, observe: async runId => await observer.observe(runId) as { state: string } };
  }
  const dir = env.GRYLOO_PAYMENT_JOURNAL;
  if (!dir) return { status: 503, code: 'PAYMENT_STORAGE_NOT_CONFIGURED' };
  const service = createPaymentFlowService({ storage: createFileExecutionStorage(dir, 'PAYMENT_BUSY'), ...paymentRuntime(env) });
  return { runForOrder: id => service.runForOrder(id), observe: runId => service.observe(runId) };
}
