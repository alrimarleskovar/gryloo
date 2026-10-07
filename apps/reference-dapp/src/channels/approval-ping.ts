// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the FloFi-side status ping (owner decision D5) — model-free, called by `/approve` while the approval experience
 * is active. It turns the approval's progress into notifications for the conversation that created it: "loaded in FloFi" once the
 * owner claimed it and chose to share status, then one message per run that reached a terminal state (e.g. "Execution reconciled ✅
 * · evidence: MOCKED"). There is no scheduled sweep.
 *
 * Who may trigger it: only a browser that holds the channel approval secret AND a proven wallet session of the claimant, for a
 * CLAIMED or APPLIED handoff whose owner shares status; rate-limited per handoff. It never changes, waits on or blocks FloFi's
 * execution, reconciliation or evidence — a failed send is only a failed message — and it never sends an approval link.
 */
import type { Database } from '@defi-workflow-engine/cloud-runtime';
import { createPgHandoffStore, deploymentEngineRuntime, resolveApprovalSecret, type EngineRuntime, type WalletRef } from '../platform/index.ts';
import { embeddedRuntime, flowRuntimeKind } from '../server/flow-runtime.ts';
import { channelApprovalScheme } from './core/approval.ts';
import { channelLogger, type ChannelLogSink } from './core/log.ts';
import { notifyChannelHandoff } from './core/notify.ts';
import { createPgChannelStore } from './core/pg-store.ts';
import { readChannelDeployment } from './registry.ts';
import { createWhatsAppAdapter } from './whatsapp/adapter.ts';
import { fixtureTransport, type WhatsAppTransport } from './whatsapp/transport.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type PingResult = { readonly channel: boolean; readonly active: boolean };
export type PingOptions = { readonly host?: { readonly db: Database; readonly tenantId: string }; readonly runtime?: EngineRuntime; readonly transport?: WhatsAppTransport;
  readonly now?: () => Date; readonly logger?: ChannelLogSink | null };
const OPEN = new Set(['PENDING', 'CLAIMED', 'APPLIED']);
export const PING_LIMIT = Object.freeze([12, 60] as const);

export async function pingChannelApproval(env: Env, secret: unknown, wallets: readonly WalletRef[], options: PingOptions = {}): Promise<PingResult> {
  const deployment = readChannelDeployment(env);
  if (!deployment.ok) return { channel: false, active: false };
  const { core, whatsapp } = deployment.deployment, now = options.now ?? (() => new Date()), log = channelLogger(options.logger);
  const resolved = resolveApprovalSecret([channelApprovalScheme(core.keys)], secret);
  if (!resolved) return { channel: false, active: false };
  let host = options.host;
  if (!host) {
    if (flowRuntimeKind(env) !== 'embedded') return { channel: true, active: false };
    const runtime = await embeddedRuntime(env);
    host = { db: runtime.db, tenantId: runtime.tenantId };
  }
  const store = createPgChannelStore(host.db, host.tenantId), handoffs = createPgHandoffStore(host.db, host.tenantId);
  if (!await store.schemaInstalled()) return { channel: true, active: false };
  const handoff = await handoffs.bySecret(resolved.digest, now(), resolved.kinds);
  if (!handoff || !OPEN.has(handoff.status)) return { channel: true, active: false };
  // Only the claimant's own proven wallet, and only while the owner shares status: otherwise there is nothing this browser may send.
  const claimant = handoff.claimed && wallets.some(w => w.namespace === handoff.claimed!.namespace && w.address === handoff.claimed!.address);
  if (!claimant || !handoff.shareStatus) return { channel: true, active: true };
  if (!await store.allow(`channel:ping:${handoff.handoffId}`, PING_LIMIT[0], PING_LIMIT[1], now())) return { channel: true, active: true };
  const runtime = options.runtime ?? deploymentEngineRuntime(env);
  const { done } = await notifyChannelHandoff({ core, store, log, now, adapter: createWhatsAppAdapter(whatsapp.phoneNumberId, options.transport ?? fixtureTransport()),
    platform: { origin: core.origin, scheme: channelApprovalScheme(core.keys), handoffs, allow: store.allow, runtime, policy: core.policy } }, handoff);
  return { channel: true, active: !done };
}
