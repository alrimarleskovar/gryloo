// SPDX-License-Identifier: AGPL-3.0-only
/** Additive local evidence over the canonical IR, Journal and existing Mode B reconciliation. */
import { serializeModeC as canonicalJson,modeCCommitment,hashRawBytes,hashArtifactBytes,hashJournalBytes,hashModeCPolicy,hashModeCManifest,
  type ExecutionJournal,type EvidenceBundle } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
import { fromHex,type ModeCCompiled } from '@defi-workflow-engine/reference-compiler';
import { decodeModeBSignedTransaction,reconcileModeB,type ModeBChainEvidence } from './mode-b.js';
type Event={sequence:number;previousHash:string|null;policyHash:string;manifestHash:string;recordedAt:string;kind:string;details:unknown;journal:ExecutionJournal;hash:string};
const bytes=(v:unknown)=>new TextEncoder().encode(canonicalJson(v));
export function buildModeCEvidence(c:ModeCCompiled,events:readonly Event[],previous?:{version:number;hash:string}) {
  if(!events.length||c.policyHash!==hashModeCPolicy(c.policy)||c.manifestHash!==hashModeCManifest(c.policy,c.manifest))throw new Error('MODE_C_EVIDENCE_BINDING');
  if(previous&&(!Number.isSafeInteger(previous.version)||previous.version<1||!/^0x[0-9a-f]{64}$/.test(previous.hash)))throw new Error('MODE_C_EVIDENCE_VERSION');
  for(const [i,e] of events.entries()) {
    const {hash,...body}=e;
    if(e.sequence!==i||e.previousHash!==(events[i-1]?.hash??null)||e.policyHash!==c.policyHash||e.manifestHash!==c.manifestHash||
      hash!==modeCCommitment('journal-event',body))throw new Error('MODE_C_EVIDENCE_HISTORY');
  }
  const head=events.at(-1)!,last=events.findLast(e=>e.kind==='RECONCILIATION')?.details as
    {outcome:string;transactionHash:string;details:{receipt?:unknown;raw?:string;chainEvidence?:Record<string,unknown>}}|undefined;
  const tx=events.find(e=>e.kind==='SUBMITTING')?.details as {hash:string;raw:string}|undefined;
  let outcome:EvidenceBundle['outcome']='INCONCLUSIVE';
  let chain:ModeBChainEvidence|undefined;
  if(last?.details?.chainEvidence&&tx&&last.details.raw&&last.transactionHash===tx.hash) {
    const signed=decodeModeBSignedTransaction(fromHex(last.details.raw),tx.hash);
    const e={...last.details.chainEvidence} as Record<string,unknown>;
    for(const k of ['allowanceRemaining','inputDebited','outputCredited','amountIn','minimumOut','residualTokenAllowance']) {
      if(typeof e[k]!=='string'||! /^-?(?:0|[1-9][0-9]*)$/.test(e[k] as string))throw new Error('MODE_C_EVIDENCE_STATE');
      e[k]=BigInt(e[k] as string);
    }
    chain=e as ModeBChainEvidence;
    if(signed.signer!==c.policy.executor||signed.to!==c.policy.roles||signed.data!==c.policy.executorCalldata||
      chain.safe!==c.policy.safe||chain.roles!==c.policy.roles||chain.expectedOwner!==c.policy.owner||
      chain.expectedInput!==c.policy.executorCalldata||chain.amountIn!==BigInt(c.policy.maximumSwapAmount)||
      chain.minimumOut!==BigInt(c.policy.minimumOut)||last.details.raw!==tx.raw)throw new Error('MODE_C_EVIDENCE_STATE');
    const result=reconcileModeB(chain);
    if(result.outcome!==last.outcome)throw new Error('MODE_C_EVIDENCE_OUTCOME');
    outcome=result.outcome==='RECONCILED'?'RECONCILED':result.outcome==='DIVERGENT'?'DIVERGENT':result.outcome==='REVERTED'?'CONFIRMED_NOT_RECONCILED':'INCONCLUSIVE';
  }
  if(last?.outcome==='RECONCILED'&&outcome!=='RECONCILED')throw new Error('MODE_C_EVIDENCE_INCOMPLETE');
  const p=c.policy,asset=(address:string,decimals:number,amount:bigint)=>({asset:{chainId:'eip155:31337',address,decimals},amount:amount.toString()});
  const bundle=validateArtifact('evidence-bundle',{
    schemaVersion:'1.0.0',evidenceBundleId:'dip-evidence-'+head.hash.slice(2,26),version:previous?previous.version+1:1,supersedes:previous?.hash??null,
    semanticWorkflowHash:p.semanticWorkflowHash,artifactSetHash:p.artifactSetHash,simulationHash:p.simulationHash,policyHash:c.policyHash,
    manifestHash:c.manifestHash,executionPlanHash:c.executionPlanHash,journalHeadHash:hashJournalBytes(bytes(head.journal)).at(-1),observedAt:head.recordedAt,
    environment:'MOCKED',outcome,receipts:last?.details?.receipt?[{receiptId:last.transactionHash,contentHash:hashRawBytes('raw-response',bytes(last.details.receipt))}]:[],
    differences:[],reconciliation:{balances:chain&&outcome==='RECONCILED'?[asset(p.tokenIn,6,chain.inputDebited),asset(p.tokenOut,18,chain.outputCredited)]:[],
      allowances:chain?[asset(p.tokenIn,6,chain.residualTokenAllowance)]:[],debt:[],positions:[],fees:[],residualAssets:[],
      ownership:[{chainId:'eip155:31337',address:p.safe}],limitations:['MOCKED_LOCAL_CHAIN_31337_ONLY','SYNTHETIC_POOL_TOKEN_ROUTER_REAL_PINNED_SAFE_ROLES',
        'SPOT_PRICE_MANIPULATION_NOT_PREVENTED','ONE_ACTION_AUTHORITY_CONSUMED_ON_RESERVATION','NO_PUBLIC_CHAIN_EXECUTION']},
    evidence:[{evidenceId:'conditional-ledger',kind:'JOURNAL_ENTRY',contentHash:modeCCommitment('evidence-transcript',events)},
      {evidenceId:'canonical-workflow',kind:'EXTERNAL_REFERENCE',contentHash:p.semanticWorkflowHash},
      {evidenceId:'reference-observation',kind:'EXTERNAL_REFERENCE',contentHash:p.referenceHash},
      {evidenceId:'conditional-policy',kind:'EXTERNAL_REFERENCE',contentHash:c.policyHash},
      ...tx?[{evidenceId:'signed-raw',kind:'EXTERNAL_REFERENCE',contentHash:hashRawBytes('raw-response',fromHex(tx.raw))}]:[]],
  });
  return {bundle,evidenceBundleHash:hashArtifactBytes('evidence-bundle',bytes(bundle))};
}
