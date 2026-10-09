// SPDX-License-Identifier: AGPL-3.0-only
import Image from 'next/image';
import styles from './landing.module.css';
import type { LandingCopy } from './landing-copy';

const marks = {
  BTC: '/brand/crypto/bitcoin.svg', WBTC: '/brand/crypto/wbtc.png',
  ETH: '/brand/crypto/ethereum.svg', USDC: '/brand/crypto/usdc.png',
  SOL: '/brand/crypto/solana.svg', Base: '/brand/crypto/base.svg',
  Arbitrum: '/brand/crypto/arbitrum.png',
} as const;
export type CryptoName = keyof typeof marks;

/** Presentation only. Source colors and proportions stay intact inside one shared icon frame. */
export function CryptoMark({ name }: { name: CryptoName }) {
  return <span className={styles.cryptoMark} data-crypto={name}>
    <Image src={marks[name]} alt="" width={24} height={24} draggable={false}/>
  </span>;
}

export function CryptoFlow({ assets }: { assets: readonly CryptoName[] }) {
  return <div className={styles.cryptoFlow}>{assets.map((name, index) => <span key={`${name}-${index}`}>
    {index > 0 && <span className={styles.flowArrow} aria-hidden="true">→</span>}
    <CryptoMark name={name}/><strong>{name}</strong>
  </span>)}</div>;
}

export function CryptoScenarios({ t }: { t: LandingCopy }) {
  const scenarios = [
    { title: t.scenarioSwap, body: t.scenarioSwapBody, assets: ['ETH', 'USDC'], context: 'Ethereum · Uniswap', future: false },
    { title: t.scenarioBridge, body: t.scenarioBridgeBody, assets: ['Base', 'Arbitrum'], context: 'USDC · Across / LI.FI', future: false },
    { title: t.scenarioLending, body: t.scenarioLendingBody, assets: ['ETH', 'USDC'], context: 'Ethereum · Aave', future: false },
    { title: t.scenarioBitcoin, body: t.scenarioBitcoinBody, assets: ['USDC', 'BTC'], context: t.scenarioBitcoinContext, future: true },
    { title: t.scenarioMultichain, body: t.scenarioMultichainBody, assets: ['SOL', 'USDC', 'ETH'], context: 'Solana · Base · Ethereum', future: true },
  ] as const;
  return <section className={styles.scenariosSection} id="scenarios" aria-labelledby="scenarios-title">
    <div className={styles.container}>
      <div className={styles.scenariosHeading}><div><p className={styles.kicker}>{t.scenariosEyebrow}</p><h2 id="scenarios-title">{t.scenariosTitle}</h2></div><p>{t.scenariosBody}</p></div>
      <div className={styles.scenariosGrid}>{scenarios.map(scenario => <article key={scenario.title} className={styles.scenarioCard}>
        <span className={styles.scenarioQualifier}>{scenario.future ? t.futureScenario : t.illustrativeScenario}</span>
        <CryptoFlow assets={scenario.assets}/><h3>{scenario.title}</h3><p>{scenario.body}</p><small>{scenario.context}</small>
      </article>)}</div>
      <p className={styles.scenariosNote}>{t.scenariosNote}</p>
    </div>
  </section>;
}
