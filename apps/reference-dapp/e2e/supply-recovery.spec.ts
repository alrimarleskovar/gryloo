// SPDX-License-Identifier: AGPL-3.0-only
import {test,expect} from './fixtures';
import {installSupplyWallet,resetSupplyHarness,authorSupply,reviewSupply,supplySendCount,supplyHarnessRpc} from './supply-fixtures';
test.afterEach(async({page},info)=>{if(info.status!==info.expectedStatus){const detail=await page.getByRole('region',{name:'Aave Supply'}).locator('pre').textContent(); console.error('Supply failure:',detail?JSON.parse(detail).error:'no details');}});
for(const step of ['APPROVAL','SUPPLY'] as const)test('restart observes uncertain '+step+' without a duplicate wallet submission',async({page})=>{
  await resetSupplyHarness(step==='SUPPLY'?{allowance:'10000000'}:{});await installSupplyWallet(page,{uncertain:step});await authorSupply(page);await reviewSupply(page);
  await page.getByRole('region',{name:'Aave Supply'}).getByRole('button',{name:'Execute',exact:true}).click();await expect(page.getByRole('button',{name:'Observe existing transaction'})).toBeVisible();await expect.poll(()=>supplySendCount(page)).toBe(1);await expect(page.getByRole('button',{name:'Observe existing transaction'})).toBeEnabled();
  await page.reload();await page.getByRole('navigation',{name:'Workflow stages'}).getByRole('button',{name:'Execute',exact:true}).click();
  await page.getByRole('button',{name:'Observe existing transaction'}).click();
  if(step==='APPROVAL'){await expect(page.getByText('Approval: Independently verified',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Execute Supply',exact:true})).toBeVisible();}
  else await expect(page.getByRole('link',{name:'Download Evidence Bundle'})).toBeVisible();
  expect(await supplySendCount(page)).toBe(0);
});

test('restart preserves a reverted approval and never requests it again',async({page})=>{
  await resetSupplyHarness({revert:true});await installSupplyWallet(page);await authorSupply(page);await reviewSupply(page);
  await page.getByRole('region',{name:'Aave Supply'}).getByRole('button',{name:'Execute',exact:true}).click();
  await expect(page.getByText('Approval: reverted',{exact:false})).toBeVisible();await expect.poll(()=>supplySendCount(page)).toBe(1);await expect(page.getByRole('button',{name:'Observe existing transaction'})).toBeEnabled();
  await page.reload();await page.getByRole('navigation',{name:'Workflow stages'}).getByRole('button',{name:'Execute',exact:true}).click();
  await expect(page.getByText('Approval: reverted',{exact:false})).toBeVisible();await expect(page.getByRole('link',{name:'Download Evidence Bundle'})).toHaveCount(0);expect(await supplySendCount(page)).toBe(0);
});

test('wallet-managed unknown approval remains observation-only after restart and bounded absence',async({page})=>{
  await resetSupplyHarness({nonce:3});await installSupplyWallet(page,{notBroadcast:'APPROVAL'});await authorSupply(page);await reviewSupply(page);
  await page.getByRole('region',{name:'Aave Supply'}).getByRole('button',{name:'Execute',exact:true}).click();
  await expect(page.getByRole('button',{name:'Observe existing transaction'})).toBeEnabled();expect(await supplySendCount(page)).toBe(1);
  await supplyHarnessRpc('MOCK_reset',[{block:200,nonce:3}]);await page.getByRole('button',{name:'Observe existing transaction'}).click();
  await expect(page.getByRole('region',{name:'Aave Supply'}).locator('pre')).toContainText('SUPPLY_OBSERVATION_BOUND_REACHED');
  await page.reload();await page.getByRole('navigation',{name:'Workflow stages'}).getByRole('button',{name:'Execute',exact:true}).click();
  await expect(page.getByRole('button',{name:'Prepare fresh review'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Observe existing transaction'})).toBeVisible();expect(await supplySendCount(page)).toBe(0);
});

test('Execute with a provider read failure never requests a wallet transaction or creates an unknown attempt',async({page})=>{
  await resetSupplyHarness();await installSupplyWallet(page,{nonceFailure:true});await authorSupply(page);await reviewSupply(page);
  await page.getByRole('region',{name:'Aave Supply'}).getByRole('button',{name:'Execute',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'The wallet provider read failed'})).toBeVisible();
  const detail=JSON.parse((await page.getByRole('region',{name:'Aave Supply'}).locator('pre').textContent())!);
  expect(detail.submissionError).toBe('SUPPLY_RPC_ERROR_BEFORE_WALLET_SUBMISSION');expect(detail.attempts).toEqual([]);
  expect(detail.walletDiagnostic.invoked).toBe(false);expect(detail.walletDiagnostic.error).toMatchObject({code:4900,message:'MOCK_READ_FAILED_BEFORE_SUBMISSION',data:{stage:'READ_ONLY_PREFLIGHT'},cause:{message:'Disconnected transport'}});
  expect(await supplySendCount(page)).toBe(0);await expect(page.getByRole('button',{name:'Observe existing transaction'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Accept Supply review'})).toBeVisible();
});

test('a failure after durable preparation is positively classified not submitted and is safe across restart',async({page})=>{
  await resetSupplyHarness();await installSupplyWallet(page,{lateNonceFailure:true});await authorSupply(page);await reviewSupply(page);
  await page.getByRole('region',{name:'Aave Supply'}).getByRole('button',{name:'Execute',exact:true}).click();
  await expect(page.getByText('Approval: not submitted (wallet was never requested)',{exact:false})).toBeVisible();
  let detail=JSON.parse((await page.getByRole('region',{name:'Aave Supply'}).locator('pre').textContent())!);
  expect(detail.notSubmitted).toBe(true);expect(detail.attempts[0].state).toBe('CANCELLED');expect(detail.walletDiagnostic.invoked).toBe(false);
  expect(detail.walletDiagnostic.transaction).toMatchObject({chainId:'0x14a34',to:'0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f'});expect(await supplySendCount(page)).toBe(0);
  await page.reload();await page.getByRole('navigation',{name:'Workflow stages'}).getByRole('button',{name:'Execute',exact:true}).click();
  await page.getByRole('button',{name:'Prepare fresh review'}).click();await page.getByRole('button',{name:'Accept Supply review'}).click();
  detail=JSON.parse((await page.getByRole('region',{name:'Aave Supply'}).locator('pre').textContent())!);expect(detail.attempts).toEqual([]);expect(detail.recoveryOf).toMatch(/^supply-/);expect(await supplySendCount(page)).toBe(0);
});

for(const nonce of ['0x3',3])test('pending wallet nonce '+JSON.stringify(nonce)+' reports the exact local guard with no wallet request',async({page})=>{
  await resetSupplyHarness();await installSupplyWallet(page,{walletNonce:nonce});await authorSupply(page);await reviewSupply(page);
  await page.getByRole('region',{name:'Aave Supply'}).getByRole('button',{name:'Execute',exact:true}).click();
  const code='SUPPLY_WALLET_NONCE_MISMATCH';
  await expect(page.getByRole('region',{name:'Aave Supply'}).locator('pre')).toContainText(code);
  const detail=JSON.parse((await page.getByRole('region',{name:'Aave Supply'}).locator('pre').textContent())!);expect(detail.walletDiagnostic.calls.at(-1).result).toBe(nonce);
  expect(detail.attempts).toEqual([]);expect(await supplySendCount(page)).toBe(0);await expect(page.getByText('submission result unknown',{exact:false})).toHaveCount(0);
});

test('eth_sendTransaction rejected with invalid params exposes the full provider error and never becomes unknown',async({page})=>{
  await resetSupplyHarness();await installSupplyWallet(page,{providerFailure:true});await authorSupply(page);await reviewSupply(page);
  await page.getByRole('region',{name:'Aave Supply'}).getByRole('button',{name:'Execute',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'The wallet provider refused'})).toBeVisible();
  const detail=JSON.parse((await page.getByRole('region',{name:'Aave Supply'}).locator('pre').textContent())!);
  expect(detail.notSubmitted).toBe(true);expect(detail.attempts[0].state).toBe('NOT_FOUND');expect(detail.walletDiagnostic.invoked).toBe(true);
  expect(detail.walletDiagnostic.calls.at(-1)).toMatchObject({method:'eth_sendTransaction',params:[detail.walletDiagnostic.transaction],error:{code:-32602,message:'Provider refused malformed request',data:{reason:'invalid transaction'},cause:{message:'Validation'}}});
  expect(await supplySendCount(page)).toBe(1);await expect(page.getByRole('button',{name:'Observe existing transaction'})).toHaveCount(0);
});

test('real-owner regression: numeric pending nonce 3 reaches the exact 1-USDC approval without an application nonce',async({page})=>{
  const owner='0x8ef12e4e2fd397c227492019f626b5d1c5e41b3b';
  await resetSupplyHarness({owner,nonce:3,allowanceSlot:'0xb72c92c22e4b04a63c6288b8f86d260a69f386469190a89d13cc216b0b4bbba7'});await installSupplyWallet(page,{account:owner,walletNonce:3});await authorSupply(page,'1',owner);await reviewSupply(page);
  await page.getByRole('region',{name:'Aave Supply'}).getByRole('button',{name:'Execute',exact:true}).click();
  await expect(page.getByText('Approval: Independently verified',{exact:false})).toBeVisible();
  const requests=await page.evaluate(()=>(window as unknown as {supplyWalletRequests:{method:string;params?:Record<string,string>[]}[]}).supplyWalletRequests);
  const sends=requests.filter(r=>r.method==='eth_sendTransaction');expect(sends).toHaveLength(1);const tx=sends[0]!.params![0]!;
  expect(tx).toEqual({from:owner,to:'0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f',data:'0x095ea7b30000000000000000000000008bab6d1b75f19e9ed9fce8b9bd338844ff79ae2700000000000000000000000000000000000000000000000000000000000f4240',chainId:'0x14a34',value:'0x0',gas:'0x124f8',gasPrice:'0x1e8480'});
  expect(tx).not.toHaveProperty('nonce');for(const field of ['chainId','value','gas','gasPrice'])expect(tx[field]).toMatch(/^0x(?:0|[1-9a-f][0-9a-f]*)$/i);
  const detail=JSON.parse((await page.getByRole('region',{name:'Aave Supply'}).locator('pre').textContent())!);
  expect(detail.attempts[0].nonce).toBe('3');expect(detail.walletDiagnostic.invoked).toBe(true);expect(detail.walletDiagnostic.calls.filter((c:{method:string})=>c.method==='eth_getTransactionCount').map((c:{result:unknown})=>c.result)).toEqual([3,3]);
  expect(detail.walletDiagnostic.calls.at(-1).result).toMatch(/^0x[0-9a-f]{64}$/);
  await expect(page.getByRole('button',{name:'Execute Supply',exact:true})).toBeVisible();expect(await supplySendCount(page)).toBe(1);
});
