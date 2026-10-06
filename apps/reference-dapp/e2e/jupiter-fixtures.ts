// SPDX-License-Identifier: AGPL-3.0-only
import { openProposalReview, openSimulationDetails, acceptProductReview } from './fixtures';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { createMockedSolanaWallet } from '@defi-workflow-engine/reference-compiler';

/** MOCKED Wallet Standard wallet. Its disposable key lives only in this test process's memory. */
export async function resetJupiterHarness(options: Record<string, unknown> = {}, funding: { lamports?: string; usdc?: string } = {}) {
  if (process.env.GRYLOO_JUPITER_E2E !== 'MOCKED_LOOPBACK_ONLY' || !process.env.GRYLOO_JUPITER_JOURNAL?.startsWith(join(tmpdir(), 'gryloo-build014-'))) throw new Error('MOCK_RESET_DENIED');
  await rm(process.env.GRYLOO_JUPITER_JOURNAL, { recursive: true, force: true });
  const wallet = createMockedSolanaWallet();
  await jupiterControl({ action: 'reset', owner: wallet.owner, options, ...funding });
  return wallet;
}
export async function jupiterControl(body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch('http://127.0.0.1:8551/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return (await response.json() as { result: unknown }).result;
}
export async function installSolanaWallet(page: Page, wallet: ReturnType<typeof createMockedSolanaWallet>, behavior: { reject?: boolean; modify?: string; pause?: boolean; chains?: string[]; decoys?: { name: string; chains: string[] }[];
  signMessage?: boolean } = {}) {
  await page.exposeFunction('grylooJupiterTestSign', async (unsigned: string) => behavior.modify ? wallet.sign(behavior.modify) : wallet.sign(unsigned));
  // BUILD-MCP-002: optional Sign-In With Solana support (Wallet Standard `solana:signMessage`), signed in this test process only.
  if (behavior.signMessage) await page.exposeFunction('grylooSolanaTestSignMessage', async (base64: string) =>
    Buffer.from(wallet.signMessage(Uint8Array.from(Buffer.from(base64, 'base64')))).toString('base64'));
  await page.addInitScript(({ owner, behavior }) => {
    const w = window as unknown as { grylooJupiterTestSign: (tx: string) => Promise<string>; solanaSignRequests: number; solanaSignChains: string[]; decoyWalletCalls: string[];
      releaseSolanaSignature?: () => void };
    w.solanaSignRequests = 0; w.solanaSignChains = []; w.decoyWalletCalls = [];
    // Decoy providers registered BEFORE the owner's wallet; any use of them is recorded and fails.
    const decoys = behavior.decoys.map(decoy => { const decoyAccount = { address: '11111111111111111111111111111111', publicKey: new Uint8Array(32), chains: decoy.chains, features: ['solana:signTransaction'] };
      const use = (what: string) => { w.decoyWalletCalls.push(decoy.name + ':' + what); throw new Error('Decoy wallet must never be used'); };
      return { version: '1.0.0', name: decoy.name, icon: 'data:image/svg+xml;base64,PHN2Zy8+', chains: decoy.chains, accounts: [decoyAccount], features: {
        'standard:connect': { version: '1.0.0', connect: async () => use('connect') },
        'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: [0], signTransaction: async () => use('sign') } } }; });
    const account = { address: owner, publicKey: new Uint8Array(32), chains: behavior.chains, features: behavior.signMessage ? ['solana:signTransaction', 'solana:signMessage'] : ['solana:signTransaction'] };
    const signMessageFeature = behavior.signMessage ? { 'solana:signMessage': { version: '1.0.0', signMessage: async (...inputs: { message: Uint8Array }[]) => {
      const signer = (window as unknown as { grylooSolanaTestSignMessage: (b64: string) => Promise<string> }).grylooSolanaTestSignMessage;
      const signature = await signer(btoa(Array.from(inputs[0]!.message, b => String.fromCharCode(b)).join('')));
      return [{ signedMessage: inputs[0]!.message, signature: Uint8Array.from(atob(signature), c => c.charCodeAt(0)) }];
    } } } : {};
    const toB64 = (bytes: Uint8Array) => btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
    const wallet = { version: '1.0.0', name: 'Gryloo MOCKED Solana wallet', icon: 'data:image/svg+xml;base64,PHN2Zy8+', chains: behavior.chains, accounts: [account],
      features: {
        'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [account] }) },
        'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: [0], signTransaction: async (...inputs: { transaction: Uint8Array; chain?: string }[]) => {
          w.solanaSignRequests++; w.solanaSignChains.push(String(inputs[0]?.chain));
          if (behavior.pause) await new Promise<void>(resolve => { w.releaseSolanaSignature = resolve; });
          if (behavior.reject) throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
          const signed = await w.grylooJupiterTestSign(toB64(inputs[0]!.transaction));
          return [{ signedTransaction: Uint8Array.from(atob(signed), c => c.charCodeAt(0)) }];
        } }, ...signMessageFeature,
      } };
    const register = (api: { register: (w: unknown) => void }) => { for (const decoy of decoys) api.register(decoy); api.register(wallet); };
    window.addEventListener('wallet-standard:app-ready', event => register((event as CustomEvent).detail));
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }));
  }, { owner: wallet.owner, behavior: { reject: Boolean(behavior.reject), pause: Boolean(behavior.pause), chains: behavior.chains ?? ['solana:mainnet'], decoys: behavior.decoys ?? [],
    signMessage: Boolean(behavior.signMessage) } });
}
export async function authorSolanaSwap(page: Page, via: 'canvas' | 'chat' = 'canvas') {
  await page.goto('/');
  if (via === 'chat') {
    await page.locator('#mock-prompt').fill('Swap 10 USDC to SOL on Solana');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
  } else {
    await page.getByText('Advanced action setup').click();
    await page.locator('#swap-network').selectOption('SOLANA');
    const form = page.getByRole('form', { name: 'Create Solana swap' });
    await form.getByLabel('From token').selectOption('USDC'); await form.getByLabel('To token').selectOption('SOL');
    await form.getByLabel('Amount').fill('10');
    await form.getByRole('button', { name: 'Review swap proposal' }).click();
  }
  await openProposalReview(page);
  await page.getByRole('button', { name: 'Apply proposal' }).click();
}
export async function reviewSolanaSwap(page: Page) {
  await page.getByRole('button', { name: 'Simular Fees' }).click(); await openSimulationDetails(page);
  const panel = page.getByRole('region', { name: 'Jupiter swap' });
  await chooseSolanaWallet(panel);
  await panel.getByRole('button', { name: 'Simulate swap' }).click();
  await panel.getByRole('definition').filter({ hasText: '→ expected' }).waitFor();
  await acceptProductReview(page);
}
export const signRequests = (page: Page) => page.evaluate(() => (window as unknown as { solanaSignRequests: number }).solanaSignRequests);
export const signChains = (page: Page) => page.evaluate(() => (window as unknown as { solanaSignChains: string[] }).solanaSignChains);
export const MOCKED_SOLANA_WALLET = 'Gryloo MOCKED Solana wallet';
/** Connect explicitly: open the wallet list and pick the named wallet. */
export async function chooseSolanaWallet(panel: Locator, name = MOCKED_SOLANA_WALLET) {
  await panel.getByRole('button', { name: 'Connect Solana wallet' }).click();
  await panel.getByRole('group', { name: 'Choose a Solana wallet' }).getByRole('button', { name, exact: true }).click();
}
export const decoyWalletCalls = (page: Page) => page.evaluate(() => (window as unknown as { decoyWalletCalls: string[] }).decoyWalletCalls);
