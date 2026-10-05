// SPDX-License-Identifier: AGPL-3.0-only
import { createSupplyNode, readSupplyNode, createBorrowNode, readBorrowNode, createRepayNode, readRepayNode, createWithdrawNode, readWithdrawNode, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { AAVE_V3_BASE_SEPOLIA, AAVE_V3_LENDING_PROFILES, type AaveLendingProfile } from '@defi-workflow-engine/action-registry';
/**
 * Aave V3 authoring for each registered lending profile: Base Sepolia USDC and (BUILD-ETHEREUM-001) Ethereum Sepolia WBTC.
 * The named network selects the profile, and the asset must be that profile's one verified asset. A symbol never selects
 * an asset on its own, so "USDC on Ethereum Sepolia" is refused rather than mapped to another network's USDC.
 */
export type LendingNetwork = AaveLendingProfile['network'];
export type LendingAsset = AaveLendingProfile['symbol'];
export type SupplyInput={network:LendingNetwork;asset:LendingAsset;amount:string;beneficiary:string};
export const LENDING_NETWORKS: readonly LendingNetwork[] = Object.freeze(AAVE_V3_LENDING_PROFILES.map(profile => profile.network));
/** The profile for an authored network and asset pair; any other pair is unsupported. */
export function lendingProfileFor(network: string, asset: string, code = 'SUPPLY_DEPLOYMENT_UNSUPPORTED'): AaveLendingProfile {
  const profile = AAVE_V3_LENDING_PROFILES.find(item => item.network === network);
  if (!profile || profile.symbol !== asset) throw new Error(code);
  return profile;
}
/** The one verified Aave asset of a lending network. */
export function lendingAssetFor(network:LendingNetwork):LendingAsset{
  const profile=AAVE_V3_LENDING_PROFILES.find(item=>item.network===network);if(!profile)throw new Error('SUPPLY_DEPLOYMENT_UNSUPPORTED');return profile.symbol;
}
/** The profile of an authored node's chain, or null when no lending profile serves it. */
export function lendingProfileOfChain(chain: string): AaveLendingProfile | null { return AAVE_V3_LENDING_PROFILES.find(item => item.chain === chain) ?? null; }
/** Exact decimal amount in the asset's smallest unit; never more fractional digits than the asset has. */
export function parseLendingAmount(value:string,decimals:number):string {
  const pattern=new RegExp(`^(0|[1-9][0-9]*)(?:\\.[0-9]{1,${decimals}})?$`);
  if(typeof value!=='string'||!pattern.test(value)||value.length>80)throw new Error('SUPPLY_AMOUNT_INVALID');
  const [whole,fraction='']=value.split('.');const units=BigInt(whole!)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0')||'0');
  if(units<=0n||units>=1n<<256n)throw new Error('SUPPLY_AMOUNT_INVALID');return units.toString();
}
/** Six-decimal USDC amounts (Base Sepolia profile and the Base Sepolia lending composition). */
export function parseSupplyAmount(value:string):string { return parseLendingAmount(value,6); }
export function formatLendingAmount(units:string|bigint,decimals:number):string {
  const amount=BigInt(units),scale=10n**BigInt(decimals);
  return `${amount/scale}${amount%scale?'.'+(amount%scale).toString().padStart(decimals,'0').replace(/0+$/,''):''}`;
}
const assetOf=(profile:AaveLendingProfile)=>({chainId:profile.chain,address:profile.asset,decimals:profile.decimals});
function details(fields:{chain:string;amount:string}):{network:LendingNetwork;asset:LendingAsset;amount:string}|null{
  const profile=lendingProfileOfChain(fields.chain);
  return profile?{network:profile.network,asset:profile.symbol,amount:formatLendingAmount(fields.amount,profile.decimals)}:null;
}
export function createAuthoredSupply(nodeId:string,input:SupplyInput):SemanticWorkflow['nodes'][number]{
  const profile=lendingProfileFor(input.network,input.asset);
  return createSupplyNode(nodeId,{chain:profile.chain,asset:assetOf(profile),amount:parseLendingAmount(input.amount,profile.decimals),beneficiary:input.beneficiary});
}
export function supplyDetails(node:SemanticWorkflow['nodes'][number]):SupplyInput|null{
  if(node.actionType!=='supply')return null;
  const fields=readSupplyNode(node),shown=details(fields);
  return shown&&{...shown,beneficiary:fields.beneficiary};
}

// Some injected providers return a safe JS integer for this read instead of an RPC quantity.
// Preserve the raw response in diagnostics; normalize only lossless, nonnegative values.
export function supplyWalletNonce(value:unknown):bigint {
  if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)return BigInt(value);
  if(typeof value==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value))return BigInt(value);
  throw new Error('SUPPLY_WALLET_NONCE_RESPONSE_INVALID');
}
export function supplyWalletTransaction(prepared:Record<string,string>):Record<string,string> {
  const transaction={...prepared};delete transaction.nonce;
  for(const field of ['chainId','gas','gasPrice','maxFeePerGas','maxPriorityFeePerGas','value']){
    if(transaction[field]!==undefined&&!/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(transaction[field]))throw new Error('SUPPLY_WALLET_QUANTITY_INVALID');
  }
  return transaction;
}

export function createAuthoredBorrow(nodeId:string,input:SupplyInput):SemanticWorkflow['nodes'][number]{
  const profile=lendingProfileFor(input.network,input.asset,'BORROW_DEPLOYMENT_UNSUPPORTED');
  return createBorrowNode(nodeId,{chain:profile.chain,asset:assetOf(profile),amount:parseLendingAmount(input.amount,profile.decimals),beneficiary:input.beneficiary,interestRateMode:2});
}
export function borrowDetails(node:SemanticWorkflow['nodes'][number]):SupplyInput|null{
  if(node.actionType!=='borrow')return null;
  const fields=readBorrowNode(node),shown=details(fields);
  return shown&&{...shown,beneficiary:fields.beneficiary};
}

export function createAuthoredRepay(nodeId:string,input:SupplyInput):SemanticWorkflow['nodes'][number]{
  const profile=lendingProfileFor(input.network,input.asset,'REPAY_DEPLOYMENT_UNSUPPORTED');
  return createRepayNode(nodeId,{chain:profile.chain,asset:assetOf(profile),amount:parseLendingAmount(input.amount,profile.decimals),beneficiary:input.beneficiary,interestRateMode:2});
}
export function repayDetails(node:SemanticWorkflow['nodes'][number]):SupplyInput|null{
  if(node.actionType!=='repay')return null;
  const fields=readRepayNode(node),shown=details(fields);
  return shown&&{...shown,beneficiary:fields.beneficiary};
}

export type WithdrawInput={network:LendingNetwork;asset:LendingAsset;amount:string;recipient:'CONNECTED_OWNER'};
export function createAuthoredWithdraw(nodeId:string,input:WithdrawInput):SemanticWorkflow['nodes'][number]{
  if(input.recipient!=='CONNECTED_OWNER')throw new Error('WITHDRAW_DEPLOYMENT_UNSUPPORTED');
  const profile=lendingProfileFor(input.network,input.asset,'WITHDRAW_DEPLOYMENT_UNSUPPORTED');
  return createWithdrawNode(nodeId,{chain:profile.chain,asset:assetOf(profile),amount:parseLendingAmount(input.amount,profile.decimals),recipient:input.recipient});
}
export function withdrawDetails(node:SemanticWorkflow['nodes'][number]):WithdrawInput|null{
  if(node.actionType!=='withdraw')return null;
  const fields=readWithdrawNode(node),shown=details(fields);
  return shown&&{...shown,recipient:fields.recipient};
}
/** "0.1 USDC · Base Sepolia" for a lending node; null for any other node. Display text only. */
export function lendingAmountLabel(node:SemanticWorkflow['nodes'][number]):string|null{
  const value=withdrawDetails(node)??repayDetails(node)??borrowDetails(node)??supplyDetails(node);
  return value&&`${value.amount} ${value.asset} · ${value.network}`;
}
/** Display facts of the profile serving a chain (the reviewed or authored one). Before anything is authored the panels describe Base Sepolia, as before. */
export type LendingView={network:LendingNetwork;asset:LendingAsset;decimals:number;explorer:string;chainHex:AaveLendingProfile['chainHex'];collateralBit:bigint};
const viewOf=(profile:AaveLendingProfile):LendingView=>({network:profile.network,asset:profile.symbol,decimals:profile.decimals,explorer:profile.explorer,chainHex:profile.chainHex,
  collateralBit:2n<<(2n*BigInt(profile.reserveId))});
export function lendingView(chain:string|null|undefined):LendingView{return viewOf((chain?lendingProfileOfChain(chain):null)??AAVE_V3_BASE_SEPOLIA);}
/** Display facts of a lending network chosen in an authoring form. */
export function lendingNetworkView(network:LendingNetwork):LendingView{return viewOf(lendingProfileFor(network,lendingAssetFor(network)));}
/** Panel copy is written for Base Sepolia USDC; the shown profile's network and asset are substituted. Display text only. */
export function lendingCopy(text:string,view:LendingView):string{return text.replaceAll('Base Sepolia',view.network).replaceAll('USDC',view.asset);}
