#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-ROUTER-001 real READ-ONLY preflight on Base mainnet and Arbitrum One. No wallet, no key, no signature, no
 * transaction. It runs the production router service (`router-service.ts`) on a temporary file store with the production
 * read-only RPC clients (send methods are not even allowlisted) and the production LI.FI / Across adapters, and records:
 *   - both providers' live quotes for the canonical Base USDC → Arbitrum USDC intent, normalized into the canonical route
 *     (calldata decoded independently and cross-checked against each API summary), and the selection made at quote time;
 *   - a real `eth_simulateV1` of the exact approval + bridge deposit on Base, with the simulated Across `FundsDeposited`
 *     decoded and matched to the reviewed route, the route commitment and the route-bound Manifest;
 *   - the unrestricted LI.FI answer (any bridge) and the router's refusal of a bridge it cannot reconcile;
 *   - Review acceptance and the refusal to begin, because owner execution is not enabled here.
 * The simulated owner is the public address 0x1111…1111, which holds USDC and ETH on Base. Simulating from an address
 * needs no authority over it; nothing is signed or sent.
 * Usage: node scripts/router-readonly-preflight.mjs [output.json]
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRouterBridgeNode } from '../apps/reference-dapp/node_modules/@defi-workflow-engine/workflow-contracts/dist/index.js';
import { CROSSCHAIN_ROUTER_BASE_ARBITRUM as profile } from '../apps/reference-dapp/node_modules/@defi-workflow-engine/action-registry/dist/index.js';
import { createFileExecutionStorage } from '../apps/reference-dapp/node_modules/@defi-workflow-engine/reference-executor/dist/index.js';
import { createRouterService } from '../apps/reference-dapp/src/server/router-service.ts';
import { routerRuntime } from '../apps/reference-dapp/src/server/router-runtime.ts';
import { createRouterHttp, normalizeLifiRoute } from '../apps/reference-dapp/src/server/router-providers.ts';

const OWNER = '0x1111111111111111111111111111111111111111';
const counts = {};
const counted = (name, rpc) => (method, params) => { counts[`${name}:${method}`] = (counts[`${name}:${method}`] ?? 0) + 1; return rpc(method, params); };
const runtime = routerRuntime('live', process.env);
const service = createRouterService({ storage: createFileExecutionStorage(await mkdtemp(join(tmpdir(), 'flofi-router-preflight-')), 'ROUTER_BUSY'),
  sourceRpc: counted('base', runtime.sourceRpc), destinationRpc: counted('arbitrum', runtime.destinationRpc), providers: runtime.providers,
  provenance: 'PUBLIC_MAINNET', executionEnabled: false });
const workflow = providers => ({ schemaVersion: '1.0.0', workflowId: 'router-preflight', revision: 1, resourceEdges: [],
  nodes: [createRouterBridgeNode('node-002', { sourceChain: profile.source.chain, destinationChain: profile.destination.chain, inputToken: profile.source.usdc,
    outputToken: profile.destination.usdc, amount: '1000000', recipient: 'CONNECTED_OWNER', slippageBps: 50, providers })] });
const summary = run => ({ runId: run.id, phase: run.phase, provenance: run.provenance, owner: run.owner, recipient: run.review.recipient,
  selection: run.review.selection, routeCommitment: run.review.routeCommitment, manifestHash: run.review.artifacts.hashes.manifest,
  manifestProvider: run.review.artifacts.manifest.providers,
  route: { provider: run.review.route.routingProvider, underlyingProtocol: run.review.route.underlyingProtocol, steps: run.review.route.steps,
    inputAmount: run.review.route.inputAmount, expectedOutput: run.review.route.expectedOutput, minimumOutput: run.review.route.minimumOutput,
    fees: run.review.route.fees, feeTotal: run.review.route.feeTotal, approval: run.review.route.approval, depositTarget: run.review.route.deposit.to,
    depositSelector: run.review.route.deposit.data.slice(0, 10), bridge: run.review.route.bridge, quote: run.review.route.quote },
  simulation: run.review.simulation, observation: run.review.observation, approvals: run.review.approvals,
  calls: run.review.calls.map(c => ({ purpose: c.purpose, to: c.to, selector: c.data.slice(0, 10), gasUsed: c.gasUsed, gasLimit: c.gasLimit })),
  fees: run.review.fees, deadlines: run.review.deadlines, reviewExpiresAt: run.review.expiresAt, commitment: run.review.commitment });

const started = new Date().toISOString();
const automatic = await service.simulate(workflow(['lifi', 'across']), OWNER);
const reviewed = await service.review(automatic.id, automatic.review.commitment, automatic.workflow);
let begin;
try { await service.begin(automatic.id, OWNER, automatic.workflow); begin = 'UNEXPECTED_SUCCESS'; } catch (cause) { begin = cause.message; }
const direct = await service.simulate(workflow(['across']), OWNER);
// The unrestricted LI.FI answer (any bridge), outside the product path: the router must refuse a bridge it cannot reconcile.
const http = createRouterHttp();
const params = new URLSearchParams({ fromChain: '8453', toChain: '42161', fromToken: profile.source.usdc, toToken: profile.destination.usdc, fromAmount: '1000000',
  fromAddress: OWNER, toAddress: OWNER, slippage: '0.005', integrator: 'flofi', allowDestinationCall: 'false' });
const unrestricted = await http(`${profile.providers.lifi.api}/quote?${params}`);
let unrestrictedOutcome;
try { normalizeLifiRoute(unrestricted, { owner: OWNER, recipient: OWNER, amount: '1000000', slippageBps: 50, nowMs: Date.now(), depositQuoteTimeBuffer: 3600 });
  unrestrictedOutcome = 'ACCEPTED'; } catch (cause) { unrestrictedOutcome = cause.message; }
const result = {
  format: 'flofi.build-router-001.readonly-preflight.v1', evidenceClass: 'PUBLIC_READ_ONLY', startedAt: started, finishedAt: new Date().toISOString(),
  networks: { source: { chain: profile.source.chain, rpc: process.env.GRYLOO_BASE_RPC_URL ? 'override' : profile.source.rpc },
    destination: { chain: profile.destination.chain, rpc: process.env.GRYLOO_ARBITRUM_RPC_URL ? 'override' : profile.destination.rpc } },
  simulatedOwner: OWNER, note: 'Simulations ran from a public address without any authority over it. Nothing was signed or sent.',
  automatic: summary(reviewed), reviewAccepted: reviewed.phase === 'AUTHORIZED', beginWithoutOwnerExecution: begin,
  acrossDirect: summary(direct),
  unrestrictedLifi: { tool: unrestricted.tool, steps: unrestricted.includedSteps?.map(s => `${s.type}:${s.tool}`), routerOutcome: unrestrictedOutcome },
  rpcRequests: counts, transactionsSubmitted: 0,
};
const output = process.argv[2];
const text = JSON.stringify(result, null, 2) + '\n';
if (output) await writeFile(output, text); else process.stdout.write(text);
process.stderr.write(`preflight ok: automatic=${result.automatic.route.provider} minimum=${result.automatic.route.minimumOutput} across=${result.acrossDirect.route.minimumOutput} ` +
  `unrestricted=${result.unrestrictedLifi.tool}:${unrestrictedOutcome} begin=${begin}\n`);
