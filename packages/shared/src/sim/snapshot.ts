import type { SimState } from './types';

export function serializeState(s: SimState): string {
  // creatures + projectiles are transient — never persisted (respawned from the plan)
  const { creatures: _c, projectiles: _p, ...rest } = s;
  return JSON.stringify({
    ...rest,
    buildings: [...s.buildings.entries()],
    players: [...s.players.entries()],
    nodes: [...s.nodes.entries()],
    groundItems: [...s.groundItems.entries()],
  });
}

export function deserializeState(json: string): SimState {
  const raw = JSON.parse(json);
  return {
    ...raw,
    buildings: new Map(raw.buildings),
    players: new Map(raw.players),
    nodes: new Map(raw.nodes),
    groundItems: new Map(raw.groundItems),
    creatures: new Map(),
    projectiles: new Map(),
  };
}
