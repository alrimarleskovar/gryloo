// SPDX-License-Identifier: AGPL-3.0-only
/** Closed MOCKED composition transport. Public disposable fixture signatures only. */
import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import { createSupplyHarness, REPAY_OWNER, mockAllowanceSlot, signMockTransaction } from './supply-harness.mjs';
import { AAVE_V3_BASE_SEPOLIA as p, supplyCall, supplyWord, supplyTopic, supplyHex } from '../../../packages/reference-compiler/dist/index.js';
import { LENDING_BASE_SEPOLIA as u } from '../../../packages/action-registry/dist/index.js';
export const OWNER = REPAY_OWNER;
export const POOL = '0x9d9203f8a29c600d567b240692db569b77d1f4a9';
const word = v => '0x' + supplyWord(v), hash = n => word(BigInt(n));
const selector = signature => supplyCall(signature).slice(0, 10);
const output = amount => amount * 1_000_000_000n;
export function createLendingHarness() {
  const base = createSupplyHarness(), { state, history, transactions, receipts } = base;
  Object.assign(state, { owner: OWNER, allowanceSlot: mockAllowanceSlot(OWNER), weth: 0n, routerAllowance: 0n,
    poolAvailable: true, swapAvailable: true, simulationAvailable: true, quoteBps: 10000n, timestamp: Math.floor(Date.now()/1000) });
  history.set(state.block, { ...state });
  const at = tag => tag === 'latest' || tag === 'pending' || Number(BigInt(tag)) >= state.block ? state :
    [...history.entries()].filter(([n]) => n <= Number(BigInt(tag))).at(-1)?.[1] ?? state;
  async function rpc(method, params = []) {
    if (method === 'eth_getBlockByNumber') return { ...await base.rpc(method, params), timestamp: supplyHex(at(params[0]).timestamp) };
    if (method === 'eth_call') {
      const [tx, tag] = params, s = at(tag), data = tx.data.toLowerCase(), to = tx.to.toLowerCase();
      if (to === u.factory && data.startsWith(selector('getPool(address,address,uint24)'))) {
        if (data !== supplyCall('getPool(address,address,uint24)', p.asset, u.weth, 500n)) throw Error('MOCK_TOKEN_SUBSTITUTION');
        return word(s.poolAvailable ? POOL : 0n);
      }
      if ([u.router,u.quoter,POOL].includes(to) && data === supplyCall('factory()')) return word(u.factory);
      if (to === u.router && data === supplyCall('WETH9()')) return word(u.weth);
      if (to === POOL) {
        if (data === supplyCall('token0()')) return word(u.weth);
        if (data === supplyCall('token1()')) return word(p.asset);
        if (data === supplyCall('fee()')) return word(500n);
        if (data === supplyCall('liquidity()')) return word(s.swapAvailable ? 10n**18n : 0n);
        if (data === supplyCall('slot0()')) return '0x'+[1n<<96n,0n,0n,1n,1n,0n,1n].map(supplyWord).join('');
      }
      if (to === u.quoter && data.startsWith(selector('quoteExactInputSingle((address,address,uint256,uint24,uint160))'))) {
        const amount = BigInt('0x'+data.slice(138,202));
        return '0x'+[output(amount)*s.quoteBps/10000n,1n<<96n,0n,100000n].map(supplyWord).join('');
      }
      if (to === u.weth && data === supplyCall('balanceOf(address)', OWNER)) return word(s.weth);
      if (to === u.weth && data === supplyCall('balanceOf(address)', POOL)) return word(10n**20n);
      if (to === p.asset && data === supplyCall('allowance(address,address)', OWNER,u.router)) return word(s.routerAllowance);
      if (to === u.gasOracle && data.startsWith(selector('getL1FeeUpperBound(uint256)'))) return word(1000000n);
      return base.rpc(method, params);
    }
    if (method === 'eth_simulateV1') {
      if (!state.simulationAvailable) throw Error('MOCK_SIMULATION_UNAVAILABLE');
      const options = params[0];
      if (options.validation !== true || options.blockStateCalls.length !== 1 || options.blockStateCalls[0].stateOverrides) throw Error('MOCK_SIMULATION_DENIED');
      const clone = createLendingHarness(); Object.assign(clone.state, at(params[1])); clone.history.clear(); clone.history.set(clone.state.block,{...clone.state});
      const calls=[];
      for (const tx of options.blockStateCalls[0].calls) {
        try {
          const financial = tx.to === u.router || tx.to === p.asset && tx.data.startsWith(selector('approve(address,uint256)')) ||
            tx.to === p.pool && ['supply(address,uint256,address,uint16)','borrow(address,uint256,uint256,uint16,address)'].some(sig=>tx.data.startsWith(selector(sig)));
          if (financial) {
            await clone.rpc('MOCK_submit',[{...tx,chainId:p.chainHex,nonce:supplyHex(clone.state.nonce)}]);
            calls.push({status:clone.state.revert?'0x0':'0x1',gasUsed:supplyHex(tx.to===p.asset?45000n:140000n),
              returnData:tx.to===p.asset?word(1n):tx.to===u.router?word(output(BigInt('0x'+tx.data.slice(266,330)))*clone.state.quoteBps/10000n):'0x'});
          } else calls.push({status:'0x1',gasUsed:supplyHex(20000n),returnData:await clone.rpc('eth_call',[tx,'latest'])});
        } catch { calls.push({status:'0x0',gasUsed:'0x1',returnData:'0x'}); }
      }
      return [{calls}];
    }
    if (method === 'MOCK_submit') {
      const tx=params[0];
      if (tx.to !== u.router && !(tx.to===p.asset && tx.data.slice(10,74)===supplyWord(u.router))) {
        const empty=state.scaled===0n,result=await base.rpc(method,params);
        if(tx.to===p.pool&&tx.data.startsWith(selector('supply(address,uint256,address,uint16)'))&&!state.revert){state.liquidity+=BigInt('0x'+tx.data.slice(74,138));if(empty)state.userConfig|=2n;history.set(state.block-2,{...state});}
        return result;
      }
      if (tx.from!==OWNER || tx.chainId!==p.chainHex || BigInt(tx.nonce)!==BigInt(state.nonce) || tx.value!=='0x0') throw Error('MOCK_OWNER_DENIED');
      const signed=signMockTransaction(tx), block=state.block+1, logs=[];
      if (!state.revert) {
        if (tx.to===p.asset) {
          const amount=BigInt('0x'+tx.data.slice(74,138));
          if(tx.data!==supplyCall('approve(address,uint256)',u.router,amount))throw Error('MOCK_APPROVAL_DENIED');
          state.routerAllowance=amount;logs.push({address:p.asset,topics:[supplyTopic('Approval(address,address,uint256)'),word(OWNER),word(u.router)],data:word(amount)});
        } else {
          const amount=BigInt('0x'+tx.data.slice(266,330)), minimum=BigInt('0x'+tx.data.slice(330,394)), out=output(amount)*state.quoteBps/10000n;
          if (!state.swapAvailable || !state.poolAvailable || out<minimum || state.balance<amount || state.routerAllowance<amount ||
            tx.data!==supplyCall('exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))',p.asset,u.weth,500n,OWNER,amount,minimum,0n)) throw Error('MOCK_SWAP_DENIED');
          state.balance-=amount;state.routerAllowance-=amount;state.weth+=out;
          logs.push({address:p.asset,topics:[supplyTopic('Transfer(address,address,uint256)'),word(OWNER),word(POOL)],data:word(amount)},
            {address:u.weth,topics:[supplyTopic('Transfer(address,address,uint256)'),word(POOL),word(OWNER)],data:word(out)},
            {address:POOL,topics:[supplyTopic('Swap(address,address,int256,int256,uint160,uint128,int24)'),word(u.router),word(OWNER)],data:'0x'+[(1n<<256n)-out,amount,1n<<96n,10n**18n,0n].map(supplyWord).join('')});
        }
      }
      transactions.push({...tx,...signed,input:tx.data,transactionIndex:'0x0',blockNumber:supplyHex(block),blockHash:hash(block+1000)});
      receipts.set(signed.hash,{transactionHash:signed.hash,from:OWNER,to:tx.to,transactionIndex:'0x0',blockNumber:supplyHex(block),blockHash:hash(block+1000),
        status:state.revert?'0x0':'0x1',gasUsed:supplyHex(tx.to===u.router?140000n:45000n),effectiveGasPrice:supplyHex(1000000n),l1Fee:'0x0',logs});
      state.nativeBalance-=BigInt(tx.to===u.router?140000:45000)*1000000n;state.nonce++;state.block=block+2;history.set(block,{...state});return signed.hash;
    }
    return base.rpc(method,params);
  }
  return {...base,rpc};
}
if (process.argv.includes('--serve')) {
  let model=createLendingHarness();
  const server=createServer(async(req,res)=>{
    try {
      if(req.method==='GET'){res.end('MOCKED lending composition');return;}
      let body='';for await(const chunk of req){body+=chunk.toString();if(Buffer.byteLength(body)>1048576)throw Error('MOCK_INPUT_TOO_LARGE');}
      const request=JSON.parse(body);let result;
      if(request.method==='MOCK_reset'){
        model=createLendingHarness();const values=request.params?.[0]??{};
        for(const [key,value] of Object.entries(values))model.state[key]=typeof model.state[key]==='bigint'?BigInt(value):value;
        model.history.set(model.state.block,{...model.state});result=true;
      }else if(request.method==='MOCK_patch'){
        for(const [key,value] of Object.entries(request.params?.[0]??{})){
          if(!['swapAvailable','poolAvailable','simulationAvailable','quoteBps','price','revert'].includes(key))throw Error('MOCK_PATCH_DENIED');
          model.state[key]=typeof model.state[key]==='bigint'?BigInt(value):value;
        }
        model.history.set(model.state.block,{...model.state});result=true;
      }else result=await model.rpc(request.method,request.params??[]);
      res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));
    }catch{res.statusCode=400;res.end(JSON.stringify({error:{code:-32000,message:'MOCK_LENDING_DENIED'}}));}
  });
  server.listen(8554,'127.0.0.1');for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit(0)));
}
