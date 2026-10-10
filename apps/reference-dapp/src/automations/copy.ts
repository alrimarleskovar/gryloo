// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: the text of an automation notification (EN/PT), written by FloFi from its own records — never by a model.
 * It states what FloFi observed and what it would prepare, and that nothing is authorized; its only link opens the owner's own
 * Automations workspace (an opaque occurrence id, never an approval secret).
 */
import { singleStrategy } from './binding.ts';
import { NETWORKS } from '../engine/strategy-engine';
import type { StrategySpec } from '../engine/strategy-spec';
import type { OccurrenceRecord, RuleRecord } from './store.ts';
import { isPercentCondition } from './trigger.ts';

export type Language = 'EN' | 'PT';
type Observed = { readonly asset?: string; readonly priceUsd?: string; readonly source?: string; readonly evidence?: string; readonly previousPriceUsd?: string | null;
  readonly code?: string };
const shorten = (text: string) => text.replace(/0x([0-9a-fA-F]{4})[0-9a-fA-F]{32,60}([0-9a-fA-F]{4})(?![0-9a-fA-F])/g, '0x$1…$2');
const usd = (value: string) => { const [whole, fraction = ''] = value.split('.'); return `$${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction ? `.${fraction.slice(0, 2).padEnd(2, '0')}` : ''}`; };
const change = (now: string, before: string | null | undefined) => {
  if (!before) return '';
  const a = Number(now), b = Number(before);
  if (!(a > 0 && b > 0)) return '';
  const pct = (a - b) / b * 100;
  return ` (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
};
const action = (s: StrategySpec | null, pt: boolean) => !s || s.action !== 'swap' ? null
  : `${s.amount} ${s.inputAsset} → ${s.outputAsset} ${pt ? 'na' : 'on'} ${NETWORKS[s.network].label}${NETWORKS[s.network].class === 'MAINNET' ? (pt ? ' (FUNDOS REAIS)' : ' (REAL FUNDS)') : ''}`;
const conditionText = (rule: RuleRecord, pt: boolean) => {
  const c = rule.definition.condition;
  if (!c) return '';
  if (!isPercentCondition(c)) return `${c.asset} ${c.type === 'PRICE_BELOW' ? (pt ? 'abaixo de' : 'below') : (pt ? 'acima de' : 'above')} ${usd(c.threshold)}`;
  return `${c.asset} ${c.type === 'PERCENT_DROP' ? (pt ? 'cai' : 'falls') : (pt ? 'sobe' : 'rises')} ${c.percent}% ${pt ? 'desde' : 'from'} ${usd(c.reference)}`;
};
const provenance = (o: Observed, pt: boolean) => `${o.source === 'CHAINLINK' ? 'Chainlink' : o.source === 'FIXTURE' ? (pt ? 'fixture' : 'fixture') : o.source ?? ''}${o.evidence === 'MOCKED' ? ', MOCKED' : ''}`;

export function notificationText(language: Language, rule: RuleRecord, occurrence: OccurrenceRecord): string {
  const pt = language === 'PT', name = shorten(rule.name), act = action(singleStrategy(occurrence.strategy), pt);
  const footer = pt ? 'Nada está autorizado: abra o FloFi, rode uma nova simulação, revise o Strategy Manifest e assine com a sua própria carteira.'
    : 'Nothing is authorized: open FloFi, run a fresh simulation, review the Strategy Manifest and sign with your own wallet.';
  if (occurrence.kind === 'WATCH') {
    const assets = ((occurrence.observation as { assets?: Observed[] } | null)?.assets ?? []).map(a => a.priceUsd
      ? `${a.asset} ${usd(a.priceUsd)}${change(a.priceUsd, a.previousPriceUsd)} · ${provenance(a, pt)}` : `${a.asset}: ${pt ? 'sem observação' : 'not observed'} (${a.code ?? 'UNAVAILABLE'})`);
    return [pt ? `Ronda diária do FloFi “${name}”:` : `FloFi daily watch “${name}”:`, ...assets,
      pt ? 'Abra o FloFi para comprar, vender ou ignorar. Nada aqui autoriza qualquer coisa.' : 'Open FloFi to buy, sell or ignore. Nothing here authorizes anything.'].join('\n');
  }
  const lines = [pt ? `Automação do FloFi “${name}”` : `FloFi automation “${name}”`];
  if (occurrence.kind === 'PRICE') {
    const o = (occurrence.observation ?? {}) as Observed;
    lines[0] += pt ? `: ${o.asset} observado em ${usd(o.priceUsd ?? '0')} (${provenance(o, pt)}) — a sua condição “${conditionText(rule, pt)}” foi atingida.`
      : `: ${o.asset} observed at ${usd(o.priceUsd ?? '0')} (${provenance(o, pt)}) — your condition “${conditionText(rule, pt)}” is met.`;
  } else lines[0] += pt ? ' chegou ao horário agendado.' : ' is due.';
  lines.push(act ? (pt ? `Preparar ${act}?` : `Prepare ${act}?`) : (pt ? 'Esta automação só avisa você.' : 'This automation only notifies you.'));
  if (act) lines.push(footer);
  return lines.join('\n');
}
export const notificationLinkLabel = (language: Language) => language === 'PT' ? 'Abrir no FloFi' : 'Open in FloFi';
