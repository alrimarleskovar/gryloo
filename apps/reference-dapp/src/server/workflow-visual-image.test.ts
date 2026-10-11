// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-WORKFLOW-VISUAL-PRESENTATION-001: the one rasterizer. The same model and language give the same PNG bytes; the PNG has the
 * layout's exact size; English and Portuguese both draw; nothing is fetched (a fetch trap fails any non-`data:` request) and nothing
 * but the presentation model goes in; a picture that cannot be drawn is a closed error, or null for presentation surfaces.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STRATEGY_EXAMPLES } from '../engine/strategy-examples';
import { composeWorkflowOrRefuse } from '../platform/strategy.ts';
import { workflowVisualLayout } from '../platform/workflow-visual-layout.ts';
import { workflowVisualModel, type WorkflowVisualModel } from '../platform/workflow-visual.ts';
import { isPng, VISUAL_PNG_SCALE, VISUAL_PNG_WIDTH, workflowVisualPng, workflowVisualPngOrNull } from './workflow-visual-image.ts';

const visualOf = (strategy: unknown) => workflowVisualModel(composeWorkflowOrRefuse(strategy, undefined));
const size = (png: Uint8Array) => { const view = new DataView(png.buffer, png.byteOffset); return [view.getUint32(16), view.getUint32(20)]; };
const STEP_LIST = { version: 2, steps: [{ action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5' },
  { action: 'swap', network: 'solana-devnet', inputAsset: 'devUSDC', outputAsset: 'SOL', amount: '1' }] };

afterEach(() => { vi.unstubAllGlobals(); });

describe('BUILD-WORKFLOW-VISUAL-PRESENTATION-001 workflow visual PNG', () => {
  it('draws every example deterministically, at the layout\'s exact size, in English and Portuguese, without any network', async () => {
    const original = globalThis.fetch, requests: string[] = [];
    // Satori loads its own layout engine from a `data:` URL; any other request (a fallback font, an emoji) would be a network call.
    vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith('data:')) return original(input, init);
      requests.push(url);
      return Promise.reject(new Error('NETWORK_FORBIDDEN_IN_RENDERING'));
    });
    const models = [...STRATEGY_EXAMPLES.map(e => visualOf(e.strategy)), visualOf(STEP_LIST)];
    for (const model of models) for (const language of ['EN', 'PT'] as const) {
      const [a, b] = [await workflowVisualPng(model, language), await workflowVisualPng(model, language)];
      const layout = workflowVisualLayout(model, language, VISUAL_PNG_SCALE);
      expect(isPng(a.bytes)).toBe(true);
      expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
      expect(size(a.bytes)).toEqual([VISUAL_PNG_WIDTH, layout.height]);
      expect([a.width, a.height, a.mimeType, a.language, a.alt]).toEqual([VISUAL_PNG_WIDTH, layout.height, 'image/png', language, layout.alt]);
      expect(a.bytes.length).toBeLessThan(1_000_000);
    }
    expect(requests).toEqual([]);
  }, 120_000);

  it('draws English and Portuguese differently from the same model, and a different workflow differently', async () => {
    const model = visualOf(STEP_LIST), other = visualOf(STRATEGY_EXAMPLES[0]!.strategy);
    const [en, pt, third] = [await workflowVisualPng(model, 'EN'), await workflowVisualPng(model, 'PT'), await workflowVisualPng(other, 'EN')];
    expect(Buffer.from(en.bytes).equals(Buffer.from(pt.bytes))).toBe(false);
    expect(Buffer.from(en.bytes).equals(Buffer.from(third.bytes))).toBe(false);
    expect(pt.alt).toMatch(/^Fluxo FloFi: Transferir entre redes → Trocar\./);
  });

  it('refuses what it cannot draw with a closed code, and presentation surfaces get null instead of an error', async () => {
    const model = visualOf(STRATEGY_EXAMPLES[0]!.strategy);
    const empty: WorkflowVisualModel = { ...model, steps: [], connections: [] };
    await expect(workflowVisualPng(empty, 'EN')).rejects.toThrow('WORKFLOW_VISUAL_EMPTY');
    const huge: WorkflowVisualModel = { ...model, steps: Array.from({ length: 200 }, (_, i) => ({ ...model.steps[0]!, id: `s${i + 1}`, index: i + 1 })) };
    await expect(workflowVisualPng(huge, 'EN')).rejects.toThrow('WORKFLOW_VISUAL_TOO_LARGE');
    expect(await workflowVisualPngOrNull(empty, 'EN')).toBeNull();
    expect(await workflowVisualPngOrNull(huge, 'PT')).toBeNull();
  });
});
