// SPDX-License-Identifier: AGPL-3.0-only
import {test,expect} from './fixtures';
import {installSupplyWallet,resetSupplyHarness,authorSupply,reviewSupply,supplySendCount} from './supply-fixtures';
test.afterEach(async({page},info)=>{if(info.status!==info.expectedStatus){const detail=await page.getByRole('region',{name:'Aave Supply'}).locator('pre').textContent(); console.error('Supply failure:',detail?JSON.parse(detail).error:'no details');}});
for(const step of ['APPROVAL','SUPPLY'] as const)test('restart observes uncertain '+step+' without a duplicate wallet submission',async({page})=>{
  await resetSupplyHarness(step==='SUPPLY'?{allowance:'10000000'}:{});await installSupplyWallet(page,{uncertain:step});await authorSupply(page);await reviewSupply(page);
  await page.getByRole('region',{name:'Aave Supply'}).getByRole('button',{name:'Execute',exact:true}).click();await expect(page.getByRole('button',{name:'Observe existing transaction'})).toBeVisible();expect(await supplySendCount(page)).toBe(1);
  await page.reload();await page.getByRole('navigation',{name:'Workflow stages'}).getByRole('button',{name:'Execute',exact:true}).click();
  await page.getByRole('button',{name:'Observe existing transaction'}).click();
  if(step==='APPROVAL'){await expect(page.getByText('Approval: Independently verified',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Execute Supply',exact:true})).toBeVisible();}
  else await expect(page.getByRole('link',{name:'Download Evidence Bundle'})).toBeVisible();
  expect(await supplySendCount(page)).toBe(0);
});

test('restart preserves a reverted approval and never requests it again',async({page})=>{
  await resetSupplyHarness({revert:true});await installSupplyWallet(page);await authorSupply(page);await reviewSupply(page);
  await page.getByRole('region',{name:'Aave Supply'}).getByRole('button',{name:'Execute',exact:true}).click();
  await expect(page.getByText('Approval: reverted',{exact:false})).toBeVisible();expect(await supplySendCount(page)).toBe(1);
  await page.reload();await page.getByRole('navigation',{name:'Workflow stages'}).getByRole('button',{name:'Execute',exact:true}).click();
  await expect(page.getByText('Approval: reverted',{exact:false})).toBeVisible();await expect(page.getByRole('link',{name:'Download Evidence Bundle'})).toHaveCount(0);expect(await supplySendCount(page)).toBe(0);
});
