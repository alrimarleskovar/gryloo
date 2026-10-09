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

});

test.afterEach(async ({ page }) => { expect(failures.get(page)).toEqual([]); });

for (const width of [320, 375, 390, 430, 768, 900, 901, 1024, 1440]) {
  test(`both diagrams stay connected and readable at ${width}px in EN/PT`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    if (capture && [390, 1440].includes(width)) {
      await expect.poll(() => page.locator('[data-hero-stage]').evaluate(element => element.getAnimations().every(animation => animation.playState === 'finished'))).toBe(true);
      await page.locator('#product').screenshot({ path: `${evidence}/hero-${width}.png` });
    }
    for (const locale of ['en', 'pt']) {
      await page.getByRole('button', { name: locale.toUpperCase(), exact: true }).click();
      for (const [variant, destinations, section] of [['light', 2, '#developers'], ['dark', 1, '#about']] as const) {
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
      await expect(page.getByRole('button', { name: locale === 'en' ? 'Authorize workflow' : 'Autorizar fluxo', exact: true })).toBeDisabled();
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
    await assertConnectedFlow(page.locator('[data-flow-diagram="dark"]'), 1);
  }
});

test('original Earth moves subtly over time, sleeps offscreen and respects live reduced motion', async ({ page }) => {
  const earth = page.locator('[data-earth-surface]');
  await page.locator('#about').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-earth]')).toHaveAttribute('data-earth-active', 'true');
  expect(await earth.evaluate(element => getComputedStyle(element).backgroundImage)).toContain('/flofi/closing-horizon-v2.png');
  if (!enabled) {
    expect(await earth.evaluate(element => element.getAnimations().length)).toBe(0);
    return;
  }
  await expect.poll(() => earth.evaluate(element => element.getAnimations().length)).toBe(1);
  await expect(page.locator('#about')).toHaveAttribute('data-visible', 'true');
  await expect.poll(() => page.locator('[data-flow-diagram="dark"]').evaluate(element => element.parentElement!.getAnimations().every(animation => animation.playState === 'finished'))).toBe(true);
  const first = await earth.evaluate(element => ({ transform: getComputedStyle(element).transform, time: element.getAnimations()[0]!.currentTime }));
  expect(await earth.evaluate(element => element.getAnimations()[0]!.effect!.getTiming().duration)).toBe(48000);
  if (capture) await page.locator('#about').screenshot({ path: `${evidence}/earth-t0-1440.png` });
  // Wait for eight seconds on the real animation clock; screenshot scroll/visibility can briefly pause it.
  await expect.poll(() => earth.evaluate((element, initial) => Number(element.getAnimations()[0]!.currentTime) - initial, Number(first.time)), { timeout: 12000, intervals: [200, 500] }).toBeGreaterThanOrEqual(8000);
  const second = await earth.evaluate(element => ({ transform: getComputedStyle(element).transform, time: element.getAnimations()[0]!.currentTime }));
  expect(second.transform).not.toBe(first.transform);
  expect(Number(second.time) - Number(first.time)).toBeGreaterThanOrEqual(8000);
  const displacement = await earth.evaluate((element, initial) => {
    const a = new DOMMatrix(initial); const b = new DOMMatrix(getComputedStyle(element).transform);
    return { distance: Math.hypot(b.m41 - a.m41, b.m42 - a.m42), scale: [b.a, b.b, b.c, b.d] };
  }, first.transform);
  expect(displacement.distance).toBeGreaterThan(1);
  expect(displacement.distance).toBeLessThan(15);
  expect(displacement.scale).toEqual([1, 0, 0, 1]);
  if (capture) await page.locator('#about').screenshot({ path: `${evidence}/earth-t8-1440.png` });
  await page.evaluate(() => scrollTo(0, 0));
  await expect(page.locator('[data-earth]')).toHaveAttribute('data-earth-active', 'false');
  expect(await earth.evaluate(element => getComputedStyle(element).animationPlayState)).toBe('paused');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('[data-mascot-motion]')).toHaveAttribute('data-alive', 'still');
  expect(await earth.evaluate(element => element.getAnimations().length)).toBe(0);
  expect(await page.locator('[data-flow-signal]').evaluateAll(items => items.flatMap(item => item.getAnimations()).length)).toBe(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('#about').scrollIntoViewIfNeeded();
    if (capture) {
      await page.locator('#about').screenshot({ path: `${evidence}/reduced-motion-${width}.png` });
      await page.locator('[data-flow-diagram="light"]').screenshot({ path: `${evidence}/light-reduced-motion-${width}.png` });
    }
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('[data-mascot-motion]')).toHaveAttribute('data-alive', 'running');
  await expect.poll(() => earth.evaluate(element => element.getAnimations().length)).toBe(1);
  // Mobile uses a smaller amplitude and the same duration, with no scale or spinning.
  expect(await earth.evaluate(element => getComputedStyle(element).animationName)).toContain('earthOrbitMobile');
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
  await expect(page.getByRole('button', { name: 'Authorize workflow', exact: true })).toBeDisabled();
});
