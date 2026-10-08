// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: the wiring of Channel Core's subscription hook to the Automations module — present only while automations are
 * enabled on this deployment (same tenant). Only Telegram conversations may be linked: WhatsApp's policy restriction on facilitating
 * currency exchange (BUILD-CHANNELS-001 D1) applies to automation notifications as well. The hook links a chat; it holds no authority.
 */
import { readAutomationConfig } from '../automations/config.ts';
import { consumeLinkCode, LINK_TTL_MS, unlinkConversation } from '../automations/subscriptions.ts';
import type { ChannelSubscriptions } from './core/subscriber.ts';
import type { ChannelHost } from './runtime.ts';

type Env = Readonly<Record<string, string | undefined>>;
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
export function channelSubscriptions(env: Env, host: ChannelHost): ChannelSubscriptions | null {
  const config = readAutomationConfig(env);
  if (!config.enabled || config.tenantId !== host.tenantId) return null;
  return {
    async link({ channel, conversationId, code, now }) {
      if (channel !== 'TELEGRAM') return { ok: false, code: 'AUTOMATION_CHANNEL_NOT_SUPPORTED' };
      const linked = await consumeLinkCode(host.db, host.tenantId, config.keys, { channel, conversationId, code, now });
      return linked.ok ? { ok: true, label: short(linked.owner.address), days: Math.round(LINK_TTL_MS / 86_400_000) } : linked;
    },
    unlink: conversationId => unlinkConversation(host.db, host.tenantId, conversationId),
  };
}
