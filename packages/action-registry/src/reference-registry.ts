// SPDX-License-Identifier: Apache-2.0
/** A declaration for authoring. No adapter, wallet or enforcement is present. */
export const referenceRegistry = Object.freeze({
  schemaVersion: '1.0.0', registryId: 'reference.registry', registryVersion: '1.1.0',
  capabilities: Object.freeze([Object.freeze({
    id: 'swap.direct-transaction', version: '1.0.0', status: 'DECLARED_ONLY',
    enforcement: 'NOT_ENFORCED', executionKinds: Object.freeze(['DIRECT_TRANSACTION', 'SIGNED_INTENT'] as const),
    authorizationModes: Object.freeze(['A'] as const),
  }), Object.freeze({
    id: 'liquidity.position-direct', version: '1.0.0', status: 'DECLARED_ONLY',
    enforcement: 'NOT_ENFORCED', executionKinds: Object.freeze(['DIRECT_TRANSACTION'] as const),
    authorizationModes: Object.freeze(['A'] as const),
  }), Object.freeze({
    id: 'bridge.direct-transaction', version: '1.0.0', status: 'DECLARED_ONLY',
    enforcement: 'NOT_ENFORCED', executionKinds: Object.freeze(['DIRECT_TRANSACTION'] as const),
    authorizationModes: Object.freeze(['A'] as const),
  })]),
  actions: Object.freeze([Object.freeze({
    id: 'asset.swap.exact-input', version: '1.0.0', nodeClass: 'ACTION',
    inputs: Object.freeze([
      Object.freeze({ name: 'amount-in', type: 'AMOUNT_UNITS', required: true }),
      Object.freeze({ name: 'asset-out', type: 'ASSET_REF', required: true }),
    ]),
    outputs: Object.freeze([Object.freeze({ name: 'amount-out', type: 'AMOUNT_UNITS', required: true })]),
    constraints: Object.freeze({ arbitraryTargetsAllowed: false, financialAmountEncoding: 'NATIVE_UNIT_DECIMAL_STRINGS', minInputAmountUnits: '1', allowedChainRefs: Object.freeze(['eip155:8453']) }),
    requiredCapability: Object.freeze({ id: 'swap.direct-transaction', version: '1.0.0' }),
    executionKinds: Object.freeze(['DIRECT_TRANSACTION', 'SIGNED_INTENT'] as const), authorizationModes: Object.freeze(['A'] as const),
  }), Object.freeze({
    id: 'asset.liquidity.uniswap-v3', version: '1.0.0', nodeClass: 'ACTION',
    inputs: Object.freeze([
      Object.freeze({ name: 'amount0-max', type: 'AMOUNT_UNITS', required: true }),
      Object.freeze({ name: 'amount1-max', type: 'AMOUNT_UNITS', required: true }),
      Object.freeze({ name: 'amount0-min', type: 'AMOUNT_UNITS', required: true }),
      Object.freeze({ name: 'amount1-min', type: 'AMOUNT_UNITS', required: true }),
      Object.freeze({ name: 'tick-lower', type: 'CONDITION', required: true }),
      Object.freeze({ name: 'tick-upper', type: 'CONDITION', required: true }),
      Object.freeze({ name: 'fee-tier', type: 'CONDITION', required: true }),
      Object.freeze({ name: 'recipient', type: 'ASSET_REF', required: true }),
    ]),
    outputs: Object.freeze([Object.freeze({ name: 'position-nft', type: 'ASSET_REF', required: true })]),
    constraints: Object.freeze({ arbitraryTargetsAllowed: false, financialAmountEncoding: 'NATIVE_UNIT_DECIMAL_STRINGS',
      minInputAmountUnits: '1', allowedChainRefs: Object.freeze(['eip155:8453']) }),
    requiredCapability: Object.freeze({ id: 'liquidity.position-direct', version: '1.0.0' }),
    executionKinds: Object.freeze(['DIRECT_TRANSACTION'] as const), authorizationModes: Object.freeze(['A'] as const),
  }), Object.freeze({
    id: 'asset.bridge', version: '1.0.0', nodeClass: 'ACTION',
    inputs: Object.freeze([Object.freeze({ name: 'amount-in', type: 'AMOUNT_UNITS', required: true }),
      Object.freeze({ name: 'asset-out', type: 'ASSET_REF', required: true })]),
    outputs: Object.freeze([Object.freeze({ name: 'amount-out', type: 'AMOUNT_UNITS', required: true })]),
    constraints: Object.freeze({ arbitraryTargetsAllowed: false, financialAmountEncoding: 'NATIVE_UNIT_DECIMAL_STRINGS',
      minInputAmountUnits: '1', allowedChainRefs: Object.freeze(['eip155:8453', 'eip155:10']) }),
    requiredCapability: Object.freeze({ id: 'bridge.direct-transaction', version: '1.0.0' }),
    executionKinds: Object.freeze(['DIRECT_TRANSACTION'] as const), authorizationModes: Object.freeze(['A'] as const),
  })]),
});
