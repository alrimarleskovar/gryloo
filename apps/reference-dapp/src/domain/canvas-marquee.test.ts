// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { canvasMarquee, marqueeIntersects } from './canvas-marquee';

describe('canvas marquee coordinates', () => {
  const bounds = { left: 140, top: 320, right: 540, bottom: 720 };
  it('places the rectangle under client coordinates despite page and container offsets', () => {
    expect(canvasMarquee(bounds, { x: 170, y: 360 }, { x: 290, y: 480 }))
      .toEqual({ left: 30, top: 40, width: 120, height: 120 });
  });
  it('clips both pointer endpoints to the canvas bounds', () => {
    expect(canvasMarquee(bounds, { x: 170, y: 360 }, { x: 800, y: 900 }))
      .toEqual({ left: 30, top: 40, width: 370, height: 360 });
  });
  it('uses transformed client bounds for node intersection', () => {
    const rectangle = canvasMarquee(bounds, { x: 170, y: 360 }, { x: 290, y: 480 });
    const box = { left: bounds.left + rectangle.left, top: bounds.top + rectangle.top,
      right: bounds.left + rectangle.left + rectangle.width, bottom: bounds.top + rectangle.top + rectangle.height };
    expect(marqueeIntersects(box, { left: 280, top: 370, right: 330, bottom: 430 })).toBe(true);
    expect(marqueeIntersects(box, { left: 300, top: 370, right: 350, bottom: 430 })).toBe(false);
  });
});
