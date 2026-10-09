// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, type Page } from '@playwright/test';
import { assertConnectedFlow } from './connected-flow-assertions';

const enabled = process.env.FLOFI_MOTION_EXPECT_ENABLED !== 'false';
const evidence = 'e2e/visual-evidence/final-visual-refinement';
const capture = !!process.env.FLOFI_MOTION_EVIDENCE;
const failures = new WeakMap<Page, string[]>();

test.beforeEach(async ({ context, page, baseURL }) => {
  const errors: string[] = [];
  failures.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || /hydration|did not match/i.test(message.text())) errors.push(message.text());
  });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === new URL(baseURL!).origin) return route.continue();
    errors.push(`Unexpected external request: ${route.request().url()}`);
    return route.abort();
  });
  await page.addInitScript(() => sessionStorage.setItem('flofi-alive-intro-v1', 'seen'));
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // Wait for the measured client diagram before tests mutate its DOM or resize it.
  await expect(page.locator('[data-flow-diagram="light"]')).toHaveAttribute('data-flow-ready', 'true');

});

test.afterEach(async ({ page }) => { expect(failures.get(page)).toEqual([]); });

for (const width of [320, 375, 390, 430, 768, 900, 901, 1024, 1440, 1920]) {
  test(`retained infrastructure stays connected and readable at ${width}px in EN/PT`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    if (capture && [390, 1440].includes(width)) {
      await page.locator('#workflow').screenshot({ path: `${evidence}/hero-${width}.png` });
    }
    for (const locale of ['en', 'pt']) {
      await page.getByRole('button', { name: locale.toUpperCase(), exact: true }).click();
      for (const [variant, destinations, section] of [['light', 2, '#developers']] as const) {
        const diagram = page.locator(`[data-flow-diagram="${variant}"]`);
        await diagram.scrollIntoViewIfNeeded();
        await expect.poll(async () => {
          try { await assertConnectedFlow(diagram, destinations); return true; } catch { return false; }
        }).toBe(true);
        const nodes = diagram.locator('[data-flow-source], [data-flow-core], [data-flow-destination]');
        for (const node of await nodes.all()) {
          await expect(node).toBeVisible();
          // Exterior ports deliberately extend beyond a card; its content must fit inside.
          const overflowing = await node.evaluate(element => {
            const box = element.getBoundingClientRect();
            return [...element.children].filter(child => !child.hasAttribute('data-flow-port')).filter(child => {
              const content = child.getBoundingClientRect();
              return content.left < box.left - 1 || content.right > box.right + 1;
            }).map(child => child.textContent);
          });
          expect(overflowing).toEqual([]);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (capture && locale === 'en') {
          await expect.poll(() => diagram.evaluate(element => [...element.getAnimations(), ...element.parentElement!.getAnimations()].every(animation => animation.playState === 'finished'))).toBe(true);
          await diagram.screenshot({ path: `${evidence}/${variant}-diagram-${width}.png` });
          if ([390, 1440].includes(width)) await page.locator(section).screenshot({ path: `${evidence}/${variant}-section-${width}.png` });
        }
      }
      await expect(page.getByRole('button', { name: /pause motion|resume motion|pausar animações|retomar animações/i })).toHaveCount(0);
      await expect(page.locator('[data-mascot-journey] button')).toHaveCount(0);
      await expect(page.locator('[data-story-phase="Review"]')).toContainText(locale === 'en' ? 'Your explicit approval' : 'Sua aprovação explícita');
      await expect(page.locator('[data-story-phase="Execute"]')).toContainText(locale === 'en' ? 'Your wallet signature' : 'Assinatura da sua carteira');
      await expect(page.getByRole('button', { name: /Authorize workflow|Autorizar fluxo/ })).toHaveCount(0);
    }
  });
}

test('geometry follows live resizing, changing card dimensions and transformed SVG coordinates', async ({ page }) => {
  const light = page.locator('[data-flow-diagram="light"]');
  await light.scrollIntoViewIfNeeded();
  await light.evaluate(element => { element.style.transform = 'translate(7px, 3px) scale(.94)'; });
  await light.locator('[data-flow-source="wallet"]').evaluate(element => { element.style.paddingBlock = '28px'; });
  await expect.poll(async () => { try { await assertConnectedFlow(light); return true; } catch { return false; } }).toBe(true);
  for (const width of [900, 901, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(async () => { try { await assertConnectedFlow(light); return true; } catch { return false; } }).toBe(true);
  }
});

test('retained infrastructure honors live reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (enabled) await expect(page.locator('[data-mascot-motion]')).toHaveAttribute('data-alive', 'still');
  expect(await page.locator('[data-flow-signal]').evaluateAll(items => items.flatMap(item => item.getAnimations()).length)).toBe(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const diagram = page.locator('[data-flow-diagram="light"]');
    await diagram.scrollIntoViewIfNeeded();
    await assertConnectedFlow(diagram);
    if (capture) await diagram.screenshot({ path: `${evidence}/light-reduced-motion-${width}.png` });
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  if (enabled) await expect(page.locator('[data-mascot-motion]')).toHaveAttribute('data-alive', 'running');
});

test('connector signals are finite illustrative accents', async ({ page }) => {
  test.skip(!enabled, 'Configuration disables the new motion.');
  const diagram = page.locator('[data-flow-diagram="light"]');
  await diagram.scrollIntoViewIfNeeded();
  await expect(diagram).toHaveAttribute('data-flow-visible', 'true');
  const signals = diagram.locator('[data-flow-signal]');
  const timing = await signals.evaluateAll(elements => elements.flatMap(element => element.getAnimations().map(animation => animation.effect!.getTiming())));
  expect(timing).toHaveLength(2);
  expect(timing.every(value => value.iterations === 1)).toBe(true);
  await expect(page.locator('[data-story-phase="Review"]')).toContainText('Your explicit approval');
  await expect(page.locator('[data-story-phase="Execute"]')).toContainText('Your wallet signature');
});
