// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { encodeApprove, encodeSafeOwnerCall, toHex } from '@defi-workflow-engine/reference-compiler';
import { hashArtifactBytes, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
import { editorReducer, initialEditor } from './editor';
import { canvasAddCommand } from './canvas-authoring';
import { projectReview, reviewedManifest, reviewApprovalCall, reviewApprovalValue } from './review-presentation';
import { reviewFixture, reviewNow, reviewOwner, reviewSpender } from '../test-utils/review-fixture';
const project = (f = reviewFixture(), now = reviewNow) => projectReview(f.workflow, f.context, f.source, f.authorization, f.wallet, now);
describe('Review authorization presentation', () => {
  it('projects validated Manifest limits and permissions from the exact current workflow', () => {
    const f = reviewFixture(), view = project(f);
    expect(reviewedManifest(f.manifest)).not.toBeNull(); expect(view.canApprove).toBe(true);
    expect(view.steps).toMatchObject([{ number: 1, action: 'Swap', input: '100 USDC', pair: 'USDC → WETH', network: 'Base Sepolia' }]);
    expect(view.permissions).toEqual(['Swap']);
    expect(view.limits).toContainEqual({ label: 'Max spend', value: '100 USDC', note: 'Base Sepolia' });
    expect(view.limits).toContainEqual({ label: 'Max per action', value: '75 USDC', note: 'Base Sepolia' });
    expect(view.limits).toContainEqual({ label: 'Max slippage', value: '0.50%' });
    expect(view.limits).toContainEqual({ label: 'Allowed networks', value: 'Base Sepolia' });
    expect(view.limits).toContainEqual({ label: 'Allowed providers', value: 'Uniswap V3' });
    expect(view.preview.join(' ')).toContain('Swap · 100 USDC'); expect(view.preview.join(' ')).toContain('Max spend · 100 USDC');
    expect(view.limits.map(l => l.label)).not.toContain('Max leverage');
  });
  it('keeps composed actions, linked amounts, networks and permissions in their authored order', () => {
    const f = reviewFixture();
    f.workflow = editorReducer(initialEditor(), canvasAddCommand('lending', 0, reviewOwner, '100'), f.context).workflow;
    const view = project(f);
    expect(view.steps.map(s => s.action)).toEqual(['Supply', 'Borrow', 'Swap']);
    expect(view.steps.map(s => s.number)).toEqual([1, 2, 3]);
    expect(view.permissions).toEqual(['Supply', 'Borrow', 'Swap']);
    expect(view.canApprove).toBe(false); expect(view.label).toBe('Review required again');
  });
  it.each([
    ['maximumSlippageBps', 'Max slippage', '1.25%', '125'],
    ['maximumAmount', 'Max spend', '87.654321 USDC', '87654321'],
    ['maximumPerStepAmount', 'Max per action', '12.345678 USDC', '12345678'],
    ['maximumCumulativeAmount', 'Max total spend', '123.456789 USDC', '123456789'],
  ] as const)('reads %s independently from the supplied Manifest', (field, label, value, units) => {
    const f = reviewFixture();
    if (field === 'maximumSlippageBps') f.manifest[field] = 125;
    else f.manifest.spendLimits[0]![field] = units;
    const view = project(f);
    expect(view.limits.find(line => line.label === label)?.value).toBe(value);
    if (field !== 'maximumSlippageBps') expect(view.limits.find(line => line.label === 'Max slippage')?.value).toBe('0.50%');
    if (field !== 'maximumPerStepAmount') expect(view.limits.find(line => line.label === 'Max per action')?.value).toBe('75 USDC');
    if (field !== 'maximumAmount') expect(view.limits.find(line => line.label === 'Max spend')?.value).toBe('100 USDC');
  });
  it.each(['spend bound', 'slippage bound', 'network allowlist', 'provider constraint'] as const)('rejects a changed policy %s whose Manifest binding was not refreshed', change => {
    const f = reviewFixture(), changed = structuredClone(f.policy); f.authorization.accepted = true;
    f.authorization.policy = changed;
    if (change === 'spend bound') changed.spendLimits[0]!.maximumAmount = '90000000';
    if (change === 'slippage bound') changed.maximumSlippageBps = 100;
    if (change === 'network allowlist') changed.allowlists.chains.push('eip155:42161');
    if (change === 'provider constraint') changed.providers = { kind: 'FIXED', providerId: 'another-provider' };
    // Prove that binding, rather than malformed data or shared fixture objects, blocks approval.
    expect(() => validateArtifact('authorization-policy', changed)).not.toThrow();
    expect(reviewedManifest(f.manifest)).not.toBeNull();
    expect(project(f)).toMatchObject({ label: 'Review blocked', canApprove: false });
  });
  it.each(['amount', 'asset', 'network', 'provider', 'slippage', 'recipient', 'route', 'approval bound'])('rejects an authorization-relevant %s change even without a retired flag or revision change', change => {
    const f = reviewFixture(), edited = JSON.parse(JSON.stringify(f.workflow)) as SemanticWorkflow, node = edited.nodes.at(-1)!;
    if (change === 'amount') { const input = node.inputs.find(i => i.kind === 'QUANTITY'); if (input?.kind === 'QUANTITY') input.value.amount = '101000000'; }
    if (change === 'asset') { const input = node.inputs.find(i => i.kind === 'ASSET'); if (input?.kind === 'ASSET' && 'address' in input.value) input.value.address = reviewSpender; }
    if (change === 'network') node.chainId = 'eip155:42161';
    if (change === 'provider') node.adapterConstraints.protocols = ['another-provider'];
    if (change === 'slippage') { const limit = node.userConstraints.find(c => c.kind === 'MAXIMUM_SLIPPAGE_BPS'); if (limit?.kind === 'MAXIMUM_SLIPPAGE_BPS') limit.maximumBps = 75; }
    if (change === 'recipient') node.inputs.push({ name: 'recipient', kind: 'ACCOUNT', value: { chainId: node.chainId, address: reviewSpender } });
    if (change === 'route') node.userConstraints.push({ kind: 'MINIMUM_OUTPUT', quantity: { asset: { ...f.context.assets.WETH.asset }, amount: '25000000000000000' } });
    if (change === 'approval bound') node.editableBounds[0]!.maximumAmount = '500000000';
    f.workflow = edited;
    expect(project(f).label).toBe('Review required again'); expect(project(f).canApprove).toBe(false);
  });
  it('blocks expired quotes, invalid manifests, invalid policies, stale runtime and blocking warnings even when previously accepted', () => {
    const f = reviewFixture(); f.authorization.accepted = true;
    expect(project(f).label).toBe('Review approved');
    expect(project(f, reviewNow + 120_000)).toMatchObject({ label: 'Simulation expired', canApprove: false });
    f.authorization.manifest = { ...f.manifest, maximumSlippageBps: -1 };
    expect(project(f).canApprove).toBe(false); f.authorization.manifest = f.manifest;
    f.authorization.policy = { ...f.policy, deadline: 'invalid' };
    expect(project(f).canApprove).toBe(false); f.authorization.policy = f.policy;
    Object.assign(f.source.state, { retired: true }); expect(project(f).label).toBe('Review required again');
    Object.assign(f.source.state, { retired: false, error: 'INSUFFICIENT_BALANCE' });
    expect(project(f)).toMatchObject({ label: 'Review blocked', canApprove: false });
    expect(project(f).message).not.toContain('INSUFFICIENT');
  });
  it('reflects wallet/network changes, unknown networks and a latched wallet change without false readiness', () => {
    const f = reviewFixture(); f.wallet.account = reviewSpender;
    expect(project(f)).toMatchObject({ label: 'Review required again', canApprove: false });
    f.wallet.account = reviewOwner; f.wallet.changed = true;
    expect(project(f).message).toContain('Wallet changed');
    f.wallet.changed = false; f.wallet.chain = 'eip155:42161';
    expect(project(f).message).toContain('Network changed');
    f.wallet.chain = null; f.wallet.environment = 'unknown'; expect(project(f).canApprove).toBe(false);
  });
  it('projects real policy safety bounds only while preserving their binding to the Manifest', () => {
    const f = reviewFixture();
    f.policy.accountRiskRules.push({ account: f.manifest.owner, minimumHealthFactorNumerator: '2', minimumHealthFactorDenominator: '1', maximumLtvBps: 7500, maximumExposure: [], oracleId: 'aave-oracle', checkpointId: 'borrow-risk' });
    f.manifest.policyHash = hashArtifactBytes('authorization-policy', new TextEncoder().encode(JSON.stringify(f.policy)));
    expect(project(f).limits).toContainEqual({ label: 'Minimum health factor', value: '2 / 1' });
    expect(project(f).limits).toContainEqual({ label: 'Max loan-to-value', value: '75.00%' });
  });
});
describe('honest ERC-20 approval presentation', () => {
  it.each([['exact', 'Exactly 100 USDC'], ['bounded', 'Up to 100 USDC']] as const)('preserves %s approval truth', (kind, label) => {
    const f = reviewFixture(), asset = f.context.assets.USDC.asset;
    if (!('address' in asset)) throw Error('fixture');
    const approval = { token: asset.address, chain: asset.chainId, spender: reviewSpender, amount: '100000000', kind };
    expect(reviewApprovalValue(approval, [], f.context).value).toBe(label);
    f.authorization.approvals = [approval]; expect(project(f).permissions).toEqual(['Swap', 'Token approval']);
  });
  it('decodes exact and unlimited approval calls, including the actual inner approval in a delegated Safe call', () => {
    const f = reviewFixture(), asset = f.context.assets.USDC.asset;
    if (!('address' in asset)) throw Error('fixture');
    for (const units of [100000000n, (1n << 256n) - 1n]) {
      const data = toHex(encodeApprove(reviewSpender, units));
      const direct = reviewApprovalCall(asset.address, data, asset.chainId)!;
      const wrapped = reviewApprovalCall(reviewOwner, encodeSafeOwnerCall(reviewOwner, reviewOwner, asset.address, data), asset.chainId)!;
      expect(direct.amount).toBe(units.toString()); expect(wrapped).toEqual(direct);
      const value = reviewApprovalValue(direct, [], f.context);
      expect(value.value).toBe(units === 100000000n ? 'Exactly 100 USDC' : 'Unlimited approval');
      expect(value.unlimited).toBe(units !== 100000000n);
    }
    expect(reviewApprovalCall(asset.address, '0x095ea7b3', asset.chainId)).toBeNull();
  });
  it('never guesses decimals or substitutes a spend bound for an unknown approval asset', () => {
    const f = reviewFixture();
    const value = reviewApprovalValue({ token: reviewSpender, chain: 'eip155:9999', spender: reviewOwner, amount: '999000000', kind: 'exact' }, [], f.context);
    expect(value.value).toBe('Exactly 999000000 token units');
  });
});
