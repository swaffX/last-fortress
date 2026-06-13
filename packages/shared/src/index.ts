export const SHARED_VERSION = '0.1.0';
export { Sim } from './sim/sim';
export { Rng } from './sim/rng';
export { Grid } from './sim/grid';
export { generateMap, type MapData } from './sim/mapgen';
export { ITEMS, isDurable, type ItemId, type ItemDef, type ItemCategory, type ItemStack, type Slot } from './sim/data/items';
export {
  addItem, removeItem, countItem, firstEmpty, moveSlot, emptyInventory, giveItem,
} from './sim/inventory';
export { RECIPES, recipeById, type Recipe } from './sim/data/recipes';
export { generateRegions, regionAt, type Region, type RegionMap, type Biome } from './sim/regions';
export * from './sim/types';
export * from './sim/constants';
export { BUILDINGS, type BuildingDef } from './sim/data/buildings';
export { SKILLS, applySkills, defaultModifiers, type SkillDef, type SkillModifiers, type SkillBranch } from './sim/data/skills';
export { generateDecor, decorBlocks, type Decor, type DecorKind } from './sim/decor';
export { serializeState, deserializeState } from './sim/snapshot';
export { dist, buildingCenter } from './sim/combat';
export {
  riverParams, riverYAt, inRiver, inRiverBand, onBridge, crossesBridgeRail,
  RIVER_WIDTH, BRIDGE_XS, BRIDGE_HALF_WIDTH, type RiverParams,
} from './sim/river';
