// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from '@playwright/test';

const evidence = 'e2e/visual-evidence/native-docs-earth';
const capture = !!process.env.FLOFI_DOCS_EVIDENCE;
for (const width of [1440, 390]) {
  test(`planet surface visibly moves at 0, 5 and 10 seconds at ${width}px independently of mascot`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); page.on('console', event => { if (event.type() === 'error' || /hydration|did not match/i.test(event.text())) errors.push(event.text()); });
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => sessionStorage.setItem('flofi-alive-intro-v1', 'seen'));
    await page.goto('/'); await page.evaluate(() => document.fonts.ready);
    if (process.env.FLOFI_MOTION_EXPECT_ENABLED === 'false') {
      await expect(page.locator('[data-mascot-motion="true"]')).toHaveCount(0);
      await expect(page.locator('[data-mascot-journey]')).toHaveCount(0);
    } else if (process.env.FLOFI_MOTION_EXPECT_ENABLED === 'true') await expect(page.locator('[data-mascot-motion]')).toHaveAttribute('data-mascot-motion', 'true');
    await page.locator('#about').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-earth]')).toHaveAttribute('data-earth-active', 'true');
    await expect.poll(() => page.locator('#about [data-flow-diagram]').evaluate(element => element.parentElement!.getAnimations().every(animation => animation.playState === 'finished'))).toBe(true);
    const surface = page.locator('[data-earth-surface]');
    await expect(page.locator('[data-earth-original]')).toHaveAttribute('href', '/flofi/closing-horizon-v2.png');
    const initial = await surface.evaluate(element => ({ time: Number(element.getAnimations()[0]!.currentTime), transform: getComputedStyle(element).transform }));
    for (const seconds of [0, 5, 10]) {
      if (seconds) await expect.poll(() => surface.evaluate((element, time) => Number(element.getAnimations()[0]!.currentTime) - time, initial.time), { timeout: 13000, intervals: [100, 200] }).toBeGreaterThanOrEqual(seconds * 1000);
      if (capture) await page.locator('#about').screenshot({ path: `${evidence}/earth-${width}-t${seconds}.png` });
    }
    const movement = await surface.evaluate((element, transform) => { const a = new DOMMatrix(transform), b = new DOMMatrix(getComputedStyle(element).transform); return { distance: Math.hypot(a.e - b.e, a.f - b.f), matrix: [b.a,b.b,b.c,b.d], duration: element.getAnimations()[0]!.effect!.getTiming().duration }; }, initial.transform);
    expect(movement.distance).toBeGreaterThan(40); expect(movement.matrix).toEqual([1,0,0,1]); expect(movement.duration).toBe(60000);
    expect(await page.locator('[data-earth-original]').evaluate(element => element.getAnimations().length)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: /pause motion/i })).toHaveCount(0);
    // Visibility handler pauses and resumes the same clock, rather than recreating a cycle.
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(page.locator('[data-earth]')).toHaveAttribute('data-earth-active', 'false');
    expect(await surface.evaluate(element => element.getAnimations()[0]!.playState)).toBe('paused');
    const paused = await surface.evaluate(element => Number(element.getAnimations()[0]!.currentTime));
    await page.evaluate(() => { Reflect.deleteProperty(document, 'hidden'); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(page.locator('[data-earth]')).toHaveAttribute('data-earth-active', 'true');
    expect(await surface.evaluate(element => Number(element.getAnimations()[0]!.currentTime))).toBeGreaterThanOrEqual(paused);
    await page.evaluate(() => scrollTo(0,0)); await expect(page.locator('[data-earth]')).toHaveAttribute('data-earth-active', 'false');
    await page.locator('#about').scrollIntoViewIfNeeded(); await expect(page.locator('[data-earth]')).toHaveAttribute('data-earth-active', 'true');
    expect(await surface.evaluate(element => Number(element.getAnimations()[0]!.currentTime))).toBeGreaterThanOrEqual(paused);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await surface.evaluate(element => element.getAnimations().length)).toBe(0);
    expect(await surface.evaluate(element => getComputedStyle(element).opacity)).toBe('0');
    if (capture) await page.locator('#about').screenshot({ path: `${evidence}/earth-${width}-reduced.png` });
    await page.emulateMedia({ reducedMotion: 'no-preference' }); await expect.poll(() => surface.evaluate(element => element.getAnimations().length)).toBe(1);
    expect(errors).toEqual([]);
  });
}
