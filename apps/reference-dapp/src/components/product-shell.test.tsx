// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialWorkflow, freeze, type Workflow } from '../domain/initial-workflow';
import { createRouterNode } from '../domain/router-authoring';
import { TopBar } from './top-bar';
import { WorkspaceHeading } from './workspace-heading';
import { WORKFLOW_STAGES } from '../domain/product-shell';

const fixture = vi.hoisted(() => ({ workflow: null as unknown as Workflow }));
const wallet = vi.hoisted(() => ({ account: null as string | null, chainId: null as string | null,
  busy: false, providerError: null, error: null, connect: vi.fn(), switchTo: vi.fn(), reset: vi.fn() }));
vi.mock('../state/workflow-store', () => ({ useWorkflow: () => ({ state: { workflow: fixture.workflow } }) }));
vi.mock('../state/build009-wallet-store', async () => {
  const { walletChainLabel } = await import('../wallet/evm-networks');
  return { useBuild009Wallet: () => wallet, chainName: walletChainLabel,
    BASE_HEX: '0x2105', ARBITRUM_HEX: '0xa4b1', BASE_SEPOLIA_HEX: '0x14a34', ROBINHOOD_TESTNET_HEX: '0xb626' };
});
vi.mock('../state/mode-a-store', () => ({ useModeA: () => ({ info: null, wallet: null }) }));
vi.mock('../state/mode-b-store', () => ({ useModeB: () => ({ info: null, wallet: null }) }));
vi.mock('../state/lending-store', () => ({ useLending: () => ({ record: null, recovered: false, retired: false }) }));
vi.mock('../state/bridge-swap-store', () => ({ useBridgeSwap: () => ({ run: null, recovered: false }) }));
vi.mock('../state/router-store', () => ({ useRouter: () => ({ record: null, recovered: false, network: 'testnet' }) }));
vi.mock('../state/jupiter-store', () => ({ useJupiter: () => ({ record: null, recovered: false, owner: null, network: 'Solana' }) }));

beforeEach(() => {
  fixture.workflow = initialWorkflow();
  wallet.account = null; wallet.chainId = null;
  wallet.busy = false;
  vi.clearAllMocks();
});

describe('product shell rendering', () => {
  it.each([false, true])('boxes the wallet and keeps Settings inert when connected=%s', connected => {
    if (connected) { wallet.account = '0x1111111111111111111111111111111111111111'; wallet.chainId = '0x14a34'; }
    const html = renderToStaticMarkup(createElement(TopBar, { tab: 'Build', setTab: vi.fn() }));
    expect(html).toMatch(/class="header-wallet" role="group" aria-label="Wallet connection">[\s\S]*?<button[^>]*>[\s\S]*?<\/button><\/div><button type="button" class="header-settings"/);
    expect(html).toContain(connected ? 'Wallet: 0x1111…1111 · Base Sepolia' : 'Wallet not connected');
    expect(html).toContain(connected ? '>Disconnect</button>' : '>Connect Wallet</button>');
    expect(html).toMatch(/class="header-settings" aria-label="Settings" title="Settings" disabled=""><svg[\s\S]*?<\/svg><\/button>/);
    expect(html).not.toMatch(/role="dialog"|role="menu"|aria-haspopup/);
    expect(wallet.connect).not.toHaveBeenCalled();
    expect(wallet.reset).not.toHaveBeenCalled();
    expect(wallet.switchTo).not.toHaveBeenCalled();
  });

  it.each([false, true])('preserves busy disabling for boxed wallet actions when connected=%s', connected => {
    wallet.busy = true;
    if (connected) { wallet.account = '0x1111111111111111111111111111111111111111'; wallet.chainId = '0x14a34'; }
    const html = renderToStaticMarkup(createElement(TopBar, { tab: 'Build', setTab: vi.fn() }));
    expect(html).toMatch(new RegExp(`<button type="button" disabled=""[^>]*>${connected ? 'Disconnect' : 'Connect Wallet'}</button>`));
  });

  it.each(WORKFLOW_STAGES)('marks %s as the current view without performing wallet actions', stage => {
    const setTab = vi.fn();
    const html = renderToStaticMarkup(createElement(TopBar, { tab: stage, setTab }));
    expect(html).toContain('aria-label="Workflow stages"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`aria-current="page"[^>]*><span[^>]*aria-hidden="true"[^>]*>[123]</span>${stage}</button>`));
    expect(setTab).not.toHaveBeenCalled();
    expect(wallet.connect).not.toHaveBeenCalled();
    expect(wallet.switchTo).not.toHaveBeenCalled();
    expect(wallet.reset).not.toHaveBeenCalled();
  });

  it('shows the actual connected network and the canonical Journey network separately', () => {
    fixture.workflow = freeze({ ...initialWorkflow(), revision: 3, nodes: [createRouterNode('bridge', {
      source: 'Base Sepolia', destination: 'Arbitrum Sepolia', token: 'USDC', amount: '1', recipient: '', slippage: '50', routing: 'AUTO',
    })] });
    wallet.account = '0x1111111111111111111111111111111111111111'; wallet.chainId = '0x2105';
    const html = renderToStaticMarkup(createElement(TopBar, { tab: 'Simulate', setTab: vi.fn() }));
    expect(html).toContain('Wallet: 0x1111…1111 · Base (8453)');
    expect(html).toContain('Workflow network: Base Sepolia');
    expect(html).toContain('Switch to Base Sepolia');
    expect(wallet.switchTo).not.toHaveBeenCalled();
  });

  it('keeps Dashboard unnumbered and separate from the three lifecycle steps', () => {
    const html = renderToStaticMarkup(createElement(TopBar, { tab: 'Dashboard', setTab: vi.fn() }));
    expect(html).toMatch(/aria-current="page"[^>]*>Dashboard<\/button>/);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html.match(/class="stage-number"/g)).toHaveLength(3);
    for (const [index, stage] of WORKFLOW_STAGES.entries()) {
      expect(html).toContain(`>${index + 1}</span>${stage}</button>`);
    }
    expect(html).toContain('src="/brand/flofi-logo.png"');
    expect(html).toContain('alt="FloFi"');
    expect(html).not.toContain('Compose · Verify · Execute');
    expect(html).not.toContain('Workflow workspace');
    expect(wallet.connect).not.toHaveBeenCalled();
    expect(wallet.switchTo).not.toHaveBeenCalled();
    expect(wallet.reset).not.toHaveBeenCalled();
  });

  it('renders no Build heading, metadata or guidance block', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceHeading, { stage: 'Build', description: 'Add actions to the canvas.' }));
    expect(html).toBe('');
  });

  it('retains draft identity and revision in Simulate and Execute, without implying mock execution', () => {
    for (const stage of ['Simulate', 'Execute'] as const) {
      const html = renderToStaticMarkup(createElement(WorkspaceHeading, { stage, description: 'Stage description' }));
      expect(html).toContain('data-workflow-id="workflow-local" data-workflow-revision="0"');
      expect(html).toContain('Draft · Untitled workflow');
      expect(html).not.toMatch(/Mock example|Local mock|Mock action|Template/i);
      expect(html).toContain('0 actions');
      expect(html).toContain(`Current stage · ${stage}`);
      expect(html).not.toMatch(/Authorized|Confirmed|Completed/);
    }
  });
});
