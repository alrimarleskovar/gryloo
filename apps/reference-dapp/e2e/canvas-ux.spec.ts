// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, installPassiveWallet, assertPassiveWallet, applyPendingProposal, openSimulationDetails, readWorkflowIr } from './fixtures';
import type { Page } from '@playwright/test';

test.beforeEach(async ({ page }) => { await installPassiveWallet(page); });
test.afterEach(async ({ page }) => { await assertPassiveWallet(page); });

async function addFromToolbox(page: Page, action: string) {
  const before = await page.locator('.build-flow-surface .react-flow__node').count();
  await page.getByRole('button', { name: `Add ${action}`, exact: true }).click();
  await expect(page.locator('.build-flow-surface .react-flow__node')).toHaveCount(before + 1);
  const card = page.locator('.build-flow-surface .composer-card').last();
  if (action === 'pool') {
    await card.getByRole('textbox', { name: /^First liquidity amount/ }).fill('0.0001');
    await card.getByRole('textbox', { name: /^Second liquidity amount/ }).fill('1');
    await card.getByRole('button', { name: 'Review', exact: true }).click();
    await card.getByRole('button', { name: 'Apply', exact: true }).click();
  } else {
    await card.getByRole('textbox', { name: 'Source amount (USDC)', exact: true }).fill('1');
    await card.getByRole('button', { name: 'Review amount', exact: true }).click();
    await card.getByRole('button', { name: 'Apply amount', exact: true }).click();
  }
  await expect(page.locator('.build-flow-surface .react-flow__node')).toHaveCount(before + 1);
  return page.locator('.build-flow-surface .react-flow__node').last();
}
async function connect(page: Page, source: string, target: string) {
  const sourceHandle = page.locator(`.react-flow__node[data-id="${source}"] .react-flow__handle-right`);
  const targetHandle = page.locator(`.react-flow__node[data-id="${target}"] .react-flow__handle-left`);
  await expect(sourceHandle).not.toHaveClass(/(?:^|\s)connectable(?:\s|$)/);
  await expect(targetHandle).not.toHaveClass(/(?:^|\s)connectable(?:\s|$)/);
  const from = await sourceHandle.boundingBox();
  const to = await page.locator(`.react-flow__node[data-id="${target}"] .react-flow__handle-left`).boundingBox();
  if (!from || !to) throw new Error('Connection handles missing');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
}
test('toolbox creates typed actions, selects them, and keeps setup below the canvas', async ({ page }) => {
  for (const action of ['swap', 'bridge', 'pool']) {
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Workflow graph' })).toBeVisible();
    await expect(page.getByText('Advanced action setup', { exact: true })).toBeVisible();
    await expect(page.locator('.build-grid .library')).toHaveCount(0);
    const node = await addFromToolbox(page, action);
    await expect(node.locator('.composer-card')).toHaveClass(/active/);
    await expect(node).toContainText(action, { ignoreCase: true });
    await expect(node).not.toContainText('Template');
    await expect(node).toContainText(action === 'bridge' ? 'Router' : 'Uniswap');
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
    await expect(page.getByRole('region', { name: 'Workflow graph' })).not.toContainText('BUILD /');
    await expect(page.locator('.top-bar')).not.toContainText('Base authoring · mock examples');
  }
});
test('dragging updates stored layout, survives editor changes and Build navigation', async ({ page }) => {
  await page.goto('/');
  const node = await addFromToolbox(page, 'swap');
  const revisionBeforeDrag = await page.locator('.summary-bar').getAttribute('data-workflow-revision');
  const id = await node.getAttribute('data-id');
  const before = await node.boundingBox();
  if (!before || !id) throw new Error('New node missing');
  await page.mouse.move(before.x + 60, before.y + 55);
  await page.mouse.down();
  await page.mouse.move(before.x + 190, before.y + 130, { steps: 14 });
  await page.mouse.up();
  const after = await node.boundingBox();
  expect(after!.x).toBeGreaterThan(before.x + 80);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', revisionBeforeDrag!);
  const workflowId = JSON.parse((await page.locator('[data-workflow-ir]').textContent())!).workflowId as string;
  const saved = await page.evaluate(({ id, workflowId }) => JSON.parse(localStorage.getItem(`gryloo:canvas:${workflowId}`) ?? '{}')[id], { id, workflowId });
  expect(saved.x).toBeGreaterThan(100);
  await addFromToolbox(page, 'swap');
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  const returned = page.locator(`.react-flow__node[data-id="${id}"]`);
  await expect(returned).toBeVisible();
  const position = await returned.evaluate(element => getComputedStyle(element).transform);
  expect(Number(position.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+, ([^,]+)/)?.[1])).toBeCloseTo(saved.x, 2);
});
test('node and edge selection, deletion, text entry and composition guards', async ({ page }) => {
  await page.goto('/');
  await addFromToolbox(page, 'swap');
  const second = page.locator('.react-flow__node[data-id="node-002"]');
  await second.locator('.composer-card').click();
  await expect(second.locator('.composer-card')).toHaveClass(/active/);
  await page.keyboard.press('Escape');
  await expect(second.locator('.composer-card')).not.toHaveClass(/active/);
  await second.locator('.composer-card').click();
  const chat = page.locator('#mock-prompt');
  await chat.focus(); await page.keyboard.press('Delete');
  await expect(second).toBeVisible();
  await page.evaluate(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, isComposing: true })); });
  await expect(second).toBeVisible();
  await second.locator('.composer-card').click(); await page.keyboard.press('Backspace');
  await expect(second).toHaveCount(0);
  await expect(page.locator('.build-flow-surface .react-flow__node')).toHaveCount(0);
  const source = await addFromToolbox(page, 'swap');
  const sourceId = await source.getAttribute('data-id');
  if (!sourceId) throw new Error('Source node missing');
  const replacement = await addFromToolbox(page, 'swap');
  const targetId = await replacement.getAttribute('data-id');
  if (!targetId) throw new Error('Replacement node missing');
  const revision = await page.locator('.summary-bar').getAttribute('data-workflow-revision');
  await connect(page, sourceId, targetId);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', revision!);
});
test('selected action parameters edit shared IR', async ({ page }) => {
  await page.goto('/');
  await addFromToolbox(page, 'swap');
  const card = page.locator('.build-flow-surface .composer-card');
  await card.getByRole('textbox', { name: 'Source amount (USDC)' }).fill('2.5');
  await card.getByRole('button', { name: 'Review amount', exact: true }).click();
  await card.getByRole('button', { name: 'Apply amount', exact: true }).click();
  await expect(card.getByRole('textbox', { name: 'Source amount (USDC)' })).toHaveValue('2.5');
  const ir = JSON.parse(await readWorkflowIr(page));
  expect(ir.nodes.find((node: { nodeId: string }) => node.nodeId === 'node-002').inputs).toContainEqual(expect.objectContaining({ name: 'amount-in', value: expect.objectContaining({ amount: '2500000' }) }));
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  await expect(page.locator('.simulation-workflow-canvas')).toContainText('2.5');
});

test('toolbox mode is presentation-only and persists across Build navigation', async ({ page }) => {
  await page.goto('/');
  const graph = page.getByRole('region', { name: 'Workflow graph' });
  const original = await graph.locator('.react-flow__node').count();
  const revisionBeforeSwitch = await page.locator('.summary-bar').getAttribute('data-workflow-revision');
  await expect(page.getByRole('button', { name: 'Undock toolbar' })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Undock toolbar' }).click();
  await expect(graph.locator('.floating-toolbox')).toBeVisible();
  await expect(graph.getByRole('button', { name: 'Add swap' })).toBeVisible();
  await expect(graph.locator('.react-flow__node')).toHaveCount(original);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', revisionBeforeSwitch!);
  await addFromToolbox(page, 'swap');
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Dock toolbar' })).toHaveAttribute('aria-pressed', 'true');
  await expect(graph.locator('.floating-toolbox')).toBeVisible();
  await page.getByRole('button', { name: 'Dock toolbar' }).click();
  await expect(graph.locator('.floating-toolbox')).toHaveCount(0);
  await expect(page.locator('.canvas-head').getByRole('button', { name: 'Add swap' })).toBeVisible();
  await expect(page.getByText('Technical workflow details')).toHaveCount(0);
  await expect(page.getByText('Demo assistant')).toHaveCount(0);
  await expect(page.getByText('Demo mode', { exact: true })).toHaveCount(0);
});
test('duplicate selection copies independent swaps in one undoable edit', async ({ page }) => {
  await page.goto('/');
  await addFromToolbox(page, 'swap');
  await addFromToolbox(page, 'swap');
  await addFromToolbox(page, 'swap');
  await page.locator('.react-flow__node[data-id="node-002"] .composer-card').click();
  await page.locator('.react-flow__node[data-id="node-003"] .composer-card').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Duplicate selection' }).click();
  await expect(page.getByRole('region', { name: 'Workflow graph' }).locator('.react-flow__node')).toHaveCount(5);
  await expect(page.getByRole('region', { name: 'Workflow graph' }).locator('.react-flow__edge')).toHaveCount(0);
  const copied = await page.getByRole('region', { name: 'Workflow graph' }).locator('.react-flow__node').evaluateAll(nodes => nodes.slice(-2).map(node => node.getAttribute('data-id')));
  expect(copied[0]).not.toBe('node-002');
  expect(copied[1]).not.toBe('node-003');
  for (const id of copied) await expect(page.locator(`.build-flow-surface .react-flow__node[data-id="${id}"]`)).toHaveClass(/selected/);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Workflow graph' }).locator('.react-flow__node')).toHaveCount(3);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Workflow graph' }).locator('.react-flow__node')).toHaveCount(5);
});

test('floating toolbox keeps a clickable gutter from viewport controls', async ({ page }) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Undock toolbar' }).click();
    const graph = page.getByRole('region', { name: 'Workflow graph' });
    const toolbox = await graph.locator('.floating-toolbox').boundingBox();
    const controls = await graph.locator('.canvas-navigator').boundingBox();
    if (!toolbox || !controls) throw new Error('Canvas controls missing');
    expect(controls.x).toBeGreaterThanOrEqual(toolbox.x + toolbox.width + 8);
    await graph.getByRole('slider', { name: 'Canvas zoom' }).press('ArrowLeft');
    await addFromToolbox(page, 'swap');
    await expect(graph.locator('.react-flow__node')).toHaveCount(1);
    await page.getByRole('button', { name: 'Dock toolbar' }).click();
  }
});

test('marquee follows the pointer, stays clipped, and selects exactly the intersecting group', async ({ page }) => {
  await page.goto('/');
  await addFromToolbox(page, 'swap');
  await addFromToolbox(page, 'swap');
  await addFromToolbox(page, 'swap');
  const graph = page.getByRole('region', { name: 'Workflow graph' });
  await graph.getByRole('slider', { name: 'Canvas zoom' }).press('ArrowLeft');
  const initialSurface = await graph.boundingBox();
  if (!initialSurface) throw new Error('Canvas missing');
  await page.mouse.move(initialSurface.x + initialSurface.width / 2, initialSurface.y + initialSurface.height / 2);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(initialSurface.x + initialSurface.width / 2 + 18, initialSurface.y + initialSurface.height / 2 + 12, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  const surface = await graph.boundingBox();
  const second = await graph.locator('.react-flow__node[data-id="node-003"]').boundingBox();
  const third = await graph.locator('.react-flow__node[data-id="node-004"]').boundingBox();
  if (!surface || !second || !third) throw new Error('Canvas geometry missing');
  const start = { x: surface.x + 5, y: surface.y + 5 };
  const end = { x: Math.min(second.x + second.width + 5, third.x - 5), y: second.y + second.height + 5 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  const marquee = await graph.locator('.canvas-marquee').boundingBox();
  if (!marquee) throw new Error('Marquee missing');
  expect(marquee.x).toBeCloseTo(start.x, 0);
  expect(marquee.y).toBeCloseTo(start.y, 0);
  expect(marquee.x + marquee.width).toBeLessThanOrEqual(surface.x + surface.width + 1);
  expect(marquee.y + marquee.height).toBeLessThanOrEqual(surface.y + surface.height + 1);
  await page.mouse.up();
  await expect(graph.locator('.react-flow__node.selected')).toHaveCount(2);
  await expect(graph.locator('.react-flow__node[data-id="node-004"]')).not.toHaveClass(/selected/);
  const firstSelected = graph.locator('.react-flow__node[data-id="node-002"]');
  const before = await firstSelected.boundingBox();
  if (!before) throw new Error('Selected node missing');
  await page.mouse.move(before.x + 60, before.y + 55);
  await page.mouse.down();
  await page.mouse.move(before.x + 95, before.y + 80, { steps: 8 });
  await page.mouse.up();
  const moved = await firstSelected.boundingBox();
  expect(moved!.x).toBeGreaterThan(before.x + 20);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await firstSelected.boundingBox())!.x).toBeCloseTo(before.x, 0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await firstSelected.boundingBox())!.x).toBeCloseTo(moved!.x, 0);
});

test('drag keeps node mounted and invalid connections leave semantic edges unchanged', async ({ page }) => {
  await page.goto('/');
  await addFromToolbox(page, 'swap');
  await addFromToolbox(page, 'swap');
  const node = page.locator('.react-flow__node[data-id="node-003"]');
  await node.evaluate(element => { (window as unknown as { draggedNode?: Element }).draggedNode = element; });
  const before = await node.boundingBox();
  if (!before) throw new Error('Node missing');
  await page.mouse.move(before.x + 70, before.y + 60);
  await page.mouse.down();
  await page.mouse.move(before.x + 5, before.y + 120, { steps: 25 });
  await page.mouse.up();
  expect(await node.evaluate(element => (window as unknown as { draggedNode?: Element }).draggedNode === element)).toBe(true);
  expect((await node.boundingBox())!.x).toBeLessThan(before.x - 40);
  const revision = await page.locator('.summary-bar').getAttribute('data-workflow-revision');
  await connect(page, 'node-002', 'node-003');
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await connect(page, 'node-003', 'node-002');
  await page.getByRole('button', { name: 'Undock toolbar' }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', revision!);
});
test('text controls guard deletion and approved workflow edges stay protected', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Describe your flow').fill('compose supply 1 USDC to Aave then borrow 0.1 USDC then swap borrowed USDC to WETH on Base Sepolia slippage 50 bps owner 0x1111111111111111111111111111111111111111');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await applyPendingProposal(page);
  await expect(page.locator('.build-flow-surface .react-flow__edge')).toHaveCount(2);
  const edge = page.locator('.build-flow-surface .react-flow__edge').first();
  await page.getByRole('button', { name: 'Fit workflow', exact: true }).click();
  const point = await edge.locator('.react-flow__edge-path').evaluate(element => {
    const path = element as SVGPathElement, position = path.getPointAtLength(path.getTotalLength() / 2);
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error('Edge screen geometry missing');
    return { x: position.x * matrix.a + position.y * matrix.c + matrix.e, y: position.x * matrix.b + position.y * matrix.d + matrix.f };
  });
  await page.mouse.click(point.x, point.y);
  await expect(edge).toHaveClass(/selected/);
  await page.getByLabel('Describe your flow').focus();
  await page.keyboard.press('Backspace');
  await expect(page.locator('.build-flow-surface .react-flow__edge')).toHaveCount(2);
  await page.locator('.canvas-head h2').click();
  await page.keyboard.press('Delete');
  await expect(page.getByText('This connection is required by the workflow.')).toBeVisible();
  await expect(page.locator('.build-flow-surface .react-flow__edge')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(edge).not.toHaveClass(/selected/);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
});


test('floating toolbox stays inside a narrow editor without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Undock toolbar' }).click();
  const graph = page.getByRole('region', { name: 'Workflow graph' });
  await expect(graph.locator('.floating-toolbox')).toBeVisible();
  await expect(graph.locator('.floating-toolbox button')).toHaveCount(14);
  await expect(graph.getByRole('button', { name: 'Privacy', exact: true })).toBeDisabled();
  await expect(graph.getByRole('button', { name: 'Add repay', exact: true })).toBeVisible();
  await expect(graph.getByRole('button', { name: 'Add withdraw', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});


test('dragging a swap preserves current mocked artifacts', async ({ page }) => {
  await page.goto('/');
  await addFromToolbox(page, 'swap');
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  await openSimulationDetails(page);
  const artifacts = page.locator('.simulation-technical');
  await artifacts.getByRole('button', { name: /^Generate mocked artifacts for revision 1$/ }).click();
  await expect(artifacts.getByText('ARTIFACTS: CURRENT', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  const card = page.locator('.react-flow__node[data-id="node-002"]');
  const box = await card.boundingBox();
  if (!box) throw new Error('Swap node missing');
  await page.mouse.move(box.x + 65, box.y + 58);
  await page.mouse.down();
  await page.mouse.move(box.x + 95, box.y + 78, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  await openSimulationDetails(page);
  await expect(artifacts.getByText('ARTIFACTS: CURRENT', { exact: true })).toBeVisible();
});
