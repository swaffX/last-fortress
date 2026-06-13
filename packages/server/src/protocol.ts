import type {
  Command, SimEvent, Phase, BuildingType, EntityId, Vec2, Slot, ItemId,
} from '@lf/shared';

export type ClientMsg =
  | { t: 'hello'; token?: string }
  | { t: 'create_lobby'; solo: boolean }
  | { t: 'join_lobby'; code: string }
  | { t: 'start_game' }
  | { t: 'cmd'; cmd: Command }
  | { t: 'ping'; pos: Vec2 }
  | { t: 'unlock_skill'; skillId: string }
  | { t: 'chat'; text: string }
  | { t: 'latency'; n: number }
  | { t: 'ghost'; type: BuildingType | null; pos: Vec2; ok: boolean }
  | { t: 'leave' };

export interface BuildingView { id: EntityId; type: BuildingType; pos: Vec2; hp: number; maxHp: number; }
export interface NodeView { id: EntityId; kind: 'tree' | 'rock' | 'bush'; pos: Vec2; amount: number; }
export interface GroundItemView { id: EntityId; item: ItemId; count: number; pos: Vec2; }
export interface PlayerView {
  id: EntityId; pos: Vec2; hp: number; maxHp: number; alive: boolean; name: string;
  hunger: number; hand: number; region: string;
  inventory: Slot[]; equipment: { head: Slot; body: Slot; legs: Slot };
}

export type ServerMsg =
  | { t: 'welcome'; token: string; profile: ProfileView }
  | { t: 'lobby'; code: string; players: { name: string }[]; host: boolean }
  | { t: 'game_start'; seed: number; selfId: EntityId; nodes: NodeView[]; buildings: BuildingView[] }
  | { t: 'frame'; tick: number; phase: Phase; phaseTicks: number;
      players: PlayerView[]; buildings: BuildingView[];
      groundItems: GroundItemView[]; events: SimEvent[] }
  | { t: 'ping'; pos: Vec2; from: string }
  | { t: 'profile'; profile: ProfileView }
  | { t: 'lobby_closed' }
  | { t: 'chat'; from: string; text: string }
  | { t: 'latency'; n: number }
  | { t: 'ghost'; from: string; type: BuildingType | null; pos: Vec2; ok: boolean }
  | { t: 'error'; message: string };

export interface ProfileView {
  name: string; skillPoints: number; unlockedSkills: string[];
  bestWave: number; totalKills: number; gamesPlayed: number;
}

export function encode(msg: ServerMsg): string { return JSON.stringify(msg); }
export function decode(data: string): ClientMsg | null {
  try {
    const m = JSON.parse(data);
    return typeof m === 'object' && m !== null && typeof m.t === 'string' ? m as ClientMsg : null;
  } catch { return null; }
}
