// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import Image from 'next/image';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import styles from './landing.module.css';
import { LandingMotion } from './landing-motion';
import { WorkflowStory } from './workflow-story';
import { CryptoFlow, CryptoMark, CryptoScenarios } from './crypto-visuals';
import { SupportedNetworks } from './supported-networks';
import { landingText, type LandingCopy, type LandingLocale } from './landing-copy';


function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={styles.arrow}>
    {diagonal ? <path d="M5 15 15 5M6 5h9v9" /> : <path d="M3 10h13m-5-5 5 5-5 5" />}
  </svg>;
}

function Brand({ light = false }: { light?: boolean }) {
  return <span className={light ? styles.brandLight : styles.brand}>
    <Image src={`/brand/flofi-symbol-${light ? 'dark' : 'light'}.svg`} alt="" width={370} height={345} unoptimized />
    <Image className={styles.wordmark} src={`/brand/flofi-wordmark-${light ? 'dark' : 'light'}.png`} alt="FloFi" width={738} height={280} unoptimized />
  </span>;
}

function SectionKicker({ children }: { children: ReactNode }) {
  return <p className={styles.kicker}>{children}</p>;
}

function StageTrack({ active, t }: { active: 'Intent' | 'Strategy' | 'Review' | 'Execute' | 'Verify'; t: LandingCopy }) {
  const stages = ['Intent', 'Strategy', 'Review', 'Execute', 'Verify'] as const;
  const labels = [t.stageIntent, t.stageStrategy, t.stageReview, t.stageExecute, t.stageVerify];
  const activeIndex = stages.indexOf(active);
  return <ol className={styles.stageTrack} aria-label={t.productIllustration}>
    {stages.map((stage, index) => <li key={stage} className={index === activeIndex ? styles.stageActive : index < activeIndex ? styles.stageComplete : ''}>
      <span className={styles.stageDot}>{index < activeIndex ? '✓' : index + 1}</span><span>{labels[index]}</span>
    </li>)}
  </ol>;
}

function ProductChrome({ active, t }: { active: 'Build' | 'Simulate'; t: LandingCopy }) {
  return <div className={styles.productChrome}><Brand /><div className={styles.productTabs}><span className={active === 'Build' ? styles.productTabActive : ''}>{t.tabBuild}</span><span className={active === 'Simulate' ? styles.productTabActive : ''}>{t.tabSimulate}</span><span>{t.tabExecute}</span></div><span className={styles.productQualifier}>{t.productIllustration}</span></div>;
}

function HeroPreview({ t }: { t: LandingCopy }) {
  return <div className={styles.heroPreview} data-landing-depth aria-label={t.productIllustration}>
    <ProductChrome active="Build" t={t} />
    <div className={styles.heroPreviewMain}>
      <div className={styles.heroCanvas}><div className={styles.heroCanvasHeading}><span className={styles.previewEyebrow}>{t.workflowLabel} · {t.illustrativeScenario}</span><strong>{t.workflowUntitled}</strong><small>{t.workflowHint}</small></div><div className={styles.heroCanvasSurface}><div className={styles.heroWorkflow}>
        <div className={styles.heroExampleCard}><CryptoFlow assets={['ETH', 'USDC']}/><strong>{t.showcaseSwap}</strong><small>Uniswap · Base</small><span>{t.quotePending}</span></div>
        <span className={styles.heroFlowConnector} aria-hidden="true">→</span>
        <div className={styles.heroExampleCard}><CryptoFlow assets={['Base', 'Arbitrum']}/><strong>{t.showcaseBridge}</strong><small>Base → Arbitrum</small><span>{t.quotePending}</span></div>
      </div></div></div>
      <div className={styles.heroAssistant}><div className={styles.heroAssistantHeading}><span>{t.assistantLabel}</span><strong>{t.copilot}</strong></div><div className={styles.heroPreviewContent}>
        <span className={styles.previewEyebrow}>{t.startIntent}</span><h2>{t.whatDo}</h2>
        <div className={styles.promptDisplay}>{t.sampleIntent} <span aria-hidden="true">↗</span></div>
        <div className={styles.heroAssetRow}><CryptoFlow assets={['ETH', 'USDC']}/><small>Base → Arbitrum · {t.illustrativeScenario}</small></div>
        <div className={styles.previewProcess}><div className={styles.previewProcessHead}><span className={styles.pulse} /> {t.exploring}</div><StageTrack active="Intent" t={t} /></div>
      </div>
      </div>
    </div>
  </div>;
}

function ReviewPreview({ t }: { t: LandingCopy }) {
  return <div className={styles.reviewPreview} data-landing-depth aria-label={t.productIllustration}>
    <ProductChrome active="Simulate" t={t} />
    <div className={styles.reviewProgress}><span>✓ {t.stageIntent}</span><span>✓ {t.stageStrategy}</span><strong>● {t.stageReview}</strong><span>○ {t.reviewAuthorizeStage}</span><span>○ {t.stageVerify}</span></div>
    <h3>{t.reviewTitle}</h3>
    <p>{t.reviewSubtitle}</p>
    <div className={styles.reviewCard}>
      <div className={styles.reviewCardTitle}><span className={styles.tokenPair}><CryptoMark name="ETH"/><CryptoMark name="USDC"/></span><div><strong>{t.reviewSwap}</strong><small>Uniswap · Ethereum · {t.illustrativeScenario}</small></div><span className={styles.reviewProtocol}>Uniswap</span></div>
      <div className={styles.reviewAllocation}><span>{t.intentAmount}</span><strong>{t.intentAmountValue}</strong><small>{t.finalAmountHint}</small></div>
      <div className={styles.reviewFacts}>
        <div><span>{t.networkCost}</span><strong>{t.freshEstimate}</strong></div>
        <div><span>{t.priceRange}</span><strong>{t.setAtReview}</strong></div>
        <div><span>{t.maximumSlippage}</span><strong>{t.boundedAtReview}</strong></div>
        <div><span>{t.assetsInvolved}</span><strong>{t.reviewAssets}</strong></div>
      </div>
      <div className={styles.rangeExample} aria-label={t.positionRange}><span>{t.positionRange}</span><CryptoFlow assets={['ETH', 'USDC']}/><small>{t.lowerBound} <b>{t.currentPrice}</b> {t.upperBound}</small></div>
      <div className={styles.reviewRisks}><strong>{t.whatCanChange}</strong><ul><li>{t.riskRange}</li><li>{t.riskFees}</li><li>{t.riskConditions}</li></ul></div>
      <div className={styles.reviewNotice}><span aria-hidden="true">◈</span><span>{t.reviewNotice}</span></div>
      <div className={styles.reviewAuthorization}><span>{t.authorizingScope}<small>{t.walletInBuilder}</small></span><button type="button" disabled>{t.authorizeWorkflow} <Arrow /></button></div>
    </div>
  </div>;
}

function SourceIcon({ source }: { source: 'wallet' | 'app' | 'agent' }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
    {source === 'wallet' && <><path d="M19 8V5.5A1.5 1.5 0 0 0 17.5 4h-12A2.5 2.5 0 0 0 3 6.5V18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2H5.5A1.5 1.5 0 0 1 4 6.5"/><path d="M21 12h-5a2 2 0 0 0 0 4h5"/><circle cx="16.5" cy="14" r=".8" fill="currentColor" stroke="none"/></>}
    {source === 'app' && <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01M8 13h3v3H8zM15 13h1M15 16h1"/></>}
    {source === 'agent' && <><path d="m12 4 2.2 5.8L20 12l-5.8 2.2L12 20l-2.2-5.8L4 12l5.8-2.2L12 4Z"/><path d="M20 3v4M18 5h4M4 17v4M2 19h4"/></>}
  </svg>;
}

function FlowDiagram({ t }: { t: LandingCopy }) {
  const sources = [{ source: 'wallet', label: t.diagramWallet }, { source: 'app', label: t.diagramApp }, { source: 'agent', label: t.diagramAgent }] as const;
  return <div className={styles.diagram} role="group" aria-label={t.executionInfrastructure} data-flow-diagram>
    <div className={styles.diagramInputs}>
      {sources.map(({ source, label }) => <div className={styles.diagramSource} data-flow-source={source} key={source}>
        <span className={styles.diagramSourceIcon}><SourceIcon source={source}/></span>
        <span>{label}</span><span className={styles.diagramSourceLine} aria-hidden="true"/>
        <span className={`${styles.diagramPort} ${styles.diagramSourcePort}`} data-flow-port aria-hidden="true"/>
      </div>)}
    </div>
    <div className={`${styles.diagramConnector} ${styles.diagramMerge}`} aria-hidden="true">
      <svg className={styles.diagramHorizontal} viewBox="0 0 96 264" preserveAspectRatio="none">
        <path d="M0 36 C40 36 24 132 64 132"/><path d="M0 132 H64"/><path d="M0 228 C40 228 24 132 64 132"/><path d="M64 132 H96"/>
      </svg>
      <svg className={styles.diagramVertical} viewBox="0 0 300 80" preserveAspectRatio="none">
        <path d="M50 0 V12 C50 40 150 24 150 52"/><path d="M150 0 V52"/><path d="M250 0 V12 C250 40 150 24 150 52"/><path d="M150 52 V80"/>
      </svg>
      <span className={styles.diagramJunction} data-flow-junction/><span className={styles.diagramArrow}/>
    </div>
    <div className={styles.diagramCore} data-flow-core>
      <span className={`${styles.diagramPort} ${styles.diagramCoreInput}`} data-flow-port="input" aria-hidden="true"/>
      <Brand /><span className={styles.diagramCoreLabel}>{t.executionInfrastructure}</span>
      <div><span>{t.stageStrategy}</span><span>{t.stageReview}</span><span>{t.diagramAuthorization}</span><span>{t.diagramVerification}</span></div>
      <span className={`${styles.diagramPort} ${styles.diagramCoreOutput}`} data-flow-port="output" aria-hidden="true"/>
    </div>
    <div className={`${styles.diagramConnector} ${styles.diagramBranch}`} aria-hidden="true">
      <svg className={styles.diagramHorizontal} viewBox="0 0 96 264" preserveAspectRatio="none">
        <path d="M0 132 H32"/><path d="M32 132 C56 132 56 84 80 84 H96"/><path d="M32 132 C56 132 56 180 80 180 H96"/>
      </svg>
      <svg className={styles.diagramVertical} viewBox="0 0 300 64" preserveAspectRatio="none">
        <path d="M150 0 V20"/><path d="M150 20 C150 40 75 40 75 48 V64"/><path d="M150 20 C150 40 225 40 225 48 V64"/>
      </svg>
      <span className={styles.diagramJunction} data-flow-junction/><span className={styles.diagramArrow}/><span className={styles.diagramArrow}/>
    </div>
    <div className={styles.diagramOutputs}>
      <p className={styles.diagramOutputLabel}>{t.diagramProtocols}</p>
      <div className={styles.diagramDestination} data-flow-destination="orca"><span className={`${styles.diagramPort} ${styles.diagramDestinationPort}`} data-flow-port aria-hidden="true"/><CryptoMark name="SOL"/><span><strong>Orca · Solana</strong><small>{t.illustrativeScenario}</small></span></div>
      <div className={styles.diagramDestination} data-flow-destination="aave"><span className={`${styles.diagramPort} ${styles.diagramDestinationPort}`} data-flow-port aria-hidden="true"/><CryptoMark name="ETH"/><span><strong>Aave · Ethereum</strong><small>{t.illustrativeScenario}</small></span></div>
      <p className={styles.diagramMore}>{t.more} <small>{t.ecosystemDirection}</small></p>
    </div>
  </div>;
}

function VisionVisual({ t }: { t: LandingCopy }) {
  return <div className={styles.visionVisual} aria-label={t.visionEyebrow}>
    <div className={styles.visionSources}><span>{t.diagramAgent}</span><span>{t.diagramWallet}</span><span>{t.diagramApp}</span></div>
    <svg aria-hidden="true" viewBox="0 0 90 220" preserveAspectRatio="none"><path d="M0 30 C55 30 35 110 90 110 M0 110 C50 110 40 110 90 110 M0 190 C55 190 35 110 90 110" /></svg>
    <div className={styles.visionCore}><Image src="/brand/flofi-symbol-dark.svg" alt="" width={55} height={55} /><strong>FloFi</strong><small>{t.executionLayer}</small></div>
    <svg aria-hidden="true" viewBox="0 0 65 220" preserveAspectRatio="none"><path d="M0 110 C30 110 35 110 65 110" /></svg>
    <span className={styles.visionDestination}>{t.onchainFinance}</span>
  </div>;
}

export default function LandingPage() {
  const [locale, setLocale] = useState<LandingLocale>('en');
  const t = landingText[locale];

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('flofi-landing-language');
      if (saved === 'pt' || saved === 'en') setLocale(saved);
    } catch { /* The language selector still works without storage. */ }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === 'pt' ? 'pt-BR' : 'en';
    document.title = t.pageTitle;
    document.querySelector('meta[name="description"]')?.setAttribute('content', t.pageDescription);
  }, [locale, t]);

  const changeLocale = (next: LandingLocale) => {
    setLocale(next);
    try { window.localStorage.setItem('flofi-landing-language', next); } catch { /* Optional preference. */ }
  };

  return <div className={styles.root} lang={locale === 'pt' ? 'pt-BR' : 'en'}>
    <LandingMotion />
    <a className={styles.skipLink} href="#main">{t.skip}</a>
    <header className={styles.siteHeader}><div className={styles.headerInner}>
      <a href="/" className={styles.brandLink} aria-label={t.brandHome}><Brand /></a>
      <nav aria-label={t.mainNavigation}><a href="#product">{t.navProduct}</a><a href="#networks">{t.navNetworks}</a><a href="#developers">{t.navDevelopers}</a><a href="https://github.com/alrimarleskovar/gryloo/tree/main/docs/developer">{t.navDocs}</a></nav>
      <div className={styles.headerActions}><div className={styles.languageSwitch} role="group" aria-label={t.language}><button type="button" lang="pt-BR" aria-pressed={locale === 'pt'} onClick={() => changeLocale('pt')}>PT</button><span aria-hidden="true">/</span><button type="button" lang="en" aria-pressed={locale === 'en'} onClick={() => changeLocale('en')}>EN</button></div><a className={styles.headerCta} href="/app">{t.launch} <Arrow /></a></div>
    </div></header>

    <main id="main" tabIndex={-1}>
      <section className={styles.hero} id="product">
        <div className={styles.heroGlow} data-landing-halo aria-hidden="true" />
        <div className={styles.container}>
          <div className={styles.heroCopy}>
            <SectionKicker>{t.heroEyebrow}</SectionKicker>
            <h1>{t.heroTitleFirst}<br />{t.heroTitleSecond} <span>{t.heroTitleAccent}</span></h1>
            <p>{t.heroBody}</p>
            <div className={styles.heroActions}><a className={styles.primaryButton} href="/app">{t.launch} <Arrow /></a><a className={styles.secondaryButton} href="#developers">{t.buildWith}</a></div>
            <p className={styles.heroFootnote}>{t.heroFootnote}</p>
            <div className={styles.heroTokens} aria-label="ETH, USDC, BTC, WBTC, SOL">{(['ETH', 'USDC', 'BTC', 'WBTC', 'SOL'] as const).map(name => <span key={name}><CryptoMark name={name}/><span>{name}</span></span>)}</div>
          </div>
          <div className={styles.heroStage} data-hero-stage><span className={styles.heroStageAura} aria-hidden="true" /><HeroPreview t={t} /></div>
        </div>
      </section>

      <CryptoScenarios t={t}/>
      <SupportedNetworks t={t}/>
      <WorkflowStory t={t} />

      <section className={styles.reviewSection} id="review" data-landing-reveal><div className={styles.container}><div className={styles.splitGrid}>
        <div className={styles.reviewScene}><span className={styles.reviewGhost} aria-hidden="true" /><ReviewPreview t={t} /></div>
        <div className={styles.sectionCopy}>
          <SectionKicker>{t.clarityEyebrow}</SectionKicker>
          <h2>{t.clarityTitle}</h2>
          <p>{t.clarityBody}</p>
          <p>{t.clarityFollowup}</p>
          <div className={styles.featureList}><div><strong>{t.structured}</strong><span>{t.structuredBody}</span></div><div><strong>{t.reviewable}</strong><span>{t.reviewableBody}</span></div><div><strong>{t.verifiable}</strong><span>{t.verifiableBody}</span></div></div>
        </div>
      </div></div></section>

      <section className={styles.developerSection} id="developers" data-landing-reveal><div className={styles.container}>
        <div className={styles.centerHeading}><SectionKicker>{t.buildersEyebrow}</SectionKicker><h2>{t.buildersTitleFirst}<br />{t.buildersTitleSecond}</h2><p>{t.buildersBody}</p></div>
        <FlowDiagram t={t} />
        <div className={styles.developerStatement}><strong>{t.oneIntegration}</strong><span>{t.partnerBody}</span></div>
        <div className={styles.developerValues}><div><strong>{t.uxYours}</strong><span>{t.uxYoursBody}</span></div><div><strong>{t.executionStructured}</strong><span>{t.executionStructuredBody}</span></div><div><strong>{t.outcomesInspectable}</strong><span>{t.outcomesInspectableBody}</span></div></div>
        <a className={styles.primaryButton} href="https://github.com/alrimarleskovar/gryloo/tree/main/docs/developer">{t.buildWith} <Arrow /></a>
        <div id="documentation" className={styles.documentation}><strong>{t.developerDocs}</strong><span>{t.developerDocsBody}</span><a href="/app">{t.openBuilder} <Arrow /></a></div>
      </div></section>

      <section className={styles.closingSection} id="about" data-landing-reveal><div className={styles.horizon} aria-hidden="true" /><div className={styles.container}><div className={styles.closingGrid}>
        <div><SectionKicker>{t.visionEyebrow}</SectionKicker><h2>{t.visionTitleFirst}<br /><span>{t.visionTitleSecond}</span></h2><p>{t.visionBody}</p><div className={styles.heroActions}><a className={styles.primaryButton} href="/app">{t.launch} <Arrow /></a><a className={styles.darkSecondaryButton} href="https://github.com/alrimarleskovar/gryloo/tree/main/docs/developer">{t.buildWith}</a></div><p className={styles.closingFootnote}>{t.visionFootnote}</p></div>
        <VisionVisual t={t} />
      </div></div></section>
    </main>
    <footer className={styles.footer}><div className={styles.container}><a href="/" className={styles.brandLink} aria-label={t.brandHome}><Brand light /></a><nav aria-label={t.footerNavigation}><a href="#product">{t.navProduct}</a><a href="#developers">{t.navDevelopers}</a><a href="https://github.com/alrimarleskovar/gryloo/tree/main/docs/developer">{t.navDocs}</a><a href="#networks">{t.navNetworks}</a><a href="#about">{t.navAbout}</a></nav><span>{t.footerLine}</span></div></footer>
  </div>;
}
