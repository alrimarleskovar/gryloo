// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import styles from './landing.module.css';
import { CryptoFlow, CryptoMark } from './crypto-visuals';
import type { LandingCopy } from './landing-copy';

const stages = ['Intent', 'Strategy', 'Review', 'Execute', 'Verify'] as const;
type Stage = typeof stages[number];

function getStageContent(t: LandingCopy): Record<Stage, { eyebrow: string; title: string; body: string; facts: readonly [string, string][]; note: string }> { return {
  Intent: {
    eyebrow: t.stageIntentEyebrow,
    title: t.stageIntentTitle,
    body: t.stageIntentBody,
    facts: [[t.stageIntentFact, t.sampleIntent]],
    note: t.stageIntentNote,
  },
  Strategy: {
    eyebrow: t.stageStrategyEyebrow,
    title: t.stageStrategyTitle,
    body: t.stageStrategyBody,
    facts: [[t.stageStrategyNetwork, 'Base → Arbitrum'], [t.stageStrategyProtocol, 'Uniswap · Across / LI.FI']],
    note: t.stageStrategyNote,
  },
  Review: {
    eyebrow: t.stageReviewEyebrow,
    title: t.stageReviewTitle,
    body: t.stageReviewBody,
    facts: [[t.stageReviewNetwork, 'Base / Arbitrum'], [t.stageReviewAssets, t.stageReviewAssetsValue], [t.stageReviewAuthority, t.stageReviewAuthorityValue]],
    note: t.stageReviewNote,
  },
  Execute: {
    eyebrow: t.stageExecuteEyebrow,
    title: t.stageExecuteTitle,
    body: t.stageExecuteBody,
    facts: [[t.stageExecuteSigning, t.stageExecuteSigningValue], [t.stageExecutePreview, t.stageExecutePreviewValue]],
    note: t.stageExecuteNote,
  },
  Verify: {
    eyebrow: t.stageVerifyEyebrow,
    title: t.stageVerifyTitle,
    body: t.stageVerifyBody,
    facts: [[t.stageVerifyEvidence, t.stageVerifyEvidenceValue], [t.stageVerifyMaturity, t.stageVerifyReviewed]],
    note: t.stageVerifyNote,
  },
}; }

function StageDetail({ stage, t }: { stage: Stage; t: LandingCopy }) {
  if (stage === 'Intent') return <div className={styles.storyStageDetail} aria-label={t.stageIntentDetail}>
    <span className={styles.storyDetailLabel}>{t.stageIntentDetail}</span>
    <CryptoFlow assets={['ETH', 'USDC']}/><p className={styles.storyDetailLabel}>Base → Arbitrum</p>
  </div>;
  if (stage === 'Strategy') return <div className={styles.storyStageDetail} aria-label={t.stageStrategyDetail}>
    <span className={styles.storyDetailLabel}>{t.stageStrategyDetail}</span>
    <div className={styles.storyDetailRow}><CryptoMark name="ETH"/><div><strong>{t.reviewSwap}</strong><small>{t.stageStrategyDetailNote}</small></div><CryptoMark name="USDC"/></div>
  </div>;
  if (stage === 'Review') return <div className={styles.storyStageDetail} aria-label={t.stageReviewDetail}>
    <span className={styles.storyDetailLabel}>{t.stageReviewDetail}</span>
    <div className={styles.storyDetailPills}><span>{t.stageReviewAssets}</span><span>{t.stageReviewLimits}</span><span>{t.stageReviewCosts}</span><span>{t.stageReviewRisks}</span></div>
  </div>;
  if (stage === 'Execute') return <div className={styles.storyStageDetail} aria-label={t.stageExecuteDetail}>
    <span className={styles.storyDetailLabel}>{t.stageExecuteDetail}</span>
    <div className={styles.storyDetailRow}><span className={styles.storyDetailGlyph}>✓</span><div><strong>{t.stageExecuteDetailTitle}</strong><small>{t.stageExecuteDetailNote}</small></div></div>
  </div>;
  return <div className={styles.storyStageDetail} aria-label={t.stageVerifyDetail}>
    <span className={styles.storyDetailLabel}>{t.stageVerifyDetail}</span>
    <div className={styles.storyDetailPills}><span>{t.stageVerifyReviewed}</span><span>{t.stageVerifyObserved}</span><span>{t.stageVerifyReconciled}</span></div>
  </div>;
}

export function WorkflowStory({ t }: { t: LandingCopy }) {
  const sectionRef = useRef<HTMLElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const stageContent = getStageContent(t);
  const stageLabels = [t.stageIntent, t.stageStrategy, t.stageReview, t.stageExecute, t.stageVerify];

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const section = sectionRef.current;
        if (!section || window.matchMedia('(max-width: 760px)').matches) return;
        const rect = section.getBoundingClientRect();
        const travel = Math.max(1, rect.height - window.innerHeight);
        const progress = Math.max(0, Math.min(1, -rect.top / travel));
        setActiveIndex(Math.min(stages.length - 1, Math.floor(progress * stages.length)));
      });
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, []);

  return <section className={styles.workflowStory} id="workflow" ref={sectionRef} aria-label={t.storyEyebrow}>
    <div className={styles.storySticky}><div className={styles.container}><div className={styles.storyGrid}>
      <div className={styles.storyCopy}>
        <p className={styles.kicker}>{t.storyEyebrow}</p>
        <h2>{t.storyTitleFirst}<br />{t.storyTitleSecond}</h2>
        <p>{t.storyBody}</p>
        <ol className={styles.storySteps} aria-label={t.storyEyebrow}>
          {stages.map((stage, index) => <li key={stage} className={index === activeIndex ? styles.storyStepCurrent : ''} aria-current={index === activeIndex ? 'step' : undefined}>{stageLabels[index]}</li>)}
        </ol>
        <span className={styles.scrollCue}>{t.storyScroll} <span aria-hidden="true">↓</span></span>
      </div>
      <div className={styles.storyScene}><span className={styles.storySceneBack} aria-hidden="true" /><div className={styles.storyFrame} data-landing-depth aria-label={t.productIllustration}>
        <div className={styles.storyFrameTop}><strong><Image src="/brand/flofi-symbol-light.svg" alt="" width={35} height={35} />FloFi</strong><div className={styles.storyFrameTabs}><span>{t.tabBuild}</span><span>{t.tabSimulate}</span><span>{t.tabExecute}</span></div><span>{t.productIllustration}</span></div>
        <div className={styles.storyPrompt}>{t.sampleIntent} <span aria-hidden="true">↗</span></div>
        <div className={styles.storyFrameBody}>
          <ol className={styles.storyFrameStages}>{stages.map((stage, index) => <li key={stage} className={index === activeIndex ? styles.storyFrameCurrent : index < activeIndex ? styles.storyFrameComplete : ''}><span>{index < activeIndex ? '✓' : index + 1}</span>{stageLabels[index]}</li>)}</ol>
          <div className={styles.storyPanels}>{stages.map((stage, index) => {
            const content = stageContent[stage];
            return <div key={stage} className={index === activeIndex ? styles.storyPanelActive : styles.storyPanel} aria-hidden={index !== activeIndex}>
              <span className={styles.previewEyebrow}>{content.eyebrow}</span>
              <h3>{content.title}</h3>
              <p>{content.body}</p>
              <div className={styles.storyFacts}>{content.facts.map(([name, value]) => <div key={name}><span>{name}</span><strong>{value}</strong></div>)}</div>
              <StageDetail stage={stage} t={t} />
              <small>{content.note}</small>
            </div>;
          })}</div>
        </div>
      </div></div>
    </div></div></div>
    <div className={styles.mobileStory}><div className={styles.container}><p className={styles.kicker}>{t.storyEyebrow}</p><h2>{t.storyTitleFirst}<br />{t.storyTitleSecond}</h2><p>{t.storyMobileBody}</p><span className={styles.mobileQualifier}>{t.storyMobileQualifier}</span>
      {stages.map((stage, index) => {
        const content = stageContent[stage];
        return <article key={stage} className={styles.mobileStage}><span>{String(index + 1).padStart(2, '0')} / {stageLabels[index]}</span><h3>{content.title}</h3><p>{content.body}</p><StageDetail stage={stage} t={t} /></article>;
      })}
    </div></div>
  </section>;
}
