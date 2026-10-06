// SPDX-License-Identifier: AGPL-3.0-only
/** Presentation of recorded evidence only. No runtime calls or state changes. */
import type { EvidenceBundle } from '@defi-workflow-engine/workflow-contracts';
import { baseAssetRegistry } from '@defi-workflow-engine/action-registry';
import { executionExplorer, type ExecutionLifecycle, type ExecutionLifecycleSource } from './execution-lifecycle';
import type { EvidenceComparison } from './execution-step-evidence';
import { simulationAmount } from './simulation-presentation';
import { shellChainLabel } from './product-shell';

export type EvidenceIdentifier = { label: string; value: string; kind: 'transaction' | 'order' | 'reference'; chain?: string; explorer?: string | null; status?: string };
export type EvidenceValue = { label: string; value: string };
export type OperationResultEvidence = { identifiers: EvidenceIdentifier[]; values: EvidenceValue[]; comparisons: EvidenceComparison[]; fees: EvidenceValue[]; failure?: 'reverted' | 'declined' | 'failed'; note?: string };
export type ExecutionEvidence = { operations: Record<string, OperationResultEvidence>; wallet: string | null; knownCosts: EvidenceValue[]; details: (EvidenceValue & { copy?: boolean })[]; limitations: string[]; attention: string[] };
const validUnits = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);

export function projectExecutionEvidence(source: ExecutionLifecycleSource, progress: ExecutionLifecycle): ExecutionEvidence {
  const evidence: ExecutionEvidence = { operations: {}, wallet: null, knownCosts: [], details: [], limitations: [], attention: [] };
  const costs = new Map<string, { operation: string; chain: string; units: string; decimals: number; symbol: string }>();
  const op = (id: string) => evidence.operations[id] ??= { identifiers: [], values: [], comparisons: [], fees: [] };
  const detail = (label: string, value: string | null | undefined, copy = false) => { if (value) evidence.details.push({ label, value, copy }); };
  const identifier = (id: string, label: string, value: string | null | undefined, kind: EvidenceIdentifier['kind'] = 'reference', chain?: string, status?: string) => {
    if (!value) return;
    const existing = op(id).identifiers.find(item => item.value === value && item.kind === kind);
    if (existing) {
      if (existing.label === 'Action transaction' && label === 'Approval transaction') existing.label = label;
      if (status) existing.status = status;
      return;
    }
    op(id).identifiers.push({ label, value, kind, ...(chain ? { chain } : {}), ...(status ? { status } : {}), explorer: kind === 'transaction' && chain ? executionExplorer(chain, value, progress.local) : null });
  };
  const amount = (id: string, label: string, units: string | null | undefined, decimals: number, symbol: string, planned?: string | null) => {
    const value = simulationAmount(units, decimals, symbol);
    if (value === null) return;
    op(id).values.push({ label, value });
    const expected = simulationAmount(planned, decimals, symbol);
    if (expected !== null) op(id).comparisons.push({ label, planned: expected, actual: value });
  };
  const fee = (id: string, chain: string, hash: string | null | undefined, units: string | null | undefined, decimals = 18, symbol = 'ETH') => {
    // One cost per chain/transaction. L1 cost is already included in gasCostWei.
    if (hash && validUnits(units)) costs.set(`${chain}/${hash}`, { operation: id, chain, units, decimals, symbol });
  };
  const failure = (id: string, state: string, hash: string | null | undefined, refusalCode?: string) => {
    if (evidence.operations[id]) delete evidence.operations[id]!.failure;
    if (state === 'REVERTED') op(id).failure = 'reverted';
    else if (!hash && (state === 'REJECTED' || ['CANCELLED', 'NOT_FOUND'].includes(state) && /_(REJECTED|WALLET_REQUEST_REFUSED|WALLET_REJECTED)$/.test(refusalCode ?? ''))) op(id).failure = 'declined';
    else if (state === 'FAILED') op(id).failure = 'failed';
  };
  const bundle = (value: EvidenceBundle | null | undefined, hash?: string | null) => {
    if (!value) return;
    detail('Evidence bundle', value.evidenceBundleId, true); detail('Evidence content hash', hash, true);
    detail('Manifest reference', value.manifestHash, true); detail('Workflow reference', value.semanticWorkflowHash, true);
    detail('Reconciliation outcome', value.outcome); detail('Evidence observed at', value.observedAt); detail('Evidence environment', value.environment);
    evidence.limitations.push(...(value.reconciliation?.limitations ?? []));
    for (const receipt of value.receipts ?? []) detail('Receipt content hash', receipt.contentHash, true);
  };
  const allowance = (units: unknown) => { if (validUnits(units) && BigInt(units) > 0n && !evidence.attention.length) evidence.attention.push('A token allowance remains in the execution record. Review it before authorizing another workflow.'); };
  detail('Run ID', progress.runKey, true);
  for (const step of progress.steps) for (const operation of step.operations) {
    identifier(operation.id, operation.approval ? 'Approval transaction' : operation.id === 'destination' ? 'Destination transaction' : operation.id === 'DEPOSIT' ? 'Source transaction' : 'Action transaction', operation.hash, 'transaction', operation.chain, operation.label);
  }
  switch (source.kind) {
    case 'public': {
      const run = source.state.run; if (!run) break;
      evidence.wallet = run.attempts.find(attempt => attempt.account)?.account ?? null;
      for (const attempt of run.attempts) {
        identifier(attempt.step, attempt.step === 'approval' ? 'Approval transaction' : 'Action transaction', attempt.txHash, 'transaction', `eip155:${run.quote.chainId}`, attempt.state);
        fee(attempt.step, `eip155:${run.quote.chainId}`, attempt.receipt?.transactionHash, attempt.receipt?.gasCostWei);
        failure(attempt.step, attempt.state, attempt.txHash); detail(`${attempt.step} recorded at`, attempt.createdAt);
        detail('Network fee payer', attempt.receipt?.gasPayer);
      }
      const actual = run.outcome;
      bundle(actual?.evidence, actual?.evidenceBundleHash);
      if (actual?.evidence.outcome === 'RECONCILED') {
        const decimals = (symbol: 'USDC' | 'WETH') => symbol === 'USDC' ? 6 : 18;
        amount('swap', 'Executed input', actual.inputSpent, decimals(run.quote.inputSymbol), run.quote.inputSymbol);
        amount('swap', 'Actual received', actual.outputReceived, decimals(run.quote.outputSymbol), run.quote.outputSymbol);
        allowance(actual.allowanceAfter);
      } break;
    }
    case 'supply': {
      const record = source.state.record; if (!record) break;
      evidence.wallet = record.review.account; bundle(record.evidence?.bundle, record.evidence?.bundleHash);
      for (const attempt of record.attempts) {
        const id = attempt.step === 'APPROVAL' ? 'approval' : attempt.step;
        identifier(id, attempt.step === 'APPROVAL' ? 'Approval transaction' : 'Action transaction', attempt.transactionHash, 'transaction', record.review.chain, attempt.state);
        failure(id, attempt.state, attempt.transactionHash, record.notSubmitted ? record.walletDiagnostic?.code : undefined);
        const observed = record.observations?.findLast(item => item.receipt?.transactionHash === attempt.transactionHash);
        fee(id, record.review.chain, attempt.transactionHash, observed?.cost);
        detail('Network fee payer', observed?.walletEnvelope?.feePayer);
        // delta describes the protocol position, not a transferred token amount.
        if (attempt.reconciled && observed?.verdict === 'RECONCILED' && attempt.step !== 'APPROVAL') {
          amount(id, 'Position change', observed.delta, 6, 'USDC');
          if (observed.prePosition && observed.postPosition) {
            const delta = BigInt(observed.postPosition.balance) - BigInt(observed.prePosition.balance);
            const label = attempt.step === 'SUPPLY' ? 'Actual supplied' : attempt.step === 'BORROW' ? 'Actual borrowed' : attempt.step === 'REPAY' ? 'Actual repaid' : 'Actual withdrawn';
            amount(id, label, (delta < 0n ? -delta : delta).toString(), 6, 'USDC', record.review.amount);
          }
        }
      }
      if (record.approvalProof) identifier('approval', 'Approval transaction', record.approvalProof.hash, 'transaction', record.review.chain);
      break;
    }
    case 'lending': {
      const record = source.state.record; if (!record) break;
      evidence.wallet = record.reviews.at(-1)?.fields.owner ?? null; bundle(record.evidence?.bundle, record.evidence?.bundleHash);
      for (const attempt of record.attempts) {
        const review = record.reviews.find(item => item.commitment === attempt.reviewCommitment), observed = record.observations?.findLast(item => item.attemptId === attempt.id);
        const chain = review?.manifest.owner.chainId ?? progress.steps.flatMap(step => step.operations).find(item => item.id === attempt.step)?.chain ?? '';
        identifier(attempt.step, attempt.step.includes('APPROVAL') ? 'Approval transaction' : 'Action transaction', attempt.hash, 'transaction', chain, attempt.state);
        fee(attempt.step, chain, attempt.hash, observed?.cost); failure(attempt.step, attempt.state, attempt.hash);
        if (attempt.reconciled && observed?.verdict === 'RECONCILED') {
          amount(attempt.step, 'Actual received', observed.output, 18, 'WETH', review?.route.expectedOut);
          // Reconciler validates these balance deltas against the actual transfers.
          if (observed.pre && observed.post && ['SUPPLY', 'BORROW', 'SWAP'].includes(attempt.step)) {
            const delta = BigInt(observed.post.aave.balance) - BigInt(observed.pre.aave.balance);
            amount(attempt.step, attempt.step === 'BORROW' ? 'Actual borrowed' : attempt.step === 'SUPPLY' ? 'Actual supplied' : 'Executed input', (delta < 0n ? -delta : delta).toString(), 6, 'USDC');
          }
        }
      } break;
    }
    case 'router': {
      const record = source.state.record; if (!record) break;
      evidence.wallet = record.owner; bundle(record.evidence?.bundle, record.evidence?.bundleHash);
      const review = record.review;
      for (const attempt of record.attempts) {
        identifier(attempt.step, attempt.step === 'APPROVAL' ? 'Approval transaction' : 'Source transaction', attempt.transactionHash, 'transaction', review.intent.sourceChain, attempt.state);
        identifier(attempt.step, 'Replacement transaction', attempt.replacementHash, 'transaction', review.intent.sourceChain, attempt.state);
        fee(attempt.step, review.intent.sourceChain, attempt.receipt?.transactionHash, attempt.receipt?.gasCostWei); failure(attempt.step, attempt.state, attempt.transactionHash, attempt.note ?? undefined);
      }
      identifier('DEPOSIT', 'Source transaction', record.source?.transactionHash, 'transaction', review.intent.sourceChain);
      identifier('DEPOSIT', 'Provider reference · Deposit ID', record.source?.depositId);
      identifier('destination', 'Destination transaction', record.destination?.transactionHash, 'transaction', review.intent.destinationChain);
      identifier('destination', 'Refund transaction', record.refund?.transactionHash, 'transaction', review.intent.sourceChain);
      if (record.source?.safe) amount('DEPOSIT', 'Executed input', record.source.inputAmount, review.route.inputToken.decimals, review.route.inputToken.symbol, review.intent.amount);
      if (record.verdict === 'RECONCILED' && record.destination?.safe) amount('destination', 'Actual received', record.destination.transferAmount, review.route.outputToken.decimals, review.route.outputToken.symbol, review.quote.expectedOutput);
      detail('Source network', shellChainLabel(review.intent.sourceChain)); detail('Destination network', shellChainLabel(review.intent.destinationChain));
      // Route/provider quoted fees are deliberately not reported as actual costs.
      break;
    }
    case 'uniswap-pool': {
      const record = source.state.record; if (!record) break;
      const chain = `eip155:${record.review.chainId}`;
      evidence.wallet = record.owner; bundle(record.evidence?.bundle, record.evidence?.bundleHash);
      for (const attempt of record.attempts) {
        identifier(attempt.step, attempt.step === 'MINT' ? 'Action transaction' : 'Approval transaction', attempt.transactionHash, 'transaction', chain, attempt.state);
        identifier(attempt.step, 'Replacement transaction', attempt.replacementHash, 'transaction', chain, attempt.state);
        fee(attempt.step, chain, attempt.receipt?.transactionHash, attempt.receipt?.gasCostWei); failure(attempt.step, attempt.state, attempt.transactionHash, attempt.note ?? undefined);
      }
      if (record.verdict === 'RECONCILED' && record.position) {
        amount('MINT', 'Actual liquidity deposited · Token 1', record.position.amount0, record.review.token0.decimals, record.review.token0.symbol, record.review.expected?.amount0);
        amount('MINT', 'Actual liquidity deposited · Token 2', record.position.amount1, record.review.token1.decimals, record.review.token1.symbol, record.review.expected?.amount1);
        identifier('MINT', 'Position ID', record.position.tokenId);
      }
      allowance(record.evidence?.residualAllowances.token0); allowance(record.evidence?.residualAllowances.token1); break;
    }
    case 'solana-swap': {
      const record = source.state.record; if (!record) break;
      evidence.wallet = record.review.owner; bundle(record.evidence?.bundle, record.evidence?.bundleHash);
      if (record.attempt) failure('transaction', record.attempt.state, record.attempt.signature, record.notSubmitted ? record.walletDiagnostic?.code : undefined);
      const observed = record.observations?.findLast(item => item.signature === record.attempt?.signature);
      fee('transaction', record.review.chain, observed?.signature, observed?.feeLamports, 9, 'SOL');
      if (record.attempt?.reconciled && observed?.verdict === 'RECONCILED') {
        amount('transaction', 'Executed input', observed.inputSpent, record.review.input.decimals, record.review.input.symbol, record.review.amount);
        amount('transaction', 'Actual received', observed.outputReceived, record.review.output.decimals, record.review.output.symbol, record.review.quote.outAmount);
        amount('transaction', 'Account creation cost', observed.accountCreationLamports, 9, 'SOL');
      } break;
    }
    case 'solana-pool': {
      const record = source.state.record; if (!record) break;
      evidence.wallet = record.review.owner; bundle(record.evidence?.bundle, record.evidence?.bundleHash);
      const observed = record.observations?.findLast(item => item.signature === record.attempt?.signature);
      fee('transaction', record.review.chain, observed?.signature, observed?.feeLamports, 9, 'SOL');
      if (record.attempt?.reconciled && observed?.verdict === 'RECONCILED' && observed.effects) {
        const effects = observed.effects;
        for (const [key, label] of [['deposited', 'Actual liquidity deposited'], ['withdrawnPrincipal', 'Actual withdrawn'], ['collectedFees', 'Fees collected']] as const) {
          amount('transaction', `${label} · Token 1`, effects[`${key}A`], record.review.token0.decimals, record.review.token0.symbol);
          amount('transaction', `${label} · Token 2`, effects[`${key}B`], record.review.token1.decimals, record.review.token1.symbol);
        }
        amount('transaction', 'Account rent paid', effects.rentPaidLamports, 9, 'SOL');
        amount('transaction', 'Account rent refunded', effects.rentRefundedLamports, 9, 'SOL');
      } break;
    }
    case 'transfer': {
      const record = source.state.record; if (!record) break;
      evidence.wallet = record.review.account; bundle(record.evidence?.bundle, record.evidence?.bundleHash);
      if (record.attempt) failure('transfer', record.attempt.state, record.attempt.transactionHash, record.notSubmitted ? record.walletDiagnostic?.code : undefined);
      const observed = record.observations?.findLast(item => item.receipt?.transactionHash === record.attempt?.transactionHash);
      fee('transfer', record.review.chain, record.attempt?.transactionHash, observed?.facts?.fee);
      if (record.attempt?.reconciled && observed?.verdict === 'RECONCILED' && typeof observed.transaction?.value === 'string' && /^0x[0-9a-f]+$/i.test(observed.transaction.value)) {
        amount('transfer', 'Actual transferred', BigInt(observed.transaction.value).toString(), 18, 'ETH', record.review.value);
      } break;
    }
    case 'fork-swap': {
      const record = source.state.execution, prepared = source.state.prepared, actual = record?.evidence.at(-1); if (!prepared) break;
      evidence.wallet = prepared.owner; bundle(actual?.bundle, actual?.evidenceBundleHash);
      for (const attempt of record?.attempts ?? []) {
        identifier(attempt.stepId, attempt.stepId === 'step-approve' ? 'Approval transaction' : 'Action transaction', attempt.transactionHash, 'transaction', 'eip155:31337', attempt.state);
        failure(attempt.stepId, attempt.state, attempt.transactionHash);
      }
      if (actual?.outcome === 'RECONCILED') amount('step-swap', 'Actual received', actual.observedOut, prepared.decimalsOut, prepared.symbolOut);
      // totalFee is a run aggregate; never add it again to receipt-level fees.
      fee('', 'eip155:31337', progress.runKey, actual?.totalFee);
      allowance(actual?.residualAllowance); break;
    }
    case 'fork-pool': {
      const status = source.state.status, actual = status?.reconciliation;
      evidence.wallet = source.state.prepared?.owner ?? null; bundle(status?.evidence?.bundle, status?.evidence?.evidenceBundleHash);
      for (const attempt of status?.journal?.attempts ?? []) {
        identifier('liquidity', attempt.stepId?.startsWith('approve-') ? 'Approval transaction' : 'Action transaction', attempt.transactionHash, 'transaction', 'eip155:31337', attempt.state);
        failure('liquidity', attempt.state, attempt.transactionHash);
      }
      fee('', 'eip155:31337', progress.runKey, actual?.totalEthFee);
      if (actual?.outcome === 'RECONCILED') {
        for (const [units, decimals, symbol] of [[actual.amountWeth, 18, 'WETH'], [actual.amountUsdc, 6, 'USDC']] as const) {
          if (typeof units === 'string' && /^-?(0|[1-9][0-9]*)$/.test(units)) amount('liquidity', units.startsWith('-') ? 'Actual liquidity deposited' : 'Actual received', units.replace(/^-/, ''), decimals, symbol);
        }
        identifier('liquidity', 'Position ID', actual.positionTokenId);
      }
      allowance(actual?.remainingWethAllowance); allowance(actual?.remainingUsdcAllowance); break;
    }
    case 'delegated-swap': {
      const prepared = source.state.status?.prepared; if (!prepared) break;
      detail('Workflow reference', prepared.workflowHash, true); detail('Prepared at', prepared.preparedAt);
      allowance(prepared.reconciliation?.residualTokenAllowance); break;
    }
    case 'composition': {
      const status = source.state.status; if (!status) break;
      for (const event of status.events.filter(item => item.level === 'ATTEMPT')) {
        if (!event.step) continue;
        identifier(event.step, 'Action transaction', event.transactionHash, 'transaction', 'eip155:31337', event.state);
        failure(event.step, event.state, event.transactionHash);
        detail(`${event.step} · ${event.state}`, event.at);
      }
      const swap = status.events.findLast(item => item.level === 'ATTEMPT' && item.step === 'SWAP');
      if (swap?.state === 'RECONCILED') amount('SWAP', 'Actual received', swap.actualWETH, 18, 'WETH');
      const mint = status.events.findLast(item => item.level === 'ATTEMPT' && item.step === 'MINT');
      if (mint?.state === 'RECONCILED') identifier('MINT', 'Position ID', mint.tokenId);
      break;
    }
    case 'cow': {
      const execution = source.state.execution, record = execution?.record; if (!record) break;
      evidence.wallet = record.quote.owner; bundle(execution.evidence?.bundle, execution.evidence?.hash);
      identifier('order', 'Order ID', record.observed?.uid ?? record.compiled?.orderUid, 'order');
      identifier('order', 'Provider reference · Quote ID', record.quote.quoteId);
      detail('Orderbook observed at', record.observed?.observedAt);
      for (const entry of record.history ?? []) detail(`Order · ${entry.state}`, entry.at);
      const sell = Object.values(baseAssetRegistry).find(asset => asset.asset.chainId === record.quote.chainId && 'address' in asset.asset && asset.asset.address === record.quote.sellToken);
      const buy = Object.values(baseAssetRegistry).find(asset => asset.asset.chainId === record.quote.chainId && 'address' in asset.asset && asset.asset.address === record.quote.buyToken);
      if (record.state === 'RECONCILED' && execution.evidence?.bundle.outcome === 'RECONCILED') {
        if (sell) amount('order', 'Scripted executed input', record.observed?.executedSellAmount, sell.asset.decimals, sell.symbol, record.quote.sellAmount);
        if (buy) amount('order', 'Scripted received', record.observed?.executedBuyAmount, buy.asset.decimals, buy.symbol, record.quote.buyAmount);
      } else if (record.observed && (validUnits(record.observed.executedSellAmount) && BigInt(record.observed.executedSellAmount) > 0n || validUnits(record.observed.executedBuyAmount) && BigInt(record.observed.executedBuyAmount) > 0n)) {
        if (sell) amount('order', 'Orderbook reports sold', record.observed.executedSellAmount, sell.asset.decimals, sell.symbol);
        if (buy) amount('order', 'Orderbook reports bought', record.observed.executedBuyAmount, buy.asset.decimals, buy.symbol);
        op('order').note = 'Reported fills await settlement verification. These are orderbook observations.';
      }
      // This adapter exposes no settlement transaction. Never substitute a UID
      // or the scripted receipt's content hash for an on-chain transaction.
      evidence.limitations.push('CoW orderbook and settlement are scripted in this runtime; no public CoW settlement or funds are observed.');
      break;
    }
    case 'unavailable': break;
  }
  const groups = new Map<string, { units: bigint; decimals: number; symbol: string }>();
  for (const cost of costs.values()) {
    const value = simulationAmount(cost.units, cost.decimals, cost.symbol)!;
    if (cost.operation) op(cost.operation).fees.push({ label: `Known network cost · ${shellChainLabel(cost.chain)}`, value });
    const key = cost.chain, group = groups.get(key);
    groups.set(key, { units: (group?.units ?? 0n) + BigInt(cost.units), decimals: cost.decimals, symbol: cost.symbol });
  }
  evidence.knownCosts = [...groups].map(([chain, total]) => ({ label: `Known network cost · ${shellChainLabel(chain)}`, value: simulationAmount(total.units.toString(), total.decimals, total.symbol)! }));
  evidence.limitations = [...new Set(evidence.limitations)];
  return evidence;
}
