// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useState, type ReactNode } from 'react';
import type { SecondaryWorkspace } from '../domain/secondary-workspaces';
import { chainName, useBuild009Wallet } from '../state/build009-wallet-store';
import { useJupiter } from '../state/jupiter-store';
import { AutomationWorkspace } from './automation-workspace';

type IconName = 'wallet' | 'agent' | 'key' | 'plus' | 'copy' | 'card' | 'secret';
function WorkspaceIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'wallet' ? <><path d="M20 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-3M3 6h15a2 2 0 0 1 2 2"/><path d="M16 9h5v7h-5a3.5 3.5 0 0 1 0-7Z"/><path d="M16 12.5h.01"/></>
      : name === 'agent' ? <><rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 3v4M2 12h2m16 0h2M9 16h6M9 11v1m6-1v1"/></>
        : name === 'key' ? <><circle cx="8" cy="9" r="4"/><path d="m11 12 9 9m-3-3 3-3m-6 0 3-3"/></>
          : name === 'plus' ? <path d="M12 5v14M5 12h14"/>
            : name === 'copy' ? <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/></>
              : name === 'card' ? <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h3"/></>
                : <><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2"/></>}
  </svg>;
}

function FutureAction({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <button type="button" className={`workspace-action ${className}`} disabled title="Coming soon">{children}</button>;
}

function AddAction({ children }: { children: ReactNode }) {
  return <FutureAction><WorkspaceIcon name="plus" size={16}/>{children}</FutureAction>;
}

type PublicWallet = { address: string; name: string; ecosystem: 'EVM' | 'Solana'; network: string; icon: string | undefined };
const evmNetworkIcons: Record<string, string> = {
  '0x2105': '/brand/crypto/base.svg', '0x14a34': '/brand/crypto/base.svg',
  '0xa4b1': '/brand/crypto/arbitrum.png', '0x1': '/brand/crypto/ethereum.svg',
};

function WalletCard({ wallet }: { wallet: PublicWallet }) {
  const [copyStatus, setCopyStatus] = useState('');
  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopyStatus('Address copied.');
    } catch { setCopyStatus('Address could not be copied.'); }
  }
  return <article className="workspace-wallet-card" aria-label={`${wallet.name} on ${wallet.network}`}>
    <div className="workspace-wallet-heading">
      <span className="workspace-network-icon">{wallet.icon ? <img src={wallet.icon} width="28" height="28" alt=""/> : <WorkspaceIcon name="wallet" size={26}/>}</span>
      <div><h3>{wallet.name}</h3><p>{wallet.ecosystem} · External wallet</p></div>
    </div>
    <p className="workspace-wallet-network">{wallet.network}</p>
    <div className="workspace-wallet-address"><code title={wallet.address}>{wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}</code>
      <button type="button" className="workspace-copy" aria-label={`Copy ${wallet.name} address`} title="Copy address" onClick={() => void copyAddress()}><WorkspaceIcon name="copy" size={17}/></button>
    </div>
    <p className="sr-only" role="status">{copyStatus}</p>
    <div className="workspace-wallet-actions"><FutureAction>Add funds</FutureAction><FutureAction>Reveal key</FutureAction><FutureAction>Delete</FutureAction></div>
  </article>;
}

function CredentialsWorkspace() {
  const evm = useBuild009Wallet();
  const { session } = useJupiter();
  // Project only current public sessions. There is no credential store or example wallet data.
  const wallets: PublicWallet[] = [];
  if (evm.account) wallets.push({ address: evm.account, name: 'Connected wallet', ecosystem: 'EVM', network: chainName(evm.chainId), icon: evm.chainId ? evmNetworkIcons[evm.chainId] : undefined });
  if (session) wallets.push({ address: session.account.address, name: session.wallet.name, ecosystem: 'Solana', network: session.chain === 'solana:devnet' ? 'Solana Devnet' : 'Solana', icon: '/brand/crypto/solana.svg' });
  return <>
    <header className="secondary-workspace-heading"><h1>Credentials</h1><p>Keep your connected wallets, credentials, and secrets in one place.</p></header>
    <section className="workspace-section" aria-labelledby="credentials-wallets">
      <div className="workspace-section-heading"><div><WorkspaceIcon name="wallet"/><h2 id="credentials-wallets">Wallets</h2><span className="workspace-count">{wallets.length}</span></div><AddAction>Add wallet</AddAction></div>
      {wallets.length ? <div className="workspace-wallet-grid">{wallets.map(wallet => <WalletCard key={`${wallet.ecosystem}:${wallet.address}`} wallet={wallet}/>)}</div>
        : <div className="workspace-empty"><span className="workspace-empty-icon"><WorkspaceIcon name="wallet" size={28}/></span><h3>No connected wallets</h3><p>Connect a wallet from the header to see it here.</p></div>}
    </section>
    <div className="workspace-secondary-actions"><FutureAction><WorkspaceIcon name="plus" size={16}/><WorkspaceIcon name="card" size={18}/>Add card</FutureAction><FutureAction><WorkspaceIcon name="plus" size={16}/><WorkspaceIcon name="secret" size={18}/>Add secret</FutureAction></div>
  </>;
}

function AgentsWorkspace() {
  return <>
    <header className="secondary-workspace-heading"><h1>Agents</h1><p>Connect AI agents and integrations to FloFi with explicit permissions and your authorization.</p></header>
    <section className="workspace-connect-panel" aria-labelledby="connect-agent"><h2 id="connect-agent">CONNECT AN AGENT</h2>
      <div className="workspace-provider-list">{[
        { name: 'Claude', light: '/brand/providers/claude-spark.svg', dark: null },
        { name: 'ChatGPT', light: '/brand/providers/openai-blossom-black.svg', dark: '/brand/providers/openai-blossom-white.svg' },
      ].map(provider => <FutureAction key={provider.name} className="workspace-provider"><span className="workspace-provider-mark" aria-hidden="true">
        <img src={provider.light} className={provider.dark ? 'provider-mark-light' : undefined} width={provider.dark ? 56 : 28} height={provider.dark ? 56 : 28} alt=""/>
        {provider.dark && <img src={provider.dark} className="provider-mark-dark" width="56" height="56" alt=""/>}
      </span><span>Connect with {provider.name}</span><span className="workspace-provider-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h16m-5-5 5 5-5 5"/></svg></span></FutureAction>)}</div>
    </section>
    <section className="workspace-section" aria-labelledby="agent-clients"><div className="workspace-section-heading"><div><WorkspaceIcon name="agent"/><h2 id="agent-clients">Agents</h2><span className="workspace-count">0 active</span></div><AddAction>Create client</AddAction></div>
      <div className="workspace-empty"><span className="workspace-empty-icon"><WorkspaceIcon name="agent" size={28}/></span><h3>No agent clients yet.</h3><AddAction>Create client</AddAction></div>
    </section>
  </>;
}

function PasskeysWorkspace() {
  return <>
    <header className="secondary-workspace-heading"><h1>Passkeys</h1><p>Manage device passkeys associated with your FloFi account or session.</p></header>
    <section className="workspace-passkey-control" aria-labelledby="passkey-unlock"><button type="button" role="switch" className="workspace-passkey-switch" aria-checked="false" aria-labelledby="passkey-unlock" aria-describedby="passkey-help" disabled title="Coming soon"><span/></button>
      <div><h2 id="passkey-unlock">Unlock with a passkey</h2><p id="passkey-help">Turn on to add a passkey.</p></div>
    </section>
    <section className="workspace-empty workspace-passkey-empty" aria-label="Passkeys"><span className="workspace-empty-icon"><WorkspaceIcon name="key" size={28}/></span><p>No passkeys yet. Add one to get started.</p></section>
  </>;
}

export function SecondaryProductWorkspace({ workspace }: { workspace: SecondaryWorkspace['id'] }) {
  return workspace === 'automations' ? <AutomationWorkspace/> : workspace === 'credentials' ? <CredentialsWorkspace/> : workspace === 'agents' ? <AgentsWorkspace/> : <PasskeysWorkspace/>;
}
