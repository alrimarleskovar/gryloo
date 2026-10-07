// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the channel's untrusted interpreter — FloFi's existing Copilot V2 boundary (`copilot-service.ts`), unchanged:
 * one Responses API request per turn, structured output only, no tools, `store: false`, strict schema validation, closed failure
 * codes, and the same per-process admission limiter as FloFi's own chat (shared through the same global key). `replay` answers come
 * from committed recordings with no network. Nothing here sees a wallet, a workflow or a secret, and nothing it returns is authority:
 * the conversation engine grounds every value in the user's own words and authors only through the exact grammar.
 *
 * `FLOFI_CHANNEL_COPILOT=disabled` (or `FLOFI_COPILOT` off) means no interpreter at all: exact commands only, no model call.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { COPILOT_REPLAY_FORMAT_V2, COPILOT_SERVER_LIMITS, COPILOT_TUNING_DEFAULTS, copilotConfig, copilotTelemetrySink, copilotTuning, createCopilotLimiter,
  createOpenAITransport, createReplayTransport, interpretCopilotV2, parseCopilotReplay, type CopilotLimiter, type CopilotTransport } from '../../server/copilot-service.ts';
import type { ChannelInterpreter } from './conversation.ts';

type Env = Readonly<Record<string, string | undefined>>;
const REPLAY_FILE_V2 = join('e2e', 'copilot', 'replay-v2.json');
/** The process-wide admission limiter FloFi's chat uses (`copilot-action.ts` holds it under the same key). */
function sharedLimiter(): CopilotLimiter {
  const key = Symbol.for('flofi.copilot.limiter'), holder = globalThis as unknown as Record<symbol, CopilotLimiter | undefined>;
  holder[key] ??= createCopilotLimiter();
  return holder[key];
}

/** The interpreter this deployment allows for channels, or null (exact commands only). `transport` is a test seam for replayed answers. */
export function channelInterpreter(env: Env, options: { readonly enabled: boolean; readonly transport?: CopilotTransport } = { enabled: true }): ChannelInterpreter | null {
  if (!options.enabled) return null;
  if (options.transport) {
    const transport = options.transport;
    return request => interpretCopilotV2(request, { transport, mode: 'replay', limiter: sharedLimiter(),
      settings: { model: 'replay', temperature: 0, maxOutputTokens: COPILOT_TUNING_DEFAULTS.maxOutputTokens, reasoningEffort: null } });
  }
  const config = copilotConfig(env), tuning = copilotTuning(env);
  if (config.mode === 'off') return null;
  if (config.mode === 'unavailable' || (config.mode === 'live' && !tuning)) return async () => ({ ok: false, code: 'COPILOT_NOT_CONFIGURED' });
  if (config.mode === 'live' && tuning) {
    const transport = createOpenAITransport(config.apiKey, fetch, { timeoutMs: tuning.timeoutMs, maxResponseBytes: COPILOT_SERVER_LIMITS.maxResponseBytes });
    return request => interpretCopilotV2(request, { transport, mode: 'live', limiter: sharedLimiter(), telemetry: copilotTelemetrySink(env, 'live'),
      settings: { model: config.model, temperature: config.temperature, maxOutputTokens: tuning.maxOutputTokens, reasoningEffort: tuning.reasoningEffort } });
  }
  return async request => {
    try {
      const replay = parseCopilotReplay(JSON.parse(await readFile(REPLAY_FILE_V2, 'utf8')), COPILOT_REPLAY_FORMAT_V2);
      return interpretCopilotV2(request, { transport: createReplayTransport(replay, 'segment'), mode: 'replay', limiter: sharedLimiter(),
        settings: { model: 'replay', temperature: 0, maxOutputTokens: COPILOT_TUNING_DEFAULTS.maxOutputTokens, reasoningEffort: null } });
    } catch { return { ok: false, code: 'COPILOT_REPLAY_INVALID' }; }
  };
}
