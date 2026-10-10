// SPDX-License-Identifier: AGPL-3.0-only
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { E2E_APP_ORIGIN as APP_ORIGIN } from './app-origin';

export const SYNTHETIC_GUARD_URL = 'https://example.invalid/gryloo-guard-self-test';

type Guard = { readonly unexpected: readonly string[]; assertClean(): void };
const guards = new WeakMap<BrowserContext, Guard>();

function guardedTest(negativeSelfTest: boolean) {
  return base.extend<{ context: BrowserContext; page: Page; networkGuard: Guard }>({
    context: async ({ browser }, use) => {
      const context = await browser.newContext({
        baseURL: APP_ORIGIN,
        serviceWorkers: 'block', bypassCSP: negativeSelfTest, viewport: { width: 1440, height: 900 },
        colorScheme: 'light', reducedMotion: 'reduce', locale: 'en-US',
      });
      const unexpected: string[] = [];
      const guard: Guard = {
        unexpected,
        assertClean() {
          if (unexpected.length) throw new Error(`Unexpected network attempts: ${unexpected.join(', ')}`);
        },
      };
      guards.set(context, guard);
      let pages = 0;
      context.on('page', () => { pages += 1; if (pages > 1) unexpected.push('UNGUARDED_POPUP'); });
      context.on('serviceworker', () => unexpected.push('SERVICE_WORKER'));
      await context.route('**/*', async (route) => {
        const url = route.request().url();
        let allowed = false;
        try { allowed = new URL(url).origin === APP_ORIGIN; } catch { /* Invalid URL is forbidden. */ }
        if (allowed) await route.continue();
        else { unexpected.push(url); await route.abort('blockedbyclient'); }
      });
      await context.routeWebSocket('**/*', async (route) => {
        unexpected.push(`WEBSOCKET:${route.url()}`);
        await route.close(); // No connectToServer call: no WebSocket egress.
      });
      try {
        await use(context);
        if (negativeSelfTest) {
          expect(unexpected).toEqual([SYNTHETIC_GUARD_URL]);
        } else {
          guard.assertClean();
        }
      } finally {
        await context.close();
      }
    },
    page: async ({ context }, use) => {
      const page = await context.newPage(); // Routes are installed before this call.
      try { await use(page); } finally { await page.close(); }
    },
    networkGuard: async ({ context }, use) => {
      const guard = guards.get(context);
      if (!guard) throw new Error('Network guard was not installed');
      await use(guard);
    },
  });
}

export const test = guardedTest(false);
// Imported solely by the dedicated negative self-test. Its fixture requires
// exactly one recorded synthetic URL and still fails on every other attempt.
export const negativeGuardTest = guardedTest(true);
export { expect };

/** Read-only simulated wallet identity for authoring network pickers, never an owner wallet. */
export async function installPassiveWallet(page: Page, chainId = '0x2105'): Promise<void> {
  await page.addInitScript(chain => {
    const methods: string[] = [];
    Object.defineProperty(window, '__authoringWalletMethods', { get: () => methods });
    Object.defineProperty(window, 'ethereum', { configurable: true, value: {
      request: async ({ method }: { method: string }) => {
        methods.push(method);
        if (method === 'eth_accounts') return ['0x1111111111111111111111111111111111111111'];
        if (method === 'eth_chainId') return chain;
        throw new Error(`Passive authoring wallet refused ${method}`);
      },
    } });
  }, chainId);
}

export async function assertPassiveWallet(page: Page): Promise<void> {
  expect(await page.evaluate(() => [...new Set((window as unknown as { __authoringWalletMethods: string[] }).__authoringWalletMethods)].sort())).toEqual(['eth_accounts', 'eth_chainId']);
}

/**
 * The canonical wallet selector: assert it is open, then explicitly choose one wallet by its name and ecosystem. Opening the
 * selector never invokes a wallet; only this choice does.
 */
export async function chooseWallet(page: Page, name: string, ecosystem: 'Ethereum' | 'Solana' = 'Ethereum', language: 'EN' | 'PT' = 'EN'): Promise<void> {
  const dialog = page.locator('dialog.wallet-selector[open]');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: `${name} ${language === 'PT' ? 'em' : 'on'} ${ecosystem}`, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

/** Open the current authoring proposal; acceptance remains a separate explicit test action. */
export async function openProposalReview(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Review proposed change:/ }).click();
  await expect(page.getByRole('dialog', { name: 'Proposed change', exact: true })).toBeVisible();
}

/** Inspect existing provider diagnostics through their visible native disclosure. */
export async function openSimulationDetails(page: Page): Promise<void> {
  if (new URL(page.url()).pathname !== '/__engineering') {
    // An explicit diagnostic request enters the opted-in loopback harness without
    // reloading the persistent workspace or exposing diagnostics on normal routes.
    await page.evaluate(() => {
      if (!(window as unknown as { __flofiEngineeringWorkflow?: string }).__flofiEngineeringWorkflow) throw Error('ENGINEERING_HARNESS_REQUIRED');
      window.history.pushState(null, '', '/__engineering');
    });
  }
  const details = page.locator('.simulation-technical');
  await expect(details).toBeVisible();
  if (!(await details.evaluate(element => (element as HTMLDetailsElement).open))) await details.locator('> summary').click();
}

/** Use the shared product Review. MOCKED results must fail this authorization boundary. */
export async function acceptProductReview(page: Page): Promise<void> {
  const approve = page.locator('.canvas-primary-action').getByRole('button', { name: 'Approve & Continue', exact: true });
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.locator('.canvas-primary-action').getByRole('button', { name: 'Execute workflow', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true }).click();
}

/** A blocked workflow may offer simulation, but never an enabled financial CTA. */
export async function assertNoFinancialCanvasAction(page: Page): Promise<void> {
  const primary = page.locator('.canvas-primary-action');
  await expect(primary).toHaveCount(1);
  await expect(primary.locator('button[data-lifecycle-action="execute"]:enabled, button[data-lifecycle-action="continue"]:enabled')).toHaveCount(0);
  await expect(page.locator('.execution-summary button.primary')).toHaveCount(0);
}

/** Apply a reviewed authoring proposal through the visible contextual popover. This grants no financial authority. */
export async function applyPendingProposal(page: Page): Promise<void> {
  await openProposalReview(page);
  const apply = page.getByRole('dialog', { name: 'Proposed change', exact: true }).getByRole('button', { name: 'Apply proposal', exact: true });
  await expect(apply).toBeEnabled();
  await apply.click();
}

/** Inspect canonical IR using the explicitly enabled loopback-only read probe, with no product debug surface. */
export async function readWorkflowIr(page: Page): Promise<string> {
  const raw = await page.evaluate(() => (window as unknown as { __flofiEngineeringWorkflow?: string }).__flofiEngineeringWorkflow);
  if (!raw) throw new Error('The guarded canonical workflow probe is not enabled');
  return raw;
}

/** Select an authored action and open its existing Advanced Settings. */
export async function openFirstActionSettings(page: Page): Promise<void> {
  const card = page.locator('.build-flow-surface .composer-card').first();
  await card.click();
  const settings = card.getByRole('button', { name: 'Advanced Settings', exact: true });
  if (await settings.getAttribute('aria-expanded') !== 'true') await settings.click();
}
