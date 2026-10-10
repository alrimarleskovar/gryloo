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
 */
import { createMockedSolanaWallet } from '@defi-workflow-engine/reference-compiler';
import { dispatch, occurrencesOf, query, ruleOf } from './automation-fixtures';
import { assertDelegationHarness, chainControl, createDelegationOwner, delegationDispatch, evmWalletRequests, expect, installDelegationEvmWallet, SIGNING_METHODS, test,
  virtualAuthenticator } from './delegation-fixtures';
import { chooseWallet } from './fixtures';
import { installSolanaWallet, MOCKED_SOLANA_WALLET, signRequests } from './jupiter-fixtures';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
type Sends = { evm: number; solana: number };

test.describe('BUILD-AUTOMATION-002 delegated execution (MOCKED loopback chains, virtual passkey, test clock)', () => {
  test.beforeAll(() => assertDelegationHarness());

  test('Credentials enrolled once → ONE passkey authorization → EVM + Solana execute with no owner signature → revoke stops it', async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await chainControl('MOCK_reset');
    const owner = await createDelegationOwner(), solana = createMockedSolanaWallet();
    await chainControl('MOCK_evmOwner', [owner.address, '1000000000']);
    await chainControl('MOCK_solanaOwner', [solana.owner, '100000000']);
    await installDelegationEvmWallet(page, owner);
    await installSolanaWallet(page, solana, { signMessage: true, chains: ['solana:devnet'] });
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
    const executions = () => query<{ state: string; evidence_level: string | null }>(
      "SELECT state, evidence->>'evidenceLevel' AS evidence_level FROM delegated_executions WHERE rule_id = $1 ORDER BY created_at", [rule.rule_id]);
    expect(await executions()).toEqual([{ state: 'SETTLED', evidence_level: 'MOCKED' }]);
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
    expect(await query<{ step_index: number; state: string; spent: string }>(`SELECT b.step_index, b.state, b.spent_amount::text AS spent FROM delegated_budget_entries b
      JOIN delegated_executions e ON e.tenant_id = b.tenant_id AND e.execution_id = b.execution_id WHERE e.rule_id = $1 ORDER BY b.step_index`, [rule.rule_id]))
      .toEqual([{ step_index: 0, state: 'SPENT', spent: '50000000' }, { step_index: 1, state: 'SPENT', spent: '5000000' }]);
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
    expect((await executions()).filter(e => e.state === 'SETTLED')).toHaveLength(1);

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
});
