// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the deployment's provider instances (`ChannelProvider`), built from the registry's validated configuration with
 * their production transports: WhatsApp's recording fixture or, with recorded clearance, the Cloud API; Telegram's Bot API (or its
 * loopback double in tests). The seams replace a transport in tests only.
 */
import type { ChannelAdapter, ChannelId, ChannelProvider } from './core/types.ts';
import type { ChannelDeployment, ChannelRoute } from './registry.ts';
import { createTelegramProvider } from './telegram/adapter.ts';
import { createWhatsAppProvider, whatsAppTransport } from './whatsapp/adapter.ts';
import type { WhatsAppTransport } from './whatsapp/transport.ts';

export type ProviderSeams = { readonly whatsappTransport?: WhatsAppTransport; readonly telegramFetch?: typeof fetch };
export type ChannelProviders = { readonly byRoute: ReadonlyMap<ChannelRoute, ChannelProvider>; readonly adapters: ReadonlyMap<ChannelId, ChannelAdapter> };

export function channelProviders(deployment: ChannelDeployment, seams: ProviderSeams = {}): ChannelProviders {
  const byRoute = new Map<ChannelRoute, ChannelProvider>();
  if (deployment.whatsapp) byRoute.set('whatsapp', createWhatsAppProvider(deployment.whatsapp, seams.whatsappTransport ?? whatsAppTransport(deployment.whatsapp)));
  if (deployment.telegram) byRoute.set('telegram', createTelegramProvider(deployment.telegram, seams.telegramFetch));
  return { byRoute, adapters: new Map([...byRoute.values()].map(p => [p.adapter.channel, p.adapter])) };
}
