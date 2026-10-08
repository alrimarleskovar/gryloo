// SPDX-License-Identifier: AGPL-3.0-only
/** Real product/API/service code; synthetic loopback read responses. No financial execution claim. */
import { test, expect } from './fixtures';
import { installJourneyWallet, walletRequests, setWalletChain } from './journey-fixtures';
import { createTestWallet } from '../../../packages/reference-reconciler/test/test-wallet';
import { hashArtifactBytes, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';

for (const [network, chain] of [['Base Sepolia', '0x14a34'], ['Ethereum Sepolia', '0xaa36a7']] as const) {
  test(`${network}: Canvas → real read client estimate → Simulate → Review; locale preserves authority and wallet changes invalidate it`, async ({ page, request, networkGuard }) => {
    test.setTimeout(90_000);
    if (process.env.FLOFI_SWAP_READ_E2E !== 'MOCKED_LOOPBACK_ONLY') throw Error('READ_HARNESS_REQUIRED');
    const owner = createTestWallet(); await installJourneyWallet(page, [owner], { chain });
    const workflows: SemanticWorkflow[] = [];
    page.on('request', event => { if (event.url().endsWith('/api/build-estimate')) workflows.push(event.postDataJSON().workflow as SemanticWorkflow); });
    await page.goto('/');
    await expect(page.getByRole('group', { name: 'Wallet connection' })).toContainText(network);
    await page.getByRole('button', { name: 'Add swap', exact: true }).click();
    const card = page.locator('.build-flow-surface .composer-card').first();
    await card.getByRole('button', { name: 'Select source token', exact: true }).click();
    await page.getByRole('region', { name: 'Action network picker', exact: true }).getByRole('button', { name: network, exact: true }).click();
    await page.getByRole('button', { name: 'Hide token picker', exact: true }).click();
    await card.getByRole('textbox', { name: 'Source amount (USDC)', exact: true }).fill('1');
    await card.getByRole('button', { name: 'Review amount', exact: true }).click();
    await card.getByRole('button', { name: 'Apply amount', exact: true }).click();
    await expect(card.locator('.composer-destination-box')).toContainText('0.0005');
    await expect(card).toContainText('Approximate · Uniswap V3 · Simulate before review');
    await expect.poll(() => workflows.length).toBeGreaterThan(0);
    const workflow = workflows.at(-1)!, revision = await page.locator('.summary-bar').getAttribute('data-workflow-revision');
    const hash = hashArtifactBytes('semantic-workflow', new TextEncoder().encode(JSON.stringify(workflow)));
    await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate', exact: true }).click();
    const summary = page.getByRole('complementary', { name: 'Simulation Summary', exact: true });
    const review = page.getByRole('region', { name: 'Review & Authorization', exact: true });
    await page.getByRole('button', { name: 'Simulate workflow', exact: true }).click();
    await expect(summary.getByRole('region', { name: 'Expected result' })).toContainText('0.0005 WETH');
    await expect(summary).not.toContainText('The workflow has changed.');
    await expect(review.getByRole('button', { name: 'Approve & Continue', exact: true })).toBeEnabled();
    // Quote arrival does not edit the IR or semantic revision.
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', revision!);
    expect(hashArtifactBytes('semantic-workflow', new TextEncoder().encode(JSON.stringify(workflows.at(-1))))).toBe(hash);
    await review.getByRole('button', { name: 'Approve & Continue', exact: true }).click();
    await expect(review.getByRole('button', { name: 'Review approved', exact: true })).toBeDisabled();
    const before = await walletRequests(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('switch', { name: 'Language', exact: true }).click(); await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt');
    await expect(page.getByRole('button', { name: 'Revisão aprovada', exact: true })).toBeDisabled();
    expect(await walletRequests(page)).toEqual(before);
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', revision!);
    // Returning to the reviewed network cannot revive authorization.
    await setWalletChain(page, '0x1');
    await expect(page.getByRole('button', { name: 'Aprovar e continuar', exact: true })).toBeDisabled();
    await setWalletChain(page, chain);
    await expect(page.getByRole('button', { name: 'Aprovar e continuar', exact: true })).toBeDisabled();
    expect(await walletRequests(page)).not.toContain('eth_sendTransaction');
    const reads = await request.get('https://127.0.0.1:8558/', { ignoreHTTPSErrors: true });
    expect((await reads.json()).methods.every((method: string) => ['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call'].includes(method))).toBe(true);
    networkGuard.assertClean();
  });
}
