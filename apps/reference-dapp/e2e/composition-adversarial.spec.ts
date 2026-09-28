// SPDX-License-Identifier: AGPL-3.0-only
/** Wrong-chain owner wallet cannot begin finite composition installation. */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, compositionEnabled, profile, snapshot, authorComposition } from './composition-fixtures';
test.skip(!compositionEnabled, 'BUILD-007 local composition profile is required');
test('wrong-chain injected owner is rejected before any signature or installation', async ({ page }) => {
  test.setTimeout(90_000);
  const restore = await snapshot();
  let sends = 0;
  await page.context().exposeFunction('__grylooWrongChain', async (method: string) => {
    if (method === 'eth_chainId') return '0x1';
    if (method === 'eth_sendTransaction') { sends++; throw new Error('FORBIDDEN_SEND'); }
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [profile().owner];
    throw new Error('UNEXPECTED_WALLET_CALL');
  });
  await page.context().addInitScript(() => {
    const bridge = (window as unknown as { __grylooWrongChain: (method: string) => Promise<unknown> }).__grylooWrongChain;
    Object.defineProperty(window, 'ethereum', { configurable: false, value: Object.freeze({
      request: ({ method }: { method: string }) => bridge(method),
    }) });
  });
  try {
    const panel = await authorComposition(page);
    await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true }).click();
    await panel.getByRole('button', { name: 'Connect disposable owner wallet' }).click();
    await expect(panel.getByRole('alert')).toContainText('WALLET_WRONG_CHAIN');
    expect(sends).toBe(0);
    const id = readdirSync(profile().journalDir).find(name => /^exec-[0-9a-f]{24}$/.test(name));
    expect(id).toBeDefined();
    const prepared = JSON.parse(readFileSync(join(profile().journalDir, id!, 'composition.json'), 'utf8')) as { installation: unknown[] };
    expect(prepared.installation).toEqual([]);
  } finally { await restore(); }
});
