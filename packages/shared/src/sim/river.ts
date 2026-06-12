import type { Vec2 } from './types';
import { Rng } from './rng';
import { MAP_SIZE, CASTLE_POS } from './constants';

/**
 * The river is derived deterministically from the game seed by both the
 * server sim (movement slowdown, splash events) and the client renderer
 * (water visuals), so what you see is exactly what slows you down.
 */

export const RIVER_WIDTH = 3.4;
/** bridge center x positions — crossing on a bridge does not slow you */
export const BRIDGE_XS = [MAP_SIZE * 0.3, MAP_SIZE * 0.68] as const;
export const BRIDGE_HALF_WIDTH = 1.6;

export interface RiverParams {
  offset: number;   // signed distance of the channel from the castle row
  amp: number;
  freq: number;
  phase: number;
}

export function riverParams(seed: number): RiverParams {
  const rng = new Rng((seed ^ 0x5eed) >>> 0);
  const side = rng.next() < 0.5 ? -1 : 1;
  return {
    offset: side * (24 + rng.next() * 6),
    amp: 6 + rng.next() * 5,
    freq: 0.05 + rng.next() * 0.03,
    phase: rng.next() * Math.PI * 2,
  };
}

export function riverYAt(x: number, p: RiverParams): number {
  return CASTLE_POS.y + 2 + p.offset + Math.sin(x * p.freq + p.phase) * p.amp;
}

export function onBridge(pos: Vec2): boolean {
  return BRIDGE_XS.some(bx => Math.abs(pos.x - bx) < BRIDGE_HALF_WIDTH);
}

/** In the water channel and not on a bridge. */
export function inRiver(pos: Vec2, p: RiverParams): boolean {
  if (onBridge(pos)) return false;
  return Math.abs(pos.y - riverYAt(pos.x, p)) < RIVER_WIDTH / 2;
}

/** Within the river band regardless of bridges (for terrain placement). */
export function inRiverBand(x: number, y: number, p: RiverParams, margin = 0): boolean {
  return Math.abs(y - riverYAt(x, p)) < RIVER_WIDTH / 2 + margin;
}

/**
 * Bridge decks are elevated: you can only walk on or off at the ends.
 * Returns true when a movement segment would climb over a side rail —
 * either from the water onto the deck or off the deck into the water.
 */
export function crossesBridgeRail(from: Vec2, to: Vec2, p: RiverParams): boolean {
  for (const bx of BRIDGE_XS) {
    for (const rail of [bx - BRIDGE_HALF_WIDTH, bx + BRIDGE_HALF_WIDTH]) {
      if ((from.x - rail) * (to.x - rail) >= 0) continue;   // didn't cross the line
      const midY = (from.y + to.y) / 2;
      if (Math.abs(midY - riverYAt(rail, p)) < RIVER_WIDTH / 2 + 0.6) return true;
    }
  }
  return false;
}
