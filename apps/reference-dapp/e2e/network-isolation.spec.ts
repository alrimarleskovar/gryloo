// SPDX-License-Identifier: AGPL-3.0-only
import { negativeGuardTest, test, expect, SYNTHETIC_GUARD_URL } from './fixtures';

test('ordinary application page makes no external request or WebSocket attempt', async ({ page, networkGuard }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your Workflow', exact: true })).toBeVisible();
  networkGuard.assertClean();
});

negativeGuardTest('guard negative self-test records and aborts one synthetic external attempt before egress', async ({ page, networkGuard }) => {
  await page.goto('/');
  await page.evaluate(async (url) => { try { await fetch(url); } catch { /* Expected interception. */ } }, SYNTHETIC_GUARD_URL);
  expect(networkGuard.unexpected).toEqual([SYNTHETIC_GUARD_URL]);
  expect(() => networkGuard.assertClean()).toThrow(`Unexpected network attempts: ${SYNTHETIC_GUARD_URL}`);
});
