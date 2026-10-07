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

/** Open the current authoring proposal; acceptance remains a separate explicit test action. */
export async function openProposalReview(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Review proposed change:/ }).click();
  await expect(page.getByRole('dialog', { name: 'Proposed change', exact: true })).toBeVisible();
}

/** Inspect existing provider diagnostics through their visible native disclosure. */
export async function openSimulationDetails(page: Page): Promise<void> {
  const details = page.locator('.simulation-technical');
  await expect(details).toBeVisible();
  if (!(await details.evaluate(element => (element as HTMLDetailsElement).open))) await details.locator('> summary').click();
}

/** Use the shared product Review. MOCKED results must fail this authorization boundary. */
export async function acceptProductReview(page: Page): Promise<void> {
  const approve = page.getByRole('button', { name: 'Approve & Continue', exact: true });
  await expect(approve, await page.locator('.review-validity').innerText()).toBeEnabled();
  await approve.click();
  await expect(page.getByRole('button', { name: 'Review approved', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true }).click();
}
