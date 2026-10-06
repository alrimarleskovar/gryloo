// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authenticate, readMcpConfig } from './config';
import { credential, digest, gatewayEnv, memoryLogger, session } from './gateway.test-harness';
import { MCP_TOOL_NAMES } from './tools';
import { STRATEGY_EXAMPLES } from '../engine/strategy-examples';

const OWNER = '0x1111111111111111111111111111111111111111';
const BRIDGE = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5', routing: 'auto' };
const alice = { principal: 'dev-alice', token: credential(), wallets: [OWNER] };
const env = gatewayEnv([alice]);
afterEach(() => { vi.restoreAllMocks(); });

describe('BUILD-MCP-001 gateway: enablement and authentication fail closed', () => {
  it('is off unless explicitly enabled with a valid client configuration', async () => {
    expect((await session({ env: {}, token: alice.token }).post({})).status).toBe(404);
    expect(readMcpConfig({ FLOFI_MCP: 'true' })).toEqual({ enabled: false, code: 'MCP_NOT_ENABLED' });
    for (const clients of ['', 'not json', '[]', '{}', JSON.stringify([{ principal: 'x', tokenSha256: digest(alice.token) }]),
      JSON.stringify([{ principal: 'dev-alice', tokenSha256: 'abc' }]), JSON.stringify([{ principal: 'dev-alice', tokenSha256: digest('a'), wallets: ['0xABC'] }]),
      JSON.stringify([{ principal: 'dev-alice', tokenSha256: digest('a'), role: 'admin' }]),
      JSON.stringify([{ principal: 'dev-alice', tokenSha256: digest('a') }, { principal: 'dev-bob', tokenSha256: digest('a') }])]) {
      expect(readMcpConfig({ FLOFI_MCP: 'enabled', FLOFI_MCP_CLIENTS: clients }), clients).toEqual({ enabled: false, code: 'MCP_CONFIGURATION_INVALID' });
    }
    const broken = await session({ env: { FLOFI_MCP: 'enabled', FLOFI_MCP_CLIENTS: 'not json' }, token: alice.token }).post({});
    expect(broken.status).toBe(503);
    expect(broken.text).not.toContain('not json');
  });

  it('never accepts the internal API credential, as configuration or as a bearer token', async () => {
    const internal = credential();
    expect(readMcpConfig({ ...gatewayEnv([{ principal: 'dev-ops', token: internal }]), API_AUTH_TOKEN: internal })).toEqual({ enabled: false, code: 'MCP_CONFIGURATION_INVALID' });
    const withInternal = { ...env, API_AUTH_TOKEN: internal };
    expect((await session({ env: withInternal, token: internal }).post({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(401);
  });

  it('rejects missing, malformed, unknown and weak credentials with 401 and never echoes them', async () => {
    const logger = memoryLogger();
    const weak = 'short-token';
    const weakEnv = gatewayEnv([alice, { principal: 'dev-weak', token: weak }]);
    for (const [token, headers] of [[null, {}], ['wrong-' + credential(), {}], [weak, {}], [alice.token, { authorization: `Basic ${alice.token}` }],
      [alice.token, { authorization: `Bearer ${alice.token} extra` }]] as const) {
      const response = await session({ env: weakEnv, token, logger }).post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, headers);
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Bearer realm="flofi-mcp"');
      expect(response.text).toEqual(JSON.stringify({ ok: false, code: 'MCP_UNAUTHORIZED' }));
    }
    expect(JSON.stringify(logger.lines)).not.toContain(alice.token);
    const config = readMcpConfig(env);
    if (!config.enabled) throw new Error('config');
    expect(authenticate(config, `Bearer ${alice.token}`)).toEqual({ kind: 'mcp-credential', id: 'dev-alice', tenantId: 'default', wallets: [OWNER] });
  });

  it('scopes the principal to the deployment tenant (Preview branches get their own)', () => {
    const config = readMcpConfig({ ...env, VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'claude/build-mcp-001' });
    if (!config.enabled) throw new Error('config');
    expect(authenticate(config, `Bearer ${alice.token}`)?.tenantId).toMatch(/^pv-claude-build-mcp-001-[0-9a-f]{8}$/);
    expect(readMcpConfig({ ...env, VERCEL: '1', VERCEL_ENV: 'preview' })).toEqual({ enabled: false, code: 'MCP_CONFIGURATION_INVALID' });
  });

  it('refuses browser origins that are not allowed (DNS rebinding) and oversized bodies', async () => {
    const client = session({ env: { ...env, FLOFI_MCP_ALLOWED_ORIGINS: 'https://inspector.example' }, token: alice.token });
    expect((await client.post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await client.post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { origin: 'https://inspector.example', 'mcp-protocol-version': '2025-11-25' })).status).toBe(200);
    expect((await session({ env, token: alice.token }).post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { origin: 'http://localhost:3000' })).status).toBe(403);
    const big = await session({ env, token: alice.token }).post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'compose_strategy', arguments: { pad: 'x'.repeat(70_000) } } });
    expect(big.status).toBe(413);
  });
});

describe('BUILD-MCP-001 gateway: protocol and tool surface', () => {
  const client = () => session({ env, token: alice.token });

  it('completes the 2025-era stateless handshake and lists exactly the nine read-only tools', async () => {
    for (const protocolVersion of ['2025-11-25', '2025-06-18']) {
      const init = await client().request('initialize', { protocolVersion, capabilities: {}, clientInfo: { name: 'test', version: '1' } });
      expect(init.result).toMatchObject({ protocolVersion, serverInfo: { name: 'flofi' }, capabilities: { tools: {} } });
      expect(String((init.result as { instructions: string }).instructions)).toMatch(/authorizes anything|no tool signs/);
    }
    const tools = ((await client().request('tools/list')).result as { tools: { name: string; inputSchema: Record<string, unknown>; annotations: Record<string, unknown> }[] }).tools;
    expect(tools.map(t => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    for (const tool of tools) {
      expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(tool.name).not.toMatch(/send|sign|submit|execute|approve|authorize|transfer|withdraw_funds|key|seed/i);
    }
  });

  it('serves the 2026-07-28 revision too (server/discover, tools/list, tools/call)', async () => {
    const discover = await client().request('server/discover', {}, { modern: true });
    expect((discover.result as { supportedVersions: string[] }).supportedVersions).toContain('2026-07-28');
    expect(((await client().request('tools/list', {}, { modern: true })).result as { tools: unknown[] }).tools).toHaveLength(9);
    const call = await client().request('tools/call', { name: 'get_supported_networks', arguments: {} }, { modern: true });
    expect((call.result as { structuredContent: { networks: unknown[] } }).structuredContent.networks.length).toBe(7);
  });

  it('exposes no input field for calldata, contract targets, chain ids, keys, signatures or transactions', async () => {
    const tools = ((await client().request('tools/list')).result as { tools: { inputSchema: unknown }[] }).tools;
    const names = new Set<string>();
    const walk = (value: unknown) => {
      if (Array.isArray(value)) { value.forEach(walk); return; }
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      if (record.properties && typeof record.properties === 'object') Object.keys(record.properties).forEach(k => names.add(k));
      Object.values(record).forEach(walk);
    };
    tools.forEach(t => walk(t.inputSchema));
    for (const forbidden of ['data', 'calldata', 'to', 'target', 'contract', 'chainId', 'privateKey', 'mnemonic', 'seed', 'signature', 'transaction', 'rawTransaction', 'nonce', 'from', 'value', 'gas'])
      expect(names.has(forbidden), forbidden).toBe(false);
  });

  it('has no arbitrary-transaction, signing or execution tool', async () => {
    for (const name of ['send_transaction', 'send_arbitrary_transaction', 'sign_transaction', 'sign_message', 'execute_strategy', 'request_user_approval', 'create_strategy_manifest', 'recover_execution']) {
      const message = await client().request('tools/call', { name, arguments: {} });
      expect(message.result).toBeUndefined();
      expect((message.error as { code: number }).code).toBe(-32602);
    }
  });

  it('composes deterministically over MCP and fails closed on unsupported input', async () => {
    const first = await client().callTool('compose_strategy', { strategy: BRIDGE }), second = await client().callTool('compose_strategy', { strategy: BRIDGE });
    expect(first.isError).toBe(false);
    expect(first.output).toMatchObject({ ok: true, revision: 1, fundsClass: 'TEST_FUNDS', strategy: { ...BRIDGE, version: 1, slippageBps: 50 } });
    expect(first.output.workflowHash).toBe(second.output.workflowHash);
    expect(first.text).toBe(second.text);
    const mixed = await client().callTool('compose_strategy', { strategy: { ...BRIDGE, destinationNetwork: 'arbitrum-one' } });
    expect(mixed).toMatchObject({ isError: true, output: { ok: false, code: 'ROUTER_PAIR_UNSUPPORTED' } });
    const injected = await client().callTool('compose_strategy', { strategy: { ...BRIDGE, calldata: '0xa9059cbb', to: OWNER } });
    expect(injected.isError).toBe(true);
    expect(injected.text).toMatch(/\/strategy\/calldata additionalProperties/);
    expect(injected.text).not.toContain('0xa9059cbb');
    const bad = await client().callTool('compose_strategy', { strategy: { ...BRIDGE, amount: '5 USDC' } });
    expect(bad.text).toMatch(/\/strategy\/amount pattern/);
  });

  it('validates and reviews with hash binding, never authorizing', async () => {
    const composed = (await client().callTool('compose_strategy', { strategy: BRIDGE })).output;
    const valid = await client().callTool('validate_strategy', { strategy: BRIDGE, workflowHash: composed.workflowHash });
    expect(valid.output).toMatchObject({ ok: true, valid: true, workflowHash: composed.workflowHash });
    const stale = await client().callTool('validate_strategy', { strategy: { ...BRIDGE, amount: '4' }, workflowHash: composed.workflowHash });
    expect(stale.output).toMatchObject({ ok: true, valid: false, code: 'STRATEGY_WORKFLOW_HASH_MISMATCH' });
    const tooMuch = await client().callTool('validate_strategy', { strategy: { ...BRIDGE, amount: '500' } });
    expect(tooMuch.output).toMatchObject({ valid: false, code: expect.stringMatching(/AMOUNT/) });
    const review = await client().callTool('review_strategy', { strategy: BRIDGE, workflowHash: composed.workflowHash });
    expect(review.output).toMatchObject({ ok: true, reviewKind: 'DETERMINISTIC_STRATEGY_REVIEW', authority: expect.stringMatching(/^NONE/) });
    expect((review.output.findings as { code: string }[]).map(f => f.code)).toEqual(expect.arrayContaining(['ROUTER_ROUTE_REQUIRED', 'OWNER_APPROVAL_REQUIRED']));
    const conflict = await client().callTool('review_strategy', { strategy: { ...BRIDGE, amount: '4' }, workflowHash: composed.workflowHash });
    expect(conflict.output).toMatchObject({ ok: false, code: 'STRATEGY_WORKFLOW_HASH_MISMATCH' });
  });

  it('composes, validates and reviews every supported action × network over MCP, each output passing the safety guard', async () => {
    for (const { id, strategy } of STRATEGY_EXAMPLES) {
      const composed = await client().callTool('compose_strategy', { strategy });
      expect(composed.isError, `${id}: ${composed.text.slice(0, 200)}`).toBe(false);
      const valid = await client().callTool('validate_strategy', { strategy, workflowHash: composed.output.workflowHash });
      expect(valid.output, id).toMatchObject({ ok: true, valid: true });
      const review = await client().callTool('review_strategy', { strategy, workflowHash: composed.output.workflowHash });
      expect(review.isError, `${id}: ${review.text.slice(0, 200)}`).toBe(false);
      expect((review.output.findings as { code: string }[]).map(f => f.code), id).toContain('OWNER_APPROVAL_REQUIRED');
    }
  });

  it('discovers networks, assets and capabilities from registries, honestly', async () => {
    const assets = (await client().callTool('get_supported_assets', { network: 'arbitrum-sepolia' })).output.assets as { symbol: string; actions: string[] }[];
    expect(assets).toEqual([expect.objectContaining({ symbol: 'USDC', actions: ['bridge'] })]);
    const caps = (await client().callTool('get_capabilities', { network: 'base-sepolia', action: 'bridge' })).output;
    // Local runtime (no cloud runtime configured in this test): previews are not offered, execution never is.
    expect(caps).toMatchObject({ runtime: 'local', mcpExecution: 'NOT_AVAILABLE' });
    expect((caps.capabilities as Record<string, unknown>[])[0]).toMatchObject({ demonstratedEvidence: 'NONE_DEMONSTRATED',
      mcp: { compose: true, simulate: false, simulateUnavailableReason: 'MCP_CLOUD_RUNTIME_REQUIRED', execute: false } });
  });

  it('logs metadata only: principal, tool, outcome, duration', async () => {
    const logger = memoryLogger();
    await session({ env, token: alice.token, logger }).callTool('compose_strategy', { strategy: { ...BRIDGE, recipient: OWNER } });
    expect(logger.lines).toEqual([{ event: 'mcp.tool', fields: { principal: 'dev-alice', tenant: 'default', tool: 'compose_strategy', outcome: 'OK', duration_ms: expect.any(Number) } }]);
    expect(JSON.stringify(logger.lines)).not.toContain(OWNER);
  });
});

describe('BUILD-MCP-001 gateway: no FloFi-owned model is ever called', () => {
  it('makes no network request at all for discovery, compose, validate and review', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = session({ env: { ...env, OPENAI_API_KEY: 'sk-test-not-used', FLOFI_COPILOT: 'live', OPENAI_COPILOT_MODEL: 'gpt-test' }, token: alice.token });
    await client.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    for (const [tool, args] of [['get_supported_networks', {}], ['get_supported_assets', {}], ['get_capabilities', {}], ['compose_strategy', { strategy: BRIDGE }],
      ['validate_strategy', { strategy: BRIDGE }], ['review_strategy', { strategy: BRIDGE }], ['simulate_strategy', { strategy: BRIDGE, workflowHash: '0x' + '0'.repeat(64), simulationSubject: OWNER }]] as const)
      await client.callTool(tool, args);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('imports no model client: the MCP and engine sources never reference OpenAI, Anthropic or the Copilot', () => {
    for (const dir of ['src/mcp', 'src/engine', 'src/app/api/mcp']) {
      const root = join(__dirname, '..', '..', dir);
      for (const file of readdirSync(root).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
        const source = readFileSync(join(root, file), 'utf8');
        // BUILD-MCP-002: `openai/…` is the MCP Apps metadata namespace ChatGPT reads (`_meta["openai/outputTemplate"]`), not a model
        // client; the guard targets model clients precisely (SDK imports, API hosts, API keys, the Copilot). See also
        // `oauth/no-model.test.ts`, which scans every MCP-002 source recursively.
        expect(source, file).not.toMatch(/from ['"](openai|@anthropic-ai\/[a-z-]+|@ai-sdk\/[a-z-]+)['"]|api\.openai\.com|api\.anthropic\.com|copilot-service|copilot-action|OPENAI_API_KEY|ANTHROPIC_API_KEY/i);
      }
    }
  });
});
