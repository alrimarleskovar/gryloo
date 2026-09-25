// SPDX-License-Identifier: AGPL-3.0-only
import { Buffer } from 'node:buffer';
/** Fixture funding on the local chain only; no provider credential or mainnet submission. */
import { encodeApprove, encodeSwap, SWAP_ROUTER_02 } from '../../../../packages/reference-compiler/dist/abi.js';
import { FORK_CONTRACTS } from '../../../../packages/reference-compiler/dist/fork-quote.js';
import { ANVIL_DEFAULT_ACCOUNTS, FORK_DEV_ACCOUNTS, FORK_OWNER_INDEX, FORK_SETUP_INDEX, FORK_EMPTY_LOCAL_BLOCKS, FORK_CHAIN_ID_HEX } from '../../../../packages/reference-compiler/dist/profile.js';
import { rpc } from './harness.mjs';

const word = value => BigInt(value).toString(16).padStart(64, '0');
const addressWord = value => value.slice(2).padStart(64, '0');
const transfer = (recipient, amount) => `0xa9059cbb${addressWord(recipient)}${word(amount)}`;
const quoterCall = (fee, amount) => `0xc6a5026a${addressWord(FORK_CONTRACTS.weth)}${addressWord(FORK_CONTRACTS.usdc)}${word(amount)}${word(fee)}${word(0)}`;
const hex = bytes => `0x${Buffer.from(bytes).toString('hex')}`;
const valueHex = value => `0x${BigInt(value).toString(16)}`;
const SETUP_SWAP_INPUT = 5n * 10n ** 18n;
const OWNER_WETH = 1n * 10n ** 18n;
const OWNER_USDC = 2500n * 10n ** 6n;
const TX_LIMIT = { gas: '0xf4240', maxPriorityFeePerGas: '0xf4240' };
async function send(from, to, data, value = 0n) {
  const head = await rpc('eth_getBlockByNumber', ['latest', false]);
  const maxFeePerGas = valueHex(BigInt(head.baseFeePerGas) * 2n + BigInt(TX_LIMIT.maxPriorityFeePerGas));
  const hash = await rpc('eth_sendTransaction', [{ from, to, data, value: valueHex(value), maxFeePerGas, ...TX_LIMIT }]);
  const receipt = await rpc('eth_getTransactionReceipt', [hash]);
  if (receipt?.status !== '0x1') throw new Error('SETUP_TRANSACTION_FAILED');
  return hash;
}
/**
 * Amendment 6 A6-4, before any local transaction: Anvil must expose exactly the ten pinned Gryloo test-only
 * accounts, none of them an Anvil default. Owner and setup are then the two lowest indices whose recorded Base
 * code at block N is empty (§3.2.3): an EIP-7702 designator or any other code disqualifies an account, and no code
 * is wiped, overridden or accepted. Anvil read every dev account at genesis, so this adds no upstream request.
 * A recording reports the indices for pinning; replay requires them to equal the pins.
 */
export async function selectForkAccounts(call, { requirePinnedIndices = true } = {}) {
  if (await call('eth_chainId') !== FORK_CHAIN_ID_HEX) throw new Error('MAINNET_CHAIN_REFUSED');
  const accounts = await call('eth_accounts');
  if (!Array.isArray(accounts) || accounts.length !== FORK_DEV_ACCOUNTS.length
    || accounts.some((account, index) => typeof account !== 'string' || account.toLowerCase() !== FORK_DEV_ACCOUNTS[index])) throw new Error('DEV_ACCOUNTS_DERIVATION_MISMATCH');
  if (accounts.some(account => ANVIL_DEFAULT_ACCOUNTS.includes(account.toLowerCase()))) throw new Error('DEV_ACCOUNTS_DERIVATION_MISMATCH');
  const clean = [];
  for (let index = 0; index < accounts.length && clean.length < 2; index++) {
    if (await call('eth_getCode', [accounts[index], 'latest']) === '0x') clean.push(index);
  }
  if (clean.length < 2) throw new Error('DEV_ACCOUNTS_NOT_CLEAN');
  const [ownerIndex, setupIndex] = clean;
  if (requirePinnedIndices && (ownerIndex !== FORK_OWNER_INDEX || setupIndex !== FORK_SETUP_INDEX)) {
    throw new Error(`DEV_ACCOUNT_PINS_DIFFER:${ownerIndex},${setupIndex}`);
  }
  return { ownerIndex, setupIndex, owner: accounts[ownerIndex].toLowerCase(), setup: accounts[setupIndex].toLowerCase() };
}

/** Complete local fixture: WETH9 deposit, funded owner, setup swap for USDC, 20 empty blocks. */
export async function prepareForkFixture(sourceBlockNumber, { requirePinnedIndices = true } = {}) {
  const { ownerIndex, setupIndex, owner, setup } = await selectForkAccounts(rpc, { requirePinnedIndices });
  await rpc('anvil_setBlockTimestampInterval', [2]);
  const setupTransactions = [];
  setupTransactions.push({ purpose: 'WETH_DEPOSIT', hash: await send(setup, FORK_CONTRACTS.weth, '0xd0e30db0', SETUP_SWAP_INPUT + OWNER_WETH) });
  setupTransactions.push({ purpose: 'WETH_OWNER_TRANSFER', hash: await send(setup, FORK_CONTRACTS.weth, transfer(owner, OWNER_WETH)) });
  const quotes = [];
  for (const fee of [100, 500, 3000, 10000]) {
    try {
      const result = await rpc('eth_call', [{ from: setup, to: FORK_CONTRACTS.quoter, data: quoterCall(fee, SETUP_SWAP_INPUT) }, 'latest']);
      if (/^0x[0-9a-f]{256,}$/.test(result)) quotes.push({ fee, output: BigInt(`0x${result.slice(2, 66)}`) });
    } catch { /* a missing or unusable tier is excluded */ }
  }
  quotes.sort((a, b) => a.output === b.output ? a.fee - b.fee : a.output > b.output ? -1 : 1);
  const selected = quotes[0];
  if (!selected || selected.output < OWNER_USDC) throw new Error('SETUP_USDC_QUOTE_INSUFFICIENT');
  setupTransactions.push({ purpose: 'WETH_SETUP_APPROVAL', hash: await send(setup, FORK_CONTRACTS.weth, hex(encodeApprove(SWAP_ROUTER_02, SETUP_SWAP_INPUT))) });
  const head = await rpc('eth_getBlockByNumber', ['latest', false]);
  const deadline = BigInt(head.timestamp) + 180n;
  const swap = encodeSwap({ tokenIn: FORK_CONTRACTS.weth, tokenOut: FORK_CONTRACTS.usdc, fee: selected.fee,
    recipient: setup, amountIn: SETUP_SWAP_INPUT, amountOutMinimum: selected.output * 99n / 100n,
    sqrtPriceLimitX96: 0n, deadline });
  setupTransactions.push({ purpose: 'USDC_SETUP_SWAP', hash: await send(setup, SWAP_ROUTER_02, hex(swap)) });
  setupTransactions.push({ purpose: 'USDC_OWNER_TRANSFER', hash: await send(setup, FORK_CONTRACTS.usdc, transfer(owner, OWNER_USDC)) });
  const ownerUsdc = await rpc('eth_call', [{ to: FORK_CONTRACTS.usdc, data: `0x70a08231${addressWord(owner)}` }, 'latest']);
  if (BigInt(ownerUsdc) < OWNER_USDC) throw new Error('OWNER_USDC_UNFUNDED');
  for (let i = 0; i < FORK_EMPTY_LOCAL_BLOCKS; i++) await rpc('evm_mine');
  return { sourceBlockNumber, ownerIndex, setupIndex,
    owner, setup, selectedSetupFee: selected.fee, setupTransactions, emptyLocalBlocks: FORK_EMPTY_LOCAL_BLOCKS };
}
