// SPDX-License-Identifier: AGPL-3.0-only
import { readLendingComposition, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { AAVE_V3_BASE_SEPOLIA as p, LENDING_BASE_SEPOLIA as u } from '@defi-workflow-engine/action-registry';
export function validateLendingComposition(workflow: SemanticWorkflow) {
  const f = readLendingComposition(workflow);
  if (f.chain !== p.chain || f.collateral.address !== p.asset || f.borrowed.address !== p.asset ||
      f.collateral.decimals !== 6 || f.borrowed.decimals !== 6 || f.output.address !== u.weth || f.output.decimals !== 18)
    throw new Error('LENDING_ASSET_IDENTITY_UNSUPPORTED');
  return f;
}
