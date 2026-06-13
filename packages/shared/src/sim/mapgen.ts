import type { Vec2 } from './types';
import { Rng } from './rng';
import { MAP_SIZE, CAMP_POS, CAMP_CLEAR_RADIUS } from './constants';
import { inRiverBand, type RiverParams } from './river';
import { regionAt, type RegionMap, type Biome } from './regions';

export interface MapData {
  nodes: { kind: 'tree' | 'rock' | 'bush'; pos: Vec2 }[];
}

/** relative weights of tree/rock/bush per biome */
const DENSITY: Record<Biome, { tree: number; rock: number; bush: number }> = {
  meadow:    { tree: 0.3, rock: 0.2, bush: 1.0 },
  forest:    { tree: 1.0, rock: 0.3, bush: 0.4 },
  mountains: { tree: 0.4, rock: 1.0, bush: 0.1 },
  swamp:     { tree: 0.7, rock: 0.2, bush: 0.5 },
  tundra:    { tree: 0.3, rock: 0.5, bush: 0.1 },
  plains:    { tree: 0.2, rock: 0.2, bush: 0.8 },
  badlands:  { tree: 0.1, rock: 0.8, bush: 0.1 },
};

export function generateMap(rng: Rng, river: RiverParams, regions: RegionMap): MapData {
  const nodes: MapData['nodes'] = [];
  const used = new Set<string>();
  const add = (kind: 'tree' | 'rock' | 'bush', x: number, y: number) => {
    if (x < 2 || y < 2 || x > MAP_SIZE - 3 || y > MAP_SIZE - 3) return;
    if (Math.hypot(x - CAMP_POS.x, y - CAMP_POS.y) <= CAMP_CLEAR_RADIUS) return;
    if (inRiverBand(x, y, river, 1.2)) return;
    const key = `${x},${y}`;
    if (used.has(key)) return;
    used.add(key);
    nodes.push({ kind, pos: { x, y } });
  };
  // cluster passes scaled by the biome under each cluster centre
  for (let c = 0; c < 220; c++) {
    const cx = rng.int(6, MAP_SIZE - 7), cy = rng.int(6, MAP_SIZE - 7);
    const d = DENSITY[regionAt(regions, { x: cx, y: cy }).biome];
    const total = d.tree + d.rock + d.bush;
    for (let i = 0, n = rng.int(5, 12); i < n; i++) {
      const x = cx + rng.int(-5, 5), y = cy + rng.int(-5, 5);
      const r = rng.next();
      if (r < d.tree / total) add('tree', x, y);
      else if (r < (d.tree + d.rock) / total) add('rock', x, y);
      else add('bush', x, y);
    }
  }
  return { nodes };
}
