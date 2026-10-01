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

test('bounded missing approval can prepare a fresh review after restart without submitting or deleting the original intent',async({page})=>{
  await resetSupplyHarness({nonce:3});await installSupplyWallet(page,{notBroadcast:'APPROVAL'});await authorSupply(page);await reviewSupply(page);
  await page.getByRole('region',{name:'Aave Supply'}).getByRole('button',{name:'Execute',exact:true}).click();
  await expect(page.getByRole('button',{name:'Observe existing transaction'})).toBeVisible();await expect.poll(()=>supplySendCount(page)).toBe(1);await expect(page.getByRole('button',{name:'Observe existing transaction'})).toBeEnabled();
  await supplyHarnessRpc('MOCK_reset',[{block:200,nonce:3}]);await page.getByRole('button',{name:'Observe existing transaction'}).click();
  await expect(page.getByRole('button',{name:'Prepare fresh review'})).toBeVisible();
  await page.reload();await page.getByRole('navigation',{name:'Workflow stages'}).getByRole('button',{name:'Execute',exact:true}).click();
  await page.getByRole('button',{name:'Prepare fresh review'}).click();
  await expect(page.getByRole('button',{name:'Accept Supply review'})).toBeVisible();
  await expect(page.getByRole('region',{name:'Aave Supply'}).getByRole('button',{name:'Execute',exact:true})).toHaveCount(0);
  expect(await supplySendCount(page)).toBe(0);const detail=JSON.parse((await page.getByRole('region',{name:'Aave Supply'}).locator('pre').textContent())!);
  expect(detail.recoveryOf).toMatch(/^supply-/);expect(detail.attempts).toEqual([]);
  await page.reload();await page.getByRole('navigation',{name:'Workflow stages'}).getByRole('button',{name:'Simulate',exact:true}).click();
  await page.getByRole('button',{name:'Simulate Supply',exact:true}).click();await page.getByRole('button',{name:'Review Supply',exact:true}).click();
  const refreshed=JSON.parse((await page.getByRole('region',{name:'Aave Supply'}).locator('pre').textContent())!);expect(refreshed.recoveryOf).toBe(detail.recoveryOf);
  await page.getByRole('button',{name:'Accept Supply review'}).click();await expect(page.getByRole('region',{name:'Aave Supply'}).getByRole('button',{name:'Execute',exact:true})).toBeVisible();expect(await supplySendCount(page)).toBe(0);
  await page.evaluate(()=>{const w=window as unknown as {ethereum:{request:(input:{method:string;params?:unknown[]})=>Promise<unknown>};grylooSupplyTestRpc:(method:string,params:unknown[])=>Promise<unknown>};const original=w.ethereum.request;w.ethereum.request=async input=>input.method==='eth_sendTransaction'?w.grylooSupplyTestRpc('MOCK_submit',input.params??[]):original(input);});
  await page.getByRole('region',{name:'Aave Supply'}).getByRole('button',{name:'Execute',exact:true}).click();await expect(page.getByRole('button',{name:'Execute Supply',exact:true})).toBeVisible();
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
  expect(detail.walletDiagnostic.transaction).toMatchObject({nonce:'0x0',chainId:'0x14a34',to:'0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f'});expect(await supplySendCount(page)).toBe(0);
  await page.reload();await page.getByRole('navigation',{name:'Workflow stages'}).getByRole('button',{name:'Execute',exact:true}).click();
  await page.getByRole('button',{name:'Prepare fresh review'}).click();await page.getByRole('button',{name:'Accept Supply review'}).click();
  detail=JSON.parse((await page.getByRole('region',{name:'Aave Supply'}).locator('pre').textContent())!);expect(detail.attempts).toEqual([]);expect(detail.recoveryOf).toMatch(/^supply-/);expect(await supplySendCount(page)).toBe(0);
});

for(const nonce of ['0x3',3])test('pending wallet nonce '+JSON.stringify(nonce)+' reports the exact local guard with no wallet request',async({page})=>{
  await resetSupplyHarness();await installSupplyWallet(page,{walletNonce:nonce});await authorSupply(page);await reviewSupply(page);
  await page.getByRole('region',{name:'Aave Supply'}).getByRole('button',{name:'Execute',exact:true}).click();
  const code=typeof nonce==='string'?'SUPPLY_WALLET_NONCE_MISMATCH':'SUPPLY_WALLET_NONCE_RESPONSE_INVALID';
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
