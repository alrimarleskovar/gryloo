// SPDX-License-Identifier: AGPL-3.0-only
import { COPILOT_NETWORKS, COPILOT_V1_PARTS } from './copilot-intent';
import { groundedAmount, mentionedNetworks, TESTNET_WORDS } from './copilot-authoring';
import { validateAutomationInput, type AutomationInput } from '../automations/definition';
import { routeStrategy } from '../automations/assets';
import type { CapabilityView } from '../automations/views';
import type { CopilotLanguage } from './copilot-messages';
import { portugueseAutomations } from '../i18n/pt-automations';

export type { AutomationInput } from '../automations/definition';
export type AutomationDraft = {
  kind: 'SCHEDULED_DCA' | 'PRICE_TRIGGER' | 'DAILY_WATCH'; asset: 'ETH' | 'SOL' | 'BTC' | 'OTHER' | null;
  side: 'BUY' | 'SELL' | null; network: (typeof COPILOT_NETWORKS)[number] | null;
  amount: string | null; spendAsset: 'USDC' | 'DEVUSDC' | 'ETH' | 'WETH' | 'SOL' | 'OTHER' | null;
  time: string | null; condition: 'PRICE_BELOW' | 'PRICE_ABOVE' | null; threshold: string | null;
};
const KEYS = ['kind', 'asset', 'side', 'network', 'amount', 'spendAsset', 'time', 'condition', 'threshold'];
export function parseAutomationDraft(raw: unknown): AutomationDraft {
  const p = COPILOT_V1_PARTS, v = p.exact(raw, KEYS);
  const time = v.time === null ? null : p.text(v.time, 5);
  if (time !== null && !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time)) return p.fail();
  return { kind: p.oneOf(['SCHEDULED_DCA', 'PRICE_TRIGGER', 'DAILY_WATCH'] as const, v.kind),
    asset: p.nullableOneOf(['ETH', 'SOL', 'BTC', 'OTHER'] as const, v.asset), side: p.nullableOneOf(['BUY', 'SELL'] as const, v.side),
    network: p.nullableOneOf(COPILOT_NETWORKS, v.network), amount: p.amount(v.amount),
    spendAsset: p.nullableOneOf(['USDC', 'DEVUSDC', 'ETH', 'WETH', 'SOL', 'OTHER'] as const, v.spendAsset),
    time, condition: p.nullableOneOf(['PRICE_BELOW', 'PRICE_ABOVE'] as const, v.condition), threshold: p.amount(v.threshold) };
}
const s = COPILOT_V1_PARTS.schema;
export const AUTOMATION_DRAFT_SCHEMA = s.object({
  kind: s.choice(['SCHEDULED_DCA', 'PRICE_TRIGGER', 'DAILY_WATCH'], 'Daily recurring trade, price crossing, or daily read-only watch.'),
  asset: s.nullableChoice(['ETH', 'SOL', 'BTC', 'OTHER'], 'Observed/traded asset explicitly named; null if absent.'),
  side: s.nullableChoice(['BUY', 'SELL'], 'Buy or sell only if stated; null for watch.'),
  network: s.nullableChoice(COPILOT_NETWORKS, 'Exact named network; null if absent. Never infer a mainnet.'),
  amount: s.nullableString('Exact input amount stated, decimal digits; null if missing.'),
  spendAsset: s.nullableChoice(['USDC', 'DEVUSDC', 'ETH', 'WETH', 'SOL', 'OTHER'], 'Token the amount spends; null if missing.'),
  time: s.nullableString('Explicit daily time in HH:mm (9h = 09:00); null if absent.'),
  condition: s.nullableChoice(['PRICE_BELOW', 'PRICE_ABOVE'], 'Explicit price direction; null otherwise.'),
  threshold: s.nullableString('Explicit USD threshold, normalized decimal; null if absent.'),
});
export type AutomationGrounding = { kind: 'PROPOSAL'; input: AutomationInput } | { kind: 'CLARIFICATION' | 'UNSUPPORTED'; message: string };
const NETWORK = { BASE: 'base', BASE_SEPOLIA: 'base-sepolia', ETHEREUM_SEPOLIA: 'ethereum-sepolia', SOLANA: 'solana', SOLANA_DEVNET: 'solana-devnet' } as const;
const DAILY = /\b(?:daily|every day|each day|todos os dias|todo dia|diariamente)\b/i;
const BUY = /\b(?:buy|purchase|compr\w*)\b/i, SELL = /\b(?:sell|vend\w*)\b/i;
const BELOW = /\b(?:below|under|abaixo|menos de)\b/i, ABOVE = /\b(?:above|over|acima|mais de)\b/i;

/** Untrusted interpretation → grounded input of the existing Automation domain. No IO or authority. */
export function groundAutomationDraft(raw: AutomationDraft, text: string, timezone: string, now = Date.now(), language: CopilotLanguage = 'EN'): AutomationGrounding {
  const ask = (message: string): AutomationGrounding => ({ kind: 'CLARIFICATION', message });
  const refuse = (message: string): AutomationGrounding => ({ kind: 'UNSUPPORTED', message });
  if (!raw.asset || raw.asset === 'OTHER' || !new RegExp(`\\b${raw.asset}\\b`, 'i').test(text)) return ask('Which asset should this automation watch or trade?');
  if (raw.kind !== 'PRICE_TRIGGER' && !DAILY.test(text)) return ask('Should this automation repeat every day?');
  const watch = raw.kind === 'DAILY_WATCH';
  if (watch && (!/\b(?:watch|check|monitor|verifica\w*|acompanha\w*)\b/i.test(text) || BUY.test(text) || SELL.test(text))) return ask('Should FloFi only check the asset, or prepare a trade?');
  if (!watch && (!raw.side || !(raw.side === 'BUY' ? BUY : SELL).test(text))) return ask('Should FloFi prepare a buy or a sell?');
  if (!watch && raw.asset === 'BTC') return refuse('FloFi has no BTC swap route yet. You can watch BTC and get alerts, but FloFi cannot prepare a BTC purchase.');
  let network: (typeof NETWORK)[keyof typeof NETWORK] | null = null;
  if (!watch) {
    if (!raw.amount || !groundedAmount(text, raw.amount) || !raw.spendAsset || !new RegExp(`\\b${raw.spendAsset}\\b`, 'i').test(text)) return ask('What amount and input asset should each proposal spend?');
    const money = [...text.matchAll(/(\d+(?:[.,]\d+)*)\s*(USDC|devUSDC|ETH|WETH|SOL)\b/gi)];
    if (!money.some(m => m[2]!.toUpperCase() === raw.spendAsset && groundedAmount(m[1]!, raw.amount!))) return ask('What amount and input asset should each proposal spend?');
    if (raw.network && !(raw.network in NETWORK) && (raw.network === 'OTHER' || mentionedNetworks(text).includes(raw.network))) return refuse('This automation route is not supported.');
    if (!raw.network || !(raw.network in NETWORK) || !mentionedNetworks(text).includes(raw.network as Exclude<AutomationDraft['network'], 'OTHER' | null>) ||
      (['BASE', 'SOLANA'].includes(raw.network) && TESTNET_WORDS.test(text))) return ask('Which network should this automation use? Name the test network or mainnet explicitly.');
    network = NETWORK[raw.network as keyof typeof NETWORK];
    const expected = raw.side === 'BUY' ? network === 'solana-devnet' ? 'DEVUSDC' : 'USDC' : raw.asset === 'ETH' ? ['ETH', 'WETH'] : ['SOL'];
    if (!(Array.isArray(expected) ? expected.includes(raw.spendAsset) : expected === raw.spendAsset)) return refuse('The input asset does not match this automation route.');
  }
  const schedule = { frequency: 'DAILY' as const, weekday: null, time: raw.time ?? '', timezone };
  if (raw.kind !== 'PRICE_TRIGGER') {
    const times = [...text.matchAll(/(?:\bat\s*|às?\s*|as\s*)(\d{1,2})(?::([0-5]\d)|h(?:([0-5]\d))?)?/gi)];
    if (!raw.time || !times.some(m => `${m[1]!.padStart(2, '0')}:${m[2] ?? m[3] ?? '00'}` === raw.time)) return ask('At what time should FloFi check this every day?');
  }
  if (raw.kind === 'PRICE_TRIGGER') {
    const thresholds = [...text.matchAll(/\b(ETH|SOL|BTC)\b[^,;\n]*?\b(below|under|abaixo(?: de)?|menos de|above|over|acima(?: de)?|mais de)\s*(\$|USD\s*)?\s*(\d+(?:[.,]\d+)*)(?:\s*(USD|dollars?|d[oó]lares?))?/gi)];
    if (!raw.condition || !raw.threshold || !thresholds.some(match => match[1]!.toUpperCase() === raw.asset &&
      (raw.condition === 'PRICE_BELOW' ? BELOW : ABOVE).test(match[2]!) && (match[3] || match[5]) && groundedAmount(match[4]!, raw.threshold!)))
      return ask('What USD price threshold and direction should trigger the proposal?');
  }
  const action = watch ? null : { kind: 'ROUTE' as const, asset: raw.asset, side: raw.side!, network: network!, amount: raw.amount!, slippageBps: 50 };
  if (action) { const route = routeStrategy(action); if (!route.ok) return refuse('The input asset does not match this automation route.'); }
  const limits = { maxAmountPerExecution: raw.amount, maxAmountPerPeriod: null, maxOccurrencesPerPeriod: null, cooldownMinutes: 0, maxSlippageBps: null };
  const label = raw.kind === 'DAILY_WATCH' ? 'Daily watch' : raw.kind === 'SCHEDULED_DCA' ? 'Scheduled DCA' : 'Price trigger';
  const name = `${raw.asset} ${language === 'PT' ? portugueseAutomations[label] ?? label : label}`;
  const input: AutomationInput = raw.kind === 'DAILY_WATCH' ? { version: 1, kind: raw.kind, name, schedule, watch: { assets: [raw.asset] }, expiresAt: null }
    : raw.kind === 'SCHEDULED_DCA' ? { version: 1, kind: raw.kind, name, schedule, action: action!, limits, expiresAt: null }
    : { version: 1, kind: raw.kind, name, timezone, condition: { type: raw.condition!, asset: raw.asset, threshold: raw.threshold!, checkEveryMinutes: 15 }, action, limits, expiresAt: null };
  const validated = validateAutomationInput(input, now);
  return validated.ok ? { kind: 'PROPOSAL', input } : ask('Check the automation amount, schedule and threshold.');
}
/** Same deployment capabilities shown in the Automations workspace; the server rechecks on create. */
export function automationCapabilityIssue(input: AutomationInput, capabilities: CapabilityView): string | null {
  const assets = input.kind === 'DAILY_WATCH' ? input.watch.assets : input.kind === 'PRICE_TRIGGER' ? [input.condition.asset] : [];
  if (assets.some(a => !capabilities.observable.includes(a))) return 'FloFi cannot observe this asset’s price on this deployment.';
  const action = 'action' in input ? input.action : null;
  if (action?.kind === 'ROUTE' && !capabilities.routes.some(r => r.asset === action.asset && r.network === action.network && r.executable)) return 'This action is not enabled on this deployment.';
  return null;
}
