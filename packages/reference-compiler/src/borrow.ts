// SPDX-License-Identifier: AGPL-3.0-only
import { assertAaveLendingProfile, type AaveLendingProfile } from '@defi-workflow-engine/action-registry';
import { readBorrowNode, supplyAddress, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { readSupplyState, supplyCall, supplyHex, rpcUint, rpcHex, rpcHash, rpcRecord, supplyHash, lendingProfile, reserveBits, type SupplyRpc, type SupplyState, type SupplyTransaction } from './supply.js';
export const BORROW_MINIMUM_HEALTH_FACTOR = 2n * 10n ** 18n;
const UINT_MAX = (1n << 256n) - 1n;
const units = (value: string) => {
  if (!/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) > UINT_MAX) throw new Error('BORROW_STATE_INVALID');
  return BigInt(value);
};
export type BorrowState = { collateralBase:string; debtBase:string; availableBorrowBase:string; liquidationThresholdBps:string;
  ltvBps:string; healthFactor:string; price:string; baseCurrencyUnit:string; reserveConfiguration:string; userConfiguration:string;
  liquidity:string; debt:string; scaledDebt:string; debtIndex:string; variableDebtToken:string; eMode:string; debtTotalSupply:string; codeHash:string };
export function borrowHealthFactor(collateral:string, threshold:string, debt:string):string {
  const c=units(collateral),lt=units(threshold),d=units(debt);
  if (lt>10000n) throw new Error('BORROW_STATE_INVALID');
  return d===0n ? UINT_MAX.toString() : (c*lt*10n**18n/(10000n*d)).toString();
}
export function estimateBorrow(amount:string,state:BorrowState,profile:AaveLendingProfile):{borrowValueBase:string;debtAfterBase:string;healthFactorAfter:string} {
  const {mask,collateral,scale}=reserveBits(profile),decimals=BigInt(assertAaveLendingProfile(profile).decimals);
  const a=units(amount),price=units(state.price),c=units(state.collateralBase),d=units(state.debtBase),lt=units(state.liquidationThresholdBps);
  if (!a || !price || !units(state.baseCurrencyUnit) || !c || !lt || units(state.ltvBps)>lt || lt>10000n || units(state.eMode)!==0n) throw new Error('BORROW_INSUFFICIENT_COLLATERAL');
  const cfg=units(state.reserveConfiguration);
  const health=units(state.healthFactor),calculated=BigInt(borrowHealthFactor(state.collateralBase,state.liquidationThresholdBps,state.debtBase));
  const difference=health>calculated?health-calculated:calculated-health;
  if((d===0n&&health!==UINT_MAX)||(d>0n&&difference>calculated/1000000n+1n)||units(state.userConfiguration)&~mask)throw new Error('BORROW_STATE_UNSUPPORTED');
  const capacity=(c*units(state.ltvBps)+5000n)/10000n-d;
  const actual=units(state.availableBorrowBase),expected=capacity>0n?capacity:0n;
  if((actual>expected?actual-expected:expected-actual)>2n)throw new Error('BORROW_STATE_INVALID');
  if (((cfg>>56n)&1n)!==1n || ((cfg>>57n)&1n) || ((cfg>>60n)&1n) || !((cfg>>58n)&1n)) throw new Error('BORROW_RESERVE_UNAVAILABLE');
  if (((cfg>>48n)&255n)!==decimals || (cfg>>212n)&((1n<<40n)-1n)) throw new Error('BORROW_RESERVE_UNSUPPORTED');
  if (!(units(state.userConfiguration)&collateral)) throw new Error('BORROW_COLLATERAL_NOT_ENABLED');
  if (units(state.liquidity)<a) throw new Error('BORROW_INSUFFICIENT_LIQUIDITY');
  const cap=(cfg>>80n)&((1n<<36n)-1n);
  if (cap && units(state.debtTotalSupply)+a>cap*scale) throw new Error('BORROW_CAP_EXCEEDED');
  // Base-currency value of the borrowed amount, rounded up (Aave rounds down), so the preview is conservative.
  const value=(a*price+scale-1n)/scale;
  if (value>units(state.availableBorrowBase)) throw new Error('BORROW_ABOVE_CAPACITY');
  const healthFactorAfter=borrowHealthFactor(c.toString(),lt.toString(),(d+value).toString());
  if (units(state.healthFactor)<BORROW_MINIMUM_HEALTH_FACTOR || BigInt(healthFactorAfter)<BORROW_MINIMUM_HEALTH_FACTOR) throw new Error('BORROW_UNSAFE_HEALTH_FACTOR');
  return {borrowValueBase:value.toString(),debtAfterBase:(d+value).toString(),healthFactorAfter};
}
/** Existing deployment and balance reader, augmented only with Borrow debt/risk reads. */
export async function readBorrowState(rpc:SupplyRpc,profileInput:AaveLendingProfile,account:string,beneficiary:string,tag='latest'):Promise<SupplyState> {
  const p=assertAaveLendingProfile(profileInput);
  if (supplyAddress(account)!==supplyAddress(beneficiary)) throw new Error('BORROW_BENEFICIARY_MUST_BE_OWNER');
  const state=await readSupplyState(rpc,p,account,beneficiary,tag),blockTag=supplyHex(state.block);
  const call=(to:string,sig:string,...args:(string|bigint)[])=>rpc('eth_call',[{to,data:supplyCall(sig,...args)},blockTag]);
  const [reserve,accountData,price,baseUnit,user,eMode,debt,scaled,index,liquidity,total,oracle,underlying,pool,code] = await Promise.all([
    call(p.pool,'getReserveData(address)',p.asset),call(p.pool,'getUserAccountData(address)',account),call(p.oracle,'getAssetPrice(address)',p.asset),
    call(p.oracle,'BASE_CURRENCY_UNIT()'),call(p.pool,'getUserConfiguration(address)',account),call(p.pool,'getUserEMode(address)',account),
    call(p.variableDebtToken,'balanceOf(address)',beneficiary),call(p.variableDebtToken,'scaledBalanceOf(address)',beneficiary),
    call(p.pool,'getReserveNormalizedVariableDebt(address)',p.asset),call(p.asset,'balanceOf(address)',p.aToken),
    call(p.variableDebtToken,'totalSupply()'),call(p.provider,'getPriceOracle()'),call(p.variableDebtToken,'UNDERLYING_ASSET_ADDRESS()'),call(p.variableDebtToken,'POOL()'),
    rpc('eth_getCode',[p.variableDebtToken,blockTag]),
  ]);
  const words=(value:unknown,count:number)=>{const h=rpcHex(value).slice(2);if(h.length!==count*64)throw new Error('BORROW_STATE_INVALID');return h.match(/.{64}/g)!.map(w=>BigInt('0x'+w));};
  const r=words(reserve,15),a=words(accountData,6);
  // The reserve id fixes which user-configuration bits belong to this asset.
  if(r[7]!==BigInt(p.reserveId))throw new Error('BORROW_RESERVE_UNSUPPORTED');
  if (r[10]!==BigInt(p.variableDebtToken) || rpcUint(oracle)!==BigInt(p.oracle) || rpcUint(underlying)!==BigInt(p.asset) || rpcUint(pool)!==BigInt(p.pool) || rpcUint(baseUnit)!==100000000n || rpcHex(code).length<4 || rpcUint(index)<10n**27n) throw new Error('BORROW_DEPLOYMENT_MISMATCH');
  const borrow:BorrowState={collateralBase:a[0]!.toString(),debtBase:a[1]!.toString(),availableBorrowBase:a[2]!.toString(),liquidationThresholdBps:a[3]!.toString(),ltvBps:a[4]!.toString(),healthFactor:a[5]!.toString(),price:rpcUint(price).toString(),baseCurrencyUnit:rpcUint(baseUnit).toString(),reserveConfiguration:r[0]!.toString(),userConfiguration:rpcUint(user).toString(),liquidity:rpcUint(liquidity).toString(),debt:rpcUint(debt).toString(),scaledDebt:rpcUint(scaled).toString(),debtIndex:rpcUint(index).toString(),variableDebtToken:p.variableDebtToken,eMode:rpcUint(eMode).toString(),debtTotalSupply:rpcUint(total).toString(),codeHash:supplyHash(rpcHex(code))};
  if (rpcHash(rpcRecord(await rpc('eth_getBlockByNumber',[blockTag,false])).hash)!==state.blockHash) throw new Error('BORROW_REORG');
  return {...state,borrow};
}
export function compileBorrowCalls(workflow:SemanticWorkflow,account:string):SupplyTransaction[] {
  const nodes=workflow.nodes.filter(n=>n.actionType==='borrow');
  if(nodes.length!==1||workflow.nodes.some(n=>n.actionType!=='borrow'&&!n.actionType.startsWith('mock-'))||workflow.resourceEdges.some(e=>e.fromNodeId===nodes[0]?.nodeId||e.toNodeId===nodes[0]?.nodeId)||workflow.nodes.some(n=>n.dependencies.includes(nodes[0]?.nodeId??'')))throw new Error('BORROW_ISOLATED_ONLY');
  const f=readBorrowNode(nodes[0]!),owner=supplyAddress(account),p=lendingProfile(f.chain,'BORROW_DEPLOYMENT_UNSUPPORTED');
  if(f.asset.address!==p.asset||f.asset.decimals!==p.decimals)throw new Error('BORROW_DEPLOYMENT_UNSUPPORTED');
  if(f.beneficiary!==owner)throw new Error('BORROW_BENEFICIARY_MUST_BE_OWNER');
  return [{from:owner,to:p.pool,value:'0x0',chainId:p.chainHex,data:supplyCall('borrow(address,uint256,uint256,uint16,address)',p.asset,BigInt(f.amount),2n,0n,owner)}];
}
/** Fixed configuration; bounded 0.1% drift for prices, interest and account values. */
export function assertBorrowFresh(amount:string,before:BorrowState,after:BorrowState,profile:AaveLendingProfile):void {
  for(const k of ['reserveConfiguration','userConfiguration','variableDebtToken','baseCurrencyUnit','eMode','codeHash'] as const)if(before[k]!==after[k])throw new Error('BORROW_AUTHORIZATION_STALE');
  const abs=(n:bigint)=>n<0n?-n:n;
  for(const k of ['collateralBase','debtBase','availableBorrowBase','price','healthFactor','debt'] as const){
    const a=units(before[k]),b=units(after[k]);
    if(abs(a-b)>a/1000n+2n)throw new Error('BORROW_AUTHORIZATION_STALE');
  }
  const a=estimateBorrow(amount,before,profile),b=estimateBorrow(amount,after,profile);
  if(abs(BigInt(a.healthFactorAfter)-BigInt(b.healthFactorAfter))>BigInt(a.healthFactorAfter)/1000n)throw new Error('BORROW_AUTHORIZATION_STALE');
}
