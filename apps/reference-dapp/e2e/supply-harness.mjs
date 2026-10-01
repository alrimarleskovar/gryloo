// SPDX-License-Identifier: AGPL-3.0-only
/** Explicit MOCKED offline RPC. No public transport, signing key or broadcast exists. */
import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import { AAVE_V3_BASE_SEPOLIA as p, supplyCall, supplyWord, supplyTopic, supplyHex } from '../../../packages/reference-compiler/dist/index.js';
export const OWNER='0x1111111111111111111111111111111111111111';
const SLOT='0x0eb026e3feeb6eaf0b78e4cc060713d5dc1bb58e7fce3ea589f6e19ecbbf4f06';
const hash=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const word=n=>'0x'+supplyWord(BigInt(n));
const topicAddress=a=>'0x'+supplyWord(a);
export function createSupplyHarness(){
  const state={owner:OWNER,allowanceSlot:SLOT,block:10,nonce:0,allowance:0n,balance:100_000_000n,nativeBalance:10n**18n,scaled:8_000_000n,index:125n*10n**25n,chain:'0x14a34',revert:false,mismatch:false,ignoreOverride:false};
  const transactions=[],receipts=new Map(),history=new Map();
  const snapshot=()=>({...state});history.set(10,snapshot());
  const at=tag=>{const n=tag==='latest'||tag==='pending'?state.block:Number(BigInt(tag));if(n>=state.block)return snapshot();return [...history.entries()].filter(([b])=>b<=n).at(-1)?.[1]??snapshot();};
  const call=(tx,tag,override)=>{
    const s=at(tag),data=tx.data.toLowerCase(),to=tx.to.toLowerCase();
    const effectiveAllowance=!state.ignoreOverride&&override?.[p.asset]?.stateDiff?.[s.allowanceSlot]!==undefined?BigInt(override[p.asset].stateDiff[s.allowanceSlot]):s.allowance;
    if(data===supplyCall('getPool()')&&to===p.provider)return word(p.pool);
    if(data===supplyCall('getReserveData(address)',p.asset)&&to===p.pool){const words=Array.from({length:15},()=>supplyWord(0n));words[0]=supplyWord((1n<<56n)|(6n<<48n));words[1]=supplyWord(s.index);words[8]=supplyWord(p.aToken);return '0x'+words.join('');}
    if(data===supplyCall('decimals()')&&to===p.asset)return word(6);
    if(data===supplyCall('POOL()')&&to===p.aToken)return word(p.pool);
    if(data===supplyCall('UNDERLYING_ASSET_ADDRESS()')&&to===p.aToken)return word(p.asset);
    if(data===supplyCall('allowance(address,address)',state.owner,p.pool)&&to===p.asset)return word(effectiveAllowance);
    if(data.startsWith(supplyCall('allowance(address,address)').slice(0,10))&&to===p.asset)return word(0);
    if(data===supplyCall('balanceOf(address)',state.owner)&&to===p.asset)return word(s.balance);
    if(data.startsWith(supplyCall('balanceOf(address)').slice(0,10))&&to===p.aToken)return word((s.scaled*s.index+10n**27n/2n)/10n**27n);
    if(data.startsWith(supplyCall('scaledBalanceOf(address)').slice(0,10))&&to===p.aToken)return word(s.scaled);
    if(data===supplyCall('getReserveNormalizedIncome(address)',p.asset)&&to===p.pool)return word(s.index);
    if(data.startsWith(supplyCall('approve(address,uint256)').slice(0,10))&&to===p.asset)return word(1);
    if(data.startsWith(supplyCall('supply(address,uint256,address,uint16)').slice(0,10))&&to===p.pool){const amount=BigInt('0x'+data.slice(74,138));if(effectiveAllowance<amount||s.balance<amount)throw new Error('MOCK_SUPPLY_REVERT');return '0x';}
    throw new Error('MOCK_CALL_DENIED');
  };
  async function rpc(method,params){
    if(method==='eth_chainId')return state.chain;
    if(method==='eth_blockNumber')return supplyHex(state.block);
    if(method==='eth_getBlockByNumber'){
      const tag=params[0],n=tag==='latest'||tag==='pending'?state.block:Number(BigInt(tag));
      return {number:supplyHex(n),hash:hash(n+1000),parentHash:hash(n+999),transactions:tag==='pending'?[]:transactions.filter(t=>Number(BigInt(t.blockNumber))===n).map(t=>params[1]?t:t.hash)};
    }
    if(method==='eth_getCode')return '0x60016000';
    if(method==='eth_getBalance')return supplyHex(at(params[1]).nativeBalance);
    if(method==='eth_getTransactionCount')return supplyHex(state.nonce);
    if(method==='eth_gasPrice')return supplyHex(1_000_000n);
    if(method==='eth_call')return call(params[0],params[1],params[2]);
    if(method==='eth_estimateGas'){call(params[0],params[1],params[2]);return supplyHex(params[0].to===p.pool?150_000:50_000);}
    if(method==='eth_getTransactionByHash')return transactions.find(t=>t.hash===params[0])??null;
    if(method==='eth_getTransactionReceipt')return receipts.get(params[0])??null;
    // Harness-only mutation; browser tests invoke it through a guarded Node binding.
    if(method==='MOCK_submit'){
      const tx=params[0];if(tx.from!==state.owner||tx.chainId!==p.chainHex||BigInt(tx.nonce)!==BigInt(state.nonce)||tx.value!=='0x0'||![p.asset,p.pool].includes(tx.to))throw new Error('MOCK_SUBMISSION_DENIED');
      const block=state.block+1,txHash=hash(transactions.length+2000),logs=[];
      const amount=BigInt('0x'+tx.data.slice(74,138));
      if(!state.revert){
        if(tx.to===p.asset){if(tx.data!==supplyCall('approve(address,uint256)',p.pool,amount))throw new Error('MOCK_APPROVAL_DENIED');state.allowance=amount;
          logs.push({address:p.asset,topics:[supplyTopic('Approval(address,address,uint256)'),topicAddress(state.owner),topicAddress(p.pool)],data:word(amount)});
        }else{
          const beneficiary='0x'+tx.data.slice(162,202);if(tx.data!==supplyCall('supply(address,uint256,address,uint16)',p.asset,amount,beneficiary,0n)||state.allowance<amount||state.balance<amount)throw new Error('MOCK_SUPPLY_DENIED');
          state.balance-=amount;state.allowance-=amount;state.scaled+=(amount*10n**27n+state.index/2n)/state.index+(state.mismatch?100n:0n);
          logs.push({address:p.pool,topics:[supplyTopic('Supply(address,address,address,uint256,uint16)'),topicAddress(p.asset),topicAddress(beneficiary),word(0)],data:'0x'+supplyWord(state.owner)+supplyWord(amount)},
            {address:p.asset,topics:[supplyTopic('Transfer(address,address,uint256)'),topicAddress(state.owner),topicAddress(p.aToken)],data:word(amount)});
        }
      }
      const mined={...tx,hash:txHash,input:tx.data,blockNumber:supplyHex(block),blockHash:hash(block+1000),gas:tx.gas};transactions.push(mined);
      receipts.set(txHash,{transactionHash:txHash,from:tx.from,to:tx.to,blockNumber:supplyHex(block),blockHash:hash(block+1000),status:state.revert?'0x0':'0x1',gasUsed:supplyHex(tx.to===p.pool?140_000:45_000),effectiveGasPrice:supplyHex(1_000_000),l1Fee:'0x0',logs});
      state.nonce++;state.block=block+2;history.set(block,snapshot());return txHash;
    }
    throw new Error('MOCK_RPC_METHOD_DENIED');
  }
  return {state,rpc,transactions,receipts,history};
}
if(process.argv.includes('--serve')){
  let model=createSupplyHarness();
  const server=createServer(async(req,res)=>{
    try{
      if(req.method==='GET'&&req.url==='/'){res.end('MOCKED Supply harness');return;}
      let body='';for await(const chunk of req){body+=chunk.toString();if(Buffer.byteLength(body)>1_048_576)throw new Error('MOCK_INPUT_TOO_LARGE');}
      const value=JSON.parse(body);let result;
      if(value.method==='MOCK_reset'){model=createSupplyHarness();const options=value.params?.[0]??{};for(const key of ['allowance','balance','nativeBalance','scaled','index'])if(options[key]!==undefined)options[key]=BigInt(options[key]);Object.assign(model.state,options);model.history.set(model.state.block,{...model.state});result=true;}
      else result=await model.rpc(value.method,value.params??[]);
      res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:value.id,result},(_,v)=>typeof v==='bigint'?v.toString():v));
    }catch{res.statusCode=400;res.end(JSON.stringify({error:{code:-32000,message:'MOCK_RPC_DENIED'}}));}
  });
  server.listen(8549,'127.0.0.1');
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit(0)));
}
