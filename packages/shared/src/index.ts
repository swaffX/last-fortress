export const SHARED_VERSION = '0.1.0';
export {
  Sim, combatUpgradeCost, combatDmgMul, combatSpeedMul, TOOL_UPGRADE_COSTS,
} from './sim/sim';
export { Rng } from './sim/rng';
export { Grid } from './sim/grid';
export { generateMap, type MapData } from './sim/mapgen';
export * from './sim/types';
export * from './sim/constants';
export { BUILDINGS, type BuildingDef, type TierStats } from './sim/data/buildings';
export { ENEMIES, type EnemyDef } from './sim/data/enemies';
export { waveComposition, enemyHpScale, enemyDmgScale } from './sim/data/waves';
export { SKILLS, applySkills, defaultModifiers, type SkillDef, type SkillModifiers, type SkillBranch } from './sim/data/skills';
export { UPGRADE_CHOICES, type UpgradeDef } from './sim/data/upgrades';
export { generateDecor, decorBlocks, type Decor, type DecorKind } from './sim/decor';
export { serializeState, deserializeState } from './sim/snapshot';
export { dist, buildingCenter, nearestEnemy } from './sim/combat';
export {
  riverParams, riverYAt, inRiver, inRiverBand, onBridge, crossesBridgeRail,
  RIVER_WIDTH, BRIDGE_XS, BRIDGE_HALF_WIDTH, type RiverParams,
} from './sim/river';
