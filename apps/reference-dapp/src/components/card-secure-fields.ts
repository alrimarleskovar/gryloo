// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Loads Mercado Pago's official MercadoPago.js v2 from Mercado Pago's own origin (never self-hosted or bundled) and exposes
 * only the Secure Fields surface FloFi uses. The card number, expiry and security code are typed into Mercado Pago's iframes;
 * FloFi's page receives only the one-time card token `createCardToken` returns.
 */
export const MERCADO_PAGO_SDK_URL = 'https://sdk.mercadopago.com/js/v2';
export type SecureFieldType = 'cardNumber' | 'expirationDate' | 'securityCode';
export type MercadoPagoSecureField = { mount(containerId: string): MercadoPagoSecureField; unmount(): void };
export type MercadoPagoInstance = {
  readonly fields: {
    create(type: SecureFieldType, options: { readonly placeholder: string; readonly style?: Readonly<Record<string, string>> }): MercadoPagoSecureField;
    createCardToken(input: { readonly cardholderName: string; readonly identificationType: string; readonly identificationNumber: string }): Promise<{ readonly id?: unknown }>;
  };
  getIdentificationTypes(): Promise<readonly { readonly id?: unknown; readonly name?: unknown }[]>;
};
type MercadoPagoConstructor = new (publicKey: string, options: { readonly locale: string }) => MercadoPagoInstance;
declare global { interface Window { MercadoPago?: MercadoPagoConstructor } }

let loading: Promise<MercadoPagoConstructor> | null = null;
export function loadMercadoPago(sdkUrl: string): Promise<MercadoPagoConstructor> {
  if (sdkUrl !== MERCADO_PAGO_SDK_URL) return Promise.reject(new Error('CARD_SDK_URL_INVALID'));
  if (window.MercadoPago) return Promise.resolve(window.MercadoPago);
  return loading ??= new Promise<MercadoPagoConstructor>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = MERCADO_PAGO_SDK_URL;
    script.async = true;
    script.onload = () => window.MercadoPago ? resolve(window.MercadoPago) : reject(new Error('CARD_SDK_UNAVAILABLE'));
    script.onerror = () => { loading = null; script.remove(); reject(new Error('CARD_SDK_UNAVAILABLE')); };
    document.head.append(script);
  }).catch(cause => { loading = null; throw cause; });
}
