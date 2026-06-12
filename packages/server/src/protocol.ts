import type {
  Command, SimEvent, Phase, EnemyType, BuildingType, ClassType, EntityId, Resources, Vec2,
  ProjectileKind, UpgradeDef,
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
  | { t: 'vote'; option: number }                                // wave-upgrade vote (0..2)
  | { t: 'restart_vote' }                                        // game-over: try again
  | { t: 'chat'; text: string }
  | { t: 'upgrade_tool'; tool: 'axe' | 'pick' }                  // costs team coins
  | { t: 'latency'; n: number }                                  // echoed back for RTT
  | { t: 'ghost'; type: BuildingType | null; pos: Vec2; ok: boolean }  // build cursor shared with team
  | { t: 'leave' };

export interface BuildingView {
  id: EntityId; type: BuildingType; tier: number; pos: Vec2; hp: number; maxHp: number;
}
export interface EnemyView {
  id: EntityId; type: EnemyType; pos: Vec2; hp: number; maxHp: number; slowed: boolean; enraged: boolean;
}
export interface PlayerView {
  id: EntityId; klass: ClassType; pos: Vec2; hp: number; maxHp: number;
  alive: boolean; name: string; combatLevel: number;
}
export interface NodeView {
  id: EntityId; kind: 'tree' | 'rock'; pos: Vec2; amount: number;
}
export interface ProjectileView {
  id: EntityId; kind: ProjectileKind; pos: Vec2;
}

/** Server → Client messages. */
export type ServerMsg =
  | { t: 'welcome'; token: string; profile: ProfileView }
  | { t: 'lobby'; code: string; players: { name: string; klass: ClassType }[]; host: boolean }
  | { t: 'game_start'; seed: number; selfId: EntityId; nodes: NodeView[]; buildings: BuildingView[] }
  | { t: 'frame'; tick: number; phase: Phase; phaseTicks: number; wave: number;
      resources: Resources; players: PlayerView[]; enemies: EnemyView[];
      buildings: BuildingView[]; projectiles: ProjectileView[]; events: SimEvent[] }
  | { t: 'ping'; pos: Vec2; from: string }
  | { t: 'profile'; profile: ProfileView }
  | { t: 'choice_offer'; options: UpgradeDef[] }
  | { t: 'choice_state'; votes: (number | null)[] }              // one entry per seat
  | { t: 'choice_applied'; option: UpgradeDef }
  | { t: 'game_over'; wave: number; coinsEarned: number; skillPointsEarned: number }
  | { t: 'restart_state'; votes: number; needed: number }
  | { t: 'lobby_closed' }
  | { t: 'chat'; from: string; text: string }
  | { t: 'latency'; n: number }
  | { t: 'ghost'; from: string; type: BuildingType | null; pos: Vec2; ok: boolean }
  | { t: 'error'; message: string };

export interface ProfileView {
  name: string;
  skillPoints: number;
  unlockedSkills: string[];
  bestWave: number;
  totalKills: number;
  gamesPlayed: number;
  tools: { axe: number; pick: number };
}

export function encode(msg: ServerMsg): string { return JSON.stringify(msg); }
export function decode(data: string): ClientMsg | null {
  try {
    const m = JSON.parse(data);
    return typeof m === 'object' && m !== null && typeof m.t === 'string' ? m as ClientMsg : null;
  } catch { return null; }
}
