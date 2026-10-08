// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-AUTOMATION-001: short, content-free descriptions of a bound action, for history rows and notifications (no address, no id). */
import type { StrategySpec } from '../engine/strategy-spec';
import { NETWORKS } from '../engine/strategy-engine';

export function routeStrategyLabel(strategy: StrategySpec | null): string | null {
  if (!strategy || strategy.action !== 'swap') return null;
  return `${strategy.amount} ${strategy.inputAsset} → ${strategy.outputAsset} on ${NETWORKS[strategy.network].label}`;
}
