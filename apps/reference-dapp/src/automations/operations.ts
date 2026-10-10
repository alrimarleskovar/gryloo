// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: the owner's Automations operations as ONE closed contract, executed where the deployment's runtime runs —
 * the same pattern as saved workflows (`/v1/workflows/*`):
 *
 *   embedded  in the web deployment's server actions (`server/automation-operation.ts` → this module, in process)
 *   remote    in the Railway API (`backend/automation-api.ts`, `POST /v1/automations/:method`), reached by the same server actions
 *             through the BFF with the verified owner in the server-to-server `x-flofi-workflow-owner` header
 *
 * The owner is ALWAYS the verified session principal handed in by the caller — never an argument — and every service call scopes its
 * queries to that owner (tenant, namespace, account), so another owner's automation id answers NOT FOUND. Arguments are checked here
 * before the service sees them. Nothing here signs, submits or runs a flow: the strongest operation, `open`, mints a no-authority
 * approval link on the shared approval model.
 */
import { readChannelDeployment } from '../channels/registry.ts';
import type { ObservedAsset } from './trigger.ts';
import type { Side } from './assets.ts';
import type { AutomationConfig } from './config.ts';
import type { AutomationLogger } from './log.ts';
import { automationRuntime, newAutomationId, type AutomationHost, type AutomationSeams } from './runtime.ts';
import { createAutomationService } from './service.ts';
import { createPgDelegationStore } from '../delegation/pg-store.ts';
import type { Owner } from './store.ts';

type Env = Readonly<Record<string, string | undefined>>;
export const AUTOMATION_OPERATIONS = Object.freeze(['overview', 'create', 'setState', 'rebind', 'history', 'open', 'dismiss', 'prepareWatch', 'telegramLinkCode',
  'telegramUnlink'] as const);
export type AutomationOperation = (typeof AUTOMATION_OPERATIONS)[number];
export const isAutomationOperation = (value: unknown): value is AutomationOperation => typeof value === 'string' && (AUTOMATION_OPERATIONS as readonly string[]).includes(value);
/** The one creating operation that is not a compare-and-set or an owner-scoped state change: deduplicated by an idempotency key remotely. */
export const IDEMPOTENT_OPERATIONS: ReadonlySet<AutomationOperation> = new Set(['create']);
export type AutomationService = ReturnType<typeof createAutomationService>;

/** The owner-facing service of this process: its store, the shared handoff store and limiter, the engine gates and the price source. */
export function ownerAutomationService(env: Env, config: AutomationConfig, host: AutomationHost, log: AutomationLogger, now: () => Date,
  seams: AutomationSeams = {}): AutomationService {
  const rt = automationRuntime(env, config, host, log, now, seams), channels = readChannelDeployment(env);
  return createAutomationService({ config, db: host.db, store: rt.store, handoffs: rt.handoffs, allow: rt.allow, runtime: rt.engine,
    price: rt.price, log, now, newId: newAutomationId,
    telegramAvailable: channels.ok && channels.deployment.telegram !== null && channels.deployment.core.tenantId === host.tenantId,
    // BUILD-AUTOMATION-002: a delegated rule resumes only while its authorization is ACTIVE (a read; no delegation capability is needed here).
    delegatedResumeGuard: async rule => {
      if (!rule.authorizationId) return 'DELEGATED_AUTHORIZATION_REQUIRED';
      const authorization = await createPgDelegationStore(host.db, host.tenantId).authorization(rule.owner, rule.authorizationId).catch(() => null);
      return authorization?.state === 'ACTIVE' ? null : 'DELEGATED_AUTHORIZATION_REQUIRED';
    } });
}

const invalid = (): never => { throw new Error('AUTOMATION_INPUT_INVALID'); };
const id = (value: unknown) => typeof value === 'string' && value.length <= 64 ? value : invalid();
const version = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : invalid();
const AMOUNT = /^(0|[1-9][0-9]{0,29})(\.[0-9]{1,18})?$/;

/** Runs one operation for `owner` (the verified principal). Throws a closed code for invalid arguments and every refusal. */
export async function runAutomationOperation(service: AutomationService, owner: Owner, method: AutomationOperation, args: readonly unknown[]): Promise<unknown> {
  const arity = (n: number) => { if (args.length !== n) invalid(); };
  switch (method) {
    case 'overview': arity(0); return service.overview(owner);
    case 'create': arity(1); return service.create(owner, args[0]);
    case 'setState': {
      arity(3);
      const action = args[2] === 'PAUSE' || args[2] === 'RESUME' || args[2] === 'ARCHIVE' ? args[2] : invalid();
      return service.setState(owner, id(args[0]), version(args[1]), action);
    }
    case 'rebind': arity(2); return service.rebind(owner, id(args[0]), version(args[1]));
    case 'history': arity(1); return service.history(owner, id(args[0]));
    case 'open': arity(1); return service.open(owner, id(args[0]));
    case 'dismiss': arity(1); return service.dismiss(owner, id(args[0]));
    case 'prepareWatch': {
      arity(2);
      const r = args[1] as { asset?: unknown; side?: unknown; network?: unknown; amount?: unknown; slippageBps?: unknown } | null;
      if (!r || typeof r !== 'object' || Object.keys(r).some(k => !['asset', 'side', 'network', 'amount', 'slippageBps'].includes(k))) invalid();
      if (typeof r!.asset !== 'string' || (r!.side !== 'BUY' && r!.side !== 'SELL') || typeof r!.network !== 'string' || r!.network.length > 40
        || typeof r!.amount !== 'string' || !AMOUNT.test(r!.amount) || !Number.isInteger(r!.slippageBps)) invalid();
      const prepared = await service.prepareWatchAction(owner, id(args[0]), { asset: r!.asset as ObservedAsset, side: r!.side as Side, network: r!.network as string,
        amount: r!.amount as string, slippageBps: r!.slippageBps as number });
      return { command: prepared.command, summary: prepared.summary };
    }
    case 'telegramLinkCode': arity(0); return service.telegramLinkCode(owner);
    case 'telegramUnlink': arity(0); return service.telegramUnlink(owner);
  }
}
