// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001 test harness: an automation runtime on a disposable loopback PostgreSQL with a controllable clock, an in-memory
 * price source (MOCKED) and an engine runtime stub whose flows are "enabled" — so gates, handoffs and claims run the real shared platform.
 * The stub runtime has no execution path at all: nothing here can sign or submit.
 */
import { randomBytes } from 'node:crypto';
import type { Database } from '@defi-workflow-engine/cloud-runtime';
import { assembleApprovalSurface, createPgHandoffStore, fixedWindow, type EngineRuntime } from '../platform/index.ts';
import { automationApprovalScheme, automationClaimPolicy } from './approval.ts';
import { automationKeys, type AutomationConfig } from './config.ts';
import { automationLogger } from './log.ts';
import { createPgAutomationStore } from './pg-store.ts';
import type { PriceResult, PriceSource } from './price-source.ts';
import { automationRuntime, newAutomationId, type AutomationRuntime } from './runtime.ts';
import { createAutomationService } from './service.ts';
import type { Owner } from './store.ts';
import { OBSERVED_ASSETS, type ObservedAsset } from './trigger.ts';

export const OWNER_A: Owner = { namespace: 'eip155', address: '0x' + 'a1'.repeat(20) };
export const OWNER_B: Owner = { namespace: 'eip155', address: '0x' + 'b2'.repeat(20) };
export const ORIGIN = 'http://127.0.0.1:3999';

/** Every flow enabled (as on a deployment that runs them), with no run, record or evidence: gates and handoffs only. */
export const enabledRuntime: EngineRuntime = Object.freeze({ kind: 'embedded', mode: async () => 'live' as const, info: async () => ({ executionEnabled: true }),
  preview: async () => ({ ok: false, code: 'PREVIEW_NOT_AVAILABLE' }) as const, run: async () => ({ ok: true, value: null }) as const,
  journal: async () => ({ ok: true, value: null }) as const, evidence: async () => ({ ok: true, value: null }) as const,
  runs: async () => ({ ok: true, value: [] }) as const, record: async () => ({ ok: true, value: null }) as const });

/** A price source the test drives: `set(asset, price, observedAt?)`; `fail(asset, code)`. Evidence MOCKED. */
export function scriptedPrices(maxAgeMs = 3_600_000) {
  const values = new Map<ObservedAsset, PriceResult>();
  const source: PriceSource = { id: 'fixture', maxAgeMs, assets: [...OBSERVED_ASSETS], observe: async asset => values.get(asset) ?? { ok: false, code: 'PRICE_ASSET_UNSUPPORTED' } };
  return { source, calls: [] as string[],
    set(asset: ObservedAsset, priceUsd: string, observedAt: Date) {
      values.set(asset, { ok: true, observation: { asset, priceUsd, observedAt: observedAt.toISOString(), receivedAt: observedAt.toISOString(), source: 'FIXTURE',
        evidence: 'MOCKED', provenance: {} } });
    },
    fail(asset: ObservedAsset, code: string) { values.set(asset, { ok: false, code }); } };
}

export type Harness = ReturnType<typeof automationHarness>;
export function automationHarness(db: Database, options: { readonly tenantId?: string; readonly start?: Date; readonly logLines?: string[] } = {}) {
  const tenantId = options.tenantId ?? 'default';
  let clock = options.start ?? new Date('2026-10-08T10:00:00Z');
  const now = () => new Date(clock.getTime());
  const config: AutomationConfig = Object.freeze<AutomationConfig>({ enabled: true, tenantId, origin: ORIGIN, keys: automationKeys(randomBytes(32).toString('hex')),
    policy: { ok: true as const, testFunds: true, mainnetNetworks: [] }, dispatchTokenDigest: null, price: { kind: 'fixture', path: '/tmp/none', maxAgeMs: 3_600_000 },
    testClock: true, hosted: false });
  const prices = scriptedPrices();
  const lines = options.logLines ?? [];
  const sink = { info: (event: string, fields?: object) => lines.push(JSON.stringify({ event, ...fields })), warn: (event: string, fields?: object) => lines.push(JSON.stringify({ event, ...fields })) };
  const log = automationLogger(sink);
  const rt = (database: Database = db): AutomationRuntime => automationRuntime({}, config, { db: database, tenantId }, log, now, { runtime: enabledRuntime, price: prices.source });
  const store = createPgAutomationStore(db, tenantId), handoffs = createPgHandoffStore(db, tenantId);
  const service = (database: Database = db) => createAutomationService({ config, db: database, store: createPgAutomationStore(database, tenantId),
    handoffs: createPgHandoffStore(database, tenantId), allow: fixedWindow(database, tenantId).allow, runtime: enabledRuntime, price: prices.source, log, now,
    newId: newAutomationId, telegramAvailable: false });
  const surface = () => assembleApprovalSurface([{ scheme: automationApprovalScheme(config.keys), profiles: { AUTOMATION_RULE: { policy: config.policy,
    claimPolicy: automationClaimPolicy(store, now) } } }], handoffs, enabledRuntime);
  return { tenantId, config, prices, log, lines, rt, store, handoffs, service, surface, now,
    set(at: Date | string) { clock = new Date(at); }, advance(ms: number) { clock = new Date(clock.getTime() + ms); } };
}

/** A weekly DCA input: Monday 09:00 Europe/Lisbon, 50 USDC → WETH on Base Sepolia, ask each time. */
export const weeklyDca = (patch: Record<string, unknown> = {}) => ({ version: 1, kind: 'SCHEDULED_DCA', name: 'Weekly ETH',
  schedule: { frequency: 'WEEKLY', weekday: 1, time: '09:00', timezone: 'Europe/Lisbon' },
  action: { kind: 'ROUTE', asset: 'ETH', side: 'BUY', network: 'base-sepolia', amount: '50', slippageBps: 50 },
  limits: { maxAmountPerExecution: '50', maxAmountPerPeriod: null, maxOccurrencesPerPeriod: null, cooldownMinutes: 0, maxSlippageBps: 100 }, expiresAt: null, ...patch });
/** "If ETH falls below $3,000, ask me to buy 100 USDC", checked every 15 minutes. */
export const ethDip = (patch: Record<string, unknown> = {}) => ({ version: 1, kind: 'PRICE_TRIGGER', name: 'ETH dip', timezone: 'Europe/Lisbon',
  condition: { type: 'PRICE_BELOW', asset: 'ETH', threshold: '3000', checkEveryMinutes: 15 },
  action: { kind: 'ROUTE', asset: 'ETH', side: 'BUY', network: 'base-sepolia', amount: '100', slippageBps: 50 },
  limits: { maxAmountPerExecution: '100', maxAmountPerPeriod: null, maxOccurrencesPerPeriod: null, cooldownMinutes: 0, maxSlippageBps: null }, expiresAt: null, ...patch });
