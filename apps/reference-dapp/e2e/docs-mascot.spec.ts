// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from '@playwright/test';

for (const width of [320, 375, 390, 430, 768, 1440]) {
  test(`official Docs mascot moves without disrupting reading at ${width}px`, async ({ page, context, baseURL }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', event => { if (event.type() === 'error' || /hydration|did not match/i.test(event.text())) errors.push(event.text()); });
    page.on('response', response => { if (response.url().includes('/brand/') && response.status() >= 400) errors.push(`Asset ${response.status()}: ${response.url()}`); });
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL!).origin ? route.continue() : route.abort());
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/docs');
    await page.evaluate(() => document.fonts.ready);
    const scene = page.locator('[data-docs-mascot]');
    await scene.scrollIntoViewIfNeeded();
    await expect(scene).toHaveAttribute('data-docs-mascot-active', 'true');
    const body = scene.locator('[data-mascot-body]');
    await expect.poll(() => body.evaluate(element => element.getAnimations().some(animation => animation.playState === 'running'))).toBe(true);
    const bounds = await scene.boundingBox();
    const first = await body.evaluate(element => getComputedStyle(element).transform);
    await page.waitForTimeout(300);
    expect(await body.evaluate(element => getComputedStyle(element).transform)).not.toBe(first);
    if (process.env.FLOFI_DOCS_MASCOT_EVIDENCE) await page.screenshot({ path: `e2e/visual-evidence/docs-mascot/docs-entrance-${width}.png` });
    await expect.poll(() => body.evaluate(element => element.getAnimations().every(animation => animation.playState === 'finished'))).toBe(true);
    expect(await scene.boundingBox()).toEqual(bounds); // All travel is inside the fixed illustration frame.
    const settledTime = await body.evaluate(element => element.getAnimations()[0]?.currentTime);
    const float = body.locator('..').locator('..');
    const idle = await float.evaluate(element => getComputedStyle(element).transform);
    await page.waitForTimeout(600);
    expect(await float.evaluate(element => getComputedStyle(element).transform)).not.toBe(idle);
    const hero = scene.locator('..');
    await hero.getByRole('link', { name: /Get started/ }).hover();
    await expect.poll(() => body.evaluate(element => element.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(1);
    await page.waitForTimeout(1700);
    await hero.getByRole('link', { name: /Explore the API/ }).focus();
    await expect.poll(() => body.evaluate(element => element.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(1);
    await page.waitForTimeout(1700);
    await page.getByRole('button', { name: 'Search documentation', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Search documentation' })).toBeVisible();
    await expect.poll(() => body.evaluate(element => element.getAnimations().some(animation => animation.playState === 'running'))).toBe(true);
    await page.keyboard.press('Escape');
    for (const theme of ['light', 'dark']) {
      const root = page.locator('[data-docs-theme]');
      if (await root.evaluate(element => getComputedStyle(element).colorScheme) !== theme) await page.getByRole('button', { name: `Switch to ${theme} theme` }).click();
      await expect(scene.locator(`img[src$="flofi-symbol-${theme === 'dark' ? 'dark' : 'light'}.svg"]`)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (process.env.FLOFI_DOCS_MASCOT_EVIDENCE) await page.screenshot({ path: `e2e/visual-evidence/docs-mascot/docs-${theme}-${width}.png` });
    }
    await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await expect(scene).toHaveAttribute('data-docs-mascot-active', 'false');
    const orbit = scene.locator('span').filter({ has: page.locator('i') });
    await expect.poll(() => orbit.evaluate(element => element.getAnimations()[0]?.playState)).toBe('paused');
    const time = await orbit.evaluate(element => element.getAnimations()[0]?.currentTime);
    await page.waitForTimeout(250);
    expect(await orbit.evaluate(element => element.getAnimations()[0]?.currentTime)).toBe(time);
    await scene.scrollIntoViewIfNeeded();
    await expect(scene).toHaveAttribute('data-docs-mascot-active', 'true');
    // Pausing CSS animations can change startTime; the completed intro must stay at its final time.
    expect(await body.evaluate(element => element.getAnimations()[0]?.currentTime)).toBe(settledTime);
    if (width === 1440) {
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await expect(scene).toHaveAttribute('data-docs-mascot-active', 'false');
      await expect.poll(() => orbit.evaluate(element => element.getAnimations()[0]?.playState)).toBe('paused');
      await page.evaluate(() => { Reflect.deleteProperty(document, 'hidden'); document.dispatchEvent(new Event('visibilitychange')); });
      await expect(scene).toHaveAttribute('data-docs-mascot-active', 'true');
    }
    const header = page.locator('header').first();
    await header.evaluate(element => element.setAttribute('data-persistence-check', 'same-header'));
    const sidebar = page.getByRole('complementary').first();
    if (width > 900) await sidebar.evaluate(element => element.setAttribute('data-persistence-check', 'same-sidebar'));
    await hero.getByRole('link', { name: /Get started/ }).click();
    await expect(page).toHaveURL(/\/docs\/getting-started$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Getting Started' })).toBeVisible();
    await expect(header).toHaveAttribute('data-persistence-check', 'same-header');
    if (width > 900) await expect(sidebar).toHaveAttribute('data-persistence-check', 'same-sidebar');
    await expect(page.locator('[data-docs-mascot]')).toHaveCount(0);
    expect(await page.locator('[data-docs-article-transition]').evaluate(element => element.getAnimations().length)).toBe(1);
    await expect.poll(() => page.locator('[data-docs-article-transition]').evaluate(element => element.getAnimations().every(animation => animation.playState === 'finished'))).toBe(true);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/docs'); await scene.scrollIntoViewIfNeeded();
    await expect(scene).toHaveAttribute('data-docs-mascot-active', 'false');
    expect(await page.locator('main').evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
    await hero.getByRole('link', { name: /Get started/ }).hover();
    expect(await body.evaluate(element => element.getAnimations().length)).toBe(0);
    await expect(page.getByRole('button', { name: /pause motion/i })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
