import type { Vec2 } from './types';

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
/** center of a building footprint */
export function buildingCenter(pos: Vec2, size: number): Vec2 {
  return { x: pos.x + size / 2, y: pos.y + size / 2 };
}
