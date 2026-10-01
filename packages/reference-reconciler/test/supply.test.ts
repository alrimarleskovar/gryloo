// SPDX-License-Identifier: AGPL-3.0-only
import {describe,it,expect} from 'vitest';
import {createSupplyNode,type SemanticWorkflow} from '@defi-workflow-engine/workflow-contracts';
import {simulateSupply,AAVE_V3_BASE_SEPOLIA as p,supplyHex} from '@defi-workflow-engine/reference-compiler';
import {reconcileSupplyAttempt,verifySupplyPosition,buildSupplyEvidence} from '../src/supply.js';
import {supplyModel,SUPPLY_OWNER} from '../../../apps/reference-dapp/e2e/supply-fixtures';
const workflow:SemanticWorkflow={schemaVersion:'1.0.0',workflowId:'supply',revision:0,nodes:[createSupplyNode('supply',{chain:p.chain,asset:{chainId:p.chain,address:p.asset,decimals:6},amount:'10000000',beneficiary:SUPPLY_OWNER})],resourceEdges:[]};
async function executed(){const model=supplyModel();model.state.allowance=10000000n;const review=await simulateSupply(workflow,SUPPLY_OWNER,model.rpc);const transaction=review.transactions[0]!;
  const hash=await model.rpc('MOCK_submit',[{...transaction,nonce:'0x0',gas:supplyHex(review.gasLimits[0]!),gasPrice:'0x1e8480'}]) as string;
  return {model,review,attempt:{step:'SUPPLY' as const,nonce:'0',transaction,transactionHash:hash,preparedAtBlock:10}};}
describe('independent Aave Supply reconciliation',()=>{
  it('requires real position readback and exact transaction/events',async()=>{const {model,review,attempt}=await executed();const observed=await reconcileSupplyAttempt(review,attempt,model.rpc);expect(observed.verdict).toBe('RECONCILED');expect(observed.delta).toBe('10000000');expect(observed.scaledDelta).toBe('8000000');expect(observed.cost).toBe('140000000000');});
  it.each(['pool','account','calldata','amount','chain','beneficiary','position','revert','canonical','gas','fee'])('rejects inconsistent %s evidence',async kind=>{
    const {model,review,attempt}=await executed(),tx=model.transactions[0]!,receipt=model.receipts.get(attempt.transactionHash)!;
    if(kind==='pool')tx.to='0x'+'2'.repeat(40);if(kind==='account')tx.from='0x'+'2'.repeat(40);if(kind==='calldata')tx.input='0xdeadbeef';if(kind==='amount')review.amount='20000000';
    if(kind==='chain')model.state.chain='0x1';if(kind==='beneficiary')review.beneficiary='0x'+'2'.repeat(40);
    if(kind==='gas')tx.gas='0xffffff';if(kind==='fee')tx.gasPrice='0xffffff';
    if(kind==='position'){const state=model.history.get(11) as {scaled:bigint};state.scaled+=100n;}
    if(kind==='revert')receipt.status='0x0';if(kind==='canonical')receipt.blockHash='0x'+'a'.repeat(64);
    expect((await reconcileSupplyAttempt(review,attempt,model.rpc)).verdict).toBe('DIVERGENT');
  });
  it('RPC failure remains inconclusive even with a successful receipt',async()=>{const {model,review,attempt}=await executed();const rpc=async(method:string,params:readonly unknown[])=>{if(method==='eth_call')throw new Error('RPC_FAILED');return model.rpc(method,params);};expect((await reconcileSupplyAttempt(review,attempt,rpc)).verdict).toBe('INCONCLUSIVE');});
  it('accounts for index growth and bounded rounding rather than raw balance delta',()=>{
    expect(verifySupplyPosition('10',{scaledPosition:'80',position:'100',index:(125n*10n**25n).toString()},{scaledPosition:'88',position:'119',index:(135n*10n**25n).toString()})).toEqual({delta:'11',scaledDelta:'8'});
    expect(()=>verifySupplyPosition('10',{scaledPosition:'80',position:'100',index:(125n*10n**25n).toString()},{scaledPosition:'80',position:'110',index:(1375n*10n**24n).toString()})).toThrow('POSITION');
  });
  it('cannot promote unverified/receipt-only evidence',()=>{expect(()=>buildSupplyEvidence({id:'supply',review:{} as never,journal:{} as never,provenance:'PUBLIC_TESTNET',ownerInitiated:true,observations:[]})).toThrow('NOT_RECONCILED');});
});
