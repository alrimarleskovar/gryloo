// SPDX-License-Identifier: AGPL-3.0-only
'use client';
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
  const liquidity = useLiquidity();
  const [operation, setOperation] = useState<LiquidityOperation>('APPROVE_WETH');
  const [tokenId, setTokenId] = useState('');
  const [partBps, setPartBps] = useState('5000');
  const prepared = liquidity.prepared;
  const details = options.find(item => item.operation === operation)!;
  const current = liquidity.status?.reconciliation;
  const status = liquidity.status?.journal?.attempts.at(-1)?.state ?? 'NOT_STARTED';
  if (!liquidity.info?.available) return null;
  return <section className="panel liquidity-panel" aria-label={view === 'simulate' ? 'Local fork liquidity simulation' : 'Local fork liquidity execution'}>
    <p className="eyebrow">{view === 'simulate' ? 'Simulate' : 'Execute'} · local demo</p>
    <h2>Uniswap v3 position · Base WETH/USDC</h2>
    <p className="muted">Isolated Mode A on local chain 31337. Base state is read only; every token approval and position change needs its own wallet review.</p>
    {!liquidity.info?.available && <p role="status">Local fork liquidity is off. No wallet request is available in this session.</p>}
    {view === 'simulate' && liquidity.info?.available && <div className="liquidity-controls">
      <label htmlFor="liquidity-operation">Next operation</label>
      <select id="liquidity-operation" value={operation} onChange={event => setOperation(event.target.value as LiquidityOperation)}>
        {options.map(item => <option key={item.operation} value={item.operation}>{item.label}</option>)}
      </select>
      <small>{details.description}</small>
      {!['APPROVE_WETH', 'APPROVE_USDC', 'MINT', 'RESET_WETH', 'RESET_USDC'].includes(operation) && <>
        <label htmlFor="liquidity-token-id">Position token ID</label>
        <input id="liquidity-token-id" type="text" inputMode="numeric" autoComplete="off" maxLength={77} value={tokenId}
          onChange={event => setTokenId(event.target.value)}/>
      </>}
      {operation === 'DECREASE_PARTIAL' && <>
        <label htmlFor="liquidity-part">Portion to remove (basis points, 1–9999)</label>
        <input id="liquidity-part" type="text" inputMode="numeric" autoComplete="off" maxLength={4} value={partBps}
          onChange={event => setPartBps(event.target.value)}/>
      </>}
      <div className="liquidity-buttons">
        <button type="button" disabled={Boolean(liquidity.busy)} onClick={() => liquidity.prepare(operation,
          tokenId || undefined, operation === 'DECREASE_PARTIAL' ? Number(partBps) : undefined)}>Simulate exact local operation</button>
        {tokenId && <button type="button" disabled={Boolean(liquidity.busy)} onClick={() => liquidity.inspect(tokenId)}>Inspect position</button>}
      </div>
      {liquidity.inspection?.ok && <div className="liquidity-readback" role="status">
        <strong>Independent fork readback</strong>
        <p>Token #{liquidity.inspection.value.read.position?.tokenId ?? 'missing'} · owner {liquidity.inspection.value.read.position?.owner ?? 'none'}</p>
        <p>Liquidity {liquidity.inspection.value.read.position?.liquidity ?? '0'} · owed WETH {liquidity.inspection.value.read.position?.owed0 ?? '0'} · owed USDC {liquidity.inspection.value.read.position?.owed1 ?? '0'}</p>
        <p>WETH balance {liquidity.inspection.value.read.weth} · USDC balance {liquidity.inspection.value.read.usdc} · allowances {liquidity.inspection.value.read.wethAllowance} WETH units / {liquidity.inspection.value.read.usdcAllowance} USDC units.</p>
        <p>Owed tokens may include withdrawn principal as well as fees; this readback does not attribute earnings.</p>
      </div>}
    </div>}
    {prepared && <div className="liquidity-review">
      <h3>{prepared.operation.replaceAll('_', ' ')} · {prepared.step}</h3>
      <p>Source block {liquidity.info?.available ? liquidity.info.sourceBlockHash : 'unavailable'} · fork state {prepared.poolBlockHash}</p>
      <p>Pool {prepared.pool} · current tick {prepared.poolTick} · range state {prepared.composition.state}</p>
      <p>Estimated deposit composition: {prepared.composition.amount0} WETH units and {prepared.composition.amount1} USDC units. These are local fork estimates, subject to the exact transaction simulation and minimums.</p>
      <p>Exact simulation: {prepared.simulation.status} · {prepared.simulation.gasUsed} gas used. Future fees and yields are not estimated.</p>
      <p>Manifest {prepared.artifacts.hashes.manifestHash} · policy {prepared.artifacts.hashes.policyHash}</p>
      {view === 'execute' && <>
        <div className="liquidity-payload"><strong>Review exact wallet payload</strong>
          <p>Target {liquidity.verified?.target ?? 'unverified'} · selector {liquidity.verified?.selector ?? 'unverified'}</p>
          <p>Payload hash {prepared.payloadHash}</p>
          <p>Nonce {prepared.nonce} · gas limit {prepared.gasLimit} · max fee per gas {prepared.maxFeePerGas} wei · deadline {prepared.deadline}</p>
          <p>Estimated gas used {prepared.simulation.gasUsed}; maximum L2 gas budget {BigInt(prepared.gasLimit) * BigInt(prepared.maxFeePerGas)} wei. Observed total fee is shown only after receipt reconciliation.</p>
          <dl>{Object.entries(prepared.call.fields).map(([field, value]) => <div key={field}><dt>{field}</dt><dd>{value}</dd></div>)}</dl>
          <details><summary>Exact calldata and unsigned transaction</summary><code>{liquidity.verified?.calldata ?? 'Unverified'}</code><code>{prepared.bytes}</code></details>
        </div>
        <p>Range, price and balance changes invalidate this review. A wallet rejection or unknown submission requires readback; no automatic retry occurs.</p>
        <div className="liquidity-buttons">
          <button type="button" disabled={!liquidity.verified || liquidity.retired || liquidity.recoveryOnly || liquidity.consumed || Boolean(liquidity.busy)} onClick={liquidity.acceptReview}>Accept exact review</button>
          <button type="button" disabled={!liquidity.info?.available || Boolean(liquidity.busy)} onClick={liquidity.connect}>Connect chain 31337 wallet</button>
          <button type="button" disabled={!liquidity.reviewAccepted || !liquidity.wallet || liquidity.retired || liquidity.recoveryOnly || liquidity.consumed || Boolean(liquidity.busy)} onClick={liquidity.request}>Request this wallet transaction</button>
          <button type="button" disabled={!['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN'].includes(status) || Boolean(liquidity.busy)} onClick={liquidity.recoverUnknown}>Scan unknown submission</button>
          <button type="button" disabled={!liquidity.status?.transactionHash || Boolean(liquidity.busy)} onClick={liquidity.observe}>Read back and reconcile</button>
          <button type="button" disabled={Boolean(liquidity.busy)} onClick={liquidity.refresh}>Refresh status</button>
        </div>
        <p role="status">Wallet: {liquidity.wallet?.label ?? 'not connected'} · journal: {status} · outcome: {current?.outcome ?? 'not reconciled'}</p>
        {current && <p>Result {current.code} · token ID {current.positionTokenId?.toString() ?? 'none'} · WETH delta {current.amountWeth?.toString() ?? 'unknown'} · USDC delta {current.amountUsdc?.toString() ?? 'unknown'} · observed ETH fee {current.totalEthFee?.toString() ?? 'unknown'} · remaining WETH allowance {current.remainingWethAllowance ?? 'unknown'} · remaining USDC allowance {current.remainingUsdcAllowance ?? 'unknown'}</p>}
        {liquidity.status?.evidence && <p>Evidence Bundle {liquidity.status.evidence.evidenceBundleHash} · {liquidity.status.evidence.bundle.environment} · {liquidity.status.evidence.bundle.outcome}</p>}
        {liquidity.status?.canonicalJournal && <p>Canonical journal entries: {liquidity.status.canonicalJournal.entries.length}. Remaining allowances and wallet assets are in the independent readback.</p>}
        {liquidity.consumed && !liquidity.recoveryOnly && <p role="status">This reviewed payload has been used for one wallet request. Read back the result; a further change needs a new simulation and review.</p>}
        {liquidity.recoveryOnly && <p role="alert">Recovered session: wallet submission is disabled. Inspect the journal and reconcile the onchain result before a new review.</p>}
        {liquidity.retired && <p role="alert">The semantic workflow changed. This payload is retired; prepare a new one.</p>}
      </>}
    </div>}
    {liquidity.error && <p role="alert">{liquidity.error}</p>}
    {liquidity.busy && <p role="status">{liquidity.busy}</p>}
  </section>;
}
