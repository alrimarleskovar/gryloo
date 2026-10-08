// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MOCKED stand-in for MercadoPago.js v2 Secure Fields, served in place of `https://sdk.mercadopago.com/js/v2` so the browser
 * never reaches Mercado Pago. Like the real SDK it mounts one iframe per card field and returns a one-time token from
 * `fields.createCardToken`; its token encodes only what the loopback provider harness needs (last four digits, BIN, expiry,
 * brand). Never a real card, never provider evidence.
 */
import type { Page } from '@playwright/test';

export const MERCADO_PAGO_SDK = 'https://sdk.mercadopago.com/js/v2';
export const CARD_HARNESS = 'http://127.0.0.1:8555';
/** A Woovi App ID present only in the app server's environment during the card run: the browser must never receive it. Not a credential. */
export const SERVER_ONLY_WOOVI_APP_ID = 'flofi-loopback-woovi-app-id-server-only';
/** Mercado Pago's published test Visa (Brazil); the security code is the test value. */
export const TEST_CARD = { pan: '4235647728025682', expiry: '11/30', cvv: '987', last4: '5682', bin: '423564' } as const;

const SDK = `(() => {
  const luhn = digits => [...digits].reverse().reduce((sum, char, index) => { let d = Number(char); if (index % 2) { d *= 2; if (d > 9) d -= 9; } return sum + d; }, 0) % 10 === 0;
  const method = pan => /^4/.test(pan) ? 'visa' : /^5[1-5]/.test(pan) ? 'master' : /^3[47]/.test(pan) ? 'amex' : 'unknown';
  const base64url = text => btoa(text).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  window.MercadoPago = class {
    constructor(publicKey, options) {
      const harness = window.__mpHarness = { publicKey, locale: options && options.locale, mounted: [], fields: {} };
      this.fields = {
        create(type, settings) {
          const field = { type, frame: null,
            mount(id) {
              const host = document.getElementById(id);
              if (!host) throw new Error('SECURE_FIELD_CONTAINER_MISSING');
              const frame = document.createElement('iframe');
              frame.title = 'Mercado Pago ' + type; frame.dataset.mpField = type;
              frame.srcdoc = '<!doctype html><style>html,body{margin:0;background:transparent;color-scheme:light dark}input{width:100%;height:36px;border:0;outline:0;padding:0;background:transparent;font:14px sans-serif}</style>'
                + '<input aria-label="' + type + '" placeholder="' + settings.placeholder + '" autocomplete="off">';
              host.append(frame); field.frame = frame; harness.mounted.push(type); return field;
            },
            unmount() { if (field.frame) field.frame.remove(); },
          };
          harness.fields[type] = field; return field;
        },
        async createCardToken(input) {
          const read = type => { const frame = harness.fields[type] && harness.fields[type].frame; const box = frame && frame.contentDocument && frame.contentDocument.querySelector('input'); return box ? box.value : ''; };
          const pan = read('cardNumber').replace(/\\s/g, ''), expiry = /^(\\d{2})\\/(\\d{2}|\\d{4})$/.exec(read('expirationDate')), cvv = read('securityCode');
          if (!/^\\d{13,19}$/.test(pan) || !luhn(pan) || !expiry || !/^\\d{3,4}$/.test(cvv) || !input.cardholderName || !input.identificationType || !input.identificationNumber)
            throw [{ code: 'E301', message: 'invalid card data' }];
          const token = { l: pan.slice(-4), b: pan.slice(0, 6), m: Number(expiry[1]), y: Number(expiry[2].length === 2 ? '20' + expiry[2] : expiry[2]), t: method(pan) };
          // The provider-misbehaviour case: the stand-in provider later echoes the full card number in its response.
          if (input.cardholderName === 'ECHO PAN') token.e = pan;
          return { id: 'harness_' + base64url(JSON.stringify(token)) };
        },
      };
    }
    async getIdentificationTypes() { return [{ id: 'CPF', name: 'CPF' }, { id: 'CNPJ', name: 'CNPJ' }]; }
  };
})();`;

/** Serves the SDK stand-in at the official SDK URL for this page only; the context guard still blocks every other external request. */
export async function installMercadoPagoSdkStandIn(page: Page): Promise<string[]> {
  const requested: string[] = [];
  await page.route(MERCADO_PAGO_SDK, route => { requested.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'text/javascript', body: SDK }); });
  return requested;
}
export type HarnessRequest = { readonly method: string; readonly path: string; readonly authorization: string; readonly body: string };
export async function resetCardHarness(): Promise<void> { await fetch(`${CARD_HARNESS}/__harness/reset`, { method: 'POST' }); }
export async function cardHarnessRequests(): Promise<HarnessRequest[]> { return (await fetch(`${CARD_HARNESS}/__harness/requests`)).json() as Promise<HarnessRequest[]>; }
/** Types a value into one of the stand-in's secure-field iframes (the real ones are cross-origin and reachable only by the user). */
export async function fillSecureField(page: Page, type: 'cardNumber' | 'expirationDate' | 'securityCode', value: string): Promise<void> {
  await page.frameLocator(`iframe[data-mp-field="${type}"]`).locator('input').fill(value);
}
