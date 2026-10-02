// SPDX-License-Identifier: AGPL-3.0-only
import {describe,it,expect} from 'vitest';
import {createAuthoredLending,lendingNodeInput,lendingCanvasEdges} from './lending-authoring';
import {parseLocalCommand} from './commands';
import {editorReducer,initialEditor} from './editor';
import {describeProposal} from './proposal';
import {createBaseSepoliaReviewContext,validateAuthoringWorkflow} from '@defi-workflow-engine/reference-linter';
import {readLendingComposition,readBorrowNode} from '@defi-workflow-engine/workflow-contracts';
import {resolveWorkflowCapability} from '@defi-workflow-engine/action-registry';
import {createLendingHarness,OWNER} from '../../e2e/lending-harness.mjs';
import {simulateLendingComposition,assertLendingReview,assertLendingFresh,readLendingSnapshot,supplyCall,supplyWord,type SupplyRpc} from '@defi-workflow-engine/reference-compiler';
const context=createBaseSepoliaReviewContext(),input={supply:'0.1',borrow:'0.01',slippage:'50',owner:OWNER};
const workflow=createAuthoredLending('lending',0,input);
describe('BUILD-013 finite semantics, commitments, simulation and safety',()=>{
  it.each([['lending-supply','0.2','supplyAmount','200000'],['lending-borrow','0.02','borrowAmount','20000'],['lending-swap','100','slippageBps',100]] as const)('edits %s independently and preserves canonical OUTPUT_REFERENCE and policy dependency',(nodeId,value,field,expected)=>{
    const changed=createAuthoredLending(workflow.workflowId,1,lendingNodeInput(workflow,nodeId,value));
    validateAuthoringWorkflow(changed,context);
    const fields=readLendingComposition(changed);
    expect(fields).toEqual({...readLendingComposition(workflow),[field]:expected});
    expect(changed.nodes.map(n=>n.nodeId)).toEqual(['lending-supply','lending-borrow','lending-swap']);
    expect(changed.nodes[2]!.inputs[0]).toEqual({name:'amount-in',kind:'OUTPUT_REFERENCE',value:{nodeId:'lending-borrow',outputId:'borrowed-amount'}});
    expect(changed.resourceEdges).toEqual(workflow.resourceEdges);
    expect(changed.nodes[1]!.dependencies).toEqual(['lending-supply']);
    expect(changed.nodes[2]!.userConstraints[0]).toMatchObject({quantity:{amount:fields.borrowAmount}});
  });
  it('projects a Supply dependency/checkpoint and typed Borrow edge without adding semantic nodes',()=>{
    expect(lendingCanvasEdges(workflow)).toEqual([
      {id:'lending-supply-lending-borrow',source:'lending-supply',target:'lending-borrow',label:'Policy checkpoint · HF ≥ 2'},
      {id:'lending-borrow-lending-swap',source:'lending-borrow',target:'lending-swap',label:'Borrowed USDC · OUTPUT_REFERENCE'},
    ]);
    expect(()=>lendingNodeInput(workflow,'POOL_APPROVAL','1')).toThrow('LENDING_NODE_INVALID');
    expect(()=>lendingNodeInput(workflow,'lending-swap','301')).toThrow();
  });
  it('Chat and Canvas proposals produce identical IR only after explicit acceptance',()=>{
    const before=initialEditor(),chat=parseLocalCommand(`compose supply 0.1 USDC to Aave then borrow 0.01 USDC then swap borrowed USDC to WETH on Base Sepolia slippage 50 bps owner ${OWNER}`,before.workflow,context);
    const canvas={type:'AUTHOR_LENDING' as const,input,source:'CANVAS' as const,baseRevision:0};
    const a=editorReducer(before,chat,context),b=editorReducer(before,canvas,context);expect(a.error).toBeNull();expect(a.workflow).toEqual(b.workflow);expect(before.workflow.nodes).toHaveLength(1);
    expect(describeProposal(before,a,chat,context).join(' ')).toContain('invalidates');expect(readLendingComposition(a.workflow as typeof workflow).borrowAmount).toBe('10000');
    expect(a.workflow.resourceEdges[0]).toEqual({fromNodeId:'lending-borrow',outputId:'borrowed-amount',toNodeId:'lending-swap',inputName:'amount-in'});
    // The existing isolated Borrow remains strict; the composition does not weaken its contract.
    expect(()=>readBorrowNode(workflow.nodes[1]!)).toThrow();
  });
  it.each(['substitute-token','extra-liquidity','missing-dependency','untyped-input','other-recipient','other-rate','reordered','missing-edge'])('rejects malformed composed IR: %s',variant=>{
    const w=structuredClone(workflow);
    if(variant==='substitute-token')for(const i of w.nodes[1]!.inputs)if(i.kind==='QUANTITY'&&'address'in i.value.asset)i.value.asset.address='0x036cbd53842c5426634e7929541ec2318f3dcf7e';
    if(variant==='extra-liquidity')w.nodes.push({...w.nodes[0]!,nodeId:'extra',actionType:'asset.liquidity.uniswap-v3'});
    if(variant==='missing-dependency')w.nodes[1]!.dependencies=[];
    if(variant==='untyped-input')w.nodes[2]!.inputs[0]={name:'amount-in',kind:'QUANTITY',value:{asset:readLendingComposition(workflow).borrowed,amount:'10000'}};
    if(variant==='other-recipient')for(const i of w.nodes[1]!.inputs)if(i.kind==='ACCOUNT')i.value.address='0x1111111111111111111111111111111111111111';
    if(variant==='other-rate')for(const i of w.nodes[1]!.inputs)if(i.name==='interest-rate-mode'&&i.kind==='INTEGER')i.value=1;
    if(variant==='reordered')w.nodes.reverse();if(variant==='missing-edge')w.resourceEdges=[];
    expect(()=>validateAuthoringWorkflow(w,context)).toThrow();
  });
  it('does not inherit primitive public evidence or bypass the complete-path runtime gate',()=>{
    const runtime={walletConnected:true,walletChainId:'eip155:84532',artifacts:'CURRENT' as const,simulationReady:true,authorizationReady:true};
    const blocked=resolveWorkflowCapability(workflow,{environment:'PUBLIC_TESTNET',runtime});expect(blocked.executionReady).toBe(false);expect(blocked.evidenceCeiling).toBe('MOCKED');
    expect(resolveWorkflowCapability(workflow,{environment:'PUBLIC_TESTNET',runtime:{...runtime,lendingCompositionViable:true}}).executionReady).toBe(true);
  });
  it('rejects a backward RPC state or a changed hash at the same block',async()=>{
    const state=await readLendingSnapshot(createLendingHarness().rpc,OWNER);
    const older=structuredClone(state);older.aave.block--;expect(()=>assertLendingFresh(state,older)).toThrow('LENDING_RPC_INCONSISTENT');
    const inconsistent=structuredClone(state);inconsistent.aave.blockHash='0x'+supplyWord(77n);expect(()=>assertLendingFresh(state,inconsistent)).toThrow('LENDING_RPC_INCONSISTENT');
  });
  it('compiles borrowed-output linkage into exact input, owner recipient, minimum, variable debt, HF policy and existing-schema Manifest',async()=>{
    const m=createLendingHarness(),r=await simulateLendingComposition(workflow,OWNER,m.rpc);
    expect(r.calls.map(c=>c.id)).toEqual(['POOL_APPROVAL','SUPPLY','BORROW','ROUTER_APPROVAL','SWAP']);expect(r.simulation.propagatedOutputs[0]?.quantity.amount).toBe('10000');
    expect(r.policy.accountRiskRules.every(c=>c.minimumHealthFactorNumerator==='2'&&c.minimumHealthFactorDenominator==='1')).toBe(true);
    expect(r.manifest.schemaVersion).toBe('1.0.0');expect(r.manifest.spendLimits[0]?.maximumAmount).toBe('110000');expect(r.manifest.providers).toEqual({kind:'AUTHORIZED_SET',providerIds:['aave-v3','uniswap.v3']});
    expect(r.policy.allowlists.chains).toEqual(['eip155:84532']);expect(r.policy.checkpointRules[1]?.minimumOutputs[0]?.amount).toBe(r.route.minimumOut);
    const raw=r.calls.at(-1)!.tx.data;expect(BigInt('0x'+raw.slice(266,330))).toBe(10000n);expect(BigInt('0x'+raw.slice(330,394))).toBe(BigInt(r.route.minimumOut));
    expect(r.projected.afterSwap.aave.borrow!.debt).toBe('10000');expect(r.projected.afterSwap.wethBalance).toBe(r.route.expectedOut);
    assertLendingReview(r,workflow,OWNER);expect(()=>assertLendingReview(r,workflow,OWNER,Date.parse(r.expiresAt))).toThrow('LENDING_REVIEW_STALE');
    const changed=createAuthoredLending('lending',1,{...input,borrow:'0.02'});expect(()=>assertLendingReview(r,changed,OWNER)).toThrow();
  });
  it.each(['unsafe-hf','insufficient-collateral','insufficient-usdc','insufficient-gas','wrong-chain','stale-rpc','price-drift','pool-token-mismatch','rpc-inconsistency'])('fails closed: %s',async scenario=>{
    const m=createLendingHarness();let rpc:SupplyRpc=m.rpc,w=workflow;
    if(scenario==='unsafe-hf')w=createAuthoredLending('lending',0,{...input,borrow:'5'});
    if(scenario==='insufficient-collateral'){m.state.scaled=0n;w=createAuthoredLending('lending',0,{...input,borrow:'0.09'});}
    if(scenario==='insufficient-usdc')m.state.balance=1n;if(scenario==='insufficient-gas')m.state.nativeBalance=1n;
    if(scenario==='wrong-chain')m.state.chain='0x1';if(scenario==='stale-rpc')m.state.timestamp-=121;
    if(scenario==='price-drift'){const before=await readLendingSnapshot(rpc,OWNER);m.state.price=110000000n;const after=await readLendingSnapshot(rpc,OWNER);expect(()=>assertLendingFresh(before,after)).toThrow();return;}
    if(scenario==='pool-token-mismatch')rpc=(method,params)=>method==='eth_call'&&(params[0] as {data:string}).data===supplyCall('token0()')?Promise.resolve('0x'+supplyWord(1n)):m.rpc(method,params);
    if(scenario==='rpc-inconsistency'){let count=0;rpc=async(method,params)=>{const r=await m.rpc(method,params);if(method==='eth_getBlockByNumber'&&++count>1)return {...r as object,hash:'0x'+supplyWord(99n)};return r;};}
    await expect(simulateLendingComposition(w,OWNER,rpc)).rejects.toThrow();expect(m.transactions).toHaveLength(0);
  });
});
