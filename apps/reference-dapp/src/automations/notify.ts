// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: notifying the owner of an occurrence — the body of the `automation.notify` work item.
 *
 *   in-app     always: the occurrence itself, listed in the owner's Automations workspace (and counted in the navigation)
 *   Telegram   when the owner linked a chat (`subscriptions.ts`) and Telegram runs on this deployment: one NOTIFICATION through Channel
 *              Core (`notifySubscriber`), deduplicated by `automation:<occurrence>`, with a link to the owner's FloFi workspace only
 *
 * A notification holds no authority and no approval secret. Its delivery never changes the occurrence: a failure is recorded as delivery
 * bookkeeping and retried by the work item (Channel Core retries the send itself). The item is idempotent: a retry finds the outbox
 * row already queued and sends nothing twice.
 */
import type { Database } from '@defi-workflow-engine/cloud-runtime';
import type { ChannelReply } from '../channels/core/types.ts';
import type { SubscriberResult } from '../channels/core/subscriber.ts';
import { notificationLinkLabel, notificationText, type Language } from './copy.ts';
import type { AutomationLogger } from './log.ts';
import { OPEN_OCCURRENCE, type AutomationStore } from './store.ts';
import { targetsOf } from './subscriptions.ts';

/** A channel that can carry automation notifications on this deployment (Telegram), bound to its adapter and Channel Core store. */
export type ChannelNotifier = { readonly channel: 'TELEGRAM';
  readonly send: (conversationId: string, dedupeKey: string, reply: (language: Language) => ChannelReply) => Promise<SubscriberResult> };
export type NotifyDeps = { readonly store: AutomationStore; readonly db: Database; readonly tenantId: string; readonly origin: string; readonly log: AutomationLogger;
  readonly now: () => Date; readonly notifier: ChannelNotifier | null };
export const occurrenceLink = (origin: string, occurrenceId: string) => `${origin}/app/automations?occurrence=${occurrenceId}`;

export async function notifyOccurrence(deps: NotifyDeps, occurrenceId: string): Promise<{ readonly attempted: number; readonly queued: number }> {
  const now = deps.now(), o = await deps.store.occurrenceById(occurrenceId);
  if (!o || !OPEN_OCCURRENCE.includes(o.state) || o.expiresAt <= now) return { attempted: 0, queued: 0 };
  const rule = await deps.store.ruleById(o.ruleId);
  if (!rule) return { attempted: 0, queued: 0 };
  const targets = (await targetsOf(deps.db, deps.tenantId, o.owner, now)).filter(t => t.channel === 'TELEGRAM');
  let attempted = 0, queued = 0;
  for (const target of targets) {
    attempted++;
    if (!deps.notifier) {
      await deps.store.recordNotification(o.occurrenceId, target.channel, 'SKIPPED', 'CHANNEL_NOT_ENABLED', now);
      deps.log.info('automation.notification_attempted', { occurrence: o.occurrenceId, channel: 'telegram', status: 'SKIPPED', code: 'CHANNEL_NOT_ENABLED' });
      continue;
    }
    const result = await deps.notifier.send(target.conversationId, `automation:${o.occurrenceId}`, language => ({ text: notificationText(language, rule, o), choices: [],
      link: { label: notificationLinkLabel(language), url: occurrenceLink(deps.origin, o.occurrenceId) } }));
    const status = result.queued ? 'QUEUED' : 'SKIPPED';
    if (result.queued) queued++;
    await deps.store.recordNotification(o.occurrenceId, target.channel, status, result.code === 'SUBSCRIBER_DUPLICATE' ? null : result.code, now);
    deps.log.info('automation.notification_attempted', { occurrence: o.occurrenceId, channel: 'telegram', status, ...result.code ? { code: result.code } : {},
      ...result.report ? { delivery: result.report.sent ? 'sent' : result.report.retrying ? 'retrying' : result.report.failed ? 'failed' : 'pending' } : {} });
  }
  return { attempted, queued };
}
