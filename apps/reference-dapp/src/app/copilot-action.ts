// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { copilotConfig, createCopilotLimiter, createOpenAITransport, createReplayTransport, interpretCopilot, parseCopilotReplay,
  type CopilotLimiter, type CopilotMode, type CopilotResult } from '../server/copilot-service';

/**
 * BUILD-COPILOT-001: Flofi Copilot interpretation. The browser sends only its short clarification thread and receives
 * an untrusted structured intent or a failure code — never the key, the model name, the prompt or upstream errors.
 * The intent becomes a proposal only through the exact grammar, and the workflow changes only on the user's Apply.
 */
const REPLAY_FILE = join('e2e', 'copilot', 'replay.json');
/** Held on globalThis so development module reloads cannot reset the per-process admission limits. */
function limiter(): CopilotLimiter {
  const key = Symbol.for('flofi.copilot.limiter');
  const holder = globalThis as unknown as Record<symbol, CopilotLimiter | undefined>;
  holder[key] ??= createCopilotLimiter();
  return holder[key];
}
export async function copilotStatus(): Promise<{ mode: CopilotMode }> {
  return { mode: copilotConfig(process.env).mode };
}
export async function copilotInterpret(input: unknown): Promise<CopilotResult> {
  const config = copilotConfig(process.env);
  if (config.mode === 'off') return { ok: false, code: 'COPILOT_OFF' };
  if (config.mode === 'unavailable') return { ok: false, code: 'COPILOT_NOT_CONFIGURED' };
  if (config.mode === 'live') {
    return interpretCopilot(input, { transport: createOpenAITransport(config.apiKey), model: config.model, temperature: config.temperature, limiter: limiter() });
  }
  try {
    const replay = parseCopilotReplay(JSON.parse(await readFile(REPLAY_FILE, 'utf8')));
    return interpretCopilot(input, { transport: createReplayTransport(replay), model: 'replay', temperature: 0, limiter: limiter() });
  } catch { return { ok: false, code: 'COPILOT_REPLAY_INVALID' }; }
}
