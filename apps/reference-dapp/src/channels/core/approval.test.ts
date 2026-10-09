// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import type { HandoffRecord, WalletRef } from '../../platform/index.ts';
import { intendedWalletPolicy } from './approval.ts';

it('compares Solana public keys exactly and EVM addresses without case differences', () => {
  const intended: WalletRef = { namespace: 'solana', address: 'So11111111111111111111111111111111111111112' };
  const h = { requesterContext: { intendedWallet: intended } } as unknown as HandoffRecord;
  expect(intendedWalletPolicy(h, intended)).toEqual({ ok: true });
  expect(intendedWalletPolicy(h, { ...intended, address: intended.address.toLowerCase() })).toEqual({ ok: false, code: 'CHANNEL_INTENDED_WALLET_MISMATCH' });
  expect(intendedWalletPolicy(h, { namespace: 'eip155', address: intended.address })).toEqual({ ok: false, code: 'CHANNEL_INTENDED_WALLET_MISMATCH' });
  const evm: WalletRef = { namespace: 'eip155', address: '0x' + 'ab'.repeat(20) };
  expect(intendedWalletPolicy({ requesterContext: { intendedWallet: evm } } as unknown as HandoffRecord, { ...evm, address: evm.address.toUpperCase() })).toEqual({ ok: true });
});
