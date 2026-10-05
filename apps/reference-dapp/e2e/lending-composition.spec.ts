// SPDX-License-Identifier: AGPL-3.0-only
import { test,expect } from './fixtures';
import type { Page } from '@playwright/test';
import { installLendingWallet,lendingRpc,lendingSends,resetLending,LENDING_OWNER } from './lending-fixtures';
const panel=(page:Page)=>page.getByRole('region',{name:'Lending composition'});
async function author(page:Page,options:Parameters<typeof installLendingWallet>[1]={},chat=false){
  await installLendingWallet(page,options);await page.goto('/');
  if(chat){await page.locator('#mock-prompt').fill(`compose supply 0.1 USDC to Aave then borrow 0.01 USDC then swap borrowed USDC to WETH on Base Sepolia slippage 50 bps owner ${LENDING_OWNER}`);await page.getByRole('button',{name:'Send',exact:true}).click();}
  else {await expect(page.locator('.build009-wallet-info')).toContainText(LENDING_OWNER.slice(0,6));await page.getByRole('button',{name:'Add Supply → Borrow → Swap',exact:true}).click();}
  await page.getByRole('button',{name:'Apply proposal'}).click();await expect(page.locator('.react-flow__node[data-id="lending-borrow"]')).toContainText('Borrow');
  await page.getByRole('button',{name:'Simular Fees'}).click();
}
async function review(page:Page){await page.getByRole('button',{name:'Simulate lending composition',exact:true}).click();await expect(panel(page)).toContainText('Expected output:');await page.getByRole('button',{name:'Review lending composition',exact:true}).click();await page.getByRole('button',{name:'Accept composed Review'}).click();await expect(panel(page).getByRole('button',{name:'Execute pool approval',exact:true})).toBeEnabled();}
const execute=(page:Page,step:string)=>panel(page).getByRole('button',{name:`Execute ${step}`,exact:true}).click();
async function confirmed(page:Page,step:string){await execute(page,step);await expect(panel(page)).toContainText(`${step.toUpperCase().replaceAll(' ','_')}: reconciled`);}
test.beforeEach(async()=>{await resetLending();});
test.setTimeout(120_000);
test('three separate Canvas editors preserve the typed Borrow input and approvals stay in the generated plan',async({page})=>{
  await author(page);await page.getByRole('navigation',{name:'Workflow stages'}).getByRole('button',{name:'Build',exact:true}).click();
  for(const [id,title,label,value] of [
    ['lending-supply','Aave Supply','Supply amount USDC','0.2'],
    ['lending-borrow','Aave Borrow','Borrow amount USDC','0.02'],
    ['lending-swap','Uniswap Swap','Swap slippage bps','100'],
  ] as const){
    await page.locator(`.react-flow__node[data-id="${id}"]`).click();
    const form=page.getByRole('form',{name:`Edit ${title}`});await expect(form).toBeVisible();
    await form.getByRole('textbox',{name:label}).fill(value!);
    await form.getByRole('button',{name:`Review ${title} change`}).click();await page.getByRole('button',{name:'Apply proposal'}).click();
  }
  const nodes=page.locator('.react-flow__node');await expect(nodes).toHaveCount(3);
  for(const title of ['Aave Supply','Aave Borrow','Uniswap Swap'])await expect(nodes.getByText(title,{exact:true})).toBeVisible();
  const boxes=await nodes.evaluateAll(ns=>ns.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y}}));
  expect(boxes[0]!.x).toBeCloseTo(boxes[1]!.x);expect(boxes[0]!.y).toBeLessThan(boxes[1]!.y);expect(boxes[1]!.y).toBeLessThan(boxes[2]!.y);
  await page.setViewportSize({width:1180,height:900});
  await expect.poll(()=>page.getByRole('region',{name:'Workflow graph'}).evaluate(graph=>{
    const pane=graph.getBoundingClientRect();return [...graph.querySelectorAll('.react-flow__node')].every(n=>{const r=n.getBoundingClientRect();return r.top>=pane.top&&r.bottom<=pane.bottom&&r.left>=pane.left&&r.right<=pane.right;});
  })).toBe(true);
  await expect(page.getByRole('form',{name:'Edit Uniswap Swap'})).toContainText('exactly 0.02 borrowed USDC');
  await expect(page.getByRole('combobox',{name:'Swap output asset'})).toHaveValue('WETH');
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await page.getByRole('button',{name:'Simular Fees'}).click();await review(page);
  const record=await panel(page).locator('details pre').evaluate(pre=>JSON.parse(pre.textContent!).record);
  expect(record.reviews[0].workflow.nodes[2].inputs[0]).toEqual({name:'amount-in',kind:'OUTPUT_REFERENCE',value:{nodeId:'lending-borrow',outputId:'borrowed-amount'}});
  expect(record.reviews[0].fields).toMatchObject({supplyAmount:'200000',borrowAmount:'20000',slippageBps:100});
  expect(record.reviews[0].calls.map((c:{id:string})=>c.id)).toEqual(['POOL_APPROVAL','SUPPLY','BORROW','ROUTER_APPROVAL','SWAP']);
  expect(await lendingSends(page)).toBe(0);
});
test('cancelled preparation is historical, survives reload, and fresh Simulate/Review enables the current POOL_APPROVAL without requesting a transaction',async({page})=>{
  await author(page,{nonceMismatchOnce:true});await review(page);await execute(page,'pool approval');
  await expect(panel(page).getByRole('group',{name:'Historical cancelled attempts'})).toBeVisible();
  const prior=await panel(page).locator('details pre').evaluate(pre=>JSON.parse(pre.textContent!).record.id);
  expect(await lendingSends(page)).toBe(0);
  await page.reload();await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect(page.locator('.react-flow__node[data-id="lending-supply"]')).toContainText('Aave Supply');
  await page.getByRole('button',{name:'Simular Fees'}).click();
  await expect(page.getByRole('button',{name:'Simulate lending composition',exact:true})).toBeEnabled();await review(page);
  const record=await panel(page).locator('details pre').evaluate(pre=>JSON.parse(pre.textContent!).record);
  expect(record.id).toBe(prior);expect(record.attempts).toHaveLength(1);expect(record.attempts[0]).toMatchObject({state:'CANCELLED',notSubmitted:true});
  await expect(panel(page).locator('ol')).toContainText('POOL APPROVAL · NEXT EXECUTABLE STEP');
  await expect(panel(page).locator('ol')).not.toContainText('CANCELLED');
  await expect(panel(page).getByText('POOL_APPROVAL: CANCELLED',{exact:true})).toHaveCount(0);
  expect(await lendingSends(page)).toBe(0);
});
test('Canvas composition, Review and five explicit owner calls prove the MOCKED economic outcome',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await author(page);await review(page);
  await expect(panel(page)).toContainText('Current estimated L1 fee:');await expect(panel(page)).toContainText('Maximum owner-approved L1 fee:');await expect(panel(page)).toContainText('Maximum total network fee:');
  await expect(panel(page)).toContainText('Borrow / exact Swap input: 0.01 USDC');await expect(panel(page)).toContainText('Debt USDC');await expect(panel(page)).toContainText('Health factor');expect(await lendingSends(page)).toBe(0);
  for(const step of ['pool approval','supply','borrow','router approval','swap']){await execute(page,step);await expect(panel(page)).toContainText(`${step.toUpperCase().replaceAll(' ','_')}: reconciled`);}
  await expect(panel(page)).toContainText('MOCKED / RECONCILED');expect(await lendingSends(page)).toBe(5);
  const link=await page.getByRole('link',{name:'Download composed Evidence Bundle'}).getAttribute('href');const evidence=JSON.parse(decodeURIComponent(link!.split(',')[1]!));
  expect(evidence.bundle).toMatchObject({environment:'MOCKED',outcome:'RECONCILED'});expect(evidence.bundle.reconciliation.debt[0]).toMatchObject({amount:'10000'});expect(evidence.composedExecution.completed).toBe(true);
  const requests=await page.evaluate(()=>(window as unknown as {lendingRequests:{method:string;params:unknown[]}[]}).lendingRequests.filter(r=>r.method==='eth_sendTransaction'));
  expect(requests).toHaveLength(5);for(const r of requests)expect(r.params[0]).not.toHaveProperty('nonce');expect(errors).toEqual([]);
});
test('Chat produces the same finite graph and typed Borrow-to-Swap Review',async({page})=>{await author(page,{},true);await review(page);expect(await lendingSends(page)).toBe(0);await expect(panel(page)).toContainText('0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f');await expect(panel(page)).toContainText('Borrow / exact Swap input: 0.01 USDC');});
for(const setting of ['poolAvailable','swapAvailable','simulationAvailable'])test(`complete path gate blocks ${setting} before any Supply request`,async({page})=>{await author(page);await review(page);await lendingRpc('MOCK_reset',[{[setting]:false}]);await execute(page,'pool approval');expect(await lendingSends(page)).toBe(0);await expect(panel(page).getByRole('status')).toBeVisible();});
test('unsafe health factor blocks read-only simulation',async({page})=>{await author(page);await lendingRpc('MOCK_reset',[{scaledDebt:'9000000',userConfig:'3'}]);await page.getByRole('button',{name:'Simulate lending composition',exact:true}).click();await expect(panel(page).getByRole('status')).toBeVisible();expect(await lendingSends(page)).toBe(0);});
test('wrong wallet chain blocks before owner submission',async({page})=>{await author(page,{chain:'0x1'});await review(page);await execute(page,'pool approval');await expect(panel(page)).toContainText('Switch your wallet to Base Sepolia');expect(await lendingSends(page)).toBe(0);});
test('price drift invalidates authority and requires fresh Simulate and Review',async({page})=>{await author(page);await review(page);await lendingRpc('MOCK_reset',[{price:'110000000'}]);await execute(page,'pool approval');await expect(panel(page)).toContainText('Review expired or the market changed');expect(await lendingSends(page)).toBe(0);await page.getByRole('button',{name:'Fresh Simulate and Review of remaining steps'}).click();await page.getByRole('button',{name:'Accept composed Review'}).click();await confirmed(page,'pool approval');expect(await lendingSends(page)).toBe(1);});
test('lost Borrow result reloads into observation-only recovery and never sends another Borrow',async({page})=>{
  await author(page,{uncertainAt:3});await review(page);await execute(page,'pool approval');await execute(page,'supply');await execute(page,'borrow');await expect(panel(page)).toContainText('SUBMISSION_RESULT_UNKNOWN');expect(await lendingSends(page)).toBe(3);
  await page.reload();await page.getByRole('navigation',{name:'Workflow stages'}).getByRole('button',{name:'Execute',exact:true}).click();await page.getByRole('button',{name:'Observe existing execution'}).click();await expect(panel(page)).toContainText('BORROW: reconciled');expect(await lendingSends(page)).toBe(0);await expect(panel(page)).toContainText('debt: 0.01 USDC');
});
test('downstream route loss after Borrow retains debt and requires explicit fresh continuation',async({page})=>{
  await author(page);await review(page);for(const step of ['pool approval','supply','borrow'])await confirmed(page,step);await lendingRpc('MOCK_patch',[{swapAvailable:false}]);await execute(page,'router approval');await expect(panel(page).getByRole('status')).toBeVisible();expect(await lendingSends(page)).toBe(3);await page.getByRole('button',{name:'Observe existing execution'}).click();await expect(panel(page)).toContainText('debt: 0.01 USDC');await expect(panel(page)).toContainText('Borrow has completed');await expect(panel(page)).toContainText('Partial execution evidence');
  await lendingRpc('MOCK_patch',[{swapAvailable:true}]);await page.getByRole('button',{name:'Fresh Simulate and Review of remaining steps'}).click();await page.getByRole('button',{name:'Accept composed Review'}).click();await confirmed(page,'router approval');await confirmed(page,'swap');expect(await lendingSends(page)).toBe(5);await expect(panel(page)).toContainText('MOCKED / RECONCILED');
});
test('wallet disconnect after handoff stays observation-only, including reload',async({page})=>{await author(page,{disconnectedAt:1});await review(page);await execute(page,'pool approval');await expect(panel(page)).toContainText('SUBMISSION_RESULT_UNKNOWN');await page.getByRole('button',{name:'Observe existing execution'}).click();expect(await lendingSends(page)).toBe(1);await expect(panel(page).getByRole('button',{name:'Execute pool approval',exact:true})).toHaveCount(0);});
test('minimum-output violation blocks before any owner request',async({page})=>{await author(page);await review(page);await lendingRpc('MOCK_patch',[{quoteBps:'9800'}]);await execute(page,'pool approval');await expect(panel(page)).toContainText('cannot meet the reviewed minimum output');expect(await lendingSends(page)).toBe(0);});
test('failed Swap retains USDC debt and router allowance without a second attempt',async({page})=>{await author(page,{revertAt:5});await review(page);for(const step of ['pool approval','supply','borrow','router approval'])await confirmed(page,step);await execute(page,'swap');await expect(panel(page)).toContainText('SWAP: REVERTED');await expect(panel(page)).toContainText('debt: 0.01 USDC');await expect(panel(page)).toContainText('router 0.01 USDC');expect(await lendingSends(page)).toBe(5);await page.getByRole('button',{name:'Observe existing execution'}).click();await expect(panel(page)).toContainText('MOCKED / DIVERGENT');expect(await lendingSends(page)).toBe(5);await expect(panel(page).getByRole('button',{name:'Execute swap',exact:true})).toHaveCount(0);});
test('duplicate Execute clicks submit one approval',async({page})=>{await author(page);await review(page);await panel(page).getByRole('button',{name:'Execute pool approval',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});await expect(panel(page)).toContainText('POOL_APPROVAL: reconciled');expect(await lendingSends(page)).toBe(1);});
test('accepted economic edits retire prior authority until new simulation and Review',async({page})=>{await author(page);await review(page);await page.getByRole('navigation',{name:'Workflow stages'}).getByRole('button',{name:'Build',exact:true}).click();await page.locator('#mock-prompt').fill(`compose supply 0.1 USDC to Aave then borrow 0.02 USDC then swap borrowed USDC to WETH on Base Sepolia slippage 50 bps owner ${LENDING_OWNER}`);await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByRole('button',{name:'Apply proposal'}).click();await page.getByRole('navigation',{name:'Workflow stages'}).getByRole('button',{name:'Execute',exact:true}).click();await expect(panel(page)).toContainText('The workflow changed');await expect(panel(page).getByRole('button',{name:'Execute pool approval',exact:true})).toHaveCount(0);expect(await lendingSends(page)).toBe(0);});
