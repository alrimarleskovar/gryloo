# Mode A EVM unsigned payload profile v1

Status: accepted for BUILD-003D under DEC-0023 and DEC-0024. This profile applies only to chain 31337 on the controlled Base fork. It never permits a Base mainnet-signable transaction.

## Exact bytes

For each transaction, the reviewed payload bytes are the EIP-1559 unsigned signing preimage:

`0x02 || RLP([chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, to, value, data, accessList])`.

The nine RLP items are encoded minimally. Integer zero uses the empty byte string, nonzero integers have no leading zero, address `to` is exactly 20 bytes, and the access list is the empty list. The decoder rejects non-canonical RLP, trailing bytes, unrecognized transaction type, nonzero value, nonempty access list and a chain ID other than 31337. Nonces are n and n + 1. The priority fee is 1,000,000 wei; the maximum fee is twice the next base fee plus that priority. Gas limits are the stable simulated gas usage rounded up by 5/4.

`payloadHash` is the frozen `hashRawBytes('payload', exactUnsignedBytes)` SHA-256 framing. The wallet signing hash is Keccak-256 of those same bytes. Both are recomputed in the compiler and browser. The EIP-1193 transaction object is re-derived from the decoded bytes; no separately assembled display object is authority.

## Calldata

Step 1 calls tokenIn `approve(address,uint256)` (`0x095ea7b3`) with spender exactly Base SwapRouter02 `0x2626664c2603336e57b271c5c0b26f421741e481` and amount exactly `amountIn`. This finite allowance is the only approval in the reviewed path.

Step 2 calls SwapRouter02 `multicall(uint256,bytes[])` (`0x5ae401dc`), with one and only one inner `exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))` (`0x04e45aaf`). Its arguments bind tokenIn, tokenOut, the user-selected quoted fee tier, recipient equal to the owner, exact input amount, minimum output and zero `sqrtPriceLimitX96`. The outer deadline is fork-chain time. ABI offsets, word padding, lengths and array count must be canonical. The decoder rejects unknown targets, spenders or selectors, extra calls, sentinel or non-owner recipients, a different input amount, excessive approval and any nonzero value.

The synthetic compatibility vector `tests/compatibility/v1/mode-a-payload-vectors.json` pins unsigned bytes, data, payload hashes and signing hashes. It is test data, not a fork recording or market quote. The compiler and browser must decode and recompute it independently in G3.
