// SPDX-License-Identifier: AGPL-3.0-only
/** Deterministic MOCKED financial lifecycle for the bounded two-stage BUILD-009 product path. */
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import type { Build009Quote } from '../server/build009-lifi';
export type RunState = 'BRIDGE_QUOTED' | 'BRIDGE_AUTHORIZED' | 'BRIDGE_SOURCE_UNKNOWN' | 'BRIDGE_SOURCE_SUBMITTED'
  | 'BRIDGE_SOURCE_CONFIRMED' | 'BRIDGE_IN_PROGRESS' | 'BRIDGE_DESTINATION_CONFIRMED' | 'PARTIAL_COMPLETION'
  | 'SWAP_QUOTED' | 'SWAP_AUTHORIZED' | 'SWAP_UNKNOWN' | 'SWAP_SUBMITTED' | 'SWAP_RECONCILED';
export type Event = { readonly sequence: number; readonly state: RunState; readonly at: string; readonly note: string };
export type Build009Run = { readonly format: 'gryloo.build009.mocked.v1'; readonly workflow: SemanticWorkflow;
  readonly owner: string; readonly bridge: Build009Quote; readonly bridgeManifestHash: string;
  readonly swap: Build009Quote | null; readonly swapManifestHash: string | null;
  readonly state: RunState; readonly received: string | null; readonly swapReceived: string | null;
  readonly sourceAttemptId: string | null; readonly sourceHash: string | null;
  readonly destinationHash: string | null; readonly destinationObservation: { readonly before: string; readonly after: string } | null; readonly swapAttemptId: string | null; readonly swapHash: string | null;
  readonly events: readonly Event[] };
function fail(): never { throw new Error('BUILD009_TRANSITION_INVALID'); }
function append(run: Build009Run, state: RunState, note: string, patch: Partial<Build009Run> = {}): Build009Run {
  return { ...run, ...patch, state, events: [...run.events, { sequence: run.events.length, state, at: new Date().toISOString(), note }] };
}
export async function manifestHash(input: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return '0x' + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
export function quoteFresh(quote: Build009Quote, nowMs = Date.now()): boolean {
  return Number.isFinite(Date.parse(quote.expiresAt)) && Date.parse(quote.expiresAt) > nowMs;
}
export function newBuild009Run(workflow: SemanticWorkflow, owner: string, quote: Build009Quote, hash: string): Build009Run {
  if (quote.stage !== 'bridge' || quote.owner !== owner || !/^0x[0-9a-f]{64}$/.test(hash)) fail();
  return { format: 'gryloo.build009.mocked.v1', workflow, owner, bridge: quote, bridgeManifestHash: hash,
    swap: null, swapManifestHash: null, state: 'BRIDGE_QUOTED', received: null, swapReceived: null,
    sourceAttemptId: null, sourceHash: null, destinationHash: null, destinationObservation: null, swapAttemptId: null, swapHash: null,
    events: [{ sequence: 0, state: 'BRIDGE_QUOTED', at: new Date().toISOString(), note: 'Live read-only LI.FI bridge quote; no financial execution' }] };
}
export function authorizeBridge(run: Build009Run, owner: string, hash: string, nowMs = Date.now()): Build009Run {
  if (run.state !== 'BRIDGE_QUOTED' || run.owner !== owner || hash !== run.bridgeManifestHash || !quoteFresh(run.bridge, nowMs)) fail();
  return append(run, 'BRIDGE_AUTHORIZED', 'Owner reviewed MOCKED bridge Manifest');
}
export function submitMockedSource(run: Build009Run, uncertain: boolean, nowMs = Date.now()): Build009Run {
  if (run.state !== 'BRIDGE_AUTHORIZED' || run.sourceAttemptId || !quoteFresh(run.bridge, nowMs)) fail();
  const sourceAttemptId = 'build009.bridge.source.a1';
  if (uncertain) return append(run, 'BRIDGE_SOURCE_UNKNOWN', 'MOCKED source response unknown; recheck existing attempt, never resend', { sourceAttemptId });
  return append(run, 'BRIDGE_SOURCE_SUBMITTED', 'MOCKED source submission', { sourceAttemptId, sourceHash: run.bridge.rawHash });
}
export function recheckMockedSource(run: Build009Run): Build009Run {
  if (run.state !== 'BRIDGE_SOURCE_UNKNOWN' || run.sourceAttemptId !== 'build009.bridge.source.a1') fail();
  return append(run, 'BRIDGE_SOURCE_SUBMITTED', 'MOCKED readback found existing source attempt; no retry', { sourceHash: run.bridge.rawHash });
}
export function advanceMockedBridge(run: Build009Run): Build009Run {
  if (run.state === 'BRIDGE_SOURCE_SUBMITTED' && run.sourceHash)
    return append(run, 'BRIDGE_SOURCE_CONFIRMED', 'MOCKED source receipt confirmed');
  if (run.state === 'BRIDGE_SOURCE_CONFIRMED') return append(run, 'BRIDGE_IN_PROGRESS', 'MOCKED bridge in progress');
  if (run.state === 'BRIDGE_IN_PROGRESS')
    return append(run, 'BRIDGE_DESTINATION_CONFIRMED', 'MOCKED Arbitrum USDC arrival observed; balance reconciliation required',
      { destinationHash: '0x' + run.bridge.rawHash.slice(2).split('').reverse().join(''),
        destinationObservation: { before: '0', after: ((BigInt(run.bridge.minimumOut) + BigInt(run.bridge.expectedOut)) / 2n).toString() } });
  fail();
}
export function reconcileMockedDestination(run: Build009Run, observation: { readonly owner: string; readonly token: string;
  readonly chainId: number; readonly sourceHash: string; readonly destinationHash: string;
  readonly before: string; readonly after: string }): Build009Run {
  if (run.state !== 'BRIDGE_DESTINATION_CONFIRMED' || !run.destinationObservation
    || observation.before !== run.destinationObservation.before || observation.after !== run.destinationObservation.after
    || observation.owner !== run.owner
    || observation.token !== run.bridge.toToken || observation.chainId !== 42161
    || observation.sourceHash !== run.sourceHash || observation.destinationHash !== run.destinationHash
    || !/^[0-9]+$/.test(observation.before) || !/^[0-9]+$/.test(observation.after)) fail();
  const received = BigInt(observation.after) - BigInt(observation.before);
  if (received < BigInt(run.bridge.minimumOut) || received > BigInt(run.bridge.expectedOut)) fail();
  return append(run, 'PARTIAL_COMPLETION', 'MOCKED bridge reconciled: destination USDC received; swap has not run', { received: received.toString() });
}
export function quoteDestination(run: Build009Run, quote: Build009Quote, hash: string): Build009Run {
  if (!['PARTIAL_COMPLETION', 'SWAP_QUOTED', 'SWAP_AUTHORIZED'].includes(run.state)
    || !run.received || quote.stage !== 'swap' || quote.owner !== run.owner || quote.amountIn !== run.received
    || !/^0x[0-9a-f]{64}$/.test(hash) || !quoteFresh(quote)) fail();
  return append(run, 'SWAP_QUOTED', 'Fresh live read-only destination quote for reconciled amount; prior authority retired',
    { swap: quote, swapManifestHash: hash });
}
export function authorizeSwap(run: Build009Run, owner: string, hash: string, nowMs = Date.now()): Build009Run {
  if (run.state !== 'SWAP_QUOTED' || !run.swap || run.owner !== owner || hash !== run.swapManifestHash
    || run.swap.amountIn !== run.received || !quoteFresh(run.swap, nowMs)) fail();
  return append(run, 'SWAP_AUTHORIZED', 'Fresh bounded MOCKED destination Manifest approved');
}
export function submitMockedSwap(run: Build009Run, uncertain: boolean, nowMs = Date.now()): Build009Run {
  if (run.state !== 'SWAP_AUTHORIZED' || !run.swap || run.swapAttemptId || !quoteFresh(run.swap, nowMs)) fail();
  const swapAttemptId = 'build009.swap.a1';
  return uncertain ? append(run, 'SWAP_UNKNOWN', 'MOCKED swap response unknown; recheck existing attempt, never resend', { swapAttemptId })
    : append(run, 'SWAP_SUBMITTED', 'MOCKED destination swap submitted', { swapAttemptId, swapHash: run.swap.rawHash });
}
export function recheckMockedSwap(run: Build009Run): Build009Run {
  if (run.state !== 'SWAP_UNKNOWN' || !run.swap || run.swapAttemptId !== 'build009.swap.a1') fail();
  return append(run, 'SWAP_SUBMITTED', 'MOCKED readback found existing swap attempt; no retry', { swapHash: run.swap.rawHash });
}
export function reconcileMockedSwap(run: Build009Run, observation: { readonly owner: string; readonly token: string;
  readonly chainId: number; readonly swapHash: string; readonly before: string; readonly after: string }): Build009Run {
  if (run.state !== 'SWAP_SUBMITTED' || !run.swap || observation.owner !== run.owner || observation.token !== run.swap.toToken
    || observation.chainId !== 42161 || observation.swapHash !== run.swapHash
    || !/^[0-9]+$/.test(observation.before) || !/^[0-9]+$/.test(observation.after)) fail();
  const received = BigInt(observation.after) - BigInt(observation.before);
  if (received < BigInt(run.swap.minimumOut) || received > BigInt(run.swap.expectedOut)) fail();
  return append(run, 'SWAP_RECONCILED', 'MOCKED Arbitrum WETH destination swap independently reconciled', { swapReceived: received.toString() });
}
export function validateRecoveredRun(value: unknown): Build009Run {
  if (!value || typeof value !== 'object') fail();
  const run = value as Build009Run;
  if (run.format !== 'gryloo.build009.mocked.v1' || !Array.isArray(run.events) || !run.events.length
    || run.events.at(-1)?.state !== run.state || run.events.some((event, i) => event.sequence !== i)
    || run.bridge.stage !== 'bridge' || run.bridge.owner !== run.owner || !/^0x[0-9a-f]{64}$/.test(run.bridgeManifestHash)) fail();
  return run;
}
