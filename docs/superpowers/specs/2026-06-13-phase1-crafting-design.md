# Phase 1 — Crafting System Design

**Date:** 2026-06-13
**Status:** Approved
**Builds on:** `2026-06-13-survival-conversion-design.md` (Phase 0 — Survival Core)

Phase 1 adds a list-based crafting system on top of the Phase 0 survival core: a recipe
graph, a placeable crafting table, material-tiered tools and weapons, tool durability with
repair, and gather bonuses from the held tool. It is one focused implementation plan.

---

## Locked Decisions

| Decision | Choice |
|---|---|
| Craft UI | **List-based recipe menu** (select → craft if materials present). Crafting table unlocks advanced recipes; basics are hand-crafted anywhere. |
| Durability | **Yes** — tools/weapons wear down and break; repaired with their primary material. |
| Weapons | **Craftable in Phase 1** — held items with a `dmg` stat and durability; damage has no target until Phase 2, so they are inert-but-ready. |

---

## Components

### 1. Item registry expansion (`packages/shared/src/sim/data/items.ts`)

New `ItemId`s and metadata fields. Tools and weapons are non-stacking (stackSize 1) and
carry per-instance durability.

New items: `stick`, `crafting_table`, `wood_axe`, `stone_axe`, `wood_pick`, `stone_pick`,
`wood_sword`, `stone_sword`, `wood_spear`.

New `ItemDef` fields (all optional, only on tools/weapons):
- `toolKind?: 'axe' | 'pick'` — which node it speeds up.
- `gatherMul?: number` — yield/speed multiplier vs bare hand (wood tier 2, stone tier 3).
- `dmg?: number` — melee damage (weapons; consumed by Phase 2 combat).
- `durabilityMax?: number` — uses before the item breaks.
- `placeableBuilding?: BuildingType` — `crafting_table` places a building when used.

### 2. Per-instance durability (`ItemStack`)

Extend `ItemStack` (in `items.ts`) with optional `dur?: number` (remaining durability).
Tools/weapons spawn with `dur = durabilityMax`. `inventory.addItem` must NOT merge stacks
that carry `dur` (durability is per-instance; tools never stack — enforced by `stackSize: 1`
plus an explicit "don't merge dur-bearing stacks" guard). When `dur` reaches 0 the item is
removed and a `tool_broke` event fires.

### 3. Recipe graph (`packages/shared/src/sim/data/recipes.ts`, new)

```ts
export interface Recipe {
  id: string;
  output: { item: ItemId; count: number };
  inputs: { item: ItemId; count: number }[];
  requiresTable: boolean;   // must stand near a placed crafting_table
}
```

Recipe set (balanced):
- `stick` — 1 `wood` → 2 `stick` (hand)
- `crafting_table` — 4 `wood` → 1 `crafting_table` (hand)
- `wood_axe` — 3 `wood` + 2 `stick` (table)
- `wood_pick` — 3 `wood` + 2 `stick` (table)
- `stone_axe` — 3 `stone` + 2 `stick` (table)
- `stone_pick` — 3 `stone` + 2 `stick` (table)
- `wood_sword` — 2 `wood` + 1 `stick` (table)
- `stone_sword` — 2 `stone` + 1 `stick` (table)
- `wood_spear` — 1 `wood` + 2 `stick` (table)

Tool stats: wood tools `gatherMul 2, durabilityMax 60`; stone tools `gatherMul 3,
durabilityMax 140`. Weapons: `wood_sword dmg 18 dur 50`, `stone_sword dmg 30 dur 120`,
`wood_spear dmg 24 dur 70`.

### 4. Crafting table as a placeable building (`data/buildings.ts`)

Add `crafting_table` to `BuildingType` and `BUILDINGS` (size 1, non-walkable, hp 60,
cost — placed via the `crafting_table` *item*, not inventory resources). Placement: using the
`crafting_table` item (drop-to-place) or via the build menu in "station" mode. Simpler: the
crafting table is placed through the existing build flow, but its "cost" is one
`crafting_table` item consumed from inventory. `CRAFT_TABLE_RANGE = 3.5` — recipes with
`requiresTable` need a placed table within range of the player.

### 5. Gather bonus from held tool (`sim.ts` `stepGather`)

When a player gathers, read the hand slot. If it holds a tool whose `toolKind` matches the
node (axe↔tree, pick↔rock; berries always hand-picked), apply its `gatherMul` to the yield
and shorten the cooldown proportionally, and decrement the tool's `dur` by 1 per hit. Bare
hand keeps the Phase 0 yield of 1. On `dur` 0, remove the tool and emit `tool_broke`.

### 6. New sim commands & events (`types.ts`)

```ts
| { kind: 'craft'; recipeId: string }
| { kind: 'repair_hand' }              // repair the held tool with its primary material
```

`repair_hand`: if the hand holds a damaged tool and the inventory has ≥ `repairCost`
(half the tool's primary input, min 1) of its primary material, consume it and restore
`dur` to `durabilityMax`.

New events: `{ kind: 'craft'; pos; item: ItemId }`, `{ kind: 'tool_broke'; pos; item: ItemId; playerId }`,
`{ kind: 'repair'; pos; playerId }`.

### 7. Sim crafting logic (`sim.ts`)

`applyCommand('craft')`: look up the recipe; verify every input is present via `countItem`;
if `requiresTable`, verify a `crafting_table` building is within `CRAFT_TABLE_RANGE`; remove
inputs; add output via `addItem` (tools spawn with `dur = durabilityMax`, written directly
into the first empty slot since `addItem` won't carry dur). Emit `craft`. Reject silently if
unmet.

A small helper `giveItem(player, item, count)` centralizes adding output — for dur-bearing
items it writes a fresh `{ item, count: 1, dur: durabilityMax }` into `firstEmpty`; otherwise
delegates to `addItem`.

### 8. Server (`protocol.ts`, `room.ts`)

- `validCommand` accepts `craft` (string `recipeId`) and `repair_hand`.
- `crafting_table` added to the `BUILDINGS` check (already generic via `cmd.type in BUILDINGS`).
- `PlayerView` already carries `inventory` with the extended `Slot` (dur travels in JSON).
- No new server message types — craft/repair/break surface through the existing `frame`
  events array.

### 9. Client (`packages/client`)

- **Craft panel** (`ui/craft.ts`, new): `C` key toggles a recipe list. Each row shows the
  output icon/name, the input costs (dimmed when unaffordable from the local inventory), a
  "needs 🛠 table" badge when `requiresTable` and no table is in range, and a Craft button →
  `craft` command. A Repair button appears when the hand holds a damaged tool → `repair_hand`.
- **Hotbar durability** (`ui/inventory.ts`): tool/weapon slots show a thin durability bar
  (green→red) from `dur / durabilityMax`.
- **Models** (`render/models.ts`): extend `toolModel` and add held weapon models (sword,
  spear); `itemModel` gains icons for sticks/tools/weapons/crafting table.
- **Render** (`render/world.ts`): a placed `crafting_table` renders as a workbench (via
  `buildingModel`). The held tool already swaps in on gather; weapons show on a future attack.
- **Events** (`main.ts`): `craft` → pop + sfx; `tool_broke` → notify + snap sfx; `repair` →
  sfx. Craft-table proximity for the panel badge computed client-side from building list.
- **Input** (`input.ts`/`main.ts`): `C` toggles craft panel; placing a crafting table reuses
  the build ghost flow with the `crafting_table` type.

### Error handling
- Craft with missing inputs / no table in range → server rejects, client greys the row.
- Inventory full on craft output → output drops as a ground item (reuse `spawnGroundItem`).
- Repair with no material or undamaged tool → no-op.
- Durability underflow → clamped at 0, item removed exactly once.

### Out of scope (later phases)
Real combat targets (Phase 2), metal/iron tiers, furnace/smelting (Phase 3), advanced
stations, shaped-grid crafting.

### Testing
Per standing instruction, tests are written only when explicitly requested. Verify with
`tsc` + `vite build` + a WS smoke (craft a stick → crafting_table → wood_axe; gather with the
axe shows higher yield + durability drop; repair restores it).
