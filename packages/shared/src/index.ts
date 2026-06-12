export const SHARED_VERSION = '0.1.0';
export { Sim } from './sim/sim';
export { Rng } from './sim/rng';
export { Grid } from './sim/grid';
export { generateMap, type MapData } from './sim/mapgen';
export * from './sim/types';
export * from './sim/constants';
export { BUILDINGS, type BuildingDef, type TierStats } from './sim/data/buildings';
export { ENEMIES, type EnemyDef } from './sim/data/enemies';
export { waveComposition, enemyHpScale, enemyDmgScale } from './sim/data/waves';
export { SKILLS, applySkills, defaultModifiers, type SkillDef, type SkillModifiers, type SkillBranch } from './sim/data/skills';
export { serializeState, deserializeState } from './sim/snapshot';
export { dist, buildingCenter, nearestEnemy } from './sim/combat';
export {
  riverParams, riverYAt, inRiver, onBridge,
  RIVER_WIDTH, BRIDGE_XS, BRIDGE_HALF_WIDTH, type RiverParams,
} from './sim/river';
