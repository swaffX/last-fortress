export type ItemId =
  | 'wood' | 'stone' | 'berry'
  | 'stick' | 'crafting_table'
  | 'wood_axe' | 'stone_axe' | 'wood_pick' | 'stone_pick'
  | 'wood_sword' | 'stone_sword' | 'wood_spear'
  | 'raw_meat' | 'leather' | 'wool' | 'silk' | 'pelt' | 'feather' | 'hide' | 'bone' | 'venom'
  | 'katana' | 'war_spear' | 'mage_staff';

export type ItemCategory =
  | 'resource' | 'food' | 'tool' | 'weapon' | 'armor' | 'placeable';

export interface ItemDef {
  id: ItemId;
  name: string;
  category: ItemCategory;
  stackSize: number;
  foodValue?: number;
  toolKind?: 'axe' | 'pick';   // node this tool speeds up
  gatherMul?: number;          // yield/speed multiplier vs bare hand
  dmg?: number;                // weapon melee damage
  reach?: number;              // melee arc length (weapons); default 2.2
  ranged?: boolean;            // fires a projectile on swing instead of an arc
  durabilityMax?: number;      // uses before the item breaks
  /** when used/placed, this item becomes a building */
  placeableBuilding?: 'crafting_table';
  /** primary material for repair (and how much it costs) */
  repairItem?: ItemId;
  repairCost?: number;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  wood:  { id: 'wood',  name: 'Wood',  category: 'resource', stackSize: 99 },
  stone: { id: 'stone', name: 'Stone', category: 'resource', stackSize: 99 },
  berry: { id: 'berry', name: 'Berry', category: 'food', stackSize: 32, foodValue: 18 },
  stick: { id: 'stick', name: 'Stick', category: 'resource', stackSize: 99 },
  crafting_table: { id: 'crafting_table', name: 'Crafting Table', category: 'placeable',
    stackSize: 8, placeableBuilding: 'crafting_table' },
  wood_axe:  { id: 'wood_axe',  name: 'Wood Axe',  category: 'tool', stackSize: 1,
    toolKind: 'axe',  gatherMul: 2, durabilityMax: 60,  repairItem: 'wood',  repairCost: 2 },
  stone_axe: { id: 'stone_axe', name: 'Stone Axe', category: 'tool', stackSize: 1,
    toolKind: 'axe',  gatherMul: 3, durabilityMax: 140, repairItem: 'stone', repairCost: 2 },
  wood_pick: { id: 'wood_pick', name: 'Wood Pickaxe', category: 'tool', stackSize: 1,
    toolKind: 'pick', gatherMul: 2, durabilityMax: 60,  repairItem: 'wood',  repairCost: 2 },
  stone_pick:{ id: 'stone_pick',name: 'Stone Pickaxe',category: 'tool', stackSize: 1,
    toolKind: 'pick', gatherMul: 3, durabilityMax: 140, repairItem: 'stone', repairCost: 2 },
  wood_sword:{ id: 'wood_sword',name: 'Wood Sword', category: 'weapon', stackSize: 1,
    dmg: 18, reach: 2.0, durabilityMax: 50,  repairItem: 'wood',  repairCost: 1 },
  stone_sword:{id: 'stone_sword',name:'Stone Sword',category: 'weapon', stackSize: 1,
    dmg: 30, reach: 2.2, durabilityMax: 120, repairItem: 'stone', repairCost: 1 },
  wood_spear:{ id: 'wood_spear',name: 'Wood Spear', category: 'weapon', stackSize: 1,
    dmg: 24, reach: 2.8, durabilityMax: 70,  repairItem: 'wood',  repairCost: 1 },
  raw_meat: { id: 'raw_meat', name: 'Raw Meat', category: 'food', stackSize: 16, foodValue: 10 },
  leather: { id: 'leather', name: 'Leather', category: 'resource', stackSize: 64 },
  wool:    { id: 'wool',    name: 'Wool',    category: 'resource', stackSize: 64 },
  silk:    { id: 'silk',    name: 'Silk',    category: 'resource', stackSize: 64 },
  pelt:    { id: 'pelt',    name: 'Fur Pelt',category: 'resource', stackSize: 64 },
  feather: { id: 'feather', name: 'Feather', category: 'resource', stackSize: 64 },
  hide:    { id: 'hide',    name: 'Hide',    category: 'resource', stackSize: 64 },
  bone:    { id: 'bone',    name: 'Bone',    category: 'resource', stackSize: 64 },
  venom:   { id: 'venom',   name: 'Venom',   category: 'resource', stackSize: 64 },
  katana:  { id: 'katana',  name: 'Katana',  category: 'weapon', stackSize: 1, dmg: 48, reach: 2.4, durabilityMax: 220, repairItem: 'stone', repairCost: 2 },
  war_spear:{ id: 'war_spear', name: 'War Spear', category: 'weapon', stackSize: 1, dmg: 40, reach: 3.0, durabilityMax: 200, repairItem: 'stone', repairCost: 2 },
  mage_staff:{ id: 'mage_staff', name: 'Mage Staff', category: 'weapon', stackSize: 1, dmg: 44, ranged: true, durabilityMax: 160, repairItem: 'bone', repairCost: 2 },
};

export interface ItemStack { item: ItemId; count: number; dur?: number; }

/** A fixed-length inventory slot: a stack or empty. */
export type Slot = ItemStack | null;

/** True when this item carries per-instance durability (never stacks/merges). */
export function isDurable(item: ItemId): boolean {
  return ITEMS[item].durabilityMax !== undefined;
}
