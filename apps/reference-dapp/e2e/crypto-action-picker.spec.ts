// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { selectSettingsTheme } from './settings-fixtures';
import { installSupplyWallet, setSupplyWalletChain } from './supply-fixtures';
for (const action of ['swap', 'pool', 'supply', 'borrow', 'repay', 'withdraw']) test(`${action} reuses Tokens / Networks with one supported action network`, async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/app');
  await expect(page.getByRole('combobox', { name: 'Environment', exact: true })).toHaveText('Testnet');
  await page.getByRole('button', { name: `Add ${action}`, exact: true }).click();
  const card = page.locator('.build-flow-surface .composer-card');
  await card.getByRole('textbox').first().fill('2.5');
  await card.getByRole('button', { name: 'Select source token', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Source asset picker', exact: true });
  const tokens = panel.getByRole('region', { name: 'Source token picker', exact: true });
  const networks = panel.getByRole('region', { name: 'Action network picker', exact: true });
  await expect(panel.locator('.composer-bridge-picker-columns')).toBeVisible();
  await expect(tokens.locator('.composer-bridge-picker-heading')).toHaveText('Tokens'); await expect(networks.locator('.composer-bridge-picker-heading')).toHaveText('Networks');
  const options = action === 'swap' || action === 'pool' ? ['Base Sepolia', 'Solana Devnet'] : ['Base Sepolia'];
  expect(await networks.getByRole('button').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')))).toEqual(options);
  await expect(networks.getByRole('button', { name: 'Base Sepolia', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(tokens.getByRole('radio', { name: 'USDC', exact: true })).toBeChecked();
  for (const unsupported of ['Base', 'Arbitrum', 'Arbitrum Sepolia', 'Solana']) await expect(networks.getByRole('button', { name: unsupported, exact: true })).toHaveCount(0);
  if (action === 'swap' || action === 'pool') {
    if (action === 'pool') await card.getByRole('textbox').nth(1).fill('0.01');
    const review = card.getByRole('button', { name: action === 'swap' ? 'Review amount' : 'Review', exact: true });
    const apply = card.getByRole('button', { name: action === 'swap' ? 'Apply amount' : 'Apply', exact: true });
    await review.click(); await expect(apply).toBeEnabled();
    await networks.getByRole('button', { name: 'Solana Devnet', exact: true }).click();
    await expect(apply).toBeDisabled();
    await expect(card.getByRole('button', { name: 'Select source token', exact: true })).toHaveAttribute('title', 'SOL on Solana Devnet');
    await expect(card.getByRole('button', { name: 'Select destination token', exact: true })).toHaveAttribute('title', 'devUSDC on Solana Devnet');
    await expect(card.getByRole('textbox').first()).toHaveValue('2.5');
    expect(await tokens.getByRole('radio').evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value))).toEqual(action === 'swap' ? ['SOL', 'devUSDC'] : ['SOL']);
    await expect(tokens.getByRole('radio', { name: 'WETH', exact: true })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Hide token picker', exact: true }).click();
    await card.getByRole('button', { name: 'Select destination token', exact: true }).click();
    const destination = page.getByRole('region', { name: 'Destination asset picker', exact: true });
    await expect(destination.getByRole('button', { name: 'Solana Devnet', exact: true })).toHaveAttribute('aria-pressed', 'true');
    // Changing the network through either asset updates the entire action.
    await destination.getByRole('button', { name: 'Base Sepolia', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Select source token', exact: true })).toHaveAttribute('title', 'USDC on Base Sepolia');
    await expect(card.getByRole('button', { name: 'Select destination token', exact: true })).toHaveAttribute('title', 'WETH on Base Sepolia');
    await destination.getByRole('button', { name: 'Solana Devnet', exact: true }).click();
    await destination.getByRole('button', { name: 'Hide token picker', exact: true }).click();
    await review.click(); await expect(apply).toBeEnabled(); await apply.click();
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
    await expect(card.getByRole('button', { name: 'Select source token', exact: true })).toHaveAttribute('title', 'SOL on Solana Devnet');
    await expect(card.getByRole('button', { name: 'Select destination token', exact: true })).toHaveAttribute('title', 'devUSDC on Solana Devnet');
    // The same invariant holds when editing an already-authored action.
    await card.getByRole('button', { name: 'Select source token', exact: true }).click();
    await page.getByRole('region', { name: 'Source asset picker', exact: true }).getByRole('button', { name: 'Base Sepolia', exact: true }).click();
    await page.getByRole('region', { name: 'Source asset picker', exact: true }).getByRole('button', { name: 'Hide token picker', exact: true }).click();
    await expect(apply).toBeDisabled();
    await review.click(); await expect(apply).toBeEnabled(); await apply.click();
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '2');
    await expect(card.getByRole('button', { name: 'Select source token', exact: true })).toHaveAttribute('title', 'USDC on Base Sepolia');
    await expect(card.getByRole('button', { name: 'Select destination token', exact: true })).toHaveAttribute('title', 'WETH on Base Sepolia');
  } else {
    await panel.getByRole('button', { name: 'Hide token picker', exact: true }).click();
    await card.getByRole('button', { name: `Review ${action[0]!.toUpperCase() + action.slice(1)} change`, exact: true }).click();
    await card.getByRole('button', { name: 'Apply proposal', exact: true }).click();
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
    await expect(card.getByRole('button', { name: 'Select source token', exact: true })).toHaveAttribute('title', 'USDC on Base Sepolia');
    await setSupplyWalletChain(page, '0x2105');
    await card.getByRole('button', { name: 'Select source token', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Action network picker', exact: true }).getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Source token picker', exact: true }).getByRole('radio')).toHaveCount(0);
    await expect(card.getByRole('button', { name: `Review ${action[0]!.toUpperCase() + action.slice(1)} change`, exact: true })).toBeDisabled();
  }
});

for (const theme of ['Light', 'Dark']) test(`${theme} Swap shares live environment filtering, independent assets and neutral unknown networks`, async ({ page }) => {
  await installSupplyWallet(page, { chain: '0x2105' }); await page.goto('/app');
  await expect(page.getByRole('combobox', { name: 'Environment', exact: true })).toHaveText('Mainnet');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await selectSettingsTheme(page, theme); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Add swap', exact: true }).click();
  const card = page.locator('.build-flow-surface .composer-card');
  await card.getByRole('textbox').fill('1');
  await card.getByRole('button', { name: 'Select source token', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Source asset picker', exact: true }), networks = panel.getByRole('region', { name: 'Action network picker', exact: true });
  expect(await networks.getByRole('button').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')))).toEqual(['Base', 'Solana']);
  await networks.getByRole('button', { name: 'Solana', exact: true }).click();
  expect(await panel.getByRole('radio').evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value))).toEqual(['SOL', 'USDC', 'USDT']);
  await panel.getByRole('button', { name: 'Hide token picker', exact: true }).click();
  await card.getByRole('button', { name: 'Select destination token', exact: true }).click();
  await page.getByRole('region', { name: 'Destination token picker', exact: true }).locator('label').filter({ hasText: 'USDT' }).click();
  await expect(card.getByRole('button', { name: 'Select source token', exact: true })).toHaveAttribute('title', 'USDC on Solana');
  await expect(card.getByRole('button', { name: 'Select destination token', exact: true })).toHaveAttribute('title', 'USDT on Solana');
  await setSupplyWalletChain(page, '0x66eee');
  await expect(page.getByRole('combobox', { name: 'Environment', exact: true })).toHaveText('Testnet');
  await expect(card.getByRole('button', { name: 'Select source token', exact: true })).toHaveAttribute('title', 'USDC on Base Sepolia');
  await expect(card.getByRole('button', { name: 'Select destination token', exact: true })).toHaveAttribute('title', 'WETH on Base Sepolia');
  expect(await page.getByRole('region', { name: 'Action network picker', exact: true }).getByRole('button').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')))).toEqual(['Base Sepolia', 'Solana Devnet']);
  await setSupplyWalletChain(page, '0x999999');
  await expect(page.getByRole('combobox', { name: 'Environment', exact: true })).toHaveText('Network');
  await expect(page.getByRole('region', { name: 'Action network picker', exact: true }).getByRole('button')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Review amount', exact: true })).toBeDisabled();
});
