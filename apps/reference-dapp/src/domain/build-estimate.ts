// SPDX-License-Identifier: AGPL-3.0-only
/** Presentation data only. Deliberately excludes Review, calldata, execution IDs and financial authority. */
export type BuildEstimate = { readonly workflowHash: string; readonly nodeId: string; readonly chain: string;
  readonly provider: string; readonly expected: string; readonly minimum: string | null; readonly symbol: string;
  readonly slippageBps: number; readonly expiresAt: string };
export type BuildEstimateResult = { ok: true; estimate: BuildEstimate } | { ok: false; code: string };

/** One cancellable request per authoring snapshot. Late completions cannot publish after cancel/timeout. */
export function requestBuildEstimate(load: (signal: AbortSignal) => Promise<BuildEstimateResult>,
  publish: (result: BuildEstimateResult) => void, debounceMs = 350, timeoutMs = 15_000): () => void {
  const controller = new AbortController();
  let active = true, timeout: ReturnType<typeof setTimeout> | undefined;
  const timer = setTimeout(() => {
    timeout = setTimeout(() => { if (!active) return; active = false; controller.abort(); publish({ ok: false, code: 'ESTIMATE_TIMEOUT' }); }, timeoutMs);
    load(controller.signal).then(result => { if (active) { active = false; clearTimeout(timeout); publish(result); } }, () => {
      if (active) { active = false; clearTimeout(timeout); publish({ ok: false, code: 'ESTIMATE_UNAVAILABLE' }); }
    });
  }, debounceMs);
  return () => { active = false; clearTimeout(timer); clearTimeout(timeout); controller.abort(); };
}
