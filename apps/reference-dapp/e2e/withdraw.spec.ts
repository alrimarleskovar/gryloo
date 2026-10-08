// SPDX-License-Identifier: AGPL-3.0-only
import {test,expect, openSimulationDetails, acceptProductReview } from './fixtures';
import { configureCanvasAction, openCanvasSettings } from './composer-authoring-fixtures';
import type {Page} from '@playwright/test';
import {installSupplyWallet,resetSupplyHarness,supplySendCount,supplyHarnessRpc} from './supply-fixtures';
import {withdrawOptions,WITHDRAW_OWNER as owner} from './withdraw-fixtures';
const region=(page:Page)=>page.getByRole('region',{name:'Aave Withdraw'});
async function author(page:Page,options:Parameters<typeof installSupplyWallet>[1]={}){
  await installSupplyWallet(page,{account:owner,...options});await page.goto('/');await page.getByRole('button',{name:'Add withdraw',exact:true}).click();
  await configureCanvasAction(page,'0.1');
  await expect(page.locator('.react-flow__node[data-id="node-002"]')).toContainText('1. Withdraw');
  await page.getByRole('button',{name:'Simulate fees'}).click(); await openSimulationDetails(page);await page.getByRole('button',{name:'Simulate Withdraw',exact:true}).click();await expect(page.getByRole('button',{name:'Approve & Continue',exact:true})).toBeVisible();
}
async function review(page:Page){await acceptProductReview(page);}
const execute=(page:Page)=>region(page).getByRole('button',{name:'Execute',exact:true}).click();
test.beforeEach(async()=>{await resetSupplyHarness(withdrawOptions);});
test('Build → read-only Simulate → owner Review → one exact Withdraw → Result',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await author(page);
  for(const text of ['Supplied collateral before: 1.000002','Withdraw amount: 0.1','Estimated supplied collateral after: 0.900001','Outstanding variable debt: 0.005001','Health factor before:','Estimated health factor after:','Wallet USDC before: 0.005','Estimated wallet USDC after: 0.105','Estimated network cost:','Owner / recipient:','Exact Pool call: withdraw(','Exact calldata: 0x69328dec'])await expect(region(page)).toContainText(text);
  expect(await supplySendCount(page)).toBe(0);await review(page);expect(await supplySendCount(page)).toBe(0);await page.screenshot({path:'/tmp/BUILD-012D-WITHDRAW-REVIEW.png',fullPage:true});
  await execute(page);await expect(page.getByRole('link',{name:'Download Evidence Bundle'})).toBeVisible();expect(await supplySendCount(page)).toBe(1);
  const href=await page.getByRole('link',{name:'Download Evidence Bundle'}).getAttribute('href'),evidence=JSON.parse(decodeURIComponent(href!.split(',')[1]!));expect(evidence.bundle).toMatchObject({environment:'MOCKED',outcome:'RECONCILED'});expect(evidence.bundle.receipts).toHaveLength(1);expect(evidence.publicExecution).toMatchObject({amount:'100000',recipient:owner,walletDelta:'100000'});
  const requests=await page.evaluate(()=>{const w=window as unknown as {supplyWalletRequests:{method:string;params:unknown[]}[]};return w.supplyWalletRequests.filter(r=>r.method==='eth_sendTransaction').map(r=>r.params[0]);});expect(requests[0]).not.toHaveProperty('nonce');expect(errors).toEqual([]);await page.screenshot({path:'/tmp/BUILD-012D-WITHDRAW-MOCKED-RESULT.png',fullPage:true});
});
test('lost response recovers the same Withdraw after refresh with no repeat send',async({page})=>{
  await author(page,{uncertain:'SUPPLY'});await review(page);await execute(page);await expect(page.getByRole('button',{name:'Observe existing transaction'})).toBeEnabled();await page.reload();await page.getByRole('navigation',{name:'Workflow stages'}).getByRole('button',{name:'Execute',exact:true}).click();await page.getByRole('button',{name:'Observe existing transaction'}).click();await expect(page.getByRole('link',{name:'Download Evidence Bundle'})).toBeVisible();expect(await supplySendCount(page)).toBe(0);
});
test('unknown unobserved submission stays observation-only across refresh',async({page})=>{
  await author(page,{notBroadcast:'SUPPLY'});await review(page);await execute(page);await expect(page.getByRole('button',{name:'Observe existing transaction'})).toBeEnabled();await page.reload();await page.getByRole('navigation',{name:'Workflow stages'}).getByRole('button',{name:'Execute',exact:true}).click();await page.getByRole('button',{name:'Observe existing transaction'}).click();await expect(region(page).getByRole('button',{name:'Execute',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Prepare fresh review'})).toHaveCount(0);expect(await supplySendCount(page)).toBe(0);
});
test('known wallet refusal requires fresh explicit Review',async({page})=>{await author(page,{reject:'SUPPLY'});await review(page);await execute(page);await expect(region(page)).toContainText('not submitted');await page.getByRole('button',{name:'Prepare fresh review'}).click();await expect(page.getByRole('button',{name:'Accept Withdraw review'})).toBeVisible();expect(await supplySendCount(page)).toBe(1);});
test('wrong chain blocks wallet handoff',async({page})=>{await author(page,{chain:'0x1'});await review(page);await execute(page);await expect(region(page)).toContainText('Switch your wallet');expect(await supplySendCount(page)).toBe(0);});
test('wrong owner blocks wallet handoff',async({page})=>{
  await author(page);await review(page);await page.evaluate(()=>{const w=window as unknown as {ethereum:{request:(i:{method:string})=>Promise<unknown>}};const original=w.ethereum.request;w.ethereum.request=async i=>i.method==='eth_accounts'?['0x2222222222222222222222222222222222222222']:original(i);});await execute(page);await expect(region(page)).toContainText('Select the owner');expect(await supplySendCount(page)).toBe(0);
});
test('fresh collateral mutation invalidates Execute',async({page})=>{await author(page);await review(page);await supplyHarnessRpc('MOCK_reset',[{...withdrawOptions,scaled:'803434'}]);await execute(page);await expect(region(page)).toContainText('changed');expect(await supplySendCount(page)).toBe(0);});
test('semantic edit removes Withdraw authority',async({page})=>{
  await author(page);await review(page);await page.getByRole('button',{name:'Build',exact:true}).click();await page.locator('.react-flow__node[data-id="node-002"] .flow-card').click();await openCanvasSettings(page);const form=page.getByRole('form',{name:'Edit Withdraw'});await form.getByLabel('Withdraw amount (USDC)').fill('0.09');await page.locator('.build-flow-surface .composer-card.active').getByRole('button',{name:'Review Withdraw change'}).click();await page.getByRole('button',{name:'Apply proposal'}).click();await page.getByRole('navigation',{name:'Workflow stages'}).getByRole('button',{name:'Execute',exact:true}).click();await expect(region(page)).toContainText('The workflow changed');await expect(region(page).getByRole('button',{name:'Execute',exact:true})).toHaveCount(0);expect(await supplySendCount(page)).toBe(0);
});
