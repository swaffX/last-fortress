import type { SimState } from './types';

export function serializeState(s: SimState): string {
  return JSON.stringify({
    ...s,
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
  };
}
