// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-016 certification recipe. No transport input or financial observation is invented here. */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MODE_B_PINS } from './mode-b-harness.mjs';
import { ANVIL_PIN, FORK_UPSTREAM_POLICY } from '../../../../packages/reference-compiler/dist/profile.js';
import { RECORDING_POLICY } from './recording-proxy.mjs';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const SOLC_PIN = 'f2857a898be15c69e8de5598dcd3f3e169e94964a0ce9a0bbb1b111f145a81df';
export const SCENARIO = Object.freeze({
  build: 'BUILD-016', executionChainId: 31337, sourceChainId: 8453,
  pool: '0xd0b53d9277642d899df5c87a3966a349a798f224', fee: 500,
  inputAmount: '1000000', totalBudget: '1000000', perPeriodBudget: '1000000',
  triggerDropBps: 500, maximumSlippageBps: 100, maximumExecutions: 1,
  maximumAgeSeconds: 30, periodSeconds: 600, frequencySeconds: 20, cooldownSeconds: 10, durationSeconds: 1800,
  // Only native funds on new disposable LOCAL accounts are declared. Real token balances arise through contract calls.
  localNativeFundingWei: '3000000000000000000000', wrappedFundingWei: '2000000000000000000000',
  fundingSwapInputWei: '10000000000000000', dipMaximumInputWei: '1900000000000000000000',
  localClock: 'max(finalized-source-timestamp+1,record-start-UTC-seconds+3600); one-second local blocks',
  sourceSelection: 'one finalized Base block N/H obtained at recording start; all source reads hash-pinned',
  unresolvedUntilRecording: ['sourceBlockNumber', 'sourceBlockHash', 'sourceContractRuntimeHashes', 'referenceObservation', 'simulationOutput', 'policyHash', 'manifestHash', 'transactionHashes'],
  cases: ['trigger-below-5', 'real-trade-at-integer-5-boundary', 'stale-observation', 'wrong-source', 'authority-expansion',
    'confirmed-unused-revocation', 'expiry', 'direct-concurrent-one-effect', 'atomic-worker-race', 'crash-before-reservation', 'crash-after-reservation', 'restart',
    'uncertain-result-read-only-recovery', 'duplicate-trigger', 'budget-exhausted', 'cooldown-frequency', 'immutable-evidence'],
});
export const SOLC_FLAGS = Object.freeze(['--via-ir', '--optimize', '--optimize-runs', '200', '--evm-version', 'shanghai']);
export function pinnedFile(path, expected) {
  const bytes = readFileSync(path);
  if (hash(bytes) !== expected) throw new Error('BUILD016_TOOL_INPUT_PIN_MISMATCH');
  return bytes;
}
export function toolInputs(env = process.env) {
  if (process.version !== 'v24.21.0') throw new Error('BUILD016_NODE_PIN_MISMATCH');
  const base = env.GRYLOO_BUILD016_INPUTS;
  if (!base?.startsWith('/tmp/') || !env.GRYLOO_BUILD016_SOLC || !env.GRYLOO_ANVIL_BIN)
    throw new Error('BUILD016_TOOL_PATHS_REQUIRED');
  const files = {
    anvil: [env.GRYLOO_ANVIL_BIN, ANVIL_PIN.binarySha256], solc: [env.GRYLOO_BUILD016_SOLC, SOLC_PIN],
    safeL2: [base + '/safe/package/build/artifacts/contracts/SafeL2.sol/SafeL2.json', MODE_B_PINS.safeL2ArtifactSha256],
    safeProxy: [base + '/safe/package/build/artifacts/contracts/proxies/SafeProxy.sol/SafeProxy.json', MODE_B_PINS.safeProxyArtifactSha256],
    roles: [base + '/roles-mastercopies.json', MODE_B_PINS.rolesMastercopiesSha256],
    singletonFactory: [base + '/erc2470-initcode.bin', MODE_B_PINS.eip2470InitCodeSha256],
  };
  for (const [path, pin] of Object.values(files)) pinnedFile(path, pin);
  return { node: {version: process.version, sha256: hash(readFileSync(process.execPath))},
    files: Object.fromEntries(Object.entries(files).map(([key, [path, sha256]]) => [key, {path, sha256}])),
    solcFlags: SOLC_FLAGS, providerPolicy: RECORDING_POLICY, upstreamPolicy: FORK_UPSTREAM_POLICY, scenario: SCENARIO };
}
export function contractInputs(inputs) {
  const json = name => JSON.parse(pinnedFile(inputs.files[name].path, inputs.files[name].sha256));
  const roles = json('roles');
  return {safeL2: json('safeL2').bytecode, safeProxy: json('safeProxy').bytecode,
    singletonFactory: '0x' + Buffer.from(pinnedFile(inputs.files.singletonFactory.path, inputs.files.singletonFactory.sha256)).toString('hex'),
    integrity: roles.Integrity['2.1.0'].bytecode, packer: roles.Packer['2.1.0'].bytecode, roles: roles.Roles['2.1.0'].bytecode};
}
