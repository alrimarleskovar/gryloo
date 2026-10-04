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
  vi.clearAllMocks();
});

describe('product shell rendering', () => {
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

  it('retains draft identity and revision in every stage, without implying mock execution', () => {
    for (const stage of WORKFLOW_STAGES) {
      const html = renderToStaticMarkup(createElement(WorkspaceHeading, { stage, description: 'Stage description' }));
      expect(html).toContain('data-workflow-id="workflow-local" data-workflow-revision="0"');
      expect(html).toContain('Draft · Untitled workflow');
      expect(html).toContain('Mock example');
      expect(html).toContain(`Current stage · ${stage}`);
      expect(html).not.toMatch(/Authorized|Confirmed|Completed/);
    }
  });
});
