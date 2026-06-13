# Phase 1 — Crafting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
>
> **Testing deviation (user instruction overrides skill default):** No test suites during the build — tests come last, only when explicitly requested. Each task ends with **typecheck + build + manual/WS-smoke** verification instead.

**Goal:** Add a list-based crafting system — recipe graph, placeable crafting table, material-tiered tools and weapons with durability + repair, and a held-tool gather bonus — on top of the Phase 0 survival core.

**Architecture:** Extend the shared item registry with tools/weapons that carry per-instance `dur`. A new `data/recipes.ts` graph drives a `craft` sim command (validates inventory + crafting-table proximity, consumes inputs, produces output via a `giveItem` helper). Held tools multiply gather yield and lose durability per swing; `repair_hand` restores them. The client gains a `C`-key craft panel and durability bars on the hotbar.

**Tech Stack:** TypeScript strict monorepo — `@lf/shared`, `@lf/server`, `@lf/client`.

**Spec:** `docs/superpowers/specs/2026-06-13-phase1-crafting-design.md`
**Base:** Phase 0 is committed on branch `feat/survival-conversion`. Continue on that branch.

---

## File Structure

- `packages/shared/src/sim/data/items.ts` *(modify)* — new items, `ItemDef` tool/weapon fields, `ItemStack.dur`.
- `packages/shared/src/sim/inventory.ts` *(modify)* — `giveItem` helper; durability-aware add guard.
- `packages/shared/src/sim/data/recipes.ts` *(new)* — recipe graph + lookup.
- `packages/shared/src/sim/data/buildings.ts` *(modify)* — `crafting_table` type.
- `packages/shared/src/sim/types.ts` *(modify)* — `BuildingType += crafting_table`; `DroppedItem.dur`; `craft`/`repair_hand` commands; craft/break/repair events.
- `packages/shared/src/sim/sim.ts` *(modify)* — craft/repair logic, gather tool bonus, durability, `giveItem` use, table proximity.
- `packages/shared/src/index.ts` *(modify)* — export recipes.
- `packages/server/src/protocol.ts` *(modify)* — none structural (dur rides in `Slot`); `crafting_table` flows through existing generic checks.
- `packages/server/src/room.ts` *(modify)* — `validCommand` accepts `craft`/`repair_hand`.
- `packages/client/src/ui/craft.ts` *(new)* — craft panel.
- `packages/client/src/ui/inventory.ts` *(modify)* — durability bars on slots.
- `packages/client/src/render/models.ts` *(modify)* — weapon/stick/table icons + held weapon models.
- `packages/client/src/main.ts` *(modify)* — wire craft panel, `C` key, craft/break/repair events.
- `packages/client/src/style.css` *(modify)* — craft panel + durability bar styles.

Verification commands: `npm run -w @lf/shared typecheck`, `npm run -w @lf/server typecheck`, `npm run -w @lf/client build`.

---

## Task 1: Item registry expansion + durability + giveItem (shared)

**Files:** Modify `packages/shared/src/sim/data/items.ts`, `packages/shared/src/sim/inventory.ts`, `packages/shared/src/index.ts`.

- [ ] **Step 1: Expand the item registry**

Replace `packages/shared/src/sim/data/items.ts` with:

```ts
export type ItemId =
  | 'wood' | 'stone' | 'berry'
  | 'stick' | 'crafting_table'
  | 'wood_axe' | 'stone_axe' | 'wood_pick' | 'stone_pick'
  | 'wood_sword' | 'stone_sword' | 'wood_spear';

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
  dmg?: number;                // weapon melee damage (Phase 2 consumes it)
  durabilityMax?: number;      // uses before the item breaks
  /** when used/placed, this item becomes a building */
  placeableBuilding?: 'crafting_table';
  /** primary material for repair (half the build cost, min 1) */
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
    dmg: 18, durabilityMax: 50,  repairItem: 'wood',  repairCost: 1 },
  stone_sword:{id: 'stone_sword',name:'Stone Sword',category: 'weapon', stackSize: 1,
    dmg: 30, durabilityMax: 120, repairItem: 'stone', repairCost: 1 },
  wood_spear:{ id: 'wood_spear',name: 'Wood Spear', category: 'weapon', stackSize: 1,
    dmg: 24, durabilityMax: 70,  repairItem: 'wood',  repairCost: 1 },
};

export interface ItemStack { item: ItemId; count: number; dur?: number; }

/** A fixed-length inventory slot: a stack or empty. */
export type Slot = ItemStack | null;

/** True when this item carries per-instance durability (never stacks/merges). */
export function isDurable(item: ItemId): boolean {
  return ITEMS[item].durabilityMax !== undefined;
}
```

- [ ] **Step 2: Add the `giveItem` helper + durable guard in inventory**

In `packages/shared/src/sim/inventory.ts`, add the import of `isDurable` and `ITEMS`, and append `giveItem`. Also guard `addItem` so it never tops up a slot that carries `dur`.

Change the top of the file's import to:
```ts
import { ITEMS, isDurable, type ItemId, type Slot } from './data/items';
```

In `addItem`, change the top-up loop guard so durable stacks are skipped:
```ts
  for (const s of inv) {
    if (count <= 0) break;
    if (s && s.item === item && s.dur === undefined && s.count < max) {
      const room = max - s.count;
      const put = Math.min(room, count);
      s.count += put; count -= put;
    }
  }
```

Append at the end of the file:
```ts
/**
 * Place `count` of `item` into the inventory. Durable items go one-per-slot
 * with full durability; everything else stacks via addItem. Returns leftover.
 */
export function giveItem(inv: Slot[], item: ItemId, count: number): number {
  if (!isDurable(item)) return addItem(inv, item, count);
  const max = ITEMS[item].durabilityMax!;
  let left = count;
  for (let i = 0; i < inv.length && left > 0; i++) {
    if (inv[i] === null) { inv[i] = { item, count: 1, dur: max }; left--; }
  }
  return left;
}
```

- [ ] **Step 3: Export from index**

In `packages/shared/src/index.ts`, extend the items export and add `giveItem`:
```ts
export { ITEMS, isDurable, type ItemId, type ItemDef, type ItemCategory, type ItemStack, type Slot } from './sim/data/items';
export {
  addItem, removeItem, countItem, firstEmpty, moveSlot, emptyInventory, giveItem,
} from './sim/inventory';
```

- [ ] **Step 4: Typecheck shared**

Run: `npm run -w @lf/shared typecheck`
Expected: PASS (additive; existing call sites compile — `ItemStack.dur` is optional).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sim/data/items.ts packages/shared/src/sim/inventory.ts packages/shared/src/index.ts
git commit -m "feat(shared): tools/weapons items + durability + giveItem helper"
```

---

## Task 2: Recipe graph (shared)

**Files:** Create `packages/shared/src/sim/data/recipes.ts`; modify `packages/shared/src/index.ts`.

- [ ] **Step 1: Create the recipe module**

`packages/shared/src/sim/data/recipes.ts`:

```ts
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
```

- [ ] **Step 2: Export**

In `packages/shared/src/index.ts` add:
```ts
export { RECIPES, recipeById, type Recipe } from './sim/data/recipes';
```

- [ ] **Step 3: Typecheck shared**

Run: `npm run -w @lf/shared typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/sim/data/recipes.ts packages/shared/src/index.ts
git commit -m "feat(shared): crafting recipe graph"
```

---

## Task 3: Crafting table building + types (shared)

**Files:** Modify `packages/shared/src/sim/data/buildings.ts`, `packages/shared/src/sim/types.ts`.

- [ ] **Step 1: Add the crafting_table building**

In `packages/shared/src/sim/data/buildings.ts`, add `crafting_table` to the record. Its
`cost` is one `crafting_table` item (placement consumes the item):

```ts
export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  wood_wall:  { size: 1, walkable: false, hp: 120, cost: { wood: 4 } },
  stone_wall: { size: 1, walkable: false, hp: 350, cost: { stone: 5 } },
  gate:       { size: 1, walkable: true,  hp: 150, cost: { wood: 6 } },
  spike:      { size: 1, walkable: false, hp: 80,  cost: { wood: 3, stone: 1 } },
  crafting_table: { size: 1, walkable: false, hp: 60, cost: { crafting_table: 1 } },
};
```

- [ ] **Step 2: Extend types**

In `packages/shared/src/sim/types.ts`:

Add `crafting_table` to `BuildingType`:
```ts
export type BuildingType = 'wood_wall' | 'stone_wall' | 'gate' | 'spike' | 'crafting_table';
```

Add `dur` to `DroppedItem`:
```ts
export interface DroppedItem {
  id: EntityId;
  item: ItemId;
  count: number;
  dur?: number;
  pos: Vec2;
  ttlTicks: number;
}
```

Add the two commands to `Command`:
```ts
  | { kind: 'craft'; recipeId: string }
  | { kind: 'repair_hand' }
```

Add the three events to `SimEvent`:
```ts
  | { kind: 'craft'; pos: Vec2; item: ItemId }
  | { kind: 'tool_broke'; pos: Vec2; item: ItemId; playerId: EntityId }
  | { kind: 'repair'; pos: Vec2; playerId: EntityId }
```

- [ ] **Step 3: Typecheck shared**

Run: `npm run -w @lf/shared typecheck`
Expected: FAIL — `sim.ts` `applyCommand` switch is now non-exhaustive over `Command`
(missing `craft`/`repair_hand`) only if `noImplicitReturns`/exhaustiveness is enforced; more
importantly `BUILDINGS` literal now requires the new key (already added). Any error here is
fixed in Task 4. Do not commit yet.

> Tasks 3 and 4 are one breaking unit for the shared package. Commit after Task 4 is green.

---

## Task 4: Sim crafting, repair, gather bonus, durability (shared)

**Files:** Modify `packages/shared/src/sim/sim.ts`.

- [ ] **Step 1: Update imports**

In `packages/shared/src/sim/sim.ts`, extend the inventory + data imports:
```ts
import {
  addItem, removeItem, countItem, emptyInventory, moveSlot, giveItem,
} from './inventory';
import { ITEMS, isDurable, type ItemId, type Slot } from './data/items';
import { recipeById } from './data/recipes';
import { dist, buildingCenter } from './combat';
```
Add a constant near the other consts:
```ts
const CRAFT_TABLE_RANGE = 3.5;
```

- [ ] **Step 2: Handle the new commands in `applyCommand`**

Add two cases inside the `switch (cmd.kind)` in `applyCommand`, before the `build` case:
```ts
      case 'craft': this.craft(p, cmd.recipeId, events_unused); break;
      case 'repair_hand': this.repairHand(p); break;
```
Because `applyCommand` has no `events` array, route craft output/feedback through a queued
events approach: instead, push craft results into a new private queue drained in `step`.
Replace the two cases with queue pushes:
```ts
      case 'craft': this.craftQueue.push({ playerId, recipeId: cmd.recipeId }); break;
      case 'repair_hand': this.repairQueue.push(playerId); break;
```
Add the queues as fields near `buildQueue`:
```ts
  private craftQueue: { playerId: EntityId; recipeId: string }[] = [];
  private repairQueue: EntityId[] = [];
```

- [ ] **Step 3: Drain the queues in `step`**

In `step()`, add a `stepCraft(events)` call right after `stepBuildCommands(events)`:
```ts
    this.stepBuildCommands(events);
    this.stepCraft(events);
```

- [ ] **Step 4: Implement crafting + repair**

Add these methods to the `Sim` class (e.g. after `stepBuildCommands`):
```ts
  private nearCraftingTable(p: Player): boolean {
    for (const b of this.state.buildings.values()) {
      if (b.type !== 'crafting_table') continue;
      if (dist(buildingCenter(b.pos, 1), p.pos) <= CRAFT_TABLE_RANGE) return true;
    }
    return false;
  }

  private stepCraft(events: SimEvent[]): void {
    for (const req of this.craftQueue) {
      const p = this.state.players.get(req.playerId);
      if (!p || !p.alive) continue;
      const recipe = recipeById(req.recipeId);
      if (!recipe) continue;
      if (recipe.requiresTable && !this.nearCraftingTable(p)) continue;
      if (!recipe.inputs.every(i => countItem(p.inventory, i.item) >= i.count)) continue;
      for (const i of recipe.inputs) removeItem(p.inventory, i.item, i.count);
      const leftover = giveItem(p.inventory, recipe.output.item, recipe.output.count);
      if (leftover > 0) this.spawnGroundItem(recipe.output.item, leftover, p.pos);
      events.push({ kind: 'craft', pos: { ...p.pos }, item: recipe.output.item });
    }
    this.craftQueue.length = 0;

    for (const id of this.repairQueue) {
      const p = this.state.players.get(id);
      if (!p || !p.alive) continue;
      const s = p.inventory[p.hand];
      if (!s || !isDurable(s.item) || s.dur === undefined) continue;
      const def = ITEMS[s.item];
      if (def.durabilityMax === undefined || s.dur >= def.durabilityMax) continue;
      const mat = def.repairItem, cost = def.repairCost ?? 1;
      if (!mat || countItem(p.inventory, mat) < cost) continue;
      removeItem(p.inventory, mat, cost);
      s.dur = def.durabilityMax;
      events.push({ kind: 'repair', pos: { ...p.pos }, playerId: p.id });
    }
    this.repairQueue.length = 0;
  }
```

- [ ] **Step 5: Held-tool gather bonus + durability in `stepGather`**

Replace the body of `stepGather`'s per-hit yield section. Find:
```ts
      if (p.gatherCooldown > 0) continue;
      p.gatherCooldown = GATHER_COOLDOWN;
      const take = Math.min(BARE_HAND_YIELD, node.amount);
      node.amount -= take;
      const item = NODE_ITEM[node.kind];
      const leftover = addItem(p.inventory, item, take);
```
Replace with:
```ts
      if (p.gatherCooldown > 0) continue;
      const held = p.inventory[p.hand];
      const heldDef = held ? ITEMS[held.item] : undefined;
      const matches = !!heldDef && heldDef.toolKind ===
        (node.kind === 'tree' ? 'axe' : node.kind === 'rock' ? 'pick' : undefined);
      const mul = matches ? (heldDef!.gatherMul ?? 1) : 1;
      p.gatherCooldown = matches ? Math.max(4, Math.round(GATHER_COOLDOWN / 1.5)) : GATHER_COOLDOWN;
      const take = Math.min(BARE_HAND_YIELD * mul, node.amount);
      node.amount -= take;
      // wear the tool when it was the right tool for the job
      if (matches && held && held.dur !== undefined) {
        held.dur -= 1;
        if (held.dur <= 0) {
          const broken = held.item;
          p.inventory[p.hand] = null;
          events.push({ kind: 'tool_broke', pos: { ...p.pos }, item: broken, playerId: p.id });
        }
      }
      const item = NODE_ITEM[node.kind];
      const leftover = addItem(p.inventory, item, take);
```

- [ ] **Step 6: Carry durability through drop / pickup**

In `spawnGroundItem`, accept an optional `dur` and store it:
```ts
  private spawnGroundItem(item: ItemId, count: number, pos: Vec2, dur?: number): void {
    const id = this.state.nextId++;
    this.state.groundItems.set(id, {
      id, item, count, dur, ttlTicks: ITEM_TTL_TICKS,
      pos: { x: pos.x + (this.rng.next() - 0.5) * 0.6, y: pos.y + (this.rng.next() - 0.5) * 0.6 },
    });
  }
```
In `killPlayer`, pass the slot's `dur` when dropping:
```ts
    const drop = (s: Slot) => { if (s) this.spawnGroundItem(s.item, s.count, p.pos, s.dur); };
```
In `dropFromSlot`, pass `s.dur`:
```ts
    this.spawnGroundItem(s.item, n, { x: p.pos.x, y: p.pos.y }, s.dur);
```
In `stepGroundItems`, route durable pickups through a dur-preserving insert. Replace:
```ts
        const leftover = addItem(p.inventory, gi.item, gi.count);
        const got = gi.count - leftover;
```
with:
```ts
        let leftover: number;
        if (isDurable(gi.item)) {
          const slot = firstEmpty(p.inventory);
          if (slot < 0) { leftover = gi.count; }
          else { p.inventory[slot] = { item: gi.item, count: 1, dur: gi.dur }; leftover = gi.count - 1; }
        } else {
          leftover = addItem(p.inventory, gi.item, gi.count);
        }
        const got = gi.count - leftover;
```
Add `firstEmpty` to the inventory import in `sim.ts`:
```ts
import {
  addItem, removeItem, countItem, emptyInventory, moveSlot, giveItem, firstEmpty,
} from './inventory';
```

- [ ] **Step 7: Typecheck shared**

Run: `npm run -w @lf/shared typecheck`
Expected: PASS.

- [ ] **Step 8: Commit (Tasks 3+4)**

```bash
git add packages/shared
git commit -m "feat(shared): crafting + repair sim, held-tool gather bonus, durable drops"
```

---

## Task 5: Server command validation (server)

**Files:** Modify `packages/server/src/room.ts`.

- [ ] **Step 1: Accept the new commands in `validCommand`**

In `packages/server/src/room.ts`, add cases to `validCommand`:
```ts
    case 'craft': return typeof cmd.recipeId === 'string';
    case 'repair_hand': return true;
```
(`crafting_table` placement already validates through the existing
`case 'build': ... cmd.type in BUILDINGS` branch since it is now a BUILDINGS key.)

- [ ] **Step 2: Typecheck server**

Run: `npm run -w @lf/server typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/room.ts
git commit -m "feat(server): accept craft + repair_hand commands"
```

---

## Task 6: Client — craft panel, durability bars, models, wiring

**Files:** Create `packages/client/src/ui/craft.ts`; modify `packages/client/src/ui/inventory.ts`,
`packages/client/src/render/models.ts`, `packages/client/src/main.ts`, `packages/client/src/style.css`.

- [ ] **Step 1: Build the craft panel**

`packages/client/src/ui/craft.ts`:

```ts
import { RECIPES, ITEMS, countItem, type Recipe, type ItemId } from '@lf/shared';
import type { PlayerView } from '../net';

const ICON: Record<string, string> = {
  wood: '🪵', stone: '🧱', berry: '🫐', stick: '🪵', crafting_table: '🛠',
  wood_axe: '🪓', stone_axe: '🪓', wood_pick: '⛏', stone_pick: '⛏',
  wood_sword: '🗡', stone_sword: '⚔️', wood_spear: '🔱',
};

export interface CraftUI {
  setContext(self: PlayerView | undefined, nearTable: boolean): void;
  toggle(open?: boolean): void;
  isOpen(): boolean;
  onCraft: (recipeId: string) => void;
  onRepair: () => void;
}

export function createCraftUI(root: HTMLElement): CraftUI {
  let self: PlayerView | undefined;
  let nearTable = false;
  let open = false;

  root.className = 'craft-panel hidden';
  root.innerHTML = `<div class="cp-title">Crafting</div>
    <button class="btn ghost cp-repair" id="cp-repair">Repair held tool</button>
    <div class="cp-list" id="cp-list"></div>`;
  const list = root.querySelector('#cp-list') as HTMLElement;
  const repairBtn = root.querySelector('#cp-repair') as HTMLButtonElement;

  // one row per recipe, built once
  const rows = new Map<string, HTMLElement>();
  for (const r of RECIPES) {
    const row = document.createElement('button');
    row.className = 'cp-row';
    row.dataset.id = r.id;
    const cost = r.inputs.map(i => `${i.count}${ICON[i.item] ?? '▪'}`).join(' ');
    row.innerHTML = `<span class="cp-ico">${ICON[r.output.item] ?? '▪'}</span>
      <span class="cp-nm">${ITEMS[r.output.item].name}${r.output.count > 1 ? ` ×${r.output.count}` : ''}</span>
      <span class="cp-cost">${cost}</span>
      <span class="cp-badge">🛠</span>`;
    row.onclick = () => api.onCraft(r.id);
    list.appendChild(row);
    rows.set(r.id, row);
  }
  repairBtn.onclick = () => api.onRepair();

  function affordable(r: Recipe): boolean {
    if (!self) return false;
    if (r.requiresTable && !nearTable) return false;
    return r.inputs.every(i => countItem(self!.inventory, i.item) >= i.count);
  }

  function render(): void {
    for (const r of RECIPES) {
      const row = rows.get(r.id)!;
      row.classList.toggle('poor', !affordable(r));
      row.classList.toggle('needs-table', r.requiresTable && !nearTable);
    }
    const held = self?.inventory[self.hand];
    const repairable = !!held && ITEMS[held.item].durabilityMax !== undefined
      && held.dur !== undefined && held.dur < (ITEMS[held.item].durabilityMax ?? 0);
    repairBtn.classList.toggle('hidden', !repairable);
  }

  const api: CraftUI = {
    setContext(s, nt) { self = s; nearTable = nt; if (open) render(); },
    toggle(o?: boolean) { open = o ?? !open; root.classList.toggle('hidden', !open); if (open) render(); },
    isOpen() { return open; },
    onCraft: () => {},
    onRepair: () => {},
  };
  return api;
}
```

- [ ] **Step 2: Durability bars on hotbar/backpack slots**

In `packages/client/src/ui/inventory.ts`, import `ITEMS` and render a durability bar.
Change the import line:
```ts
import { ITEMS, HOTBAR_SLOTS, type Slot } from '@lf/shared';
```
Replace `slotHtml`:
```ts
function slotHtml(s: Slot): string {
  if (!s) return '';
  const ico = ITEM_ICON[s.item] ?? '▪';
  const max = ITEMS[s.item].durabilityMax;
  const bar = (max && s.dur !== undefined)
    ? `<span class="dur"><span class="dur-fill" style="width:${Math.max(0, (s.dur / max) * 100)}%"></span></span>`
    : '';
  return `<span class="it-ico">${ico}</span><span class="it-n">${s.count > 1 ? s.count : ''}</span>${bar}`;
}
```
Add tool/weapon icons to `ITEM_ICON`:
```ts
const ITEM_ICON: Record<string, string> = {
  wood: '🪵', stone: '🧱', berry: '🫐', stick: '🪵', crafting_table: '🛠',
  wood_axe: '🪓', stone_axe: '🪓', wood_pick: '⛏', stone_pick: '⛏',
  wood_sword: '🗡', stone_sword: '⚔️', wood_spear: '🔱',
};
```
In the hotbar `render`, the dur bar is part of `slotHtml`, but the hotbar render path
currently removes/re-adds only `.it-ico`/`.it-n`. Update it to also clear `.dur`:
```ts
      el.querySelector('.it-ico')?.remove();
      el.querySelector('.it-n')?.remove();
      el.querySelector('.dur')?.remove();
      if (s) el.insertAdjacentHTML('beforeend', slotHtml(s));
```

- [ ] **Step 3: Held weapon models + icons**

In `packages/client/src/render/models.ts`, extend `itemModel`'s color map and add a couple of
shapes so sticks/tools/weapons/tables render as ground items. Replace the `ITEM_COLOR` map and
`itemModel` body:
```ts
const ITEM_COLOR: Record<string, number> = {
  wood: 0x9c6b35, stone: 0x8d9299, berry: 0xc23a4a, stick: 0xb08a55,
  crafting_table: 0x7a5230, wood_axe: 0x9c6b35, stone_axe: 0x8d9299,
  wood_pick: 0x9c6b35, stone_pick: 0x8d9299, wood_sword: 0xb08a55,
  stone_sword: 0x9aa3ab, wood_spear: 0xb08a55,
};

export function itemModel(item: string): THREE.Group {
  const color = ITEM_COLOR[item] ?? 0xcccccc;
  let mesh: THREE.Mesh;
  if (item === 'berry') mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 7, 6), mat(color, color));
  else if (item === 'stone') mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.18), mat(color));
  else if (item === 'crafting_table') mesh = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.32), mat(color));
  else if (item.endsWith('_sword') || item === 'wood_spear') mesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.06), mat(color));
  else if (item.includes('axe') || item.includes('pick')) mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.06), mat(color));
  else mesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.18), mat(color));
  mesh.position.y = 0.3;
  const g = group(mesh);
  g.userData.bob = mesh;
  return g;
}
```

> The placed crafting table renders via `buildingModel('crafting_table', 1)`. Add a case to
> `buildingModel`'s switch:
> ```ts
>     case 'crafting_table': {
>       const top = box(0.92, 0.18, 0.92, WOOD, 0.78);
>       const legs = new THREE.Group();
>       for (const [x, z] of [[-0.36, -0.36], [0.36, -0.36], [-0.36, 0.36], [0.36, 0.36]] as const)
>         legs.add(at(box(0.1, 0.7, 0.1, WOOD_DARK, 0.35), x, 0, z));
>       const g = group(top, legs);
>       g.add(at(box(0.3, 0.06, 0.18, IRON, 0.9), 0.1, 0, 0.1));   // a saw on the bench
>       return g;
>     }
> ```

- [ ] **Step 4: Wire the craft panel into main**

In `packages/client/src/main.ts`:

Add imports + instance:
```ts
import { createCraftUI } from './ui/craft';
// near the other UI instances:
const craft = createCraftUI(document.getElementById('craft-slot')!);
```
Add a `#craft-slot` container to the HUD: in `ui/hud.ts` `innerHTML`, add `<div id="craft-slot"></div>` next to `#backpack-slot`. (List it in the same edit.)

Wire callbacks (near the inventory wiring):
```ts
craft.onCraft = recipeId => net.send({ t: 'cmd', cmd: { kind: 'craft', recipeId } });
craft.onRepair = () => net.send({ t: 'cmd', cmd: { kind: 'repair_hand' } });
```

In the `frame` handler, after `inventory.setData(...)`, compute table proximity and feed the
panel:
```ts
      if (selfView) {
        const nearTable = msg.buildings.some(b => b.type === 'crafting_table'
          && Math.hypot(b.pos.x + 0.5 - selfView!.pos.x, b.pos.y + 0.5 - selfView!.pos.y) <= 3.5);
        craft.setContext(selfView, nearTable);
      }
```

Handle the new events in the frame `for (const e of msg.events)` loop:
```ts
        if (e.kind === 'craft') hud.notify(`Crafted ${e.item.replace(/_/g, ' ')}`);
        if (e.kind === 'tool_broke' && e.playerId === selfId) hud.notify(`💥 ${e.item.replace(/_/g, ' ')} broke!`);
```

Add the `C` key + crafting-table build shortcut in the keydown handler:
```ts
  if (k === 'c') craft.toggle();
```
Extend the Escape handler to also close the craft panel:
```ts
  if (e.key === 'Escape') { hud.clearBuild(); hud.selectBuilding(null); hud.toggleBuildMenu(false); inventory.toggle(false); craft.toggle(false); }
```

> Placing a crafting table: it is a `BuildingType`, so add it to the HUD build menu list in
> `ui/hud.ts` `BUILD_ITEMS`:
> ```ts
>   { type: 'crafting_table', ico: '🛠', name: 'Table' },
> ```
> Its `costStr` shows `1🛠` (one crafting_table item), and `updateFrame` affordability already
> reads `BUILDINGS[type].cost` against the inventory — which now counts `crafting_table` items.

- [ ] **Step 5: Styles**

In `packages/client/src/style.css`, add to the pointer-events opt-in list and append panel
styles. Update the opt-in selector block to include `.craft-panel`:
```css
#hud .hotbar, #hud .hotbar *,
#hud .backpack, #hud .backpack *,
#hud .craft-panel, #hud .craft-panel *,
#hud .build-menu, #hud .build-menu *,
#hud .sel-panel .btn,
#hud .chat-input,
#hud .overlay, #hud .overlay * { pointer-events: auto; }
```
Append:
```css
.craft-panel {
  position: absolute; right: 14px; top: 120px; width: 250px;
  background: rgba(13,20,32,0.94); border: 1px solid var(--night-3);
  clip-path: var(--chamfer); padding: 12px; backdrop-filter: blur(8px);
}
.craft-panel .cp-title { color: var(--parchment); font-weight: 700; text-align: center;
  letter-spacing: 0.05em; margin-bottom: 8px; }
.craft-panel .cp-repair { width: 100%; margin-bottom: 8px; }
.craft-panel .cp-list { display: flex; flex-direction: column; gap: 4px; max-height: 50vh; overflow-y: auto; }
.cp-row { display: grid; grid-template-columns: 24px 1fr auto auto; gap: 6px; align-items: center;
  background: rgba(7,11,18,0.6); border: 1px solid var(--night-3); border-radius: 5px;
  padding: 5px 8px; cursor: pointer; color: var(--parchment); text-align: left; }
.cp-row:hover { border-color: var(--gold); }
.cp-row .cp-ico { font-size: 17px; }
.cp-row .cp-nm { font-size: 12px; }
.cp-row .cp-cost { font-size: 11px; color: var(--steel); }
.cp-row .cp-badge { font-size: 11px; opacity: 0; }
.cp-row.needs-table .cp-badge { opacity: 0.9; }
.cp-row.poor { opacity: 0.4; }
.slot .dur { position: absolute; left: 3px; right: 3px; bottom: 2px; height: 3px;
  background: rgba(0,0,0,0.6); border-radius: 2px; overflow: hidden; }
.slot .dur-fill { display: block; height: 100%; background: linear-gradient(90deg,#c43a31,#6fbf63); }
```

- [ ] **Step 6: Typecheck + build client**

Run: `npm run -w @lf/client build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/client
git commit -m "feat(client): craft panel, durability bars, table + tool models"
```

---

## Task 7: Integration verification

**Files:** none (verify only).

- [ ] **Step 1: Full typecheck + build**

Run: `npm run typecheck` then `npm run -w @lf/client build`
Expected: all PASS.

- [ ] **Step 2: WS smoke — craft chain + tool bonus + durability**

Boot the server on a spare port (`PORT=8099 npm run -w @lf/server start`) and run a Node WS bot
that: connects → `hello` → `create_lobby {solo:true}` → on `game_start`, walks to a tree → bare-
hand gathers ~6 wood → `craft {recipeId:'stick'}` → `craft {recipeId:'crafting_table'}` →
place it via `build {type:'crafting_table'}` at the player's cell → `craft {recipeId:'wood_axe'}`
→ verify the hotbar slot holds `wood_axe` with `dur` → select it as hand → gather a tree and
assert the wood yield jumps (×2) and `dur` decreases. Print SUCCESS with the final inventory.

Expected: SUCCESS line shows `wood_axe` crafted, dur < max after gathering, wood gained per hit ≥ 2.

- [ ] **Step 3: Report**

Summarize: crafting chain works end-to-end (stick → table → axe), held axe doubles wood yield
and wears down, repair restores durability. Note Phase 1 is ready for local browser testing and
(with Phase 0) deploy.

---

## Self-Review

**Spec coverage:**
- Item registry expansion (sticks/tools/weapons/table, tool fields) → Task 1. ✓
- Per-instance durability (`ItemStack.dur`, no-merge, break) → Task 1 (`dur`, addItem guard, isDurable), Task 4 (decrement/break). ✓
- Recipe graph + list → Task 2 (`recipes.ts`), Task 6 (panel). ✓
- Crafting table as placeable building + proximity → Task 3 (building), Task 4 (`nearCraftingTable`, `CRAFT_TABLE_RANGE`), Task 6 (build-menu entry + client proximity). ✓
- Gather bonus from held tool → Task 4 (`stepGather` mul + cooldown). ✓
- `craft` / `repair_hand` commands + craft/break/repair events → Task 3 (types), Task 4 (logic), Task 5 (validation). ✓
- `giveItem` for durable output → Task 1 (helper), Task 4 (use). ✓
- Durable drop/pickup carries dur → Task 4 Step 6. ✓
- Client craft panel, durability bars, models, events, C key → Task 6. ✓
- Inventory-full craft output drops to ground → Task 4 (`leftover > 0` → spawnGroundItem). ✓

**Type consistency:** `ItemStack.dur` (Task 1) read in Tasks 4/6. `giveItem`/`isDurable`/`firstEmpty` imported where used. `recipeById` (Task 2) used in Task 4. `crafting_table` is both an `ItemId` (Task 1) and a `BuildingType` (Task 3) — intentional: the item places the building. `CraftUI.setContext(self, nearTable)` (Task 6 Step 1) called with the same shape in Step 4. Events `craft`/`tool_broke`/`repair` (Task 3) emitted in Task 4 and read in Task 6. ✓

**Placeholder scan:** No TBD/TODO. Task 4 Step 2 first shows a wrong `events_unused` formulation then immediately corrects it to the queue approach — implement the queue version (the corrected block), matching `stepCraft` in Step 4. ✓
