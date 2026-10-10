// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialWorkflow, freeze, type Workflow } from '../domain/initial-workflow';
import { createRouterNode } from '../domain/router-authoring';
import { TopBar } from './top-bar';
import { HeaderSettings } from './header-settings';
import { NavigationDrawer } from './navigation-drawer';
import { WORKFLOW_STAGES } from '../domain/product-shell';

const fixture = vi.hoisted(() => ({ workflow: null as unknown as Workflow, diagnosticsAvailable: false }));
const wallet = vi.hoisted(() => ({ account: null as string | null, chainId: null as string | null,
  busy: false, providerError: null, error: null, connect: vi.fn(), switchTo: vi.fn(), reset: vi.fn() }));
vi.mock('../state/workflow-store', () => ({ useWorkflow: () => ({ state: { workflow: fixture.workflow } }) }));
vi.mock('./header-settings', async importOriginal => {
  const actual = await importOriginal<typeof import('./header-settings')>();
  return { HeaderSettings: vi.fn(actual.HeaderSettings) };
});
vi.mock('./navigation-drawer', async importOriginal => {
  const actual = await importOriginal<typeof import('./navigation-drawer')>();
  return { NavigationDrawer: vi.fn(actual.NavigationDrawer) };
});
vi.mock('../state/build009-wallet-store', async () => {
  const { walletChainLabel } = await import('../wallet/evm-networks');
  return { useBuild009Wallet: () => wallet, chainName: walletChainLabel,
    BASE_HEX: '0x2105', ARBITRUM_HEX: '0xa4b1', BASE_SEPOLIA_HEX: '0x14a34', ROBINHOOD_TESTNET_HEX: '0xb626' };
});
vi.mock('../state/mode-a-store', () => ({ useModeA: () => ({ info: fixture.diagnosticsAvailable ? { available: true, environment: 'MOCKED' } : null, wallet: null }) }));
vi.mock('../state/mode-b-store', () => ({ useModeB: () => ({ info: fixture.diagnosticsAvailable ? { available: true } : null, wallet: null }) }));
// The shared environment hook also reads these inactive execution providers.
vi.mock('../state/liquidity-store', () => ({ useLiquidity: () => ({}) }));
vi.mock('../state/composition-store', () => ({ useComposition: () => ({}) }));
vi.mock('../state/lending-store', () => ({ useLending: () => ({ record: null, recovered: false, retired: false }) }));
vi.mock('../state/bridge-swap-store', () => ({ useBridgeSwap: () => ({ run: null, recovered: false }) }));
vi.mock('../state/router-store', () => ({ useRouter: () => ({ record: null, recovered: false, network: 'testnet' }) }));
vi.mock('../state/jupiter-store', () => ({ useJupiter: () => ({ record: null, recovered: false, owner: null, network: 'Solana' }) }));
// Header → Connect Wallet goes through the canonical selector hook; rendering never opens it or touches a wallet.
vi.mock('../state/wallet-connection', () => ({ useWalletConnection: () => ({ connect: wallet.connect, error: null, solanaChain: 'solana:devnet' }) }));

beforeEach(() => {
  fixture.workflow = initialWorkflow();
  fixture.diagnosticsAvailable = false;
  wallet.account = null; wallet.chainId = null;
  wallet.busy = false;
  vi.clearAllMocks();
});

const stageMarkup = (html: string) => html.match(/<nav aria-label="Workflow stages" class="tabs">([\s\S]*?)<\/nav>/)?.[1] ?? '';

describe('product shell rendering', () => {
  it.each(['Build', 'Simulate', 'Execute'] as const)('keeps available fork diagnostics out of normal %s and preserves the engineering disclosure', tab => {
    fixture.diagnosticsAvailable = true;
    const normal = renderToStaticMarkup(createElement(TopBar, { tab, setTab: vi.fn() }));
    expect(normal).not.toMatch(/Technical connection details|Local fork|Chain 31337|Wallet permissions · local fork/);
    const engineering = renderToStaticMarkup(createElement(TopBar, { tab, setTab: vi.fn(), engineering: true }));
    expect(engineering).toContain('Technical connection details');
    expect(engineering).toContain('Chain 31337');
    expect(wallet.connect).not.toHaveBeenCalled();
    expect(wallet.switchTo).not.toHaveBeenCalled();
  });

  it('places the closed navigation trigger before the approved FloFi logo', () => {
    const html = renderToStaticMarkup(createElement(TopBar, { tab: 'Build', setTab: vi.fn() }));
    expect(html.indexOf('aria-label="Open navigation"')).toBeLessThan(html.indexOf('class="flofi-logo"'));
    expect(html).toContain('data-open="false" aria-hidden="true" inert=""');
    expect(wallet.connect).not.toHaveBeenCalled();
    expect(wallet.switchTo).not.toHaveBeenCalled();
  });

  it.each([
    { chain: '0x2105', connected: true, environment: 'mainnet', value: 'MAINNET', label: 'Mainnet' },
    { chain: '0x14a34', connected: true, environment: 'testnet', value: 'PUBLIC_TESTNET', label: 'Testnet' },
    { chain: '0x2105', connected: false, environment: 'unknown', value: '', label: 'Network' },
  ])('uses shared wallet environment $environment without changing the wallet', ({ chain, connected, environment, label }) => {
    wallet.account = connected ? '0x1111111111111111111111111111111111111111' : null;
    wallet.chainId = chain;
    const html = renderToStaticMarkup(createElement(TopBar, { tab: 'Dashboard', setTab: vi.fn() }));
    expect(html).toContain(`data-environment="${environment}"`);
    expect(html).toMatch(new RegExp(`role="combobox" aria-label="Environment"[^>]*><(?:span[^>]*></span><)?span>${label}</span>`));
    expect(html).toContain('aria-expanded="false"');
    expect(wallet.switchTo).not.toHaveBeenCalled();
    expect(wallet.connect).not.toHaveBeenCalled();
  });

  it.each([false, true])('boxes the wallet and renders Settings collapsed when connected=%s', connected => {
    if (connected) { wallet.account = '0x1111111111111111111111111111111111111111'; wallet.chainId = '0x14a34'; }
    const html = renderToStaticMarkup(createElement(TopBar, { tab: 'Build', setTab: vi.fn() }));
    expect(html).toMatch(/class="header-wallet" role="group" aria-label="Wallet connection">[\s\S]*?<\/div><div class="header-settings-control"><button type="button" class="header-settings"/);
    expect(html.replace(/<[^>]*>/g, '')).toContain(connected ? 'EVM Default: 0x1111…1111 · Base Sepolia' : 'Wallet not connected');
    if (connected) expect(html).toContain('<span class="numeric wallet-address">0x1111…1111</span>');
    if (connected) expect(html).not.toContain('header-wallet-provider');
    expect(html).not.toContain('>Disconnect</button>');
    if (!connected) expect(html).toContain('>Connect Wallet</button>');
    expect(vi.mocked(HeaderSettings).mock.calls.at(-1)?.[0]).toMatchObject({ onDisconnect: wallet.reset, disconnectDisabled: !connected });
    expect(vi.mocked(NavigationDrawer).mock.calls.at(-1)?.[0]).toMatchObject({ onDisconnect: wallet.reset, disconnectDisabled: !connected });
    expect(html).toMatch(/class="header-settings" aria-label="Settings" title="Settings" aria-expanded="false"><svg[\s\S]*?<\/svg><\/button>/);
    expect(html).not.toMatch(/role="dialog"|role="menu"/);
    expect(html).toContain('aria-haspopup="listbox"');
    expect(wallet.connect).not.toHaveBeenCalled();
    expect(wallet.reset).not.toHaveBeenCalled();
    expect(wallet.switchTo).not.toHaveBeenCalled();
  });

  it.each([false, true])('preserves busy disabling for wallet actions when connected=%s', connected => {
    wallet.busy = true;
    if (connected) { wallet.account = '0x1111111111111111111111111111111111111111'; wallet.chainId = '0x14a34'; }
    const html = renderToStaticMarkup(createElement(TopBar, { tab: 'Build', setTab: vi.fn() }));
    if (!connected) expect(html).toMatch(/<button type="button" disabled=""[^>]*>Connect Wallet<\/button>/);
    expect(vi.mocked(HeaderSettings).mock.calls.at(-1)?.[0]).toMatchObject({ onDisconnect: wallet.reset, disconnectDisabled: true });
    expect(vi.mocked(NavigationDrawer).mock.calls.at(-1)?.[0]).toMatchObject({ onDisconnect: wallet.reset, disconnectDisabled: true });
  });

  it.each(WORKFLOW_STAGES)('marks %s as the current view without performing wallet actions', stage => {
    const setTab = vi.fn();
    const html = renderToStaticMarkup(createElement(TopBar, { tab: stage, setTab }));
    expect(html).toContain('aria-label="Workflow stages"');
    expect(stageMarkup(html).match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`aria-current="page"[^>]*><span[^>]*aria-hidden="true"[^>]*>[123]</span>${stage}</button>`));
    expect(html).not.toMatch(/Draft · Untitled workflow|Current stage ·|workspace-title|stage-guidance/);
    expect(setTab).not.toHaveBeenCalled();
    expect(wallet.connect).not.toHaveBeenCalled();
    expect(wallet.switchTo).not.toHaveBeenCalled();
    expect(wallet.reset).not.toHaveBeenCalled();
  });

  it('names the connected provider beside the address without changing the address text', () => {
    wallet.account = '0x1111111111111111111111111111111111111111'; wallet.chainId = '0x14a34';
    Object.assign(wallet, { provider: { key: 'io.rabby', name: 'Rabby Wallet', icon: 'data:image/svg+xml;base64,PHN2Zy8+' } });
    const html = renderToStaticMarkup(createElement(TopBar, { tab: 'Build', setTab: vi.fn() }));
    expect(html).toContain('<span class="header-wallet-provider" title="Rabby Wallet">');
    expect(html).toContain('<span class="sr-only">Rabby Wallet</span>');
    expect(html).toMatch(/class="build009-wallet-info wallet-connection"[^>]*>EVM Default: <span class="numeric wallet-address">0x1111…1111<\/span> · Base Sepolia<\/span>/);
    expect(wallet.connect).not.toHaveBeenCalled();
    Object.assign(wallet, { provider: undefined });
  });

  it('shows the actual connected network and the canonical Journey network separately', () => {
    fixture.workflow = freeze({ ...initialWorkflow(), revision: 3, nodes: [createRouterNode('bridge', {
      source: 'Base Sepolia', destination: 'Arbitrum Sepolia', token: 'USDC', amount: '1', recipient: '', slippage: '50', routing: 'AUTO',
    })] });
    wallet.account = '0x1111111111111111111111111111111111111111'; wallet.chainId = '0x2105';
    const html = renderToStaticMarkup(createElement(TopBar, { tab: 'Simulate', setTab: vi.fn() }));
    expect(html.replace(/<[^>]*>/g, '')).toContain('EVM Default: 0x1111…1111 · Base (8453)');
    expect(html).toContain('Workflow network: Base Sepolia');
    expect(html).toContain('Switch to Base Sepolia');
    expect(wallet.switchTo).not.toHaveBeenCalled();
  });

  it('keeps Dashboard unnumbered and separate from the three lifecycle steps', () => {
    const html = renderToStaticMarkup(createElement(TopBar, { tab: 'Dashboard', setTab: vi.fn() }));
    expect(html).toMatch(/aria-current="page"[^>]*>Dashboard<\/button>/);
    expect(stageMarkup(html).match(/aria-current="page"/g)).toHaveLength(1);
    expect(html.match(/class="stage-number"/g)).toHaveLength(3);
    for (const [index, stage] of WORKFLOW_STAGES.entries()) {
      expect(html).toContain(`>${index + 1}</span>${stage}</button>`);
    }
    expect(html).toContain('class="flofi-logo" role="img" aria-label="FloFi"');
    expect(html).toContain('src="/brand/flofi-symbol-light.svg"');
    expect(html).toContain('src="/brand/flofi-symbol-dark.svg"');
    expect(html).not.toContain('/brand/flofi-logo.png');
    expect(html).not.toContain('Compose · Verify · Execute');
    expect(html).not.toContain('Workflow workspace');
    expect(wallet.connect).not.toHaveBeenCalled();
    expect(wallet.switchTo).not.toHaveBeenCalled();
    expect(wallet.reset).not.toHaveBeenCalled();
  });

  it('uses the existing Build lifecycle transition from the drawer without wallet activity', () => {
    const setTab = vi.fn();
    renderToStaticMarkup(createElement(TopBar, { tab: 'Execute', pathname: '/', setTab }));
    const props = vi.mocked(NavigationDrawer).mock.calls.at(-1)![0];
    expect(props.section).toBe('Execute');
    props.onBuild();
    expect(setTab).toHaveBeenCalledExactlyOnceWith('Build');
    expect(wallet.reset).not.toHaveBeenCalled();
    expect(wallet.connect).not.toHaveBeenCalled();
  });

});
