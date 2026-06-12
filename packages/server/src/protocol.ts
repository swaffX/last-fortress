import type {
  Command, SimEvent, Phase, EnemyType, BuildingType, ClassType, EntityId, Resources, Vec2,
} from '@lf/shared';

/** Client → Server messages. */
export type ClientMsg =
  | { t: 'hello'; token?: string }                               // returns/creates profile
  | { t: 'create_lobby'; klass: ClassType; solo: boolean }
  | { t: 'join_lobby'; code: string; klass: ClassType }
  | { t: 'start_game' }                                          // host only
  | { t: 'cmd'; cmd: Command }
  | { t: 'ping'; pos: Vec2 }                                     // map marker for teammates
  | { t: 'unlock_skill'; skillId: string }
  | { t: 'leave' };

export interface BuildingView {
  id: EntityId; type: BuildingType; tier: number; pos: Vec2; hp: number; maxHp: number;
}
export interface EnemyView {
  id: EntityId; type: EnemyType; pos: Vec2; hp: number; maxHp: number; slowed: boolean; enraged: boolean;
}
export interface PlayerView {
  id: EntityId; klass: ClassType; pos: Vec2; hp: number; maxHp: number; alive: boolean; name: string;
}
export interface NodeView {
  id: EntityId; kind: 'tree' | 'rock'; pos: Vec2; amount: number;
}

/** Server → Client messages. */
export type ServerMsg =
  | { t: 'welcome'; token: string; profile: ProfileView }
  | { t: 'lobby'; code: string; players: { name: string; klass: ClassType }[]; host: boolean }
  | { t: 'game_start'; seed: number; selfId: EntityId; nodes: NodeView[]; buildings: BuildingView[] }
  | { t: 'frame'; tick: number; phase: Phase; phaseTicks: number; wave: number;
      resources: Resources; players: PlayerView[]; enemies: EnemyView[];
      buildings: BuildingView[]; events: SimEvent[] }
  | { t: 'ping'; pos: Vec2; from: string }
  | { t: 'profile'; profile: ProfileView }
  | { t: 'game_over'; wave: number; coinsEarned: number; skillPointsEarned: number }
  | { t: 'error'; message: string };

export interface ProfileView {
  name: string;
  skillPoints: number;
  unlockedSkills: string[];
  bestWave: number;
  totalKills: number;
  gamesPlayed: number;
}

export function encode(msg: ServerMsg): string { return JSON.stringify(msg); }
export function decode(data: string): ClientMsg | null {
  try {
    const m = JSON.parse(data);
    return typeof m === 'object' && m !== null && typeof m.t === 'string' ? m as ClientMsg : null;
  } catch { return null; }
}
