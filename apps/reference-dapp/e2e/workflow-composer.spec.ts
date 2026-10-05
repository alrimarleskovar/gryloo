// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
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
    await expect(cards(page).locator('.composer-action-title')).toHaveText(`1. ${action === 'pool' ? 'Pool / Liquidity' : action[0]!.toUpperCase() + action.slice(1)}`);
    await expect(cards(page).locator('.composer-action-title svg')).toHaveCount(1);
    await expect(cards(page)).not.toContainText('Configured');
    await expect(cards(page).locator('.composer-step')).toHaveCount(0);
    if (action === 'bridge') {
      await expect(cards(page)).not.toContainText('Cross-chain');
      await expect(cards(page).locator('.composer-chain')).toHaveText('Base Sepolia → Arbitrum Sepolia');
    }
    await expect(cards(page)).toContainText('USDC');
    await expect(cards(page)).toContainText(action === 'swap' ? 'Base (8453)' : 'Base Sepolia');
    await expect(cards(page).locator('input, form')).toHaveCount(0);
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
  await inspector(page).getByLabel('Borrow amount USDC').fill('0.025');
  await inspector(page).getByRole('button', { name: 'Review Aave Borrow change' }).click();
  await expect(step(page, 'lending-borrow')).toContainText('0.01 USDC');
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(step(page, 'lending-borrow')).toContainText('0.025 USDC');
  await expect(step(page, 'lending-swap')).toContainText('0.025 USDC');
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
  await expect(inspector(page).getByRole('button', { name: 'Advanced Settings', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(step(page, 'lending-swap').locator('.composer-card')).toHaveClass(/active/);
});

test('accepted settings update the card and existing warnings link to Selected Action', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: 'Add swap', exact: true }).click();
  await inspector(page).getByLabel('Input amount (USDC)').fill('2.5');
  await inspector(page).getByRole('button', { name: 'Review amount change' }).click();
  await expect(cards(page)).toContainText('1 USDC');
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(cards(page)).toContainText('2.5 USDC');
  await inspector(page).getByLabel('Slippage (bps)').fill('200');
  await inspector(page).getByRole('button', { name: 'Review slippage change' }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(cards(page)).toHaveAttribute('data-state', 'warning');
  await expect(cards(page)).toContainText('Warning');
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
    'Add borrow', 'Add repay', 'Add withdraw', 'Privacy', 'Duplicate selection', 'Undo', 'Redo', 'Delete', 'Undock toolbar'];
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
    const card = cards(page), amount = card.locator('.composer-amount');
    const destination = card.locator('.composer-destination-box');
    await expect(amount.locator('.composer-amount-value')).toHaveText('1');
    await expect(amount.locator('.composer-amount-token')).toHaveText('USDC');
    await expect(amount.locator('svg')).toBeVisible();
    await expect(card.locator('.composer-amount-box')).toHaveCount(2);
    await expect(destination.locator('.composer-amount-value')).toHaveText('Not quoted');
    await expect(destination.locator('.composer-amount-token')).toHaveText(action === 'swap' ? 'WETH' : 'USDC');
    const sourceBox = (await amount.boundingBox())!, destinationBox = (await destination.boundingBox())!;
    expect(destinationBox.y).toBeGreaterThanOrEqual(sourceBox.y + sourceBox.height + 3);
    expect(destinationBox.width).toBe(sourceBox.width);
    for (const valueBox of [amount, destination]) {
      const value = (await valueBox.locator('.composer-amount-value').boundingBox())!;
      const token = (await valueBox.locator('.composer-amount-token').boundingBox())!;
      expect(value.x + value.width).toBeLessThan(token.x);
      expect(Math.abs(value.y + value.height / 2 - token.y - token.height / 2)).toBeLessThan(1);
    }
    await expect(card.locator('input, form')).toHaveCount(0);
    const footerGap = await card.evaluate(element => {
      const footer = element.querySelector('.composer-selected') as HTMLElement;
      return (element as HTMLElement).clientHeight - footer.offsetTop - footer.offsetHeight;
    });
    expect(footerGap).toBeGreaterThanOrEqual(11); expect(footerGap).toBeLessThanOrEqual(13);
    await inspector(page).locator('.inspector-toggle').click();
    await expect(inspector(page).locator('.inspector-body')).toBeHidden();
    await amount.click();
    await expect(card).toHaveClass(/active/);
    await expect(inspector(page).locator('.inspector-body')).toBeVisible();
    await expect(card.locator('.composer-selected')).toHaveText('Editing in Selected Action');
    const utilities = page.getByRole('group', { name: 'Workflow utilities', exact: true });
    // The inspector toggle can scroll a narrow page below the canvas header; history lives in that header.
    await page.getByRole('toolbar', { name: 'Canvas tools', exact: true }).scrollIntoViewIfNeeded();
    await expect(utilities.getByRole('button', { name: 'Undo', exact: true })).toBeInViewport();
    await utilities.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(utilities.getByRole('button', { name: 'Redo', exact: true })).toBeInViewport();
    await utilities.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(amount.locator('.composer-amount-value')).toHaveText('1');
    await expect(inspector(page).locator('.inspector-body')).toBeVisible();
  }
});

test('Selected Action stays compact until selection and reopens for clicks and keyboard selection without losing drafts', async ({ page }) => {
  await open(page);
  const panel = inspector(page), toggle = panel.locator('.inspector-toggle'), body = panel.locator('.inspector-body');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeDisabled();
  await expect(body).toBeHidden();
  expect((await panel.boundingBox())!.height).toBeLessThan(60);
  await page.getByRole('button', { name: 'Add Supply → Borrow → Swap', exact: true }).click();
  await page.getByRole('button', { name: 'Apply proposal', exact: true }).click();
  await expect(toggle).toHaveText('Advanced Settings');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const supplyAmount = panel.getByLabel('Supply amount USDC', { exact: true });
  await supplyAmount.fill('0.25');
  await toggle.click();
  await expect(body).toBeHidden();
  expect((await panel.boundingBox())!.height).toBeLessThan(60);
  await expect(step(page, 'lending-supply').locator('.composer-card')).toHaveClass(/active/);
  await step(page, 'lending-supply').locator('.composer-card').click();
  await expect(body).toBeVisible();
  await expect(supplyAmount).toHaveValue('0.25');
  await toggle.click();
  await step(page, 'lending-borrow').locator('.composer-card').click();
  await expect(toggle).toHaveText('Advanced Settings');
  await expect(panel.getByRole('form', { name: 'Edit Aave Borrow', exact: true })).toBeVisible();
  for (const key of ['Enter', 'Space']) {
    await toggle.click();
    await expect(body).toBeHidden();
    await step(page, 'lending-swap').focus();
    await page.keyboard.press(key);
    await expect(toggle).toHaveText('Advanced Settings');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(panel.getByRole('form', { name: 'Edit Uniswap Swap', exact: true })).toBeVisible();
    await expect(page.locator('.build-flow-surface .composer-card.active')).toHaveCount(1);
  }
  await step(page, 'lending-swap').focus();
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeDisabled();
  await expect(body).toBeHidden();
  await expect(panel.locator('.inspector-toggle')).toHaveText('Advanced Settings');
  expect((await panel.boundingBox())!.height).toBeLessThan(60);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
});

test('Delete uses the current selection, honors locks/protected steps and remains undoable', async ({ page }) => {
  await open(page);
  const remove = page.getByRole('button', { name: 'Delete', exact: true });
  await expect(remove).toBeDisabled();
  await page.getByRole('button', { name: 'Add swap', exact: true }).click();
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
  await expect(cards(page).locator('.composer-amount .composer-amount-value')).toHaveText('1');
  await expect(cards(page)).toHaveClass(/active/);
  await expect(inspector(page).getByRole('button', { name: 'Advanced Settings', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(cards(page)).toHaveCount(0);
  await lending(page);
  await step(page, 'lending-borrow').locator('.composer-card').click();
  await expect(remove).toBeDisabled();
  await expect(cards(page)).toHaveCount(3);
});
