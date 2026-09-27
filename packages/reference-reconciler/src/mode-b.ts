// SPDX-License-Identifier: AGPL-3.0-only
/** Independent finite-permission reconciliation from fork reads. */
export type ModeBChainEvidence = {
  readonly chainId: number; readonly safe: string; readonly roles: string; readonly rolesOwner: string; readonly executor: string; readonly transactionSigner: string;
  readonly target: string; readonly transactionTo: string; readonly transactionInput: string;
  readonly expectedInput: string; readonly safeCodeHash: string; readonly expectedSafeCodeHash: string;
  readonly rolesCodeHash: string; readonly expectedRolesCodeHash: string;
  readonly owner: string; readonly expectedOwner: string; readonly threshold: number;
  readonly moduleEnabled: boolean; readonly roleAssigned: boolean; readonly allowanceRemaining: bigint;
  readonly transactionReceipt: null | { readonly status: 0 | 1; readonly blockHash: string };
  readonly inputDebited: bigint; readonly outputCredited: bigint; readonly amountIn: bigint;
  readonly minimumOut: bigint; readonly residualTokenAllowance: bigint;
};
export type ModeBOutcome = 'INCONCLUSIVE' | 'DIVERGENT' | 'REVERTED' | 'CONFIRMED_NOT_RECONCILED' | 'RECONCILED';
export type ModeBReconciliation = { readonly outcome: ModeBOutcome; readonly reason: string; readonly remainingBudget: string; readonly residualTokenAllowance: string };
export function reconcileModeB(e: ModeBChainEvidence): ModeBReconciliation {
  const result = (outcome: ModeBOutcome, reason: string): ModeBReconciliation => ({ outcome, reason,
    remainingBudget: e.allowanceRemaining.toString(), residualTokenAllowance: e.residualTokenAllowance.toString() });
  if (e.chainId !== 31337 || e.safeCodeHash !== e.expectedSafeCodeHash || e.rolesCodeHash !== e.expectedRolesCodeHash ||
    e.owner.toLowerCase() !== e.expectedOwner.toLowerCase() || e.rolesOwner.toLowerCase() !== e.safe.toLowerCase() ||
    e.transactionSigner.toLowerCase() !== e.executor.toLowerCase() || e.threshold !== 1 ||
    e.transactionTo.toLowerCase() !== e.roles.toLowerCase() || e.transactionInput.toLowerCase() !== e.expectedInput.toLowerCase() ||
    e.target.toLowerCase() !== '0x2626664c2603336e57b271c5c0b26f421741e481') return result('DIVERGENT', 'Authority or transaction bytes differ from review');
  if (!e.transactionReceipt) return result('INCONCLUSIVE', 'No independent receipt yet');
  if (e.transactionReceipt.status === 0) return result('REVERTED', 'Executor transaction reverted');
  if (!e.moduleEnabled || !e.roleAssigned) return result('DIVERGENT', 'Permission changed before reconciliation');
  if (e.allowanceRemaining !== 0n || e.inputDebited !== e.amountIn || e.outputCredited < e.minimumOut) return result('DIVERGENT', 'Budget or token movement does not match the reviewed swap');
  return result('RECONCILED', 'Receipt, effective permission, budget and token movement agree');
}
