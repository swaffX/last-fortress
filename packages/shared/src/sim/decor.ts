import type { Vec2 } from './types';
import { Rng } from './rng';
import { MAP_SIZE, CASTLE_POS } from './constants';
import { inRiverBand, type RiverParams } from './river';

/**
 * Large map decorations are solid obstacles. Placement is derived from the
 * seed here, in shared code, so the server collides against exactly what the
 * client renders.
 */
export type DecorKind = 'house' | 'ruin' | 'cemetery' | 'watchtower' | 'windmill' | 'swamp';

export interface Decor {
  kind: DecorKind;
  pos: Vec2;
  rot: number;
  /** collision radius; 0 = walkable scenery */
  r: number;
}

const CX = CASTLE_POS.x + 2, CY = CASTLE_POS.y + 2;

export function generateDecor(seed: number, river: RiverParams,
                              nodes: { pos: Vec2 }[]): Decor[] {
  const rng = new Rng((seed ^ 0xdc0bdeed) >>> 0);
  const out: Decor[] = [];
  const taken: { x: number; y: number; r: number }[] =
    nodes.map(n => ({ x: n.pos.x, y: n.pos.y, r: 1.5 }));

  const spot = (minR: number, maxR: number, clearance: number): Vec2 | null => {
    for (let i = 0; i < 40; i++) {
      const a = rng.next() * Math.PI * 2;
      const r = minR + rng.next() * (maxR - minR);
      const x = CX + Math.cos(a) * r, y = CY + Math.sin(a) * r;
      if (x < 8 || y < 8 || x > MAP_SIZE - 8 || y > MAP_SIZE - 8) continue;
      if (inRiverBand(x, y, river, clearance)) continue;
      if (taken.some(o => Math.hypot(o.x - x, o.y - y) < o.r + clearance)) continue;
      taken.push({ x, y, r: clearance });
      return { x, y };
    }
    return null;
  };

  const add = (kind: DecorKind, minR: number, maxR: number, clearance: number,
               solid: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const p = spot(minR, maxR, clearance);
      if (!p) continue;
      out.push({ kind, pos: p, rot: rng.next() * Math.PI * 2, r: solid });
    }
  };

  add('house', 22, 42, 4, 2.0, 6);
  add('ruin', 30, 48, 6, 0, 2);          // low rubble — walkable
  add('cemetery', 34, 52, 6, 0, 2);      // walkable
  add('watchtower', 26, 50, 4, 1.1, 3);
  add('windmill', 30, 50, 6, 1.6, 1);
  add('swamp', 44, 56, 6, 0, 3);         // walkable bog
  return out;
}

/** Solid-decor collision test for movement code (server + client prediction). */
export function decorBlocks(decor: Decor[], pos: Vec2): boolean {
  for (const d of decor) {
    if (d.r > 0 && Math.hypot(d.pos.x - pos.x, d.pos.y - pos.y) < d.r) return true;
  }
  return false;
}
