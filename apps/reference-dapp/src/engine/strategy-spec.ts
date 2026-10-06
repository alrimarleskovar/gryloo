// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-001: the typed strategy contract of the deterministic engine facade (`strategy-engine.ts`).
 *
 * A strategy spec is structured intent — action, network names, asset symbols, decimal amounts and the user's own
 * parameters. It never carries a chain id, contract or token address, adapter, calldata, nonce, signature or key: FloFi
 * resolves every network and asset to its registered profile, exactly as chat and canvas authoring do. The schema is
 * closed (no additional properties anywhere) and versioned (`version: 1`); a client carries the spec between calls and
 * FloFi re-derives the canonical Semantic Workflow IR from it each time.
 */
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { Ajv, type ErrorObject } from 'ajv';

/** Networks by stable MCP identifier. Chain ids come from the registries (see `capability-catalog.ts`). */
export const NETWORK_IDS = ['base', 'base-sepolia', 'arbitrum-one', 'arbitrum-sepolia', 'ethereum-sepolia', 'solana', 'solana-devnet'] as const;
export type NetworkId = (typeof NETWORK_IDS)[number];
export const STRATEGY_ACTIONS = ['bridge', 'swap', 'supply', 'borrow', 'repay', 'withdraw', 'add_liquidity', 'lending_composition'] as const;
export type StrategyAction = (typeof STRATEGY_ACTIONS)[number];
export const ASSET_SYMBOLS = ['USDC', 'WETH', 'WBTC', 'SOL', 'USDT', 'devUSDC'] as const;

const enumOf = <T extends readonly string[]>(values: T, description: string) =>
  Type.Union(values.map(value => Type.Literal(value)) as never, { description }) as unknown as TSchema & { static: T[number] };
const Decimal = (description: string) => Type.String({ pattern: '^(0|[1-9][0-9]{0,29})(\\.[0-9]{1,18})?$', maxLength: 48, description });
const EvmAddress = (description: string) => Type.String({ pattern: '^0x[0-9a-fA-F]{40}$', minLength: 42, maxLength: 42, description });
const Slippage = Type.Integer({ minimum: 0, maximum: 10_000, description: 'Maximum slippage in basis points. Omit to use FloFi\'s documented default for the action; each action enforces its own maximum.' });
const Version = Type.Literal(1, { description: 'Strategy contract version. Omit or 1.' });
const strict = { additionalProperties: false } as const;

const Bridge = Type.Object({
  version: Type.Optional(Version), action: Type.Literal('bridge'),
  sourceNetwork: enumOf(['base-sepolia', 'base'] as const, 'Source network. base-sepolia pairs with arbitrum-sepolia (test USDC); base pairs with arbitrum-one (real funds).'),
  destinationNetwork: enumOf(['arbitrum-sepolia', 'arbitrum-one'] as const, 'Destination network.'),
  asset: Type.Literal('USDC', { description: 'The Cross-chain Router moves USDC only.' }),
  amount: Decimal('USDC amount as a decimal string, e.g. "5".'),
  routing: Type.Optional(enumOf(['auto', 'lifi', 'across'] as const, 'Provider policy. auto = LI.FI first, direct Across if LI.FI has no reconcilable route (a preference order, not a best-price search). Default auto.')),
  slippageBps: Type.Optional(Slippage),
  recipient: Type.Optional(EvmAddress('Destination recipient. Omit to deliver to the wallet that signs in the FloFi app (bound at Review).')),
}, strict);
const Swap = Type.Object({
  version: Type.Optional(Version), action: Type.Literal('swap'),
  network: enumOf(['base', 'base-sepolia', 'ethereum-sepolia', 'solana', 'solana-devnet'] as const, 'EVM networks swap USDC/WETH on Uniswap v3; solana swaps SOL/USDC/USDT via Jupiter; solana-devnet swaps SOL/devUSDC on Orca.'),
  inputAsset: enumOf(ASSET_SYMBOLS, 'Asset spent.'), outputAsset: enumOf(ASSET_SYMBOLS, 'Asset received.'),
  amount: Decimal('Exact input amount as a decimal string.'), slippageBps: Type.Optional(Slippage),
}, strict);
const Lending = (action: 'supply' | 'borrow' | 'repay', who: string) => Type.Object({
  version: Type.Optional(Version), action: Type.Literal(action),
  network: enumOf(['base-sepolia', 'ethereum-sepolia'] as const, 'Aave V3 network: base-sepolia lends test USDC, ethereum-sepolia lends test WBTC.'),
  asset: enumOf(['USDC', 'WBTC'] as const, 'Must be the network\'s one Aave asset.'),
  amount: Decimal('Amount as a decimal string.'),
  beneficiary: EvmAddress(who),
}, strict);
const Withdraw = Type.Object({
  version: Type.Optional(Version), action: Type.Literal('withdraw'),
  network: enumOf(['base-sepolia', 'ethereum-sepolia'] as const, 'Aave V3 network.'), asset: enumOf(['USDC', 'WBTC'] as const, 'The network\'s one Aave asset.'),
  amount: Decimal('Amount as a decimal string. The recipient is always the wallet that signs.'),
}, strict);
const Liquidity = Type.Object({
  version: Type.Optional(Version), action: Type.Literal('add_liquidity'),
  network: enumOf(['base-sepolia', 'ethereum-sepolia', 'solana-devnet'] as const, 'Uniswap v3 USDC/WETH on base-sepolia or ethereum-sepolia; Orca SOL/devUSDC on solana-devnet.'),
  maxAmounts: Type.Object({ USDC: Type.Optional(Decimal('Maximum USDC.')), WETH: Type.Optional(Decimal('Maximum WETH.')),
    SOL: Type.Optional(Decimal('Maximum SOL.')), devUSDC: Type.Optional(Decimal('Maximum devUSDC.')) },
  { ...strict, minProperties: 2, maxProperties: 2, description: 'Maximum deposit of each pool asset (limits, not amounts to spend); exactly the network\'s two assets.' }),
  range: Type.Object({ unit: enumOf(['price', 'tick'] as const, 'price: quote per base asset (USDC per WETH, devUSDC per SOL); tick: aligned tick indexes.'),
    lower: Type.String({ pattern: '^-?(0|[1-9][0-9]{0,29})(\\.[0-9]{1,18})?$', maxLength: 48 }),
    upper: Type.String({ pattern: '^-?(0|[1-9][0-9]{0,29})(\\.[0-9]{1,18})?$', maxLength: 48 }) }, strict),
  slippageBps: Type.Optional(Slippage),
}, strict);
const LendingComposition = Type.Object({
  version: Type.Optional(Version), action: Type.Literal('lending_composition'),
  network: Type.Literal('base-sepolia', { description: 'The composition runs on Base Sepolia only.' }),
  asset: Type.Literal('USDC', { description: 'Supplied and borrowed asset (Aave V3 test USDC).' }),
  supplyAmount: Decimal('USDC supplied to Aave.'), borrowAmount: Decimal('USDC borrowed from Aave; exactly this amount is swapped.'),
  outputAsset: Type.Literal('WETH', { description: 'The borrowed USDC is swapped to WETH on Uniswap v3.' }),
  slippageBps: Type.Optional(Slippage),
  owner: EvmAddress('The wallet that supplies, borrows and receives WETH. Debt remains after the swap.'),
}, strict);

const BRANCHES = Object.freeze({ bridge: Bridge, swap: Swap, supply: Lending('supply', 'Account credited with the supplied position.'),
  borrow: Lending('borrow', 'Account whose debt the borrow creates (onBehalfOf).'), repay: Lending('repay', 'Account whose debt is repaid (onBehalfOf).'),
  withdraw: Withdraw, add_liquidity: Liquidity, lending_composition: LendingComposition }) satisfies Readonly<Record<StrategyAction, TSchema>>;
export const StrategySpecSchema = Type.Union(Object.values(BRANCHES), { description: 'A FloFi strategy: structured intent only. FloFi maps it to registered profiles.' });
export type StrategySpec = Static<typeof StrategySpecSchema>;

/**
 * BUILD-MCP-002: the step-list contract (`version: 2`). A workflow is an ordered list of 1–8 steps, each a single-action strategy.
 * One step is exactly the v1 strategy (same normalization, same workflow hash): a single transaction is a one-step workflow.
 * Each step keeps its own isolated IR (FloFi's authoring rules keep every publicly executable capability alone in its workflow);
 * the workflow hash of several steps covers their ordered step hashes. Which sequences execute today is an execution-plan fact
 * (`MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED` until the sequential runner), never a schema change.
 */
export const MAX_WORKFLOW_STEPS = 8;
export const StrategyWorkflowSchema = Type.Object({
  version: Type.Literal(2, { description: 'Step-list workflow contract.' }),
  steps: Type.Array(Type.Union(Object.values(BRANCHES)), { minItems: 1, maxItems: MAX_WORKFLOW_STEPS,
    description: 'Ordered steps, each one single-action strategy (the same objects as version 1). Executed in this order, each with its own review and signature.' }),
}, strict);
export type StrategyWorkflow = Static<typeof StrategyWorkflowSchema>;
/** What a client may send: a v1 single-action strategy or a v2 step list. */
export const StrategyInputSchema = Type.Union([...Object.values(BRANCHES), StrategyWorkflowSchema],
  { description: 'A FloFi strategy (version 1, one action) or workflow (version 2, ordered steps): structured intent only.' });
export type StrategyInput = StrategySpec | StrategyWorkflow;
export const isStrategyWorkflow = (value: StrategyInput): value is StrategyWorkflow => (value as { version?: unknown }).version === 2;

const ajv = new Ajv({ strict: true, allErrors: true, coerceTypes: false, removeAdditional: false, useDefaults: false, ownProperties: true });
/** A schema violation as a path and a rule; never the offending value. */
export type SchemaIssue = { readonly path: string; readonly rule: string };
// An unexpected key is named only when it looks like a plain field name, so a secret pasted as a key is never echoed.
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
function issueOf(error: ErrorObject): SchemaIssue {
  // `additionalProperty` comes from the input (named only when it looks like a field); `missingProperty` comes from the schema.
  const key = error.keyword === 'additionalProperties' ? (error.params as { additionalProperty?: unknown }).additionalProperty
    : error.keyword === 'required' ? (error.params as { missingProperty?: unknown }).missingProperty : undefined;
  return { path: (error.instancePath || '') + (typeof key === 'string' && FIELD_NAME.test(key) ? `/${key}` : '') || '/', rule: error.keyword };
}
const unique = (issues: readonly SchemaIssue[]) => [...new Map(issues.map(i => [`${i.path}\0${i.rule}`, i])).values()];
/** One compiled validator per schema object, shared by the facade and the MCP tool adapters. */
export function compileSchema<T>(schema: TSchema): { readonly check: (value: unknown) => value is T; readonly issues: (value: unknown) => readonly SchemaIssue[] } {
  const validate = ajv.compile<T>(schema);
  return { check: (value): value is T => validate(value), issues: value => validate(value) ? [] : unique((validate.errors ?? []).map(issueOf)) };
}
const union = compileSchema<StrategySpec>(StrategySpecSchema);
const inputUnion = compileSchema<StrategyInput>(StrategyInputSchema);
const branches = Object.fromEntries(Object.entries(BRANCHES).map(([action, schema]) => [action, compileSchema<StrategySpec>(schema)])) as
  Readonly<Record<StrategyAction, ReturnType<typeof compileSchema<StrategySpec>>>>;
export const isStrategySpec = union.check;
/** Every violation of a strategy spec, reported against its own action's schema (not the whole union). */
export function strategySpecIssues(value: unknown): readonly SchemaIssue[] {
  if (union.check(value)) return [];
  const action = value && typeof value === 'object' && !Array.isArray(value) ? (value as { action?: unknown }).action : undefined;
  if (typeof action !== 'string' || !Object.hasOwn(branches, action)) return [{ path: '/action', rule: 'enum' }];
  return branches[action as StrategyAction].issues(value);
}

export const isStrategyInput = inputUnion.check;
/** Every violation of a v1 strategy or a v2 workflow; a step is reported against its own action's schema at `/steps/<i>`. */
export function strategyInputIssues(value: unknown): readonly SchemaIssue[] {
  if (inputUnion.check(value)) return [];
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as { version?: unknown; steps?: unknown } : null;
  if (record?.version !== 2) return strategySpecIssues(value);
  const extra = Object.keys(record).filter(k => k !== 'version' && k !== 'steps');
  if (extra.length) return [{ path: '/', rule: 'additionalProperties' }];
  if (!Array.isArray(record.steps)) return [{ path: '/steps', rule: 'type' }];
  if (record.steps.length < 1 || record.steps.length > MAX_WORKFLOW_STEPS) return [{ path: '/steps', rule: record.steps.length < 1 ? 'minItems' : 'maxItems' }];
  return record.steps.flatMap((step, i) => strategySpecIssues(step).map(issue => ({ path: `/steps/${i}` + (issue.path === '/' ? '' : issue.path), rule: issue.rule })));
}
