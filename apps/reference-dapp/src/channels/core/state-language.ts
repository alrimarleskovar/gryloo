// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-CHANNELS-001: the reply language recorded in a conversation's (opened) state — model-free, for paths that send no reply text of their own. */
import type { ChannelLanguage } from './config.ts';

export function parseStateLanguage(json: string | null, fallback: ChannelLanguage): ChannelLanguage {
  if (!json) return fallback;
  try { const language = (JSON.parse(json) as { language?: unknown }).language; return language === 'PT' || language === 'EN' ? language : fallback; }
  catch { return fallback; }
}
