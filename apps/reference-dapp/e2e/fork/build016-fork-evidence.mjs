// SPDX-License-Identifier: AGPL-3.0-only
/** New Evidence Bundle assembly for genuine recording + closed replay. Never relabels a MOCKED bundle. */
import { TextEncoder } from 'node:util';
import { hashArtifactBytes, hashRawBytes, hashJournalBytes, hashModeCPolicy, hashModeCManifest,
  modeCCommitment, serializeModeC } from '../../../../packages/workflow-contracts/dist/index.js';
import { validateArtifact } from '../../../../packages/workflow-contracts/dist/schemas.js';
import { decodeModeBSignedTransaction, reconcileModeB } from '../../../../packages/reference-reconciler/dist/index.js';
import { fromHex, modeBCodeHash } from '../../../../packages/reference-compiler/dist/index.js';
import { verifyTranscriptDocument } from './replay-upstream.mjs';
import { SCENARIO, hash } from './build016-recording-config.mjs';
const bytes=value=>new TextEncoder().encode(serializeModeC(value));
export function assembleBuild016ForkEvidence(c,events,recovered,proof) {
  if(proof?.replayStatus!=='REPLAY_BYTE_IDENTICAL'||!proof.transcript||!events?.length||recovered?.outcome!=='RECONCILED')
    throw new Error('BUILD016_GENUINE_FORK_PROOF_REQUIRED');
  verifyTranscriptDocument(proof.transcript,{accounts:[]});
  if(hash(JSON.stringify(proof.transcript,null,2)+'\n')!==proof.transcriptSha256||!/^[0-9a-f]{64}$/.test(proof.manifestSha256??''))
    throw new Error('BUILD016_SOURCE_TRANSCRIPT_DIGEST_INVALID');
  const p=c.policy,t=proof.transcript;
  if(c.policyHash!==hashModeCPolicy(p)||c.manifestHash!==hashModeCManifest(p,c.manifest)||p.source.pool!==SCENARIO.pool||
    t.sourceChainId!==8453||t.codeFingerprints?.build016?.accounts?.owner!==p.owner||t.codeFingerprints.build016.accounts.executor!==p.executor)
    throw new Error('BUILD016_FORK_BINDING_INVALID');
  const entry=t.exchanges.find(e=>{const r=JSON.parse(e.anvilRequest);return r.method==='eth_getCode'&&r.params[0]===p.source.pool;});
  if(!entry||modeBCodeHash(JSON.parse(entry.providerResponse).result)!==p.source.poolCodeHash)
    throw new Error('BUILD016_REAL_POOL_CODE_UNVERIFIED');
  for(const [i,e] of events.entries()) {
    const {hash,...body}=e;
    if(e.sequence!==i||e.previousHash!==(events[i-1]?.hash??null)||e.policyHash!==c.policyHash||e.manifestHash!==c.manifestHash||
      hash!==modeCCommitment('journal-event',body))throw new Error('BUILD016_HISTORY_INVALID');
  }
  const tx=events.find(e=>e.kind==='SUBMITTING')?.details;
  if(!tx||events.filter(e=>e.kind==='RESERVED').length!==1||events.filter(e=>e.kind==='SUBMITTING').length!==1||
    recovered.transactionHash!==tx.hash||recovered.details.raw!==tx.raw)throw new Error('BUILD016_ONE_ACTION_PROOF_INVALID');
  const signed=decodeModeBSignedTransaction(fromHex(tx.raw),tx.hash);
  if(signed.signer!==p.executor||signed.to!==p.roles||signed.data!==p.executorCalldata)throw new Error('BUILD016_SIGNED_AUTHORITY_INVALID');
  const chain={...recovered.details.chainEvidence};
  for(const key of ['allowanceRemaining','inputDebited','outputCredited','amountIn','minimumOut','residualTokenAllowance'])chain[key]=BigInt(chain[key]);
  if(chain.amountIn!==BigInt(p.maximumSwapAmount)||chain.minimumOut!==BigInt(p.minimumOut)||chain.safe!==p.safe||chain.roles!==p.roles||
    chain.expectedOwner!==p.owner||chain.expectedInput!==p.executorCalldata||reconcileModeB(chain).outcome!=='RECONCILED')
    throw new Error('BUILD016_INDEPENDENT_RECONCILIATION_FAILED');
  const head=events.at(-1),quantity=(address,decimals,amount)=>({asset:{chainId:'eip155:31337',address,decimals},amount:amount.toString()});
  const bundle=validateArtifact('evidence-bundle',{schemaVersion:'1.0.0',evidenceBundleId:'build016-fork-'+head.hash.slice(2,26),version:1,supersedes:null,
    semanticWorkflowHash:p.semanticWorkflowHash,artifactSetHash:p.artifactSetHash,simulationHash:p.simulationHash,policyHash:c.policyHash,
    manifestHash:c.manifestHash,executionPlanHash:c.executionPlanHash,journalHeadHash:hashJournalBytes(bytes(head.journal)).at(-1),observedAt:head.recordedAt,
    environment:'FORK_REPRODUCED',outcome:'RECONCILED',receipts:[{receiptId:tx.hash,contentHash:hashRawBytes('raw-response',bytes(recovered.details.receipt))}],
    differences:[],reconciliation:{balances:[quantity(p.tokenIn,6,chain.inputDebited),quantity(p.tokenOut,18,chain.outputCredited)],
      allowances:[quantity(p.tokenIn,6,chain.residualTokenAllowance)],debt:[],positions:[],fees:[],residualAssets:[],ownership:[{chainId:'eip155:31337',address:p.safe}],
      limitations:['LOCAL_FORK_CHAIN_31337_ONLY','REAL_BASE_PROTOCOL_STATE_LOCAL_NATIVE_FUNDING_AND_CLOCK','SPOT_PRICE_MANIPULATION_NOT_PREVENTED',
        'NEGATIVE_CASES_USE_DECLARED_SNAPSHOT_ISOLATED_BRANCHES','NO_PUBLIC_CHAIN_EXECUTION']},
    evidence:[{evidenceId:'conditional-ledger',kind:'JOURNAL_ENTRY',contentHash:modeCCommitment('evidence-transcript',events)},
      {evidenceId:'canonical-workflow',kind:'EXTERNAL_REFERENCE',contentHash:p.semanticWorkflowHash},
      {evidenceId:'reference-observation',kind:'EXTERNAL_REFERENCE',contentHash:p.referenceHash},
      {evidenceId:'conditional-policy',kind:'EXTERNAL_REFERENCE',contentHash:c.policyHash},
      {evidenceId:'signed-raw',kind:'EXTERNAL_REFERENCE',contentHash:hashRawBytes('raw-response',fromHex(tx.raw))},
      {evidenceId:'source-transcript',kind:'EXTERNAL_REFERENCE',contentHash:'0x'+proof.transcriptSha256},
      {evidenceId:'recording-preflight',kind:'EXTERNAL_REFERENCE',contentHash:'0x'+proof.manifestSha256}]});
  return {bundle,evidenceBundleHash:hashArtifactBytes('evidence-bundle',bytes(bundle))};
}
