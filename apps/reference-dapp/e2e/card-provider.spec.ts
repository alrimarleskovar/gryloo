// SPDX-License-Identifier: AGPL-3.0-only
// Credentials → Add card through Mercado Pago's Secure Fields, against the MOCKED loopback provider harness and an SDK stand-in.
// No request reaches Mercado Pago, no real card is used and nothing is charged.
import { test, expect } from './fixtures';
import { APP_ORIGIN } from './app-origin';
import { cardHarnessRequests, fillSecureField, installMercadoPagoSdkStandIn, MERCADO_PAGO_SDK, resetCardHarness, SERVER_ONLY_WOOVI_APP_ID, TEST_CARD } from './card-provider-fixtures';
import type { Page } from '@playwright/test';

test.skip(process.env.GRYLOO_CARD_E2E !== 'MOCKED_LOOPBACK_ONLY', 'Mercado Pago card entry requires the isolated loopback provider harness');

const STORAGE = 'flofi.credentials.v1', SERVER_TOKEN = 'TEST-flofi-loopback-harness-server-only', EMAIL = 'test_payer_12345@testuser.com';
const dialog = (page: Page) => page.locator('dialog.card-entry[open]');
const stored = (page: Page) => page.evaluate(key => localStorage.getItem(key) ?? '', STORAGE);
/** Everything the browser sent to FloFi and every text FloFi returned, to prove what crossed the boundary. */
function recordAppTraffic(page: Page) {
  const sent: string[] = [], received: string[] = [];
  page.on('request', request => { if (new URL(request.url()).origin === APP_ORIGIN) sent.push(`${request.url()}\n${request.postData() ?? ''}`); });
  page.on('response', response => { if (new URL(response.url()).origin === APP_ORIGIN) received.push(response.url());
    void response.text().then(text => received.push(text), () => undefined); });
  return { sent, received };
}
async function openAddCard(page: Page, theme: 'light' | 'dark' = 'light') {
  await page.addInitScript(value => localStorage.setItem('flofi.theme', value), theme);
  const sdk = await installMercadoPagoSdkStandIn(page);
  await page.goto('/app/credentials');
  await expect(page.getByText('No cards yet', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add card', exact: true }).click();
  await expect(dialog(page).getByRole('heading', { name: 'Add a card' })).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'Add card' })).toBeEnabled();
  return sdk;
}
async function enterCard(page: Page, holder = 'APRO', pan: string = TEST_CARD.pan) {
  await fillSecureField(page, 'cardNumber', pan);
  await fillSecureField(page, 'expirationDate', TEST_CARD.expiry);
  await fillSecureField(page, 'securityCode', TEST_CARD.cvv);
  await dialog(page).getByLabel('Name on card').fill(holder);
  await dialog(page).getByLabel('Number', { exact: true }).fill('123.456.789-09');
  await dialog(page).getByLabel('Email').fill(EMAIL);
  await dialog(page).getByRole('button', { name: 'Add card' }).click();
}

test.beforeEach(async () => { await resetCardHarness(); });

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: Add card collects the card only in Mercado Pago's secure fields and keeps only safe metadata`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const traffic = recordAppTraffic(page);
    const sdk = await openAddCard(page, theme);
    // The official SDK location, the public key only, one provider iframe per card field; FloFi renders no card-data input of its own.
    expect(sdk).toEqual([MERCADO_PAGO_SDK]);
    expect(await page.evaluate(() => ({ ...(window as unknown as { __mpHarness: { publicKey: string; locale: string; mounted: string[] } }).__mpHarness, fields: undefined })))
      .toEqual({ publicKey: 'TEST-flofi-loopback-harness', locale: 'pt-BR', mounted: ['cardNumber', 'expirationDate', 'securityCode'], fields: undefined });
    await expect(dialog(page).locator('.card-entry-secure iframe')).toHaveCount(3);
    for (const label of ['Card number', 'Expiry', 'Security code']) await expect(dialog(page).getByRole('group', { name: label }).locator('iframe')).toHaveCount(1);
    expect(await dialog(page).locator('input, select').evaluateAll(fields => fields.map(field => (field as HTMLInputElement).name)))
      .toEqual(['cardholderName', 'identificationType', 'identificationNumber', 'email']);
    await expect(dialog(page).getByLabel('Document').locator('option')).toHaveText(['CPF', 'CNPJ']);
    for (const box of await dialog(page).locator('.card-entry-secure').all()) expect((await box.boundingBox())!.height).toBeGreaterThanOrEqual(36);

    await enterCard(page);
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('.workspace-notice')).toHaveText('Visa •••• 5682 added to Credentials.');
    const card = page.getByRole('article', { name: 'Visa •••• 5682' });
    await expect(card).toContainText('Visa · Mercado Pago');
    await expect(card).toContainText('•••• 5682 · Expires 11/30');
    await expect(page.getByText('No cards yet', { exact: true })).toHaveCount(0);

    // FloFi's server sent Mercado Pago only the email and the one-time token, with its server-side token, and never a payment call.
    const requests = await cardHarnessRequests();
    expect(requests.map(entry => `${entry.method} ${entry.path.replace(/[0-9]+-harnessCustomer/, 'CUSTOMER')}`)).toEqual(['POST /v1/customers', 'POST /v1/customers/CUSTOMER/cards']);
    expect(requests.every(entry => entry.authorization === 'server-token')).toBe(true);
    expect(JSON.parse(requests[0]!.body)).toEqual({ email: EMAIL });
    expect(Object.keys(JSON.parse(requests[1]!.body))).toEqual(['token']);
    for (const text of [...requests.map(entry => entry.body), ...traffic.sent, await stored(page)]) {
      expect(text).not.toContain(TEST_CARD.pan);
      expect(text).not.toMatch(new RegExp(`(?<![A-Za-z0-9_-])${TEST_CARD.cvv}(?![A-Za-z0-9_-])`));
    }
    // The browser store holds provider references and display metadata only: no BIN, cardholder data, document or email.
    const saved = await stored(page);
    expect(JSON.parse(saved).cards).toEqual([expect.objectContaining({ provider: 'mercado_pago', providerName: 'Mercado Pago', brand: 'visa', last4: '5682', expMonth: 11, expYear: 2030 })]);
    expect(saved).not.toMatch(new RegExp(`${TEST_CARD.bin}|APRO|12345678909|123\\.456|test_payer|security`));
    // The server-only provider credentials (card and payment) never reach the browser, in any page, script or action response.
    expect(traffic.received.join('\n')).not.toContain(SERVER_TOKEN);
    expect(traffic.received.join('\n')).not.toContain(SERVER_ONLY_WOOVI_APP_ID);
    await page.reload();
    await expect(page.getByRole('article', { name: 'Visa •••• 5682' })).toContainText('Visa · Mercado Pago');
    expect(errors).toEqual([]);
  });
}

test('a provider response that carries a card number fails closed and nothing is saved', async ({ page }) => {
  await openAddCard(page);
  await enterCard(page, 'ECHO PAN');
  await expect(dialog(page).getByRole('alert')).toHaveText('The card could not be added. Nothing was saved.');
  // The provider did answer, with a card number in its response, and FloFi's server refused it.
  expect((await cardHarnessRequests()).filter(entry => entry.method === 'POST' && entry.path.endsWith('/cards'))).toHaveLength(1);
  await expect(dialog(page).getByRole('button', { name: 'Add card' })).toBeEnabled();
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.workspace-wallet-card')).toHaveCount(0);
  expect(await stored(page)).toBe('');
});

test('invalid card data stays in the secure fields: nothing reaches FloFi or the provider', async ({ page }) => {
  const traffic = recordAppTraffic(page);
  await openAddCard(page);
  const before = traffic.sent.length;
  await enterCard(page, 'APRO', '4235647728025683');
  await expect(dialog(page).getByRole('alert')).toHaveText('Check the card details and try again.');
  expect(traffic.sent.slice(before).filter(entry => entry.includes('harness_'))).toEqual([]);
  expect(await cardHarnessRequests()).toEqual([]);
});

test('Remove deletes only this card’s saved reference at the provider, never anything else', async ({ page }) => {
  await openAddCard(page);
  await enterCard(page);
  const card = page.getByRole('article', { name: 'Visa •••• 5682' });
  await card.getByRole('button', { name: 'Remove Visa •••• 5682' }).click();
  await expect(card.getByRole('group', { name: 'Remove Visa •••• 5682' })).toContainText('The card itself is not affected.');
  await card.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('.workspace-notice')).toHaveText('Card removed from FloFi.');
  await expect(page.getByText('No cards yet', { exact: true })).toBeVisible();
  await expect(page.getByText('No wallets yet', { exact: true })).toBeVisible();
  const requests = await cardHarnessRequests();
  const saved = requests.find(entry => entry.method === 'POST' && entry.path.endsWith('/cards'))!;
  expect(requests.filter(entry => entry.method === 'DELETE').map(entry => entry.path)).toEqual([`${saved.path}/8987269650`]);
  expect(JSON.parse(await stored(page)).cards).toEqual([]);
});
