// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, chooseWallet } from './fixtures';
import { createTestWallet } from '../../../packages/reference-reconciler/test/test-wallet';
import { installJourneyWallet, walletRequests } from './journey-fixtures';
import { assertAutomationHarness, query } from './automation-fixtures';
import { groundAutomationDraft, type AutomationDraft } from '../src/domain/copilot-automation';
import { validateAutomationInput } from '../src/automations/definition';

const draft: AutomationDraft = { kind: 'SCHEDULED_DCA', asset: 'ETH', side: 'BUY', network: 'BASE_SEPOLIA', amount: '10', spendAsset: 'USDC', time: '09:00', condition: null, threshold: null };
const cases = [
  ['Buy 10 USDC of ETH every day at 9:00 on Base Sepolia.', draft, 'EN'],
  ['Todo dia às 9:00 compre 10 USDC de ETH na Base Sepolia.', draft, 'PT'],
  ['If ETH falls below $3000, prepare a buy of 50 USDC on Base Sepolia.', { ...draft, kind: 'PRICE_TRIGGER', amount: '50', time: null, condition: 'PRICE_BELOW', threshold: '3000' }, 'EN'],
  ['If ETH rises above $5000, prepare a sell of 0.1 ETH on Base Sepolia.', { ...draft, kind: 'PRICE_TRIGGER', amount: '0.1', spendAsset: 'ETH', side: 'SELL', time: null, condition: 'PRICE_ABOVE', threshold: '5000' }, 'EN'],
  ['Todos os dias às 8h verifica ETH para mim.', { ...draft, kind: 'DAILY_WATCH', side: null, network: null, amount: null, spendAsset: null, time: '08:00' }, 'PT'],
] as const;
test.beforeAll(() => { assertAutomationHarness(); if (process.env.FLOFI_COPILOT !== 'replay') throw Error('REPLAY_REQUIRED'); });
for (const [text, interpretation, language] of cases) test(`explicit chat confirmation persists the workspace rule: ${text}`, async ({ page, networkGuard }) => {
  const owner = createTestWallet();
  await installJourneyWallet(page, [owner], { chain: '0x14a34' });
  await page.goto('/app/automations');
  await page.getByRole('button', { name: 'Connect wallet and prove ownership', exact: true }).click();
  await chooseWallet(page, 'Browser wallet');
  await expect(page.getByRole('heading', { name: 'Create an automation', exact: true })).toBeVisible();
  if (language === 'PT') await page.evaluate(() => localStorage.setItem('flofi.language', 'PT'));
  await page.goto('/app');
  const beforeAuthoring = (await walletRequests(page)).length;
  const create = language === 'PT' ? 'Criar automação' : 'Create automation';
  async function ask() { await page.locator('#mock-prompt').fill(text); await page.locator('.chat-form button[type=submit]').click(); }
  await ask();
  const proposal = page.locator('.copilot-automation-proposal');
  await expect(proposal).toBeVisible();
  await expect(proposal.getByRole('button', { name: create, exact: true })).toBeEnabled();
  const rows = () => query<{ execution_mode: string; definition: unknown; binding: unknown }>('SELECT execution_mode, definition, action_strategy AS binding FROM automation_rules WHERE owner_account=$1', [owner.address.toLowerCase()]);
  expect(await rows()).toEqual([]);
  // Dismiss is terminal for the draft and never calls the create operation.
  await proposal.getByRole('button', { name: language === 'PT' ? 'Descartar proposta' : 'Dismiss proposal', exact: true }).click();
  expect(await rows()).toEqual([]);
  await ask(); await expect(proposal.getByRole('button', { name: create, exact: true })).toBeEnabled();
  const timezone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const grounded = groundAutomationDraft(interpretation as AutomationDraft, text, timezone, Date.now(), language);
  if (grounded.kind !== 'PROPOSAL') throw Error(grounded.message);
  const normalized = validateAutomationInput(grounded.input, Date.now());
  if (!normalized.ok) throw Error(normalized.code);
  await proposal.getByRole('button', { name: create, exact: true }).click();
  await expect(proposal.getByRole('status')).toContainText(language === 'PT' ? 'Automação criada' : 'Automation created');
  const rules = await rows(); expect(rules).toHaveLength(1);
  expect(rules[0]).toMatchObject({ execution_mode: 'CONFIRM_EACH_TIME', definition: normalized.value.definition });
  expect(Boolean(rules[0]!.binding)).toBe(interpretation.kind !== 'DAILY_WATCH');
  expect(await query('SELECT * FROM execution_runs WHERE owner_account=$1', [owner.address.toLowerCase()])).toEqual([]);
  expect((await walletRequests(page)).slice(beforeAuthoring).filter(method => /sign|send/i.test(method))).toEqual([]);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
  networkGuard.assertClean();
});
for (const text of ['Compre ETH todo dia.', 'Buy 10 USDC of ETH every day at 9:00.', 'Buy 10 USDC of BTC every day at 9:00 on Base Sepolia.']) test(`clarification/refusal cannot silently create: ${text}`, async ({ page }) => {
  await page.goto('/app'); await page.locator('#mock-prompt').fill(text); await page.locator('.chat-form button[type=submit]').click();
  await expect(page.locator('.message.ai')).toHaveCount(1);
  await expect(page.locator('.copilot-automation-proposal')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create automation', exact: true })).toHaveCount(0);
});
