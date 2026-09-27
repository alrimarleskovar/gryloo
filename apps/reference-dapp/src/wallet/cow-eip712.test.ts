// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { connectLocalCowWallet, localCowProvider, signLocalCowTypedData } from './cow-eip712';

const owner = '0x1234567890123456789012345678901234567890';
const typed = { types: { EIP712Domain: [] }, primaryType: 'Order' as const,
  domain: { name: 'Gnosis Protocol' as const, version: 'v2' as const, chainId: 8453 as const,
    verifyingContract: '0x9008d19f58aabd9ed0d60971565aa8510560ab41' }, message: {} as never };
const provider = (chain = '0x2105', account = owner, local = true) => ({ isGrylooCowLocalWallet: local,
  request: async ({ method }: { method: string }) => method === 'eth_chainId' ? chain : method === 'eth_signTypedData_v4'
    ? '0x' + '1'.repeat(130) : [account] });

describe('disposable injected CoW wallet guard', () => {
  it('rejects an ordinary public wallet and wrong chain before requesting accounts', async () => {
    expect(localCowProvider()).toBeNull();
    await expect(connectLocalCowWallet(provider('0x2105', owner, false))).rejects.toThrow('COW_PUBLIC_WALLET_REFUSED');
    await expect(connectLocalCowWallet(provider('0x7a69'))).rejects.toThrow('COW_WALLET_CHAIN_MISMATCH');
  });
  it('checks current chain and owner at signing time', async () => {
    await expect(connectLocalCowWallet(provider())).resolves.toBe(owner);
    await expect(signLocalCowTypedData(provider('0x7a69'), owner, typed)).rejects.toThrow('COW_WALLET_CHAIN_MISMATCH');
    await expect(signLocalCowTypedData(provider('0x2105', '0x' + '9'.repeat(40)), owner, typed))
      .rejects.toThrow('COW_WALLET_ACCOUNT_MISMATCH');
  });
});
