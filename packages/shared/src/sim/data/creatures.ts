import type { ItemId } from './items';

export type Faction = 'animal' | 'bandit' | 'zombie' | 'boss';
export type Behavior = 'flee' | 'aggressive' | 'neutral' | 'pack' | 'march';

export interface LootEntry { item: ItemId; min: number; max: number; chance: number; }

export interface CreatureDef {
  id: string;
  faction: Faction;
  behavior: Behavior;
  hp: number;
  dmg: number;
  speed: number;              // units/sec
  radius: number;
  attackRange: number;
  attackCooldownTicks: number;
  ranged?: 'spit' | 'bolt';
  aggroRange: number;
  loot: LootEntry[];
  bossDrop?: ItemId;
  scale?: number;
}

const L = (item: ItemId, min: number, max: number, chance = 1): LootEntry => ({ item, min, max, chance });

export const CREATURES: Record<string, CreatureDef> = {
  // ---- herbivores: flee ----
  cow:    { id: 'cow', faction: 'animal', behavior: 'flee', hp: 30, dmg: 0, speed: 2.2, radius: 0.6, attackRange: 0, attackCooldownTicks: 0, aggroRange: 7, scale: 1.2, loot: [L('raw_meat', 2, 3), L('leather', 1, 2)] },
  sheep:  { id: 'sheep', faction: 'animal', behavior: 'flee', hp: 22, dmg: 0, speed: 2.4, radius: 0.5, attackRange: 0, attackCooldownTicks: 0, aggroRange: 7, loot: [L('wool', 1, 3), L('raw_meat', 1, 2)] },
  pig:    { id: 'pig', faction: 'animal', behavior: 'flee', hp: 24, dmg: 0, speed: 2.3, radius: 0.5, attackRange: 0, attackCooldownTicks: 0, aggroRange: 7, loot: [L('raw_meat', 2, 4)] },
  chicken:{ id: 'chicken', faction: 'animal', behavior: 'flee', hp: 8, dmg: 0, speed: 2.8, radius: 0.32, attackRange: 0, attackCooldownTicks: 0, aggroRange: 6, scale: 0.7, loot: [L('feather', 1, 3), L('raw_meat', 1, 1)] },
  rabbit: { id: 'rabbit', faction: 'animal', behavior: 'flee', hp: 6, dmg: 0, speed: 3.4, radius: 0.28, attackRange: 0, attackCooldownTicks: 0, aggroRange: 6, scale: 0.6, loot: [L('raw_meat', 1, 1), L('hide', 1, 1, 0.6)] },
  // ---- predators: aggressive / neutral ----
  wolf:   { id: 'wolf', faction: 'animal', behavior: 'pack', hp: 34, dmg: 9, speed: 3.2, radius: 0.5, attackRange: 1.3, attackCooldownTicks: 18, aggroRange: 9, loot: [L('pelt', 1, 2), L('raw_meat', 1, 2)] },
  boar:   { id: 'boar', faction: 'animal', behavior: 'neutral', hp: 40, dmg: 11, speed: 2.8, radius: 0.55, attackRange: 1.3, attackCooldownTicks: 22, aggroRange: 6, loot: [L('hide', 1, 2), L('raw_meat', 2, 3)] },
  bear:   { id: 'bear', faction: 'animal', behavior: 'aggressive', hp: 80, dmg: 20, speed: 2.9, radius: 0.7, attackRange: 1.5, attackCooldownTicks: 26, aggroRange: 8, scale: 1.4, loot: [L('pelt', 2, 3), L('raw_meat', 3, 4), L('bone', 1, 2)] },
  spider: { id: 'spider', faction: 'animal', behavior: 'aggressive', hp: 26, dmg: 8, speed: 3.0, radius: 0.5, attackRange: 6, attackCooldownTicks: 30, ranged: 'spit', aggroRange: 8, loot: [L('silk', 1, 3), L('venom', 1, 1, 0.7)] },
  snake:  { id: 'snake', faction: 'animal', behavior: 'neutral', hp: 16, dmg: 10, speed: 2.4, radius: 0.34, attackRange: 1.2, attackCooldownTicks: 20, aggroRange: 5, scale: 0.7, loot: [L('hide', 1, 1), L('venom', 1, 1)] },
  // ---- bandits: day, danger zones ----
  bandit_sword: { id: 'bandit_sword', faction: 'bandit', behavior: 'aggressive', hp: 50, dmg: 12, speed: 3.0, radius: 0.5, attackRange: 1.4, attackCooldownTicks: 16, aggroRange: 10, loot: [L('wood', 2, 4), L('leather', 1, 2), L('wood_sword', 1, 1, 0.15)] },
  bandit_dagger:{ id: 'bandit_dagger', faction: 'bandit', behavior: 'aggressive', hp: 38, dmg: 9, speed: 3.8, radius: 0.45, attackRange: 1.2, attackCooldownTicks: 12, aggroRange: 11, loot: [L('stone', 2, 4), L('hide', 1, 2)] },
  bandit_spear: { id: 'bandit_spear', faction: 'bandit', behavior: 'aggressive', hp: 46, dmg: 14, speed: 2.8, radius: 0.5, attackRange: 2.6, attackCooldownTicks: 20, aggroRange: 10, loot: [L('wood', 3, 5), L('wood_spear', 1, 1, 0.12)] },
  bandit_mage:  { id: 'bandit_mage', faction: 'bandit', behavior: 'aggressive', hp: 36, dmg: 13, speed: 2.6, radius: 0.5, attackRange: 8, attackCooldownTicks: 36, ranged: 'bolt', aggroRange: 11, loot: [L('bone', 1, 2), L('venom', 1, 1, 0.5)] },
  // ---- zombies: night, march ----
  zombie:       { id: 'zombie', faction: 'zombie', behavior: 'march', hp: 40, dmg: 10, speed: 1.9, radius: 0.5, attackRange: 1.3, attackCooldownTicks: 22, aggroRange: 6, loot: [L('bone', 1, 1, 0.5), L('raw_meat', 1, 1, 0.3)] },
  zombie_fast:  { id: 'zombie_fast', faction: 'zombie', behavior: 'march', hp: 26, dmg: 8, speed: 3.4, radius: 0.45, attackRange: 1.2, attackCooldownTicks: 16, aggroRange: 8, scale: 0.95, loot: [L('bone', 1, 1, 0.4)] },
  zombie_brute: { id: 'zombie_brute', faction: 'zombie', behavior: 'march', hp: 120, dmg: 22, speed: 1.5, radius: 0.7, attackRange: 1.5, attackCooldownTicks: 30, aggroRange: 6, scale: 1.4, loot: [L('bone', 2, 3), L('raw_meat', 1, 2)] },
  // ---- bosses ----
  warlock:      { id: 'warlock', faction: 'boss', behavior: 'march', hp: 600, dmg: 26, speed: 2.0, radius: 0.8, attackRange: 9, attackCooldownTicks: 28, ranged: 'bolt', aggroRange: 16, scale: 1.6, bossDrop: 'mage_staff', loot: [L('bone', 4, 6), L('venom', 2, 3)] },
  butcher:      { id: 'butcher', faction: 'boss', behavior: 'march', hp: 850, dmg: 40, speed: 2.2, radius: 0.9, attackRange: 1.8, attackCooldownTicks: 24, aggroRange: 16, scale: 1.9, bossDrop: 'katana', loot: [L('raw_meat', 5, 8), L('leather', 3, 5)] },
  spider_queen: { id: 'spider_queen', faction: 'boss', behavior: 'aggressive', hp: 700, dmg: 24, speed: 2.6, radius: 0.95, attackRange: 8, attackCooldownTicks: 26, ranged: 'spit', aggroRange: 16, scale: 1.9, bossDrop: 'war_spear', loot: [L('silk', 6, 10), L('venom', 4, 6)] },
};

export function creatureDef(id: string): CreatureDef | undefined { return CREATURES[id]; }
