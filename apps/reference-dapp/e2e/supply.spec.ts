// SPDX-License-Identifier: AGPL-3.0-only
import {test,expect} from './fixtures';
import {installSupplyWallet,resetSupplyHarness,authorSupply,reviewSupply,supplySendCount} from './supply-fixtures';
test.afterEach(async({page},info)=>{if(info.status!==info.expectedStatus){const detail=await page.getByRole('region',{name:'Aave Supply'}).locator('pre').textContent(); console.error('Supply failure:',detail?JSON.parse(detail).error:'no details');}});
test.beforeEach(async()=>{await resetSupplyHarness();});
test('canonical Build → Supply → Simulate → Review → Execute through injected wallet',async({page})=>{
  const pageErrors:string[]=[];page.on('pageerror',error=>pageErrors.push(error.message));
  await installSupplyWallet(page);await authorSupply(page);await expect(page.locator('.react-flow__node[data-id="node-002"]')).toContainText('10 USDC · Base Sepolia');
  await reviewSupply(page);expect(await supplySendCount(page)).toBe(0);
  await page.screenshot({path:'/tmp/BUILD-012A-SUPPLY-REVIEW.png',fullPage:true});
  await page.getByRole('region',{name:'Aave Supply'}).getByRole('button',{name:'Execute',exact:true}).click();await expect(page.getByRole('button',{name:'Execute Supply',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Execute Supply',exact:true}).click();await expect(page.getByRole('link',{name:'Download Evidence Bundle'})).toBeVisible();
  expect(await supplySendCount(page)).toBe(2);expect(pageErrors).toEqual([]);
  await page.screenshot({path:'/tmp/BUILD-012A-SUPPLY-RECONCILED-MOCKED.png',fullPage:true});
  const href=await page.getByRole('link',{name:'Download Evidence Bundle'}).getAttribute('href');
  const evidence=JSON.parse(decodeURIComponent(href!.split(',')[1]!)) as {bundle:{environment:string;outcome:string}};
  expect(evidence.bundle).toMatchObject({environment:'MOCKED',outcome:'RECONCILED'});
  await expect(page.getByRole('region',{name:'Aave Supply'}).getByRole('button',{name:'Execute',exact:true})).toHaveCount(0);
});
test('sufficient real allowance uses one Supply request and no approval',async({page})=>{
  await resetSupplyHarness({allowance:'10000000'});await installSupplyWallet(page);await authorSupply(page);await reviewSupply(page);
  await page.getByRole('region',{name:'Aave Supply'}).getByRole('button',{name:'Execute',exact:true}).click();await expect(page.getByRole('link',{name:'Download Evidence Bundle'})).toBeVisible();expect(await supplySendCount(page)).toBe(1);
});
test('semantic edit invalidates reviewed authorization',async({page})=>{
  await installSupplyWallet(page);await authorSupply(page);await reviewSupply(page);await page.getByRole('button',{name:'Build',exact:true}).click();
  await page.locator('.react-flow__node[data-id="node-002"] .flow-card').click();const form=page.getByRole('form',{name:'Edit Supply'});
  await form.getByLabel('Supply amount (USDC)').fill('11');await form.getByRole('button',{name:'Review Supply change'}).click();await page.getByRole('button',{name:'Apply proposal'}).click();
  await page.getByRole('navigation',{name:'Workflow stages'}).getByRole('button',{name:'Execute',exact:true}).click();await expect(page.getByText('The workflow changed.',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Execute',exact:true})).toHaveCount(1); // navigation only
  expect(await supplySendCount(page)).toBe(0);
});

for(const kind of ['wrong chain','wrong account','approval rejected','Supply rejected'] as const)test(kind+' fails closed',async({page})=>{
  await installSupplyWallet(page,kind==='wrong chain'?{chain:'0x1'}:kind==='wrong account'?{account:'0x2222222222222222222222222222222222222222',connected:false}:kind==='approval rejected'?{reject:'APPROVAL'}:{reject:'SUPPLY'});
  await authorSupply(page);await reviewSupply(page);await page.getByRole('region',{name:'Aave Supply'}).getByRole('button',{name:'Execute',exact:true}).click();
  if(kind==='Supply rejected'){await expect(page.getByRole('button',{name:'Execute Supply',exact:true})).toBeVisible();await page.getByRole('button',{name:'Execute Supply',exact:true}).click();}
  await expect(page.getByRole('status').filter({hasText:/Switch your wallet|Select the wallet|declined/})).toBeVisible();await expect(page.getByRole('link',{name:'Download Evidence Bundle'})).toHaveCount(0);
  expect(await supplySendCount(page)).toBe(kind==='Supply rejected'?2:kind==='approval rejected'?1:0);
});

test('pending wallet signature freezes semantic authoring until the owner responds',async({page})=>{
  await installSupplyWallet(page,{pause:'APPROVAL'});await authorSupply(page);await reviewSupply(page);
  const build=await page.getByRole('button',{name:'Build',exact:true}).boundingBox();if(!build)throw new Error('Build navigation missing');
  await page.getByRole('region',{name:'Aave Supply'}).getByRole('button',{name:'Execute',exact:true}).click();
  await expect(page.locator('[data-supply-wallet-pending="true"]')).toHaveAttribute('inert','');
  await page.mouse.click(build.x+build.width/2,build.y+build.height/2);await page.keyboard.press('Control+z');
  await expect(page.locator('.summary-bar[data-workflow-revision="1"]')).toHaveCount(1);
  await page.evaluate(()=>{const w=window as unknown as {releaseSupplyWalletRequest:()=>void};w.releaseSupplyWalletRequest();});
  await expect(page.getByRole('button',{name:'Execute Supply',exact:true})).toBeVisible();expect(await supplySendCount(page)).toBe(1);
});
