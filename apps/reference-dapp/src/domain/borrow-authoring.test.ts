// SPDX-License-Identifier: AGPL-3.0-only
import {it,expect} from 'vitest';
import {parseLocalCommand} from './commands';
import {editorReducer,initialEditor} from './editor';
import {createAuthoredBorrow,borrowDetails,parseSupplyAmount} from './supply-authoring';
import {createBaseSepoliaReviewContext} from '@defi-workflow-engine/reference-linter';
const owner='0x1111111111111111111111111111111111111111';
it('Chat and Canvas produce the same Borrow IR through the shared reducer',()=>{
  const initial=initialEditor(),context=createBaseSepoliaReviewContext();
  const chat=parseLocalCommand('Borrow 0.01 USDC from Aave on Base Sepolia',initial.workflow,context,owner);
  const canvas={type:'ADD_BORROW' as const,input:{network:'Base Sepolia' as const,asset:'USDC' as const,amount:'0.01',beneficiary:owner},source:'CANVAS' as const,baseRevision:0};
  const a=editorReducer(initial,chat,context),b=editorReducer(initial,canvas,context);expect(a.error).toBeNull();expect(b.workflow).toEqual(a.workflow);
  const edit=parseLocalCommand('set node-002 amount 0.02',a.workflow,context,owner);expect(edit.type).toBe('SET_BORROW');
  const updated=editorReducer(a,edit,context);expect(updated.error).toBeNull();expect(updated.workflow.revision).toBe(2);
});
it('validates amounts and the current runtime asset',()=>{
  const input={network:'Base Sepolia' as const,asset:'USDC' as const,amount:'0.01',beneficiary:owner};
  expect(borrowDetails(createAuthoredBorrow('node-002',input))).toEqual(input);
  for(const amount of ['0','-1','NaN','0.0000001','1e-2','01','1.',''])expect(()=>parseSupplyAmount(amount)).toThrow();
  expect(()=>createAuthoredBorrow('node-002',{...input,asset:'WETH' as 'USDC'})).toThrow('UNSUPPORTED');
});
