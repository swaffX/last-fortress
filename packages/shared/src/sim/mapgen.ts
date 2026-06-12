import type { Vec2 } from './types';
import { Rng } from './rng';
import { MAP_SIZE, CASTLE_POS } from './constants';

export interface MapData {
  nodes: { kind: 'tree' | 'rock'; pos: Vec2 }[];
  spawnPoints: Vec2[];
}

const CASTLE_CENTER = { x: CASTLE_POS.x + 2, y: CASTLE_POS.y + 2 };
const CLEAR_RADIUS = 12;

export function generateMap(rng: Rng): MapData {
  const nodes: MapData['nodes'] = [];
  const used = new Set<string>();
  // forest clusters
  for (let c = 0; c < 14; c++) {
    const cx = rng.int(8, MAP_SIZE - 9), cy = rng.int(8, MAP_SIZE - 9);
    for (let i = 0, n = rng.int(5, 12); i < n; i++) {
      const x = cx + rng.int(-4, 4), y = cy + rng.int(-4, 4);
      tryAdd(nodes, used, 'tree', x, y);
    }
  }
  // stone deposits
  for (let c = 0; c < 8; c++) {
    const cx = rng.int(8, MAP_SIZE - 9), cy = rng.int(8, MAP_SIZE - 9);
    for (let i = 0, n = rng.int(3, 6); i < n; i++) {
      const x = cx + rng.int(-2, 2), y = cy + rng.int(-2, 2);
      tryAdd(nodes, used, 'rock', x, y);
    }
  }
  // spawn points around the border
  const spawnPoints: Vec2[] = [];
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    spawnPoints.push({
      x: Math.round(CASTLE_CENTER.x + Math.cos(angle) * (MAP_SIZE / 2 - 4)),
      y: Math.round(CASTLE_CENTER.y + Math.sin(angle) * (MAP_SIZE / 2 - 4)),
    });
  }
  return { nodes, spawnPoints };
}

function tryAdd(nodes: MapData['nodes'], used: Set<string>,
                kind: 'tree' | 'rock', x: number, y: number): void {
  if (x < 2 || y < 2 || x > MAP_SIZE - 3 || y > MAP_SIZE - 3) return;
  if (Math.hypot(x - CASTLE_CENTER.x, y - CASTLE_CENTER.y) <= CLEAR_RADIUS) return;
  const key = `${x},${y}`;
  if (used.has(key)) return;
  used.add(key);
  nodes.push({ kind, pos: { x, y } });
}
