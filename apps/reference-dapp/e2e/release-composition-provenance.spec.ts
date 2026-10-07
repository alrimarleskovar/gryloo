// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, applyPendingProposal, openSimulationDetails } from './fixtures';
import { profile, fork, snapshot } from './composition-fixtures';
import { assertExecutionBlocked } from './release-safety-fixtures';

test('Pinned local composition requires shared Review without automatically installing or executing', async ({ page }) => {
  const p = profile();
  expect(p.environment).toBe('FORK_REPRODUCED');
  const restore = await snapshot();
  try {
    const slot = await fork('eth_call', [{ to: p.liquidity.pool, data: '0x3850c7bd' }, 'latest']) as string;
    const bits = Number(BigInt('0x' + slot.slice(66, 130)) & 0xffffffn);
    const tick = bits >= 0x800000 ? bits - 0x1000000 : bits;
    const center = Math.floor(tick / 10) * 10;
    const calls: string[] = [];
    await page.exposeFunction('releaseCompositionWallet', (method: string) => {
      calls.push(method);
      if (method === 'eth_accounts') return [p.owner];
      if (method === 'eth_chainId') return '0x7a69';
      throw new Error('Read-only composition wallet refused ' + method);
    });
    await page.addInitScript(() => {
      const w = window as unknown as { ethereum: unknown; releaseCompositionWallet(method: string): Promise<unknown> };
      w.ethereum = { request: ({ method }: { method: string }) => w.releaseCompositionWallet(method) };
    });
    await page.goto('/');
    await page.getByLabel('Describe your flow').fill(`compose swap 400 USDC to WETH slippage 100 bps then mint maximum 0.1 WETH and 200 USDC minimum 0.000001 WETH and 0.001 USDC ticks ${center - 100} to ${center + 100} safe ${p.safe}`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await applyPendingProposal(page);
    await page.getByRole('button', { name: 'Simulate', exact: true }).click();
    await openSimulationDetails(page);
    const panel = page.getByRole('region', { name: 'Mode B swap to liquidity composition', exact: true });
    await panel.getByRole('button', { name: 'Prepare chained review', exact: true }).click();
    await expect(panel).toContainText('Permission hash', { timeout: 30_000 });
    const requests = async () => calls.filter(method => method === 'eth_sendTransaction').length;
    const approve = page.getByRole('button', { name: 'Approve & Continue', exact: true });
    await expect(approve).toBeEnabled();
    await expect(page.getByRole('region', { name: 'Authorization technical details', exact: true })).toContainText('Strategy Manifest');
    await assertExecutionBlocked(page, requests);
    await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate', exact: true }).click();
    await approve.click();
    await expect(page.getByRole('button', { name: 'Review approved', exact: true })).toBeDisabled();
    expect(await requests()).toBe(0);
    await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true }).click();
    // Shared Review must not silently connect the execution wallet or install
    // delegated authority. The passive global wallet is insufficient.
    await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Connect execution wallet', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /Download.*Evidence Bundle/ })).toHaveCount(0);
    expect(await requests()).toBe(0);
    await page.reload();
    await assertExecutionBlocked(page, requests);
    expect([...new Set(calls)].sort()).toEqual(['eth_accounts', 'eth_chainId']);
  } finally { await restore(); }
});
