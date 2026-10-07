// SPDX-License-Identifier: AGPL-3.0-only
import {test,expect, openSimulationDetails, acceptProductReview } from './fixtures';
import { configureCanvasAction, openCanvasSettings } from './composer-authoring-fixtures';
import type {Page} from '@playwright/test';
import {installSupplyWallet,resetSupplyHarness,supplySendCount,supplyHarnessRpc} from './supply-fixtures';
async function author(page:Page,options:Parameters<typeof installSupplyWallet>[1]={}){
  await installSupplyWallet(page,options);await page.goto('/');await page.getByRole('button',{name:'Add borrow',exact:true}).click();
  await configureCanvasAction(page,'0.01');
  await expect(page.locator('.react-flow__node[data-id="node-002"]')).toContainText('1. Borrow');
  await page.getByRole('button',{name:'Simular Fees'}).click(); await openSimulationDetails(page);await page.getByRole('button',{name:'Simulate Borrow',exact:true}).click();
  await expect(page.getByRole('button',{name:'Approve & Continue',exact:true})).toBeVisible();
}
async function review(page:Page){await acceptProductReview(page);}
const execute=(page:Page)=>page.getByRole('region',{name:'Aave Borrow'}).getByRole('button',{name:'Execute',exact:true}).click();
test.beforeEach(async()=>{await resetSupplyHarness({balance:'0'});});
test('Build → Borrow → read-only Simulate → Review → owner wallet → debt evidence',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await author(page);
  await expect(page.getByRole('region',{name:'Aave Borrow'})).toContainText('Estimated health factor after: 860');
  expect(await supplySendCount(page)).toBe(0);await review(page);expect(await supplySendCount(page)).toBe(0);
  await page.screenshot({path:'/tmp/BUILD-012B-BORROW-REVIEW.png',fullPage:true});await execute(page);
  await expect(page.getByRole('link',{name:'Download Evidence Bundle'})).toBeVisible();expect(await supplySendCount(page)).toBe(1);
  const request=await page.evaluate(()=>{const w=window as unknown as {supplyWalletRequests:{method:string;params:unknown[]}[]};return w.supplyWalletRequests.find(r=>r.method==='eth_sendTransaction');});
  expect(request?.params[0]).not.toHaveProperty('nonce');expect(request?.params[0]).toMatchObject({to:'0x8bab6d1b75f19e9ed9fce8b9bd338844ff79ae27'});
  const href=await page.getByRole('link',{name:'Download Evidence Bundle'}).getAttribute('href');const evidence=JSON.parse(decodeURIComponent(href!.split(',')[1]!));
  expect(evidence.bundle).toMatchObject({environment:'MOCKED',outcome:'RECONCILED'});expect(evidence.publicExecution).toMatchObject({walletDelta:'10000',debtDelta:'10000',rateMode:2});
  expect(errors).toEqual([]);await page.screenshot({path:'/tmp/BUILD-012B-BORROW-MOCKED-RESULT.png',fullPage:true});
});
test('lost response recovers the same Borrow across reload without another send',async({page})=>{
  await author(page,{uncertain:'SUPPLY'});await review(page);await execute(page);
  await expect.poll(()=>supplySendCount(page)).toBe(1);await expect(page.getByRole('button',{name:'Observe existing transaction'})).toBeEnabled();
  await expect(page.getByRole('link',{name:'Download Evidence Bundle'})).toHaveCount(0);
  await page.reload();await page.getByRole('navigation',{name:'Workflow stages'}).getByRole('button',{name:'Execute',exact:true}).click();
  await page.getByRole('button',{name:'Observe existing transaction'}).click();await expect(page.getByRole('link',{name:'Download Evidence Bundle'})).toBeVisible();expect(await supplySendCount(page)).toBe(0);
});
test('owner refusal needs fresh owner Review and records no successful debt evidence',async({page})=>{
  await author(page,{reject:'SUPPLY'});await review(page);await execute(page);
  await expect(page.getByRole('region',{name:'Aave Borrow'})).toContainText('not submitted');await expect(page.getByRole('link',{name:'Download Evidence Bundle'})).toHaveCount(0);
  await page.getByRole('button',{name:'Prepare fresh review'}).click();await expect(page.getByRole('button',{name:'Accept Borrow review'})).toBeVisible();expect(await supplySendCount(page)).toBe(1);
});
test('provider pre-submission failure never requests a transaction',async({page})=>{
  await author(page,{nonceFailure:true});await review(page);await execute(page);expect(await supplySendCount(page)).toBe(0);await expect(page.getByRole('link',{name:'Download Evidence Bundle'})).toHaveCount(0);
});
test('wrong wallet chain blocks Borrow before a request',async({page})=>{
  await author(page,{chain:'0x1'});await review(page);await execute(page);await expect(page.getByRole('region',{name:'Aave Borrow'})).toContainText('Switch your wallet');expect(await supplySendCount(page)).toBe(0);
});
test('wrong wallet owner blocks Borrow before a request',async({page})=>{
  await author(page);await review(page);await page.evaluate(()=>{const w=window as unknown as {ethereum:{request:(i:{method:string})=>Promise<unknown>}};const original=w.ethereum.request;w.ethereum.request=async i=>i.method==='eth_accounts'?['0x2222222222222222222222222222222222222222']:original(i);});
  await execute(page);await expect(page.getByRole('region',{name:'Aave Borrow'})).toContainText('Select the borrower');expect(await supplySendCount(page)).toBe(0);
});
test('changed public price invalidates Review again at Execute',async({page})=>{
  await author(page);await review(page);await supplyHarnessRpc('MOCK_reset',[{balance:'0',price:'110000000'}]);await execute(page);
  await expect(page.getByRole('region',{name:'Aave Borrow'})).toContainText('changed');expect(await supplySendCount(page)).toBe(0);
});
test('semantic amount edits invalidate Borrow Review',async({page})=>{
  await author(page);await review(page);await page.getByRole('button',{name:'Build',exact:true}).click();await page.locator('.react-flow__node[data-id="node-002"] .flow-card').click();
  await openCanvasSettings(page);const form=page.getByRole('form',{name:'Edit Borrow'});await form.getByLabel('Borrow amount (USDC)').fill('0.02');await page.locator('.build-flow-surface .composer-card.active').getByRole('button',{name:'Review Borrow change'}).click();await page.getByRole('button',{name:'Apply proposal'}).click();
  await page.getByRole('navigation',{name:'Workflow stages'}).getByRole('button',{name:'Execute',exact:true}).click();await expect(page.getByRole('region',{name:'Aave Borrow'})).toContainText('The workflow changed');
  await expect(page.getByRole('region',{name:'Aave Borrow'}).getByRole('button',{name:'Execute',exact:true})).toHaveCount(0);expect(await supplySendCount(page)).toBe(0);
});
test('read-only simulation blocks unsafe Borrow before Review',async({page})=>{
  await installSupplyWallet(page);await page.goto('/');await page.getByRole('button',{name:'Add borrow',exact:true}).click();await configureCanvasAction(page,'5');await page.getByRole('button',{name:'Simular Fees'}).click(); await openSimulationDetails(page);await page.getByRole('button',{name:'Simulate Borrow',exact:true}).click();
  await expect(page.getByRole('region',{name:'Aave Borrow'})).toContainText('minimum of 2.0');await expect(page.getByRole('region',{name:'Review & Authorization',exact:true})).toContainText('Review unavailable until simulation is ready.');await expect(page.getByRole('button',{name:'Approve & Continue',exact:true})).toHaveCount(0);expect(await supplySendCount(page)).toBe(0);
});
