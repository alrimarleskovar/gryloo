// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: which conversational channels this deployment runs, and their validated configuration. Every provider is read
 * on its own and fails closed on its own; Channel Core is shared and needs at least one enabled provider. Model-free: this module never
 * loads the interpreter or a transport, so /approve can consult it.
 *
 *   WhatsApp   fixture-only and never hosted until the owner's policy clearance is recorded in code (owner decision D1, `whatsapp/config.ts`)
 *   Telegram   a plain bot over the Bot API, live when enabled (`telegram/config.ts`)
 */
import { readChannelCoreConfig, type ChannelCoreConfig } from './core/config.ts';
import { readTelegramConfig, telegramSecrets, type TelegramConfig } from './telegram/config.ts';
import { readWhatsAppConfig, whatsAppSecrets, type WhatsAppConfig } from './whatsapp/config.ts';

type Env = Readonly<Record<string, string | undefined>>;
export const CHANNEL_ROUTES = ['whatsapp', 'telegram'] as const;
export type ChannelRoute = typeof CHANNEL_ROUTES[number];
export type ChannelDeployment = { readonly core: ChannelCoreConfig; readonly whatsapp: WhatsAppConfig | null; readonly telegram: TelegramConfig | null };
export type ChannelRefusal = { readonly ok: false; readonly status: 404 | 503; readonly code: string; readonly reason?: string };
export type ChannelDeploymentResult = { readonly ok: true; readonly deployment: ChannelDeployment } | ChannelRefusal;
/** A provider that is not running, as its own route answers: 404 when off or not activated, 503 when misconfigured. */
export type ProviderStatus = { readonly route: ChannelRoute; readonly enabled: boolean; readonly code: string | null; readonly reason: string | null };

const OFF = new Set(['WHATSAPP_NOT_ENABLED', 'TELEGRAM_NOT_ENABLED', 'CHANNEL_PROVIDER_NOT_ACTIVATED', 'WHATSAPP_LIVE_PROVIDER_NOT_CLEARED']);
type ProviderResult = WhatsAppConfig | TelegramConfig | { readonly enabled: false; readonly code: string; readonly reason?: string };
const refusalOf = (result: Extract<ProviderResult, { enabled: false }>): ChannelRefusal =>
  ({ ok: false, status: OFF.has(result.code) ? 404 : 503, code: result.code, ...result.reason ? { reason: result.reason } : {} });

/** Each provider's state, for readiness reports. */
export function channelProviderStatus(env: Env): readonly ProviderStatus[] {
  return ([['whatsapp', readWhatsAppConfig(env)], ['telegram', readTelegramConfig(env)]] as const).map(([route, r]) =>
    ({ route, enabled: r.enabled, code: r.enabled ? null : r.code, reason: r.enabled ? null : 'reason' in r ? r.reason : null }));
}

/**
 * The deployment's channels. With `route`, that provider must be enabled (its own refusal otherwise), as its webhook requires; without
 * it, any enabled provider will do (the approval surface, the ping, the dispatch).
 */
export function readChannelDeployment(env: Env, route?: ChannelRoute): ChannelDeploymentResult {
  const whatsapp = readWhatsAppConfig(env), telegram = readTelegramConfig(env);
  const results: Record<ChannelRoute, ProviderResult> = { whatsapp, telegram };
  if (route) { const own = results[route]; if (!own.enabled) return refusalOf(own); }
  const enabled = CHANNEL_ROUTES.filter(r => results[r].enabled);
  if (!enabled.length) {
    // Nothing runs: report the most telling reason (a misconfiguration, then a provider held back, then nothing enabled).
    const refusals = CHANNEL_ROUTES.map(r => refusalOf(results[r] as Extract<ProviderResult, { enabled: false }>));
    return refusals.find(r => r.status === 503) ?? refusals.find(r => !r.code.endsWith('_NOT_ENABLED')) ?? { ok: false, status: 404, code: 'CHANNELS_NOT_ENABLED' };
  }
  const secrets = [...whatsapp.enabled ? whatsAppSecrets(whatsapp) : [], ...telegram.enabled ? telegramSecrets(telegram) : []];
  const core = readChannelCoreConfig(env, secrets);
  if (!core.enabled) return { ok: false, status: 503, code: core.code, reason: core.reason };
  return { ok: true, deployment: { core, whatsapp: whatsapp.enabled ? whatsapp : null, telegram: telegram.enabled ? telegram : null } };
}
