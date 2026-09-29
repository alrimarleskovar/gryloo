// SPDX-License-Identifier: AGPL-3.0-only
/** Browser journey on a local fork. The disposable owner key stays in this Node test process. */
import { readFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fromHex } from '@defi-workflow-engine/reference-compiler';
import { signModeBLocalTransaction } from '@defi-workflow-engine/reference-executor';
import { test, expect } from './fixtures';
import { authorSwap } from './mode-a-fixtures';

const profilePath = process.env.GRYLOO_MODE_B_PROFILE;
const keyPath = process.env.GRYLOO_MODE_B_EXECUTOR_KEY_FILE;
const enabled = Boolean(profilePath && keyPath);
const rpc = async (method: string, params: unknown[] = []): Promise<unknown> => {
  const profile = JSON.parse(readFileSync(profilePath!, 'utf8')) as { rpcUrl: string };
  const response = await fetch(profile.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20_000) });
  const body = await response.json() as { result?: unknown; error?: { message?: string } };
  if (!response.ok || body.error || !('result' in body)) throw new Error(`MODE_B_TEST_RPC_${method}:${body.error?.message ?? response.status}`);
  return body.result;
};
const shortWait = () => new Promise(resolve => setTimeout(resolve, 100));
/** Optional absolute directory for reviewed before/after visual evidence captures (never asserted). */
const evidenceDir = process.env.GRYLOO_MODE_B_VISUAL_EVIDENCE_DIR?.startsWith('/') ? process.env.GRYLOO_MODE_B_VISUAL_EVIDENCE_DIR : null;
/** Per-run values: hashes and calldata, the fork-time expiry, the disposable owner address and salt-dependent simulation gas. */
const modeBVolatile = (region: import('@playwright/test').Locator) => [region.locator('code'), region.locator('tr').filter({ hasText: 'Expiry' }),
  region.locator('.wallet-chip'), region.getByText(/simulation gas/)];

test.skip(!enabled, 'The pinned local Mode B fork is required');
test('review, install, restart worker, reconcile, and revoke through a guarded browser', async ({ page }) => {
  test.setTimeout(180_000);
  const profile = JSON.parse(readFileSync(profilePath!, 'utf8')) as { owner: string; journalDir: string };
  const ownerKey = fromHex((JSON.parse(readFileSync(keyPath!, 'utf8')) as { owner: string }).owner);
  const owner = profile.owner.toLowerCase();
  // The pinned local signer refuses a key that does not derive the profile owner address.
  const sign = (tx: { to: string; data: string; nonce: bigint; gasLimit: bigint; maxFeePerGas: bigint }) =>
    signModeBLocalTransaction({ expectedExecutor: owner, ...tx }, ownerKey).raw;
  expect(() => sign({ to: owner, data: '0x00000000', nonce: 0n, gasLimit: 21_000n, maxFeePerGas: 1_000_000n })).not.toThrow();
  const snapshot = await rpc('evm_snapshot');
  try {
    for (const entry of readdirSync(profile.journalDir)) rmSync(join(profile.journalDir, entry), { recursive: true, force: true });
    await rpc('anvil_setBalance', [owner, '0x56bc75e2d63100000']);
    const requested: Record<string, string>[] = [];
    let walletFailure: string | null = null;
    await page.context().exposeFunction('__grylooModeBWallet', async (method: string, params: unknown[]) => {
      if (method === 'eth_chainId') return '0x7a69';
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [owner];
      // MetaMask's pending-nonce tracker answers with a number, not a hex string.
      if (method === 'eth_getTransactionCount') return Number(BigInt(await rpc(method, params) as string));
      if (method !== 'eth_sendTransaction') throw new Error(`MODE_B_TEST_WALLET_${method}`);
      try {
      const tx = params[0] as { from: string; to: string; data: string; value: string; chainId: string; nonce: string; gas: string };
      requested.push(tx);
      expect(tx.from.toLowerCase()).toBe(owner);
      expect(tx.chainId).toBe('0x7a69');
      expect(BigInt(tx.value)).toBe(0n);
      const head = await rpc('eth_getBlockByNumber', ['latest', false]) as { baseFeePerGas: string };
      const raw = sign({ to: tx.to, data: tx.data, nonce: BigInt(tx.nonce), gasLimit: BigInt(tx.gas),
        maxFeePerGas: BigInt(head.baseFeePerGas) * 2n + 1_000_000n });
      return await rpc('eth_sendRawTransaction', [raw]);
      } catch (error) { walletFailure = String(error); throw error; }
    });
    await page.context().addInitScript(() => {
      const bridge = (window as unknown as { __grylooModeBWallet: (method: string, params: unknown[]) => Promise<unknown> }).__grylooModeBWallet;
      Object.defineProperty(window, 'ethereum', { configurable: false, value: Object.freeze({
        request: ({ method, params }: { method: string; params?: unknown[] }) => bridge(method, params ?? []),
      }) });
    });
    await page.goto('/');
    if (evidenceDir) {
      mkdirSync(evidenceDir, { recursive: true });
      await expect(page.getByText('Permission demo', { exact: true })).toBeVisible();
      await page.screenshot({ path: join(evidenceDir, 'build.png'), fullPage: true });
    }
    await authorSwap(page, 'WETH_TO_USDC', '1', '100');
    await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate', exact: true }).click();
    const simulate = page.getByRole('region', { name: 'Finite Mode B authority' });
    await simulate.getByRole('button', { name: /Simulate finite Mode B for revision/ }).click();
    await expect(simulate).toContainText('one-time allowance', { timeout: 30_000 });
    await expect(simulate).toContainText('Mode B permission');
    if (evidenceDir)
      await page.screenshot({ path: join(evidenceDir, 'simulate.png'), fullPage: true });
    await page.getByRole('button', { name: 'Review finite Mode B permission' }).click();
    const panel = page.getByRole('region', { name: 'Finite Mode B authority' });
    if (evidenceDir)
      await page.screenshot({ path: join(evidenceDir, 'execute.png'), fullPage: true });
    await expect(panel).toHaveScreenshot('mode-b-review.png', { mask: modeBVolatile(panel) });
    await panel.getByRole('button', { name: 'Connect local owner wallet' }).click();
    await panel.getByRole('button', { name: 'I reviewed the finite permission and signatures' }).click();
    const executionId = readdirSync(profile.journalDir).find(name => name.startsWith('exec-'))!;
    const prepared = JSON.parse(readFileSync(join(profile.journalDir, executionId, 'prepared.json'), 'utf8')) as {
      compiled: { installation: { to: string; data: string }[]; revocation: { to: string; data: string }[] }; installationStart: number;
    };
    for (let index = prepared.installationStart; index < prepared.compiled.installation.length; index++) {
      await panel.getByRole('button', { name: new RegExp(`Request owner signature ${index + 1}`) }).click();
      await expect(panel.getByText('Requesting installation signature')).toHaveCount(0, { timeout: 30_000 });
      if (await panel.getByRole('alert').count()) throw new Error(walletFailure ?? await panel.getByRole('alert').first().innerText());
      await expect(panel.getByText('CHAIN CONFIRMED')).toHaveCount(index - prepared.installationStart + 1, { timeout: 30_000 });
      expect(requested.at(-1)!.to!.toLowerCase()).toBe(prepared.compiled.installation[index]!.to.toLowerCase());
      expect(requested.at(-1)!.data!.toLowerCase()).toBe(prepared.compiled.installation[index]!.data.toLowerCase());
    }
    await expect(panel).toContainText('PERMISSION_INSTALLED');
    await page.goto('about:blank'); // Unload the app; the worker has no browser dependency.
    const { createServer } = await import('vite');
    // The worker modules are addressed from the repository root, whatever directory Playwright runs from.
    const vite = await createServer({ root: resolve(test.info().project.testDir, '../../..'), configFile: false,
      server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
    try {
      const { createModeBService } = await vite.ssrLoadModule('/apps/reference-dapp/src/server/mode-b-service.ts');
      const { createForkRpc } = await vite.ssrLoadModule('/apps/reference-dapp/src/server/fork-rpc.ts');
      const service = createModeBService(JSON.parse(readFileSync(profilePath!, 'utf8')), createForkRpc({ url: JSON.parse(readFileSync(profilePath!, 'utf8')).rpcUrl }));
      const event = await service.worker(executionId, keyPath!);
      expect(['PENDING', 'CONFIRMED']).toContain(event.state);
      for (let attempt = 0; attempt < 30; attempt++) {
        const resumed = await service.worker(executionId, keyPath!);
        if (resumed.state === 'CONFIRMED') break;
        await shortWait();
      }
      expect((await service.reconcile(executionId)).outcome).toBe('RECONCILED');
    } finally { await vite.close(); }
    const recovered = page;
    await recovered.goto('/');
    await recovered.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true }).click();
    const after = recovered.getByRole('region', { name: 'Finite Mode B authority' });
    await expect(after).toContainText('RECONCILED');
    await expect(after).toContainText('Recovered from the local journal');
    await expect(after).toHaveScreenshot('mode-b-reconciled.png', { mask: modeBVolatile(after) });
    await after.getByRole('button', { name: 'Connect local owner wallet' }).click();
    await after.getByRole('button', { name: 'I reviewed the finite permission and signatures' }).click();
    await expect(after.locator('.wallet-chip')).toBeVisible();
    for (let index = 0; index < prepared.compiled.revocation.length; index++) {
      await after.getByRole('button', { name: new RegExp(`Request owner revocation signature ${index + 1}`) }).click();
      await expect.poll(() => (JSON.parse(readFileSync(join(profile.journalDir, executionId, 'prepared.json'), 'utf8')) as { revocation: unknown[] }).revocation.length).toBe(index + 1);
      expect(requested.at(-1)!.data!.toLowerCase()).toBe(prepared.compiled.revocation[index]!.data.toLowerCase());
    }
    await expect(after).toContainText('REVOCATION_CONFIRMED');
    await expect(after).toHaveScreenshot('mode-b-revoked.png', { mask: modeBVolatile(after) });
    expect(requested).toHaveLength(prepared.compiled.installation.length - prepared.installationStart + prepared.compiled.revocation.length);
  } finally {
    await rpc('evm_revert', [snapshot]);
    ownerKey.fill(0);
  }
});
