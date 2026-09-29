// SPDX-License-Identifier: AGPL-3.0-only
/** Pinned Base Sepolia Uniswap v3 profile; verified again against public chain state before use. */
export const BASE_SEPOLIA = Object.freeze({
  chainId: 84532, chainHex: '0x14a34', chainRef: 'eip155:84532',
  rpcUrl: 'https://sepolia.base.org', explorer: 'https://sepolia.basescan.org/tx/',
  factory: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
  router: '0x94cc0aac535ccdb3c01d6787d6413c739ae12bc4',
  quoter: '0xc5290058841028f1614f3a6f0f5816cad0df5e27',
  usdc: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
  weth: '0x4200000000000000000000000000000000000006',
  pool: '0x94bfc0574ff48e92ce43d495376c477b1d0eeec0', fee: 500,
});
