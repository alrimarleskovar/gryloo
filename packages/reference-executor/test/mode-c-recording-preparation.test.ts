// SPDX-License-Identifier: AGPL-3.0-only
/** Credential-free engineering checks. No provider, invented owner attestation or execution maturity. */
import { readFile } from 'node:fs/promises';
import { describe, it, expect } from 'vitest';
import { decodeSwap, fromHex } from '@defi-workflow-engine/reference-compiler';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
import { MODE_C_USDC, MODE_C_WETH } from '@defi-workflow-engine/workflow-contracts';
import { SCENARIO } from '../../../apps/reference-dapp/e2e/fork/build016-recording-config.mjs';
import { integerDipBoundary, scenarioWorkflow, encodeFixturePriceMove } from '../../../apps/reference-dapp/e2e/fork/build016-fork-scenario.mjs';
import { OWNER_BILLING_TEMPLATE, validateOwnerBilling, recordBuild016, validateTransportPaths } from '../../../apps/reference-dapp/e2e/fork/build016-owner-recording.mjs';
import { assembleBuild016ForkEvidence } from '../../../apps/reference-dapp/e2e/fork/build016-fork-evidence.mjs';

describe('BUILD-016 credential-free recording preparation (NOT_EVIDENCE)',()=>{
  it('retains the approved canonical one-USDC policy and finite temporal/financial limits',()=>{
    const workflow=validateArtifact('semantic-workflow',scenarioWorkflow());
    expect(workflow.nodes).toHaveLength(1);expect(workflow.nodes[0].requiredAuthorizationClass).toBe('MODE_C');
    expect(SCENARIO).toMatchObject({executionChainId:31337,sourceChainId:8453,fee:500,inputAmount:'1000000',
      totalBudget:'1000000',perPeriodBudget:'1000000',triggerDropBps:500,maximumSlippageBps:100,
      maximumExecutions:1,maximumAgeSeconds:30,frequencySeconds:20,cooldownSeconds:10});
    expect(SCENARIO.unresolvedUntilRecording).toContain('referenceObservation');
  });
  it('computes the exact nearest eligible integer boundary from the actual historical pool value',async()=>{
    const historical=JSON.parse(await readFile('docs/builds/BUILD-016-FORK-PREFLIGHT.json','utf8'));
    const ref=BigInt(historical.priceTransitionCoverage.referenceSqrtPriceX96),target=integerDipBoundary(ref);
    expect(target.toString()).toBe(historical.priceTransitionCoverage.maximumEligibleSqrtPriceX96);
    expect(target*target*100n<=ref*ref*95n).toBe(true);
    expect((target+1n)*(target+1n)*100n>ref*ref*95n).toBe(true);
  });
  it('keeps bounded local funding trades separate from delegated swap authority',()=>{
    const recipient='0x0000000000000000000000000000000000000001';
    const zero=encodeFixturePriceMove(100n,recipient,2000n,0n);
    expect(decodeSwap(fromHex(zero))).toMatchObject({tokenIn:MODE_C_WETH,tokenOut:MODE_C_USDC,fee:500,amountIn:100n,amountOutMinimum:1n});
    const bounded=encodeFixturePriceMove(100n,recipient,2000n,123n);
    expect(BigInt('0x'+bounded.slice(2+360*2,2+392*2))).toBe(123n);
    expect(()=>decodeSwap(fromHex(bounded))).toThrow('ABI_NON_CANONICAL');
    expect(()=>encodeFixturePriceMove(100n,recipient,2000n,1n<<160n)).toThrow('BUILD016_SETUP_PRICE_LIMIT_INVALID');
  });
  it('makes every owner-observed billing value a placeholder and refuses it as an attestation',()=>{
    for(const key of ['usedMonthlyCu','remainingMonthlyCu','monthlyAllowanceCu','reportedOn','plan',
      'paymentMethod','paidAddOn','payAsYouGo','overage','autoUpgrade','credentialRotated','previousCredentialDeleted','rotatedOn'])
      expect(typeof OWNER_BILLING_TEMPLATE[key]).toBe('string');
    expect(()=>validateOwnerBilling(OWNER_BILLING_TEMPLATE)).toThrow('BILLING_CONFIRMATION_INCOMPLETE');
    expect(()=>validateOwnerBilling({})).toThrow('BILLING_CONFIRMATION_INCOMPLETE');
  });
  it('refuses recording without a sealed root/digest before inspecting any owner file',async()=>{
    await expect(recordBuild016(undefined,undefined,undefined,undefined)).rejects.toThrow('BUILD016_SEALED_PREFLIGHT_REQUIRED');
    await expect(recordBuild016('/tmp/historical-spent', '0'.repeat(64),undefined,undefined)).rejects.toThrow('BUILD016_SEALED_PREFLIGHT_REQUIRED');
  });
  it('refuses paths inside a Git checkout before reading any transport contents',()=>{
    expect(()=>validateTransportPaths(process.cwd()+'/not-a-credential',process.cwd()+'/not-a-billing-file',Date.now()))
      .toThrow('BUILD016_OWNER_FILE_OUTSIDE_GIT_REQUIRED');
  });
  it('cannot promote historical MOCKED evidence through the fork assembler',async()=>{
    const mocked=JSON.parse(await readFile('docs/builds/BUILD-016-EVIDENCE.json','utf8'));
    expect(mocked.environment).toBe('MOCKED');
    expect(()=>assembleBuild016ForkEvidence(mocked.compiled,mocked.events,mocked.result?.reconciliation,{replayStatus:'LOCAL_ONLY'}))
      .toThrow('BUILD016_GENUINE_FORK_PROOF_REQUIRED');
  });
});
