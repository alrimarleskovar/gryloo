// SPDX-License-Identifier: AGPL-3.0-only
export const product = Object.freeze({
  name: 'Gryloo',
  strategyName: 'Untitled workflow',
  build: 'Gryloo',
  environment: 'MOCKED',
  authorization: 'NONE',
  enforcement: 'NOT_ENFORCED',
  outcome: 'NOT_APPLICABLE',
  chain: 'Base authoring · mock examples',
  wallet: 'Unavailable',
  forkChain: 'Base authoring · local fork 31337',
  forkWallet: 'injected · not connected',
} as const);
