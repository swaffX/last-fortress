import type { SkillModifiers } from './data/skills';

export interface Vec2 { x: number; y: number; }

export type ResourceKind = 'wood' | 'stone' | 'gold' | 'coins';
export type Resources = Record<ResourceKind, number>;

export type BuildingType =
  | 'wood_wall' | 'stone_wall' | 'gate' | 'spike'
  | 'archer_tower' | 'crossbow_tower' | 'bomb_tower' | 'ice_tower' | 'lightning_tower'
  | 'gold_mine' | 'wood_camp' | 'stone_quarry'
  | 'healing_totem'
  | 'castle';

export type EnemyType = 'normal' | 'fast' | 'tank' | 'spitter' | 'exploding' | 'butcher';
export type ClassType = 'knight' | 'hunter';
export type WeaponType = 'sword' | 'bow' | 'crossbow';
export type Phase = 'day' | 'night';

export type EntityId = number;

export interface Building {
  id: EntityId;
  type: BuildingType;
  tier: number;            // 1..3 (castle: level 1..5)
  pos: Vec2;               // grid cell of footprint origin (top-left)
  hp: number;
  maxHp: number;
  cooldown: number;        // ticks until next action (tower fire / income)
}

export interface Enemy {
  id: EntityId;
  type: EnemyType;
  pos: Vec2;               // world position (float, world units == grid cells)
  hp: number;
  maxHp: number;
  speedMul: number;        // 1 normally, <1 while slowed
  slowTicks: number;
  attackCooldown: number;
  targetBuildingId: EntityId | null;
  enraged: boolean;        // butcher phase 2
}

export interface Player {
  id: EntityId;
  klass: ClassType;
  weapon: WeaponType;
  pos: Vec2;
  hp: number;
  maxHp: number;
  attackCooldown: number;
  alive: boolean;
  respawnTicks: number;
  mods: SkillModifiers;
}

export interface ResourceNode {
  id: EntityId;
  kind: 'tree' | 'rock';
  pos: Vec2;               // grid cell
  amount: number;          // remaining harvestable amount
}

export interface SimState {
  tick: number;
  phase: Phase;
  phaseTicks: number;      // ticks remaining in current phase
  wave: number;            // last started wave number (0 before first night)
  pendingSpawns: { type: EnemyType; atTick: number }[];
  resources: Resources;    // shared team economy
  buildings: Map<EntityId, Building>;
  enemies: Map<EntityId, Enemy>;
  players: Map<EntityId, Player>;
  nodes: Map<EntityId, ResourceNode>;
  projectiles: Map<EntityId, Projectile>;
  bonuses: TeamBonuses;
  castleId: EntityId;
  nextId: EntityId;
  gameOver: boolean;
}

export type ProjectileKind = 'arrow' | 'bolt' | 'spit' | 'bomb';

/** In-flight projectile — damage lands on impact, not on fire. */
export interface Projectile {
  id: EntityId;
  kind: ProjectileKind;
  pos: Vec2;
  speed: number;          // world units per second
  dmg: number;
  crit: boolean;
  targetEnemy: EntityId | null;
  targetPlayer: EntityId | null;
  targetBuilding: EntityId | null;
  targetPos: Vec2;        // fallback aim point (target died) / bomb ground aim
  aoeRadius?: number;     // bomb
  slowMul?: number;
  slowTicks?: number;
}

/** Team-wide modifiers from wave-vote upgrades. */
export interface TeamBonuses {
  playerDmgMul: number;
  towerDmgMul: number;
  enemyDmgMul: number;    // <1 = weakened enemies
  incomeMul: number;
  coinMul: number;
  playerSpeedMul: number;
}

export type Command =
  | { kind: 'move'; dir: Vec2 }                                  // dir normalized client-side; re-normalized in sim
  | { kind: 'attack'; dir: Vec2 }                                // legacy no-op (combat is automatic)
  | { kind: 'gather' }                                           // E key: harvest nearest node in reach
  | { kind: 'build'; type: BuildingType; pos: Vec2 }
  | { kind: 'upgrade'; buildingId: EntityId }
  | { kind: 'demolish'; buildingId: EntityId };

export type SimEvent =
  | { kind: 'projectile'; from: Vec2; to: Vec2; weapon: 'arrow' | 'bolt' | 'bomb' | 'ice' | 'lightning' | 'spit' }
  | { kind: 'damage'; pos: Vec2; amount: number; crit: boolean }
  | { kind: 'melee'; pos: Vec2 }
  | { kind: 'splash'; pos: Vec2 }
  | { kind: 'node_depleted'; nodeId: EntityId; pos: Vec2 }
  | { kind: 'explosion'; pos: Vec2; radius: number }
  | { kind: 'chain'; points: Vec2[] }
  | { kind: 'death'; pos: Vec2; enemy: EnemyType }
  | { kind: 'coins'; pos: Vec2; amount: number }
  | { kind: 'build_placed'; pos: Vec2; type: BuildingType }
  | { kind: 'building_destroyed'; pos: Vec2; type: BuildingType }
  | { kind: 'wave_start'; wave: number; boss: boolean }
  | { kind: 'phase_change'; phase: Phase }
  | { kind: 'game_over'; wave: number };
