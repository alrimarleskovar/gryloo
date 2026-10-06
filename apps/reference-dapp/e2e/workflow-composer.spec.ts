// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { configureCanvasAction, configureCanvasPool, openCanvasSettings } from './composer-authoring-fixtures';
const owner = '0x1111111111111111111111111111111111111111';
const cards = (page: Page) => page.locator('.build-flow-surface .composer-card');
const step = (page: Page, id: string) => page.locator(`.build-flow-surface .react-flow__node[data-id="${id}"]`);
const inspector = (page: Page) => page.getByRole('region', { name: 'Action inspector' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(account => {
    const requests: string[] = [];
    Object.assign(window, { composerWalletRequests: requests, ethereum: {
      isMetaMask: true,
      async request({ method }: { method: string }) {
        requests.push(method);
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account];
        if (method === 'eth_chainId') return '0x14a34';
        throw new Error(`Unexpected wallet request: ${method}`);
      }, on() {}, removeListener() {},
    } });
  }, owner);
});
test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => (window as unknown as { composerWalletRequests: string[] }).composerWalletRequests.filter(method => /sign|send/i.test(method)))).toEqual([]);
});
async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('.build009-wallet-info')).toBeVisible({ timeout: 15000 });
}
async function lending(page: Page) {
  await open(page);
  await page.getByRole('button', { name: 'Add Supply → Borrow → Swap', exact: true }).click();
  await expect(cards(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Apply proposal', exact: true }).click();
  await expect(cards(page)).toHaveCount(3);
  await expect(step(page, 'lending-supply')).toBeVisible();
  await openCanvasSettings(page);
}

test('supported toolbar actions create real selected nodes and bind their editors', async ({ page }) => {
  for (const [action, form] of [
    ['swap', null], ['bridge', 'Edit cross-chain bridge'], ['pool', 'Edit Base Sepolia liquidity position'],
    ['supply', 'Edit Supply'], ['borrow', 'Edit Borrow'], ['repay', 'Edit Repay'], ['withdraw', 'Edit Withdraw'],
  ] as const) {
    await open(page);
    await page.getByRole('button', { name: `Add ${action}`, exact: true }).click();
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page)).toHaveClass(/active/);
    await expect(inspector(page).locator('.inspector-toggle')).toHaveAttribute('aria-expanded', 'false');
    await openCanvasSettings(page);
    await expect(cards(page).locator('.composer-action-title')).toHaveText(`1. ${action === 'pool' ? 'Pool / Liquidity' : action[0]!.toUpperCase() + action.slice(1)}`);
    await expect(cards(page).locator('.composer-action-title svg')).toHaveCount(1);
    await expect(cards(page)).not.toContainText('Configured');
    await expect(cards(page).locator('.composer-step')).toHaveCount(0);
    if (action === 'bridge') {
      await expect(cards(page)).not.toContainText('Cross-chain');
      await expect(cards(page).getByRole('button', { name: 'Configure source asset', exact: true })).toHaveAttribute('title', 'USDC on Base Sepolia');
      await expect(cards(page).getByRole('button', { name: 'Configure destination asset', exact: true })).toHaveAttribute('title', 'USDC on Arbitrum Sepolia');
      await expect(cards(page).locator('.composer-chain')).toHaveCount(0);
    }
    await expect(cards(page)).toContainText('USDC');
    if (action === 'pool') await expect(cards(page).getByRole('img', { name: 'Base Sepolia network', exact: true })).toHaveCount(2);
    else if (action !== 'bridge') await expect(cards(page)).toContainText(action === 'swap' ? 'Base (8453)' : 'Base Sepolia');
    if (action === 'swap' || action === 'bridge') {
      await expect(cards(page).getByRole('textbox', { name: 'Source amount (USDC)', exact: true })).toHaveValue('0');
      await expect(inspector(page).getByRole('form', { name: `Configure ${action === 'swap' ? 'Swap' : 'Bridge'}`, exact: true })).toBeVisible();
      await configureCanvasAction(page, '1');
    } else if (action === 'supply' || action === 'borrow' || action === 'repay' || action === 'withdraw') {
      await expect(cards(page).getByRole('textbox', { name: 'Source amount (USDC)', exact: true })).toHaveValue('0');
      await expect(inspector(page).getByRole('form', { name: `Configure ${action[0]!.toUpperCase() + action.slice(1)}`, exact: true })).toBeVisible();
      await expect(cards(page).locator('form')).toHaveCount(0);
      await configureCanvasAction(page, '1');
    } else {
      await expect(cards(page).getByRole('textbox')).toHaveCount(2);
      await expect(cards(page).locator('form')).toHaveCount(0);
      await configureCanvasPool(page);
      await openCanvasSettings(page);
    }
    await expect(inspector(page).getByRole('button', { name: 'Advanced Settings', exact: true })).toHaveAttribute('aria-expanded', 'true');
    if (form) await expect(inspector(page).getByRole('form', { name: form, exact: true })).toBeVisible();
    else await expect(inspector(page).getByLabel('Input amount (USDC)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Privacy', exact: true })).toBeDisabled();
  }
});

test('connected lending steps select one editor, update linked summaries after acceptance and preserve order when dragged', async ({ page }) => {
  await lending(page);
  await expect(step(page, 'lending-supply').locator('.composer-card')).toHaveClass(/active/);
  await expect(page.locator('.build-flow-surface .react-flow__edge')).toHaveCount(2);
  await expect(page.locator('.build-flow-surface .react-flow__edge-path').first()).toHaveAttribute('marker-end', /.+/);
  const supplyCard = step(page, 'lending-supply');
  const inlineSupply = supplyCard.getByRole('textbox', { name: 'Source amount (USDC)', exact: true });
  const supplyBefore = await inlineSupply.inputValue();
  const beforeSupplyEdit = await page.locator('.summary-bar').getAttribute('data-workflow-revision');
  await supplyCard.getByRole('button', { name: 'Review Supply change', exact: true }).click();
  await expect(supplyCard.getByRole('button', { name: 'Apply proposal', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Workflow edit review' })).toHaveCount(0);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', beforeSupplyEdit!);
  await inlineSupply.click(); await inlineSupply.fill('0.2');
  await expect(inspector(page).getByLabel('Supply amount USDC', { exact: true })).toHaveValue('0.2');
  await supplyCard.getByRole('button', { name: 'Review Supply change', exact: true }).click();
  await expect(inlineSupply).toHaveValue('0.2');
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', beforeSupplyEdit!);
  expect(supplyBefore).not.toBe('0.2');
  await expect(page.getByRole('region', { name: 'Workflow edit review' }).getByRole('button', { name: 'Apply proposal', exact: true })).toHaveCount(0);
  await supplyCard.getByRole('button', { name: 'Apply proposal', exact: true }).click();
  await expect(inlineSupply).toHaveValue('0.2');
  await expect(page.locator('.build-flow-surface .react-flow__edge')).toHaveCount(2);
  for (const [id, number, form] of [
    ['lending-supply', 1, 'Edit Aave Supply'], ['lending-borrow', 2, 'Edit Aave Borrow'], ['lending-swap', 3, 'Edit Uniswap Swap'],
  ] as const) {
    await step(page, id).locator('.composer-card').click();
    await expect(page.locator('.build-flow-surface .composer-card.active')).toHaveCount(1);
    await expect(step(page, id).locator('.composer-action-title')).toContainText(`${number}.`);
    await expect(inspector(page).getByRole('button', { name: 'Advanced Settings', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await expect(inspector(page).getByRole('form', { name: form, exact: true })).toBeVisible();
  }
  await step(page, 'lending-borrow').click();
  const beforeBorrowRevision = await page.locator('.summary-bar').getAttribute('data-workflow-revision');
  await inspector(page).getByLabel('Borrow amount USDC').fill('0.025');
  await step(page, 'lending-borrow').getByRole('button', { name: 'Review Borrow change', exact: true }).click();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', beforeBorrowRevision!);
  await expect(step(page, 'lending-swap').locator('.composer-amount .composer-amount-value')).toHaveText('0.01');
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(step(page, 'lending-borrow').getByRole('textbox', { name: 'Source amount (USDC)', exact: true })).toHaveValue('0.025');
  await expect(step(page, 'lending-swap').locator('.composer-amount .composer-amount-value')).toHaveText('0.025');
  await expect(step(page, 'lending-swap').locator('.composer-amount-token').first()).toHaveText('USDC');
  await expect(step(page, 'lending-borrow').locator('.composer-card')).toHaveClass(/active/);
  await step(page, 'lending-borrow').scrollIntoViewIfNeeded();
  const box = await step(page, 'lending-borrow').boundingBox();
  if (!box) throw new Error('Borrow node missing');
  await page.mouse.move(box.x + 30, box.y + 25); await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 25, { steps: 8 }); await page.mouse.up();
  expect((await step(page, 'lending-borrow').boundingBox())!.x - box.x).toBeGreaterThan(30);
  await expect(step(page, 'lending-borrow').locator('.composer-action-title')).toHaveText('2. Borrow');
  await expect(page.locator('.build-flow-surface .react-flow__edge')).toHaveCount(2);
  const edge = page.locator('.build-flow-surface .react-flow__edge').first();
  await step(page, 'lending-supply').scrollIntoViewIfNeeded();
  await edge.locator('.react-flow__edge-textbg').click();
  await expect(edge).toHaveClass(/selected/);
  await page.keyboard.press('Delete');
  await expect(page.getByRole('status').filter({ hasText: 'This connection is required by the workflow.' })).toBeVisible();
  await expect(page.locator('.build-flow-surface .react-flow__edge')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('.build-flow-surface .composer-card.active')).toHaveCount(0);
  await expect(inspector(page).getByRole('button', { name: 'Advanced Settings', exact: true })).toBeDisabled();
  await step(page, 'lending-swap').focus(); await page.keyboard.press('Enter');
  await expect(inspector(page).getByRole('button', { name: 'Advanced Settings', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await openCanvasSettings(page);
  await expect(inspector(page).getByRole('button', { name: 'Advanced Settings', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(step(page, 'lending-swap').locator('.composer-card')).toHaveClass(/active/);
});

test('accepted settings update the card and existing warnings link to Selected Action', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Add swap', exact: true }).click();
  await configureCanvasAction(page, '1');
  await openCanvasSettings(page);
  await inspector(page).getByLabel('Input amount (USDC)').fill('2.5');
  await cards(page).getByRole('button', { name: 'Review amount', exact: true }).click();
  await expect(cards(page).getByRole('textbox', { name: 'Source amount (USDC)', exact: true })).toHaveValue('2.5');
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  await expect(cards(page).locator('.composer-amount .composer-amount-token')).toHaveText('USDC');
  await page.getByRole('button', { name: 'Apply amount' }).click();
  await expect(cards(page).getByRole('textbox', { name: 'Source amount (USDC)', exact: true })).toHaveValue('2.5');
  await expect(cards(page).locator('.composer-amount .composer-amount-token')).toHaveText('USDC');
  await inspector(page).getByLabel('Slippage (bps)').fill('200');
  await inspector(page).getByRole('button', { name: 'Review slippage change' }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(cards(page)).not.toHaveAttribute('data-state', 'warning');
  await expect(cards(page)).not.toContainText('Warning');
  await expect(inspector(page).getByLabel('Selected action checks')).toContainText('Review the prototype slippage limit.');
  await expect(page.locator('.build-flow-surface .react-flow__edge')).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove step', exact: true }).click();
  await expect(cards(page)).toHaveCount(0); await expect(inspector(page).getByRole('button', { name: 'Advanced Settings', exact: true })).toBeDisabled();
});

test('desktop and mobile composer keep compact cards, editor placement and approved canvas controls', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 }); await lending(page);
    await expect(cards(page)).toHaveCount(3);
    const canvas = await page.getByRole('region', { name: 'Workflow canvas', exact: true }).boundingBox();
    const editor = await inspector(page).boundingBox();
    expect(editor!.y).toBeGreaterThanOrEqual(canvas!.y + canvas!.height);
    await expect(page.getByRole('button', { name: 'Simular Fees', exact: true })).toBeVisible();
    await expect(page.locator('.build-flow-surface .react-flow__controls')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const cta = await page.getByRole('button', { name: 'Simular Fees', exact: true }).boundingBox();
    for (const card of await cards(page).all()) {
      const box = await card.boundingBox();
      if (!box || !cta) throw new Error('Card or canvas CTA missing');
      expect(box.x + box.width + 8 <= cta.x || cta.x + cta.width + 8 <= box.x || box.y + box.height + 8 <= cta.y || cta.y + cta.height + 8 <= box.y).toBe(true);
    }
    const dimensions = await cards(page).first().evaluate(element => ({ width: (element as HTMLElement).offsetWidth, height: (element as HTMLElement).offsetHeight }));
    expect(dimensions.width).toBeLessThanOrEqual(224); expect(dimensions.height).toBeLessThan(230);
  }
});

test('top toolbar stays in one row with every action reachable at narrow widths and page zoom', async ({ page }) => {
  await open(page);
  const toolbar = page.getByRole('toolbar', { name: 'Canvas tools', exact: true });
  const primary = toolbar.getByRole('group', { name: 'Workflow actions', exact: true });
  const utilities = toolbar.getByRole('group', { name: 'Workflow utilities', exact: true });
  const labels = ['Add swap', 'Add bridge', 'Add pool', 'Add supply', 'Add Supply → Borrow → Swap',
    'Add borrow', 'Add repay', 'Add withdraw', 'Stocks', 'Privacy', 'Duplicate selection', 'Undo', 'Redo', 'Delete', 'Undock toolbar'];
  async function checkRow() {
    expect(await toolbar.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))).toEqual(labels);
    const centers = await toolbar.getByRole('button').evaluateAll(buttons => buttons.map(button => {
      const box = button.getBoundingClientRect();
      return box.y + box.height / 2;
    }));
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(1);
    const dock = (await page.getByRole('button', { name: 'Undock toolbar', exact: true }).boundingBox())!;
    expect(Math.abs(dock.y + dock.height / 2 - centers[0]!)).toBeLessThan(1);
    const utilityBox = (await utilities.boundingBox())!, toolbarBox = (await toolbar.boundingBox())!;
    for (const button of await utilities.getByRole('button').all()) {
      await expect(button).toBeInViewport();
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(toolbarBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(toolbarBox.x + toolbarBox.width);
    }
    for (const button of await primary.getByRole('button').all()) {
      await expect(button.locator('span')).toBeVisible();
      await button.scrollIntoViewIfNeeded();
      const box = (await button.boundingBox())!, region = (await primary.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(region.x);
      expect(box.x + box.width).toBeLessThanOrEqual(region.x + region.width);
      expect((await utilities.boundingBox())!.x).toBe(utilityBox.x);
    }
    const row = (await page.locator('.canvas-toolbar-row').boundingBox())!;
    const canvas = (await page.getByRole('region', { name: 'Workflow canvas', exact: true }).boundingBox())!;
    expect(row.x + row.width).toBeLessThanOrEqual(canvas.x + canvas.width);
  }
  for (const width of [1920, 1440, 1200, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await checkRow();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  // CSS page zoom exercises scaled layout; smaller CSS viewports above also cover browser zoom's width reduction.
  for (const zoom of [1.25, 1.5, 2]) {
    await page.evaluate(value => { document.documentElement.style.zoom = String(value); }, zoom);
    await checkRow();
  }
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });
  // Available canvas width can change independently of the browser viewport.
  await page.getByRole('region', { name: 'Workflow canvas', exact: true }).evaluate(element => { element.style.maxWidth = '360px'; });
  await checkRow();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
});

test('Swap and Bridge source/destination boxes select the existing editor, preserve the footer and retain history controls', async ({ page }) => {
  for (const width of [1440, 390]) for (const action of ['swap', 'bridge']) {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await page.getByRole('button', { name: `Add ${action}`, exact: true }).click();
    await configureCanvasAction(page, '1');
    const card = cards(page), amount = card.locator('.composer-amount');
    const destination = card.locator('.composer-destination-box');
    await expect(amount.locator('.composer-token-value')).toHaveValue('1');
    await expect(amount.locator('.composer-amount-token')).toHaveText('USDC');
    await expect(amount.locator('.composer-value-edit')).toHaveCount(0);
    await expect(card.locator('.composer-amount-box')).toHaveCount(2);
    await expect(destination.locator('.composer-amount-value')).toHaveText('0');
    await expect(destination).toHaveAttribute('data-symbolic');
    await expect(card.locator('.composer-quote-note')).toHaveText('Estimate unavailable');
    await expect(destination.locator('.composer-amount-token')).toHaveText(action === 'swap' ? 'WETH' : 'USDC');
    const sourceBox = (await amount.boundingBox())!, destinationBox = (await destination.boundingBox())!;
    expect(destinationBox.y).toBeGreaterThanOrEqual(sourceBox.y + sourceBox.height + 3);
    expect(destinationBox.width).toBe(sourceBox.width);
    for (const valueBox of [amount, destination]) {
      await expect(valueBox.locator('.composer-fiat-value')).toHaveText('US$ 0,00');
      await expect(valueBox.locator('.composer-fiat-value')).toHaveAttribute('aria-label', /unavailable/);
      await expect(valueBox.locator('.composer-token-avatar')).toBeVisible();
      const value = (await valueBox.locator('.composer-value-column').boundingBox())!;
      const token = (await valueBox.locator('.composer-token-pill').boundingBox())!;
      const numeric = (await valueBox.locator('.composer-amount-value').boundingBox())!;
      const fiat = (await valueBox.locator('.composer-fiat-value').boundingBox())!;
      expect(fiat.y).toBeGreaterThan(numeric.y + numeric.height);
      expect(fiat.height).toBeLessThan(numeric.height);
      expect(value.x + value.width).toBeLessThan(token.x);
      expect(Math.abs(value.y + value.height / 2 - token.y - token.height / 2)).toBeLessThan(1);
    }
    await expect(card.locator('input')).toHaveCount(1);
    await expect(card.locator('form')).toHaveCount(1);
    const footerGap = await card.evaluate(element => {
      const footer = element.querySelector('.composer-selected') as HTMLElement;
      return (element as HTMLElement).clientHeight - footer.offsetTop - footer.offsetHeight;
    });
    expect(footerGap).toBeGreaterThanOrEqual(11); expect(footerGap).toBeLessThanOrEqual(13);
    await openCanvasSettings(page);
    await inspector(page).locator('.inspector-toggle').click();
    await expect(inspector(page).locator('.inspector-body')).toBeHidden();
    await amount.click();
    await expect(card).toHaveClass(/active/);
    await expect(inspector(page).locator('.inspector-body')).toBeHidden();
    await expect(card.locator('.composer-selected')).toHaveText('Advanced Settings');
    await expect(card.locator('.composer-selected svg')).toBeVisible();
    await card.locator('.composer-selected').click();
    await expect(inspector(page).locator('.inspector-body')).toBeVisible();
    const utilities = page.getByRole('group', { name: 'Workflow utilities', exact: true });
    // The inspector toggle can scroll a narrow page below the canvas header; history lives in that header.
    await page.getByRole('toolbar', { name: 'Canvas tools', exact: true }).scrollIntoViewIfNeeded();
    await expect(utilities.getByRole('button', { name: 'Undo', exact: true })).toBeInViewport();
    await utilities.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(amount.locator('.composer-token-value')).toHaveValue('1');
    await expect(page.getByRole('button', { name: 'Simular Fees', exact: true })).toBeDisabled();
    await utilities.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(utilities.getByRole('button', { name: 'Redo', exact: true })).toBeInViewport();
    await utilities.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Simular Fees', exact: true })).toBeDisabled();
    await utilities.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(amount.locator('.composer-token-value')).toHaveValue('1');
    await expect(inspector(page).locator('.inspector-body')).toBeHidden();
    await openCanvasSettings(page);
    await expect(inspector(page).locator('.inspector-body')).toBeVisible();
  }
});

test('Advanced Settings opens only from its controls while card and keyboard selection stay independent', async ({ page }) => {
  await open(page);
  const panel = inspector(page), toggle = panel.locator('.inspector-toggle'), body = panel.locator('.inspector-body');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeDisabled();
  await expect(body).toBeHidden();
  expect((await panel.boundingBox())!.height).toBeLessThan(60);
  await page.getByRole('button', { name: 'Add Supply → Borrow → Swap', exact: true }).click();
  await page.getByRole('button', { name: 'Apply proposal', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeEnabled();
  await step(page, 'lending-borrow').locator('.composer-card').click();
  await expect(body).toBeHidden();
  for (const key of ['Enter', 'Space']) {
    await step(page, 'lending-supply').focus(); await page.keyboard.press(key);
    await expect(step(page, 'lending-supply').locator('.composer-card')).toHaveClass(/active/);
    await expect(body).toBeHidden();
  }
  await openCanvasSettings(page);
  await expect(toggle).toHaveText('Advanced Settings');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const supplyAmount = panel.getByLabel('Supply amount USDC', { exact: true });
  await supplyAmount.fill('0.25');
  await toggle.click(); await expect(body).toBeHidden();
  await step(page, 'lending-supply').locator('.composer-card').click();
  await expect(body).toBeHidden();
  await openCanvasSettings(page);
  await expect(supplyAmount).toHaveValue('0.25');
  await step(page, 'lending-borrow').locator('.composer-card').click();
  await expect(panel.getByRole('form', { name: 'Edit Aave Borrow', exact: true })).toBeVisible();
  await toggle.click();
  await step(page, 'lending-swap').locator('.composer-card').click();
  await expect(body).toBeHidden();
  const gear = step(page, 'lending-swap').getByRole('button', { name: 'Advanced Settings', exact: true });
  await gear.focus(); await page.keyboard.press('Enter');
  await expect(panel.getByRole('form', { name: 'Edit Uniswap Swap', exact: true })).toBeVisible();
  await expect(page.locator('.build-flow-surface .composer-card.active')).toHaveCount(1);
  await step(page, 'lending-swap').focus(); await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeDisabled(); await expect(body).toBeHidden();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
});

test('Delete uses the current selection, honors locks/protected steps and remains undoable', async ({ page }) => {
  await open(page);
  const remove = page.getByRole('button', { name: 'Delete', exact: true });
  await expect(remove).toBeDisabled();
  await page.getByRole('button', { name: 'Add swap', exact: true }).click();
  await configureCanvasAction(page, '1');
  await openCanvasSettings(page);
  await expect(remove).toBeEnabled();
  await inspector(page).getByRole('button', { name: 'Lock amount', exact: true }).click();
  await expect(remove).toBeDisabled();
  await expect(cards(page)).toHaveCount(1);
  await inspector(page).getByRole('button', { name: 'Unlock amount', exact: true }).click();
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect(cards(page)).toHaveCount(0);
  await expect(remove).toBeDisabled();
  await expect(inspector(page).getByRole('button', { name: 'Advanced Settings', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(cards(page).locator('.composer-amount .composer-token-value')).toHaveValue('1');
  await expect(cards(page)).toHaveClass(/active/);
  await expect(inspector(page).getByRole('button', { name: 'Advanced Settings', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await openCanvasSettings(page);
  await expect(inspector(page).getByRole('button', { name: 'Advanced Settings', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(cards(page)).toHaveCount(0);
  await lending(page);
  await step(page, 'lending-borrow').locator('.composer-card').click();
  await expect(remove).toBeDisabled();
  await expect(cards(page)).toHaveCount(3);
});
