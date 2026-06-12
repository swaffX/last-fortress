import { describe, it, expect } from 'vitest';
import { BUILDINGS, type BuildingDef } from '../src/sim/data/buildings';
import { ENEMIES } from '../src/sim/data/enemies';
import { waveComposition, enemyHpScale, enemyDmgScale } from '../src/sim/data/waves';
import { Rng } from '../src/sim/rng';

describe('building data', () => {
  it('every non-castle building has 3 tiers; castle has 5', () => {
    for (const [type, def] of Object.entries(BUILDINGS) as [string, BuildingDef][]) {
      expect(def.tiers.length).toBe(type === 'castle' ? 5 : 3);
    }
  });
  it('tier stats are monotonically non-decreasing in hp', () => {
    for (const def of Object.values(BUILDINGS)) {
      for (let i = 1; i < def.tiers.length; i++) {
        expect(def.tiers[i]!.hp).toBeGreaterThanOrEqual(def.tiers[i - 1]!.hp);
      }
    }
  });
});

describe('enemy data', () => {
  it('defines all six enemy types', () => {
    expect(Object.keys(ENEMIES).sort()).toEqual(
      ['butcher', 'exploding', 'fast', 'normal', 'spitter', 'tank']);
  });
});

describe('waves', () => {
  it('wave 10 contains the butcher boss', () => {
    const comp = waveComposition(10, new Rng(1));
    expect(comp.some(s => s.type === 'butcher')).toBe(true);
  });
  it('non-boss waves contain no boss', () => {
    const comp = waveComposition(7, new Rng(1));
    expect(comp.every(s => s.type !== 'butcher')).toBe(true);
  });
  it('enemy count grows with wave number', () => {
    const c3 = waveComposition(3, new Rng(1)).length;
    const c13 = waveComposition(13, new Rng(1)).length;
    expect(c13).toBeGreaterThan(c3);
  });
  it('hp/dmg scaling grows without bound', () => {
    expect(enemyHpScale(50)).toBeGreaterThan(enemyHpScale(10));
    expect(enemyDmgScale(50)).toBeGreaterThan(enemyDmgScale(10));
  });
});
