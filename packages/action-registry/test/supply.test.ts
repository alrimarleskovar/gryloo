// SPDX-License-Identifier: Apache-2.0
import {describe,it,expect} from 'vitest';
import {createSupplyNode} from '@defi-workflow-engine/workflow-contracts';
import {AAVE_V3_BASE_SEPOLIA as p,resolveNodeCapability} from '../src/index.js';
const node=createSupplyNode('supply',{chain:p.chain,asset:{chainId:p.chain,address:p.asset,decimals:p.decimals},amount:'10000000',beneficiary:'0x1111111111111111111111111111111111111111'});
describe('exact Aave Supply capability',()=>{
  it('implements only the approved public profile without claiming demonstrated maturity',()=>{
    const capability=resolveNodeCapability(node,{environment:'PUBLIC_TESTNET'});expect(capability.capabilities.EXECUTE).toBe(true);expect(capability.evidenceCeiling).toBeNull();expect(p.chainId).toBe(84532);expect(p.pool).toBe('0x8bab6d1b75f19e9ed9fce8b9bd338844ff79ae27');
  });
  it.each(['MOCK','LOCAL_FORK','MAINNET'])('does not promote %s',environment=>expect(resolveNodeCapability(node,{environment}).capabilities.EXECUTE).toBe(false));
  it('rejects another chain or protocol adapter',()=>{
    expect(resolveNodeCapability({...node,chainId:'eip155:1'},{environment:'PUBLIC_TESTNET'}).capabilities.EXECUTE).toBe(false);
    expect(resolveNodeCapability({...node,adapterConstraints:{adapters:[{id:'other',version:'1.0.0'}],protocols:['other']}},{environment:'PUBLIC_TESTNET'}).capabilities.EXECUTE).toBe(false);
  });
});
