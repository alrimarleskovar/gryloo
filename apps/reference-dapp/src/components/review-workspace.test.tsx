// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReviewWorkspace, confirmReview, type ReviewWorkspaceProps } from './review-workspace';
import { reviewFixture, reviewNow, reviewOwner, reviewSpender } from '../test-utils/review-fixture';
import { classifyWalletEnvironment } from '../wallet/environment';
import { editorReducer, initialEditor } from '../domain/editor';
import { canvasAddCommand } from '../domain/canvas-authoring';
import { readFileSync } from 'node:fs';
const clicks = vi.hoisted(() => new Map<string, () => void>());
vi.mock('react/jsx-dev-runtime', async original => {
  const actual = await original<typeof import('react/jsx-dev-runtime')>();
  return { ...actual, jsxDEV: (...args: Parameters<typeof actual.jsxDEV>) => {
    const [type, values] = args;
    const props = values as { children?: unknown; onClick?: () => void };
    if (type === 'button' && typeof props.children === 'string' && props.onClick) clicks.set(props.children, props.onClick);
    return actual.jsxDEV(...args);
  } };
});
vi.mock('react/jsx-runtime', async original => {
  const actual = await original<typeof import('react/jsx-runtime')>();
  const capture = (...args: Parameters<typeof actual.jsx>) => {
    const [type, values] = args;
    const props = values as { children?: unknown; onClick?: () => void };
    if (type === 'button' && typeof props.children === 'string' && props.onClick) clicks.set(props.children, props.onClick);
    return actual.jsx(...args);
  };
  return { ...actual, jsx: capture, jsxs: capture };
});
beforeEach(() => { clicks.clear(); vi.useFakeTimers(); vi.setSystemTime(reviewNow); });
afterEach(() => { vi.useRealTimers(); });
const props = (): ReviewWorkspaceProps => ({ ...reviewFixture(), workflowName: 'My strategy', backToBuild: vi.fn() });
const render = (p = props()) => renderToStaticMarkup(createElement(ReviewWorkspace, p));
const primary = (html: string) => html.split('<details')[0]!;
describe('product Review workspace', () => {
  it('keeps authorization details without a competing approval when Canvas owns the action', () => {
    const p = { ...props(), actionSurface: 'canvas' as const };
    const html = primary(render(p));
    for (const section of ['Execution limits', 'Permissions', 'Wallet authorization', 'Authorization preview']) expect(html).toContain(`aria-label="${section}"`);
    expect(html).not.toContain('Approve &amp; Continue');
    expect(html).not.toContain('class="primary"');
    expect(html).toContain('No transaction is submitted');
  });
  it('presents workflow, limits, permissions, current wallet and a derived authorization preview before collapsed technical data', () => {
    const p = props(), html = render(p), main = primary(html);
    for (const section of ['Execution limits', 'Permissions', 'Wallet authorization', 'Authorization preview', 'Final confirmation']) expect(main).toContain(`aria-label="${section}"`);
    for (const value of ['My strategy', '100 USDC', 'USDC → WETH', 'Uniswap V3', 'Base Sepolia', 'Testnet', 'Ready to approve', 'Max slippage', '0.50%']) expect(main).toContain(value);
    expect(main).toContain('0x1111…1111'); expect(main).toContain(`title="${reviewOwner}"`);
    expect(main).not.toMatch(/<pre|schemaVersion|semanticWorkflow|manifestHash|canonical|runtime state|mock|synthetic|debug|N\/A|undefined|null/i);
    expect(main).not.toMatch(/<input|<select|delete|duplicate|toolbox|Advanced Settings/i);
    expect(html).toContain('<summary>View technical details</summary>');
    expect(html).not.toContain('<details open');
    expect(main).toContain('No transaction is submitted');
    expect(main).toContain('Manifest itself is not enforced by an on-chain contract');
    expect(main).not.toContain('Back to Simulate');
    expect(main).toContain('Approve &amp; Continue');
  });
  it('keeps composed actions in order and sends editing back to Build', () => {
    const p = props(); p.workflow = editorReducer(initialEditor(), canvasAddCommand('lending', 0, reviewOwner, '100'), p.context).workflow;
    const html = primary(render(p));
    expect(html.indexOf('Supply ·')).toBeLessThan(html.indexOf('Borrow ·'));
    expect(html.indexOf('Borrow ·')).toBeLessThan(html.indexOf('Swap ·'));
    expect(html).toContain('Edit in Build'); expect(html).toContain('Review required again');
  });
  it.each(['exact', 'bounded', 'unlimited'] as const)('shows %s token approval honestly with the original asset colors', kind => {
    const p = props(), asset = p.context.assets.USDC.asset; if (!('address' in asset)) throw Error('fixture');
    p.authorization.approvals.push({ token: asset.address, chain: asset.chainId, spender: reviewSpender, spenderName: 'Uniswap Router', amount: kind === 'unlimited' ? ((1n << 256n) - 1n).toString() : '100000000', kind: kind === 'bounded' ? 'bounded' : 'exact' });
    const html = primary(render(p));
    expect(html).toContain('aria-label="Token approvals"'); expect(html).toContain('Uniswap Router');
    expect(html).toContain(kind === 'unlimited' ? 'Unlimited approval' : kind === 'bounded' ? 'Up to 100 USDC' : 'Exactly 100 USDC');
    expect(html).toContain('/brand/crypto/usdc.png');
    if (kind === 'unlimited') { expect(html).toContain('no spending cap'); expect(html).not.toContain('Exactly 100 USDC'); }
  });
  it('reflects new wallet and network immediately and uses a neutral unknown environment', () => {
    const p = props(); p.wallet.account = reviewSpender; p.wallet.chain = 'eip155:42161'; p.wallet.environment = classifyWalletEnvironment(p.wallet.chain);
    let html = primary(render(p)); expect(html).toContain('0x2222…2222'); expect(html).toContain('Mainnet'); expect(html).toContain('Arbitrum'); expect(html).toContain('Review required again');
    p.wallet.chain = null; p.wallet.environment = classifyWalletEnvironment('0xdead');
    html = primary(render(p)); expect(html).toContain('Unknown network'); expect(html).not.toContain('Mainnet');
    expect(html).toMatch(/disabled="">Approve &amp; Continue/);
  });
  it('blocks an expired simulation even if Review was approved earlier and hides internal error codes', () => {
    const p = props(); p.authorization.accepted = true; vi.setSystemTime(reviewNow + 120_000);
    const html = primary(render(p)); expect(html).toContain('Simulation expired'); expect(html).toContain('Run Simulate again'); expect(html).toMatch(/disabled="">Approve &amp; Continue/);
    vi.setSystemTime(reviewNow); Object.assign(p.source.state, { error: 'SUPPLY_INSUFFICIENT_USDC' });
    const blocked = primary(render(p)); expect(blocked).toContain('Review blocked'); expect(blocked).not.toContain('SUPPLY_INSUFFICIENT');
  });
  it('approval calls only the real review handler and rechecks expiry at the click boundary', async () => {
    const p = props(), approve = vi.fn(), execute = vi.fn();
    p.authorization.approve = approve;
    Object.assign(p.source.state, { execute });
    await confirmReview(p); expect(approve).toHaveBeenCalledTimes(1); expect(execute).not.toHaveBeenCalled();
    await confirmReview(p, reviewNow + 120_000); expect(approve).toHaveBeenCalledTimes(1);
    p.wallet.changed = true; await confirmReview(p); expect(approve).toHaveBeenCalledTimes(1);
    p.wallet.changed = false; p.authorization.accepted = true; await confirmReview(p); expect(approve).toHaveBeenCalledTimes(1);
  });
  it('editing and refreshing stay explicit and approval does not navigate to Execute', () => {
    const p = props(), approve = vi.fn(); p.authorization.approve = approve;
    render(p);
    clicks.get('Edit in Build')!();
    expect(p.backToBuild).toHaveBeenCalledOnce();
    expect(approve).not.toHaveBeenCalled();
    clicks.get('Approve & Continue')!(); expect(approve).toHaveBeenCalledOnce();
  });
  it('locks Review before a valid simulation without displaying authorization details', () => {
    const p = props(); p.authorization.key = null; p.authorization.ready = false;
    const html = primary(render(p));
    expect(html).toContain('Run a valid simulation'); expect(html).toContain('review-locked');
    expect(html).not.toContain('Approve &amp; Continue');
    expect(html).not.toMatch(/Execution limits|Token approvals|You are authorizing/);
  });
  it('refreshes an expired simulation in-place using the existing simulator', () => {
    const p = props(); p.simulateAgain = vi.fn(); vi.setSystemTime(reviewNow + 120_000);
    const html = primary(render(p)); expect(html).toContain('Review unavailable until simulation is refreshed');
    clicks.get('Simulate again')!(); expect(p.simulateAgain).toHaveBeenCalledOnce(); expect(p.backToBuild).not.toHaveBeenCalled();
  });
  it('prepares authorization in product language while keeping approval disabled', () => {
    const p = props(); p.authorization.ready = false; Object.assign(p.source.state, { busy: 'Reviewing swap' });
    const html = primary(render(p)); expect(html).toContain('Preparing authorization…'); expect(html).toContain('simulation-tone-neutral');
    expect(html).toMatch(/disabled="">Approve &amp; Continue/); expect(html).not.toContain('Reviewing swap');
  });
  it('lets Simulate own the single technical disclosure without losing the product authorization', () => {
    const p = props(); p.showTechnicalDetails = false;
    const html = render(p); expect(html).not.toMatch(/<details|<pre|schemaVersion|semanticWorkflowHash/);
    expect(html).toContain('Ready to approve');
  });
  it('keeps Review theme styles on shared variables and leaves branded icons without theme filters', () => {
    const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8').split('/* UX-004C:')[1]!;
    expect(css).toContain('var(--ink)'); expect(css).toContain('var(--line)'); expect(css).toContain('var(--soft)');
    expect(css).not.toMatch(/filter\s*:|\.brand-icon[^}]*color|#[0-9a-f]{3,8}/i);
    const shell = readFileSync(new URL('./app-shell.tsx', import.meta.url), 'utf8');
    expect(shell).toContain('review={embeddedReview}');
    expect(shell).not.toContain("tab === 'Review'");
    expect(shell).toContain('<SimulateWorkspace'); expect(shell).toContain('<CanvasCardInputsProvider>');
  });
});
