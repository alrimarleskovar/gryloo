// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: the closed inputs an owner submits for delegated execution. No additional property anywhere; amounts are exact
 * decimal strings converted to native units with the registry's decimals; semantic checks follow the schema.
 *
 *   DelegatedAutomationInput   a schedule or a price condition, an ordered workflow of 1–4 executable steps (any supported network, EVM
 *                              and Solana mixed), per-asset limits with mandatory cumulative budgets, executions per period, cooldown,
 *                              slippage cap and a mandatory expiry (≤ 366 days). Mode is implied: this input exists only for
 *                              DELEGATED_WITH_LIMITS; CONFIRM_EACH_TIME keeps its own schema.
 *   CanonicalDelegatedSource   the canonical `AutomationInput` (Automations form, chat draft) + the owner's delegation terms; compiled by
 *                              `automation-source.ts` into the input above, so every surface yields the same rule and workflow hash.
 *   CredentialInput            one proven wallet's grant on one chain: the token pairs (EVM) or token amounts (Solana) it may serve,
 *                              per-call caps, number of calls, expiry, and the passkey it anchors.
 */
import { Type, type Static } from '@sinclair/typebox';
import { compileSchema } from '../engine/strategy-spec';

const strict = { additionalProperties: false } as const;
const literalUnion = <T extends readonly string[]>(values: T) => Type.Union(values.map(v => Type.Literal(v)) as never) as unknown as ReturnType<typeof Type.String> & { static: T[number] };
const Decimal = Type.String({ pattern: '^(0|[1-9][0-9]{0,29})(\\.[0-9]{1,18})?$', maxLength: 48 });
const Price = Type.String({ pattern: '^(0|[1-9][0-9]{0,11})(\\.[0-9]{1,8})?$', maxLength: 24 });
const Percent = Type.String({ pattern: '^(0|[1-9][0-9]{0,3})(\\.[0-9]{1,2})?$', maxLength: 8 });
const Iso = Type.String({ maxLength: 40, pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d{1,3})?)?Z$' });
const Period = literalUnion(['DAY', 'WEEK', 'MONTH'] as const);
const Asset = literalUnion(['ETH', 'BTC', 'SOL'] as const);
const Step = Type.Object({ asset: Asset, side: literalUnion(['BUY', 'SELL'] as const),
  network: literalUnion(['base', 'base-sepolia', 'ethereum-sepolia', 'solana', 'solana-devnet'] as const), amount: Decimal,
  slippageBps: Type.Integer({ minimum: 0, maximum: 1_000 }) }, strict);
const Schedule = Type.Object({ frequency: literalUnion(['DAILY', 'WEEKLY'] as const), weekday: Type.Union([Type.Integer({ minimum: 1, maximum: 7 }), Type.Null()]),
  time: Type.String({ pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' }), timezone: Type.String({ minLength: 1, maxLength: 64 }) }, strict);
const Condition = Type.Union([
  Type.Object({ type: literalUnion(['PRICE_BELOW', 'PRICE_ABOVE'] as const), asset: Asset, threshold: Price, checkEveryMinutes: Type.Integer({ minimum: 5, maximum: 1440 }) }, strict),
  Type.Object({ type: literalUnion(['PERCENT_DROP', 'PERCENT_RISE'] as const), asset: Asset, reference: Price, percent: Percent,
    checkEveryMinutes: Type.Integer({ minimum: 5, maximum: 1440 }) }, strict),
]);
const AssetLimit = Type.Object({ asset: Type.String({ minLength: 10, maxLength: 140 }), maxPerExecution: Decimal,
  budgets: Type.Array(Type.Object({ period: Period, amount: Decimal }, strict), { minItems: 1, maxItems: 3 }) }, strict);
const Limits = Type.Object({ assets: Type.Array(AssetLimit, { minItems: 0, maxItems: 8 }),
  maxExecutionsPerPeriod: Type.Union([Type.Object({ count: Type.Integer({ minimum: 1, maximum: 1000 }), period: Period }, strict), Type.Null()]),
  cooldownMinutes: Type.Integer({ minimum: 0, maximum: 44_640 }), maxSlippageBps: Type.Integer({ minimum: 0, maximum: 1_000 }) }, strict);
export const DelegatedAutomationInputSchema = Type.Object({
  version: Type.Literal(1), name: Type.String({ minLength: 1, maxLength: 80 }),
  trigger: Type.Union([Type.Object({ kind: Type.Literal('SCHEDULE'), schedule: Schedule }, strict),
    Type.Object({ kind: Type.Literal('PRICE'), timezone: Type.String({ minLength: 1, maxLength: 64 }), condition: Condition }, strict)]),
  steps: Type.Array(Step, { minItems: 1, maxItems: 4 }),
  limits: Limits,
  expiresAt: Iso,
}, strict);
export type DelegatedAutomationInput = Static<typeof DelegatedAutomationInputSchema>;
export const isDelegatedAutomationInput = compileSchema<DelegatedAutomationInput>(DelegatedAutomationInputSchema).check;

/**
 * The same delegated rule, sourced from the canonical `AutomationInput` (what the Automations form and the chat's grounded draft
 * produce) plus the delegation terms only the owner enters: limits and a mandatory expiry. `automation` is validated by the canonical
 * `validateAutomationInput`, never by a second schema.
 */
export const DelegationTermsSchema = Type.Object({ limits: Limits, expiresAt: Iso }, strict);
export type DelegationTerms = Static<typeof DelegationTermsSchema>;
export const CanonicalDelegatedSourceSchema = Type.Object({ version: Type.Literal(1), source: Type.Literal('AUTOMATION_INPUT'), automation: Type.Unknown(),
  terms: DelegationTermsSchema }, strict);
export type CanonicalDelegatedSource = Static<typeof CanonicalDelegatedSourceSchema>;
export const isCanonicalDelegatedSource = compileSchema<CanonicalDelegatedSource>(CanonicalDelegatedSourceSchema).check;

export const CredentialInputSchema = Type.Union([
  Type.Object({ mechanism: Type.Literal('EVM_ERC7710_METAMASK_V1_3'), walletAddress: Type.String({ pattern: '^0x[0-9a-f]{40}$' }),
    network: literalUnion(['base-sepolia', 'ethereum-sepolia'] as const),
    pairs: Type.Array(Type.Object({ input: literalUnion(['USDC', 'WETH'] as const), output: literalUnion(['USDC', 'WETH'] as const), perCallCap: Decimal }, strict), { minItems: 1, maxItems: 2 }),
    maxCalls: Type.Integer({ minimum: 2, maximum: 1000 }), expiresAt: Iso, passkeyId: Type.String({ pattern: '^psk_[a-z2-7]{26}$' }),
    label: Type.String({ minLength: 1, maxLength: 40 }) }, strict),
  Type.Object({ mechanism: Type.Literal('SOLANA_SPL_DELEGATE_V1'), walletAddress: Type.String({ pattern: '^[1-9A-HJ-NP-Za-km-z]{32,44}$' }),
    network: Type.Literal('solana-devnet'), tokens: Type.Array(Type.Object({ symbol: Type.Literal('devUSDC'), amount: Decimal }, strict), { minItems: 1, maxItems: 1 }),
    expiresAt: Iso, passkeyId: Type.String({ pattern: '^psk_[a-z2-7]{26}$' }), label: Type.String({ minLength: 1, maxLength: 40 }) }, strict),
]);
export type CredentialInput = Static<typeof CredentialInputSchema>;
export const isCredentialInput = compileSchema<CredentialInput>(CredentialInputSchema).check;
