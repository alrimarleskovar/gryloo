// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: which conversational channels this deployment runs, and their validated configuration. Today: WhatsApp,
 * fixture-only and never on a hosted deployment (owner decision D1). A later permitted adapter (e.g. Telegram) adds its own config
 * reader here; Channel Core is shared. Any invalid value disables the channels (fail closed). Model-free: this module never loads the
 * interpreter, so /approve can consult it.
 */
import { readChannelCoreConfig, type ChannelCoreConfig } from './core/config.ts';
import { readWhatsAppConfig, whatsAppSecrets, type WhatsAppConfig } from './whatsapp/config.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type ChannelDeployment = { readonly core: ChannelCoreConfig; readonly whatsapp: WhatsAppConfig };
export type ChannelDeploymentResult = { readonly ok: true; readonly deployment: ChannelDeployment }
  | { readonly ok: false; readonly status: 404 | 503; readonly code: string; readonly reason?: string };

export function readChannelDeployment(env: Env): ChannelDeploymentResult {
  const whatsapp = readWhatsAppConfig(env);
  if (!whatsapp.enabled) {
    const status = whatsapp.code === 'WHATSAPP_NOT_ENABLED' || whatsapp.code === 'CHANNEL_PROVIDER_NOT_ACTIVATED' ? 404 : 503;
    return { ok: false, status, code: whatsapp.code, ...'reason' in whatsapp ? { reason: whatsapp.reason } : {} };
  }
  const core = readChannelCoreConfig(env, whatsAppSecrets(whatsapp));
  if (!core.enabled) return { ok: false, status: 503, code: core.code, reason: core.reason };
  return { ok: true, deployment: { core, whatsapp } };
}
