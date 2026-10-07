// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { classifyWalletEnvironment, solanaWalletChainRef, walletEnvironmentLabel, walletExecutionEnvironment } from './environment';

describe('connected wallet environment classifier', () => {
  it('resolves only supported Solana wallet aliases to exact, distinct chain identities', () => {
    const mainnet = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
    const devnet = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
    for (const chain of ['solana:mainnet', mainnet]) expect(solanaWalletChainRef(chain)).toBe(mainnet);
    for (const chain of ['solana:devnet', devnet]) expect(solanaWalletChainRef(chain)).toBe(devnet);
    expect(solanaWalletChainRef('solana:mainnet')).not.toBe(solanaWalletChainRef('solana:devnet'));
    for (const chain of [null, undefined, '', 'solana:testnet', 'solana:unknown', 'eip155:8453', '0x14a34']) expect(solanaWalletChainRef(chain)).toBeNull();
  });
  it.each([
    ['0x14a34', 'testnet'], ['0x66eee', 'testnet'], ['eip155:421614', 'testnet'],
    ['0x2105', 'mainnet'], ['0xA4B1', 'mainnet'], ['eip155:8453', 'mainnet'],
    ['solana:devnet', 'testnet'], ['solana:mainnet', 'mainnet'],
    ['solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', 'testnet'],
    ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'mainnet'],
    ['0xb626', 'testnet'], ['0x1237', 'mainnet'],
  ] as const)('classifies the observed chain %s as %s', (chain, environment) => {
    expect(classifyWalletEnvironment(chain)).toBe(environment);
  });
  it.each([null, undefined, '', '0x89', '0x7a69', 'eip155:9999', 'solana:testnet', 'Base', 'invalid'])('keeps unknown/disconnected chain %s neutral', chain => {
    expect(classifyWalletEnvironment(chain)).toBe('unknown');
    expect(walletEnvironmentLabel(classifyWalletEnvironment(chain))).toBe('Network');
    expect(walletExecutionEnvironment(classifyWalletEnvironment(chain))).toBeNull();
  });
  it('maps the same classification into product labels and public execution environments', () => {
    expect(walletEnvironmentLabel('testnet')).toBe('Testnet');
    expect(walletEnvironmentLabel('mainnet')).toBe('Mainnet');
    expect(walletExecutionEnvironment('testnet')).toBe('PUBLIC_TESTNET');
    expect(walletExecutionEnvironment('mainnet')).toBe('MAINNET');
  });
});
