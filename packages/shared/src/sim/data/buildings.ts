import type { BuildingType } from '../types';

export interface TierStats {
  cost: { wood?: number; stone?: number; gold?: number };
  hp: number;
  dmg?: number;            // towers / spike
  range?: number;          // world units
  cooldownTicks?: number;  // ticks between shots / income / heal pulses
  aoeRadius?: number;      // bomb tower
  slowMul?: number;        // ice tower: speed multiplier applied
  slowTicks?: number;
  chainTargets?: number;   // lightning tower
  income?: { wood?: number; stone?: number; gold?: number }; // per cooldown pulse
  heal?: number;           // healing totem per pulse
}

export interface BuildingDef {
  size: number;                 // square footprint in cells
  unlockCastleLevel: number;    // castle level required to build
  walkable: boolean;            // gate is walkable for players
  tiers: TierStats[];
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  wood_wall: { size: 1, unlockCastleLevel: 1, walkable: false, tiers: [
    { cost: { wood: 10 }, hp: 120 },
    { cost: { wood: 30 }, hp: 300 },
    { cost: { wood: 80 }, hp: 650 },
  ]},
  stone_wall: { size: 1, unlockCastleLevel: 2, walkable: false, tiers: [
    { cost: { stone: 15 }, hp: 350 },
    { cost: { stone: 40 }, hp: 800 },
    { cost: { stone: 100 }, hp: 1600 },
  ]},
  gate: { size: 1, unlockCastleLevel: 1, walkable: true, tiers: [
    { cost: { wood: 20 }, hp: 150 },
    { cost: { wood: 50 }, hp: 380 },
    { cost: { wood: 120, stone: 30 }, hp: 800 },
  ]},
  spike: { size: 1, unlockCastleLevel: 1, walkable: false, tiers: [
    { cost: { wood: 15 }, hp: 80, dmg: 4, cooldownTicks: 10, range: 0.9 },
    { cost: { wood: 40 }, hp: 180, dmg: 9, cooldownTicks: 10, range: 0.9 },
    { cost: { wood: 90, stone: 20 }, hp: 350, dmg: 18, cooldownTicks: 10, range: 0.9 },
  ]},
  archer_tower: { size: 2, unlockCastleLevel: 1, walkable: false, tiers: [
    { cost: { wood: 50 }, hp: 250, dmg: 12, range: 9, cooldownTicks: 16 },
    { cost: { wood: 120, stone: 30 }, hp: 480, dmg: 22, range: 10, cooldownTicks: 14 },
    { cost: { wood: 250, stone: 80, gold: 20 }, hp: 900, dmg: 40, range: 11, cooldownTicks: 12 },
  ]},
  crossbow_tower: { size: 2, unlockCastleLevel: 2, walkable: false, tiers: [
    { cost: { wood: 80, stone: 20 }, hp: 300, dmg: 30, range: 12, cooldownTicks: 30 },
    { cost: { wood: 160, stone: 60 }, hp: 560, dmg: 55, range: 13, cooldownTicks: 26 },
    { cost: { wood: 320, stone: 140, gold: 40 }, hp: 1000, dmg: 100, range: 14, cooldownTicks: 22 },
  ]},
  bomb_tower: { size: 2, unlockCastleLevel: 3, walkable: false, tiers: [
    { cost: { stone: 100, gold: 10 }, hp: 350, dmg: 35, range: 8, cooldownTicks: 50, aoeRadius: 2.5 },
    { cost: { stone: 220, gold: 30 }, hp: 650, dmg: 65, range: 9, cooldownTicks: 44, aoeRadius: 3 },
    { cost: { stone: 450, gold: 80 }, hp: 1200, dmg: 120, range: 10, cooldownTicks: 38, aoeRadius: 3.5 },
  ]},
  ice_tower: { size: 2, unlockCastleLevel: 3, walkable: false, tiers: [
    { cost: { stone: 80, gold: 15 }, hp: 280, dmg: 6, range: 8, cooldownTicks: 20, slowMul: 0.6, slowTicks: 40 },
    { cost: { stone: 170, gold: 40 }, hp: 520, dmg: 12, range: 9, cooldownTicks: 18, slowMul: 0.5, slowTicks: 50 },
    { cost: { stone: 350, gold: 90 }, hp: 950, dmg: 22, range: 10, cooldownTicks: 16, slowMul: 0.4, slowTicks: 60 },
  ]},
  lightning_tower: { size: 2, unlockCastleLevel: 4, walkable: false, tiers: [
    { cost: { stone: 150, gold: 40 }, hp: 320, dmg: 20, range: 9, cooldownTicks: 36, chainTargets: 3 },
    { cost: { stone: 300, gold: 90 }, hp: 600, dmg: 35, range: 10, cooldownTicks: 32, chainTargets: 4 },
    { cost: { stone: 600, gold: 200 }, hp: 1100, dmg: 60, range: 11, cooldownTicks: 28, chainTargets: 5 },
  ]},
  gold_mine: { size: 2, unlockCastleLevel: 2, walkable: false, tiers: [
    { cost: { wood: 100, stone: 50 }, hp: 200, cooldownTicks: 100, income: { gold: 5 } },
    { cost: { wood: 200, stone: 120 }, hp: 380, cooldownTicks: 90, income: { gold: 10 } },
    { cost: { wood: 400, stone: 250 }, hp: 700, cooldownTicks: 80, income: { gold: 18 } },
  ]},
  wood_camp: { size: 2, unlockCastleLevel: 1, walkable: false, tiers: [
    { cost: { wood: 40 }, hp: 180, cooldownTicks: 100, income: { wood: 8 } },
    { cost: { wood: 100, stone: 20 }, hp: 340, cooldownTicks: 90, income: { wood: 15 } },
    { cost: { wood: 220, stone: 60 }, hp: 620, cooldownTicks: 80, income: { wood: 26 } },
  ]},
  stone_quarry: { size: 2, unlockCastleLevel: 1, walkable: false, tiers: [
    { cost: { wood: 60 }, hp: 200, cooldownTicks: 100, income: { stone: 6 } },
    { cost: { wood: 140, stone: 30 }, hp: 380, cooldownTicks: 90, income: { stone: 12 } },
    { cost: { wood: 300, stone: 80 }, hp: 700, cooldownTicks: 80, income: { stone: 22 } },
  ]},
  healing_totem: { size: 1, unlockCastleLevel: 2, walkable: false, tiers: [
    { cost: { wood: 80, gold: 10 }, hp: 150, range: 6, cooldownTicks: 20, heal: 3 },
    { cost: { wood: 160, gold: 30 }, hp: 280, range: 7, cooldownTicks: 18, heal: 6 },
    { cost: { wood: 320, gold: 70 }, hp: 500, range: 8, cooldownTicks: 16, heal: 11 },
  ]},
  castle: { size: 4, unlockCastleLevel: 1, walkable: false, tiers: [
    { cost: {}, hp: 2000 },
    { cost: { wood: 300, stone: 150 }, hp: 3500 },
    { cost: { wood: 600, stone: 400, gold: 50 }, hp: 5500 },
    { cost: { wood: 1200, stone: 800, gold: 150 }, hp: 8000 },
    { cost: { wood: 2500, stone: 1600, gold: 400 }, hp: 12000 },
  ]},
};
