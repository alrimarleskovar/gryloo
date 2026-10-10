// SPDX-License-Identifier: AGPL-3.0-only
import {test,expect, openSimulationDetails, acceptProductReview } from './fixtures';
import { configureCanvasAction, openCanvasSettings } from './composer-authoring-fixtures';
import type {Page} from '@playwright/test';
import {installSupplyWallet,resetSupplyHarness,supplySendCount,supplyHarnessRpc} from './supply-fixtures';
import {REPAY_OWNER,repayOptions} from './supply-fixtures';
async function author(page:Page,options:Parameters<typeof installSupplyWallet>[1]={}){
  await installSupplyWallet(page,{account:REPAY_OWNER,...options});await page.goto('/app');await page.getByRole('button',{name:'Add repay',exact:true}).click();
  await configureCanvasAction(page,'0.005');
  await expect(page.locator('.react-flow__node[data-id="node-002"]')).toContainText('1. Repay');
  await page.getByRole('button',{name:'Simulate workflow'}).click(); await openSimulationDetails(page);await page.getByRole('button',{name:'Simulate Repay',exact:true}).click();await expect(page.getByRole('button',{name:'Approve & Continue',exact:true})).toBeVisible();
}
async function review(page:Page){await acceptProductReview(page);}
const region=(page:Page)=>page.getByRole('region',{name:'Aave Repay'});
const execute=(page:Page)=>region(page).getByRole('button',{name:'Execute',exact:true}).click();
const approve=(page:Page)=>region(page).getByRole('button',{name:'Approve exactly 5000 raw USDC'}).click();
test.beforeEach(async()=>{await resetSupplyHarness(repayOptions);});
test('Build → Repay → read-only Simulate → Review → exact approval → owner Repay → evidence',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await author(page);
  for(const text of ['Wallet USDC balance: 0.01','Variable debt before: 0.010001','Repay amount: 0.005','Allowance before: 0','Approval required: Yes','Estimated variable debt after:','Health factor before:','Estimated health factor after:','Collateral:','Maximum network budget:'])await expect(region(page)).toContainText(text);
  expect(await supplySendCount(page)).toBe(0);await review(page);expect(await supplySendCount(page)).toBe(0);await page.screenshot({path:'/tmp/BUILD-012C-REPAY-REVIEW.png',fullPage:true});
  await approve(page);await expect(region(page)).toContainText('Approval: Independently verified');await expect(region(page).getByRole('button',{name:'Execute',exact:true})).toBeEnabled();expect(await supplySendCount(page)).toBe(1);
  await execute(page);await expect(page.getByRole('link',{name:'Download Evidence Bundle'})).toBeVisible();expect(await supplySendCount(page)).toBe(2);
  const requests=await page.evaluate(()=>{const w=window as unknown as {supplyWalletRequests:{method:string;params:unknown[]}[]};return w.supplyWalletRequests.filter(r=>r.method==='eth_sendTransaction').map(r=>r.params[0]);});
  for(const request of requests)expect(request).not.toHaveProperty('nonce');expect(requests[0]).toMatchObject({to:'0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f'});expect(requests[1]).toMatchObject({to:'0x8bab6d1b75f19e9ed9fce8b9bd338844ff79ae27'});
  const href=await page.getByRole('link',{name:'Download Evidence Bundle'}).getAttribute('href'),evidence=JSON.parse(decodeURIComponent(href!.split(',')[1]!));
  expect(evidence.bundle).toMatchObject({environment:'MOCKED',outcome:'RECONCILED'});expect(evidence.bundle.receipts).toHaveLength(2);expect(evidence.publicExecution).toMatchObject({amount:'5000',rateMode:2,walletDelta:'-5000',postAllowance:'0',ownerAuthorization:{kind:'DIRECT_EIP1559'}});
  expect(errors).toEqual([]);await page.screenshot({path:'/tmp/BUILD-012C-REPAY-MOCKED-RESULT.png',fullPage:true});
});
test('lost approval response recovers after reload then proceeds without another approval',async({page})=>{
  await author(page,{uncertain:'APPROVAL'});await review(page);await approve(page);await expect(page.getByRole('button',{name:'Observe existing transaction'})).toBeEnabled();
  await page.reload();await page.getByRole('navigation',{name:'Workflow stages'}).getByRole('button',{name:'Execute',exact:true}).click();await page.getByRole('button',{name:'Observe existing transaction'}).click();await expect(region(page)).toContainText('Approval: Independently verified');await execute(page);await expect(page.getByRole('link',{name:'Download Evidence Bundle'})).toBeVisible();expect(await supplySendCount(page)).toBe(1);
});
test('lost Repay response recovers the same transaction after reload without another send',async({page})=>{
  await resetSupplyHarness({...repayOptions,allowance:'5000'});await author(page,{uncertain:'SUPPLY'});await review(page);await execute(page);await expect(page.getByRole('button',{name:'Observe existing transaction'})).toBeEnabled();
  await page.reload();await page.getByRole('navigation',{name:'Workflow stages'}).getByRole('button',{name:'Execute',exact:true}).click();await page.getByRole('button',{name:'Observe existing transaction'}).click();await expect(page.getByRole('link',{name:'Download Evidence Bundle'})).toBeVisible();expect(await supplySendCount(page)).toBe(0);
});
test('known approval refusal requires fresh owner Review and no financial evidence',async({page})=>{
  await author(page,{reject:'APPROVAL'});await review(page);await approve(page);await expect(region(page)).toContainText('not submitted');await expect(page.getByRole('link',{name:'Download Evidence Bundle'})).toHaveCount(0);await page.getByRole('button',{name:'Prepare fresh review'}).click();await expect(page.getByRole('button',{name:'Accept Repay review'})).toBeVisible();expect(await supplySendCount(page)).toBe(1);
});
test('wrong chain prevents owner request',async({page})=>{await author(page,{chain:'0x1'});await review(page);await approve(page);await expect(region(page)).toContainText('Switch your wallet');expect(await supplySendCount(page)).toBe(0);});
test('wrong owner prevents owner request',async({page})=>{
  await author(page);await review(page);await page.evaluate(()=>{const w=window as unknown as {ethereum:{request:(i:{method:string})=>Promise<unknown>}};const original=w.ethereum.request;w.ethereum.request=async i=>i.method==='eth_accounts'?['0x2222222222222222222222222222222222222222']:original(i);});await approve(page);await expect(region(page)).toContainText('Select the owner');expect(await supplySendCount(page)).toBe(0);
});
test('debt change invalidates Review at Execute',async({page})=>{await author(page);await review(page);await supplyHarnessRpc('MOCK_reset',[{...repayOptions,scaledDebt:'8002'}]);await approve(page);await expect(region(page)).toContainText('changed');expect(await supplySendCount(page)).toBe(0);});
test('semantic amount edit removes Repay authorization',async({page})=>{
  await author(page);await review(page);await page.getByRole('button',{name:'Build',exact:true}).click();await page.locator('.react-flow__node[data-id="node-002"] .flow-card').click();await openCanvasSettings(page);const form=page.getByRole('form',{name:'Edit Repay'});await form.getByLabel('Repay amount (USDC)').fill('0.004');await page.locator('.build-flow-surface .composer-card.active').getByRole('button',{name:'Review Repay change'}).click();await page.getByRole('button',{name:'Apply proposal'}).click();await page.getByRole('navigation',{name:'Workflow stages'}).getByRole('button',{name:'Execute',exact:true}).click();await expect(region(page)).toContainText('The workflow changed');await expect(region(page).getByRole('button',{name:'Approve exactly 5000 raw USDC'})).toHaveCount(0);expect(await supplySendCount(page)).toBe(0);
});
test('insufficient debt blocks read-only simulation',async({page})=>{
  await resetSupplyHarness({...repayOptions,scaledDebt:'4000'});await installSupplyWallet(page,{account:REPAY_OWNER});await page.goto('/app');await page.getByRole('button',{name:'Add repay',exact:true}).click();await configureCanvasAction(page,'0.005');await page.getByRole('button',{name:'Simulate workflow'}).click(); await openSimulationDetails(page);await page.getByRole('button',{name:'Simulate Repay',exact:true}).click();
  await expect(region(page)).toContainText('Current variable debt must exceed');
  const details = page.locator('.review-authorization-details');
  await details.locator('summary').click();
  await expect(page.getByRole('region',{name:'Risk and attention',exact:true})).toContainText('Simulation could not be completed. Try again before continuing.');
  await expect(details).toContainText('requires a fresh Review');
  await expect(page.locator('.canvas-primary-action').getByRole('button',{name:'Simulate workflow',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Approve & Continue',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Execute workflow',exact:true})).toHaveCount(0);
  expect(await supplySendCount(page)).toBe(0);
});
