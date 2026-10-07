// SPDX-License-Identifier: AGPL-3.0-only
import type { ReviewContext } from '@defi-workflow-engine/reference-linter';
import { parseLocalCommand, type Command } from './commands';
import type { Workflow } from './initial-workflow';
import { ROUTER_DEFAULT_SLIPPAGE, ROUTER_NETWORK_OPTIONS } from './router-authoring';
import { formatTokenAmount } from './jupiter-authoring';
import { UNISWAP_LIQUIDITY_DEFAULT_SLIPPAGE } from './uniswap-liquidity-authoring';
import { SOLANA_LIQUIDITY_DEFAULT_SLIPPAGE } from './solana-liquidity-authoring';
import { CopilotIntentError, parseCopilotIntent, safeCopilotProse, type CopilotAction, type CopilotAsset, type CopilotBridgeAction,
  type CopilotLendingAction, type CopilotLiquidityAction, type CopilotMissingField, type CopilotNetwork, type CopilotSwapAction } from './copilot-intent';
import { copilotCopy, type CopilotCopy, type CopilotLanguage, type NetworkSubject, type Subject } from './copilot-messages';

/**
 * BUILD-COPILOT-001: the deterministic boundary between an untrusted AI intent and the existing authoring path.
 * An intent becomes a proposal only by rendering one canonical exact-grammar sentence from validated, grounded fields
 * and parsing it with `parseLocalCommand`, so the Copilot can never author anything a user could not type.
 * Grounding: every amount, slippage, range bound and address must appear in the user's own words; every asset must be
 * named; a mainnet must be named explicitly with no test-network wording. Anything else becomes a clarification.
 *
 * BUILD-COPILOT-002: the planners take a grounding context. Besides the open request's text it may name fields whose
 * values Flofi itself carried from a resolved referent (a canonical step, the visible pending proposal or an earlier
 * proposal); those values have deterministic provenance and skip the text check, and nothing else does. It also selects
 * the reply language and whether a network may default (V1) or must be asked for (V2).
 */
export type CopilotOutcome =
  | { readonly kind: 'PROPOSAL'; readonly command: Command; readonly sentence: string; readonly notes: readonly string[] }
  | { readonly kind: 'CLARIFICATION'; readonly missing: readonly CopilotMissingField[]; readonly question: string; readonly options: readonly string[] }
  | { readonly kind: 'UNSUPPORTED'; readonly message: string }
  | { readonly kind: 'REJECTED'; readonly code: string; readonly message: string };
export type CopilotConversion = { readonly userText: string; readonly workflow: Workflow; readonly context: ReviewContext; readonly wallet: string | null };
/** The only Command types an AI interpretation can produce: new authoring proposals, never edits, removals or execution. */
export const COPILOT_AUTHORING_COMMANDS = Object.freeze(['ADD_SWAP', 'ADD_TESTNET_SWAP', 'ADD_ETHEREUM_SEPOLIA_SWAP', 'ADD_SOLANA_SWAP', 'ADD_ROUTER_BRIDGE', 'ADD_SUPPLY', 'ADD_BORROW',
  'ADD_REPAY', 'ADD_WITHDRAW', 'ADD_UNISWAP_LIQUIDITY', 'ADD_SOLANA_LIQUIDITY', 'AUTHOR_LENDING'] as const);
export type CopilotAuthoringCommand = (typeof COPILOT_AUTHORING_COMMANDS)[number];
export const COPILOT_CAPABILITIES = copilotCopy('EN').capabilities;

/** How the planners treat unstated networks and which language they reply in. */
export type PlanningPolicy = { readonly language: CopilotLanguage; readonly networkDefaults: boolean };
export const V1_POLICY: PlanningPolicy = Object.freeze({ language: 'EN', networkDefaults: true });
/** A field whose value Flofi carried from a resolved referent rather than read from the open request. */
export type CarriedField = 'network' | 'sourceNetwork' | 'destinationNetwork' | 'inputAsset' | 'outputAsset' | 'asset' | 'amount' | 'supplyAmount' | 'borrowAmount'
  | 'slippage' | 'recipient' | 'beneficiary' | 'routing' | 'protocol' | 'range' | `deposit:${string}`;
export type Grounding = { readonly text: string; readonly carried: ReadonlySet<CarriedField>; readonly policy: PlanningPolicy;
  /** V2: the latest user message alone, so an explicit answer to Flofi's own question can settle a choice the request left open. */
  readonly latest?: string };
const NOTHING_CARRIED: ReadonlySet<CarriedField> = new Set();

type Network = Exclude<CopilotNetwork, 'OTHER'>;
type Family = 'base' | 'arbitrum' | 'ethereum' | 'solana';
const FAMILY: Readonly<Record<Network, Family>> = { BASE: 'base', BASE_SEPOLIA: 'base', ARBITRUM: 'arbitrum', ARBITRUM_SEPOLIA: 'arbitrum',
  ETHEREUM: 'ethereum', ETHEREUM_SEPOLIA: 'ethereum', SOLANA: 'solana', SOLANA_DEVNET: 'solana' };
export const COPILOT_NETWORK_LABEL: Readonly<Record<Network, string>> = { BASE: 'Base', BASE_SEPOLIA: 'Base Sepolia', ARBITRUM: 'Arbitrum One',
  ARBITRUM_SEPOLIA: 'Arbitrum Sepolia', ETHEREUM: 'Ethereum', ETHEREUM_SEPOLIA: 'Ethereum Sepolia', SOLANA: 'Solana', SOLANA_DEVNET: 'Solana Devnet' };
// BUILD-ETHEREUM-001: ETHEREUM ("Ethereum" without Sepolia) is in no action's supported list, so it never resolves; it is always clarified.
const MAINNETS: ReadonlySet<CopilotNetwork> = new Set(['BASE', 'ARBITRUM', 'ETHEREUM', 'SOLANA']);
const MENTIONS: readonly (readonly [Network, RegExp])[] = [
  ['BASE_SEPOLIA', /\bbase[\s-]*sepolia\b/i], ['BASE', /\bbase\b(?![\s-]*sepolia)/i],
  ['ARBITRUM_SEPOLIA', /\barbitrum[\s-]*sepolia\b/i], ['ARBITRUM', /\barbitrum\b(?![\s-]*sepolia)/i],
  ['ETHEREUM_SEPOLIA', /\bethereum[\s-]*sepolia\b/i], ['ETHEREUM', /\bethereum\b(?![\s-]*sepolia)/i],
  ['SOLANA_DEVNET', /\bsolana[\s-]*devnet\b/i], ['SOLANA', /\bsolana\b(?![\s-]*devnet)/i],
];
// Any test-network or test-token wording rules out a mainnet (real funds) interpretation.
export const TESTNET_WORDS = /\b(?:sepolia|devnet|testnets?|test\s?net(?:work)?|test\s+(?:usdc|tokens?|funds?|sol|eth)|dev\s?usdc|teste|testes|de\s+teste)\b/i;
const ASSET_MENTIONS: Readonly<Record<Exclude<CopilotAsset, 'OTHER'>, RegExp>> = {
  // `\busdc` does not match inside "devUSDC": there is no word boundary between "v" and "U".
  USDC: /\busdc\b/i, DEVUSDC: /\b(?:dev\s?usdc|test\s?usdc)\b/i, WETH: /\bw?eth\b|\bether\b/i, ETH: /\bw?eth\b|\bether\b/i,
  SOL: /\bsol\b/i, USDT: /\b(?:usdt|tether)\b/i, WBTC: /\bwbtc\b/i,
};

/** Networks the user named, in any language that uses the network names. */
export function mentionedNetworks(text: string): Network[] { return MENTIONS.filter(([, pattern]) => pattern.test(text)).map(([network]) => network); }
export const canonicalDecimal = (value: string): string => {
  const [whole, fraction = ''] = value.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return whole!.replace(/^0+(?=\d)/, '') + (trimmed ? '.' + trimmed : '');
};
/** Every exact reading of one written number: 1.5 / 1,5 as decimals, 1,000 / 1.000 as grouped thousands, 1,000.50 and 1.000,50. */
export function amountReadings(token: string): string[] {
  const out: string[] = [];
  if (/^\d+(?:\.\d+)?$/.test(token)) out.push(token);
  if (/^\d+,\d+$/.test(token)) out.push(token.replace(',', '.'));
  if (/^\d{1,3}(?:\.\d{3})+$/.test(token) || /^\d{1,3}(?:,\d{3})+$/.test(token)) out.push(token.replace(/[.,]/g, ''));
  if (/^\d{1,3}(?:,\d{3})+\.\d+$/.test(token)) out.push(token.replace(/,/g, ''));
  if (/^\d{1,3}(?:\.\d{3})+,\d+$/.test(token)) out.push(token.replace(/\./g, '').replace(',', '.'));
  return [...new Set(out.map(canonicalDecimal))];
}
type Reading = { readonly value: string; readonly negative: boolean; readonly percent: boolean };
function numbersIn(text: string): Reading[] {
  // Digits inside addresses and other hex strings are not amounts.
  const clean = text.replace(/0x[0-9a-f]*/gi, ' ');
  const out: Reading[] = [];
  for (const match of clean.matchAll(/(?<![A-Za-z0-9_.,])\d(?:[\d.,]*\d)?/g)) {
    const before = clean[match.index - 1], after = clean.slice(match.index + match[0].length);
    for (const value of amountReadings(match[0])) out.push({ value, negative: before === '-' || before === '−', percent: /^\s?%/.test(after) });
  }
  return out;
}
export function groundedAmount(text: string, value: string): boolean {
  const wanted = canonicalDecimal(value);
  return numbersIn(text).some(reading => reading.value === wanted);
}
function groundedSigned(text: string, value: string): boolean {
  const negative = value.startsWith('-'), wanted = canonicalDecimal(negative ? value.slice(1) : value);
  return numbersIn(text).some(reading => reading.value === wanted && reading.negative === negative);
}
const percentToBps = (value: string): string | null => {
  const [whole, fraction = ''] = value.split('.');
  return fraction.length > 2 ? null : String(BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0')));
};
/** Basis points written as such ("50 bps", "slippage 50") or as a percentage ("0.5%"), only when the user mentions slippage at all. */
export function groundedBps(text: string, value: string): boolean {
  if (!/slippage|slip|bps|basis\s+points?|pontos?\s+base|deslizamento|toler|%/i.test(text)) return false;
  return numbersIn(text).some(reading => !reading.negative && (reading.value === value || (reading.percent && percentToBps(reading.value) === value)));
}
export function groundedAddress(text: string, address: string): boolean {
  return [...text.matchAll(/(?<![0-9a-fA-Fx])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g)].some(match => match[0].toLowerCase() === address.toLowerCase());
}
const assetNamed = (text: string, asset: Exclude<CopilotAsset, 'OTHER'>) => ASSET_MENTIONS[asset].test(text);

class Stop { constructor(readonly outcome: CopilotOutcome) {} }
const ask = (missing: CopilotMissingField[], question: string, options: readonly string[] = []): never => {
  throw new Stop({ kind: 'CLARIFICATION', missing, question, options });
};
const refuse = (message: string): never => { throw new Stop({ kind: 'UNSUPPORTED', message }); };
const reject = (code: string, message: string): never => { throw new Stop({ kind: 'REJECTED', code, message }); };
const labels = (networks: readonly Network[]) => networks.map(n => COPILOT_NETWORK_LABEL[n]);
const copyOf = (g: Grounding): CopilotCopy => copilotCopy(g.policy.language);
const stillNeeds = (m: CopilotCopy, missing: readonly CopilotMissingField[], subject: Subject) => m.stillNeeds(m.subject[subject], missing.map(field => m.field[field]));

/** A network can only default when it is the action's single, test-token deployment and the user named no other network of that family. */
function defaultNetwork(supported: readonly Network[], text: string): Network | null {
  const only = supported.length === 1 ? supported[0]! : null;
  return only && !MAINNETS.has(only) && !mentionedNetworks(text).some(n => FAMILY[n] === FAMILY[only]) ? only : null;
}
function resolveNetwork(value: CopilotNetwork | null, supported: readonly Network[], g: Grounding, subject: NetworkSubject, notes: string[]): Network {
  const m = copyOf(g), what = m.networkSubject[subject], named = mentionedNetworks(g.text), options = labels(supported);
  const carried = value !== null && value !== 'OTHER' && g.carried.has('network');
  if (value === 'OTHER') return ask(['network'], m.networkOnlyOn(what, options), options);
  // "Ethereum" without Sepolia never means Ethereum Mainnet (not executable in Flofi) nor silently Ethereum Sepolia: Flofi asks.
  const ethereumOnly = named.includes('ETHEREUM') && !named.includes('ETHEREUM_SEPOLIA') && !carried;
  if (value === 'ETHEREUM' || (ethereumOnly && (value === 'ETHEREUM_SEPOLIA' || (value === null && !supported.some(n => named.includes(n))))))
    return ask(['network'], m.ethereumWhichNetwork(what, options), options);
  let network: Network | null = value;
  if (network === null) { const candidates = supported.filter(n => named.includes(n)); network = candidates.length === 1 ? candidates[0]! : null; }
  if (network === null) {
    const fallback = g.policy.networkDefaults ? defaultNetwork(supported, g.text) : null;
    if (!fallback) return ask(['network'], m.whichNetwork(what), options);
    notes.push(m.defaultNetworkNote(what, COPILOT_NETWORK_LABEL[fallback]));
    return fallback;
  }
  if (!supported.includes(network)) return ask(['network'], m.networkOnlyOn(what, options), options);
  if (MAINNETS.has(network)) {
    // Real funds are never inferred: the user must name the mainnet (or it is carried from a step they authored) and use no test-network wording.
    if ((!named.includes(network) && !carried) || TESTNET_WORDS.test(g.text)) return ask(['network'], m.realFundsWhichNetwork(COPILOT_NETWORK_LABEL[network]), options);
    return network;
  }
  if (named.includes(network) || carried) return network;
  if (!g.policy.networkDefaults || defaultNetwork(supported, g.text) !== network) return ask(['network'], m.whichNetwork(what), options);
  notes.push(m.defaultNetworkNote(what, COPILOT_NETWORK_LABEL[network]));
  return network;
}
function amountOf(value: string | null, g: Grounding, subject: Subject, field: CarriedField = 'amount'): string {
  const m = copyOf(g);
  if (value === null) return ask(['amount'], stillNeeds(m, ['amount'], subject));
  if (!g.carried.has(field) && !groundedAmount(g.text, value)) return ask(['amount'], m.amountNotFound(value));
  return value;
}
function slippageOf(value: string | null, fallback: string, g: Grounding, notes: string[], maximum?: number): string {
  const m = copyOf(g);
  if (value === null) { notes.push(m.defaultSlippageNote(fallback)); return fallback; }
  if (!g.carried.has('slippage') && !groundedBps(g.text, value)) return ask(['slippage'], m.slippageNotFound(value));
  if (maximum !== undefined && Number(value) > maximum) return reject('COPILOT_SLIPPAGE_OUT_OF_RANGE', m.slippageAtMost(maximum));
  return value;
}
function addressOf(value: string | null, g: Grounding, field: 'beneficiary' | 'recipient'): string | null {
  if (value !== null && !g.carried.has(field) && !groundedAddress(g.text, value)) return ask([field], copyOf(g).addressNotFound(field));
  return value;
}
function needAsset(value: CopilotAsset | null, g: Grounding, subject: Subject, field: CarriedField): Exclude<CopilotAsset, 'OTHER'> {
  const m = copyOf(g);
  if (value === null) return ask(['asset'], stillNeeds(m, ['asset'], subject));
  if (value === 'OTHER') return refuse(m.tokenUnsupported(m.tokenSubject[subject]));
  if (!g.carried.has(field) && !assetNamed(g.text, value)) return ask(['asset'], m.tokenNotFound(value));
  return value;
}

export type Plan = { readonly sentence: string; readonly expect: CopilotAuthoringCommand; readonly notes: string[] };

function planSwap(a: CopilotSwapAction, g: Grounding): Plan {
  const m = copyOf(g), notes: string[] = [], supported: Network[] = ['BASE', 'BASE_SEPOLIA', 'ETHEREUM_SEPOLIA', 'SOLANA', 'SOLANA_DEVNET'];
  // A generic "Ethereum" is left to resolveNetwork, which explains that Ethereum Mainnet is never used.
  const named = mentionedNetworks(g.text);
  const missing: CopilotMissingField[] = [...(a.amount === null ? ['amount' as const] : []), ...(a.inputAsset === null || a.outputAsset === null ? ['asset' as const] : []),
    ...(a.network === null && !supported.some(n => named.includes(n)) && !named.includes('ETHEREUM') ? ['network' as const] : [])];
  if (missing.length) ask(missing, stillNeeds(m, missing, 'swap'), missing.length === 1 && missing[0] === 'network' ? labels(supported) : []);
  const network = resolveNetwork(a.network, supported, g, 'swap', notes);
  const input = needAsset(a.inputAsset, g, 'swap', 'inputAsset'), output = needAsset(a.outputAsset, g, 'swap', 'outputAsset');
  const amount = amountOf(a.amount, g, 'swap');
  const slippage = slippageOf(a.slippageBps, '50', g, notes);
  if (FAMILY[network] === 'base' || FAMILY[network] === 'ethereum') {
    const evm = (asset: string) => asset === 'USDC' ? 'USDC' : asset === 'WETH' || asset === 'ETH' ? 'WETH' : refuse(m.evmSwapTokens);
    const from = evm(input), to = evm(output);
    if (from === to) reject('INVALID_ASSET_PAIR', m.differentTokens);
    if (input === 'ETH' || output === 'ETH') notes.push(m.wethNote);
    return { sentence: `swap ${amount} ${from} to ${to} on ${COPILOT_NETWORK_LABEL[network]} slippage ${slippage} bps`,
      expect: network === 'BASE_SEPOLIA' ? 'ADD_TESTNET_SWAP' : network === 'ETHEREUM_SEPOLIA' ? 'ADD_ETHEREUM_SEPOLIA_SWAP' : 'ADD_SWAP', notes };
  }
  const devnet = network === 'SOLANA_DEVNET';
  const solana = (asset: string) => asset === 'SOL' ? 'SOL' : devnet ? (asset === 'DEVUSDC' || asset === 'USDC' ? 'devUSDC' : refuse(m.devnetSwapTokens))
    : asset === 'USDC' || asset === 'USDT' ? asset : refuse(m.solanaSwapTokens);
  const from = solana(input), to = solana(output);
  if (from === to) reject('INVALID_ASSET_PAIR', m.differentTokens);
  return { sentence: `swap ${amount} ${from} to ${to} on ${devnet ? 'Solana Devnet' : 'Solana'} slippage ${slippage} bps`, expect: 'ADD_SOLANA_SWAP', notes };
}

function planBridge(a: CopilotBridgeAction, g: Grounding): Plan {
  const m = copyOf(g), notes: string[] = [], text = g.text;
  const carriedSide = (value: CopilotNetwork | null, field: CarriedField): Network[] => value !== null && value !== 'OTHER' && g.carried.has(field) ? [value] : [];
  const named = [...mentionedNetworks(text), ...carriedSide(a.sourceNetwork, 'sourceNetwork'), ...carriedSide(a.destinationNetwork, 'destinationNetwork')];
  // A side is the network the user named in that family; an unnamed test network is only a candidate, an unnamed mainnet is dropped.
  const side = (value: CopilotNetwork | null, family: Family): Network | null | 'OTHER' | 'CONFLICT' => {
    const inFamily = [...new Set(named.filter(n => FAMILY[n] === family))];
    if (value === null) return inFamily.length === 1 ? inFamily[0]! : inFamily.length > 1 ? 'CONFLICT' : null;
    if (value === 'OTHER' || FAMILY[value] !== family) return 'OTHER';
    if (inFamily.includes(value)) return value;
    if (inFamily.length) return 'CONFLICT';
    return MAINNETS.has(value) ? null : value;
  };
  const pairs = ['Base Sepolia → Arbitrum Sepolia', 'Base → Arbitrum One'];
  let source = side(a.sourceNetwork, 'base'), destination = side(a.destinationNetwork, 'arbitrum');
  if (source === 'OTHER' || destination === 'OTHER') refuse(m.routerRoutes);
  if (source === 'CONFLICT' || destination === 'CONFLICT') ask(['sourceNetwork', 'destinationNetwork'], m.whichRoute, pairs);
  // V1: a test-network pair may complete itself; a mainnet side never implies the other one. V2 asks instead.
  if (g.policy.networkDefaults && source === null && destination === 'ARBITRUM_SEPOLIA') { source = 'BASE_SEPOLIA'; notes.push(m.routerSourceNote); }
  if (g.policy.networkDefaults && destination === null && source === 'BASE_SEPOLIA') { destination = 'ARBITRUM_SEPOLIA'; notes.push(m.routerDestinationNote); }
  const missing: CopilotMissingField[] = [...(a.amount === null ? ['amount' as const] : []), ...(a.asset === null ? ['asset' as const] : []),
    ...(source === null ? ['sourceNetwork' as const] : []), ...(destination === null ? ['destinationNetwork' as const] : [])];
  // Only the counterpart that forms a supported pair is offered.
  if (missing.length) ask(missing, stillNeeds(m, missing, 'bridge'), source === null && destination === null ? pairs
    : source === null ? [destination === 'ARBITRUM_SEPOLIA' ? 'Base Sepolia' : 'Base'] : destination === null ? [source === 'BASE_SEPOLIA' ? 'Arbitrum Sepolia' : 'Arbitrum One'] : []);
  const src = source as Network, dst = destination as Network;
  const network = src === 'BASE' && dst === 'ARBITRUM' ? 'mainnet' : src === 'BASE_SEPOLIA' && dst === 'ARBITRUM_SEPOLIA' ? 'testnet' : null;
  if (!network) return ask(['sourceNetwork', 'destinationNetwork'], m.routerMixed, pairs);
  if (network === 'mainnet' && (!named.includes('BASE') || !named.includes('ARBITRUM') || TESTNET_WORDS.test(text))) ask(['sourceNetwork', 'destinationNetwork'], m.routerRealFunds, pairs);
  if (network === 'testnet' && !named.includes(src) && !named.includes(dst)) ask(['sourceNetwork', 'destinationNetwork'], m.whichRoute, pairs);
  const asset = needAsset(a.asset, g, 'bridge', 'asset');
  if (asset !== 'USDC') refuse(m.routerUsdcOnly);
  const amount = amountOf(a.amount, g, 'bridge');
  const profile = ROUTER_NETWORK_OPTIONS[network].profile;
  const slippage = slippageOf(a.slippageBps, ROUTER_DEFAULT_SLIPPAGE, g, notes, profile.maximumSlippageBps);
  const routingNamed = g.carried.has('routing');
  if (a.routing === 'LIFI' && !routingNamed && !/li\.?\s?fi/i.test(text)) ask([], m.whichRouting, m.routingOptions);
  if (a.routing === 'ACROSS' && !routingNamed && !/\bacross\b/i.test(text)) ask([], m.whichRouting, m.routingOptions);
  const routing = a.routing === 'LIFI' ? 'LI.FI' : a.routing === 'ACROSS' ? 'Across' : 'auto';
  if (routing === 'auto') notes.push(m.autoRoutingNote);
  const recipient = addressOf(a.recipient, g, 'recipient');
  if (!recipient) notes.push(m.connectedRecipientNote);
  if (network === 'mainnet') notes.push(m.mainnetFundsNote);
  return { sentence: `bridge ${amount} USDC from ${src === 'BASE' ? 'Base' : 'Base Sepolia'} to ${dst === 'ARBITRUM' ? 'Arbitrum' : 'Arbitrum Sepolia'}` +
    `${recipient ? ' to ' + recipient : ''} via ${routing} slippage ${slippage} bps`, expect: 'ADD_ROUTER_BRIDGE', notes };
}

const LENDING_SUBJECT = { SUPPLY: 'supply', BORROW: 'borrow', REPAY: 'repay', WITHDRAW: 'withdraw' } as const;
function planLending(a: CopilotLendingAction, g: Grounding, wallet: string | null): Plan {
  const m = copyOf(g), notes: string[] = [], subject = LENDING_SUBJECT[a.type];
  const missing: CopilotMissingField[] = [...(a.amount === null ? ['amount' as const] : []), ...(a.asset === null ? ['asset' as const] : [])];
  // BUILD-ETHEREUM-001: each Aave asset has exactly one deployment (USDC on Base Sepolia, WBTC on Ethereum Sepolia), so the asset bounds the network.
  if (missing.length) ask(missing, stillNeeds(m, missing, subject), !missing.includes('asset') ? [] : a.network === 'ETHEREUM_SEPOLIA' ? ['WBTC']
    : a.network === 'BASE_SEPOLIA' ? ['USDC'] : ['USDC', 'WBTC']);
  const network = resolveNetwork(a.network, a.asset === 'WBTC' ? ['ETHEREUM_SEPOLIA'] : ['BASE_SEPOLIA'], g, 'aave', notes);
  const asset = needAsset(a.asset, g, subject, 'asset');
  if (asset !== 'USDC' && asset !== 'WBTC') refuse(m.aaveOnly);
  const amount = amountOf(a.amount, g, subject), on = COPILOT_NETWORK_LABEL[network];
  if (a.type === 'WITHDRAW') {
    if (a.beneficiary !== null) refuse(m.withdrawToWallet);
    notes.push(m.connectedRecipientNote);
    return { sentence: `withdraw ${amount} ${asset} from Aave on ${on}`, expect: 'ADD_WITHDRAW', notes };
  }
  const beneficiary = addressOf(a.beneficiary, g, 'beneficiary');
  if (!beneficiary && !wallet) ask(['beneficiary'], stillNeeds(m, ['beneficiary'], subject));
  if (!beneficiary) notes.push(m.beneficiaryNote(wallet!));
  const suffix = beneficiary ? ` beneficiary ${beneficiary}` : '';
  return a.type === 'SUPPLY' ? { sentence: `supply ${amount} ${asset} to Aave on ${on}${suffix}`, expect: 'ADD_SUPPLY', notes }
    : a.type === 'BORROW' ? { sentence: `borrow ${amount} ${asset} from Aave on ${on}${suffix}`, expect: 'ADD_BORROW', notes }
    : { sentence: `repay ${amount} ${asset} to Aave on ${on}${suffix}`, expect: 'ADD_REPAY', notes };
}

export const COPILOT_POOLS = Object.freeze({
  UNISWAP_V3: { network: 'BASE_SEPOLIA' as const, base: 'WETH', quote: 'USDC', first: 'USDC', second: 'WETH', expect: 'ADD_UNISWAP_LIQUIDITY' as const,
    slippage: UNISWAP_LIQUIDITY_DEFAULT_SLIPPAGE, symbol: (asset: string) => asset === 'USDC' ? 'USDC' : asset === 'WETH' || asset === 'ETH' ? 'WETH' : null },
  ORCA: { network: 'SOLANA_DEVNET' as const, base: 'SOL', quote: 'devUSDC', first: 'SOL', second: 'devUSDC', expect: 'ADD_SOLANA_LIQUIDITY' as const,
    slippage: SOLANA_LIQUIDITY_DEFAULT_SLIPPAGE, symbol: (asset: string) => asset === 'SOL' ? 'SOL' : asset === 'DEVUSDC' || asset === 'USDC' ? 'devUSDC' : null },
});
function planLiquidity(a: CopilotLiquidityAction, g: Grounding): Plan {
  const m = copyOf(g), notes: string[] = [], text = g.text;
  const named = (source: string) => (['UNISWAP_V3', 'ORCA'] as const).filter(p => (p === 'UNISWAP_V3' ? /uniswap/i : /\borca\b|whirlpool/i).test(source) ||
    (g.carried.has('protocol') && a.protocol === p));
  const answered = g.latest === undefined ? [] : named(g.latest);
  const namedProtocols = answered.length === 1 ? answered : named(text);
  if (namedProtocols.length > 1) ask(['protocol'], m.whichPool, m.poolOptions);
  // The protocol is trusted only when the user named it or the named network determines it. Uniswap v3 runs on two test
  // networks (BUILD-ETHEREUM-001), so it never defaults to one of them.
  const uniswap: Network[] = [COPILOT_POOLS.UNISWAP_V3.network, 'ETHEREUM_SEPOLIA'];
  const supported: Network[] = namedProtocols.length ? namedProtocols[0] === 'UNISWAP_V3' ? uniswap : [COPILOT_POOLS.ORCA.network] : [...uniswap, COPILOT_POOLS.ORCA.network];
  const network = resolveNetwork(a.network, supported, g, 'liquidity', notes);
  const protocol = network === COPILOT_POOLS.ORCA.network ? 'ORCA' : 'UNISWAP_V3';
  if (a.protocol !== null && a.protocol !== protocol) ask(['protocol'], m.whichPool, m.poolOptions);
  const pool = COPILOT_POOLS[protocol];
  const deposits = new Map<string, string>();
  for (const deposit of a.deposits) {
    const symbol = pool.symbol(deposit.asset);
    if (!symbol) refuse(m.poolTokens(pool.first, pool.second));
    if (deposits.has(symbol!)) reject('COPILOT_DUPLICATE_DEPOSIT', m.poolTokenOnce(pool.first, pool.second));
    needAsset(deposit.asset, g, 'liquidity', `deposit:${symbol}`);
    deposits.set(symbol!, amountOf(deposit.maxAmount, g, 'liquidity', `deposit:${symbol}`));
  }
  const missing: CopilotMissingField[] = [...(deposits.size < 2 ? ['amount' as const] : []),
    ...(a.rangeUnit === null || a.lower === null || a.upper === null ? ['range' as const] : [])];
  if (missing.length) ask(missing, m.liquidityNeeds(pool.first, pool.second, pool.quote, pool.base));
  const lower = a.lower!, upper = a.upper!;
  const grounded = g.carried.has('range') ? true : a.rangeUnit === 'PRICE' ? !lower.startsWith('-') && !upper.startsWith('-') && groundedAmount(text, lower) && groundedAmount(text, upper)
    : /^-?\d+$/.test(lower) && /^-?\d+$/.test(upper) && groundedSigned(text, lower) && groundedSigned(text, upper);
  if (!grounded) ask(['range'], m.rangeNotFound(pool.quote, pool.base));
  const slippage = slippageOf(a.slippageBps, pool.slippage, g, notes);
  const range = a.rangeUnit === 'PRICE' ? `from ${lower} to ${upper} ${pool.quote} per ${pool.base}` : `ticks ${lower} to ${upper}`;
  return { sentence: `add liquidity ${deposits.get(pool.first)} ${pool.first} and ${deposits.get(pool.second)} ${pool.second} ${range} on ` +
    `${COPILOT_NETWORK_LABEL[network]} slippage ${slippage} bps`, expect: pool.expect, notes };
}

function planComposition(actions: readonly CopilotAction[], g: Grounding, wallet: string | null): Plan {
  const m = copyOf(g);
  if (actions.map(a => a.type).join('>') !== 'SUPPLY>BORROW>SWAP') return refuse(m.compositionUnsupported);
  const [supply, borrow, swap] = actions as [CopilotLendingAction, CopilotLendingAction, CopilotSwapAction];
  const notes: string[] = [];
  const missing: CopilotMissingField[] = [...(supply.amount === null || borrow.amount === null ? ['amount' as const] : []),
    ...(supply.asset === null || borrow.asset === null || swap.outputAsset === null ? ['asset' as const] : [])];
  if (missing.length) ask(missing, stillNeeds(m, missing, 'composition'));
  for (const network of new Set([supply.network, borrow.network, swap.network])) resolveNetwork(network, ['BASE_SEPOLIA'], g, 'composition', notes);
  if (needAsset(supply.asset, g, 'composition', 'asset') !== 'USDC' || needAsset(borrow.asset, g, 'composition', 'asset') !== 'USDC' ||
    (swap.inputAsset !== null && needAsset(swap.inputAsset, g, 'composition', 'inputAsset') !== 'USDC')) refuse(m.compositionUnsupported);
  if (!['WETH', 'ETH'].includes(needAsset(swap.outputAsset, g, 'composition', 'outputAsset'))) refuse(m.compositionUnsupported);
  const supplied = amountOf(supply.amount, g, 'composition', 'supplyAmount'), borrowed = amountOf(borrow.amount, g, 'composition', 'borrowAmount');
  if (swap.amount !== null && canonicalDecimal(swap.amount) !== canonicalDecimal(borrowed)) refuse(m.swapUsesBorrowed);
  const slippage = slippageOf(swap.slippageBps, '50', g, notes);
  const owners = [...new Set([supply.beneficiary, borrow.beneficiary].filter((v): v is string => v !== null).map(v => addressOf(v, g, 'beneficiary')!))];
  if (owners.length > 1) reject('COPILOT_OWNER_CONFLICT', m.sameOwner);
  if (!owners.length && !wallet) ask(['beneficiary'], stillNeeds(m, ['beneficiary'], 'composition'));
  if (!owners.length) notes.push(m.ownerNote(wallet!));
  if (swap.outputAsset === 'ETH') notes.push(m.compositionWethNote);
  notes.push(m.debtNote);
  return { sentence: `compose supply ${supplied} USDC to Aave then borrow ${borrowed} USDC then swap borrowed USDC to WETH on Base Sepolia slippage ${slippage} bps` +
    `${owners.length ? ' owner ' + owners[0] : ''}`, expect: 'AUTHOR_LENDING', notes };
}

const ROUTER_RANGES = (['testnet', 'mainnet'] as const).map(network => {
  const option = ROUTER_NETWORK_OPTIONS[network], decimals = option.pair.source.decimals;
  return `${option.sourceLabel} → ${option.destinationLabel} ${formatTokenAmount(option.pair.minimumAmount, decimals)}–${formatTokenAmount(option.pair.maximumAmount, decimals)} USDC`;
}).join('; ');
/** A closed rejection code with deterministic copy; unknown codes are named, never explained by the model. */
export function copilotRejection(code: string, language: CopilotLanguage = 'EN'): Extract<CopilotOutcome, { kind: 'REJECTED' }> {
  const m = copilotCopy(language);
  return { kind: 'REJECTED', code, message: m.rejection[code] ?? (code === 'ROUTER_AMOUNT_OUT_OF_RANGE' ? m.routerAmountRange(ROUTER_RANGES) : m.rejectedCode(code)) };
}

/**
 * One validated action (or the lending composition) → the canonical sentence Flofi would type, or the clarification,
 * refusal or rejection that stops it. Pure. Values come only from the grounding context.
 */
export function planCopilotActions(actions: readonly CopilotAction[], composition: boolean, g: Grounding, wallet: string | null):
  { readonly kind: 'PLAN'; readonly plan: Plan } | Exclude<CopilotOutcome, { kind: 'PROPOSAL' }> {
  try {
    if (composition) return { kind: 'PLAN', plan: planComposition(actions, g, wallet) };
    const action = actions[0]!;
    return { kind: 'PLAN', plan: action.type === 'SWAP' ? planSwap(action, g) : action.type === 'BRIDGE' ? planBridge(action, g)
      : action.type === 'LIQUIDITY' ? planLiquidity(action, g) : planLending(action, g, wallet) };
  } catch (cause) {
    if (cause instanceof Stop) return cause.outcome as Exclude<CopilotOutcome, { kind: 'PROPOSAL' }>;
    return copilotRejection('COPILOT_CONVERSION_FAILED', g.policy.language);
  }
}
/** The canonical sentence → the exact grammar → the planned authoring Command at the current revision, or a rejection. */
export function proposalFromPlan(plan: Plan, input: Omit<CopilotConversion, 'userText'>, language: CopilotLanguage = 'EN'): CopilotOutcome {
  let command: Command;
  try { command = parseLocalCommand(plan.sentence, input.workflow, input.context, input.wallet); }
  catch (cause) {
    const code = cause instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(cause.message) ? cause.message : 'COPILOT_SENTENCE_UNMATCHED';
    return copilotRejection(code, language);
  }
  // Defense in depth: the sentence must have produced exactly the planned authoring command at the current revision.
  if (command.type !== plan.expect || command.source !== 'CHAT' || command.baseRevision !== input.workflow.revision) return copilotRejection('COPILOT_COMMAND_MISMATCH', language);
  return { kind: 'PROPOSAL', command, sentence: plan.sentence, notes: [...new Set(plan.notes)] };
}

/**
 * Untrusted intent → existing typed `Command`, or a clarification / unsupported / rejected outcome. Pure: it reads the
 * workflow only for its revision and the existing grammar's checks, and never mutates state. `userText` is the user's
 * own messages in the current clarification thread, used for grounding.
 */
export function copilotIntentToCommand(raw: unknown, input: CopilotConversion): CopilotOutcome {
  let intent;
  try { intent = parseCopilotIntent(raw); } catch (cause) { return copilotRejection(cause instanceof CopilotIntentError ? cause.message : 'COPILOT_INTENT_INVALID'); }
  const text = typeof input.userText === 'string' ? input.userText : '';
  const m = copilotCopy('EN');
  if (intent.kind === 'UNSUPPORTED') return { kind: 'UNSUPPORTED', message: safeCopilotProse(intent.reason) ?? m.cannotAuthor };
  if (intent.kind === 'CLARIFICATION_REQUIRED') return { kind: 'CLARIFICATION', missing: intent.missing,
    question: safeCopilotProse(intent.question) ?? stillNeeds(m, intent.missing.length ? intent.missing : ['amount'], 'request'),
    options: intent.options.flatMap(option => safeCopilotProse(option) ?? []) };
  const planned = planCopilotActions(intent.kind === 'COMPOSITION' ? intent.actions : [intent.action], intent.kind === 'COMPOSITION',
    { text, carried: NOTHING_CARRIED, policy: V1_POLICY }, input.wallet);
  return planned.kind === 'PLAN' ? proposalFromPlan(planned.plan, input) : planned;
}
