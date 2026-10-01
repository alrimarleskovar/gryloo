// SPDX-License-Identifier: Apache-2.0
import {describe,it,expect} from 'vitest';
import {createSupplyNode,readSupplyNode,hashArtifactBytes} from '../src/index.js';
const fields={chain:'eip155:84532',asset:{chainId:'eip155:84532',address:'0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f',decimals:6},amount:'10000000',beneficiary:'0x1111111111111111111111111111111111111111'};
describe('canonical Supply IR',()=>{
  it('uses the existing frozen SemanticWorkflow with one supply action',()=>{
    const node=createSupplyNode('supply',fields);expect(node.actionType).toBe('supply');expect(node.adapterConstraints.protocols).toEqual(['aave-v3']);expect(readSupplyNode(node)).toEqual(fields);
    expect(hashArtifactBytes('semantic-workflow',new TextEncoder().encode(JSON.stringify({schemaVersion:'1.0.0',workflowId:'supply',revision:0,nodes:[node],resourceEdges:[]})))).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it.each(['0','-1','1.5','01',(1n<<256n).toString()])('rejects amount %s',amount=>expect(()=>createSupplyNode('supply',{...fields,amount})).toThrow());
  it('requires explicit valid beneficiary, matching chain and closed ports',()=>{
    expect(()=>createSupplyNode('supply',{...fields,beneficiary:'0x'+'0'.repeat(40)})).toThrow();
    expect(()=>createSupplyNode('supply',{...fields,chain:'eip155:1'})).toThrow();
    const node=createSupplyNode('supply',fields);node.dependencies=['other'];expect(()=>readSupplyNode(node)).toThrow();
  });
});
