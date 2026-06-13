import type { ItemId } from './items';

export interface Recipe {
  id: string;
  output: { item: ItemId; count: number };
  inputs: { item: ItemId; count: number }[];
  requiresTable: boolean;
  /** short wiki-style how-to shown in the craft detail pane */
  desc: string;
}

export const RECIPES: Recipe[] = [
  { id: 'stick', output: { item: 'stick', count: 2 },
    inputs: [{ item: 'wood', count: 1 }], requiresTable: false,
    desc: 'Split a log into two sturdy sticks — the handle of every tool. Craftable by hand, anywhere.' },
  { id: 'crafting_table', output: { item: 'crafting_table', count: 1 },
    inputs: [{ item: 'wood', count: 4 }], requiresTable: false,
    desc: 'A workbench for serious gear. Craft it by hand, place it in the world, then stand near it to unlock the advanced recipes.' },
  { id: 'wood_axe', output: { item: 'wood_axe', count: 1 },
    inputs: [{ item: 'wood', count: 3 }, { item: 'stick', count: 2 }], requiresTable: true,
    desc: 'Hold it to fell trees twice as fast. Wears down each swing — repair it with wood when the bar runs low.' },
  { id: 'wood_pick', output: { item: 'wood_pick', count: 1 },
    inputs: [{ item: 'wood', count: 3 }, { item: 'stick', count: 2 }], requiresTable: true,
    desc: 'Hold it to mine stone twice as fast. Repair with wood as the durability bar drains.' },
  { id: 'stone_axe', output: { item: 'stone_axe', count: 1 },
    inputs: [{ item: 'stone', count: 3 }, { item: 'stick', count: 2 }], requiresTable: true,
    desc: 'A harder axe: triple wood yield and far more durable. Repaired with stone.' },
  { id: 'stone_pick', output: { item: 'stone_pick', count: 1 },
    inputs: [{ item: 'stone', count: 3 }, { item: 'stick', count: 2 }], requiresTable: true,
    desc: 'A harder pickaxe: triple stone yield and far more durable. Repaired with stone.' },
  { id: 'wood_sword', output: { item: 'wood_sword', count: 1 },
    inputs: [{ item: 'wood', count: 2 }, { item: 'stick', count: 1 }], requiresTable: true,
    desc: 'A crude blade. It will matter once threats prowl the dark — keep one on your belt.' },
  { id: 'stone_sword', output: { item: 'stone_sword', count: 1 },
    inputs: [{ item: 'stone', count: 2 }, { item: 'stick', count: 1 }], requiresTable: true,
    desc: 'A heavier blade — hits harder and lasts longer than its wooden cousin.' },
  { id: 'wood_spear', output: { item: 'wood_spear', count: 1 },
    inputs: [{ item: 'wood', count: 1 }, { item: 'stick', count: 2 }], requiresTable: true,
    desc: 'Long reach keeps danger at arm’s length. Cheap to make, easy to replace.' },
];

export function recipeById(id: string): Recipe | undefined {
  return RECIPES.find(r => r.id === id);
}
