// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: the `erc7710` codec against a REAL MetaMask Delegation Framework redemption recorded on Base Sepolia (public chain
 * data in `server/testdata`): it decodes, its EIP-712 digest recovers the real owner, and it re-encodes byte for byte — the codec matches the
 * deployed framework, not just itself.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { erc7710 } from '@defi-workflow-engine/reference-compiler';

const D = erc7710;
const vector = JSON.parse(readFileSync(new URL('../server/testdata/metamask-delegated-depth1-approval.base-sepolia.json', import.meta.url), 'utf8')) as
  { owner: string; transaction: { input: string; from: string }; reviewedCall: { target: string; data: string } };

describe('ERC-7710 codec against a real Base Sepolia MetaMask redemption', () => {
  it('decodes the permission context, recovers the real owner from the EIP-712 digest and re-encodes byte for byte', () => {
    const r = D.decodeRedeemCalldata(vector.transaction.input);
    const [delegation] = D.decodePermissionContext(r.contexts[0]!);
    expect(delegation!.delegator).toBe(vector.owner);
    expect(delegation!.authority).toBe(D.ROOT_AUTHORITY);
    expect(D.recoverDigestSigner(D.delegationDigest(84532, delegation!), delegation!.signature)).toBe(vector.owner);
    // MetaMask's own one-shot delegation uses the same deployment's LimitedCalls enforcer FloFi's address book names.
    expect(delegation!.caveats.map(c => c.enforcer)).toContain(D.DELEGATION_FRAMEWORK_V1_3.enforcers.limitedCalls);
    expect(D.decodeSingleExecution(r.executions[0]!)).toEqual({ target: vector.reviewedCall.target, value: 0n, data: vector.reviewedCall.data });
    expect(D.REDEEM_DELEGATIONS_SELECTOR + Buffer.from(D.abiEncode([{ array: 'bytes' }, { array: 'bytes32' }, { array: 'bytes' }], [r.contexts, r.modes, r.executions])).toString('hex'))
      .toBe(vector.transaction.input);
  });
});
