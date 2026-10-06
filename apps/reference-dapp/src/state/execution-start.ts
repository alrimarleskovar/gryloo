// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import type { ExecutionStart } from '../domain/execution-presentation';
import type { ReviewWallet } from '../domain/review-presentation';
import type { SimulationSource } from '../domain/simulation-presentation';
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

/** Explicit requests only. Existing stores retain all submission and journal semantics. */
export function useExecutionStart(kind: SimulationSource['kind'], wallet: ReviewWallet): ExecutionStart {
  const modeA = useModeA(), modeB = useModeB(), composition = useComposition(), liquidity = useLiquidity();
  const supply = useSupply(), lending = useLending(), router = useRouter(), publicSwap = usePublicTestnet();
  const jupiter = useJupiter(), solanaPool = useSolanaLiquidity(), uniswapPool = useUniswapLiquidity(), transfer = useRobinhoodTransfer();
  const result: ExecutionStart = { ready: false, started: false, start: null, prompt: null, expiresAt: null, requiresMainnetAcknowledgement: false };
  const attach = (ready: boolean, started: boolean, start: () => void | Promise<void>, prompt = 'Confirm the next transaction in your wallet.') => Object.assign(result, { ready, started, start, prompt });
  const localWallet = (session: { account: string } | null, connect: () => void) => {
    if (!session) { result.connect = connect; result.reason = 'Connect the reviewed wallet for execution.'; return false; }
    const matches = Boolean(wallet.account && session.account.toLowerCase() === wallet.account.toLowerCase() && wallet.chain === 'eip155:31337');
    if (!matches) result.reason = 'The execution wallet must match the wallet and network used for Review.';
    return matches;
  };
  switch (kind) {
    case 'supply': {
      const r = supply.record, pending = r?.attempts.some(a => !a.reconciled && !r.approvalProof);
      attach(Boolean(r?.authorization && !supply.retired && !supply.busy && !pending && r.verdict === 'PENDING' && !r.notSubmitted), Boolean(r?.attempts.length), supply.execute); break;
    }
    case 'lending': {
      const r = lending.record, q = r?.reviews.at(-1), pending = r?.attempts.some(a => !a.reconciled && !a.notSubmitted);
      const next = q?.calls.find(c => !r?.attempts.some(a => a.step === c.id && a.reconciled));
      attach(Boolean(r?.authorization && !pending && r.status !== 'COMPLETED' && !lending.retired && !lending.busy && next), Boolean(r?.attempts.length), lending.execute); break;
    }
    case 'router': {
      const r = router.record, last = r?.attempts.at(-1);
      const pending = Boolean(last && r?.verdict === 'PENDING' && ['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING'].includes(last.state));
      const confirmed = new Set(r?.attempts.filter(a => a.state === 'CONFIRMED').map(a => a.step));
      const next = r?.review.calls.find(c => !confirmed.has(c.purpose === 'APPROVAL' ? 'APPROVAL' : 'DEPOSIT'));
      attach(Boolean(r?.phase === 'AUTHORIZED' && r.authorization === r.review.commitment && !router.retired && !router.busy && !pending && router.executionEnabled && router.sessionReady && next), Boolean(r?.attempts.length), router.execute);
      if (!router.executionEnabled) result.reason = 'Execution is unavailable for this route.'; break;
    }
    case 'public': {
      const r = publicSwap.run;
      attach(Boolean(publicSwap.available && r && r.reviewedManifestHash === r.quote.manifestHash && !publicSwap.retired && !publicSwap.recoveryOnly && !publicSwap.busy && !r.outcome), Boolean(r?.attempts.length), publicSwap.execute,
        'Confirm the next transaction in your wallet. A token approval is requested only if the current allowance is insufficient.'); break;
    }
    case 'solana-swap': {
      const r = jupiter.record;
      attach(Boolean(r?.authorization && !jupiter.retired && !jupiter.busy && !r.attempt && r.verdict === 'PENDING' && jupiter.executionEnabled), Boolean(r?.attempt), jupiter.execute, 'Sign the reviewed swap transaction in your wallet.');
      result.requiresMainnetAcknowledgement = r?.provenance === 'PUBLIC_MAINNET';
      if (!jupiter.executionEnabled) result.reason = 'Execution is unavailable on this network.'; break;
    }
    case 'solana-pool': {
      const r = solanaPool.record;
      attach(Boolean(r?.authorization && !solanaPool.retired && !solanaPool.busy && !r.attempt && r.verdict === 'PENDING' && solanaPool.executionEnabled), Boolean(r?.attempt), solanaPool.execute, 'Sign the reviewed liquidity transaction in your wallet.');
      if (!solanaPool.executionEnabled) result.reason = 'Execution is unavailable on this network.'; break;
    }
    case 'uniswap-pool': {
      const r = uniswapPool.record, last = r?.attempts.at(-1);
      const pending = Boolean(last && r?.verdict === 'PENDING' && ['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING'].includes(last.state));
      const confirmed = new Set(r?.attempts.filter(a => a.state === 'CONFIRMED').map(a => a.step));
      const next = r?.review.calls.find(c => !confirmed.has(c.step));
      attach(Boolean(r?.authorization && r.authorization === r.review.commitment && !uniswapPool.retired && !uniswapPool.busy && !pending && r.verdict === 'PENDING' && uniswapPool.executionEnabled && next), Boolean(r?.attempts.length), uniswapPool.execute);
      if (!uniswapPool.executionEnabled) result.reason = 'Execution is unavailable on this network.'; break;
    }
    case 'transfer': {
      const r = transfer.record;
      attach(Boolean(r?.authorization && !transfer.retired && !transfer.busy && !r.attempt && r.verdict === 'PENDING'), Boolean(r?.attempt), transfer.execute); break;
    }
    case 'fork-swap': {
      const connected = localWallet(modeA.wallet, modeA.connect);
      attach(Boolean(modeA.info?.available && modeA.reviewAccepted && connected && !modeA.retired && !modeA.recoveryOnly && !modeA.busy && !modeA.verifyError && modeA.verified['step-approve'] && modeA.verified['step-swap']), Boolean(modeA.execution?.attempts.length || modeA.requests.length), () => modeA.request('step-approve'), 'Confirm the exact token approval in your wallet. The swap requires a separate action.'); break;
    }
    case 'fork-pool': {
      const connected = localWallet(liquidity.wallet, liquidity.connect);
      attach(Boolean(liquidity.info?.available && liquidity.reviewAccepted && connected && !liquidity.retired && !liquidity.recoveryOnly && !liquidity.consumed && !liquidity.busy && liquidity.verified), liquidity.consumed, liquidity.request); break;
    }
    case 'delegated-swap': {
      const q = modeB.status?.prepared, connected = localWallet(modeB.wallet, modeB.connect);
      const installed = Boolean(q && q.installationStart + q.installation.length === q.compiled.installation.length);
      attach(Boolean(q && modeB.info?.available && modeB.reviewed && connected && !modeB.retired && !modeB.recoveryOnly && !modeB.quoteExpired && !modeB.unknownSubmission && !modeB.busy && !q.executionHash), Boolean(q?.installation.length || q?.executionHash), installed ? modeB.runWorker : modeB.installNext,
        installed ? 'Start the authorized execution using the configured executor.' : 'Confirm the next permission setup transaction in your owner wallet.');
      result.expiresAt = q ? q.quoteExpiresAt * 1000 : null; break;
    }
    case 'composition': {
      const q = composition.status?.prepared, connected = localWallet(composition.wallet, composition.connect);
      const installed = Boolean(q && q.installation.length === q.compiled.installation.length);
      const attempted = composition.status?.events.some(e => e.level === 'ATTEMPT');
      attach(Boolean(q && composition.info?.available && composition.reviewed && connected && !composition.retired && !composition.recoveryOnly && !composition.unknownSubmission && !composition.busy && !attempted), Boolean(q?.installation.length || attempted), installed ? composition.runWorker : composition.installNext,
        installed ? 'Start the authorized execution using the configured executor.' : 'Confirm the next permission setup transaction in your owner wallet.'); break;
    }
    default: result.reason = 'Wallet execution is unavailable for this workflow.';
  }
  // A continuation only addresses a never-attempted call. Rejected/unknown requests
  // stay closed here; retry and recovery remain in their existing runtime paths.
  if (result.started) {
    let safeNext = false;
    switch (kind) {
      case 'supply': {
        const r = supply.record;
        safeNext = Boolean(r && r.attempts.length && r.attempts.every(a => a.step === 'APPROVAL' && a.reconciled) && !r.notSubmitted);
        result.nextLabel = 'Continue to wallet'; break;
      }
      case 'lending': {
        const r = lending.record, next = r?.reviews.at(-1)?.calls.find(c => !r.attempts.some(a => a.step === c.id && a.reconciled));
        safeNext = Boolean(next && r && !r.attempts.some(a => a.step === next.id));
        if (next) result.nextLabel = `Continue to ${next.id.replaceAll('_', ' ').toLowerCase()}`; break;
      }
      case 'router': {
        const r = router.record;
        safeNext = Boolean(r && r.attempts.every(a => a.step === 'APPROVAL' && a.state === 'CONFIRMED'));
        result.nextLabel = 'Continue to bridge'; break;
      }
      case 'public': {
        const attempts = publicSwap.run?.attempts ?? [];
        safeNext = attempts.length > 0 && attempts.every(a => a.step === 'approval' && a.state === 'CONFIRMED');
        result.nextLabel = 'Continue to swap'; break;
      }
      case 'uniswap-pool': {
        const r = uniswapPool.record, next = r?.review.calls.find(c => !r.attempts.some(a => a.step === c.step && a.state === 'CONFIRMED'));
        safeNext = Boolean(r && next && !r.attempts.some(a => a.step === next.step));
        result.nextLabel = next?.step === 'MINT' ? 'Continue to add liquidity' : 'Continue to token approval'; break;
      }
      case 'fork-swap': {
        const r = modeA.execution, approval = r?.attempts.filter(a => a.stepId === 'step-approve').at(-1);
        const confirmed = approval?.state === 'CONFIRMED' || r?.observations.some(o => o.attemptId === approval?.executionAttemptId && o.outcome === 'CONFIRMED_NOT_RECONCILED');
        safeNext = Boolean(confirmed && !r?.attempts.some(a => a.stepId === 'step-swap') && !modeA.requests.some(a => a.stepId === 'step-swap'));
        result.start = () => modeA.request('step-swap'); result.nextLabel = 'Continue to swap'; break;
      }
      case 'composition': {
        const last = composition.status?.events.filter(e => e.level === 'ATTEMPT').at(-1);
        if (!last) { safeNext = true; result.nextLabel = result.prompt?.startsWith('Start') ? 'Start authorized execution' : 'Continue wallet setup'; break; }
        const connected = Boolean(composition.wallet && wallet.account && composition.wallet.account.toLowerCase() === wallet.account.toLowerCase() && wallet.chain === 'eip155:31337');
        // The existing worker first re-observes the known receipt. It never repeats a submitted call.
        safeNext = Boolean(last?.transactionHash && ['PENDING', 'CONFIRMED', 'RECONCILED'].includes(last.state) && !(last.step === 'MINT' && last.state === 'RECONCILED'));
        result.ready = Boolean(safeNext && composition.reviewed && connected && !composition.retired && !composition.recoveryOnly && !composition.busy && !composition.unknownSubmission);
        result.start = composition.runWorker; result.nextLabel = last?.state === 'PENDING' ? 'Verify and continue' : 'Continue execution'; break;
      }
      case 'delegated-swap': safeNext = true; result.nextLabel = result.prompt?.startsWith('Start') ? 'Start authorized execution' : 'Continue wallet setup'; break;
    }
    result.next = result.ready && safeNext ? result.start : null;
  }
  result.check = kind === 'supply' ? supply.observe : kind === 'lending' ? lending.observe : kind === 'router' ? router.observe : kind === 'public' ? publicSwap.observe
    : kind === 'solana-swap' ? jupiter.observe : kind === 'solana-pool' ? solanaPool.observe : kind === 'uniswap-pool' ? uniswapPool.observe : kind === 'transfer' ? transfer.observe
    : kind === 'fork-swap' ? () => { const a = modeA.execution?.attempts.at(-1); if (a && (a.stepId === 'step-approve' || a.stepId === 'step-swap')) modeA.observe(a.stepId); }
    : kind === 'delegated-swap' ? modeB.refresh : kind === 'composition' ? composition.refresh : null;
  return result;
}
