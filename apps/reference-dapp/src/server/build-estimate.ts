// SPDX-License-Identifier: AGPL-3.0-only
import { hashArtifactBytes, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
import { JUPITER_SOLANA_MAINNET, ORCA_WHIRLPOOLS_DEVNET } from '@defi-workflow-engine/action-registry';
import { jupiterIntent, jupiterBuildQuery, parseJupiterBuild, simulateOrcaDevnetSwap } from '@defi-workflow-engine/reference-compiler';
import { readBaseQuoteOnServer } from './base-rpc.ts';
import { publicSwapProfile } from '../domain/public-testnet-swap.ts';
import { simulationAmount } from '../domain/simulation-presentation.ts';
import type { BuildEstimateResult } from '../domain/build-estimate.ts';
import { createPublicSwapQuoteReader, type Rpc } from './public-testnet-service.ts';
import { baseSepoliaSwapRpc, ethereumSepoliaSwapRpc } from './public-testnet-rpc.ts';
import { createSolanaRpc, solanaRpcOverride } from './solana-rpc.ts';
import { createJupiterHttp } from './jupiter-http.ts';

/** Adapter/profile selected reads; no execution store, session, Review, signature or submission port. */
export async function readBuildEstimate(input: unknown, env: Readonly<Record<string, string | undefined>> = process.env,
  seams: { rpc?: Rpc; http?: ReturnType<typeof createJupiterHttp>; now?: () => Date } = {}): Promise<BuildEstimateResult> {
  try {
    if (!input || typeof input !== 'object') throw Error('ESTIMATE_INVALID');
    const { workflow: raw, nodeId, owner } = input as { workflow?: unknown; nodeId?: unknown; owner?: unknown };
    const workflow = validateArtifact('semantic-workflow', raw) as SemanticWorkflow;
    const node = workflow.nodes.find(n => n.nodeId === nodeId && n.actionType === 'asset.swap.exact-input');
    if (!node) throw Error('ESTIMATE_UNSUPPORTED');
    const now = seams.now ?? (() => new Date());
    const workflowHash = hashArtifactBytes('semantic-workflow', new TextEncoder().encode(JSON.stringify(workflow)));
    const profile = publicSwapProfile(node.chainId);
    const uniswap = node.adapterConstraints.protocols.some(protocol => protocol === 'uniswap' || protocol === 'uniswap-v3');
    if (profile && uniswap) {
      const rpc = seams.rpc ?? (profile.chainId === 84532 ? baseSepoliaSwapRpc(env.GRYLOO_BASE_SEPOLIA_RPC_URL) : ethereumSepoliaSwapRpc(env.GRYLOO_ETHEREUM_SEPOLIA_RPC_URL));
      const q = await createPublicSwapQuoteReader(() => rpc, now)(workflow, 'read-only');
      const decimals = q.outputSymbol === 'USDC' ? 6 : 18;
      return { ok: true, estimate: { workflowHash, nodeId: node.nodeId, chain: profile.chainRef, provider: 'Uniswap V3',
        expected: simulationAmount(q.expectedOut, decimals)!, minimum: simulationAmount(q.minimumOut, decimals), symbol: q.outputSymbol,
        slippageBps: q.slippageBps, expiresAt: q.expiresAt } };
    }
    if (node.chainId === 'eip155:8453' && uniswap) {
      const read = await readBaseQuoteOnServer({ workflow, nodeId }, { env });
      if (!read.ok) return { ok: false, code: 'ESTIMATE_UNAVAILABLE' };
      const artifact = validateArtifact('quote-state-artifact', JSON.parse(read.artifact));
      if (!artifact.normalizedValues.some(v => v.name === 'observation-mode' && v.value === 'LIVE_READ_ONLY'))
        return { ok: false, code: 'ESTIMATE_UNAVAILABLE' };
      const outputs = artifact.normalizedValues.filter(v => v.kind === 'QUANTITY' && /^tier-\d+\.quoted-output$/.test(v.name));
      const best = outputs.reduce<(typeof outputs)[number] | null>((a, b) => b.kind === 'QUANTITY' && (!a || a.kind === 'QUANTITY' && BigInt(b.value.amount) > BigInt(a.value.amount)) ? b : a, null);
      if (!best || best.kind !== 'QUANTITY') return { ok: false, code: 'ESTIMATE_UNAVAILABLE' };
      const amount = node.inputs.find(v => v.name === 'amount-in');
      const slip = node.userConstraints.find(c => c.kind === 'MAXIMUM_SLIPPAGE_BPS');
      return { ok: true, estimate: { workflowHash, nodeId: node.nodeId, chain: node.chainId, provider: 'Uniswap V3',
        expected: simulationAmount(best.value.amount, best.value.asset.decimals)!, minimum: null,
        symbol: amount?.kind === 'QUANTITY' && amount.value.asset.decimals === 6 ? 'WETH' : 'USDC',
        slippageBps: slip?.kind === 'MAXIMUM_SLIPPAGE_BPS' ? slip.maximumBps : 0, expiresAt: artifact.freshness.expiresAt } };
    }
    if (node.chainId === JUPITER_SOLANA_MAINNET.chain && typeof owner === 'string') {
      // The taker is an untrusted quote parameter only; this read never binds ownership or grants authority.
      const intent = jupiterIntent(workflow, owner), http = seams.http ?? createJupiterHttp(JUPITER_SOLANA_MAINNET.api + JUPITER_SOLANA_MAINNET.endpoint, env.JUPITER_API_KEY);
      const q = parseJupiterBuild(await http(jupiterBuildQuery(intent)), intent, now().toISOString()).quote;
      return { ok: true, estimate: { workflowHash, nodeId: node.nodeId, chain: node.chainId, provider: 'Jupiter',
        expected: simulationAmount(q.outAmount, intent.output.decimals)!, minimum: simulationAmount(q.otherAmountThreshold, intent.output.decimals),
        symbol: intent.output.symbol, slippageBps: intent.slippageBps, expiresAt: new Date(now().getTime() + 30_000).toISOString() } };
    }
    if (node.chainId === ORCA_WHIRLPOOLS_DEVNET.chain && typeof owner === 'string') {
      const rpc = seams.rpc ?? createSolanaRpc(solanaRpcOverride(env.GRYLOO_SOLANA_DEVNET_RPC_URL, 'DEVNET_SWAP_RPC_URL_INVALID') ?? ORCA_WHIRLPOOLS_DEVNET.rpc, false);
      const review = await simulateOrcaDevnetSwap(workflow, owner, async (method, params) => {
        if (!['getGenesisHash', 'getMultipleAccounts', 'getLatestBlockhash', 'simulateTransaction'].includes(method)) throw Error('ESTIMATE_READ_METHOD_DENIED');
        return rpc(method, params);
      }, now().getTime());
      return { ok: true, estimate: { workflowHash, nodeId: node.nodeId, chain: node.chainId, provider: 'Orca Whirlpools',
        expected: simulationAmount(review.quote.outAmount, review.output.decimals)!, minimum: simulationAmount(review.quote.otherAmountThreshold, review.output.decimals),
        symbol: review.output.symbol, slippageBps: review.slippageBps, expiresAt: review.expiresAt } };
    }
    return { ok: false, code: 'ESTIMATE_UNSUPPORTED' };
  } catch { return { ok: false, code: 'ESTIMATE_UNAVAILABLE' }; }
}
