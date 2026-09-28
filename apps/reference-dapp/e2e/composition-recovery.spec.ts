// SPDX-License-Identifier: AGPL-3.0-only
/** Browser closure and fresh worker processes retain one exact swap and one exact mint. */
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, compositionEnabled, profile, snapshot, injectWallet, authorComposition } from './composition-fixtures';
const worker = fileURLToPath(new URL('./fork/composition-harness.mjs', import.meta.url));
const once = () => new Promise<string>((resolve, reject) => {
  const process = spawn(globalThis.process.execPath, [worker, 'composition-worker-once'], { stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...globalThis.process.env } });
  let output = '';
  process.stdout.on('data', data => { output += data.toString(); });
  process.stderr.on('data', data => { output += data.toString(); });
  process.once('close', code => code === 0 ? resolve(output) : reject(new Error(output.slice(-2000))));
});
test.skip(!compositionEnabled, 'BUILD-007 local composition profile is required');
test('restart resumes known pending hashes without duplicate sends', async ({ page }) => {
  test.setTimeout(180_000);
  const restore = await snapshot();
  const wallet = await injectWallet(page);
  try {
    const panel = await authorComposition(page);
    await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true }).click();
    await panel.getByRole('button', { name: 'Connect disposable owner wallet' }).click();
    await panel.getByRole('button', { name: 'I reviewed this finite authority' }).click();
    const id = readdirSync(profile().journalDir).find(name => /^exec-[0-9a-f]{24}$/.test(name))!;
    const path = join(profile().journalDir, id, 'composition.json');
    const prepared = JSON.parse(readFileSync(path, 'utf8')) as { compiled: { installation: unknown[] } };
    for (let i = 0; i < prepared.compiled.installation.length; i++) {
      await panel.getByRole('button', { name: 'Request next exact owner signature' }).click();
      await expect.poll(() => (JSON.parse(readFileSync(path, 'utf8')) as { installation: unknown[] }).installation.length).toBe(i + 1);
    }
    await page.goto('about:blank');
    expect(await once()).toContain('SWAP PENDING');
    expect(await once()).toContain('MINT PENDING');
    expect(await once()).toContain('MINT RECONCILED');
    expect(await once()).toContain('MINT RECONCILED');
    const rows = readFileSync(join(profile().journalDir, id, 'composition-events.jsonl'), 'utf8').trimEnd()
      .split('\n').map(line => JSON.parse(line) as { level: string; step: string; state: string; transactionHash: string | null });
    for (const step of ['SWAP', 'MINT']) {
      const sends = rows.filter(row => row.level === 'ATTEMPT' && row.step === step && row.state === 'PENDING');
      expect(sends).toHaveLength(1);
      expect(sends[0]!.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);
    }
  } finally { wallet.dispose(); await restore(); }
});
