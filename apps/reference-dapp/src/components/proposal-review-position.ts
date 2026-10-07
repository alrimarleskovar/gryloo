// SPDX-License-Identifier: AGPL-3.0-only
type Box = { x: number; y: number; width: number; height: number };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));
function overlap(a: Box, b: Box) {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

/** Screen-space placement only; never changes the canvas viewport or workflow. */
export function proposalReviewPosition(anchor: Box, size: { width: number; height: number }, bounds: Box, obstacles: readonly Box[] = []) {
  const gap = 8;
  const centered = anchor.x + (anchor.width - size.width) / 2;
  const candidates = [
    { x: centered, y: anchor.y - size.height - gap },
    { x: anchor.x + anchor.width + gap, y: anchor.y },
    { x: anchor.x - size.width - gap, y: anchor.y },
    { x: centered, y: anchor.y + anchor.height + gap },
  ];
  // Additional boundary candidates keep the review away from bottom navigation/CTAs.
  candidates.push({ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width - size.width, y: bounds.y });
  return candidates.map(candidate => {
    const box = { ...size, x: clamp(candidate.x, bounds.x, bounds.x + bounds.width - size.width),
      y: clamp(candidate.y, bounds.y, bounds.y + bounds.height - size.height) };
    return { ...box, score: overlap(box, anchor) + obstacles.reduce((total, obstacle) => total + overlap(box, obstacle), 0) };
  }).reduce((best, candidate) => candidate.score < best.score ? candidate : best);
}
