// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createBridgeSwapWorkflow, ARBITRUM_USDC, ARBITRUM_WETH } from './bridge-swap-authoring';
import { advanceMockedBridge, authorizeBridge, authorizeSwap, newBuild009Run, quoteDestination, reconcileMockedDestination,
  reconcileMockedSwap, recheckMockedSource, recheckMockedSwap, submitMockedSource, submitMockedSwap } from './build009-run';
import type { Build009Quote } from '../server/build009-lifi';
const owner='0x1111111111111111111111111111111111111111';
const hash='0x'+'a'.repeat(64);
const future=new Date(Date.now()+60_000).toISOString();
const quote=(stage:'bridge'|'swap', amountIn:string):Build009Quote=>({ stage, routeId:'route', provider:'test', owner,
  fromChainId:stage==='bridge'?8453:42161,toChainId:42161,fromToken:stage==='bridge'?'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913':ARBITRUM_USDC,
  toToken:stage==='bridge'?ARBITRUM_USDC:ARBITRUM_WETH,amountIn,expectedOut:'990000',minimumOut:'980000',approvalSpender:owner,
  transaction:{chainId:stage==='bridge'?8453:42161,from:owner,to:owner,data:'0x12345678',value:'0x0',gasLimit:'0x1',gasPrice:'0x1'},
  observedAt:new Date().toISOString(),expiresAt:future,rawHash:hash});
const workflow=createBridgeSwapWorkflow('workflow-local',1,{amount:'1',slippageBps:'50',swapSlippageBps:'50'});
describe('BUILD-009 MOCKED lifecycle',()=>{
  it('reconciles an observed amount before a separately quoted swap and preserves partial completion',()=>{
    let run=newBuild009Run(workflow,owner,quote('bridge','1000000'),hash);
    run=authorizeBridge(run,owner,hash);run=submitMockedSource(run,false);
    run=advanceMockedBridge(run);run=advanceMockedBridge(run);run=advanceMockedBridge(run);
    expect(run.state).toBe('BRIDGE_DESTINATION_CONFIRMED');
    expect(() => quoteDestination(run,quote('swap','985000'),hash)).toThrow();
    run=reconcileMockedDestination(run,{owner,token:ARBITRUM_USDC,chainId:42161,sourceHash:run.sourceHash!,destinationHash:run.destinationHash!,before:'0',after:'985000'});
    expect(run.state).toBe('PARTIAL_COMPLETION');expect(run.received).toBe('985000');
    expect(()=>quoteDestination(run,quote('swap','990000'),hash)).toThrow();
    run=quoteDestination(run,quote('swap','985000'),hash);run=authorizeSwap(run,owner,hash);
    run=submitMockedSwap(run,false);
    run=reconcileMockedSwap(run,{owner,token:ARBITRUM_WETH,chainId:42161,swapHash:run.swapHash!,before:'0',after:'980000'});
    expect(run.state).toBe('SWAP_RECONCILED');expect(run.events.map(e=>e.state)).toContain('PARTIAL_COMPLETION');
  });
  it('late MOCKED arrival reaches partial completion but cannot revive expired authority',()=>{
    const expiring={...quote('bridge','1000000'),expiresAt:new Date(Date.now()+1000).toISOString()};
    let run=newBuild009Run(workflow,owner,expiring,hash);
    run=authorizeBridge(run,owner,hash);run=submitMockedSource(run,false);
    run=advanceMockedBridge(run);run=advanceMockedBridge(run);run=advanceMockedBridge(run);
    run=reconcileMockedDestination(run,{owner,token:ARBITRUM_USDC,chainId:42161,sourceHash:run.sourceHash!,destinationHash:run.destinationHash!,before:'0',after:'985000'});
    expect(run.state).toBe('PARTIAL_COMPLETION');
    expect(()=>authorizeBridge(run,owner,hash,Date.now()+2000)).toThrow();
    const expiredSwap={...quote('swap','985000'),expiresAt:new Date(Date.now()-1000).toISOString()};
    expect(()=>quoteDestination(run,expiredSwap,hash)).toThrow();
    run=quoteDestination(run,quote('swap','985000'),hash);
    expect(run.state).toBe('SWAP_QUOTED');
    expect(run.swapManifestHash).toBe(hash);
  });
  it('never resends either unknown attempt and rejects expired authority',()=>{
    let run=newBuild009Run(workflow,owner,quote('bridge','1000000'),hash);
    expect(()=>authorizeBridge(run,owner,hash,Date.parse(future)+1)).toThrow();
    run=authorizeBridge(run,owner,hash);run=submitMockedSource(run,true);
    expect(()=>submitMockedSource(run,false)).toThrow();
    run=recheckMockedSource(run);expect(run.state).toBe('BRIDGE_SOURCE_SUBMITTED');
    run=advanceMockedBridge(run);run=advanceMockedBridge(run);run=advanceMockedBridge(run);
    run=reconcileMockedDestination(run,{owner,token:ARBITRUM_USDC,chainId:42161,sourceHash:run.sourceHash!,destinationHash:run.destinationHash!,before:'0',after:'985000'});
    run=quoteDestination(run,quote('swap','985000'),hash);run=authorizeSwap(run,owner,hash);run=submitMockedSwap(run,true);
    expect(()=>submitMockedSwap(run,false)).toThrow();
    run=recheckMockedSwap(run);expect(run.state).toBe('SWAP_SUBMITTED');
  });
});
