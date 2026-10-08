// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: the closed, versioned input an owner submits to create an automation, and its normalized stored form. The
 * schema admits no additional property anywhere; semantic checks (zone, weekday, threshold, limits, expiry) follow. Nothing here can
 * express an execution mode other than `CONFIRM_EACH_TIME`: there is no field for it.
 *
 *   SCHEDULED_DCA   a DAILY or WEEKLY schedule and a bound action (a swap route, or a saved single-swap workflow)
 *   PRICE_TRIGGER   a deterministic price condition checked every N minutes, and a bound action — or none ("notify me only")
 *   DAILY_WATCH     a schedule and 1–3 observed assets; FloFi reports what it observed and the owner decides (Buy / Sell / Ignore)
 */
import { Type, type Static } from '@sinclair/typebox';
import { compileSchema } from '../engine/strategy-spec';
import { AMOUNT_SCALE, parseScaled } from './decimal.ts';
import { assertLimits, NO_LIMITS, type Limits } from './limits.ts';
import { assertSchedule, validTimeZone, type Schedule } from './schedule.ts';
import { conditionThreshold, OBSERVED_ASSETS, type PriceCondition } from './trigger.ts';

export const AUTOMATION_KINDS = ['SCHEDULED_DCA', 'PRICE_TRIGGER', 'DAILY_WATCH'] as const;
export type AutomationKind = (typeof AUTOMATION_KINDS)[number];
export const EXECUTION_MODE = 'CONFIRM_EACH_TIME' as const;

const strict = { additionalProperties: false } as const;
const literalUnion = <T extends readonly string[]>(values: T) => Type.Union(values.map(v => Type.Literal(v)) as never) as unknown as ReturnType<typeof Type.String> & { static: T[number] };
const Decimal = Type.String({ pattern: '^(0|[1-9][0-9]{0,29})(\\.[0-9]{1,18})?$', maxLength: 48 });
const Price = Type.String({ pattern: '^(0|[1-9][0-9]{0,11})(\\.[0-9]{1,8})?$', maxLength: 24 });
const Percent = Type.String({ pattern: '^(0|[1-9][0-9]{0,3})(\\.[0-9]{1,2})?$', maxLength: 8 });
const Period = literalUnion(['DAY', 'WEEK', 'MONTH'] as const);
const Asset = literalUnion(OBSERVED_ASSETS);
const ScheduleInput = Type.Object({ frequency: literalUnion(['DAILY', 'WEEKLY'] as const), weekday: Type.Union([Type.Integer({ minimum: 1, maximum: 7 }), Type.Null()]),
  time: Type.String({ pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' }), timezone: Type.String({ minLength: 1, maxLength: 64 }) }, strict);
const LimitsInput = Type.Object({
  maxAmountPerExecution: Type.Union([Decimal, Type.Null()]),
  maxAmountPerPeriod: Type.Union([Type.Object({ amount: Decimal, period: Period }, strict), Type.Null()]),
  maxOccurrencesPerPeriod: Type.Union([Type.Object({ count: Type.Integer({ minimum: 1, maximum: 1000 }), period: Period }, strict), Type.Null()]),
  cooldownMinutes: Type.Integer({ minimum: 0, maximum: 44_640 }),
  maxSlippageBps: Type.Union([Type.Integer({ minimum: 0, maximum: 10_000 }), Type.Null()]),
}, strict);
const RouteAction = Type.Object({ kind: Type.Literal('ROUTE'), asset: Asset, side: literalUnion(['BUY', 'SELL'] as const),
  network: literalUnion(['base', 'base-sepolia', 'ethereum-sepolia', 'solana', 'solana-devnet'] as const), amount: Decimal,
  slippageBps: Type.Integer({ minimum: 0, maximum: 10_000 }) }, strict);
const SavedAction = Type.Object({ kind: Type.Literal('SAVED_WORKFLOW'), workflowId: Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' }) }, strict);
const ActionInput = Type.Union([RouteAction, SavedAction]);
const Condition = Type.Union([
  Type.Object({ type: literalUnion(['PRICE_BELOW', 'PRICE_ABOVE'] as const), asset: Asset, threshold: Price, checkEveryMinutes: Type.Integer({ minimum: 5, maximum: 1440 }) }, strict),
  Type.Object({ type: literalUnion(['PERCENT_DROP', 'PERCENT_RISE'] as const), asset: Asset, reference: Price, percent: Percent,
    checkEveryMinutes: Type.Integer({ minimum: 5, maximum: 1440 }) }, strict),
]);
const Name = Type.String({ minLength: 1, maxLength: 80 });
const Expiry = Type.Union([Type.String({ maxLength: 40, pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d{1,3})?)?Z$' }), Type.Null()]);
export const AutomationInputSchema = Type.Union([
  Type.Object({ version: Type.Literal(1), kind: Type.Literal('SCHEDULED_DCA'), name: Name, schedule: ScheduleInput, action: ActionInput, limits: LimitsInput, expiresAt: Expiry }, strict),
  Type.Object({ version: Type.Literal(1), kind: Type.Literal('PRICE_TRIGGER'), name: Name, timezone: Type.String({ minLength: 1, maxLength: 64 }), condition: Condition,
    action: Type.Union([ActionInput, Type.Null()]), limits: LimitsInput, expiresAt: Expiry }, strict),
  Type.Object({ version: Type.Literal(1), kind: Type.Literal('DAILY_WATCH'), name: Name, schedule: ScheduleInput,
    watch: Type.Object({ assets: Type.Array(Asset, { minItems: 1, maxItems: 3, uniqueItems: true }) }, strict), expiresAt: Expiry }, strict),
]);
export type AutomationInput = Static<typeof AutomationInputSchema>;
export type ActionRequest = Static<typeof ActionInput>;
const schema = compileSchema<AutomationInput>(AutomationInputSchema);

/** The normalized definition stored with a rule (`automation_rules.definition`). */
export type Definition = {
  readonly schedule: Schedule | null;
  readonly condition: (PriceCondition & { readonly checkEveryMinutes: number }) | null;
  readonly watch: { readonly assets: readonly (typeof OBSERVED_ASSETS)[number][] } | null;
  readonly limits: Limits;
};
export type ValidatedInput = { readonly kind: AutomationKind; readonly name: string; readonly timezone: string; readonly definition: Definition;
  readonly action: ActionRequest | null; readonly expiresAt: Date | null };
export const MAX_EXPIRY_MS = 2 * 366 * 86_400_000;
const nameOf = (raw: string) => {
  const name = raw.trim();
  if (!name || name.length > 80 || !name.isWellFormed() || [...name].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw new Error('AUTOMATION_NAME_INVALID');
  return name;
};
export const validName = (raw: unknown): raw is string => { try { return typeof raw === 'string' && Boolean(nameOf(raw)); } catch { return false; } };

/** The validated, normalized input, or a closed code (`AUTOMATION_INPUT_INVALID` for the schema, a specific code otherwise). */
export function validateAutomationInput(input: unknown, now: number): { readonly ok: true; readonly value: ValidatedInput } | { readonly ok: false; readonly code: string } {
  if (!schema.check(input)) return { ok: false, code: 'AUTOMATION_INPUT_INVALID' };
  try {
    const name = nameOf(input.name);
    let expiresAt: Date | null = null;
    if (input.expiresAt !== null) {
      const at = Date.parse(input.expiresAt);
      if (Number.isNaN(at) || at <= now || at - now > MAX_EXPIRY_MS) return { ok: false, code: 'AUTOMATION_EXPIRY_INVALID' };
      expiresAt = new Date(at);
    }
    if (input.kind === 'DAILY_WATCH') {
      const schedule = { ...input.schedule };
      assertSchedule(schedule);
      return { ok: true, value: { kind: input.kind, name, timezone: schedule.timezone, action: null, expiresAt,
        definition: { schedule, condition: null, watch: { assets: [...input.watch.assets] }, limits: NO_LIMITS } } };
    }
    const limits: Limits = { maxAmountPerExecution: input.limits.maxAmountPerExecution, maxAmountPerPeriod: input.limits.maxAmountPerPeriod && { ...input.limits.maxAmountPerPeriod },
      maxOccurrencesPerPeriod: input.limits.maxOccurrencesPerPeriod && { ...input.limits.maxOccurrencesPerPeriod }, cooldownMinutes: input.limits.cooldownMinutes,
      maxSlippageBps: input.limits.maxSlippageBps };
    assertLimits(limits);
    if (input.action?.kind === 'ROUTE' && parseScaled(input.action.amount, AMOUNT_SCALE)! <= 0n) return { ok: false, code: 'AUTOMATION_AMOUNT_INVALID' };
    if (input.kind === 'SCHEDULED_DCA') {
      const schedule = { ...input.schedule };
      assertSchedule(schedule);
      return { ok: true, value: { kind: input.kind, name, timezone: schedule.timezone, action: input.action, expiresAt,
        definition: { schedule, condition: null, watch: null, limits } } };
    }
    if (!validTimeZone(input.timezone)) return { ok: false, code: 'AUTOMATION_SCHEDULE_INVALID' };
    const condition = { ...input.condition } as PriceCondition & { checkEveryMinutes: number };
    conditionThreshold(condition);
    // An action must trade the observed asset: an ETH condition cannot propose a SOL swap.
    if (input.action?.kind === 'ROUTE' && input.action.asset !== condition.asset) return { ok: false, code: 'AUTOMATION_ACTION_ASSET_MISMATCH' };
    return { ok: true, value: { kind: input.kind, name, timezone: input.timezone, action: input.action, expiresAt,
      definition: { schedule: null, condition, watch: null, limits } } };
  } catch (cause) {
    return { ok: false, code: cause instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(cause.message) ? cause.message : 'AUTOMATION_INPUT_INVALID' };
  }
}
