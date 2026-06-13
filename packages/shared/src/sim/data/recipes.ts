import type { ItemId } from './items';

export interface Recipe {
  id: string;
  output: { item: ItemId; count: number };
  inputs: { item: ItemId; count: number }[];
  requiresTable: boolean;
}

export const RECIPES: Recipe[] = [
  { id: 'stick', output: { item: 'stick', count: 2 },
    inputs: [{ item: 'wood', count: 1 }], requiresTable: false },
  { id: 'crafting_table', output: { item: 'crafting_table', count: 1 },
    inputs: [{ item: 'wood', count: 4 }], requiresTable: false },
  { id: 'wood_axe', output: { item: 'wood_axe', count: 1 },
    inputs: [{ item: 'wood', count: 3 }, { item: 'stick', count: 2 }], requiresTable: true },
  { id: 'wood_pick', output: { item: 'wood_pick', count: 1 },
    inputs: [{ item: 'wood', count: 3 }, { item: 'stick', count: 2 }], requiresTable: true },
  { id: 'stone_axe', output: { item: 'stone_axe', count: 1 },
    inputs: [{ item: 'stone', count: 3 }, { item: 'stick', count: 2 }], requiresTable: true },
  { id: 'stone_pick', output: { item: 'stone_pick', count: 1 },
    inputs: [{ item: 'stone', count: 3 }, { item: 'stick', count: 2 }], requiresTable: true },
  { id: 'wood_sword', output: { item: 'wood_sword', count: 1 },
    inputs: [{ item: 'wood', count: 2 }, { item: 'stick', count: 1 }], requiresTable: true },
  { id: 'stone_sword', output: { item: 'stone_sword', count: 1 },
    inputs: [{ item: 'stone', count: 2 }, { item: 'stick', count: 1 }], requiresTable: true },
  { id: 'wood_spear', output: { item: 'wood_spear', count: 1 },
    inputs: [{ item: 'wood', count: 1 }, { item: 'stick', count: 2 }], requiresTable: true },
];

export function recipeById(id: string): Recipe | undefined {
  return RECIPES.find(r => r.id === id);
}
