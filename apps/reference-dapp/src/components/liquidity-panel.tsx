// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { useState } from 'react';
import { useLiquidity } from '../state/liquidity-store';
import type { LiquidityOperation } from '../server/liquidity-service';
const options: readonly { operation: LiquidityOperation; label: string; description: string }[] = [
  { operation: 'APPROVE_WETH', label: 'Approve WETH', description: 'Finite allowance to the verified Position Manager.' },
  { operation: 'APPROVE_USDC', label: 'Approve USDC', description: 'A separate finite approval.' },
  { operation: 'MINT', label: 'Mint position', description: 'Create one NFT at the authored ticks.' },
  { operation: 'INCREASE', label: 'Increase liquidity', description: 'Adds to the existing range only.' },
  { operation: 'DECREASE_PARTIAL', label: 'Partially decrease', description: 'Moves principal to owed tokens; collection follows.' },
  { operation: 'COLLECT_PARTIAL', label: 'Collect owed tokens', description: 'Transfers owed tokens to the owner.' },
  { operation: 'DECREASE_FULL', label: 'Fully decrease', description: 'Removes all remaining liquidity.' },
  { operation: 'COLLECT_FINAL', label: 'Collect remaining', description: 'Collects all currently owed tokens.' },
  { operation: 'BURN', label: 'Burn empty NFT', description: 'Only when liquidity and owed amounts are zero.' },
  { operation: 'RESET_WETH', label: 'Reset WETH allowance', description: 'Separately reviewed approval of zero.' },
  { operation: 'RESET_USDC', label: 'Reset USDC allowance', description: 'Separately reviewed approval of zero.' },
];
export function LiquidityPanel({ view }: { view: 'simulate' | 'execute' }) {
  const { t: tr } = useLocale();
  const liquidity = useLiquidity();
  const [operation, setOperation] = useState<LiquidityOperation>('APPROVE_WETH');
  const [tokenId, setTokenId] = useState('');
  const [partBps, setPartBps] = useState('5000');
  const prepared = liquidity.prepared;
  const details = options.find(item => item.operation === operation)!;
  const current = liquidity.status?.reconciliation;
  const status = liquidity.status?.journal?.attempts.at(-1)?.state ?? 'NOT_STARTED';
  if (!liquidity.info?.available) return null;
  return <section className="panel liquidity-panel" aria-label={tr(view === 'simulate' ? 'Local fork liquidity simulation' : 'Local fork liquidity execution')}>
    <p className="eyebrow">{tr(view === 'simulate' ? 'Simulate' : 'Execute')}{tr(" · local demo")}</p>
    <h2>{tr("Uniswap v3 position · Base WETH/USDC")}</h2>
    <p className="muted">{tr("Isolated Mode A on local chain 31337. Base state is read only; every token approval and position change needs its own wallet review.")}</p>
    {!liquidity.info?.available && <p role="status">{tr("Local fork liquidity is off. No wallet request is available in this session.")}</p>}
    {view === 'simulate' && liquidity.info?.available && <div className="liquidity-controls">
      <label htmlFor="liquidity-operation">{tr("Next operation")}</label>
      <select id="liquidity-operation" value={operation} onChange={event => setOperation(event.target.value as LiquidityOperation)}>
        {options.map(item => <option key={item.operation} value={item.operation}>{tr(item.label)}</option>)}
      </select>
      <small>{tr(details.description)}</small>
      {!['APPROVE_WETH', 'APPROVE_USDC', 'MINT', 'RESET_WETH', 'RESET_USDC'].includes(operation) && <>
        <label htmlFor="liquidity-token-id">{tr("Position token ID")}</label>
        <input id="liquidity-token-id" type="text" inputMode="numeric" autoComplete="off" maxLength={77} value={tokenId}
          onChange={event => setTokenId(event.target.value)}/>
      </>}
      {operation === 'DECREASE_PARTIAL' && <>
        <label htmlFor="liquidity-part">{tr("Portion to remove (basis points, 1–9999)")}</label>
        <input id="liquidity-part" type="text" inputMode="numeric" autoComplete="off" maxLength={4} value={partBps}
          onChange={event => setPartBps(event.target.value)}/>
      </>}
      <div className="liquidity-buttons">
        <button type="button" disabled={Boolean(liquidity.busy)} onClick={() => liquidity.prepare(operation,
          tokenId || undefined, operation === 'DECREASE_PARTIAL' ? Number(partBps) : undefined)}>{tr("Simulate exact local operation")}</button>
        {tokenId && <button type="button" disabled={Boolean(liquidity.busy)} onClick={() => liquidity.inspect(tokenId)}>{tr("Inspect position")}</button>}
      </div>
      {liquidity.inspection?.ok && <div className="liquidity-readback" role="status">
        <strong>{tr("Independent fork readback")}</strong>
        <p>{tr("Token #")}{tr(liquidity.inspection.value.read.position?.tokenId ?? 'missing')}{tr(" · owner ")}{tr(liquidity.inspection.value.read.position?.owner ?? 'none')}</p>
        <p>{tr("Liquidity ")}{tr(liquidity.inspection.value.read.position?.liquidity ?? '0')}{tr(" · owed WETH ")}{tr(liquidity.inspection.value.read.position?.owed0 ?? '0')}{tr(" · owed USDC ")}{tr(liquidity.inspection.value.read.position?.owed1 ?? '0')}</p>
        <p>{tr("WETH balance ")}{tr(liquidity.inspection.value.read.weth)}{tr(" · USDC balance ")}{tr(liquidity.inspection.value.read.usdc)}{tr(" · allowances ")}{tr(liquidity.inspection.value.read.wethAllowance)}{tr(" WETH units / ")}{tr(liquidity.inspection.value.read.usdcAllowance)}{tr(" USDC units.")}</p>
        <p>{tr("Owed tokens may include withdrawn principal as well as fees; this readback does not attribute earnings.")}</p>
      </div>}
    </div>}
    {prepared && <div className="liquidity-review">
      <h3>{tr(prepared.operation.replaceAll('_', ' '))} · {tr(prepared.step)}</h3>
      <p>{tr("Source block ")}{tr(liquidity.info?.available ? liquidity.info.sourceBlockHash : 'unavailable')}{tr(" · fork state ")}{tr(prepared.poolBlockHash)}</p>
      <p>{tr("Pool ")}{tr(prepared.pool)}{tr(" · current tick ")}{tr(prepared.poolTick)}{tr(" · range state ")}{tr(prepared.composition.state)}</p>
      <p>{tr("Estimated deposit composition: ")}{tr(prepared.composition.amount0)}{tr(" WETH units and ")}{tr(prepared.composition.amount1)}{tr(" USDC units. These are local fork estimates, subject to the exact transaction simulation and minimums.")}</p>
      <p>{tr("Exact simulation: ")}{tr(prepared.simulation.status)} · {tr(prepared.simulation.gasUsed)}{tr(" gas used. Future fees and yields are not estimated.")}</p>
      <p>{tr("Manifest ")}{prepared.artifacts.hashes.manifestHash}{tr(" · policy ")}{tr(prepared.artifacts.hashes.policyHash)}</p>
      {view === 'execute' && <>
        <div className="liquidity-payload"><strong>{tr("Review exact wallet payload")}</strong>
          <p>{tr("Target ")}{tr(liquidity.verified?.target ?? 'unverified')}{tr(" · selector ")}{tr(liquidity.verified?.selector ?? 'unverified')}</p>
          <p>{tr("Payload hash ")}{tr(prepared.payloadHash)}</p>
          <p>{tr("Nonce ")}{tr(prepared.nonce)}{tr(" · gas limit ")}{tr(prepared.gasLimit)}{tr(" · max fee per gas ")}{tr(prepared.maxFeePerGas)}{tr(" wei · deadline ")}{tr(prepared.deadline)}</p>
          <p>{tr("Estimated gas used ")}{tr(prepared.simulation.gasUsed)}{tr("; maximum L2 gas budget ")}{tr(BigInt(prepared.gasLimit) * BigInt(prepared.maxFeePerGas))}{tr(" wei. Observed total fee is shown only after receipt reconciliation.")}</p>
          <dl>{Object.entries(prepared.call.fields).map(([field, value]) => <div key={field}><dt>{tr(field)}</dt><dd>{tr(value)}</dd></div>)}</dl>
          <details><summary>{tr("Exact calldata and unsigned transaction")}</summary><code>{liquidity.verified?.calldata ?? 'Unverified'}</code><code>{tr(prepared.bytes)}</code></details>
        </div>
        <p>{tr("Range, price and balance changes invalidate this review. A wallet rejection or unknown submission requires readback; no automatic retry occurs.")}</p>
        <div className="liquidity-buttons">
          <button type="button" disabled={!liquidity.verified || liquidity.retired || liquidity.recoveryOnly || liquidity.consumed || Boolean(liquidity.busy)} onClick={liquidity.acceptReview}>{tr("Accept exact review")}</button>
          <button type="button" disabled={!liquidity.info?.available || Boolean(liquidity.busy)} onClick={liquidity.connect}>{tr("Connect chain 31337 wallet")}</button>
          <button type="button" disabled={!liquidity.reviewAccepted || !liquidity.wallet || liquidity.retired || liquidity.recoveryOnly || liquidity.consumed || Boolean(liquidity.busy)} onClick={liquidity.request}>{tr("Request this wallet transaction")}</button>
          <button type="button" disabled={!['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN'].includes(status) || Boolean(liquidity.busy)} onClick={liquidity.recoverUnknown}>{tr("Scan unknown submission")}</button>
          <button type="button" disabled={!liquidity.status?.transactionHash || Boolean(liquidity.busy)} onClick={liquidity.observe}>{tr("Read back and reconcile")}</button>
          <button type="button" disabled={Boolean(liquidity.busy)} onClick={liquidity.refresh}>{tr("Refresh status")}</button>
        </div>
        <p role="status">{tr("Wallet: ")}{tr(liquidity.wallet?.label ?? 'not connected')}{tr(" · journal: ")}{tr(status)}{tr(" · outcome: ")}{tr(current?.outcome ?? 'not reconciled')}</p>
        {current && <p>{tr("Result ")}{tr(current.code)}{tr(" · token ID ")}{tr(current.positionTokenId?.toString() ?? 'none')}{tr(" · WETH delta ")}{tr(current.amountWeth?.toString() ?? 'unknown')}{tr(" · USDC delta ")}{tr(current.amountUsdc?.toString() ?? 'unknown')}{tr(" · observed ETH fee ")}{tr(current.totalEthFee?.toString() ?? 'unknown')}{tr(" · remaining WETH allowance ")}{tr(current.remainingWethAllowance ?? 'unknown')}{tr(" · remaining USDC allowance ")}{tr(current.remainingUsdcAllowance ?? 'unknown')}</p>}
        {liquidity.status?.evidence && <p>{tr("Evidence Bundle ")}{tr(liquidity.status.evidence.evidenceBundleHash)} · {tr(liquidity.status.evidence.bundle.environment)} · {tr(liquidity.status.evidence.bundle.outcome)}</p>}
        {liquidity.status?.canonicalJournal && <p>{tr("Canonical journal entries: ")}{tr(liquidity.status.canonicalJournal.entries.length)}{tr(". Remaining allowances and wallet assets are in the independent readback.")}</p>}
        {liquidity.consumed && !liquidity.recoveryOnly && <p role="status">{tr("This reviewed payload has been used for one wallet request. Read back the result; a further change needs a new simulation and review.")}</p>}
        {liquidity.recoveryOnly && <p role="alert">{tr("Recovered session: wallet submission is disabled. Inspect the journal and reconcile the onchain result before a new review.")}</p>}
        {liquidity.retired && <p role="alert">{tr("The semantic workflow changed. This payload is retired; prepare a new one.")}</p>}
      </>}
    </div>}
    {liquidity.error && <p role="alert">{tr(liquidity.error)}</p>}
    {liquidity.busy && <p role="status">{tr(liquidity.busy)}</p>}
  </section>;
}
