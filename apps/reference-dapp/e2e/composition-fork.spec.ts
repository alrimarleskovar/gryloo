// SPDX-License-Identifier: AGPL-3.0-only
/** MOCKED synthetic source → closed replay → local Safe/Roles fork browser journey. */
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, compositionEnabled, profile, snapshot, injectWallet, authorComposition } from './composition-fixtures';
const workerPath = fileURLToPath(new URL('./fork/composition-harness.mjs', import.meta.url));
const verifierPath = fileURLToPath(new URL('./fork/composition-verify-manual-wallet.mjs', import.meta.url));
function workerOnce(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, 'composition-worker-once'], { stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GRYLOO_COMPOSITION_PROFILE: process.env.GRYLOO_COMPOSITION_PROFILE,
        GRYLOO_COMPOSITION_EXECUTOR_KEY_FILE: process.env.GRYLOO_COMPOSITION_EXECUTOR_KEY_FILE } });
    let output = '';
    child.stdout.on('data', data => { output += data.toString(); });
    child.stderr.on('data', data => { output += data.toString(); });
    child.once('close', code => code === 0 ? resolve(output) : reject(new Error(`COMPOSITION_WORKER_EXIT_${code}:${output.slice(-2000)}`)));
  });
}
test.skip(!compositionEnabled, 'BUILD-007 local composition profile is required');
test('review exact owner setup, complete with browser closed, reconcile Safe NFT and revoke', async ({ page }) => {
  test.setTimeout(240_000);
  const restore = await snapshot();
  const wallet = await injectWallet(page);
  try {
    await authorComposition(page);
    await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Mode B swap to liquidity composition' });
    await expect(panel).toContainText(profile().environment === 'FORK_REPRODUCED'
      ? 'Recorded Base state is replayed locally.' : 'Synthetic Base-like source state is used for this mocked test.');
    await expect(panel).toContainText('Roles limits target, selector, pair, recipient, ticks, desired amounts');
    if (profile().environment === 'MOCKED')
      await expect(panel).toHaveScreenshot('composition-review.png', { mask: [panel.locator('dd')] });
    await panel.getByRole('button', { name: 'Connect disposable owner wallet' }).click();
    await panel.getByRole('button', { name: 'I reviewed this finite authority' }).click();
    const executionId = readdirSync(profile().journalDir).find(name => /^exec-[0-9a-f]{24}$/.test(name));
    expect(executionId).toBeDefined();
    const path = join(profile().journalDir, executionId!, 'composition.json');
    const first = JSON.parse(readFileSync(path, 'utf8')) as { compiled: { installation: { to: string; data: string }[];
      revocation: { to: string; data: string }[] } };
    for (let index = 0; index < first.compiled.installation.length; index++) {
      await panel.getByRole('button', { name: 'Request next exact owner signature' }).click();
      await expect.poll(() => (JSON.parse(readFileSync(path, 'utf8')) as { installation: unknown[] }).installation.length,
        { timeout: 30_000 }).toBe(index + 1);
      expect(wallet.requests.at(-1)).toEqual({ to: first.compiled.installation[index]!.to, data: first.compiled.installation[index]!.data });
    }
    await page.goto('about:blank');
    let final = '';
    for (let i = 0; i < 8; i++) {
      final = await workerOnce();
      if (final.includes('MINT RECONCILED')) break;
    }
    expect(final).toContain('MINT RECONCILED');
    await page.goto('/__engineering');
    await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true }).click();
    const recovered = page.getByRole('region', { name: 'Mode B swap to liquidity composition' });
    await expect(recovered).toContainText('prior execution was loaded after browser restart');
    await expect(recovered).toContainText('Reconciled Safe-owned position NFT #');
    if (profile().environment === 'MOCKED')
      await expect(recovered).toHaveScreenshot('composition-reconciled.png', { mask: [recovered.locator('dd')] });
    await recovered.getByRole('button', { name: 'Connect disposable owner wallet' }).click();
    await recovered.getByRole('button', { name: 'I reviewed this finite authority' }).click();
    for (let index = 0; index < first.compiled.revocation.length; index++) {
      await recovered.getByRole('button', { name: 'Request next revocation signature' }).click();
      await expect.poll(() => (JSON.parse(readFileSync(path, 'utf8')) as { revocation: unknown[] }).revocation.length,
        { timeout: 30_000 }).toBe(index + 1);
      expect(wallet.requests.at(-1)).toEqual({ to: first.compiled.revocation[index]!.to, data: first.compiled.revocation[index]!.data });
    }
    expect(wallet.requests).toHaveLength(first.compiled.installation.length + first.compiled.revocation.length);
    const verification = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [verifierPath, '--wallet', 'Disposable test wallet', '--browser', 'Chromium',
        '--execution', executionId!], { stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, GRYLOO_MODE_B_RUNTIME: process.env.GRYLOO_COMPOSITION_PROFILE!.replace(/\/profile\.json$/, '') } });
      let output = '', error = '';
      child.stdout.on('data', data => { output += data.toString(); });
      child.stderr.on('data', data => { error += data.toString(); });
      child.once('close', code => code === (profile().environment === 'MOCKED' ? 1 : 0) ? resolve(output) :
        reject(new Error(`COMPOSITION_VERIFY_EXIT_${code}:${(error + output).slice(-2000)}`)));
    });
    const independent = JSON.parse(verification) as { result: string; findings: string[]; mintOutcome: { outcome: string } };
    expect(independent.result).toBe(profile().environment === 'MOCKED' ? 'LIMITED' : 'PASS');
    expect(independent.findings).toEqual(profile().environment === 'MOCKED' ? ['MOCKED_SOURCE_LIMIT'] : []);
    expect(independent.mintOutcome.outcome).toBe('RECONCILED');
  } finally { wallet.dispose(); await restore(); }
});
