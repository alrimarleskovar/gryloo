// SPDX-License-Identifier: AGPL-3.0-only
/** Demo-only orchestration of the existing LOCAL engine. Only synthetic fixtures enter this boundary. */
import { computeUtxoNullifier, createRecoverableChangeUtxo, deriveSwapRefundAuthorization,
  deriveUtxoKeypairFromSpendKey, getNkFromUtxoPrivateKey } from '@cloak.dev/sdk';
import { compileCloakLocalReview, verifyCloakLocalReview, type CloakLocalRoute } from '@defi-workflow-engine/reference-compiler';
import { readExactInputSwap, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { CLOAK_RUNTIME, encodePrivateNote } from './cloak-adapter';
import { authorizeCloakLocal, cloakLocalReviewDigest, CloakLocalLedger, executeCloakLocal,
  prepareCloakLocalExecution, recoverCloakLocal, type CloakLocalOutcome } from './local-execution';
import { PrivateStateVault, type PrivateState, type VaultBackend, type VaultReference } from './vault';
import type { SolanaSession } from '../wallet/solana-wallet';

export const PRIVACY_DEMO_LABEL = 'LOCAL DEMO / MOCKED EXECUTION — NO MAINNET TRANSACTION';
// Public fixture material. Never use these deterministic values for a real note or real funds.
const demoPassphrase = 'public synthetic LOCAL demo vault only';
const owner = '11111111111111111111111111111111';
const fail = (code: string): never => { throw new Error(code); };
export function createPrivacyDemoStore(): VaultBackend {
  const records = new Map<string, string>();
  return { get: async k => records.get(k) ?? null,
    putNew: async (k, v) => { if (records.has(k)) fail('PRIVACY_DUPLICATE'); records.set(k, v); },
    putManyNew: async entries => {
      if (new Set(entries.map(e => e.key)).size !== entries.length || entries.some(e => records.has(e.key))) fail('PRIVACY_RESERVATION_CONFLICT');
      for (const e of entries) records.set(e.key, e.value);
    } };
}
async function syntheticState(runId: string): Promise<PrivateState> {
  const key = await deriveUtxoKeypairFromSpendKey(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
  const nk = getNkFromUtxoPrivateKey(key.privateKey);
  const input = (await createRecoverableChangeUtxo(30_000_000n, key, nk, CLOAK_RUNTIME.nativeMint, 1n, 0)).utxo; input.index = 0;
  const change = await createRecoverableChangeUtxo(10_000_000n, key, nk, CLOAK_RUNTIME.nativeMint, 2n, 0);
  const refund = await deriveSwapRefundAuthorization(nk, await computeUtxoNullifier(input));
  const hex = (v: bigint) => v.toString(16).padStart(64, '0');
  return { format: 'flofi.cloak-private-state.v1', checkpoint: 'prepared', runId, owner,
    genesisHash: CLOAK_RUNTIME.genesisHash, programId: CLOAK_RUNTIME.programId, manifestHash: '0x' + '0'.repeat(64),
    inputNotes: [await encodePrivateNote(input)], outputNotes: [await encodePrivateNote(change.utxo)],
    viewingKeyNk: Array.from(nk, b => b.toString(16).padStart(2, '0')).join(''), noteSalt: change.noteSalt.toString(),
    refund: { privateKey: hex(refund.privateKey), publicKey: hex(refund.publicKey), blinding: hex(refund.blinding), derivedFromNk: true },
    swapStatePda: null, signature: null };
}
export type PrivacyDemoPhase = 'SIMULATED' | 'REVIEWED' | 'MANIFEST' | 'AUTHORIZED' | 'EXECUTED' | 'RECOVERED' | 'RECOVERY_REQUIRED';
export type PrivacyDemoSnapshot = Awaited<ReturnType<PrivacyDemoRun['snapshot']>>;
export class PrivacyDemoRun {
  private vault: PrivateStateVault;
  private authorization: Awaited<ReturnType<typeof authorizeCloakLocal>> | null = null;
  private readonly ledger = new CloakLocalLedger();
  private phase: PrivacyDemoPhase = 'SIMULATED';
  private attempted = false;
  private busy = false;
  private signatureRequests = 0;
  private outcome: CloakLocalOutcome | null = null;
  private restarts = 0;
  private readonly session: SolanaSession;
  private constructor(private readonly backend: VaultBackend, readonly review: ReturnType<typeof compileCloakLocalReview>,
    private readonly reference: VaultReference, private readonly reviewDigest: string) {
    this.vault = new PrivateStateVault(backend, demoPassphrase);
    const account = { address: owner, chains: ['solana:mainnet'], features: ['solana:signMessage', 'solana:signTransaction'] };
    const denySignature = () => { this.signatureRequests++; return fail('CLOAK_DEMO_SIGNING_FORBIDDEN'); };
    this.session = { chain: 'solana:mainnet', account, wallet: { name: 'LOCAL synthetic acknowledgment only', accounts: [account], chains: account.chains,
      features: { 'solana:signMessage': { signMessage: denySignature }, 'solana:signTransaction': { signTransaction: denySignature },
        'standard:events': { on: () => () => undefined } } } };
  }
  static async create(workflow: SemanticWorkflow, nowMs = Date.now(), backend = createPrivacyDemoStore()): Promise<PrivacyDemoRun> {
    const snapshot = structuredClone(workflow), f = readExactInputSwap(snapshot.nodes[0]!);
    if (f.amount !== '20000000') fail('CLOAK_DEMO_REQUIRES_002_SOL');
    const state = await syntheticState('cloak-' + crypto.randomUUID().replaceAll('-', ''));
    const nonce = new DataView(crypto.getRandomValues(new Uint8Array(8)).buffer).getBigUint64(0).toString();
    const route: CloakLocalRoute = { environment: 'LOCAL', provider: 'cloak', routeId: 'local-route-1', owner, recipientAta: owner,
      genesisHash: state.genesisHash, programId: state.programId, inputMint: CLOAK_RUNTIME.nativeMint, outputMint: CLOAK_RUNTIME.usdcMint,
      amountIn: f.amount, inputTotal: '30000000', changeCommitment: state.outputNotes[0]!.commitment,
      inputCommitments: state.inputNotes.map(n => n.commitment), priceNumerator: '150', priceDenominator: '1000',
      feeLamports: '100000', maximumFeeLamports: '200000', observedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + 60_000).toISOString(), nonce };
    const review = compileCloakLocalReview(snapshot, route, nowMs);
    state.manifestHash = review.plan.manifestHash;
    const vault = new PrivateStateVault(backend, demoPassphrase), reference = await vault.save(state);
    await prepareCloakLocalExecution(vault, reference, review, nowMs);
    return new PrivacyDemoRun(backend, review, reference, await cloakLocalReviewDigest(review));
  }
  /** Every control stays bound to the same workflow, review and original expiry. */
  async act(action: 'review' | 'manifest' | 'authorize' | 'execute' | 'recover', workflow: SemanticWorkflow,
    acknowledgment: string | null, nowMs = Date.now()): Promise<PrivacyDemoSnapshot> {
    if (this.busy) fail('CLOAK_DEMO_OPERATION_PENDING');
    if (JSON.stringify(workflow) !== JSON.stringify(this.review.workflow)) fail('CLOAK_LOCAL_REVIEW_INVALIDATED');
    this.busy = true;
    try {
      if (action === 'recover') {
        this.authorization = null; this.vault = new PrivateStateVault(this.backend, demoPassphrase); this.restarts++;
        this.outcome = await recoverCloakLocal(this.vault, this.reference, this.ledger);
        this.phase = this.outcome.state === 'RECONCILED' ? 'RECOVERED' : 'RECOVERY_REQUIRED';
      } else {
        verifyCloakLocalReview(this.review, nowMs);
        if (action === 'review' && this.phase === 'SIMULATED') this.phase = 'REVIEWED';
        else if (action === 'manifest' && this.phase === 'REVIEWED') this.phase = 'MANIFEST';
        else if (action === 'authorize' && this.phase === 'MANIFEST') {
          this.authorization = await authorizeCloakLocal(this.review, this.session, acknowledgment ?? '', nowMs); this.phase = 'AUTHORIZED';
        } else if (action === 'execute') {
          if (this.attempted) fail('CLOAK_LOCAL_REPLAY');
          if (this.phase !== 'AUTHORIZED' || !this.authorization) fail('CLOAK_LOCAL_AUTHORIZATION_MISMATCH');
          this.attempted = true; this.phase = 'RECOVERY_REQUIRED';
          this.outcome = await executeCloakLocal(this.vault, this.reference, this.review, this.authorization!, this.session, this.ledger, nowMs);
          this.phase = this.outcome.state === 'RECONCILED' ? 'EXECUTED' : 'RECOVERY_REQUIRED';
        } else fail('CLOAK_DEMO_REVIEW_SEQUENCE_REQUIRED');
      }
      return await this.snapshot();
    } finally { this.busy = false; }
  }
  async snapshot() {
    // Authenticate persisted data before showing any checkpoint/evidence status. Never serialize private state.
    await this.vault.load(this.reference);
    const stages = ['prepared', 'intent', 'handoff', 'submitted', 'reconciled'] as const;
    const checkpoints = Object.fromEntries(await Promise.all(stages.map(async stage =>
      [stage, await this.vault.loadExecution(this.reference, 'execution.' + stage) !== null]))) as Record<typeof stages[number], boolean>;
    const evidence = await this.vault.loadExecution(this.reference, 'execution.reconciled');
    return { label: PRIVACY_DEMO_LABEL, runId: this.reference.runId, phase: this.phase, review: structuredClone(this.review),
      reviewDigest: this.reviewDigest, reference: { ...this.reference }, checkpoints, submissions: this.ledger.submissions,
      signatureRequests: this.signatureRequests, restarts: this.restarts, outcome: this.outcome && structuredClone(this.outcome), evidence };
  }
}
