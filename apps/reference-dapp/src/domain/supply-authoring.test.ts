// SPDX-License-Identifier: AGPL-3.0-only
import {describe,it,expect} from 'vitest';
import {createBaseSepoliaReviewContext} from '@defi-workflow-engine/reference-linter';
import {parseLocalCommand,commandIsValid} from './commands';
import {editorReducer,initialEditor} from './editor';
import {parseSupplyAmount,supplyWalletNonce,supplyWalletTransaction,type SupplyInput} from './supply-authoring';
import {editorHistoryReducer,initialEditorHistory} from './editor-history';
const context=createBaseSepoliaReviewContext(),beneficiary='0x1111111111111111111111111111111111111111';
const input:SupplyInput={network:'Base Sepolia',asset:'USDC',amount:'10',beneficiary};
describe('chat/canvas canonical Supply equivalence',()=>{
  it('produces identical IR from the two authoring surfaces',()=>{
    const initial=initialEditor(),chat=parseLocalCommand('Supply 10 USDC to Aave on Base Sepolia',initial.workflow,context,beneficiary);
    const canvas={type:'ADD_SUPPLY' as const,input,source:'CANVAS' as const,baseRevision:0};
    expect(editorReducer(initial,chat,context)).toEqual(editorReducer(initial,canvas,context));expect(commandIsValid({...canvas,input:{...input,extra:true}})).toBe(false);
  });
  it('requires explicit beneficiary when no wallet session exists',()=>{expect(()=>parseLocalCommand('Supply 10 USDC to Aave on Base Sepolia',initialEditor().workflow,context)).toThrow('BENEFICIARY');expect(parseLocalCommand('Supply 10 USDC to Aave on Base Sepolia beneficiary '+beneficiary,initialEditor().workflow,context).type).toBe('ADD_SUPPLY');});
  it.each(['0','-1','1e2','01','1.0000001','NaN'])('rejects amount %s',value=>expect(()=>parseSupplyAmount(value)).toThrow());
  it('edits, invalidates revisions and rejects out-of-scope composition',()=>{
    const added=editorReducer(initialEditor(),{type:'ADD_SUPPLY',input,source:'CANVAS',baseRevision:0},context);
    const edit=parseLocalCommand('set node-002 amount 11',added.workflow,context);expect(editorReducer(added,edit,context).workflow.revision).toBe(2);
    expect(editorReducer(added,{type:'ADD_SUPPLY',input,source:'CANVAS',baseRevision:1},context).error).toBe('SUPPLY_ISOLATED_ONLY');
    expect(editorReducer(added,{type:'SET_SUPPLY',nodeId:'node-002',input,source:'CANVAS',baseRevision:0},context).error).toContain('CONFLICT');
  });
  it('undo/redo uses fresh revisions rather than reviving an old authorization',()=>{
    let h=editorHistoryReducer(initialEditorHistory(),{type:'COMMAND',command:{type:'ADD_SUPPLY',input,source:'CANVAS',baseRevision:0},context});
    h=editorHistoryReducer(h,{type:'UNDO'});expect(h.editor.workflow.revision).toBe(2);h=editorHistoryReducer(h,{type:'REDO'});expect(h.editor.workflow.revision).toBe(3);expect(h.editor.workflow.nodes[1]?.actionType).toBe('supply');
  });
});

describe('Supply injected wallet quantities',()=>{
  it.each([3,'0x3',0,'0x0',Number.MAX_SAFE_INTEGER])('normalizes lossless pending nonce %s',value=>expect(supplyWalletNonce(value)).toBe(BigInt(value)));
  it.each([-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'3','0x03',null,{}])('rejects invalid nonce %s before wallet handoff',value=>expect(()=>supplyWalletNonce(value)).toThrow('SUPPLY_WALLET_NONCE_RESPONSE_INVALID'));
  it('omits application nonce without changing exact transaction semantics or recovery metadata',()=>{
    const prepared={from:'0x8ef12e4e2fd397c227492019f626b5d1c5e41b3b',to:'0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f',data:'0x095ea7b30000000000000000000000008bab6d1b75f19e9ed9fce8b9bd338844ff79ae2700000000000000000000000000000000000000000000000000000000000f4240',chainId:'0x14a34',value:'0x0',nonce:'stale',gas:'0xc350',gasPrice:'0xf4240'};
    const request=supplyWalletTransaction(prepared);expect(request).not.toHaveProperty('nonce');expect(prepared.nonce).toBe('stale');expect(request).toEqual({...prepared,nonce:undefined});
    for(const field of ['chainId','gas','gasPrice','maxFeePerGas','maxPriorityFeePerGas','value'])expect(()=>supplyWalletTransaction({...prepared,[field]:'0x00'})).toThrow('SUPPLY_WALLET_QUANTITY_INVALID');
  });
});
