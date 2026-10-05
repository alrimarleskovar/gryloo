// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createUtxo, generateUtxoKeypair, getNkFromUtxoPrivateKey, MerkleTree, getShieldPoolPDAs, findProgramAddress, addressBytes } from '@cloak.dev/sdk';
import { buildCloakPrivateState, CLOAK_RUNTIME } from '../src/privacy/cloak-adapter';
import { cloakOwnerUsdcAta } from '../src/privacy/live-proof';
import { PrivateStateVault } from '../src/privacy/vault';

test('required Cloak workflow discloses public proceeds and never requests a signature or public execution', async ({ page }) => {
  const external: string[] = [];
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { external.push(route.request().url()); await route.abort(); }
    else await route.continue();
  });
  await page.goto('/');
  await page.getByLabel(/Describe a mock edit/).fill('swap 0.02 SOL to USDC privately');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Privacy: REQUIRED / Cloak. USDC proceeds are public. Remaining SOL change stays private.')).toBeVisible();
  await page.getByRole('button', { name: 'Apply proposal', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Cloak privacy workflow' });
  await expect(panel.getByText('PRIVACY: REQUIRED / CLOAK')).toBeVisible();
  await expect(panel.getByText(/Routing provider: Jupiter via Cloak/)).toBeVisible();
  await expect(panel.getByText(/Exact DEX route: provider-managed and not authorization-bound/)).toBeVisible();
  await page.getByRole('button', { name: 'Simulate', exact: true }).first().click();
  await panel.getByRole('button', { name: 'Check privacy feasibility' }).click();
  await expect(panel.getByText(/Financial simulation not performed/)).toBeVisible();
  const downloading = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export non-executed feasibility report' }).click();
  const download = await downloading;
  await download.saveAs('.turbo/privacy001-feasibility.json');
  const evidenceText = await readFile('.turbo/privacy001-feasibility.json', 'utf8');
  expect(JSON.parse(evidenceText)).toMatchObject({ format: 'flofi.cloak-feasibility.v1', execution: 'NOT_EXECUTED',
    financialSimulation: 'NOT_PERFORMED', acceptance: 'BLOCKED', privacy: { mode: 'required', provider: 'cloak', output: 'public-with-private-change' },
    routing: { routingProvider: 'Jupiter via Cloak', exactDexRoute: 'provider-managed and not authorization-bound' } });
  expect(evidenceText).not.toMatch(/inputNotes|outputNotes|privateKey|viewingKeyNk|noteSalt|blinding|passphrase/);
  await page.getByRole('button', { name: 'Execute', exact: true }).first().click();
  await expect(panel.getByRole('button', { name: 'Review and authorize Cloak execution' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Execute swap', exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Open encrypted vault and live preparation' }).click();
  await expect(panel.getByLabel('Local vault passphrase')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Unlock durable local vault' })).toBeDisabled();
  await expect(panel.getByText(/Restored attempts allow inspection only/)).toBeVisible();
  expect(external).toEqual([]);
});

test('unsupported original request cannot become a public Jupiter swap', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel(/Describe a mock edit/).fill('Swap 5 USDC to SOL privately');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('USDC → private SOL is unavailable');
  await expect(page.getByRole('button', { name: 'Apply proposal', exact: true })).toHaveCount(0);
});

test('product LOCAL demo records the existing lifecycle, encrypted restart and reconciliation without network or a wallet', async ({ page }) => {
  test.setTimeout(90_000);
  const external: string[] = [];
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.addInitScript(() => {
    (window as unknown as { demoWalletRequests: number }).demoWalletRequests = 0;
    window.addEventListener('wallet-standard:app-ready', event => {
      const app = (event as CustomEvent).detail;
      const account = { address: '11111111111111111111111111111111', chains: ['solana:mainnet'], features: ['solana:signMessage', 'solana:signTransaction'] };
      const forbidden = () => { (window as unknown as { demoWalletRequests: number }).demoWalletRequests++; throw new Error('NO_REAL_WALLET'); };
      app.register({ name: 'Forbidden real wallet', accounts: [account], chains: account.chains, features: {
        'standard:connect': { connect: forbidden }, 'solana:signMessage': { signMessage: forbidden }, 'solana:signTransaction': { signTransaction: forbidden } } });
    });
  });
  await page.goto('/');
  await page.getByLabel(/Describe a mock edit/).fill('swap 0.02 SOL to USDC privately');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Privacy: REQUIRED / Cloak. USDC proceeds are public. Remaining SOL change stays private.')).toBeVisible();
  await page.getByRole('button', { name: 'Apply proposal', exact: true }).click();
  await page.getByRole('button', { name: 'Simulate', exact: true }).first().click();
  await page.getByRole('button', { name: 'Run Privacy Demo', exact: true }).click();
  const demo = page.getByRole('region', { name: 'Privacy local demo' });
  await expect(demo.getByText('LOCAL DEMO / MOCKED EXECUTION — NO MAINNET TRANSACTION', { exact: true })).toBeVisible();
  await demo.getByRole('button', { name: 'Simulate local privacy swap' }).click();
  await expect(demo.getByRole('status').first()).toContainText('SIMULATED', { timeout: 30_000 });
  await expect(demo.getByText('2.985 USDC', { exact: true })).toBeVisible();
  await expect(demo.getByText('2.970075 USDC', { exact: true })).toBeVisible();
  await expect(demo.getByText('0.01 SOL', { exact: true })).toBeVisible();
  const captureStyle = '[aria-label="Privacy local demo"] > p:first-child { position: static !important; }';
  await demo.screenshot({ path: '.turbo/privacy001-demo-simulation.png', style: captureStyle });
  await expect(demo.getByRole('button', { name: 'Execute in LOCAL DEMO' })).toHaveCount(0);
  await demo.getByRole('button', { name: 'Review privacy and simulated amounts' }).click();
  await demo.getByRole('button', { name: 'Show bound Manifest' }).click();
  await expect(demo.getByText(/Manifest hash: 0x/)).toBeVisible();
  await demo.screenshot({ path: '.turbo/privacy001-demo-manifest.png', style: captureStyle });
  await expect(demo.getByRole('button', { name: 'Authorize LOCAL demo' })).toBeDisabled();
  await demo.getByRole('checkbox', { name: 'I approve this LOCAL simulation, privacy policy and Manifest.' }).check();
  await demo.getByRole('button', { name: 'Authorize LOCAL demo' }).click();
  await demo.getByRole('button', { name: 'Execute in LOCAL DEMO' }).click();
  await expect(demo.getByRole('status').first()).toContainText('EXECUTED');
  await expect(demo.getByText('Encrypted intent and input/nonce reservations: committed.')).toBeVisible();
  await demo.getByRole('button', { name: 'Simulate restart & recover' }).click();
  await expect(demo.getByRole('heading', { name: 'RECONCILED — LOCAL / MOCKED' })).toBeVisible();
  await demo.screenshot({ path: '.turbo/privacy001-demo-reconciled.png', style: captureStyle });
  await expect(demo.getByRole('status').first()).toContainText('Ledger submissions: 1 · Wallet signatures: 0');
  await expect(demo.getByRole('button', { name: 'Execute in LOCAL DEMO' })).toHaveCount(0);
  const downloading = page.waitForEvent('download'); await demo.getByRole('button', { name: 'Export LOCAL demo evidence' }).click();
  const download = await downloading; await download.saveAs('.turbo/privacy001-local-demo-evidence.json');
  const text = await readFile('.turbo/privacy001-local-demo-evidence.json', 'utf8');
  expect(JSON.parse(text)).toMatchObject({ format: 'flofi.cloak-local-demo-evidence.v1', phase: 'RECOVERED', submissions: 1, signatureRequests: 0, restarts: 1,
    review: { environment: 'LOCAL', evidence: 'MOCKED', expectedOutput: '2985000', minimumOutput: '2970075', privateChange: '10000000' },
    outcome: { state: 'RECONCILED' }, checkpoints: { intent: true, reconciled: true }, evidence: { verdict: { verdict: 'RECONCILED' } } });
  expect(text).not.toMatch(/inputNotes|outputNotes|privateKey|viewingKeyNk|noteSalt|blinding|passphrase|rawResult/);
  await demo.getByRole('button', { name: 'Simulate restart & recover' }).click();
  await expect(demo.getByText(/Controller restarts: 2/)).toBeVisible();
  await expect(demo.getByRole('status').first()).toContainText('Ledger submissions: 1');
  await demo.getByRole('button', { name: 'Close local demo' }).click();
  await page.getByRole('button', { name: 'Execute', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Review and authorize Cloak execution' })).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { demoWalletRequests: number }).demoWalletRequests)).toBe(0);
  expect(external).toEqual([]);
});

test('actual browser ceremony proof and Manifest with SYNTHETIC notes and MOCKED mainnet reads, no signing/submission', async ({ page }) => {
  test.skip(!process.env.CLOAK_VERIFIED_CIRCUITS_DIRECTORY, 'Requires SDK-verified offline ceremony bytes; never substitutes circuits.');
  test.setTimeout(120_000);
  const circuits = process.env.CLOAK_VERIFIED_CIRCUITS_DIRECTORY!, secret = 'synthetic browser test vault unlock only', owner = '11111111111111111111111111111111';
  const key = await generateUtxoKeypair(), input = await createUtxo(30_000_000n, key, CLOAK_RUNTIME.nativeMint); input.index = 0;
  const privateState = await buildCloakPrivateState({ identity: { runId: 'cloak-' + 'd'.repeat(32), owner, genesisHash: CLOAK_RUNTIME.genesisHash,
    programId: CLOAK_RUNTIME.programId, manifestHash: '0x' + '0'.repeat(64) }, inputUtxos: [input], swapAmount: 20_000_000n, viewingKeyNk: getNkFromUtxoPrivateKey(key.privateKey) });
  const records = new Map<string, string>(), vault = new PrivateStateVault({ get: async k => records.get(k) ?? null,
    putNew: async (k, v) => { if (records.has(k)) throw new Error('DUPLICATE'); records.set(k, v); } }, secret);
  const reference = await vault.save(privateState), encryptedBackup = await vault.encryptedBackup(reference);
  const tree = await MerkleTree.create(32, [input.commitment!]), merkle = (await getShieldPoolPDAs(CLOAK_RUNTIME.programId, CLOAK_RUNTIME.nativeMint)).merkleTree;
  const [config] = await findProgramAddress(['pool_config', addressBytes(CLOAK_RUNTIME.nativeMint)], CLOAK_RUNTIME.programId);
  const poolConfig = new Uint8Array(27); poolConfig[0] = 1; poolConfig[1] = 255; const v = new DataView(poolConfig.buffer);
  v.setBigUint64(2, 5_000_000n, true); v.setBigUint64(10, 3n, true); v.setBigUint64(18, 1000n, true);
  const treeAccount = new Uint8Array(1096); treeAccount.set(Buffer.from(tree.root().toString(16).padStart(64, '0'), 'hex'), 1064);
  const wasm = await readFile(join(circuits, 'transaction_js/transaction.wasm')), zkey = await readFile(join(circuits, 'transaction_final.zkey'));
  const forbidden: string[] = [], reads: string[] = [];
  await page.addInitScript(() => {
    // Test-only storage grant; production still requires the real persistent-storage decision.
    Object.defineProperty(navigator.storage, 'persisted', { value: async () => true });
    Object.defineProperty(navigator.storage, 'persist', { value: async () => true });
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()); if (url.hostname === '127.0.0.1') return route.continue();
    const headers = { 'Access-Control-Allow-Origin': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...headers, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST,GET' } });
    if (url.hostname === 'storage.googleapis.com' && route.request().method() === 'GET') {
      if (url.pathname.endsWith('/transaction_js/transaction.wasm')) return route.fulfill({ headers, contentType: 'application/wasm', body: wasm });
      if (url.pathname.endsWith('/transaction_final.zkey')) return route.fulfill({ headers, contentType: 'application/octet-stream', body: zkey });
    }
    if (url.hostname === 'api.cloak.ag' && route.request().method() === 'GET' && url.pathname === '/commitments') {
      reads.push('commitments'); return route.fulfill({ headers, json: { canonical: true, target_reached: true, commitments: [{ index: 0, commitment: privateState.inputNotes[0]!.commitment }] } });
    }
    if (url.hostname === 'api.mainnet-beta.solana.com') {
      const request = route.request().postDataJSON() as { id: string; method: string; params: unknown[] };
      let result: unknown;
      if (request.method === 'getGenesisHash') result = CLOAK_RUNTIME.genesisHash;
      else if (request.method === 'getSlot') result = 500;
      else if (request.method === 'getSignaturesForAddress') result = [];
      else if (request.method === 'getMultipleAccounts') result = { context: { slot: 500 }, value: (request.params[0] as unknown[]).map(() => null) };
      else if (request.method === 'getAccountInfo') {
        const address = request.params[0], data = address === config ? poolConfig : address === merkle ? treeAccount : null;
        result = { context: { slot: 500 }, value: data ? { owner: CLOAK_RUNTIME.programId, executable: false, lamports: 10000000, rentEpoch: 1,
          space: data.length, data: [Buffer.from(data).toString('base64'), 'base64'] } : null };
      } else { forbidden.push(request.method); return route.abort(); }
      reads.push(request.method); return route.fulfill({ headers, json: { jsonrpc: '2.0', id: request.id, result } });
    }
    forbidden.push(url.toString()); return route.abort();
  });
  await page.goto('/'); await page.getByLabel(/Describe a mock edit/).fill('swap 0.02 SOL to USDC privately');
  await page.getByRole('button', { name: 'Send', exact: true }).click(); await page.getByRole('button', { name: 'Apply proposal', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Cloak privacy workflow' }); await panel.getByRole('button', { name: 'Open encrypted vault and live preparation' }).click();
  await panel.getByLabel('Local vault passphrase').fill(secret); await panel.getByRole('button', { name: 'Unlock durable local vault' }).click();
  await panel.getByLabel('Import encrypted recovery bundle').setInputFiles({ name: 'synthetic-encrypted-notes.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'flofi.cloak-note-backup.v1', reference, encryptedBackup })) });
  await panel.getByLabel('Exact recipient USDC ATA').fill(await cloakOwnerUsdcAta(owner));
  await panel.getByLabel(/Minimum public USDC output/).fill('1000000');
  await panel.getByRole('button', { name: 'Prepare proof and property review' }).click();
  await expect(panel.getByText('Review → Manifest → Authorization')).toBeVisible({ timeout: 90_000 });
  await expect(panel.getByText(/Groth16 proof verified locally/)).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Authorize reviewed Cloak request' })).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Register recovery viewing key with Cloak' })).toBeDisabled();
  const exporting = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export complete encrypted recovery backup' }).click();
  const backup = await exporting; await backup.saveAs('.turbo/privacy001-synthetic-live-backup.json');
  const backupText = await readFile('.turbo/privacy001-synthetic-live-backup.json', 'utf8');
  expect(backupText).not.toContain(privateState.viewingKeyNk); expect(backupText).not.toContain(privateState.inputNotes[0]!.bytes);
  expect(JSON.parse(backupText)).toMatchObject({ format: 'flofi.cloak-live-backup.v1', records: { prepared: expect.any(String), 'execution.prepared': expect.any(String), 'execution.journal.6': expect.any(String) } });
  await panel.getByRole('button', { name: 'Lock vault' }).click();
  await panel.getByLabel('Local vault passphrase').fill(secret); await panel.getByRole('button', { name: 'Unlock durable local vault' }).click();
  await panel.getByRole('button', { name: 'Inspect finalized chain and resume reconciliation' }).click();
  await expect(panel.getByText('REVIEW_REQUIRED: CLOAK_LIVE_NOT_SUBMITTED')).toBeVisible();
  expect(reads).toContain('commitments'); expect(reads).toContain('getMultipleAccounts'); expect(forbidden).toEqual([]);
});
