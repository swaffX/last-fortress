import type { Biome } from '../regions';
import type { Faction } from './creatures';

export type Danger = 'safe' | 'neutral' | 'danger';

export const BIOME_DANGER: Record<Biome, Danger> = {
  meadow: 'safe', plains: 'safe',
  forest: 'neutral', tundra: 'neutral',
  swamp: 'danger', mountains: 'danger', badlands: 'danger',
};

export const POOLS: Record<Faction, string[]> = {
  animal: ['cow', 'sheep', 'pig', 'chicken', 'rabbit', 'wolf', 'boar', 'bear', 'spider', 'snake'],
  bandit: ['bandit_sword', 'bandit_dagger', 'bandit_spear', 'bandit_mage'],
  zombie: ['zombie', 'zombie_fast', 'zombie_brute'],
  boss:   ['warlock', 'butcher', 'spider_queen'],
};

export const HERBIVORES = ['cow', 'sheep', 'pig', 'chicken', 'rabbit'];
export const PREDATORS = ['wolf', 'boar', 'bear', 'spider', 'snake'];

export interface SpawnTarget { faction: Faction; species: string[]; count: number; }

/**
 * Target populations for a biome given the phase. Counts are per-biome soft caps;
 * the sim tops up toward them and despawns the excess/far creatures.
 */
export function spawnPlan(biome: Biome, phase: 'day' | 'night'): SpawnTarget[] {
  const danger = BIOME_DANGER[biome] ?? 'neutral';
  const out: SpawnTarget[] = [];
  if (phase === 'day') {
    if (danger === 'safe') out.push({ faction: 'animal', species: HERBIVORES, count: 6 });
    else if (danger === 'neutral') out.push({ faction: 'animal', species: [...HERBIVORES, ...PREDATORS], count: 5 });
    else {
      out.push({ faction: 'animal', species: PREDATORS, count: 3 });
      out.push({ faction: 'bandit', species: POOLS.bandit, count: 3 });
    }
  } else {
    if (danger === 'safe') out.push({ faction: 'zombie', species: ['zombie'], count: 3 });
    else if (danger === 'neutral') out.push({ faction: 'zombie', species: ['zombie', 'zombie_fast'], count: 6 });
    else out.push({ faction: 'zombie', species: POOLS.zombie, count: 10 });
  }
  return out;
}
