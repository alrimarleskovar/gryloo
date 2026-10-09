// SPDX-License-Identifier: AGPL-3.0-only
import { expect, type Locator } from '@playwright/test';

export async function assertConnectedFlow(diagram: Locator, destinations = 2) {
  await expect(diagram).toHaveAttribute('data-flow-ready', 'true');
  await expect(diagram.locator('[data-flow-source] svg')).toHaveCount(3);
  const geometry = await diagram.evaluate(root => {
    const center = (element: Element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const ports = [...root.querySelectorAll('[data-flow-port]')];
    const anchors = [...ports, ...root.querySelectorAll('[data-flow-junction]')].map(center);
    const paths = [...root.querySelectorAll<SVGPathElement>('[data-flow-path]')];
    const endpoints = paths.flatMap(path => {
      const matrix = path.getScreenCTM()!;
      return [path.getPointAtLength(0), path.getPointAtLength(path.getTotalLength())]
        .map(point => new DOMPoint(point.x, point.y).matrixTransform(matrix));
    });
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    const boxes = [...root.querySelectorAll('[data-flow-source], [data-flow-core], [data-flow-destination]')].map(element => element.getBoundingClientRect());
    // Check the actual curves along their length: connected endpoints alone do not prevent a line cutting through a card.
    const interiorCrossings = paths.flatMap(path => {
      const matrix = path.getScreenCTM()!;
      const length = path.getTotalLength();
      return Array.from({ length: 51 }, (_, index) => {
        const point = path.getPointAtLength(length * index / 50);
        return new DOMPoint(point.x, point.y).matrixTransform(matrix);
      })
        .filter(point => boxes.some(box => point.x > box.left + 2 && point.x < box.right - 2 && point.y > box.top + 2 && point.y < box.bottom - 2)).length;
    }).reduce((sum, value) => sum + value, 0);
    const edgeGaps = ports.map(port => {
      const p = center(port);
      const box = port.parentElement!.getBoundingClientRect();
      return Math.min(Math.abs(p.x - box.left), Math.abs(p.x - box.right), Math.abs(p.y - box.top), Math.abs(p.y - box.bottom));
    });
    return {
      pathCount: paths.length,
      maxGap: Math.max(...endpoints.map(endpoint => Math.min(...anchors.map(anchor => distance(endpoint, anchor))))),
      connectedPorts: ports.map(port => endpoints.some(endpoint => distance(center(port), endpoint) <= 1)),
      junctionDegrees: anchors.slice(ports.length).map(junction => endpoints.filter(endpoint => distance(junction, endpoint) <= 1).length),
      edgeGap: Math.max(...edgeGaps), interiorCrossings,
    };
  });
  expect(geometry.pathCount).toBe(5 + destinations);
  expect(geometry.maxGap).toBeLessThanOrEqual(1);
  expect(geometry.connectedPorts).toEqual(Array(5 + destinations).fill(true));
  expect(geometry.junctionDegrees).toEqual([4, 1 + destinations]);
  expect(geometry.edgeGap).toBeLessThanOrEqual(1);
  expect(geometry.interiorCrossings).toBe(0);
}
