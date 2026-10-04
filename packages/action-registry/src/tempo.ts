// SPDX-License-Identifier: Apache-2.0
/** Official Tempo references checked 2026-10-03. No mainnet execution profile. */
export const TEMPO_PAYMENT = Object.freeze({
  chain: 'eip155:42431', chainId: 42431, chainHex: '0xa5bf', network: 'Tempo Moderato Testnet',
  rpc: 'https://rpc.moderato.tempo.xyz', explorer: 'https://explore.testnet.tempo.xyz',
  officialSource: 'https://tempo.xyz/developers/docs/protocol/tip20/spec',
  token: '0x20c0000000000000000000000000000000000000', symbol: 'pathUSD', decimals: 6,
  feeManager: '0xfeec000000000000000000000000000000000000',
  policyRegistry: '0x403c000000000000000000000000000000000000',
  adapterId: 'tempo.tip20', maximumAmount: '10000000', maximumFee: '100000',
  maximumGas: '1000000', reviewTtlSeconds: 120,
});
