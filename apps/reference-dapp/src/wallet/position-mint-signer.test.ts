// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { base58Decode, createMockedSolanaWallet, fromBase64, parseTransaction, serializeSignedTransaction, toBase64, verifyEd25519 } from '@defi-workflow-engine/reference-compiler';
import { createPositionMintSigner, signOrcaLiquidityTransaction } from './position-mint-signer';
import type { SolanaSession, StandardWallet } from './solana-wallet';

const message = Uint8Array.from([0x80, 2, 0, 0, ...new Array<number>(40).fill(7)]);
function session(sign: (unsigned: string) => string): SolanaSession {
  const account = { address: 'owner', chains: ['solana:devnet'], features: ['solana:signTransaction'] };
  const wallet: StandardWallet = { name: 'Mock', chains: ['solana:devnet'], accounts: [account], features: { 'standard:connect': {}, 'solana:signTransaction': {
    signTransaction: async ({ transaction }: { transaction: Uint8Array }) => [{ signedTransaction: fromBase64(sign(toBase64(transaction)), 4096) }] } } };
  return { wallet, account, chain: 'solana:devnet' };
}
describe('client-side position-mint key (non-extractable WebCrypto Ed25519)', () => {
  it('cannot be exported, signs exactly once, and its public key is the mint address', async () => {
    const key = await createPositionMintSigner();
    expect(base58Decode(key.address)).toHaveLength(32);
    const signature = await key.sign(message);
    expect(verifyEd25519(signature, message, key.address)).toBe(true);
    await expect(key.sign(message)).rejects.toThrow('ORCA_LIQUIDITY_POSITION_KEY_ALREADY_USED');
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']) as CryptoKeyPair;
    await expect(crypto.subtle.exportKey('pkcs8', pair.privateKey)).rejects.toThrow();
  });
  it('lets the wallet sign first and adds the mint signature only to the byte-identical reviewed message', async () => {
    const wallet = createMockedSolanaWallet(), key = await createPositionMintSigner();
    const unsigned = toBase64(serializeSignedTransaction([null, null], message));
    const signed = await signOrcaLiquidityTransaction(session(wallet.sign), unsigned, toBase64(message), [wallet.owner, key.address], key);
    const parsed = parseTransaction(fromBase64(signed, 4096));
    expect(verifyEd25519(parsed.signatures[0]!, message, wallet.owner)).toBe(true);
    expect(verifyEd25519(parsed.signatures[1]!, message, key.address)).toBe(true);
  });
  it('fails closed before the mint key signs if the wallet returns different bytes', async () => {
    const wallet = createMockedSolanaWallet(), key = await createPositionMintSigner();
    const unsigned = toBase64(serializeSignedTransaction([null, null], message));
    const changing = session(u => { const b = fromBase64(u, 4096); b[b.length - 1] = 9; return wallet.sign(toBase64(b)); });
    await expect(signOrcaLiquidityTransaction(changing, unsigned, toBase64(message), [wallet.owner, key.address], key)).rejects.toThrow('ORCA_LIQUIDITY_TRANSACTION_CHANGED');
    // The key was never used, so a mismatch never produced a position-mint signature.
    expect(verifyEd25519(await key.sign(message), message, key.address)).toBe(true);
    await expect(signOrcaLiquidityTransaction(session(wallet.sign), unsigned, toBase64(message), [wallet.owner, key.address], null)).rejects.toThrow('ORCA_LIQUIDITY_POSITION_KEY_UNAVAILABLE');
  });
});
