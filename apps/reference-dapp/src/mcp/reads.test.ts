// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { CloudRun } from '../server/flow-runtime';
import { credential, gatewayEnv, session } from './gateway.test-harness';
import type { McpRuntime } from './runtime';

const A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const H = (c: string) => '0x' + c.repeat(64);
const bundle = { schemaVersion: '1.0.0', evidenceBundleId: 'router.evidence.test', version: 1, supersedes: null, semanticWorkflowHash: H('1'), artifactSetHash: H('2'),
  simulationHash: H('3'), policyHash: H('4'), manifestHash: H('5'), executionPlanHash: H('6'), journalHeadHash: H('7'), observedAt: '2026-10-06T00:00:00.000Z',
  environment: 'TESTNET_EXECUTED', outcome: 'RECONCILED', receipts: [{ receiptId: 'source', contentHash: H('8') }], differences: [],
  reconciliation: { balances: [], allowances: [], debt: [], positions: [], fees: [], residualAssets: [], ownership: [], limitations: [] }, evidence: [] };
const run = (runId: string, owner: string, extra: Partial<CloudRun> = {}): CloudRun & Record<string, unknown> => ({ runId, workflowId: 'workflow-local',
  flow: 'crosschain-router-testnet', status: 'RECONCILED', provenance: 'PUBLIC_TESTNET', ownerAccount: owner, errorCode: null, needsObservation: false, attentionRequired: false,
  hasEvidence: true, createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:05:00.000Z', namespace: 'crosschain-router-testnet', logName: runId + '.jsonl', version: 7,
  attempts: [{ attemptId: runId + '.deposit.2', step: 'DEPOSIT', state: 'CONFIRMED', nonce: '41', transactionHash: H('9'), preparedAtBlock: '100', reconciled: true, updatedAt: '2026-10-06T00:04:00.000Z' }],
  ...extra });
/** A durable store with runs of two wallets; every read records the owner it was made as. */
function store(evidenceContent: unknown = { bundle, bundleHash: H('a'), evidenceClass: 'TESTNET_EXECUTED' }) {
  const runs = new Map([['xroute-' + 'a'.repeat(32), run('xroute-' + 'a'.repeat(32), A)], ['xroute-' + 'b'.repeat(32), run('xroute-' + 'b'.repeat(32), B)],
    ['xroute-' + 'c'.repeat(32), run('xroute-' + 'c'.repeat(32), A, { hasEvidence: false, status: 'IN_FLIGHT' })]]);
  const readsAs: string[] = [];
  const runtime: McpRuntime = { kind: 'embedded', mode: async () => 'live', preview: async () => ({ ok: false, code: 'UNUSED' }),
    run: async (id, owner) => { readsAs.push(owner); const r = runs.get(id); return { ok: true, value: r && r.ownerAccount === owner ? r : null }; },
    journal: async (id, owner) => { const r = runs.get(id); return { ok: true, value: r && r.ownerAccount === owner ? { items: [{ sequence: 0, entryHash: H('c'), level: 'workflow',
      entityId: 'workflow-local', attemptId: null, fromState: null, toState: 'DRAFT', recordedAt: '2026-10-06T00:00:00.000Z', tenantSecret: 'x' }], next: null } : null }; },
    evidence: async (_flow, id, owner) => { readsAs.push(owner); return { ok: true, value: runs.get(id)?.ownerAccount === owner ? { bundleHash: H('a'), environment: 'TESTNET_EXECUTED', outcome: 'RECONCILED', content: evidenceContent } : null }; } };
  return { runtime, readsAs };
}
const alice = { principal: 'dev-alice', token: credential(), wallets: [A] }, carol = { principal: 'dev-carol', token: credential() };
const env = gatewayEnv([alice, carol]);

describe('BUILD-MCP-001 get_execution_status / get_evidence: owner-scoped reads', () => {
  it('shows a run owned by a wallet the deployment owner granted to this credential, as FloFi recorded it', async () => {
    const { runtime, readsAs } = store();
    const status = (await session({ env, token: alice.token, runtime }).callTool('get_execution_status', { executionId: 'xroute-' + 'a'.repeat(32) })).output;
    expect(status).toMatchObject({ ok: true, executionId: 'xroute-' + 'a'.repeat(32), flow: 'crosschain-router-testnet', status: 'RECONCILED', provenance: 'PUBLIC_TESTNET',
      owner: A, accessBasis: 'OPERATOR_GRANTED_WALLET', hasEvidence: true });
    expect(status.attempts).toEqual([{ attemptId: 'xroute-' + 'a'.repeat(32) + '.deposit.2', step: 'DEPOSIT', state: 'CONFIRMED', transactionHash: H('9'), reconciled: true,
      preparedAtBlock: '100', updatedAt: '2026-10-06T00:04:00.000Z' }]);
    expect(JSON.stringify(status)).not.toMatch(/tenantSecret|logName|namespace|"nonce"/);
    expect(readsAs).toEqual([A]);
  });

  it('treats another wallet\'s run, an unknown id and an ungranted credential identically: not found', async () => {
    const { runtime, readsAs } = store();
    for (const [token, id] of [[alice.token, 'xroute-' + 'b'.repeat(32)], [alice.token, 'xroute-' + 'f'.repeat(32)], [carol.token, 'xroute-' + 'a'.repeat(32)]] as const) {
      for (const tool of ['get_execution_status', 'get_evidence']) {
        const result = await session({ env, token, runtime }).callTool(tool, { executionId: id });
        expect(result, `${tool} ${id}`).toMatchObject({ isError: true, output: { ok: false, code: 'RUN_NOT_FOUND' } });
      }
    }
    // The credential without grants never reads anything; the granted one only ever reads as its own wallet.
    expect(new Set(readsAs)).toEqual(new Set([A]));
  });

  it('returns the canonical Evidence Bundle with its own environment and outcome, never upgraded', async () => {
    const { runtime } = store();
    const evidence = (await session({ env, token: alice.token, runtime }).callTool('get_evidence', { executionId: 'xroute-' + 'a'.repeat(32) })).output;
    expect(evidence).toMatchObject({ ok: true, owner: A, evidence: { bundleHash: H('a'), environment: 'TESTNET_EXECUTED', outcome: 'RECONCILED', canonical: true,
      canonicalBundle: { environment: 'TESTNET_EXECUTED', outcome: 'RECONCILED', receipts: [{ receiptId: 'source' }] } } });
    const pending = (await session({ env, token: alice.token, runtime }).callTool('get_evidence', { executionId: 'xroute-' + 'c'.repeat(32) })).output;
    expect(pending).toMatchObject({ ok: true, status: 'IN_FLIGHT', evidence: null, reason: 'NO_RECONCILED_EVIDENCE_YET' });
    const odd = store({ bundle: { ...bundle, environment: 'MAINNET_EXECUTED_PLUS' } });
    const unverified = (await session({ env, token: alice.token, runtime: odd.runtime }).callTool('get_evidence', { executionId: 'xroute-' + 'a'.repeat(32) })).output;
    expect(unverified).toMatchObject({ ok: true, evidence: { canonical: false, canonicalBundle: null, environment: 'TESTNET_EXECUTED' } });
  });

  it('rejects malformed execution ids by schema and propagates runtime failures as codes', async () => {
    const { runtime } = store();
    for (const executionId of ['../etc/passwd', 'a b', '', 'x'.repeat(200)]) {
      const result = await session({ env, token: alice.token, runtime }).callTool('get_execution_status', { executionId });
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/\/executionId (pattern|minLength|maxLength)/);
    }
    const local: McpRuntime = { ...runtime, kind: 'local', run: async () => ({ ok: false, code: 'MCP_CLOUD_RUNTIME_REQUIRED' }) };
    expect((await session({ env, token: alice.token, runtime: local }).callTool('get_execution_status', { executionId: 'xroute-' + 'a'.repeat(32) })).output)
      .toEqual({ ok: false, code: 'MCP_CLOUD_RUNTIME_REQUIRED' });
  });
});
