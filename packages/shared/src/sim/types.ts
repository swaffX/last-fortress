import type { SkillModifiers } from './data/skills';
import type { Slot, ItemId } from './data/items';

export interface Vec2 { x: number; y: number; }

export type BuildingType = 'wood_wall' | 'stone_wall' | 'gate' | 'spike' | 'crafting_table';
export type Phase = 'day' | 'night';
export type EntityId = number;

export interface Building {
  id: EntityId;
  type: BuildingType;
  pos: Vec2;               // grid cell (top-left of footprint)
  hp: number;
  maxHp: number;
}

export interface Equipment {
  head: Slot;
  body: Slot;
  legs: Slot;
}

export interface Player {
  id: EntityId;
  pos: Vec2;
  hp: number;
  maxHp: number;
  alive: boolean;
  respawnTicks: number;
  mods: SkillModifiers;
  inventory: Slot[];       // length INVENTORY_SLOTS (0..8 hotbar, 9..35 backpack)
  equipment: Equipment;    // inert in Phase 0
  hand: number;            // selected hotbar index 0..8
  hunger: number;          // 0..100
  temperature: number;     // 0..100 placeholder, inert until Phase 4
  gatherCooldown: number;
  gatherTarget: EntityId | null;
  attackCooldown: number;          // swing cooldown ticks
}

export type ProjectileKind = 'spit' | 'bolt';

export interface Creature {
  id: EntityId;
  species: string;                 // CREATURES key
  pos: Vec2;
  hp: number;
  maxHp: number;
  target: EntityId | null;
  attackCooldown: number;
  provoked: boolean;               // neutral creatures engage once hit
  fleeTicks: number;               // herbivore panic timer
  staggerTicks: number;            // brief stun after taking a hit
  knock: Vec2;                     // decaying knockback velocity
  wanderDir: Vec2;
  biome: string;
}

export interface Projectile {
  id: EntityId;
  kind: ProjectileKind;
  pos: Vec2;
  dir: Vec2;                       // normalized travel
  speed: number;
  dmg: number;
  fromPlayer: boolean;             // true = player shot (hits creatures)
  ttlTicks: number;
}

export interface ResourceNode {
  id: EntityId;
  kind: 'tree' | 'rock' | 'bush';
  pos: Vec2;
  amount: number;
  regrowTicks: number;     // bushes regrow; 0 = ready/non-regrowing
}

export interface DroppedItem {
  id: EntityId;
  item: ItemId;
  count: number;
  dur?: number;
  pos: Vec2;
  ttlTicks: number;
}

export interface SimState {
  tick: number;
  worldSeed: number;
  phase: Phase;
  phaseTicks: number;
  buildings: Map<EntityId, Building>;
  players: Map<EntityId, Player>;
  nodes: Map<EntityId, ResourceNode>;
  groundItems: Map<EntityId, DroppedItem>;
  creatures: Map<EntityId, Creature>;
  projectiles: Map<EntityId, Projectile>;
  nextId: EntityId;
}

export type Command =
  | { kind: 'move'; dir: Vec2 }
  | { kind: 'gather' }
  | { kind: 'eat' }
  | { kind: 'select_hand'; slot: number }
  | { kind: 'move_item'; from: number; to: number }
  | { kind: 'drop_item'; slot: number; count: number }
  | { kind: 'craft'; recipeId: string }
  | { kind: 'repair_hand' }
  | { kind: 'attack'; dir: Vec2 }
  | { kind: 'build'; type: BuildingType; pos: Vec2 }
  | { kind: 'demolish'; buildingId: EntityId };

export type SimEvent =
  | { kind: 'damage'; pos: Vec2; amount: number; crit: boolean }
  | { kind: 'melee'; pos: Vec2 }
  | { kind: 'node_depleted'; nodeId: EntityId; pos: Vec2 }
  | { kind: 'gather'; pos: Vec2; resource: ItemId; amount: number;
      nodeId: EntityId; remaining: number }
  | { kind: 'pickup'; pos: Vec2; item: ItemId; count: number; playerId: EntityId }
  | { kind: 'eat'; pos: Vec2; playerId: EntityId }
  | { kind: 'item_drop'; pos: Vec2; item: ItemId; count: number }
  | { kind: 'craft'; pos: Vec2; item: ItemId }
  | { kind: 'tool_broke'; pos: Vec2; item: ItemId; playerId: EntityId }
  | { kind: 'repair'; pos: Vec2; playerId: EntityId }
  | { kind: 'build_placed'; pos: Vec2; type: BuildingType }
  | { kind: 'building_destroyed'; pos: Vec2; type: BuildingType }
  | { kind: 'player_died'; id: EntityId; pos: Vec2 }
  | { kind: 'player_respawn'; id: EntityId; pos: Vec2 }
  | { kind: 'region_enter'; id: EntityId; region: string }
  | { kind: 'swing'; pos: Vec2; dir: Vec2 }
  | { kind: 'creature_spawn'; id: EntityId; species: string; pos: Vec2 }
  | { kind: 'creature_death'; id: EntityId; species: string; pos: Vec2 }
  | { kind: 'projectile'; from: Vec2; to: Vec2; kind2: ProjectileKind }
  | { kind: 'phase_change'; phase: Phase };
