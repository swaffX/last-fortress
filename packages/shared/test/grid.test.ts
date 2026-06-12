import { describe, it, expect } from 'vitest';
import { Grid } from '../src/sim/grid';
import { generateMap } from '../src/sim/mapgen';
import { Rng } from '../src/sim/rng';
import { riverParams } from '../src/sim/river';
import { MAP_SIZE, CASTLE_POS } from '../src/sim/constants';

const RIVER = riverParams(5);

describe('Grid', () => {
  it('rejects placement outside bounds', () => {
    const g = new Grid(MAP_SIZE);
    expect(g.canPlace({ x: -1, y: 5 }, 1)).toBe(false);
    expect(g.canPlace({ x: MAP_SIZE - 1, y: 5 }, 2)).toBe(false);
  });
  it('rejects overlapping placements and frees on clear', () => {
    const g = new Grid(MAP_SIZE);
    g.occupy({ x: 10, y: 10 }, 2, 99);
    expect(g.canPlace({ x: 11, y: 11 }, 2)).toBe(false);
    expect(g.occupantAt({ x: 11, y: 11 })).toBe(99);
    g.clear({ x: 10, y: 10 }, 2);
    expect(g.canPlace({ x: 11, y: 11 }, 2)).toBe(true);
  });
});

describe('generateMap', () => {
  it('is deterministic for the same seed', () => {
    const a = generateMap(new Rng(5), RIVER);
    const b = generateMap(new Rng(5), RIVER);
    expect(a.nodes.map(n => ({ ...n }))).toEqual(b.nodes.map(n => ({ ...n })));
  });
  it('keeps a clear area around the castle', () => {
    const m = generateMap(new Rng(5), RIVER);
    for (const n of m.nodes) {
      const dx = n.pos.x - (CASTLE_POS.x + 2), dy = n.pos.y - (CASTLE_POS.y + 2);
      expect(Math.hypot(dx, dy)).toBeGreaterThan(10);
    }
  });
  it('spawn points sit on the map border region', () => {
    const m = generateMap(new Rng(5), RIVER);
    expect(m.spawnPoints.length).toBeGreaterThanOrEqual(8);
    for (const p of m.spawnPoints) {
      const nearEdge = p.x < 6 || p.y < 6 || p.x > MAP_SIZE - 6 || p.y > MAP_SIZE - 6;
      expect(nearEdge).toBe(true);
    }
  });
});
