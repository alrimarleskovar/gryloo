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

/**
 * BUILD-COPILOT-001: the deterministic boundary between an untrusted AI intent and the existing authoring path.
 * An intent becomes a proposal only by rendering one canonical exact-grammar sentence from validated, grounded fields
 * and parsing it with `parseLocalCommand`, so the Copilot can never author anything a user could not type.
 * Grounding: every amount, slippage, range bound and address must appear in the user's own words; every asset must be
 * named; a mainnet must be named explicitly with no test-network wording. Anything else becomes a clarification.
 */
export type CopilotOutcome =
  | { readonly kind: 'PROPOSAL'; readonly command: Command; readonly sentence: string; readonly notes: readonly string[] }
  | { readonly kind: 'CLARIFICATION'; readonly missing: readonly CopilotMissingField[]; readonly question: string; readonly options: readonly string[] }
  | { readonly kind: 'UNSUPPORTED'; readonly message: string }
  | { readonly kind: 'REJECTED'; readonly code: string; readonly message: string };
export type CopilotConversion = { readonly userText: string; readonly workflow: Workflow; readonly context: ReviewContext; readonly wallet: string | null };
/** The only Command types an AI interpretation can produce: new authoring proposals, never edits, removals or execution. */
export const COPILOT_AUTHORING_COMMANDS = Object.freeze(['ADD_SWAP', 'ADD_TESTNET_SWAP', 'ADD_SOLANA_SWAP', 'ADD_ROUTER_BRIDGE', 'ADD_SUPPLY', 'ADD_BORROW',
  'ADD_REPAY', 'ADD_WITHDRAW', 'ADD_UNISWAP_LIQUIDITY', 'ADD_SOLANA_LIQUIDITY', 'AUTHOR_LENDING'] as const);
export const COPILOT_CAPABILITIES = 'Flofi Copilot can author: swaps on Base, Base Sepolia, Solana and Solana Devnet; Cross-chain Router USDC bridges ' +
  '(Base → Arbitrum One, Base Sepolia → Arbitrum Sepolia); Aave V3 Supply, Borrow, Repay and Withdraw of USDC on Base Sepolia; Uniswap v3 liquidity on ' +
  'Base Sepolia and Orca liquidity on Solana Devnet; and Supply → Borrow → Swap the borrowed USDC to WETH on Base Sepolia.';
const COMPOSITION_UNSUPPORTED = 'Flofi can combine steps only as Supply USDC → Borrow USDC → Swap the borrowed USDC to WETH (Aave V3, Base Sepolia). ' +
  'Other combinations cannot share one workflow yet: author each action on its own.';

type Network = Exclude<CopilotNetwork, 'OTHER'>;
type Family = 'base' | 'arbitrum' | 'solana';
const FAMILY: Readonly<Record<Network, Family>> = { BASE: 'base', BASE_SEPOLIA: 'base', ARBITRUM: 'arbitrum', ARBITRUM_SEPOLIA: 'arbitrum',
  SOLANA: 'solana', SOLANA_DEVNET: 'solana' };
export const COPILOT_NETWORK_LABEL: Readonly<Record<Network, string>> = { BASE: 'Base', BASE_SEPOLIA: 'Base Sepolia', ARBITRUM: 'Arbitrum One',
  ARBITRUM_SEPOLIA: 'Arbitrum Sepolia', SOLANA: 'Solana', SOLANA_DEVNET: 'Solana Devnet' };
const MAINNETS: ReadonlySet<CopilotNetwork> = new Set(['BASE', 'ARBITRUM', 'SOLANA']);
const MENTIONS: readonly (readonly [Network, RegExp])[] = [
  ['BASE_SEPOLIA', /\bbase[\s-]*sepolia\b/i], ['BASE', /\bbase\b(?![\s-]*sepolia)/i],
  ['ARBITRUM_SEPOLIA', /\barbitrum[\s-]*sepolia\b/i], ['ARBITRUM', /\barbitrum\b(?![\s-]*sepolia)/i],
  ['SOLANA_DEVNET', /\bsolana[\s-]*devnet\b/i], ['SOLANA', /\bsolana\b(?![\s-]*devnet)/i],
];
// Any test-network or test-token wording rules out a mainnet (real funds) interpretation.
const TESTNET_WORDS = /\b(?:sepolia|devnet|testnets?|test\s?net(?:work)?|test\s+(?:usdc|tokens?|funds?|sol|eth)|dev\s?usdc|teste|testes|de\s+teste)\b/i;
const ASSET_MENTIONS: Readonly<Record<Exclude<CopilotAsset, 'OTHER'>, RegExp>> = {
  // `\busdc` does not match inside "devUSDC": there is no word boundary between "v" and "U".
  USDC: /\busdc\b/i, DEVUSDC: /\b(?:dev\s?usdc|test\s?usdc)\b/i, WETH: /\bw?eth\b|\bether\b/i, ETH: /\bw?eth\b|\bether\b/i,
  SOL: /\bsol\b/i, USDT: /\b(?:usdt|tether)\b/i,
};

/** Networks the user named, in any language that uses the network names. */
export function mentionedNetworks(text: string): Network[] { return MENTIONS.filter(([, pattern]) => pattern.test(text)).map(([network]) => network); }
const canonicalDecimal = (value: string): string => {
  const [whole, fraction = ''] = value.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return whole!.replace(/^0+(?=\d)/, '') + (trimmed ? '.' + trimmed : '');
};
/** Every exact reading of one written number: 1.5 / 1,5 as decimals, 1,000 / 1.000 as grouped thousands, 1,000.50 and 1.000,50. */
function readings(token: string): string[] {
  const out: string[] = [];
  if (/^\d+(?:\.\d+)?$/.test(token)) out.push(token);
  if (/^\d+,\d+$/.test(token)) out.push(token.replace(',', '.'));
  if (/^\d{1,3}(?:\.\d{3})+$/.test(token) || /^\d{1,3}(?:,\d{3})+$/.test(token)) out.push(token.replace(/[.,]/g, ''));
  if (/^\d{1,3}(?:,\d{3})+\.\d+$/.test(token)) out.push(token.replace(/,/g, ''));
  if (/^\d{1,3}(?:\.\d{3})+,\d+$/.test(token)) out.push(token.replace(/\./g, '').replace(',', '.'));
  return out.map(canonicalDecimal);
}
type Reading = { readonly value: string; readonly negative: boolean; readonly percent: boolean };
function numbersIn(text: string): Reading[] {
  // Digits inside addresses and other hex strings are not amounts.
  const clean = text.replace(/0x[0-9a-f]*/gi, ' ');
  const out: Reading[] = [];
  for (const match of clean.matchAll(/(?<![A-Za-z0-9_.,])\d(?:[\d.,]*\d)?/g)) {
    const before = clean[match.index - 1], after = clean.slice(match.index + match[0].length);
    for (const value of readings(match[0])) out.push({ value, negative: before === '-' || before === '−', percent: /^\s?%/.test(after) });
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
const FIELD_LABEL: Readonly<Record<CopilotMissingField, string>> = { amount: 'the amount', asset: 'the token', network: 'the network',
  sourceNetwork: 'the source network', destinationNetwork: 'the destination network', protocol: 'the protocol', range: 'the price range',
  slippage: 'the maximum slippage', beneficiary: 'a beneficiary (connect your wallet, or include the address in your message)', recipient: 'the recipient' };
const questionFor = (missing: readonly CopilotMissingField[], what: string) => `To prepare this ${what}, Flofi still needs ${missing.map(m => FIELD_LABEL[m]).join(', ')}.`;
const ask = (missing: CopilotMissingField[], question: string, options: readonly string[] = []): never => {
  throw new Stop({ kind: 'CLARIFICATION', missing, question, options });
};
const refuse = (message: string): never => { throw new Stop({ kind: 'UNSUPPORTED', message }); };
const reject = (code: string, message: string): never => { throw new Stop({ kind: 'REJECTED', code, message }); };
const labels = (networks: readonly Network[]) => networks.map(n => COPILOT_NETWORK_LABEL[n]);

/** A network can only default when it is the action's single, test-token deployment and the user named no other network of that family. */
function defaultNetwork(supported: readonly Network[], text: string): Network | null {
  const only = supported.length === 1 ? supported[0]! : null;
  return only && !MAINNETS.has(only) && !mentionedNetworks(text).some(n => FAMILY[n] === FAMILY[only]) ? only : null;
}
function resolveNetwork(value: CopilotNetwork | null, supported: readonly Network[], text: string, what: string, notes: string[]): Network {
  const named = mentionedNetworks(text), options = labels(supported);
  if (value === 'OTHER') return ask(['network'], `${what} is available in Flofi on ${options.join(', ')} only. Which network?`, options);
  let network: Network | null = value;
  if (network === null) { const candidates = supported.filter(n => named.includes(n)); network = candidates.length === 1 ? candidates[0]! : null; }
  if (network === null) {
    const fallback = defaultNetwork(supported, text);
    if (!fallback) return ask(['network'], `Which network should Flofi use for ${what}?`, options);
    notes.push(`${what} is available only on ${COPILOT_NETWORK_LABEL[fallback]} (test tokens), so Flofi used it.`);
    return fallback;
  }
  if (!supported.includes(network)) return ask(['network'], `${what} is available in Flofi on ${options.join(', ')} only. Which network?`, options);
  if (MAINNETS.has(network)) {
    // Real funds are never inferred: the user must name the mainnet and use no test-network wording.
    if (!named.includes(network) || TESTNET_WORDS.test(text)) return ask(['network'], `${COPILOT_NETWORK_LABEL[network]} uses real funds. Which network do you mean?`, options);
    return network;
  }
  if (named.includes(network)) return network;
  if (defaultNetwork(supported, text) !== network) return ask(['network'], `Which network should Flofi use for ${what}?`, options);
  notes.push(`${what} is available only on ${COPILOT_NETWORK_LABEL[network]} (test tokens), so Flofi used it.`);
  return network;
}
function amountOf(value: string | null, text: string, what: string): string {
  if (value === null) return ask(['amount'], questionFor(['amount'], what));
  if (!groundedAmount(text, value)) return ask(['amount'], `Flofi could not find the amount ${value} in your message. How much exactly? Write it in digits.`);
  return value;
}
function slippageOf(value: string | null, fallback: string, text: string, notes: string[], maximum?: number): string {
  if (value === null) { notes.push(`Slippage ${fallback} bps (Flofi default). Say, for example, "slippage 100 bps" to change it.`); return fallback; }
  if (!groundedBps(text, value)) return ask(['slippage'], `Flofi could not find the slippage ${value} bps in your message. What maximum slippage should it use?`);
  if (maximum !== undefined && Number(value) > maximum) return reject('COPILOT_SLIPPAGE_OUT_OF_RANGE', `Slippage must be at most ${maximum} bps for this action.`);
  return value;
}
function addressOf(value: string | null, text: string, field: 'beneficiary' | 'recipient'): string | null {
  if (value !== null && !groundedAddress(text, value)) return ask([field], `Flofi could not find that ${field} address in your message. Type the full address, or leave it out to use your connected wallet.`);
  return value;
}
function needAsset(value: CopilotAsset | null, text: string, what: string): Exclude<CopilotAsset, 'OTHER'> {
  if (value === null) return ask(['asset'], questionFor(['asset'], what));
  if (value === 'OTHER') return refuse(`That token is not supported for ${what}. ${COPILOT_CAPABILITIES}`);
  if (!assetNamed(text, value)) return ask(['asset'], `Flofi could not find the token ${value} in your message. Which token do you mean?`);
  return value;
}

type Plan = { readonly sentence: string; readonly expect: (typeof COPILOT_AUTHORING_COMMANDS)[number]; readonly notes: string[] };

function planSwap(a: CopilotSwapAction, text: string): Plan {
  const notes: string[] = [], supported: Network[] = ['BASE', 'BASE_SEPOLIA', 'SOLANA', 'SOLANA_DEVNET'];
  const missing: CopilotMissingField[] = [...(a.amount === null ? ['amount' as const] : []), ...(a.inputAsset === null || a.outputAsset === null ? ['asset' as const] : []),
    ...(a.network === null && !supported.some(n => mentionedNetworks(text).includes(n)) ? ['network' as const] : [])];
  if (missing.length) ask(missing, questionFor(missing, 'swap'), missing.length === 1 && missing[0] === 'network' ? labels(supported) : []);
  const network = resolveNetwork(a.network, supported, text, 'Swap', notes);
  const input = needAsset(a.inputAsset, text, 'this swap'), output = needAsset(a.outputAsset, text, 'this swap');
  const amount = amountOf(a.amount, text, 'swap');
  const slippage = slippageOf(a.slippageBps, '50', text, notes);
  if (FAMILY[network] === 'base') {
    const evm = (asset: string) => asset === 'USDC' ? 'USDC' : asset === 'WETH' || asset === 'ETH' ? 'WETH' : refuse('Flofi swaps USDC and WETH on Base and Base Sepolia.');
    const from = evm(input), to = evm(output);
    if (from === to) reject('INVALID_ASSET_PAIR', 'The input and output tokens must differ.');
    if (input === 'ETH' || output === 'ETH') notes.push('Flofi swaps the ERC-20 WETH (wrapped ETH), not native ETH.');
    return { sentence: `swap ${amount} ${from} to ${to} on ${COPILOT_NETWORK_LABEL[network]} slippage ${slippage} bps`,
      expect: network === 'BASE_SEPOLIA' ? 'ADD_TESTNET_SWAP' : 'ADD_SWAP', notes };
  }
  const devnet = network === 'SOLANA_DEVNET';
  const solana = (asset: string) => asset === 'SOL' ? 'SOL' : devnet ? (asset === 'DEVUSDC' || asset === 'USDC' ? 'devUSDC' : refuse('Solana Devnet swaps support SOL and devUSDC.'))
    : asset === 'USDC' || asset === 'USDT' ? asset : refuse('Solana swaps support SOL, USDC and USDT.');
  const from = solana(input), to = solana(output);
  if (from === to) reject('INVALID_ASSET_PAIR', 'The input and output tokens must differ.');
  return { sentence: `swap ${amount} ${from} to ${to} on ${devnet ? 'Solana Devnet' : 'Solana'} slippage ${slippage} bps`, expect: 'ADD_SOLANA_SWAP', notes };
}

function planBridge(a: CopilotBridgeAction, text: string): Plan {
  const notes: string[] = [], named = mentionedNetworks(text);
  // A side is the network the user named in that family; an unnamed test network is only a candidate, an unnamed mainnet is dropped.
  const side = (value: CopilotNetwork | null, family: Family): Network | null | 'OTHER' | 'CONFLICT' => {
    const inFamily = named.filter(n => FAMILY[n] === family);
    if (value === null) return inFamily.length === 1 ? inFamily[0]! : inFamily.length > 1 ? 'CONFLICT' : null;
    if (value === 'OTHER' || FAMILY[value] !== family) return 'OTHER';
    if (inFamily.includes(value)) return value;
    if (inFamily.length) return 'CONFLICT';
    return MAINNETS.has(value) ? null : value;
  };
  const pairs = ['Base Sepolia → Arbitrum Sepolia', 'Base → Arbitrum One'];
  let source = side(a.sourceNetwork, 'base'), destination = side(a.destinationNetwork, 'arbitrum');
  if (source === 'OTHER' || destination === 'OTHER') refuse('The Cross-chain Router bridges USDC from Base to Arbitrum One, or from Base Sepolia to Arbitrum Sepolia.');
  if (source === 'CONFLICT' || destination === 'CONFLICT') ask(['sourceNetwork', 'destinationNetwork'], 'Which route do you mean?', pairs);
  // A test-network pair may complete itself; a mainnet side never implies the other one.
  if (source === null && destination === 'ARBITRUM_SEPOLIA') { source = 'BASE_SEPOLIA'; notes.push('Source Base Sepolia: the only source for Arbitrum Sepolia.'); }
  if (destination === null && source === 'BASE_SEPOLIA') { destination = 'ARBITRUM_SEPOLIA'; notes.push('Destination Arbitrum Sepolia: the only destination from Base Sepolia.'); }
  const missing: CopilotMissingField[] = [...(a.amount === null ? ['amount' as const] : []), ...(a.asset === null ? ['asset' as const] : []),
    ...(source === null ? ['sourceNetwork' as const] : []), ...(destination === null ? ['destinationNetwork' as const] : [])];
  if (missing.length) ask(missing, questionFor(missing, 'bridge'), source === null && destination === null ? pairs
    : source === null ? ['Base'] : destination === null ? ['Arbitrum One'] : []);
  const src = source as Network, dst = destination as Network;
  const network = src === 'BASE' && dst === 'ARBITRUM' ? 'mainnet' : src === 'BASE_SEPOLIA' && dst === 'ARBITRUM_SEPOLIA' ? 'testnet' : null;
  if (!network) return ask(['sourceNetwork', 'destinationNetwork'], 'The Cross-chain Router does not mix mainnet and test networks. Which route do you mean?', pairs);
  if (network === 'mainnet' && (!named.includes('BASE') || !named.includes('ARBITRUM') || TESTNET_WORDS.test(text)))
    ask(['sourceNetwork', 'destinationNetwork'], 'Base → Arbitrum One uses real funds. Which route do you mean?', pairs);
  if (network === 'testnet' && !named.includes(src) && !named.includes(dst)) ask(['sourceNetwork', 'destinationNetwork'], 'Which route do you mean?', pairs);
  const asset = needAsset(a.asset, text, 'this bridge');
  if (asset !== 'USDC') refuse('The Cross-chain Router bridges USDC only.');
  const amount = amountOf(a.amount, text, 'bridge');
  const profile = ROUTER_NETWORK_OPTIONS[network].profile;
  const slippage = slippageOf(a.slippageBps, ROUTER_DEFAULT_SLIPPAGE, text, notes, profile.maximumSlippageBps);
  if (a.routing === 'LIFI' && !/li\.?\s?fi/i.test(text)) ask([], 'Should Flofi use LI.FI only, Across only, or automatic routing?', ['Automatic routing', 'LI.FI only', 'Across only']);
  if (a.routing === 'ACROSS' && !/\bacross\b/i.test(text)) ask([], 'Should Flofi use LI.FI only, Across only, or automatic routing?', ['Automatic routing', 'LI.FI only', 'Across only']);
  const routing = a.routing === 'LIFI' ? 'LI.FI' : a.routing === 'ACROSS' ? 'Across' : 'auto';
  if (routing === 'auto') notes.push('Routing: automatic (LI.FI first, Across direct if LI.FI has no reconcilable route).');
  const recipient = addressOf(a.recipient, text, 'recipient');
  if (!recipient) notes.push('Recipient: your connected wallet, bound at Review.');
  if (network === 'mainnet') notes.push(ROUTER_NETWORK_OPTIONS.mainnet.funds);
  return { sentence: `bridge ${amount} USDC from ${src === 'BASE' ? 'Base' : 'Base Sepolia'} to ${dst === 'ARBITRUM' ? 'Arbitrum' : 'Arbitrum Sepolia'}` +
    `${recipient ? ' to ' + recipient : ''} via ${routing} slippage ${slippage} bps`, expect: 'ADD_ROUTER_BRIDGE', notes };
}

function planLending(a: CopilotLendingAction, text: string, wallet: string | null): Plan {
  const notes: string[] = [], what = a.type === 'SUPPLY' ? 'Aave Supply' : a.type === 'BORROW' ? 'Aave Borrow' : a.type === 'REPAY' ? 'Aave Repay' : 'Aave Withdraw';
  const missing: CopilotMissingField[] = [...(a.amount === null ? ['amount' as const] : []), ...(a.asset === null ? ['asset' as const] : [])];
  if (missing.length) ask(missing, questionFor(missing, what), missing.includes('asset') ? ['USDC'] : []);
  resolveNetwork(a.network, ['BASE_SEPOLIA'], text, 'Aave V3', notes);
  const asset = needAsset(a.asset, text, what);
  if (asset !== 'USDC') refuse('Flofi supports Aave V3 with USDC only, on Base Sepolia.');
  const amount = amountOf(a.amount, text, what);
  if (a.type === 'WITHDRAW') {
    if (a.beneficiary !== null) refuse('An Aave withdrawal always pays your connected wallet; Flofi cannot send it to another address.');
    notes.push('Recipient: your connected wallet, bound at Review.');
    return { sentence: `withdraw ${amount} USDC from Aave on Base Sepolia`, expect: 'ADD_WITHDRAW', notes };
  }
  const beneficiary = addressOf(a.beneficiary, text, 'beneficiary');
  if (!beneficiary && !wallet) ask(['beneficiary'], questionFor(['beneficiary'], what));
  if (!beneficiary) notes.push(`Beneficiary: your connected wallet ${wallet}.`);
  const suffix = beneficiary ? ` beneficiary ${beneficiary}` : '';
  return a.type === 'SUPPLY' ? { sentence: `supply ${amount} USDC to Aave on Base Sepolia${suffix}`, expect: 'ADD_SUPPLY', notes }
    : a.type === 'BORROW' ? { sentence: `borrow ${amount} USDC from Aave on Base Sepolia${suffix}`, expect: 'ADD_BORROW', notes }
    : { sentence: `repay ${amount} USDC to Aave on Base Sepolia${suffix}`, expect: 'ADD_REPAY', notes };
}

const POOLS = Object.freeze({
  UNISWAP_V3: { network: 'BASE_SEPOLIA' as const, base: 'WETH', quote: 'USDC', first: 'USDC', second: 'WETH', expect: 'ADD_UNISWAP_LIQUIDITY' as const,
    slippage: UNISWAP_LIQUIDITY_DEFAULT_SLIPPAGE, symbol: (asset: string) => asset === 'USDC' ? 'USDC' : asset === 'WETH' || asset === 'ETH' ? 'WETH' : null },
  ORCA: { network: 'SOLANA_DEVNET' as const, base: 'SOL', quote: 'devUSDC', first: 'SOL', second: 'devUSDC', expect: 'ADD_SOLANA_LIQUIDITY' as const,
    slippage: SOLANA_LIQUIDITY_DEFAULT_SLIPPAGE, symbol: (asset: string) => asset === 'SOL' ? 'SOL' : asset === 'DEVUSDC' || asset === 'USDC' ? 'devUSDC' : null },
});
function planLiquidity(a: CopilotLiquidityAction, text: string): Plan {
  const notes: string[] = [];
  const namedProtocols = (['UNISWAP_V3', 'ORCA'] as const).filter(p => (p === 'UNISWAP_V3' ? /uniswap/i : /\borca\b|whirlpool/i).test(text));
  if (namedProtocols.length > 1) ask(['protocol'], 'Which pool do you mean?', ['Uniswap v3 on Base Sepolia', 'Orca on Solana Devnet']);
  // The protocol is trusted only when the user named it or the named network determines it.
  const supported: Network[] = namedProtocols.length ? [POOLS[namedProtocols[0]!].network] : ['BASE_SEPOLIA', 'SOLANA_DEVNET'];
  const network = resolveNetwork(a.network, supported, text, 'Concentrated liquidity', notes);
  const protocol = network === 'BASE_SEPOLIA' ? 'UNISWAP_V3' : 'ORCA';
  if (a.protocol !== null && a.protocol !== protocol) ask(['protocol'], 'Which pool do you mean?', ['Uniswap v3 on Base Sepolia', 'Orca on Solana Devnet']);
  const pool = POOLS[protocol];
  const deposits = new Map<string, string>();
  for (const deposit of a.deposits) {
    const symbol = pool.symbol(deposit.asset);
    if (!symbol) refuse(`This pool takes ${pool.first} and ${pool.second} only.`);
    if (deposits.has(symbol!)) reject('COPILOT_DUPLICATE_DEPOSIT', `Name each token of the pool once: ${pool.first} and ${pool.second}.`);
    needAsset(deposit.asset, text, 'this liquidity position');
    deposits.set(symbol!, amountOf(deposit.maxAmount, text, 'liquidity position'));
  }
  const missing: CopilotMissingField[] = [...(deposits.size < 2 ? ['amount' as const] : []),
    ...(a.rangeUnit === null || a.lower === null || a.upper === null ? ['range' as const] : [])];
  if (missing.length) ask(missing, `To prepare this liquidity position, Flofi still needs the maximum ${pool.first} and ${pool.second} amounts (0 for none) and ` +
    `a range: prices in ${pool.quote} per ${pool.base}, or ticks.`);
  const lower = a.lower!, upper = a.upper!;
  const grounded = a.rangeUnit === 'PRICE' ? !lower.startsWith('-') && !upper.startsWith('-') && groundedAmount(text, lower) && groundedAmount(text, upper)
    : /^-?\d+$/.test(lower) && /^-?\d+$/.test(upper) && groundedSigned(text, lower) && groundedSigned(text, upper);
  if (!grounded) ask(['range'], `Flofi could not find that range in your message. Which range: prices in ${pool.quote} per ${pool.base}, or ticks?`);
  const slippage = slippageOf(a.slippageBps, pool.slippage, text, notes);
  const range = a.rangeUnit === 'PRICE' ? `from ${lower} to ${upper} ${pool.quote} per ${pool.base}` : `ticks ${lower} to ${upper}`;
  return { sentence: `add liquidity ${deposits.get(pool.first)} ${pool.first} and ${deposits.get(pool.second)} ${pool.second} ${range} on ` +
    `${COPILOT_NETWORK_LABEL[network]} slippage ${slippage} bps`, expect: pool.expect, notes };
}

function planComposition(actions: readonly CopilotAction[], text: string, wallet: string | null): Plan {
  if (actions.map(a => a.type).join('>') !== 'SUPPLY>BORROW>SWAP') return refuse(COMPOSITION_UNSUPPORTED);
  const [supply, borrow, swap] = actions as [CopilotLendingAction, CopilotLendingAction, CopilotSwapAction];
  const notes: string[] = [], what = 'Supply → Borrow → Swap workflow';
  const missing: CopilotMissingField[] = [...(supply.amount === null || borrow.amount === null ? ['amount' as const] : []),
    ...(supply.asset === null || borrow.asset === null || swap.outputAsset === null ? ['asset' as const] : [])];
  if (missing.length) ask(missing, questionFor(missing, what));
  for (const network of new Set([supply.network, borrow.network, swap.network])) resolveNetwork(network, ['BASE_SEPOLIA'], text, 'The ' + what, notes);
  if (needAsset(supply.asset, text, what) !== 'USDC' || needAsset(borrow.asset, text, what) !== 'USDC' ||
    (swap.inputAsset !== null && needAsset(swap.inputAsset, text, what) !== 'USDC')) refuse(COMPOSITION_UNSUPPORTED);
  if (!['WETH', 'ETH'].includes(needAsset(swap.outputAsset, text, what))) refuse(COMPOSITION_UNSUPPORTED);
  const supplied = amountOf(supply.amount, text, what), borrowed = amountOf(borrow.amount, text, what);
  if (swap.amount !== null && canonicalDecimal(swap.amount) !== canonicalDecimal(borrowed)) refuse('The swap must use exactly the borrowed USDC. ' + COMPOSITION_UNSUPPORTED);
  const slippage = slippageOf(swap.slippageBps, '50', text, notes);
  const owners = [...new Set([supply.beneficiary, borrow.beneficiary].filter((v): v is string => v !== null).map(v => addressOf(v, text, 'beneficiary')!))];
  if (owners.length > 1) reject('COPILOT_OWNER_CONFLICT', 'Supply and Borrow must use the same owner.');
  if (!owners.length && !wallet) ask(['beneficiary'], questionFor(['beneficiary'], what));
  if (!owners.length) notes.push(`Owner: your connected wallet ${wallet}.`);
  if (swap.outputAsset === 'ETH') notes.push('Flofi swaps to the ERC-20 WETH (wrapped ETH), not native ETH.');
  notes.push('Debt remains after the swap. Review the health factor checkpoint before signing anything.');
  return { sentence: `compose supply ${supplied} USDC to Aave then borrow ${borrowed} USDC then swap borrowed USDC to WETH on Base Sepolia slippage ${slippage} bps` +
    `${owners.length ? ' owner ' + owners[0] : ''}`, expect: 'AUTHOR_LENDING', notes };
}

const REJECTION_MESSAGES: Readonly<Record<string, string>> = {
  INVALID_AMOUNT: 'The amount is not a valid positive number.', SUPPLY_AMOUNT_INVALID: 'The amount is not a valid positive USDC amount.',
  AMOUNT_PRECISION: 'The amount has more decimal places than the token supports.', AMOUNT_OUT_OF_RANGE: 'The amount is outside the range Flofi allows for this token.',
  INVALID_SLIPPAGE: 'The slippage is not valid.', INVALID_ASSET_PAIR: 'The input and output tokens must differ.',
  ROUTER_SLIPPAGE_OUT_OF_RANGE: 'The slippage is outside the range allowed for the Cross-chain Router.',
  SOLANA_SLIPPAGE_OUT_OF_RANGE: 'The slippage is above the maximum allowed for Solana swaps and liquidity.',
  UNISWAP_SLIPPAGE_OUT_OF_RANGE: 'The slippage is above the maximum allowed for Uniswap liquidity.',
  UNISWAP_LIQUIDITY_RANGE_INVALID: 'The range is not valid: the lower bound must be below the upper bound, and ticks must align to the pool spacing.',
  SOLANA_LIQUIDITY_RANGE_INVALID: 'The range is not valid: the lower bound must be below the upper bound, and ticks must align to the pool spacing.',
  UNISWAP_LIQUIDITY_ZERO: 'At least one deposit must be above zero.', SOLANA_LIQUIDITY_ZERO: 'At least one deposit must be above zero.',
  ROUTER_AMOUNT_OUT_OF_RANGE: 'The amount is outside the Cross-chain Router range: ' + (['testnet', 'mainnet'] as const).map(network => {
    const option = ROUTER_NETWORK_OPTIONS[network], decimals = option.pair.source.decimals;
    return `${option.sourceLabel} → ${option.destinationLabel} ${formatTokenAmount(option.pair.minimumAmount, decimals)}–${formatTokenAmount(option.pair.maximumAmount, decimals)} USDC`;
  }).join('; ') + '.',
  LENDING_INPUT_INVALID: 'The Supply → Borrow → Swap inputs are not valid: use positive USDC amounts and a slippage from 1 to 300 bps.',
  COPILOT_INTENT_INVALID: 'Flofi Copilot returned an interpretation Flofi could not validate. Nothing changed.',
  COPILOT_TOO_MANY_ACTIONS: 'Flofi Copilot returned more steps than a proposal may contain. Nothing changed.',
};
const rejected = (code: string): CopilotOutcome => ({ kind: 'REJECTED', code,
  message: REJECTION_MESSAGES[code] ?? `Flofi could not author this request (${code}). Nothing changed.` });

/**
 * Untrusted intent → existing typed `Command`, or a clarification / unsupported / rejected outcome. Pure: it reads the
 * workflow only for its revision and the existing grammar's checks, and never mutates state. `userText` is the user's
 * own messages in the current clarification thread, used for grounding.
 */
export function copilotIntentToCommand(raw: unknown, input: CopilotConversion): CopilotOutcome {
  let intent;
  try { intent = parseCopilotIntent(raw); } catch (cause) { return rejected(cause instanceof CopilotIntentError ? cause.message : 'COPILOT_INTENT_INVALID'); }
  const text = typeof input.userText === 'string' ? input.userText : '';
  if (intent.kind === 'UNSUPPORTED') return { kind: 'UNSUPPORTED', message: safeCopilotProse(intent.reason) ?? 'Flofi Copilot cannot author that request.' };
  if (intent.kind === 'CLARIFICATION_REQUIRED') return { kind: 'CLARIFICATION', missing: intent.missing,
    question: safeCopilotProse(intent.question) ?? questionFor(intent.missing.length ? intent.missing : ['amount'], 'request'),
    options: intent.options.flatMap(option => safeCopilotProse(option) ?? []) };
  let plan: Plan;
  try {
    if (intent.kind === 'COMPOSITION') plan = planComposition(intent.actions, text, input.wallet);
    else {
      const action = intent.action;
      plan = action.type === 'SWAP' ? planSwap(action, text) : action.type === 'BRIDGE' ? planBridge(action, text)
        : action.type === 'LIQUIDITY' ? planLiquidity(action, text) : planLending(action, text, input.wallet);
    }
  } catch (cause) {
    if (cause instanceof Stop) return cause.outcome;
    return rejected('COPILOT_CONVERSION_FAILED');
  }
  let command: Command;
  try { command = parseLocalCommand(plan.sentence, input.workflow, input.context, input.wallet); }
  catch (cause) {
    const code = cause instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(cause.message) ? cause.message : 'COPILOT_SENTENCE_UNMATCHED';
    return rejected(code);
  }
  // Defense in depth: the sentence must have produced exactly the planned authoring command at the current revision.
  if (command.type !== plan.expect || command.source !== 'CHAT' || command.baseRevision !== input.workflow.revision) return rejected('COPILOT_COMMAND_MISMATCH');
  return { kind: 'PROPOSAL', command, sentence: plan.sentence, notes: [...new Set(plan.notes)] };
}
