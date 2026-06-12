import type { EnemyType } from '../types';

export interface EnemyDef {
  hp: number;
  speed: number;          // world units per second
  dmg: number;
  attackRange: number;    // melee ~1.2; spitter ranged
  attackCooldownTicks: number;
  coins: number;
  radius: number;         // collision/visual radius
  explodeOnDeath?: { dmg: number; radius: number };  // exploding zombie
}

export const ENEMIES: Record<EnemyType, EnemyDef> = {
  normal:    { hp: 50,   speed: 2.2, dmg: 8,  attackRange: 1.2, attackCooldownTicks: 20, coins: 3,  radius: 0.4 },
  fast:      { hp: 30,   speed: 4.5, dmg: 5,  attackRange: 1.2, attackCooldownTicks: 16, coins: 4,  radius: 0.35 },
  tank:      { hp: 300,  speed: 1.2, dmg: 25, attackRange: 1.4, attackCooldownTicks: 30, coins: 12, radius: 0.7 },
  spitter:   { hp: 45,   speed: 2.0, dmg: 10, attackRange: 6.0, attackCooldownTicks: 40, coins: 6,  radius: 0.4 },
  exploding: { hp: 40,   speed: 2.8, dmg: 5,  attackRange: 1.2, attackCooldownTicks: 20, coins: 8,  radius: 0.45,
               explodeOnDeath: { dmg: 40, radius: 2.5 } },
  butcher:   { hp: 3500, speed: 1.6, dmg: 80, attackRange: 1.8, attackCooldownTicks: 36, coins: 200, radius: 1.2 },
};
