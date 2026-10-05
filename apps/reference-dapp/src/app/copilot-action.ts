// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { COPILOT_REPLAY_FORMAT_V2, copilotConfig, copilotTelemetrySink, copilotTuning, createCopilotLimiter, createOpenAITransport, createReplayTransport, interpretCopilot,
  interpretCopilotV2, parseCopilotReplay, COPILOT_SERVER_LIMITS, COPILOT_TUNING_DEFAULTS, type CopilotLimiter, type CopilotMode, type CopilotResult, type CopilotResultV2 } from '../server/copilot-service';

/**
 * BUILD-COPILOT-001: Flofi Copilot interpretation. The browser sends only its short clarification thread and receives
 * an untrusted structured intent or a failure code — never the key, the model name, the prompt or upstream errors.
 * The intent becomes a proposal only through the exact grammar, and the workflow changes only on the user's Apply.
 *
 * BUILD-COPILOT-002: a request with `version: '2'` carries a bounded transcript and receives a CopilotIntentV2. The
 * browser resolves it against its own state; nothing here sees, stores or trusts a workflow. Requests without a version
 * keep the V1 protocol and replay file.
 */
const REPLAY_FILE = join('e2e', 'copilot', 'replay.json');
const REPLAY_FILE_V2 = join('e2e', 'copilot', 'replay-v2.json');
/** Held on globalThis so development module reloads cannot reset the per-process admission limits. */
function limiter(): CopilotLimiter {
  const key = Symbol.for('flofi.copilot.limiter');
  const holder = globalThis as unknown as Record<symbol, CopilotLimiter | undefined>;
  holder[key] ??= createCopilotLimiter();
  return holder[key];
}
/** Invalid live tuning makes the Copilot unavailable rather than silently using other limits. */
function mode(): CopilotMode {
  const config = copilotConfig(process.env);
  return config.mode === 'live' && !copilotTuning(process.env) ? 'unavailable' : config.mode;
}
export async function copilotStatus(): Promise<{ mode: CopilotMode }> {
  return { mode: mode() };
}
const isV2 = (input: unknown) => !!input && typeof input === 'object' && (input as { version?: unknown }).version === '2';
export async function copilotInterpret(input: unknown): Promise<CopilotResult | CopilotResultV2> {
  const config = copilotConfig(process.env), tuning = copilotTuning(process.env);
  if (config.mode === 'off') return { ok: false, code: 'COPILOT_OFF' };
  if (config.mode === 'unavailable' || (config.mode === 'live' && !tuning)) return { ok: false, code: 'COPILOT_NOT_CONFIGURED' };
  if (isV2(input)) {
    if (config.mode === 'live' && tuning) {
      return interpretCopilotV2(input, { transport: createOpenAITransport(config.apiKey, fetch, { timeoutMs: tuning.timeoutMs, maxResponseBytes: COPILOT_SERVER_LIMITS.maxResponseBytes }),
        settings: { model: config.model, temperature: config.temperature, maxOutputTokens: tuning.maxOutputTokens, reasoningEffort: tuning.reasoningEffort },
        mode: 'live', limiter: limiter(), telemetry: copilotTelemetrySink(process.env, 'live') });
    }
    try {
      const replay = parseCopilotReplay(JSON.parse(await readFile(REPLAY_FILE_V2, 'utf8')), COPILOT_REPLAY_FORMAT_V2);
      return interpretCopilotV2(input, { transport: createReplayTransport(replay, 'segment'), settings: { model: 'replay', temperature: 0,
        maxOutputTokens: COPILOT_TUNING_DEFAULTS.maxOutputTokens, reasoningEffort: null }, mode: 'replay', limiter: limiter(), telemetry: copilotTelemetrySink(process.env, 'replay') });
    } catch { return { ok: false, code: 'COPILOT_REPLAY_INVALID' }; }
  }
  if (config.mode === 'live') {
    return interpretCopilot(input, { transport: createOpenAITransport(config.apiKey), model: config.model, temperature: config.temperature, limiter: limiter() });
  }
  try {
    const replay = parseCopilotReplay(JSON.parse(await readFile(REPLAY_FILE, 'utf8')));
    return interpretCopilot(input, { transport: createReplayTransport(replay), model: 'replay', temperature: 0, limiter: limiter() });
  } catch { return { ok: false, code: 'COPILOT_REPLAY_INVALID' }; }
}
