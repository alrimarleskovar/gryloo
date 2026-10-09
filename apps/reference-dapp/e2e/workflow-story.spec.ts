// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from '@playwright/test';

for (const width of [320, 375, 390, 430, 768, 1440]) {
  test(`three-phase story scrolls freely in EN/PT at ${width}px`, async ({ page, context, baseURL }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', event => { if (event.type() === 'error' || /hydration|did not match/i.test(event.text())) errors.push(event.text()); });
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL!).origin ? route.continue() : route.abort());
    await page.addInitScript(() => sessionStorage.setItem('flofi-alive-intro-v1', 'seen'));
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    const story = page.locator('#workflow');
    const cards = story.locator('[data-story-phase]');
    const enabled = process.env.FLOFI_MOTION_EXPECT_ENABLED !== 'false';
    for (const locale of ['en', 'pt']) {
      if (locale === 'pt') await page.getByRole('button', { name: 'PT', exact: true }).click();
      expect(await cards.evaluateAll(items => items.map(item => item.getAttribute('data-story-phase')))).toEqual(['Build', 'Review', 'Execute']);
      await expect(story.locator('[aria-hidden="true"] h3')).toHaveCount(0);
      await expect(story.locator('[data-story-stage], [data-story-panel]')).toHaveCount(0);
      const layout = await story.evaluate(element => ({ height: element.getBoundingClientRect().height, pinned: [...element.querySelectorAll('*')].filter(item => ['sticky', 'fixed'].includes(getComputedStyle(item).position)).length }));
      expect(layout.pinned).toBe(0); expect(layout.height).toBeLessThan(width >= 1024 ? 1100 : 2000);
      for (const name of ['Chat', 'Canvas', 'GPT', 'Claude', 'WhatsApp', 'Telegram']) await expect(cards.first()).toContainText(name);
      await cards.first().scrollIntoViewIfNeeded();
      await expect.poll(() => cards.first().locator('[data-channel-icon] img').evaluateAll(images => images.every(element => {
        const image = element as HTMLImageElement;
        return image.complete && image.naturalWidth > 0;
      }))).toBe(true);
      await expect(cards.first().locator('[data-channel-icon]')).toHaveCount(6);
      await expect(cards.first().locator('[data-channel-icon] svg')).toHaveCount(2);
      await expect(cards.first().locator('[data-channel-icon] img')).toHaveCount(4);
      expect(await cards.first().locator('[data-channel-icon]').evaluateAll(icons => icons.every(icon => {
        const rect = icon.getBoundingClientRect(), pill = icon.parentElement!.getBoundingClientRect();
        const image = icon.querySelector('img');
        return rect.width === 20 && rect.height === 20 && rect.left >= pill.left && rect.right <= pill.right
          && (!image || (image.complete && image.naturalWidth > 0 && new URL(image.src).origin === location.origin));
      }))).toBe(true);
      await expect(cards.nth(1)).toContainText('Strategy Manifest');
      await expect(cards.nth(1)).toContainText(locale === 'en' ? 'Your explicit approval' : 'Sua aprovação explícita');
      await expect(cards.nth(2)).toContainText(locale === 'en' ? 'Your wallet signature' : 'Assinatura da sua carteira');
      await expect(cards.nth(2)).toContainText(locale === 'en' ? 'Tracking & reconciliation' : 'Acompanhamento e reconciliação');
      for (const card of await cards.all()) {
        await card.scrollIntoViewIfNeeded(); await expect(card).toBeVisible();
        await expect(card).toHaveAttribute('data-story-seen', 'true');
        if (enabled) {
          await expect(card.locator('[data-mascot-local] [data-mascot-character]')).toBeVisible();
          await expect.poll(() => card.locator('[data-mascot-body]').evaluate(element => element.getAnimations().every(animation => animation.playState === 'finished'))).toBe(true);
        }
      }
      const entranceTimes = enabled ? await story.locator('[data-mascot-body]').evaluateAll(items => items.flatMap(item => item.getAnimations().map(animation => animation.startTime))) : [];
      await story.evaluate(element => scrollTo({ top: scrollY + element.getBoundingClientRect().top, behavior: 'instant' }));
      await page.mouse.move(width / 2, 450);
      const before = await page.evaluate(() => scrollY);
      await page.mouse.wheel(0, 600);
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before + 550);
      await page.locator('#review').scrollIntoViewIfNeeded(); await expect(page.locator('#review')).toBeInViewport();
      if (enabled) expect(await story.locator('[data-mascot-body]').evaluateAll(items => items.flatMap(item => item.getAnimations().map(animation => animation.startTime)))).toEqual(entranceTimes);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (process.env.FLOFI_STORY_EVIDENCE) {
        await story.scrollIntoViewIfNeeded();
        await story.screenshot({ path: `e2e/visual-evidence/three-step-story/story-${locale}-${width}.png` });
      }
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await story.scrollIntoViewIfNeeded();
    expect(await story.locator('*').evaluateAll(items => items.flatMap(item => item.getAnimations()).length)).toBe(0);
    await expect(cards).toHaveCount(3);
    await expect(page.getByRole('button', { name: /pause motion|resume motion/i })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
