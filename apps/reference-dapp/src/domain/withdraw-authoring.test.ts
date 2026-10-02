// SPDX-License-Identifier: AGPL-3.0-only
import {it,expect} from 'vitest';
import {parseLocalCommand} from './commands';
import {editorReducer,initialEditor} from './editor';
import {createAuthoredWithdraw,withdrawDetails} from './supply-authoring';
import {createBaseSepoliaReviewContext} from '@defi-workflow-engine/reference-linter';
it('Chat and Canvas share Withdraw IR without requiring a wallet',()=>{
  const initial=initialEditor(),context=createBaseSepoliaReviewContext(),input={network:'Base Sepolia' as const,asset:'USDC' as const,amount:'0.1',recipient:'CONNECTED_OWNER' as const};
  const a=editorReducer(initial,parseLocalCommand('Withdraw 0.1 USDC from Aave on Base Sepolia',initial.workflow,context),context);
  const b=editorReducer(initial,{type:'ADD_WITHDRAW',input,source:'CANVAS',baseRevision:0},context);
  expect(a.error).toBeNull();expect(b.error).toBeNull();expect(a.workflow).toEqual(b.workflow);
  expect(withdrawDetails(createAuthoredWithdraw('node-002',input))).toEqual(input);
  const edit=parseLocalCommand('set node-002 amount 0.09',a.workflow,context);expect(edit.type).toBe('SET_WITHDRAW');expect(editorReducer(a,edit,context).error).toBeNull();
});
