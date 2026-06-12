import type { SimState } from './types';

/** JSON-safe full-state snapshot. Plan 2 adds binary deltas on top. */
export function serializeState(s: SimState): string {
  return JSON.stringify({
    ...s,
    buildings: [...s.buildings.entries()],
    enemies: [...s.enemies.entries()],
    players: [...s.players.entries()],
    nodes: [...s.nodes.entries()],
    projectiles: [...s.projectiles.entries()],
  });
}

export function deserializeState(json: string): SimState {
  const raw = JSON.parse(json);
  return {
    ...raw,
    buildings: new Map(raw.buildings),
    enemies: new Map(raw.enemies),
    players: new Map(raw.players),
    nodes: new Map(raw.nodes),
    projectiles: new Map(raw.projectiles),
  };
}
