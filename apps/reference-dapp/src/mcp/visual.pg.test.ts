// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-WORKFLOW-VISUAL-PRESENTATION-001: how MCP presents a workflow, on a disposable loopback PostgreSQL with an OAuth consumer and a
 * MOCKED-harness runtime (every engine call recorded; nothing may execute).
 *
 *   request_user_approval  content[0] = the same JSON text as before, `structuredContent` = every previous field + `visual`; then a
 *                          readable summary with the public Open in FloFi link (hosts without MCP Apps or images), the PNG as standard
 *                          image content (audience: user), and the panel's layout in `_meta['flofi/visual']` (UI-only)
 *   compose_strategy       the same, without the picture: iterating stays cheap for the model's context
 *   refusals               unchanged: one JSON text block, no picture
 * The approval's secret link stays only in `_meta['flofi/approval']`, exactly as before; no presentation block carries it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';
import type { FlowName } from '../../backend/flows.ts';
import { composeWorkflowOrRefuse } from '../platform/strategy.ts';
import { workflowVisualLayout } from '../platform/workflow-visual-layout.ts';
import { workflowVisualModel } from '../platform/workflow-visual.ts';
import { isPng } from '../server/workflow-visual-image.ts';
import { credential, gatewayEnv, session } from './gateway.test-harness.ts';
import { oauthClient, oauthEnv, ORIGIN, signIn } from './oauth/oauth-test-harness.ts';
import { createPgOAuthStore } from './oauth/pg-store.ts';
import { stateOf } from './oauth/state.ts';
import type { McpRuntime } from './runtime.ts';

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });
const env = (extra: Record<string, string> = {}) => ({ FLOFI_MCP: 'enabled', ...oauthEnv(extra) });
function runtime(calls: string[]): McpRuntime {
  const modes: Partial<Record<FlowName, 'harness'>> = { 'crosschain-router-testnet': 'harness', 'aave-supply': 'harness', 'lending-composition': 'harness' };
  const never = async (): Promise<never> => { calls.push('EXECUTION_PATH'); throw new Error('NEVER'); };
  return { kind: 'embedded', mode: async flow => { calls.push(`mode:${flow}`); return modes[flow] ?? 'off'; },
    info: async flow => { calls.push(`info:${flow}`); return { executionEnabled: true }; }, preview: never, run: never, journal: never, evidence: never };
}
type Block = { type: string; text?: string; data?: string; mimeType?: string; annotations?: { audience?: string[] } };
type Result = { content: Block[]; structuredContent: Record<string, unknown>; isError?: boolean; _meta?: Record<string, unknown> };
async function consumer(calls: string[] = []) {
  const tokens = await signIn(oauthClient({ env: env(), store: createPgOAuthStore(t.db, 'default') }));
  const client = session({ env: env(), token: tokens.access_token, state: stateOf({ db: t.db, tenantId: 'default' }), runtime: runtime(calls) });
  const call = async (name: string, args: Record<string, unknown>) => (await client.request('tools/call', { name, arguments: args })).result as Result;
  return { call };
}
const OWNER = '0x1111111111111111111111111111111111111111';
const BRIDGE = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5' };
const LENDING = { action: 'lending_composition', network: 'base-sepolia', asset: 'USDC', supplyAmount: '10', borrowAmount: '2', outputAsset: 'WETH', owner: OWNER };

describe('BUILD-WORKFLOW-VISUAL-PRESENTATION-001 MCP workflow presentation', () => {
  it('request_user_approval: the same JSON first, then a readable summary with Open in FloFi, the PNG and the panel layout — the secret only where it was', async () => {
    const calls: string[] = [], { call } = await consumer(calls);
    for (const strategy of [BRIDGE, LENDING]) {
      const composed = composeWorkflowOrRefuse(strategy, undefined), result = await call('request_user_approval', { strategy, workflowHash: composed.workflowHash });
      const out = result.structuredContent;
      expect(result.isError ?? false).toBe(false);
      // Backwards compatible: the first block is still the JSON of structuredContent, whose existing fields are unchanged.
      expect(result.content[0]).toEqual({ type: 'text', text: JSON.stringify(out) });
      expect(out).toMatchObject({ ok: true, approvalId: expect.stringMatching(/^apr_[a-z2-7]{26}$/), workflowHash: composed.workflowHash, status: 'PENDING', authority: 'NONE',
        requires: ['Open FloFi', 'Prove wallet ownership', 'Fresh simulation', 'Strategy Manifest Review', 'Explicit wallet signature'] });
      expect(out.approvalUrl).toBe(`${ORIGIN}/approve#${String(out.approvalId)}`);
      // The visual is the shared projection of exactly the handed-off workflow.
      expect(out.visual).toEqual(JSON.parse(JSON.stringify(workflowVisualModel(composed))));
      expect((out.visual as { workflowHash: string }).workflowHash).toBe(out.workflowHash);
      // Fallback host: a concise summary with the public Open in FloFi link.
      expect(result.content[1]!.type).toBe('text');
      expect(result.content[1]!.text).toMatch(/^FloFi workflow: .*Nothing is authorized yet|^FloFi workflow: [\s\S]*nothing is authorized yet[\s\S]*\nOpen in FloFi: /);
      expect(result.content[1]!.text!.endsWith(`\nOpen in FloFi: ${ORIGIN}/approve#${String(out.approvalId)}`)).toBe(true);
      // Hosts that show images: the deterministic PNG, meant for the user.
      const image = result.content[2]!;
      expect([result.content.length, image.type, image.mimeType, image.annotations?.audience]).toEqual([3, 'image', 'image/png', ['user']]);
      expect(isPng(new Uint8Array(Buffer.from(image.data!, 'base64')))).toBe(true);
      // MCP Apps hosts: the panel paints the same layout (UI-only metadata), next to the private links it always had.
      const meta = result._meta!, visual = meta['flofi/visual'] as { tree: unknown; width: number; height: number; alt: string };
      const layout = workflowVisualLayout(workflowVisualModel(composed), 'EN');
      expect(visual).toEqual(JSON.parse(JSON.stringify({ tree: layout.tree, width: layout.width, height: layout.height, alt: layout.alt, title: layout.title })));
      expect(String((meta['flofi/approval'] as { approvalUrl: string }).approvalUrl)).toMatch(new RegExp(`^${ORIGIN}/approve#flofi_hs_[A-Za-z0-9_-]{43}$`));
      expect(JSON.stringify([result.content, out, visual])).not.toMatch(/flofi_hs_|flofi_(at|rt|code)_|walletLinks|Bearer/);
      // The presentation itself shows addresses shortened only (the normalized `strategy` field keeps the caller's own input, as before).
      expect(JSON.stringify([result.content[1], out.visual, visual]).replace(composed.workflowHash, '')).not.toMatch(/0x[0-9a-fA-F]{40}/);
    }
    expect(calls.every(c => c.startsWith('mode:') || c.startsWith('info:'))).toBe(true);
  });

  it('compose_strategy: same JSON first, the visual model added, a readable summary — no picture while a model iterates', async () => {
    const { call } = await consumer();
    for (const strategy of [BRIDGE, { version: 2, steps: [BRIDGE, { action: 'swap', network: 'solana-devnet', inputAsset: 'devUSDC', outputAsset: 'SOL', amount: '1' }] }]) {
      const result = await call('compose_strategy', { strategy }), composed = composeWorkflowOrRefuse(strategy, undefined);
      expect(result.content.map(b => b.type)).toEqual(['text', 'text']);
      expect(result.content[0]!.text).toBe(JSON.stringify(result.structuredContent));
      expect(result.structuredContent).toMatchObject({ ok: true, workflowHash: composed.workflowHash, authority: expect.stringMatching(/^NONE/) });
      expect(result.structuredContent.visual).toEqual(JSON.parse(JSON.stringify(workflowVisualModel(composed))));
      expect(result.content[1]!.text).toMatch(/^FloFi workflow: /);
      expect(result._meta?.['flofi/visual']).toBeUndefined();
    }
    // A static developer credential (BUILD-MCP-001) gets the same composition presentation.
    const alice = { principal: 'dev-alice', token: credential() }, legacy = session({ env: gatewayEnv([alice]), token: alice.token });
    const composed = (await legacy.request('tools/call', { name: 'compose_strategy', arguments: { strategy: BRIDGE } })).result as Result;
    expect(composed.content.map(b => b.type)).toEqual(['text', 'text']);
    expect(composed.structuredContent.visual).toMatchObject({ workflowHash: composeWorkflowOrRefuse(BRIDGE, undefined).workflowHash });
  });

  it('a refused approval or composition is unchanged: one JSON text block, no visual, no picture', async () => {
    const { call } = await consumer();
    const wrongHash = await call('request_user_approval', { strategy: BRIDGE, workflowHash: '0x' + '1'.repeat(64) });
    expect([wrongHash.isError, wrongHash.content.length, wrongHash.structuredContent.visual, wrongHash._meta]).toEqual([true, 1, undefined, undefined]);
    const mainnet = await call('request_user_approval', { strategy: { ...BRIDGE, sourceNetwork: 'base', destinationNetwork: 'arbitrum-one' },
      workflowHash: composeWorkflowOrRefuse({ ...BRIDGE, sourceNetwork: 'base', destinationNetwork: 'arbitrum-one' }, undefined).workflowHash });
    expect([mainnet.isError, mainnet.content.length, mainnet.structuredContent.visual, mainnet._meta]).toEqual([true, 1, undefined, undefined]);
    const unsupported = await call('compose_strategy', { strategy: { action: 'swap', network: 'base', inputAsset: 'USDC', outputAsset: 'USDC', amount: '1' } });
    expect([unsupported.isError, unsupported.content.length]).toEqual([true, 1]);
  });
});
