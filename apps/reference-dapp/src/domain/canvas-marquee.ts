// SPDX-License-Identifier: AGPL-3.0-only

type Point = { x: number; y: number };
type Bounds = { left: number; top: number; right: number; bottom: number };

export function canvasMarquee(bounds: Bounds, start: Point, end: Point) {
  const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
  const left = clamp(Math.min(start.x, end.x), bounds.left, bounds.right);
  const right = clamp(Math.max(start.x, end.x), bounds.left, bounds.right);
  const top = clamp(Math.min(start.y, end.y), bounds.top, bounds.bottom);
  const bottom = clamp(Math.max(start.y, end.y), bounds.top, bounds.bottom);
  return { left: left - bounds.left, top: top - bounds.top, width: right - left, height: bottom - top };
}

export function marqueeIntersects(box: Bounds, node: Bounds) {
  return node.left <= box.right && node.right >= box.left && node.top <= box.bottom && node.bottom >= box.top;
}
