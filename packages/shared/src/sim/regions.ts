import type { Vec2 } from './types';
import { Rng } from './rng';
import { MAP_SIZE, CAMP_POS } from './constants';

export type Biome = 'meadow' | 'forest' | 'mountains' | 'swamp' | 'tundra' | 'plains' | 'badlands';

export interface Region {
  id: number;
  name: string;
  biome: Biome;
  seed: Vec2;        // Voronoi site
}

export interface RegionMap {
  regions: Region[];
  /** assignment is computed on demand by nearest site (`regionAt`) */
}

const BIOME_NAMES: Record<Biome, string[]> = {
  meadow:    ['Hearthfield', 'Greenrest', 'Dawn Meadow'],
  forest:    ['Mistwood', 'Elderpine', 'Thornwood'],
  mountains: ['Stonespire', 'Ironpeak', 'Frostcrag'],
  swamp:     ['Murkfen', 'Blackmire', 'Rotbog'],
  tundra:    ['Whitewaste', 'Hollowfrost', 'Palecourt'],
  plains:    ['Wideflat', 'Sunreach', 'Longgrass'],
  badlands:  ['Ashland', 'Cinderscar', 'Dustmar'],
};

/** Deterministic Voronoi partition: meadow forced at the camp, the rest seeded by RNG. */
export function generateRegions(seed: number): RegionMap {
  const rng = new Rng(seed ^ 0x9e3779b9);
  const used = new Set<string>();
  const pickName = (b: Biome): string => {
    const pool = BIOME_NAMES[b];
    for (let i = 0; i < 8; i++) {
      const n = pool[rng.int(0, pool.length - 1)]!;
      if (!used.has(n)) { used.add(n); return n; }
    }
    return `${pool[0]} ${used.size}`;
  };
  const regions: Region[] = [
    { id: 0, name: pickName('meadow'), biome: 'meadow', seed: { ...CAMP_POS } },
  ];
  const order: Biome[] = ['forest', 'mountains', 'swamp', 'tundra', 'plains', 'forest', 'badlands', 'mountains'];
  const n = 8;                                   // 9 regions incl. meadow → 6-10 range
  for (let i = 0; i < n; i++) {
    const biome = order[i % order.length]!;
    // keep sites away from camp and the border
    let x = 0, y = 0, ok = false;
    for (let t = 0; t < 30 && !ok; t++) {
      x = rng.int(28, MAP_SIZE - 29);
      y = rng.int(28, MAP_SIZE - 29);
      ok = Math.hypot(x - CAMP_POS.x, y - CAMP_POS.y) > 70;
    }
    regions.push({ id: i + 1, name: pickName(biome), biome, seed: { x, y } });
  }
  return { regions };
}

/** Nearest-site lookup. */
export function regionAt(map: RegionMap, pos: Vec2): Region {
  let best = map.regions[0]!, bd = Infinity;
  for (const r of map.regions) {
    const d = (r.seed.x - pos.x) ** 2 + (r.seed.y - pos.y) ** 2;
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}
