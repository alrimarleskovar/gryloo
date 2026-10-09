// SPDX-License-Identifier: AGPL-3.0-only
import Image from 'next/image';
import { CryptoMark } from './crypto-visuals';
import type { LandingCopy } from './landing-copy';
import styles from './landing.module.css';

// Ecosystem identities from the existing wallet catalog and capability registry.
// These cards do not grant execution capability or assert deployment readiness.
const networks = [
  { name: 'Ethereum', mark: 'ETH' },
  { name: 'Base', mark: 'Base' },
  { name: 'Arbitrum', mark: 'Arbitrum' },
  { name: 'Solana', mark: 'SOL' },
  { name: 'Robinhood Chain', mark: null },
] as const;

export function SupportedNetworks({ t }: { t: LandingCopy }) {
  return <section className={styles.networksSection} id="networks" aria-labelledby="networks-title">
    <div className={styles.container}>
      <div className={styles.scenariosHeading}><div><p className={styles.kicker}>{t.networksEyebrow}</p><h2 id="networks-title">{t.networksTitle}</h2></div><p>{t.networksBody}</p></div>
      <ul className={styles.networksGrid}>{networks.map(network => <li key={network.name}>
        {network.mark ? <CryptoMark name={network.mark}/> : <span className={styles.cryptoMark}><Image src="/brand/robinhood-avatar.jpg" alt="" width={24} height={24}/></span>}
        <strong>{network.name}</strong>
      </li>)}<li className={styles.tempoNetwork}><span className={styles.tempoMonogram} aria-hidden="true">T</span><div><strong>Tempo</strong><span>{t.tempoStatus}</span></div></li></ul>
      <p className={styles.scenariosNote}>{t.networksNote}</p>
    </div>
  </section>;
}
