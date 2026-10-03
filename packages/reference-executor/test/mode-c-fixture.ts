// SPDX-License-Identifier: AGPL-3.0-only
import { hashArtifactBytes, hashRawBytes, serializeModeC as canonicalJson, createExactInputSwapNode, MODE_C_SOURCE, MODE_C_VERIFIER,
  MODE_C_USDC, MODE_C_WETH, MODE_C_FACTORY, type QuoteStateArtifact, type SemanticWorkflow, type SimulationBundle } from '@defi-workflow-engine/workflow-contracts';
import { compileModeC, type ModeCCompileInput } from '../../reference-compiler/src/mode-c.js';
export const H='0x'+'a'.repeat(64), S=10n**24n;
export const addr=(n:number)=>'0x'+n.toString(16).padStart(40,'0');
export const artifactHash=(kind:'semantic-workflow'|'quote-state-artifact'|'artifact-set'|'simulation-bundle',o:unknown)=>hashArtifactBytes(kind,new TextEncoder().encode(canonicalJson(o)));
export function poolObservation(workflowHash:string,sqrt=S,at=100,block=10):{artifact:QuoteStateArtifact;raw:string} {
  const raw=canonicalJson({environment:'MOCKED',sqrt:sqrt.toString(),at,block});
  const artifact:QuoteStateArtifact={schemaVersion:'1.0.0',artifactId:`mock-dip-${block}`,semanticWorkflowHash:workflowHash,nodeId:'dip-swap',
    sourceId:MODE_C_SOURCE,adapter:{id:'uniswap-v3.pool-state.build016',version:'1.0.0'},chainId:'eip155:31337',
    chainPosition:{kind:'BLOCK',height:block},retrievedAt:new Date(at*1000).toISOString(),
    freshness:{observedAt:new Date(at*1000).toISOString(),expiresAt:new Date((at+30)*1000).toISOString(),maximumAgeSeconds:30},
    rawResponseHash:hashRawBytes('raw-response',new TextEncoder().encode(raw)),normalizedValues:[
      ...Object.entries({pool:addr(8),'pool-code-hash':H,factory:MODE_C_FACTORY,token0:MODE_C_WETH,token1:MODE_C_USDC,
        'sqrt-price-x96':sqrt.toString(),'block-hash':'0x'+block.toString(16).padStart(64,'0')})
        .map(([name,value])=>({name,kind:'IDENTIFIER' as const,value})),{name:'fee',kind:'INTEGER',value:500}],
    providerReference:{kind:'NONE'},proposedContracts:[],proposedSpenders:[],proposedRecipients:[],fees:[],gas:[],outputBounds:[],
    uncertainty:[{code:'MOCKED',description:'Synthetic pool-state observation for deterministic tests only.'}],
    registryValidation:{registryVersion:'1.0.0',actionType:'asset.swap.exact-input',result:'CONTRACT_VALIDATED',enforcement:'NOT_ENFORCED'}};
  return {artifact,raw};
}
export function fixture(overrides:Partial<ModeCCompileInput>={}) {
  const node=createExactInputSwapNode('dip-swap',{chain:'eip155:31337',input:{chainId:'eip155:31337',address:MODE_C_USDC,decimals:6},
    output:{chainId:'eip155:31337',address:MODE_C_WETH,decimals:18},amount:'1000000',maximumAmount:'1000000',slippageBps:100,protocols:['uniswap-v3']});
  node.requiredAuthorizationClass='MODE_C';
  const workflow:SemanticWorkflow={schemaVersion:'1.0.0',workflowId:'buy-the-dip',revision:1,nodes:[node],resourceEdges:[]};
  const wh=artifactHash('semantic-workflow',workflow), reference=poolObservation(wh).artifact;
  const artifactSet={schemaVersion:'1.0.0' as const,artifactSetId:'dip-artifacts',semanticWorkflowHash:wh,
    artifacts:[{artifactId:reference.artifactId,nodeId:'dip-swap',artifactHash:artifactHash('quote-state-artifact',reference)}]};
  const simulation:SimulationBundle={schemaVersion:'1.0.0',simulationId:'dip-simulation',semanticWorkflowRevision:1,semanticWorkflowHash:wh,
    artifactSetHash:artifactHash('artifact-set',artifactSet),adapters:[],contracts:[],outputs:[{nodeId:'dip-swap',outputId:'weth-output',expected:{asset:{chainId:'eip155:31337',address:MODE_C_WETH,decimals:18},amount:'101'},
      minimum:{asset:{chainId:'eip155:31337',address:MODE_C_WETH,decimals:18},amount:'100'},
      adverse:{asset:{chainId:'eip155:31337',address:MODE_C_WETH,decimals:18},amount:'100'}}],propagatedOutputs:[],failurePaths:[],
    uncertainty:[],unsupportedAssumptions:['MOCKED deterministic simulation; no public transaction.'],freshness:reference.freshness};
  const input:ModeCCompileInput={workflow,reference,artifactSet,simulation,profile:{chainId:31337,safe:addr(1),roles:addr(2),owner:addr(3),executor:addr(4),
    safeCodeHash:H,rolesCodeHash:H,semanticWorkflowHash:wh,quoteHash:H,simulationHash:artifactHash('simulation-bundle',simulation),sourceBlockHash:H},salt:H,
    source:{id:MODE_C_SOURCE,pool:addr(8),poolCodeHash:H,factory:MODE_C_FACTORY,fee:500,maximumAgeSeconds:30},
    verifier:{id:MODE_C_VERIFIER,address:addr(9),templateHash:H,runtimeHash:H},startsAt:100,expiresAt:2000,maximumSlippageBps:100,
    minimumOut:'100',totalBudget:'1000000',perPeriodBudget:'1000000',periodSeconds:600,frequencySeconds:20,cooldownSeconds:10,...overrides};
  return {input,...compileModeC(input)};
}
