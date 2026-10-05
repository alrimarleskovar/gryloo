// SPDX-License-Identifier: AGPL-3.0-only
import { authorLiquidity, expect, forkRpc, test } from './liquidity-fixtures';
import { LIQUIDITY_USDC, LIQUIDITY_WETH, POSITION_MANAGER } from '@defi-workflow-engine/reference-compiler';
import type { LiquidityOperation } from '../src/server/liquidity-service';
test.skip(process.env.GRYLOO_LIQUIDITY_E2E !== 'replay', 'Requires the BUILD-006 closed transcript and opt-in local liquidity profile');
const stage = (page: import('@playwright/test').Page, name: 'Build' | 'Simulate' | 'Execute') =>
  page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name, exact: true }).click();
async function operation(page: import('@playwright/test').Page, name: LiquidityOperation, tokenId?: string) {
  await stage(page, 'Simulate');
  await page.locator('.simulation-technical > summary').click();
  const simulate = page.getByRole('region', { name: 'Local fork liquidity simulation' });
  await simulate.getByLabel('Next operation').selectOption(name);
  if (tokenId && !['APPROVE_WETH', 'APPROVE_USDC', 'MINT', 'RESET_WETH', 'RESET_USDC'].includes(name))
    await simulate.getByLabel('Position token ID').fill(tokenId);
  await simulate.getByRole('button', { name: 'Simulate exact local operation' }).click();
  await expect(simulate.locator('.liquidity-review h3')).toContainText(name.replaceAll('_', ' '));
  await stage(page, 'Execute');
  const execute = page.getByRole('region', { name: 'Local fork liquidity execution' });
  await expect(execute).toContainText('Review exact wallet payload');
  await execute.getByRole('button', { name: 'Accept exact review' }).click();
  await execute.getByRole('button', { name: 'Connect chain 31337 wallet' }).click();
  await expect(execute).toContainText('Automated test adapter');
  await execute.getByRole('button', { name: 'Request this wallet transaction' }).click();
  await expect(execute).toContainText('journal: PENDING');
  await execute.getByRole('button', { name: 'Read back and reconcile' }).click();
  await expect(execute).toContainText('outcome: RECONCILED');
  return execute;
}
async function allowance(token: string, owner: string): Promise<bigint> {
  const data = `0xdd62ed3e${owner.slice(2).padStart(64, '0')}${POSITION_MANAGER.slice(2).padStart(64, '0')}`;
  return BigInt(await forkRpc('eth_call', [{ to: token, data }, 'latest']) as string);
}
test('isolated position lifecycle uses one exact wallet signature per local operation', async ({ page, liquidity, testWallet }) => {
  test.setTimeout(180_000);
  const external: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:3000/')) external.push(request.url()); });
  await page.goto('/');
  await authorLiquidity(page, liquidity);
  await operation(page, 'APPROVE_WETH');
  await operation(page, 'APPROVE_USDC');
  const minted = await operation(page, 'MINT');
  const result = await minted.getByText(/Result EXACT_MINT/).textContent();
  const tokenId = /token ID ([1-9][0-9]*)/.exec(result ?? '')?.[1];
  expect(tokenId).toBeTruthy();
  await stage(page, 'Simulate');
  await page.locator('.simulation-technical > summary').click();
  const inspect = page.getByRole('region', { name: 'Local fork liquidity simulation' });
  await inspect.getByLabel('Next operation').selectOption('INCREASE');
  await inspect.getByLabel('Position token ID').fill(tokenId!);
  await inspect.getByRole('button', { name: 'Inspect position' }).click();
  await expect(inspect).toContainText(`Token #${tokenId}`);
  // Finite mint approvals may leave residue; reset each residue before a new exact approval.
  for (const [token, unit, reset, approve] of [
    [LIQUIDITY_WETH, 100000000000000000n, 'RESET_WETH', 'APPROVE_WETH'],
    [LIQUIDITY_USDC, 200000000n, 'RESET_USDC', 'APPROVE_USDC'],
  ] as const) {
    const current = await allowance(token, liquidity.owner);
    if (current < unit) {
      if (current > 0n) await operation(page, reset);
      await operation(page, approve);
    }
  }
  // Each remaining effect is independently prepared from fresh fork state and signed separately.
  await operation(page, 'INCREASE', tokenId);
  await operation(page, 'DECREASE_PARTIAL', tokenId);
  await operation(page, 'COLLECT_PARTIAL', tokenId);
  await operation(page, 'DECREASE_FULL', tokenId);
  await operation(page, 'COLLECT_FINAL', tokenId);
  await operation(page, 'BURN', tokenId);
  expect(testWallet.sent.length).toBeGreaterThanOrEqual(9);
  expect(external).toEqual([]);
  await expect(page.locator('body')).not.toContainText(/MAINNET_EXECUTED|TESTNET_EXECUTED|production certified/i);
});
