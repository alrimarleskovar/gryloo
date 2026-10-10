// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: a MOCKED loopback Solana Devnet for delegated-execution tests. Never a public cluster.
 *
 * It verifies every required ed25519 signature of a wire transaction and applies, atomically, exactly these instructions: Memo, SPL Token
 * `ApproveChecked` / `Revoke` (by the token account's owner) and `TransferChecked` (by the owner or by its delegate within the delegated
 * amount, which decreases), and a FIXTURE swap program (`MOCKED_SWAP_PROGRAM`) that pays native SOL to a recipient at a fixed price when the
 * same transaction moved the input into its vault. The fixture program is not Orca: evidence from it is MOCKED and says so.
 */
import { base58Encode, decompileMessageV0, parseMessageV0, parseTransaction, readU64, splDelegation, verifyEd25519 } from '@defi-workflow-engine/reference-compiler';
import { MOCKED_BLOCKHASH, MOCKED_SOLANA_LAMPORTS_PER_UNIT, MOCKED_SWAP_PROGRAM, MOCKED_SWAP_VAULT } from './constants.ts';

const S = splDelegation;
export { MOCKED_SWAP_PROGRAM, MOCKED_SWAP_VAULT };
export const DEVNET_GENESIS = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const BLOCKHASH = MOCKED_BLOCKHASH;
export class SolanaDoubleError extends Error {}
const fail = (code: string): never => { throw new SolanaDoubleError(code); };

export type SolanaDouble = ReturnType<typeof createSolanaDouble>;
export function createSolanaDouble() {
  const accounts = new Map<string, splDelegation.TokenAccountState>(), lamports = new Map<string, bigint>(), mints = new Map<string, number>();
  const signatures = new Map<string, { slot: number; err: string | null }>();
  let slot = 1000, lamportsPerUnit = MOCKED_SOLANA_LAMPORTS_PER_UNIT, sends = 0; // 1 devUSDC (6 decimals) → 0.002 SOL
  const cloneAll = () => ({ accounts: new Map(accounts), lamports: new Map(lamports) });
  function apply(ix: ReturnType<typeof decompileMessageV0>[number], signers: ReadonlySet<string>, ctx: { vaultCredit: Map<string, bigint> }): void {
    const signed = (k: string) => signers.has(k);
    if (ix.programId === S.MEMO_PROGRAM) { if (!ix.accounts.every(a => !a.isSigner || signed(a.pubkey))) fail('MEMO_SIGNER'); return; }
    if (ix.programId === S.TOKEN_PROGRAM) {
      const tag = ix.data[0];
      if (tag === 13) { // ApproveChecked [source, mint, delegate, owner]
        const [source, mint, delegate, owner] = ix.accounts.map(a => a.pubkey) as [string, string, string, string];
        const acc = accounts.get(source) ?? fail('ACCOUNT_NOT_FOUND');
        if (acc.owner !== owner || !signed(owner) || acc.mint !== mint || ix.data[9] !== mints.get(mint)) fail('OWNER_MISMATCH');
        accounts.set(source, { ...acc, delegate, delegatedAmount: readU64(ix.data, 1) });
        return;
      }
      if (tag === 5) { // Revoke [source, owner]
        const [source, owner] = ix.accounts.map(a => a.pubkey) as [string, string];
        const acc = accounts.get(source) ?? fail('ACCOUNT_NOT_FOUND');
        if (acc.owner !== owner || !signed(owner)) fail('OWNER_MISMATCH');
        accounts.set(source, { ...acc, delegate: null, delegatedAmount: 0n });
        return;
      }
      if (tag === 12) { // TransferChecked [source, mint, destination, authority]
        const [source, mint, destination, authority] = ix.accounts.map(a => a.pubkey) as [string, string, string, string];
        const amount = readU64(ix.data, 1), acc = accounts.get(source) ?? fail('ACCOUNT_NOT_FOUND');
        if (!signed(authority) || acc.mint !== mint || ix.data[9] !== mints.get(mint)) fail('INVALID_TRANSFER');
        if (authority === acc.owner) { /* owner spend */ }
        else if (authority === acc.delegate) { if (acc.delegatedAmount < amount) fail('InsufficientFunds'); }
        else fail('OwnerMismatch');
        if (acc.amount < amount) fail('InsufficientFunds');
        accounts.set(source, { ...acc, amount: acc.amount - amount, delegatedAmount: authority === acc.delegate ? acc.delegatedAmount - amount : acc.delegatedAmount,
          delegate: authority === acc.delegate && acc.delegatedAmount - amount === 0n ? null : acc.delegate });
        if (destination === MOCKED_SWAP_VAULT) ctx.vaultCredit.set(mint, (ctx.vaultCredit.get(mint) ?? 0n) + amount);
        else { const dest = accounts.get(destination) ?? fail('ACCOUNT_NOT_FOUND'); if (dest.mint !== mint) fail('MINT_MISMATCH'); accounts.set(destination, { ...dest, amount: dest.amount + amount }); }
        return;
      }
      return fail('TOKEN_INSTRUCTION_NOT_MODELED');
    }
    if (ix.programId === MOCKED_SWAP_PROGRAM) { // [tag 1, amountIn u64, minOut u64]; accounts [mint (input), recipient (w)]
      if (ix.data[0] !== 1 || ix.data.length !== 17) fail('SWAP_INSTRUCTION_INVALID');
      const [mint, recipient] = ix.accounts.map(a => a.pubkey) as [string, string];
      const amountIn = readU64(ix.data, 1), minOut = readU64(ix.data, 9);
      if ((ctx.vaultCredit.get(mint) ?? 0n) !== amountIn) fail('SWAP_INPUT_NOT_RECEIVED');
      const out = amountIn * lamportsPerUnit / 1_000_000n;
      if (out < minOut) fail('SLIPPAGE_EXCEEDED');
      lamports.set(recipient, (lamports.get(recipient) ?? 0n) + out);
      return;
    }
    fail('PROGRAM_NOT_MODELED');
  }
  function process(wire: Uint8Array): string {
    const { signatures: sigs, message } = parseTransaction(wire);
    const parsed = parseMessageV0(message), signerCount = parsed.header[0];
    if (sigs.length !== signerCount || parsed.blockhash !== BLOCKHASH) fail('TRANSACTION_INVALID');
    const signers = new Set<string>();
    parsed.staticKeys.slice(0, signerCount).forEach((key, i) => { if (!verifyEd25519(sigs[i]!, message, key)) fail('SIGNATURE_INVALID'); signers.add(key); });
    const id = base58Encode(sigs[0]!);
    if (signatures.has(id)) return id; // re-broadcast of the same transaction
    sends += 1; slot += 1;
    const snapshot = cloneAll(), ctx = { vaultCredit: new Map<string, bigint>() };
    try { for (const ix of decompileMessageV0(parsed, {})) apply(ix, signers, ctx); signatures.set(id, { slot, err: null }); }
    catch (cause) {
      accounts.clear(); snapshot.accounts.forEach((v, k) => accounts.set(k, v)); lamports.clear(); snapshot.lamports.forEach((v, k) => lamports.set(k, v));
      signatures.set(id, { slot, err: cause instanceof Error ? cause.message : 'FAILED' });
    }
    return id;
  }
  const rpc = async (method: string, params: readonly unknown[]): Promise<unknown> => {
    const p = params as unknown[];
    switch (method) {
      case 'getLatestBlockhash': return { context: { slot }, value: { blockhash: BLOCKHASH, lastValidBlockHeight: slot + 150 } };
      case 'getGenesisHash': return 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
      case 'getBalance': return { context: { slot }, value: Number(lamports.get(String(p[0])) ?? 0n) };
      case 'getAccountInfo': {
        const acc = accounts.get(String(p[0]));
        return { context: { slot }, value: acc ? { owner: S.TOKEN_PROGRAM, lamports: 2_039_280, executable: false,
          data: [Buffer.from(S.encodeTokenAccountState(acc)).toString('base64'), 'base64'] } : null };
      }
      case 'sendTransaction': return process(Uint8Array.from(Buffer.from(String(p[0]), 'base64')));
      case 'getSignatureStatuses': return { context: { slot }, value: (p[0] as string[]).map(sig => {
        const s = signatures.get(sig);
        return s ? { slot: s.slot, confirmations: null, err: s.err ? { InstructionError: s.err } : null, confirmationStatus: 'finalized' } : null;
      }) };
      default: return fail('METHOD_NOT_MODELED');
    }
  };
  const control = {
    mint(mint: string, decimals: number) { mints.set(mint, decimals); },
    tokenAccount(address: string, owner: string, mint: string, amount: bigint) {
      accounts.set(address, { mint, owner, amount, delegate: null, state: 'INITIALIZED', native: false, delegatedAmount: 0n, closeAuthority: null });
    },
    fundLamports(account: string, value: bigint) { lamports.set(account, value); },
    account: (address: string) => accounts.get(address) ?? null,
    lamports: (account: string) => lamports.get(account) ?? 0n,
    setPrice(lamportsPerWholeUnit: bigint) { lamportsPerUnit = lamportsPerWholeUnit; },
    /** An owner-initiated revoke outside FloFi (external revocation). */
    revokeExternally(address: string) { const acc = accounts.get(address); if (acc) accounts.set(address, { ...acc, delegate: null, delegatedAmount: 0n }); },
    sends: () => sends,
    blockhash: BLOCKHASH,
  };
  return { rpc, control };
}
