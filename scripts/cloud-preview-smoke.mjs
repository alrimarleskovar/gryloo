#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CLOUD-PARITY-001 remote smoke test of one deployed Flofi origin (a Vercel Preview or Production URL).
 *
 *   node scripts/cloud-preview-smoke.mjs <https origin> [--commit <sha>] [--simulate-account <0x public address>]
 *
 * Reads only. It loads the page, checks the CSP, reads `/api/flofi/readiness` (with the network probe), and calls read-only
 * server actions that the deployment's own client bundle declares (capability probes and live pool price reads through the
 * deployment's runtime). With `--simulate-account` it also runs one Simulate of a tiny Ethereum Sepolia native self-transfer for
 * that PUBLIC address and reads the durable run back: no key, no signature, no wallet, no transaction, nothing is ever sent.
 *
 * Vercel Authentication: when the owner has created a "Protection Bypass for Automation" secret, export it as
 * VERCEL_AUTOMATION_BYPASS_SECRET in your own shell; it is sent as a header and never printed. Without it a protected
 * deployment is reported as PROTECTED_BY_VERCEL_AUTHENTICATION.
 */
import { createNativeTransferNode } from '../packages/workflow-contracts/dist/index.js';

const args = process.argv.slice(2), flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const originArg = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--commit' && args[args.indexOf(a) - 1] !== '--simulate-account');
if (!originArg) { console.error('usage: node scripts/cloud-preview-smoke.mjs <https origin> [--commit <sha>] [--simulate-account <0x address>]'); process.exit(64); }
const origin = new URL(originArg);
const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
if (origin.protocol !== 'https:' && !(loopback && origin.protocol === 'http:') || origin.username || origin.password) { console.error('ORIGIN_INVALID'); process.exit(64); }
const expectedCommit = flag('--commit'), account = flag('--simulate-account');
if (account !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(account)) { console.error('SIMULATE_ACCOUNT_INVALID'); process.exit(64); }
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const base = { ...bypass ? { 'x-vercel-protection-bypass': bypass } : {} };
const url = path => new URL(path, origin).href;
const results = [];
const record = (name, pass, detail) => { results.push({ name, pass, ...detail }); };

async function get(path) {
  const response = await globalThis.fetch(url(path), { redirect: 'manual', headers: base, signal: globalThis.AbortSignal.timeout(60_000) });
  return { response, text: await response.text() };
}

// 1. The page.
const page = await get('/');
const location = page.response.headers.get('location') ?? '';
if (page.response.status >= 300 && page.response.status < 400 && /vercel\.com\/sso-api|_vercel_sso/.test(location)) {
  console.log(JSON.stringify({ origin: origin.origin, status: 'PROTECTED_BY_VERCEL_AUTHENTICATION', results: [] }, null, 2));
  process.exit(2);
}
record('page', page.response.status === 200 && /<title>Flofi/.test(page.text), { status: page.response.status });
record('csp-connect-self', /connect-src 'self'/.test(page.response.headers.get('content-security-policy') ?? ''), {});

// 2. Readiness, with the network probe.
const ready = await get('/api/flofi/readiness?probe=networks');
let report = null;
try { report = JSON.parse(ready.text); } catch { /* recorded below */ }
const secretShaped = /postgres(ql)?:\/\/|https?:\/\/|sk-[A-Za-z0-9]{8,}|Bearer /;
record('readiness', report !== null && report.service === 'flofi-web' && !secretShaped.test(ready.text), { status: ready.response.status,
  runtime: report?.runtime, deployment: report?.deployment, session: report?.session, copilot: report?.copilot });
if (expectedCommit) record('commit', report?.deployment?.commit === expectedCommit, { expected: expectedCommit, actual: report?.deployment?.commit ?? null });
record('runtime-ready', report?.runtime?.status === 'READY', { kind: report?.runtime?.kind, status: report?.runtime?.status });
record('flows', true, { flows: report?.flows ?? null, localOnly: report?.localOnly ?? null });
for (const [name, network] of Object.entries(report?.networks ?? {})) record(`network:${name}`, network.status === 'REACHABLE', network);

// 3. Read-only server actions declared by this deployment's own client bundle.
const scripts = [...new Set([...page.text.matchAll(/\/_next\/static\/[^"']+\.js/g)].map(m => m[0]))];
const actions = new Map();
for (const script of scripts) {
  const { text } = await get(script);
  for (const m of text.matchAll(/createServerReference\)\("([0-9a-f]{40,42})",[^,]+,void 0,[^,]+,"([A-Za-z0-9]+)"\)/g)) actions.set(m[2], m[1]);
}
record('server-actions-declared', actions.size > 0, { count: actions.size });
async function action(name, input) {
  const id = actions.get(name);
  if (!id) return { missing: true };
  const response = await globalThis.fetch(url('/'), { method: 'POST', redirect: 'manual', signal: globalThis.AbortSignal.timeout(300_000),
    headers: { ...base, 'next-action': id, 'content-type': 'text/plain;charset=UTF-8', accept: 'text/x-component' }, body: JSON.stringify(input) });
  const text = await response.text(), row = text.split('\n').find(line => line.startsWith('1:'));
  try { return { status: response.status, value: row ? JSON.parse(row.slice(2)) : null }; } catch { return { status: response.status, value: null }; }
}
const summary = value => value && typeof value === 'object' && 'ok' in value ? (value.ok ? { ok: true } : { ok: false, code: value.code }) : value;
for (const [name, input] of [['copilotStatus', []], ['walletSessionStatus', []], ['uniswapLiquidityMode', []],
  ['crossChainRouterMode', ['testnet']], ['publicAvailability', []], ['uniswapLiquidityInfo', []], ['solanaDevnetInfo', []]]) {
  const r = await action(name, input);
  record(`action:${name}`, !r.missing && r.status === 200, { value: summary(r.value) });
}
for (const [label, name, input] of [['price:base-sepolia', 'uniswapLiquidityPrice', ['eip155:84532']], ['price:ethereum-sepolia', 'uniswapLiquidityPrice', ['eip155:11155111']],
  ['price:solana-devnet', 'solanaLiquidityPrice', []]]) {
  const r = await action(name, input);
  record(`read:${label}`, r.status === 200 && r.value?.ok === true, { value: summary(r.value) });
}

// 4. Optional: one Simulate for a public address (no signature), then the durable run read back on a new request.
if (account) {
  const workflow = { schemaVersion: '1.0.0', workflowId: 'cloud-smoke', revision: 1, resourceEdges: [],
    nodes: [createNativeTransferNode('node-002', { chain: 'eip155:11155111', amount: '1000000000000', recipient: 'CONNECTED_OWNER' })] };
  const simulated = await action('transferSimulate', [workflow, account.toLowerCase()]);
  const id = simulated.value?.ok ? simulated.value.value?.id : null;
  record('simulate:ethereum-sepolia-transfer', Boolean(id), { value: summary(simulated.value), runId: id });
  if (id) {
    const status = await action('transferStatus', [id]);
    record('durable:read-back', status.value?.ok === true && status.value.value?.id === id && status.value.value?.attempt === null, { value: summary(status.value) });
  }
}

const failed = results.filter(r => !r.pass);
console.log(JSON.stringify({ origin: origin.origin, checkedAt: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 2));
process.exit(failed.length ? 1 : 0);
