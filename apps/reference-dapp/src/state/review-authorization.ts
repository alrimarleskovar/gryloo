// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useState } from 'react';
import { LIQUIDITY_USDC, LIQUIDITY_WETH } from '@defi-workflow-engine/reference-compiler';
import { useModeA } from './mode-a-store';
import { useModeB } from './mode-b-store';
import { useComposition } from './composition-store';
import { useLiquidity } from './liquidity-store';
import { useSupply } from './supply-store';
import { useLending } from './lending-store';
import { useRouter } from './router-store';
import { usePublicTestnet } from './public-testnet-store';
import { useJupiter } from './jupiter-store';
import { useSolanaLiquidity } from './solana-liquidity-store';
import { useUniswapLiquidity } from './uniswap-liquidity-store';
import { useRobinhoodTransfer } from './robinhood-transfer-store';
import { useAcross } from './across-store';
import { useBuild009Wallet } from './build009-wallet-store';
import { useExecutionEnvironment } from './capability-store';
import { reviewedManifest, reviewApprovalCall, type ReviewAuthorization, type ReviewWallet } from '../domain/review-presentation';
import { simulationAmount, type SimulationSource } from '../domain/simulation-presentation';
import { walletChainRef } from '../wallet/evm-networks';
import { solanaWalletChainRef } from '../wallet/environment';

/** Review callbacks only: no install, request, begin, submit or execute method crosses this boundary. */
export function useReviewAuthorization(kind: SimulationSource['kind']): { authorization: ReviewAuthorization; wallet: ReviewWallet } {
  const modeA = useModeA(), modeB = useModeB(), composition = useComposition(), liquidity = useLiquidity();
  const supply = useSupply(), lending = useLending(), router = useRouter(), publicSwap = usePublicTestnet();
  const jupiter = useJupiter(), solanaPool = useSolanaLiquidity(), uniswapPool = useUniswapLiquidity(), transfer = useRobinhoodTransfer(), across = useAcross();
  const sharedWallet = useBuild009Wallet(), environment = useExecutionEnvironment();
  const authorization: ReviewAuthorization = { key: null, manifest: null, owner: null, chain: null, ready: false, accepted: false, approve: null, approvals: [], tokens: [], limits: [], technical: null };
  const attach = (key: string, manifest: unknown, policy: unknown, accepted: boolean, approve: (() => void | Promise<void>) | null, ready: boolean, technical: unknown) => {
    const parsed = reviewedManifest(manifest);
    Object.assign(authorization, { key, manifest, policy, accepted, approve, ready, technical, owner: parsed?.owner.address ?? null, chain: parsed?.owner.chainId ?? null });
  };
  const calls = (values: readonly { to: string; data: string }[], chain: string, spenderName?: string) => {
    for (const call of values) { const approval = reviewApprovalCall(call.to, call.data, chain, spenderName); if (approval) authorization.approvals.push(approval); }
  };
  switch (kind) {
    case 'supply': {
      const r = supply.record, q = r?.review; if (!r || !q) break;
      attach(r.id, q.manifest, q.policy, r.authorization === q.commitment, supply.review, !supply.busy && !supply.retired && !r.attempts.length && r.verdict === 'PENDING', q);
      authorization.tokens.push({ address: q.asset, chain: q.chain, symbol: 'USDC', decimals: 6 });
      calls(q.transactions, q.chain, 'Aave V3 Pool'); break;
    }
    case 'lending': {
      const r = lending.record, q = r?.reviews.at(-1); if (!r || !q) break;
      attach(`${r.id}:${q.commitment}`, q.manifest, q.policy, r.authorization === q.commitment, lending.review, !lending.busy && !lending.retired && !r.attempts.some(a => !a.reconciled && !a.notSubmitted), q);
      for (const call of q.calls) calls([call.tx], q.manifest.owner.chainId, call.id === 'POOL_APPROVAL' ? 'Aave V3 Pool' : call.id === 'ROUTER_APPROVAL' ? 'Uniswap Router' : undefined);
      break;
    }
    case 'router': {
      const r = router.record, q = r?.review; if (!r || !q) break;
      attach(`${r.id}:${q.commitment}`, q.artifacts.manifest, q.artifacts.policy, r.authorization === q.commitment, router.review, !router.busy && !router.retired && ['PREPARED', 'AUTHORIZED'].includes(r.phase) && !r.requote, q);
      for (const token of [q.route.inputToken, q.route.outputToken]) authorization.tokens.push({ address: token.address, chain: token.chainId, symbol: token.symbol, decimals: token.decimals });
      calls(q.calls, q.intent.sourceChain); break;
    }
    case 'solana-swap': {
      const r = jupiter.record, q = r?.review; if (!r || !q) break;
      attach(q.commitment, q.manifest, q.policy, r.authorization === q.commitment, jupiter.review, !jupiter.busy && !jupiter.retired && !r.attempt && r.verdict === 'PENDING', q);
      for (const token of [q.input, q.output]) authorization.tokens.push({ address: token.mint, chain: q.chain, symbol: token.symbol === 'USDC' && q.cluster === 'devnet' ? 'devUSDC' : token.symbol, decimals: token.decimals });
      break;
    }
    case 'solana-pool': {
      const r = solanaPool.record, q = r?.review; if (!r || !q) break;
      attach(q.commitment, q.manifest, q.policy, r.authorization === q.commitment, solanaPool.review, !solanaPool.busy && !solanaPool.retired && !r.attempt && r.verdict === 'PENDING', q);
      for (const token of [q.token0, q.token1]) authorization.tokens.push({ address: token.mint, chain: q.chain, symbol: token.symbol === 'USDC' ? 'devUSDC' : token.symbol, decimals: token.decimals });
      break;
    }
    case 'transfer': {
      const r = transfer.record, q = r?.review; if (!r || !q) break;
      attach(q.commitment, q.manifest, q.policy, r.authorization === q.commitment, transfer.review, !transfer.busy && !transfer.retired && !r.attempt && r.verdict === 'PENDING', q); break;
    }
    case 'fork-swap': {
      const q = modeA.prepared; if (!q) break;
      attach(q.executionId, q.artifacts.manifest, q.artifacts.policy, modeA.reviewAccepted, modeA.acceptReview,
        Boolean(modeA.info?.available && !modeA.busy && !modeA.retired && !modeA.recoveryOnly && !modeA.verifyError && modeA.verified['step-approve'] && modeA.verified['step-swap'] && !modeA.requests.length), q);
      authorization.owner = q.owner; authorization.chain = 'eip155:31337';
      authorization.tokens.push({ address: q.tokenIn, chain: authorization.chain, symbol: q.symbolIn, decimals: q.decimalsIn }, { address: q.tokenOut, chain: authorization.chain, symbol: q.symbolOut, decimals: q.decimalsOut });
      const approval = modeA.verified['step-approve']?.decoded.approve;
      if (approval) authorization.approvals.push({ token: q.tokenIn, chain: authorization.chain, spender: approval.spender, spenderName: 'Uniswap Router', amount: approval.amount, kind: 'exact' }); break;
    }
    case 'fork-pool': {
      const q = liquidity.prepared; if (!q) break;
      attach(q.executionId, q.artifacts.manifest, q.artifacts.policy, liquidity.reviewAccepted, liquidity.acceptReview,
        Boolean(liquidity.verified && !liquidity.retired && !liquidity.recoveryOnly && !liquidity.consumed && !liquidity.busy), q);
      authorization.owner = q.owner; authorization.chain = 'eip155:31337';
      authorization.tokens.push({ address: LIQUIDITY_USDC, chain: authorization.chain, symbol: 'USDC', decimals: 6 }, { address: LIQUIDITY_WETH, chain: authorization.chain, symbol: 'WETH', decimals: 18 });
      if (liquidity.verified) calls([{ to: liquidity.verified.target, data: liquidity.verified.calldata }], authorization.chain, 'Uniswap Position Manager');
      break;
    }
    case 'composition': {
      const q = composition.status?.prepared; if (!q) break;
      attach(q.executionId, q.artifacts.manifest, q.artifacts.policy, composition.reviewed, composition.acceptReview,
        Boolean(composition.info?.available && !composition.retired && !composition.recoveryOnly && !composition.busy && !composition.unknownSubmission), q);
      authorization.owner = typeof q.compiled.permission.owner === 'string' ? q.compiled.permission.owner : authorization.owner;
      authorization.chain = 'eip155:31337';
      authorization.tokens.push({ address: LIQUIDITY_USDC, chain: authorization.chain, symbol: 'USDC', decimals: 6 }, { address: LIQUIDITY_WETH, chain: authorization.chain, symbol: 'WETH', decimals: 18 });
      calls(q.compiled.installation, authorization.chain);
      break;
    }
    case 'delegated-swap': {
      const q = modeB.status?.prepared; if (!q) break;
      attach(q.executionId, null, null, modeB.reviewed, modeB.acceptReview,
        Boolean(modeB.info?.available && !modeB.retired && !modeB.recoveryOnly && !modeB.quoteExpired && !modeB.busy && !modeB.unknownSubmission), q);
      authorization.owner = typeof q.compiled.permission.owner === 'string' ? q.compiled.permission.owner : modeB.info?.owner ?? null; authorization.chain = 'eip155:31337';
      calls(q.compiled.installation, authorization.chain, 'Uniswap Router');
      const symbol = q.direction === 'USDC_TO_WETH' ? 'USDC' : 'WETH';
      authorization.tokens.push({ address: q.tokenIn, chain: authorization.chain, symbol, decimals: symbol === 'USDC' ? 6 : 18 });
      authorization.limits.push({ label: 'Max spend', value: simulationAmount(q.amountIn, symbol === 'USDC' ? 6 : 18, symbol)! });
      const output = symbol === 'USDC' ? 'WETH' : 'USDC';
      authorization.limits.push({ label: 'Minimum received', value: simulationAmount(q.minimumOut, output === 'USDC' ? 6 : 18, output)! });
      for (const [field, label] of [['safe', 'Execution account'], ['executor', 'Authorized executor'], ['recipient', 'Recipient']] as const) {
        const value = q.compiled.permission[field];
        if (typeof value === 'string') authorization.limits.push({ label, value: `${value.slice(0, 6)}…${value.slice(-4)}` });
      }
      break;
    }
    case 'across': {
      const r = across.run; if (!r) break;
      // This legacy path has a real quote/Manifest but only a deterministic demo execution lifecycle.
      // Project its actual bounds without presenting its demo authorization as wallet authority.
      attach(r.executionId, r.review.manifestArtifact, r.review.policyArtifact, false, null, false, r.review);
      authorization.tokens.push({ address: r.quote.inputToken, chain: 'eip155:8453', symbol: 'USDC', decimals: 6 }, { address: r.quote.outputToken, chain: 'eip155:42161', symbol: 'USDC', decimals: 6 });
      calls(r.quote.approvals, 'eip155:8453'); break;
    }
    case 'public': {
      const r = publicSwap.run, q = r?.quote; if (!r || !q) break;
      attach(q.executionId, null, null, r.reviewedManifestHash === q.manifestHash, publicSwap.review, !publicSwap.busy && !publicSwap.retired && !publicSwap.recoveryOnly && !r.attempts.length, q);
      authorization.chain = `eip155:${q.chainId}`;
      authorization.limits.push({ label: 'Max spend', value: simulationAmount(q.amountIn, q.inputSymbol === 'USDC' ? 6 : 18, q.inputSymbol)! }, { label: 'Max slippage', value: `${(q.slippageBps / 100).toFixed(2)}%` }, { label: 'Minimum received', value: simulationAmount(q.minimumOut, q.outputSymbol === 'USDC' ? 6 : 18, q.outputSymbol)! });
      break;
    }
    case 'uniswap-pool': {
      const r = uniswapPool.record, q = r?.review; if (!r || !q) break;
      attach(`${r.id}:${q.commitment}`, null, null, r.authorization === q.commitment, uniswapPool.review, !uniswapPool.busy && !uniswapPool.retired && !r.attempts.length, q);
      authorization.owner = q.owner; authorization.chain = `eip155:${q.chainId}`;
      for (const [token, max] of [[q.token0, q.intent.amount0Max], [q.token1, q.intent.amount1Max]] as const) {
        authorization.tokens.push({ ...token, chain: authorization.chain });
        authorization.limits.push({ label: 'Max spend', value: simulationAmount(max, token.decimals, token.symbol)! });
      }
      authorization.limits.push({ label: 'Max slippage', value: `${(q.intent.slippageBps / 100).toFixed(2)}%` }, { label: 'Recipient', value: q.recipient }, { label: 'Price range', value: `${q.range.lowerPrice}–${q.range.upperPrice} USDC per WETH` });
      calls(q.calls, authorization.chain, 'Uniswap Position Manager'); break;
    }
  }
  const account = environment.walletKind === 'solana' ? jupiter.session?.account.address ?? null : sharedWallet.account;
  const chain = environment.walletKind === 'solana' ? solanaWalletChainRef(environment.walletChain) : sharedWallet.chainId === '0x7a69' ? 'eip155:31337' : walletChainRef(sharedWallet.chainId);
  const identity = JSON.stringify([account, chain, environment.walletKind === 'evm' ? sharedWallet.chainId : environment.walletChain]);
  // Keep this guard mounted in the shell. Returning to the old wallet cannot revive the old Review.
  const [binding, setBinding] = useState({ key: authorization.key, identity, changed: false });
  const changed = binding.key === authorization.key && (binding.changed || binding.identity !== identity);
  if (binding.key !== authorization.key) setBinding({ key: authorization.key, identity, changed: false });
  else if (changed && !binding.changed) setBinding({ ...binding, changed: true });
  return { authorization, wallet: { account, chain, environment: environment.walletEnvironment, changed } };
}
