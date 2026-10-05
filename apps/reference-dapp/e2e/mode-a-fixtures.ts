// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-003F local-fork Mode A browser fixtures. The injected EIP-1193 provider is a guarded test
 * adapter: the page reaches it only through a Playwright binding (no browser network request), and
 * Node forwards signing to Anvil's unlocked local test account on loopback chain 31337. Faults are
 * injected here, after the application built the exact request. It never touches a real wallet,
 * a provider credential or any public chain.
 */
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { decodeSwap, encodeApprove, encodeSwap, fromHex, toHex } from '@defi-workflow-engine/reference-compiler';
import { test as guarded, expect } from './fixtures';

export type ModeAFixture = { readonly format: 'gryloo.mode-a-e2e-fixture.v1'; readonly environment: 'MOCKED' | 'FORK_REPRODUCED';
  readonly rpcUrl: string; readonly owner: string; readonly setup: string; baseline: string; readonly journal: string };
export type WalletFault = { mutate?: 'gas' | 'recipient'; dropResponse?: boolean; reject?: boolean; chainId?: string; account?: string };
export type WalletCall = { readonly method: string; readonly params: readonly unknown[] };
const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const ROUTER = '0x2626664c2603336e57b271c5c0b26f421741e481';
export const MODE_A_E2E = process.env.GRYLOO_MODE_A_E2E === 'replay' ? 'replay' as const : 'synthetic' as const;

function runtimePath(): string {
  const runtime = process.env.GRYLOO_MODE_A_RUNTIME;
  if (!runtime || !runtime.startsWith('/')) throw new Error('GRYLOO_MODE_A_RUNTIME is required');
  return runtime;
}
function readFixture(): ModeAFixture {
  const value = JSON.parse(readFileSync(join(runtimePath(), 'fixture.json'), 'utf8')) as ModeAFixture;
  if (value.format !== 'gryloo.mode-a-e2e-fixture.v1' || value.rpcUrl !== 'http://127.0.0.1:8545') throw new Error('MODE_A_FIXTURE_INVALID');
  return value;
}
export async function forkRpc(method: string, params: unknown[] = []): Promise<unknown> {
  const response = await fetch('http://127.0.0.1:8545', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20_000) });
  const body = await response.json() as { result?: unknown; error?: { message?: string } };
  if (body.error || !('result' in body)) throw new Error(`FORK_RPC_${method}:${body.error?.message ?? 'invalid'}`);
  return body.result;
}
const hex = (value: bigint) => `0x${value.toString(16)}`;

export type ForkControl = {
  readonly fixture: ModeAFixture;
  mine(blocks?: number): Promise<void>;
  automine(enabled: boolean): Promise<void>;
  pendingCount(): Promise<number>;
  /** The reviewed acceptance price move: the setup account swaps 1 WETH in the quoted pool. */
  movePrice(fee: number): Promise<void>;
  preparedFiles(): readonly string[];
};
/**
 * The exact transaction shape of `fork-setup.mjs` sendSetupTransaction (pending nonce, fixed gas and
 * priority fee, twice the base fee), so the price move equals the recorded one byte for byte.
 */
async function sendSetup(from: string, to: string, data: string, value = 0n): Promise<void> {
  const nonce = BigInt(await forkRpc('eth_getTransactionCount', [from, 'pending']) as string);
  const head = await forkRpc('eth_getBlockByNumber', ['latest', false]) as { baseFeePerGas: string };
  const hash = await forkRpc('eth_sendTransaction', [{ from, to, data, value: hex(value), nonce: hex(nonce),
    maxFeePerGas: hex(BigInt(head.baseFeePerGas) * 2n + 1_000_000n), gas: '0xf4240', maxPriorityFeePerGas: '0xf4240' }]) as string;
  for (let i = 0; i < 400; i++) {
    const receipt = await forkRpc('eth_getTransactionReceipt', [hash]) as { status?: string } | null;
    if (receipt) { if (receipt.status !== '0x1') throw new Error('SETUP_PRICE_MOVE_FAILED'); return; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('SETUP_PRICE_MOVE_TIMEOUT');
}
async function resetFork(): Promise<ModeAFixture> {
  const fixture = readFixture();
  if (await forkRpc('eth_chainId') !== '0x7a69') throw new Error('MODE_A_E2E_CHAIN_REFUSED');
  if (await forkRpc('evm_revert', [fixture.baseline]) !== true) throw new Error('MODE_A_E2E_RESET_FAILED');
  await forkRpc('anvil_setAutomine', [true]);
  fixture.baseline = await forkRpc('evm_snapshot') as string;
  writeFileSync(join(runtimePath(), 'fixture.json'), `${JSON.stringify(fixture)}\n`, { mode: 0o600 });
  // Each test starts from the same fork state with an empty local journal.
  for (const entry of readdirSync(fixture.journal)) rmSync(join(fixture.journal, entry), { recursive: true, force: true });
  return fixture;
}

export class TestWallet {
  readonly calls: WalletCall[] = [];
  readonly sent: Record<string, string>[] = [];
  fault: WalletFault = {};
  constructor(private readonly fixture: ModeAFixture) {}
  async handle(method: string, params: unknown[]): Promise<{ ok: true; result: unknown } | { ok: false; code: number; message: string }> {
    this.calls.push({ method, params });
    if (method === 'eth_chainId') return { ok: true, result: this.fault.chainId ?? '0x7a69' };
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return { ok: true, result: [this.fault.account ?? this.fixture.owner] };
    if (method !== 'eth_sendTransaction') return { ok: false, code: 4200, message: 'Unsupported by the test adapter' };
    const request = { ...(params[0] as Record<string, string>) };
    this.sent.push({ ...request });
    if (this.fault.reject) return { ok: false, code: 4001, message: 'User rejected the request' };
    if (request.from !== this.fixture.owner || request.chainId !== '0x7a69') return { ok: false, code: 4100, message: 'Unauthorized' };
    let fields = { ...request };
    if (this.fault.mutate === 'gas') fields = { ...fields, gas: hex(BigInt(fields.gas!) + 1n) };
    if (this.fault.mutate === 'recipient') fields = { ...fields, data: toHex(encodeSwap({ ...decodeSwap(fromHex(fields.data!)), recipient: this.fixture.setup })) };
    const raw = await forkRpc('eth_signTransaction', [fields]);
    const hash = await forkRpc('eth_sendRawTransaction', [raw]);
    if (this.fault.dropResponse) return { ok: false, code: -32603, message: 'Response lost after broadcast' };
    return { ok: true, result: hash };
  }
}

async function installWallet(page: Page, wallet: TestWallet): Promise<void> {
  await page.exposeFunction('__grylooTestWallet', (method: string, params: unknown[]) => wallet.handle(method, params));
  await page.addInitScript(() => {
    const bridge = (window as unknown as { __grylooTestWallet: (method: string, params: unknown[]) => Promise<{ ok: boolean; result?: unknown; code?: number; message?: string }> }).__grylooTestWallet;
    Object.defineProperty(window, 'ethereum', { configurable: false, value: Object.freeze({
      isGrylooTestWallet: true,
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        const reply = await bridge(method, params ?? []);
        if (reply.ok) return reply.result;
        throw Object.assign(new Error(reply.message ?? 'wallet error'), { code: reply.code });
      },
    }) });
  });
}

export const test = guarded.extend<{ fork: ForkControl; testWallet: TestWallet }>({
  // Playwright requires an object pattern for a fixture without dependencies.
  // eslint-disable-next-line no-empty-pattern
  fork: async ({}, use) => {
    const fixture = await resetFork();
    await use({
      fixture,
      mine: async (blocks = 1) => { for (let i = 0; i < blocks; i++) await forkRpc('evm_mine'); },
      automine: async enabled => { await forkRpc('anvil_setAutomine', [enabled]); },
      pendingCount: async () => {
        const pool = await forkRpc('txpool_content') as { pending?: Record<string, Record<string, unknown>> };
        return Object.values(pool.pending ?? {}).reduce((total, byNonce) => total + Object.keys(byNonce).length, 0);
      },
      movePrice: async fee => {
        const unit = 10n ** 18n;
        const head = await forkRpc('eth_getBlockByNumber', ['latest', false]) as { timestamp: string };
        await sendSetup(fixture.setup, WETH, '0xd0e30db0', unit);
        await sendSetup(fixture.setup, WETH, toHex(encodeApprove(ROUTER, unit)));
        await sendSetup(fixture.setup, ROUTER, toHex(encodeSwap({ tokenIn: WETH, tokenOut: USDC, fee: fee as 100 | 500 | 3000 | 10000,
          recipient: fixture.setup, amountIn: unit, amountOutMinimum: 1n, sqrtPriceLimitX96: 0n, deadline: BigInt(head.timestamp) + 180n })));
      },
      preparedFiles: () => readdirSync(fixture.journal).filter(name => name.startsWith('exec-')),
    });
    await forkRpc('anvil_setAutomine', [true]).catch(() => undefined);
  },
  testWallet: async ({ page, fork }, use) => {
    const wallet = new TestWallet(fork.fixture);
    await installWallet(page, wallet);
    await use(wallet);
  },
});
export { expect };

/** Wait for the approved fixed viewport, loaded fonts and final graph layout before a visual baseline. */
export async function readyForVisualCapture(page: Page): Promise<void> {
  expect(page.viewportSize()).toEqual({ width: 1440, height: 900 });
  await expect(page.locator('.fork-badge')).toContainText(/^Local fork · (MOCKED|FORK_REPRODUCED)$/);
  await page.evaluate(() => document.fonts.ready);
  const graph = page.getByRole('region', { name: 'Mocked outputs on the workflow graph' });
  if (await graph.isVisible()) await expect(graph).toHaveAttribute('data-viewport', 'fitted');
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** Visual baselines are the deterministic MOCKED synthetic environment; replay values legitimately differ. */
export async function visual(page: Page, name: string): Promise<void> {
  if (MODE_A_E2E !== 'synthetic') return;
  await readyForVisualCapture(page);
  await expect(page).toHaveScreenshot(name, { fullPage: true });
}
const stage = (page: Page, name: 'Build' | 'Simulate' | 'Execute') => page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name, exact: true }).click();
export async function authorSwap(page: Page, direction: 'WETH_TO_USDC' | 'USDC_TO_WETH', amount: string, slippage: string): Promise<void> {
  await stage(page, 'Build');
  await page.getByText('Advanced action setup', { exact: true }).click();
  await page.getByLabel('Direction').selectOption(direction);
  await page.getByLabel('Input amount (required)').fill(amount);
  await page.getByLabel('Slippage in bps (required)').fill(slippage);
  await page.getByRole('button', { name: 'Review swap proposal' }).click();
  await expect(page.getByText('Review proposed edit')).toBeVisible();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
}
export const forkPanel = (page: Page) => page.getByRole('region', { name: 'Local fork Mode A simulation' });
export const executionPanel = (page: Page) => page.getByRole('region', { name: 'Mode A execution' });
export async function openTechnicalDetails(page: Page): Promise<void> {
  await page.locator('.simulation-technical > summary').click();
}
export async function simulateOnFork(page: Page): Promise<void> {
  await stage(page, 'Simulate');
  await openTechnicalDetails(page);
  await forkPanel(page).getByRole('button', { name: /^Simulate on local fork for revision \d+$/ }).click();
  await expect(forkPanel(page).getByText('FORK: CURRENT', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(forkPanel(page).locator('[data-browser-verification="EXACT"]')).toBeVisible();
}
export async function reviewAndConnect(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Review swap' }).click();
  await expect(page.getByRole('region', { name: 'Mode A Manifest review' })).toBeVisible();
  await page.getByRole('button', { name: 'I reviewed both exact payloads' }).click();
  await executionPanel(page).getByRole('button', { name: 'Connect injected wallet' }).click();
  await expect(executionPanel(page).locator('.wallet-chip')).toBeVisible();
}
export const stepState = (page: Page, title: string) => executionPanel(page).getByRole('article', { name: title }).locator('[data-step-state]');
export async function requestStep(page: Page, title: 'Step 1 · approve exact input' | 'Step 2 · exact swap'): Promise<void> {
  await executionPanel(page).getByRole('article', { name: title }).getByRole('button', { name: /^Request wallet signature/ }).click();
}
export function preparedRecord(fork: ForkControl): { executionId: string; payloads: { stepId: string; bytes: string; payloadHash: string; request: Record<string, string> }[];
  fee: number; owner: string; environment: string } {
  const [executionId] = fork.preparedFiles();
  if (!executionId) throw new Error('MODE_A_PREPARED_MISSING');
  return JSON.parse(readFileSync(join(fork.fixture.journal, executionId, 'prepared.json'), 'utf8'));
}
