export type ItemId = 'wood' | 'stone' | 'berry';

export type ItemCategory =
  | 'resource' | 'food' | 'tool' | 'weapon' | 'armor' | 'placeable';

export interface ItemDef {
  id: ItemId;
  name: string;
  category: ItemCategory;
  stackSize: number;
  /** hunger restored when eaten — food only */
  foodValue?: number;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  wood:  { id: 'wood',  name: 'Wood',  category: 'resource', stackSize: 99 },
  stone: { id: 'stone', name: 'Stone', category: 'resource', stackSize: 99 },
  berry: { id: 'berry', name: 'Berry', category: 'food',     stackSize: 32, foodValue: 18 },
};

export interface ItemStack { item: ItemId; count: number; }

/** A fixed-length inventory slot: a stack or empty. */
export type Slot = ItemStack | null;
