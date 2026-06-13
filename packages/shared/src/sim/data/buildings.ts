import type { BuildingType } from '../types';
import type { ItemId } from './items';

export interface BuildingDef {
  size: number;
  walkable: boolean;       // gate is walkable
  hp: number;
  cost: Partial<Record<ItemId, number>>;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  wood_wall:  { size: 1, walkable: false, hp: 120, cost: { wood: 4 } },
  stone_wall: { size: 1, walkable: false, hp: 350, cost: { stone: 5 } },
  gate:       { size: 1, walkable: true,  hp: 150, cost: { wood: 6 } },
  spike:      { size: 1, walkable: false, hp: 80,  cost: { wood: 3, stone: 1 } },
};
