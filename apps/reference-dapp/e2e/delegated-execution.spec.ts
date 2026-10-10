// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: "Automatic within limits" in a real browser, under `next start` on the embedded PostgreSQL runtime, against the
 * MOCKED loopback chain doubles (Base Sepolia with a JS model of the MetaMask Delegation Framework v1.3.0 enforcers; Solana Devnet with SPL
 * delegation and a fixture swap program), a WebAuthn virtual authenticator, disposable session signers under /tmp and the deterministic
 * test clock. Nothing reaches a public chain or provider; the evidence is MOCKED.
 *
 *   the owner proves the EVM wallet → registers a passkey → enrolls the EVM wallet once (one EIP-712 signature) → proves and enrolls the
 *   Solana wallet once (one signed SPL delegation) → creates a weekly two-step workflow (Base Sepolia + Solana Devnet) in "Automatic within
 *   limits" → FloFi resolves both Credentials before anything is created → the human-readable Authorization Review → ONE passkey
 *   signature → Active → the schedule fires → both domains execute by delegated authority with no wallet request and no passkey prompt →
 *   the evidence names each step's Credential and grant → the budget moved → "Revoke authorization" → the next slot executes nothing →
 *   the EVM Credential is revoked on-chain by the owner's own wallet.
 *
 * The same delegated flow from the two other authoring surfaces (PR #77), each ending in ONE passkey authorization and an execution with
 * no owner signature:
 *
 *   Chat     a typed price-trigger draft (the committed replay; the AI only interprets) → the owner, not the assistant, chooses "Automatic
 *            within limits" and enters every limit and the expiry → the 5% drop executes.
 *   Canvas   "Automate this workflow" on the exact two-step Canvas workflow → schedule and limits → the slot executes both steps.
 */
import type { Page } from '@playwright/test';
import { createMockedSolanaWallet } from '@defi-workflow-engine/reference-compiler';
import { dispatch, occurrencesOf, query, ruleOf, setPrices } from './automation-fixtures';
import { assertDelegationHarness, chainControl, createDelegationOwner, delegationDispatch, evmWalletRequests, expect, installDelegationEvmWallet, SIGNING_METHODS, test,
  virtualAuthenticator } from './delegation-fixtures';
import { applyPendingProposal, chooseWallet } from './fixtures';
import { installSolanaWallet, MOCKED_SOLANA_WALLET, signRequests } from './jupiter-fixtures';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
type Sends = { evm: number; solana: number };
const executionsOf = (ruleId: string) => query<{ state: string; evidence_level: string | null }>(
  "SELECT state, evidence->>'evidenceLevel' AS evidence_level FROM delegated_executions WHERE rule_id = $1 ORDER BY created_at", [ruleId]);
const budgetOf = (ruleId: string) => query<{ step_index: number; state: string; spent: string }>(`SELECT b.step_index, b.state, b.spent_amount::text AS spent
  FROM delegated_budget_entries b JOIN delegated_executions e ON e.tenant_id = b.tenant_id AND e.execution_id = b.execution_id WHERE e.rule_id = $1 ORDER BY b.step_index`, [ruleId]);
const rulesOf = (owner: string) => query<{ kind: string; execution_mode: string; state: string; definition: unknown }>(
  'SELECT kind, execution_mode, state, definition FROM automation_rules WHERE owner_account = $1', [owner.toLowerCase()]);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Steps 1–4 of every journey, once per owner: a fresh wallet sign-in, a passkey (the owner's chain-neutral key for authorizing whole
 * workflows), then each wallet enrolled ONCE as an execution Credential — the EVM wallet with one EIP-712 signature and, when asked, the
 * Solana wallet with one signed SPL delegation. Nothing after this asks the owner's wallets to sign again.
 */
async function enrollOnce(page: Page, { solana: withSolana }: { solana: boolean }) {
  await chainControl('MOCK_reset');
  const owner = await createDelegationOwner(), solana = createMockedSolanaWallet();
  await chainControl('MOCK_evmOwner', [owner.address, '1000000000']);
  await chainControl('MOCK_solanaOwner', [solana.owner, '100000000']);
  await installDelegationEvmWallet(page, owner);
  if (withSolana) await installSolanaWallet(page, solana, { signMessage: true, chains: ['solana:devnet'] });
  const passkey = await virtualAuthenticator(page);
  const signCount = async () => (await passkey.cdp.send('WebAuthn.getCredentials', { authenticatorId: passkey.id })).credentials[0]?.signCount ?? -1;
  const signing = async () => (await evmWalletRequests(page)).filter(m => SIGNING_METHODS.includes(m));

  // 1–2. A fresh wallet sign-in, then a passkey: the owner's chain-neutral key for authorizing whole workflows.
  await page.goto('/app/passkeys');
  await page.getByRole('button', { name: 'Connect wallet and prove ownership', exact: true }).click();
  await chooseWallet(page, 'Browser wallet');
  const passkeys = page.getByRole('region', { name: 'Passkeys', exact: true });
  await passkeys.getByRole('textbox', { name: 'Passkey name', exact: true }).fill('Test laptop');
  await passkeys.getByRole('button', { name: 'Add a passkey', exact: true }).click();
  await expect(passkeys.getByRole('status')).toHaveText('Passkey added.');
  await expect(passkeys.getByRole('listitem', { name: 'Passkey Test laptop', exact: true })).toContainText('Active');
  expect(await passkey.credentials()).toBe(1);

  // 3. Enroll the EVM wallet once: ONE EIP-712 signature of a bounded ERC-7710 delegation to a dedicated session signer.
  await page.goto('/app/credentials');
  const execution = page.getByRole('region', { name: 'Automatic execution', exact: true });
  const enroll = execution.getByRole('form', { name: 'Enroll a wallet for automatic execution', exact: true });
  await enroll.getByRole('button', { name: 'Enroll with my wallet', exact: true }).click();
  await expect(execution.getByRole('status')).toHaveText('Credential enrolled: this wallet can now serve automatic workflows within its limits.');
  const evmCredential = execution.getByRole('listitem', { name: `Credential ${short(owner.address)} on Base Sepolia`, exact: true });
  await expect(evmCredential).toContainText('Active');
  await expect(evmCredential).toContainText('MetaMask delegation (ERC-7710)');
  expect((await signing()).filter(m => m === 'eth_signTypedData_v4')).toHaveLength(1);

  // 4. Enroll the Solana wallet once: prove it (Sign-In With Solana), then ONE signed SPL delegation transaction.
  if (withSolana) {
    await enroll.getByLabel('Credential network', { exact: true }).selectOption('solana-devnet');
    await enroll.getByRole('button', { name: 'Connect Solana wallet and prove ownership', exact: true }).click();
    await chooseWallet(page, MOCKED_SOLANA_WALLET, 'Solana');
    await expect(enroll.getByRole('button', { name: 'Connect Solana wallet and prove ownership', exact: true })).toHaveCount(0);
    await enroll.getByRole('button', { name: 'Enroll with my wallet', exact: true }).click();
    await expect(execution.getByRole('status')).toHaveText('Credential enrolled: this wallet can now serve automatic workflows within its limits.');
    const solanaCredential = execution.getByRole('listitem', { name: `Credential ${short(solana.owner)} on Solana Devnet`, exact: true });
    await expect(solanaCredential).toContainText('Active');
    await expect(solanaCredential).toContainText('recipient and program are checked by FloFi, not on-chain');
    expect(await signRequests(page)).toBe(1);
  }
  return { owner, solana, signCount, signing, execution, evmCredential };
}

test.describe('BUILD-AUTOMATION-002 delegated execution (MOCKED loopback chains, virtual passkey, test clock)', () => {
  test.beforeAll(() => assertDelegationHarness());

  test('Credentials enrolled once → ONE passkey authorization → EVM + Solana execute with no owner signature → revoke stops it', async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const { owner, solana, signCount, signing, execution, evmCredential } = await enrollOnce(page, { solana: true });

    // 5. One workflow across both domains, in "Automatic within limits"; FloFi resolves every step's Credential before creating anything.
    await page.goto('/app/automations');
    const workspace = page.getByRole('region', { name: 'Automations', exact: true });
    await workspace.getByRole('radio', { name: 'Automatic within limits', exact: true }).check();
    const form = workspace.getByRole('form', { name: 'Create an automatic workflow', exact: true });
    await form.getByRole('textbox', { name: 'Name', exact: true }).fill('Weekly cross-chain');
    await form.getByRole('textbox', { name: 'Step 1 amount', exact: true }).fill('50');
    await form.getByRole('button', { name: 'Add a step', exact: true }).click();
    await form.getByRole('textbox', { name: 'Step 2 amount', exact: true }).fill('5');
    await form.getByRole('button', { name: 'Check credentials and limits', exact: true }).click();
    const check = form.getByRole('region', { name: 'Authority check', exact: true });
    await expect(check).toContainText(`covered by your Credential for wallet ${short(owner.address)}`);
    await expect(check).toContainText(`covered by your Credential for wallet ${short(solana.owner)}`);
    await form.getByRole('button', { name: 'Create and review authorization', exact: true }).click();

    // 6. The human-readable Universal Authorization Review, then ONE passkey signature — no wallet request.
    const review = workspace.getByRole('region', { name: 'Authorization review', exact: true });
    await expect(review).toContainText('Automatic execution allowed');
    await expect(review).toContainText('FloFi may execute without asking you again while all these limits remain valid.');
    await expect(review).toContainText('Wallet setup: 2 Credential(s) already enrolled — no new wallet signature is needed.');
    const walletBefore = await signing(), solanaBefore = await signRequests(page), countBefore = await signCount();
    await review.getByRole('button', { name: 'Authorize with passkey', exact: true }).click();
    await expect(workspace).toContainText('Authorized. FloFi may now execute this automation within your limits without asking you again.');
    const delegated = workspace.getByRole('region', { name: 'Automatic within limits', exact: true });
    const card = delegated.getByRole('article', { name: 'Automatic workflow Weekly cross-chain', exact: true });
    await expect(card.locator('.automation-badge')).toHaveText('Active');
    expect(await signCount()).toBe(countBefore + 1);
    expect(await signing()).toEqual(walletBefore);
    expect(await signRequests(page)).toBe(solanaBefore);

    // 7. The schedule fires (test clock): ONE occurrence, executed by delegated authority in both domains.
    const rule = await ruleOf(owner.address, 'Weekly cross-chain');
    expect(rule.state).toBe('ACTIVE');
    const due = new Date(new Date(rule.next_evaluation_at).getTime() + 30_000);
    const sendsBefore = await chainControl<Sends>('MOCK_sends');
    expect((await dispatch(due)).status).toBe(200);
    expect((await dispatch(due)).status).toBe(200);
    expect(await occurrencesOf(rule.rule_id)).toEqual([{ occurrence_id: expect.stringMatching(/^occ_/), state: 'DELEGATED', trigger_key: expect.stringMatching(/^slot:/), handoff_id: null }]);
    expect((await delegationDispatch(due)).status).toBe(200);
    expect(await executionsOf(rule.rule_id)).toEqual([{ state: 'SETTLED', evidence_level: 'MOCKED' }]);
    const sendsAfter = await chainControl<Sends>('MOCK_sends');
    expect(sendsAfter.evm).toBeGreaterThan(sendsBefore.evm);
    expect(sendsAfter.solana).toBe(sendsBefore.solana + 1);

    // 8. Nothing asked the owner again; the evidence names each step's Credential and grant; the budget moved.
    expect(await signing()).toEqual(walletBefore);
    expect(await signRequests(page)).toBe(solanaBefore);
    expect(await signCount()).toBe(countBefore + 1);
    await delegated.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(card).toContainText('Settled');
    await expect(card).toContainText('evidence MOCKED');
    await expect(card).toContainText(/Step 1 · Base Sepolia · Reconciled · Credential crd_\w+…\w{4}, grant grt_\w+…\w{4}/);
    await expect(card).toContainText(/Step 2 · Solana Devnet · Reconciled · Credential crd_\w+…\w{4}, grant grt_\w+…\w{4}/);
    // Budget: each step's reservation settled as spent, in the execution's own week (the overview's table shows the current week).
    expect(await budgetOf(rule.rule_id)).toEqual([{ step_index: 0, state: 'SPENT', spent: '50000000' }, { step_index: 1, state: 'SPENT', spent: '5000000' }]);
    await expect(card.getByRole('table', { name: 'Budget', exact: true })).toContainText('USDC');
    await expect(card.getByRole('table', { name: 'Budget', exact: true })).toContainText('devUSDC');

    // 9. "Revoke authorization": FloFi stops at once; the next weekly slot executes nothing.
    await card.getByRole('button', { name: 'Revoke authorization', exact: true }).click();
    await expect(workspace).toContainText('Authorization revoked. FloFi will not execute this workflow again.');
    await expect(card.locator('.automation-badge')).toHaveText('Revoked');
    const next = new Date(due.getTime() + 7 * 86_400_000);
    await dispatch(next);
    await delegationDispatch(next);
    expect(await chainControl<Sends>('MOCK_sends')).toEqual(sendsAfter);
    expect((await executionsOf(rule.rule_id)).filter(e => e.state === 'SETTLED')).toHaveLength(1);

    // 10. Revoking the EVM Credential: FloFi stops using it, then the owner's own wallet disables the delegation on-chain (verified).
    await page.goto('/app/credentials');
    await evmCredential.getByRole('button', { name: 'Revoke credential', exact: true }).click();
    await expect(evmCredential).toContainText('Revocation requested');
    await evmCredential.getByRole('button', { name: 'Revoke on-chain with your wallet', exact: true }).click();
    await expect(execution.getByRole('status')).toHaveText('Revocation submitted by your wallet and checked on-chain.');
    await expect(evmCredential).toContainText('Revoked');
    expect((await signing()).filter(m => m === 'eth_sendTransaction')).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test('Chat: the owner — not the assistant — chooses "Automatic within limits" and every limit → ONE passkey authorization → the 5% drop executes with no owner signature', async ({ page }) => {
    if (process.env.FLOFI_COPILOT !== 'replay') throw new Error('REPLAY_REQUIRED');
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const { owner, signCount, signing } = await enrollOnce(page, { solana: false });

    // The committed replay is the AI's typed reading of this message: a PRICE_TRIGGER draft with no mode, limit, expiry or Credential.
    await page.goto('/app');
    await page.locator('#mock-prompt').fill('If ETH drops 5% from $3000, buy 50 USDC of ETH on Base Sepolia automatically, max 200 USDC/week.');
    await page.locator('.chat-form button[type=submit]').click();
    const proposal = page.getByRole('region', { name: 'Automation proposal', exact: true });
    await expect(proposal).toContainText('Price falls 5% from $3000');
    const mode = proposal.getByRole('radiogroup', { name: 'Execution', exact: true });
    // "automatically" in the message preselects nothing: delegated mode exists only as the owner's explicit choice.
    await expect(mode.getByRole('radio', { name: 'Ask every time', exact: true })).toBeChecked();
    await mode.getByRole('radio', { name: 'Automatic within limits', exact: true }).check();
    await expect(proposal).toContainText('Set every limit and the expiry yourself: the assistant never chooses them.');
    // Nothing is prefilled from the AI's reading: no expiry, no execution count and (below) no budget, not even the "200 USDC/week" it read.
    const expires = proposal.getByLabel('Expires on', { exact: true }), perWeek = proposal.getByLabel('Executions per week', { exact: true });
    await expect(expires).toHaveValue('');
    await expect(perWeek).toHaveValue('');
    const checkButton = proposal.getByRole('button', { name: 'Check credentials and limits', exact: true });
    await expect(checkButton).toBeDisabled();
    await expires.fill(inDays(60));
    await perWeek.fill('4');
    await checkButton.click();
    await expect(proposal.getByRole('region', { name: 'Authority check', exact: true })).toContainText(`covered by your Credential for wallet ${short(owner.address)}`);
    const max = proposal.getByLabel('Max USDC per execution', { exact: true }), budget = proposal.getByLabel('USDC budget per week', { exact: true });
    await expect(max).toHaveValue('');
    await expect(budget).toHaveValue('');
    const create = proposal.getByRole('button', { name: 'Create and review authorization', exact: true });
    await expect(create).toBeDisabled();
    await max.fill('50');
    await budget.fill('200');
    expect(await rulesOf(owner.address)).toEqual([]);
    await create.click();

    // The Universal Authorization Review shows the owner's limits; the rule exists only paused until the passkey signs.
    const review = proposal.getByRole('region', { name: 'Authorization review', exact: true });
    await expect(review).toContainText('Automatic execution allowed');
    await expect(review.locator('.delegation-limits > li')).toHaveText(['50 USDC per execution', '200 USDC per week', '4 executions per week', '0.5% slippage', /^expires /]);
    await expect(review).toContainText('Wallet setup: 1 Credential(s) already enrolled — no new wallet signature is needed.');
    expect(await rulesOf(owner.address)).toMatchObject([{ kind: 'PRICE_TRIGGER', execution_mode: 'DELEGATED_WITH_LIMITS', state: 'PAUSED' }]);
    const walletBefore = await signing(), countBefore = await signCount();
    await review.getByRole('button', { name: 'Authorize with passkey', exact: true }).click();
    await expect(proposal).toContainText('Automatic workflow active.');
    await expect(proposal.getByRole('radiogroup', { name: 'Execution', exact: true })).toHaveCount(0);
    expect(await signCount()).toBe(countBefore + 1);
    expect(await signing()).toEqual(walletBefore);
    expect(await rulesOf(owner.address)).toMatchObject([{ kind: 'PRICE_TRIGGER', execution_mode: 'DELEGATED_WITH_LIMITS', state: 'ACTIVE',
      definition: { condition: { type: 'PERCENT_DROP', asset: 'ETH', reference: '3000', percent: '5', checkEveryMinutes: 15 } } }]);

    // At $3000 the rule arms; the 5% drop to $2850 is ONE occurrence, executed by delegated authority with no owner signature.
    const rule = await ruleOf(owner.address, 'ETH Price trigger');
    await setPrices({ ETH: '3000' });
    let at = new Date(new Date(rule.next_evaluation_at).getTime() + 1_000);
    expect((await dispatch(at)).status).toBe(200);
    expect(await occurrencesOf(rule.rule_id)).toEqual([]);
    await setPrices({ ETH: '2850' });
    at = new Date(Math.ceil((at.getTime() + 1) / 900_000) * 900_000 + 1_000);
    expect((await dispatch(at)).status).toBe(200);
    expect(await occurrencesOf(rule.rule_id)).toEqual([{ occurrence_id: expect.stringMatching(/^occ_/), state: 'DELEGATED', trigger_key: 'price:1', handoff_id: null }]);
    expect((await delegationDispatch(at)).status).toBe(200);
    expect(await executionsOf(rule.rule_id)).toEqual([{ state: 'SETTLED', evidence_level: 'MOCKED' }]);
    expect(await budgetOf(rule.rule_id)).toEqual([{ step_index: 0, state: 'SPENT', spent: '50000000' }]);
    expect(await signing()).toEqual(walletBefore);
    expect(await signCount()).toBe(countBefore + 1);
    expect(errors).toEqual([]);
  });

  test('Canvas: "Automate this workflow" reuses the exact two-step Canvas workflow → ONE passkey authorization → both steps execute with no owner signature', async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const { owner, signCount, signing } = await enrollOnce(page, { solana: false });

    // The owner authors a two-step workflow on the Canvas (FloFi's deterministic grammar, applied through the normal proposal review).
    await page.goto('/app');
    for (const sentence of ['swap 50 USDC to WETH on Base Sepolia slippage 50 bps', 'swap 40 USDC to WETH on Base Sepolia slippage 50 bps']) {
      await page.getByLabel('Describe your flow', { exact: true }).fill(sentence);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await applyPendingProposal(page);
    }
    await page.locator('.canvas-automate-action').getByRole('button', { name: 'Automate this workflow', exact: true }).click();

    // Automations opens on THIS workflow: its steps are re-derived from the Canvas document, never re-entered or re-interpreted.
    await expect(page).toHaveURL(/\/app\/automations$/);
    const panel = page.getByRole('region', { name: 'Automate this workflow', exact: true });
    await expect(panel.locator('.delegation-steps > li')).toHaveText(['Step 1 · 50 USDC → WETH · Base Sepolia', 'Step 2 · 40 USDC → WETH · Base Sepolia']);
    const mode = panel.getByRole('radiogroup', { name: 'Execution', exact: true });
    await expect(mode.getByRole('radio', { name: 'Ask every time', exact: true })).toBeChecked();
    await expect(panel).toContainText('Ask every time runs one-step workflows. This workflow has 2 steps, so it can only run automatically within limits.');
    await mode.getByRole('radio', { name: 'Automatic within limits', exact: true }).check();
    await panel.getByRole('textbox', { name: 'Name', exact: true }).fill('Canvas weekly ETH');
    await panel.getByRole('button', { name: 'Check credentials and limits', exact: true }).click();
    const check = panel.getByRole('region', { name: 'Authority check', exact: true });
    await expect(check.locator('li[data-ok=true]')).toHaveCount(2);
    // Editable defaults come from the amounts the owner authored on the Canvas (90 USDC per execution, four executions a week).
    await expect(panel.getByLabel('Max USDC per execution', { exact: true })).toHaveValue('90');
    await expect(panel.getByLabel('USDC budget per week', { exact: true })).toHaveValue('360');
    expect(await rulesOf(owner.address)).toEqual([]);
    await panel.getByRole('button', { name: 'Create and review authorization', exact: true }).click();

    const review = panel.getByRole('region', { name: 'Authorization review', exact: true });
    await expect(review).toContainText('Wallet setup: 1 Credential(s) already enrolled — no new wallet signature is needed.');
    const walletBefore = await signing(), countBefore = await signCount();
    await review.getByRole('button', { name: 'Authorize with passkey', exact: true }).click();
    await expect(panel).toContainText('Automatic workflow active.');
    const card = page.getByRole('region', { name: 'Automatic within limits', exact: true }).getByRole('article', { name: 'Automatic workflow Canvas weekly ETH', exact: true });
    await expect(card.locator('.automation-badge')).toHaveText('Active');
    expect(await signCount()).toBe(countBefore + 1);
    expect(await signing()).toEqual(walletBefore);
    expect(await rulesOf(owner.address)).toMatchObject([{ kind: 'SCHEDULED_DCA', execution_mode: 'DELEGATED_WITH_LIMITS', state: 'ACTIVE' }]);

    // The weekly slot: ONE occurrence, both Canvas steps executed in order by delegated authority, no owner signature.
    const rule = await ruleOf(owner.address, 'Canvas weekly ETH');
    const due = new Date(new Date(rule.next_evaluation_at).getTime() + 30_000);
    expect((await dispatch(due)).status).toBe(200);
    expect(await occurrencesOf(rule.rule_id)).toEqual([{ occurrence_id: expect.stringMatching(/^occ_/), state: 'DELEGATED', trigger_key: expect.stringMatching(/^slot:/), handoff_id: null }]);
    expect((await delegationDispatch(due)).status).toBe(200);
    expect(await executionsOf(rule.rule_id)).toEqual([{ state: 'SETTLED', evidence_level: 'MOCKED' }]);
    expect(await budgetOf(rule.rule_id)).toEqual([{ step_index: 0, state: 'SPENT', spent: '50000000' }, { step_index: 1, state: 'SPENT', spent: '40000000' }]);
    expect(await signing()).toEqual(walletBefore);
    expect(await signCount()).toBe(countBefore + 1);
    expect(errors).toEqual([]);
  });
});
