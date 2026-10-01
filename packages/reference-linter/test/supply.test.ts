// SPDX-License-Identifier: AGPL-3.0-only
import {describe,it,expect} from 'vitest';
import {createSupplyNode,type SemanticWorkflow} from '@defi-workflow-engine/workflow-contracts';
import {AAVE_V3_BASE_SEPOLIA as p} from '@defi-workflow-engine/action-registry';
import {validateAuthoringWorkflow,createBaseSepoliaReviewContext,lintWorkflow} from '../src/index.js';
const workflow=():SemanticWorkflow=>({schemaVersion:'1.0.0',workflowId:'supply',revision:0,nodes:[createSupplyNode('supply',{chain:p.chain,asset:{chainId:p.chain,address:p.asset,decimals:6},amount:'10000000',beneficiary:'0x1111111111111111111111111111111111111111'})],resourceEdges:[]});
describe('Supply ingress validation',()=>{
  it('validates through the shared linter, authoring findings confer no execution authority',()=>{const w=workflow();expect(validateAuthoringWorkflow(w,createBaseSepoliaReviewContext())).toEqual(w);expect(lintWorkflow(w,createBaseSepoliaReviewContext()).findings[0]?.code).toBe('SUPPLY_SIMULATION_REQUIRED');});
  it.each(['chain','asset','beneficiary','protocol','amount','ports','composition'])('fails closed for invalid %s',kind=>{
    const w=workflow(),node=w.nodes[0]!;
    if(kind==='chain')node.chainId='eip155:1';
    if(kind==='asset'){const amount=node.inputs[0]!;if(amount.kind==='QUANTITY'&&'address'in amount.value.asset)amount.value.asset.address='0x'+'2'.repeat(40);}
    if(kind==='beneficiary'){const b=node.inputs[1]!;if(b.kind==='ACCOUNT')b.value.address='bad';}
    if(kind==='protocol')node.adapterConstraints.protocols=['other'];
    if(kind==='amount'){const a=node.inputs[0]!;if(a.kind==='QUANTITY')a.value.amount='0';}
    if(kind==='ports')node.inputs.push({name:'extra',kind:'BOOLEAN',value:true});
    if(kind==='composition')w.nodes.push({...node,nodeId:'second'});
    expect(()=>validateAuthoringWorkflow(w,createBaseSepoliaReviewContext())).toThrow();
  });
});
