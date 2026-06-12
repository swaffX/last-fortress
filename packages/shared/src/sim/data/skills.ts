export type SkillBranch = 'combat' | 'engineering' | 'economy';

export interface SkillModifiers {
  playerDmgMul: number;
  playerAttackSpeedMul: number;   // divides cooldown
  critChance: number;             // 0..1
  towerDmgMul: number;
  towerRangeMul: number;
  buildCostMul: number;           // <1 = cheaper
  incomeMul: number;
  healMul: number;
  coinMul: number;
}

export function defaultModifiers(): SkillModifiers {
  return {
    playerDmgMul: 1, playerAttackSpeedMul: 1, critChance: 0,
    towerDmgMul: 1, towerRangeMul: 1, buildCostMul: 1,
    incomeMul: 1, healMul: 1, coinMul: 1,
  };
}

export interface SkillDef {
  id: string;
  branch: SkillBranch;
  name: string;
  cost: number;                   // skill points
  apply: (m: SkillModifiers) => void;
}

export const SKILLS: SkillDef[] = [
  // combat
  { id: 'cmb_dmg1',  branch: 'combat', name: 'Sharpened Steel', cost: 1, apply: m => { m.playerDmgMul *= 1.1; } },
  { id: 'cmb_spd1',  branch: 'combat', name: 'Quick Hands',     cost: 2, apply: m => { m.playerAttackSpeedMul *= 1.15; } },
  { id: 'cmb_crit1', branch: 'combat', name: 'Keen Eye',        cost: 3, apply: m => { m.critChance += 0.1; } },
  { id: 'cmb_dmg2',  branch: 'combat', name: 'Executioner',     cost: 5, apply: m => { m.playerDmgMul *= 1.2; } },
  // engineering
  { id: 'eng_twr1',  branch: 'engineering', name: 'Reinforced Mounts', cost: 1, apply: m => { m.towerDmgMul *= 1.1; } },
  { id: 'eng_rng1',  branch: 'engineering', name: 'Long Sights',       cost: 2, apply: m => { m.towerRangeMul *= 1.1; } },
  { id: 'eng_cost1', branch: 'engineering', name: 'Efficient Plans',   cost: 3, apply: m => { m.buildCostMul *= 0.9; } },
  { id: 'eng_twr2',  branch: 'engineering', name: 'Siege Doctrine',    cost: 5, apply: m => { m.towerDmgMul *= 1.2; } },
  // economy
  { id: 'eco_inc1',  branch: 'economy', name: 'Industrious',  cost: 1, apply: m => { m.incomeMul *= 1.15; } },
  { id: 'eco_coin1', branch: 'economy', name: 'Looter',       cost: 2, apply: m => { m.coinMul *= 1.2; } },
  { id: 'eco_heal1', branch: 'economy', name: 'Field Medic',  cost: 3, apply: m => { m.healMul *= 1.25; } },
  { id: 'eco_inc2',  branch: 'economy', name: 'Tycoon',       cost: 5, apply: m => { m.incomeMul *= 1.25; } },
];

export function applySkills(unlockedIds: string[]): SkillModifiers {
  const m = defaultModifiers();
  for (const id of unlockedIds) SKILLS.find(s => s.id === id)?.apply(m);
  return m;
}
