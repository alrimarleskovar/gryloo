// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-WORKFLOW-VISUAL-PRESENTATION-001: the one layout of a workflow visual — a deterministic HTML/CSS element tree with a fixed
 * size, plus its accessible text (title, one-line summary, alt description), in English or Portuguese.
 *
 *   WorkflowVisualModel ──workflowVisualLayout(model, language)──► { tree, width, height, title, summary, alt }
 *        ├── the MCP App panel paints `tree` as DOM (text through textContent, allowlisted styles only)
 *        └── `src/server/workflow-visual-image.ts` rasterizes the same `tree` to PNG for MCP image content, Telegram and WhatsApp
 *
 * Pure and deterministic: the same model and language always give the same tree, size and text. Every line has a fixed height, so the
 * size is known before rendering; long values shrink, then clip with an ellipsis (the alt text always carries them in full). Every string
 * is limited to glyphs the rasterizer's bundled font covers, so rendering never needs another font (and never reaches a network).
 * Wording is FloFi's own product vocabulary; nothing here is financial authority.
 */
import type { VisualAccount, VisualStep, VisualWarning, WorkflowVisualModel } from './workflow-visual.ts';

export type VisualLanguage = 'EN' | 'PT';
/** A layout node: a `div` with inline styles (CSS property names in camelCase, string values) and children or one text. */
export type VisualNode = { readonly type: 'div'; readonly props: { readonly style: Readonly<Record<string, string | number>>; readonly children?: readonly VisualNode[] | string } };
export type VisualLayout = { readonly tree: VisualNode; readonly width: number; readonly height: number; readonly title: string; readonly summary: string;
  readonly alt: string; readonly language: VisualLanguage };

/** Printable ASCII, Latin-1 (no soft hyphen) and the few symbols the layout uses: the glyphs of the rasterizer's bundled font (tested). */
export const VISUAL_GLYPHS = /[^\x20-\x7E\u00A0-\u00AC\u00AE-\u00FF\u2013\u2014\u2022\u2026\u2190-\u2193\u2248\u2264\u2265]/gu;
/** Any other character becomes `?`: a picture never needs a font that is not bundled. */
export const glyphSafe = (text: string) => text.replace(VISUAL_GLYPHS, '?');

const ACTIONS = {
  EN: { SWAP: 'Swap', BRIDGE: 'Bridge', SUPPLY: 'Supply', BORROW: 'Borrow', REPAY: 'Repay', WITHDRAW: 'Withdraw', ADD_LIQUIDITY: 'Add liquidity', TRANSFER: 'Transfer',
    OTHER: 'Step' },
  PT: { SWAP: 'Trocar', BRIDGE: 'Transferir entre redes', SUPPLY: 'Depositar', BORROW: 'Pedir emprestado', REPAY: 'Reembolsar', WITHDRAW: 'Levantar',
    ADD_LIQUIDITY: 'Adicionar liquidez', TRANSFER: 'Transferir', OTHER: 'Etapa' },
} as const;
const WORDS = {
  EN: { eyebrow: 'FLOFI · WORKFLOW', test: 'Test funds', real: 'Real funds', steps: (n: number) => `${n} ${n === 1 ? 'step' : 'steps'}`,
    many: (n: number) => `${n}-step workflow`, upTo: 'Up to', slippage: 'Max slippage', range: 'Price range', recipient: 'Recipient', beneficiary: 'On behalf of',
    owner: 'Owner', connected: 'To your connected wallet', step: 'Step', on: 'on', via: 'via',
    warnings: { REAL_FUNDS: 'Real funds: this workflow uses a mainnet', DEBT_REMAINS: 'Debt remains after the swap',
      SEQUENCE_NOT_EXECUTABLE: 'This sequence cannot run as one workflow yet' } satisfies Record<VisualWarning, string>,
    footer: 'Review and sign in FloFi · nothing is authorized yet', reference: 'Workflow', alt: 'FloFi workflow' },
  PT: { eyebrow: 'FLOFI · FLUXO', test: 'Fundos de teste', real: 'Fundos reais', steps: (n: number) => `${n} ${n === 1 ? 'etapa' : 'etapas'}`,
    many: (n: number) => `Fluxo de ${n} etapas`, upTo: 'Até', slippage: 'Desvio máximo', range: 'Faixa de preço', recipient: 'Destinatário', beneficiary: 'Em nome de',
    owner: 'Titular', connected: 'Para a sua carteira conectada', step: 'Etapa', on: 'na', via: 'via',
    warnings: { REAL_FUNDS: 'Fundos reais: este fluxo usa uma mainnet', DEBT_REMAINS: 'A dívida continua após a troca',
      SEQUENCE_NOT_EXECUTABLE: 'Esta sequência ainda não roda como um fluxo único' } satisfies Record<VisualWarning, string>,
    footer: 'Revise e assine no FloFi · nada está autorizado ainda', reference: 'Fluxo', alt: 'Fluxo FloFi' },
} as const;

/** Basis points as a percentage, exactly (50 → 0.5, 5 → 0.05, 125 → 1.25). */
export function percentOfBps(bps: number): string {
  const whole = Math.floor(bps / 100), fraction = String(bps % 100).padStart(2, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}
const shortHash = (hash: string) => /^0x[0-9a-f]{64}$/.test(hash) ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : '';
const amountText = (s: VisualStep, language: VisualLanguage) => {
  if (!s.amounts.length) return '';
  const amounts = s.amounts.map(a => `${a.amount} ${a.asset}`).join(' + ');
  if (s.amountKind === 'MAXIMUM') return `${WORDS[language].upTo} ${amounts}`;
  return s.toAsset ? `${amounts} → ${s.toAsset}` : amounts;
};
const networkText = (s: VisualStep) => s.toNetwork ? `${s.network} → ${s.toNetwork}` : s.network;
const accountText = (account: VisualAccount, language: VisualLanguage) => {
  const w = WORDS[language];
  switch (account.role) {
    case 'CONNECTED_WALLET': return w.connected;
    case 'RECIPIENT': return `${w.recipient} ${account.address}`;
    case 'BENEFICIARY': return `${w.beneficiary} ${account.address}`;
    case 'OWNER': return `${w.owner} ${account.address}`;
  }
};
const sameAccount = (a: VisualAccount | null, b: VisualAccount | null) => JSON.stringify(a) === JSON.stringify(b);
/** The facts of one step that the IR states; `previous` lets a repeated account (the lending composition's owner) be shown once. */
function factsOf(s: VisualStep, previous: VisualStep | null, language: VisualLanguage): string[] {
  const w = WORDS[language], facts: string[] = [];
  if (s.range) facts.push(`${w.range} ${s.range.lower} – ${s.range.upper} ${s.range.unit}`);
  if (s.slippageBps !== null) facts.push(`${w.slippage} ${percentOfBps(s.slippageBps)}%`);
  if (s.account && !(previous && sameAccount(previous.account, s.account))) facts.push(accountText(s.account, language));
  return facts;
}
const headline = (s: VisualStep, language: VisualLanguage) => ACTIONS[language][s.action];

/** The title, one-line summary and full alt description of a model: also the text fallback where a picture cannot be shown. */
export function workflowVisualText(model: WorkflowVisualModel, language: VisualLanguage): { readonly title: string; readonly summary: string; readonly alt: string;
  readonly lines: readonly string[] } {
  const w = WORDS[language], n = model.steps.length;
  const title = n === 0 ? w.alt : n <= 3 ? model.steps.map(s => headline(s, language)).join(' → ') : w.many(n);
  const funds = model.fundsClass === 'REAL_FUNDS' ? w.real : w.test;
  const summary = [title, funds, w.steps(n), model.networks.join(' · ')].filter(Boolean).join(' · ');
  const lines = model.steps.map((s, i) => {
    const facts = factsOf(s, model.steps[i - 1] ?? null, language), amount = amountText(s, language);
    return `${s.index}. ${headline(s, language)}${s.provider ? ` (${s.provider})` : ''}${amount ? ` · ${amount}` : ''} · ${networkText(s)}${facts.length ? ` · ${facts.join(' · ')}` : ''}`;
  });
  const alt = [`${w.alt}: ${title}. ${funds} · ${w.steps(n)}.`, ...lines.map(l => `${l}.`), ...model.warnings.map(x => `${w.warnings[x]}.`), `${w.footer}.`,
    shortHash(model.workflowHash) ? `${w.reference} ${shortHash(model.workflowHash)}.` : ''].filter(Boolean).join(' ');
  return { title: glyphSafe(title), summary: glyphSafe(summary), alt: glyphSafe(alt), lines: lines.map(glyphSafe) };
}

// Palette: FloFi's MCP panel tokens (light), so the picture matches the in-chat panel.
const C = { page: '#f4f7fb', card: '#ffffff', ink: '#14233a', muted: '#52627a', line: '#dce4ef', blue: '#1d5fca', blueSoft: '#e8f0fd', red: '#a11c29', redSoft: '#fdecee',
  amber: '#915e08', amberSoft: '#fff5de', chip: '#eaf0f7' } as const;
/**
 * The layout's base width: phone-first, so a chat bubble (~330 pt) or a narrow panel shows it at about two thirds of its size and the
 * smallest text stays near 10 pt. The PNG scales it to 1080 px; the panel scales it to its frame.
 */
export const VISUAL_BASE_WIDTH = 480;
const M = { pad: 20, header: 94, headerGap: 16, cardPad: 14, cardSide: 14, compactPad: 10, title: 24, amount: 28, network: 20, fact: 20, connector: 26,
  compactConnector: 18, gap: 10, warning: 34, warningGap: 8, warningsTop: 14, footerTop: 16, footer: 42, badge: 28 } as const;
const MAX_FACTS = 3, COMPACT_AFTER = 4;

const px = (value: number, scale: number) => `${Math.round(value * scale * 100) / 100}px`;
const clip = (text: string, max: number) => text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
type Box = Record<string, string | number>;
const div = (style: Box, children: readonly VisualNode[] | string): VisualNode => ({ type: 'div', props: { style: { display: 'flex', ...style }, children } });
/** One fixed-height line of text: never wraps; overflow ends in an ellipsis. */
function line(text: string, size: number, height: number, color: string, scale: number, extra: Box = {}): VisualNode {
  return div({ height: px(height, scale), lineHeight: px(height, scale), fontSize: px(size, scale), color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    ...extra }, glyphSafe(text));
}
/** The amount line keeps the exact amount readable: a long value is set smaller before anything is clipped. */
const amountSize = (text: string) => text.length <= 24 ? 22 : text.length <= 32 ? 18 : 15;
/** The title steps down the same way (Portuguese action names are longer). */
const titleSize = (text: string) => text.length <= 26 ? 24 : text.length <= 34 ? 20 : 17;

function card(s: VisualStep, facts: readonly string[], language: VisualLanguage, compact: boolean, scale: number): { node: VisualNode; height: number } {
  const amount = amountText(s, language), network = networkText(s), pad = compact ? M.compactPad : M.cardPad;
  const rows: VisualNode[] = [];
  const head = [line(headline(s, language), 19, M.title, C.ink, scale, { flexShrink: 0 })];
  // A leading space would be trimmed by the layout engine: the separator keeps its distance with a margin instead.
  if (s.provider) head.push(line(`· ${s.provider}`, 17, M.title, C.muted, scale, { flexShrink: 1, marginLeft: px(6, scale) }));
  rows.push(div({ flexDirection: 'row', alignItems: 'center', height: px(M.title, scale), overflow: 'hidden' }, head));
  let height = M.title;
  if (compact) {
    const text = [amount, network].filter(Boolean).join(' · ');
    rows.push(line(clip(text, 46), 15, M.network, C.ink, scale)); height += M.network;
  } else {
    if (amount) { rows.push(line(clip(amount, 44), amountSize(amount), M.amount, C.ink, scale)); height += M.amount; }
    rows.push(line(clip(network, 46), 15, M.network, C.muted, scale)); height += M.network;
    for (const fact of facts.slice(0, MAX_FACTS)) { rows.push(line(clip(fact, 46), 15, M.fact, C.muted, scale)); height += M.fact; }
  }
  height += 2 * pad + 2;
  const badge = div({ width: px(M.badge, scale), height: px(M.badge, scale), borderRadius: px(M.badge / 2, scale), backgroundColor: C.blue, color: '#ffffff',
    fontSize: px(15, scale), alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginRight: px(M.gap, scale) }, String(s.index));
  const node = div({ flexDirection: 'row', alignItems: 'flex-start', height: px(height, scale), padding: `${px(pad, scale)} ${px(M.cardSide, scale)}`, backgroundColor: C.card,
    border: `${px(1, scale)} solid ${C.line}`, borderRadius: px(14, scale) }, [badge, div({ flexDirection: 'column', flexGrow: 1, flexShrink: 1, minWidth: '0px' }, rows)]);
  return { node, height };
}
/** The link between two steps that depend on each other: a short line and an arrow under the step numbers; a plain gap otherwise. */
function connector(linked: boolean, compact: boolean, scale: number): { node: VisualNode; height: number } {
  const height = compact ? M.compactConnector : M.connector, left = M.cardSide + M.badge / 2 - 8;
  if (!linked) return { node: div({ height: px(height, scale) }, []), height };
  return { height, node: div({ flexDirection: 'column', alignItems: 'center', width: px(16, scale), height: px(height, scale), marginLeft: px(left, scale) }, [
    div({ width: px(2, scale), height: px(height - 16, scale), backgroundColor: C.line }, []),
    line('↓', 14, 16, C.blue, scale, { justifyContent: 'center', width: px(16, scale) })] ) };
}
function chip(text: string, scale: number, colors: { color: string; background: string }, shrink = false): VisualNode {
  return div({ height: px(28, scale), alignItems: 'center', padding: `0px ${px(10, scale)}`, borderRadius: px(14, scale), backgroundColor: colors.background,
    marginRight: px(8, scale), flexShrink: shrink ? 1 : 0, minWidth: '0px', overflow: 'hidden' }, [line(text, 14, 28, colors.color, scale)]);
}

/** The picture of a workflow: one deterministic tree at `scale` × the base size (1 for the panel, 1.6875 for a 1080-px PNG). */
export function workflowVisualLayout(model: WorkflowVisualModel, language: VisualLanguage, scale = 1): VisualLayout {
  const w = WORDS[language], text = workflowVisualText(model, language), compact = model.steps.length > COMPACT_AFTER;
  const linked = (from: string, to: string) => model.connections.some(c => c.from === from && c.to === to);
  const funds = model.fundsClass === 'REAL_FUNDS' ? chip(w.real, scale, { color: C.red, background: C.redSoft }) : chip(w.test, scale, { color: C.ink, background: C.chip });
  const header = div({ flexDirection: 'column', height: px(M.header, scale), marginBottom: px(M.headerGap, scale) }, [
    line(w.eyebrow, 13, 18, C.muted, scale, { letterSpacing: px(1.6, scale) }),
    line(clip(text.title, 44), titleSize(text.title), 32, C.ink, scale, { marginTop: px(6, scale) }),
    div({ flexDirection: 'row', alignItems: 'center', height: px(28, scale), marginTop: px(10, scale), overflow: 'hidden' }, [funds,
      chip(w.steps(model.steps.length), scale, { color: C.ink, background: C.chip }), chip(clip(model.networks.join(' · '), 40), scale, { color: C.muted, background: C.chip }, true)]),
  ]);
  const body: VisualNode[] = [];
  let height = M.pad + M.header + M.headerGap;
  model.steps.forEach((s, i) => {
    if (i > 0) { const c = connector(linked(model.steps[i - 1]!.id, s.id), compact, scale); body.push(c.node); height += c.height; }
    const c = card(s, factsOf(s, model.steps[i - 1] ?? null, language), language, compact, scale);
    body.push(c.node); height += c.height;
  });
  const warnings = model.warnings.map((x, i) => {
    const tone = x === 'REAL_FUNDS' ? { color: C.red, background: C.redSoft } : x === 'DEBT_REMAINS' ? { color: C.amber, background: C.amberSoft }
      : { color: C.blue, background: C.blueSoft };
    return div({ height: px(M.warning, scale), alignItems: 'center', padding: `0px ${px(12, scale)}`, borderRadius: px(10, scale), backgroundColor: tone.background,
      marginTop: px(i === 0 ? M.warningsTop : M.warningGap, scale) }, [line(w.warnings[x], 15, M.warning, tone.color, scale)]);
  });
  if (warnings.length) height += M.warningsTop + warnings.length * M.warning + (warnings.length - 1) * M.warningGap;
  const footer = div({ flexDirection: 'column', height: px(M.footer, scale), marginTop: px(M.footerTop, scale) }, [
    line(w.footer, 15, 20, C.ink, scale),
    line(shortHash(model.workflowHash) ? `${w.reference} ${shortHash(model.workflowHash)}` : '', 13, 18, C.muted, scale, { marginTop: px(4, scale) })]);
  height += M.footerTop + M.footer + M.pad;
  const width = VISUAL_BASE_WIDTH;
  const tree = div({ flexDirection: 'column', width: px(width, scale), height: px(height, scale), padding: px(M.pad, scale), backgroundColor: C.page, fontFamily: 'Geist, system-ui, sans-serif' },
    [header, div({ flexDirection: 'column' }, body), ...warnings, footer]);
  return { tree, width: Math.round(width * scale), height: Math.round(height * scale), title: text.title, summary: text.summary, alt: text.alt, language };
}
