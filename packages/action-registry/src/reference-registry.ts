// SPDX-License-Identifier: Apache-2.0
/** A declaration for authoring. No adapter, wallet or enforcement is present. */
export const referenceRegistry = Object.freeze({
  schemaVersion: '1.0.0', registryId: 'reference.registry', registryVersion: '1.1.0',
  capabilities: Object.freeze([Object.freeze({
    id: 'swap.direct-transaction', version: '1.0.0', status: 'DECLARED_ONLY',
    enforcement: 'NOT_ENFORCED', executionKinds: Object.freeze(['DIRECT_TRANSACTION', 'SIGNED_INTENT'] as const),
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
  })]),
});
