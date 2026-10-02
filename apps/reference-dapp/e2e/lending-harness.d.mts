// SPDX-License-Identifier: AGPL-3.0-only
import type {SupplyRpc} from '@defi-workflow-engine/reference-compiler';
export const OWNER:string;
export const POOL:string;
export function createLendingHarness():{
  state:{[key:string]:unknown;owner:string;block:number;nonce:number;balance:bigint;nativeBalance:bigint;allowance:bigint;scaled:bigint;scaledDebt:bigint;price:bigint;weth:bigint;routerAllowance:bigint;poolAvailable:boolean;swapAvailable:boolean;simulationAvailable:boolean;quoteBps:bigint;timestamp:number;revert:boolean};
  rpc:SupplyRpc;transactions:Record<string,unknown>[];receipts:Map<string,Record<string,unknown>>;
  history:Map<number,Record<string,unknown>>;
};
