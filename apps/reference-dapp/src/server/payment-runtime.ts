// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Payment (stablecoin → Pix) runtime configuration, shared by the in-process server action and the cloud backend flow, with the
 * same explicit gates as the other mainnet flows:
 *  - `GRYLOO_PAYMENT=live`: quotes, simulation and Review through the configured PaymentAdapter (Woovi; its App ID and environment
 *    are read only in `woovi-pix-adapter.ts`). A provider that is not configured fails closed with its own code.
 *  - `GRYLOO_PAYMENT_OWNER_EXECUTION=MAINNET_OWNER_APPROVED`: additionally allows `begin`, the USDC transfer on Base mainnet that the
 *    owner's own wallet signs (Flofi never signs or sends). It takes effect ONLY with Woovi's production environment: a sandbox
 *    account's deposit address would receive real USDC on Base mainnet, so a sandbox deployment can never begin a payment.
 * There is no loopback harness mode: no product surface drives this flow in a browser, and automated tests inject fakes directly.
 */
import { CROSSCHAIN_ROUTER_BASE_ARBITRUM } from '@defi-workflow-engine/action-registry';
import { paymentAdapters, type PaymentAdapter } from './payment-adapter.ts';
import { createBaseSepoliaReadRpc, pacedReadRpc } from './public-testnet-rpc.ts';
import type { Rpc } from './public-testnet-service.ts';
import { routerRpcUrl } from './router-runtime.ts';
import { wooviConfiguration } from './woovi-pix-adapter.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type PaymentMode = 'live' | 'off';
/** MOCKED: injected test fakes. PROVIDER_SANDBOX: the provider's sandbox (never executable). PUBLIC_MAINNET: production provider. */
export type PaymentProvenance = 'MOCKED' | 'PROVIDER_SANDBOX' | 'PUBLIC_MAINNET';
/** The only reads source verification needs; no send, sign or wallet method can exist on this client. */
export const PAYMENT_BASE_RPC_METHODS = Object.freeze(['eth_chainId', 'eth_blockNumber', 'eth_getTransactionReceipt']);

export const paymentMode = (env: Env): PaymentMode => env.GRYLOO_PAYMENT === 'live' ? 'live' : 'off';

export type PaymentRuntime = { readonly rpc: Rpc; readonly adapters: ReadonlyMap<string, PaymentAdapter>; readonly provenance: PaymentProvenance;
  readonly executionEnabled: boolean };
/** Base mainnet reads use the same public default and optional keyed HTTPS override (`GRYLOO_BASE_RPC_URL`) as the Router. */
export function paymentRuntime(env: Env, fetchImpl: typeof fetch = fetch): PaymentRuntime {
  const woovi = wooviConfiguration(env), production = woovi.configured && woovi.environment === 'production';
  return { rpc: pacedReadRpc(createBaseSepoliaReadRpc(routerRpcUrl(env.GRYLOO_BASE_RPC_URL, CROSSCHAIN_ROUTER_BASE_ARBITRUM.source.rpc), PAYMENT_BASE_RPC_METHODS)),
    adapters: paymentAdapters(env, fetchImpl), provenance: production ? 'PUBLIC_MAINNET' : 'PROVIDER_SANDBOX',
    executionEnabled: production && env.GRYLOO_PAYMENT_OWNER_EXECUTION === 'MAINNET_OWNER_APPROVED' };
}
