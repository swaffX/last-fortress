# Phase 0 — Survival Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Testing deviation (user instruction overrides skill default):** The project owner has a standing rule — *no test suites are written during the build; tests come last, only when explicitly requested.* This plan therefore replaces the skill's TDD steps with **typecheck + build + manual verification** checkpoints. Pure modules (`inventory.ts`, `regions.ts`) are written test-friendly for when tests are later requested.

**Goal:** Convert the wave-defense arena into a persistent, 4-player, open-world survival foundation — real per-player item inventory, empty-handed start, hunger + health, large multi-biome map, death→drop→camp-respawn, structures priced from inventory — with the wave/gold/coins/tower/council machinery removed.

**Architecture:** Keep the deterministic shared-sim authority model. Add an item layer (`data/items.ts` + `inventory.ts`) that the `Player` carries; resources stop being a team counter and live in inventories. World is generated once from `worldSeed` into named biome regions, enlarged ~8×, and the whole `SimState` is serialized to a new Postgres `worlds` table so a party resumes where it left off. The server room loses the wave loop and gains world load/save; the client gains a hotbar + backpack inventory UI and a hunger bar.

**Tech Stack:** TypeScript (strict) monorepo — `@lf/shared` (sim), `@lf/server` (ws + pg), `@lf/client` (Three.js + Vite). No new runtime deps.

**Spec:** `docs/superpowers/specs/2026-06-13-survival-conversion-design.md`

---

## File Structure (what changes and why)

**Shared (`packages/shared/src/sim`)**
- `data/items.ts` *(new)* — `ItemId`, `ItemDef`, `ITEMS` registry, `ItemStack`.
- `inventory.ts` *(new)* — pure inventory ops on `(ItemStack|null)[]`.
- `regions.ts` *(new)* — biome partition + `regionAt`, deterministic from seed.
- `types.ts` *(rework)* — `Player`/`SimState`/`Command`/`SimEvent`/`ResourceNode` survival shape; drop `Resources`, `ClassType`/`WeaponType` usage in state.
- `constants.ts` *(rework)* — enlarge map, add hunger/inventory/camp/day-night constants; drop gold/coins start.
- `data/buildings.ts` *(rework)* — prune to `wood_wall/stone_wall/gate/spike`, single-tier, item costs.
- `mapgen.ts` *(rework)* — biome-aware node placement, bushes, no castle clear-ring (camp clear-ring instead).
- `sim.ts` *(rework)* — inventory gather, hunger, death-drop, ground items, item-priced build, continuous day/night; remove waves/towers/income/economy/votes.
- `snapshot.ts` *(rework)* — serialize `groundItems`; load helper rebuilding grid.
- `economy.ts` *(delete)* — replaced by inventory.
- `index.ts` *(rework)* — export new modules, drop removed ones.

**Server (`packages/server/src`)**
- `world-store.ts` *(new)* — `WorldStore` (Pg + Memory), `worlds` table, save/load party world.
- `protocol.ts` *(rework)* — inventory/hunger views, ground items, new commands, drop wave/vote msgs.
- `room.ts` *(rework)* — 4 seats, world load/save, no wave/vote/restart loop, item-aware command validation.
- `db.ts` *(rework)* — keep profile store; init `worlds` table via `WorldStore`.
- `lobby.ts` *(rework)* — party-keyed persistence id; 4-player joinable.
- `index.ts` *(rework)* — drop `vote`/`restart_vote` routing; route new commands.

**Client (`packages/client/src`)**
- `ui/inventory.ts` *(new)* — hotbar + backpack + equipment, drag-drop.
- `ui/hud.ts` *(rework)* — health + hunger bars; build menu lists wall/gate/spike at item cost; drop wave/gold/coins/council.
- `net.ts` *(rework)* — new client/server message shapes.
- `main.ts` *(rework)* — inventory/hunger from frames, hotbar select, eat/pickup, region toast.
- `input.ts` *(rework)* — number keys/wheel → `select_hand`, `I` toggle inventory, `E` context (gather/pickup/eat).
- `render/world.ts`, `render/scene.ts`, `render/environment.ts` *(rework)* — ground-item meshes, enlarged world + frustum cull, biome tint; drop tower/enemy-only assets kept dormant.

---

## Conventions used below

- Shared typecheck: `npm run -w @lf/shared typecheck` (falls back to `npx tsc -p packages/shared` if no script).
- Server typecheck: `npm run -w @lf/server typecheck`.
- Client build: `npm run -w @lf/client build`.
- Full check: `npm run typecheck` at repo root if present, else per-package.
- Verify the exact script names first: `Read packages/shared/package.json` etc. Use whatever `scripts` exist; the commands above are the expected names.

> A types rework that removes fields necessarily breaks consumers until they are updated. Tasks are ordered so each **package** reaches a green typecheck at its task boundary, even though intermediate files inside a task are temporarily broken. Do not commit mid-task with red typecheck.

---

## Task 1: Item registry + inventory module (shared, additive)

**Files:**
- Create: `packages/shared/src/sim/data/items.ts`
- Create: `packages/shared/src/sim/inventory.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create the item registry**

`packages/shared/src/sim/data/items.ts`:

```ts
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
```

- [ ] **Step 2: Create the pure inventory module**

`packages/shared/src/sim/inventory.ts`:

```ts
import { ITEMS, type ItemId, type Slot } from './data/items';

/** Add `count` of `item`; returns the leftover that did not fit. */
export function addItem(inv: Slot[], item: ItemId, count: number): number {
  const max = ITEMS[item].stackSize;
  // top up existing stacks first
  for (const s of inv) {
    if (count <= 0) break;
    if (s && s.item === item && s.count < max) {
      const room = max - s.count;
      const put = Math.min(room, count);
      s.count += put; count -= put;
    }
  }
  // then fill empty slots
  for (let i = 0; i < inv.length && count > 0; i++) {
    if (inv[i] === null) {
      const put = Math.min(max, count);
      inv[i] = { item, count: put }; count -= put;
    }
  }
  return count;
}

/** Remove `count` of `item`; returns true only if the full amount was removed. */
export function removeItem(inv: Slot[], item: ItemId, count: number): boolean {
  if (countItem(inv, item) < count) return false;
  for (let i = 0; i < inv.length && count > 0; i++) {
    const s = inv[i];
    if (s && s.item === item) {
      const take = Math.min(s.count, count);
      s.count -= count = count - take + (count - take >= 0 ? 0 : 0); // see note below
    }
  }
  return true;
}

export function countItem(inv: Slot[], item: ItemId): number {
  let n = 0;
  for (const s of inv) if (s && s.item === item) n += s.count;
  return n;
}

export function firstEmpty(inv: Slot[]): number {
  return inv.findIndex(s => s === null);
}

/** Swap or merge two slots (drag-and-drop). Mutates `inv`. */
export function moveSlot(inv: Slot[], from: number, to: number): void {
  if (from === to || from < 0 || to < 0 || from >= inv.length || to >= inv.length) return;
  const a = inv[from]!, b = inv[to];
  if (a && b && a.item === b.item) {
    const max = ITEMS[a.item].stackSize;
    const move = Math.min(a.count, max - b.count);
    b.count += move; a.count -= move;
    if (a.count === 0) inv[from] = null;
    return;
  }
  inv[from] = b ?? null;
  inv[to] = a;
}

export function emptyInventory(size: number): Slot[] {
  return Array.from({ length: size }, () => null as Slot);
}
```

> **Step-2 correction:** the `removeItem` decrement above is intentionally rewritten clean here — implement the loop body as:
> ```ts
> for (let i = 0; i < inv.length && count > 0; i++) {
>   const s = inv[i];
>   if (s && s.item === item) {
>     const take = Math.min(s.count, count);
>     s.count -= take; count -= take;
>     if (s.count === 0) inv[i] = null;
>   }
> }
> ```
> Use this version, not the placeholder expression in Step 1's listing.

- [ ] **Step 3: Export from the package index**

In `packages/shared/src/index.ts` add:

```ts
export { ITEMS, type ItemId, type ItemDef, type ItemCategory, type ItemStack, type Slot } from './sim/data/items';
export {
  addItem, removeItem, countItem, firstEmpty, moveSlot, emptyInventory,
} from './sim/inventory';
```

- [ ] **Step 4: Typecheck shared**

Run: `npm run -w @lf/shared typecheck`
Expected: PASS (additive only; nothing else references these yet).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sim/data/items.ts packages/shared/src/sim/inventory.ts packages/shared/src/index.ts
git commit -m "feat(shared): item registry + pure inventory module"
```

---

## Task 2: World regions + enlarged biome map (shared)

**Files:**
- Create: `packages/shared/src/sim/regions.ts`
- Modify: `packages/shared/src/sim/constants.ts`
- Modify: `packages/shared/src/sim/mapgen.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Rework constants**

Replace `packages/shared/src/sim/constants.ts` with:

```ts
export const TICK_RATE = 20;                 // ticks per second
export const TICK_MS = 1000 / TICK_RATE;
export const MAP_SIZE = 360;                 // ~8× the old 128² play area
export const CAMP_POS = { x: 180, y: 180 };  // forced-meadow camp / respawn anchor (map center)
export const CAMP_CLEAR_RADIUS = 14;         // no nodes/decor inside the camp clearing

// Continuous day/night — no waves. Night is the dangerous phase (content lands in Phase 2).
export const DAY_TICKS = 150 * TICK_RATE;
export const NIGHT_TICKS = 90 * TICK_RATE;

export const PLAYER_SPEED = 6 / TICK_RATE;   // 6 units/s, per-tick
export const PLAYER_MAX_HP = 100;
export const RESPAWN_TICKS = 6 * TICK_RATE;

// Inventory layout
export const HOTBAR_SLOTS = 9;
export const BACKPACK_SLOTS = 27;
export const INVENTORY_SLOTS = HOTBAR_SLOTS + BACKPACK_SLOTS; // 36

// Survival stats
export const HUNGER_MAX = 100;
export const HUNGER_START = 80;
export const HUNGER_DECAY_IDLE = 0.012;      // per tick (~0.24/s)
export const HUNGER_DECAY_ACTIVE = 0.03;     // while moving/gathering
export const STARVE_DMG = 0.4;               // hp/tick at hunger 0

// Bare-hand gathering (tools arrive in Phase 1)
export const BARE_HAND_YIELD = 1;            // resource units per swing
export const GATHER_COOLDOWN = 10;           // ticks between swings
export const GATHER_RANGE = 2.8;

// Ground items
export const ITEM_TTL_TICKS = 180 * TICK_RATE;   // 3 min despawn
export const PICKUP_RANGE = 1.3;

// Node sizes
export const NODE_AMOUNT = { tree: 18, rock: 24, bush: 6 } as const;
export const BUSH_REGROW_TICKS = 60 * TICK_RATE;
```

- [ ] **Step 2: Create the region/biome module**

`packages/shared/src/sim/regions.ts`:

```ts
import type { Vec2 } from './types';
import { Rng } from './rng';
import { MAP_SIZE, CAMP_POS } from './constants';

export type Biome = 'meadow' | 'forest' | 'mountains' | 'swamp' | 'tundra' | 'plains' | 'badlands';

export interface Region {
  id: number;
  name: string;
  biome: Biome;
  seed: Vec2;        // Voronoi site
}

export interface RegionMap {
  regions: Region[];
  /** assignment is computed on demand by nearest site (`regionAt`) */
}

const BIOME_NAMES: Record<Biome, string[]> = {
  meadow:    ['Hearthfield', 'Greenrest', 'Dawn Meadow'],
  forest:    ['Mistwood', 'Elderpine', 'Thornwood'],
  mountains: ['Stonespire', 'Ironpeak', 'Frostcrag'],
  swamp:     ['Murkfen', 'Blackmire', 'Rotbog'],
  tundra:    ['Whitewaste', 'Hollowfrost', 'Palecourt'],
  plains:    ['Wideflat', 'Sunreach', 'Longgrass'],
  badlands:  ['Ashland', 'Cinderscar', 'Dustmar'],
};

/** Deterministic Voronoi partition: meadow forced at the camp, the rest seeded by RNG. */
export function generateRegions(seed: number): RegionMap {
  const rng = new Rng(seed ^ 0x9e3779b9);
  const used = new Set<string>();
  const pickName = (b: Biome): string => {
    const pool = BIOME_NAMES[b];
    for (let i = 0; i < 8; i++) {
      const n = pool[rng.int(0, pool.length - 1)]!;
      if (!used.has(n)) { used.add(n); return n; }
    }
    return `${pool[0]} ${used.size}`;
  };
  const regions: Region[] = [
    { id: 0, name: pickName('meadow'), biome: 'meadow', seed: { ...CAMP_POS } },
  ];
  const order: Biome[] = ['forest', 'mountains', 'swamp', 'tundra', 'plains', 'forest', 'badlands', 'mountains'];
  const n = 8;                                   // 9 regions incl. meadow → 6-10 range
  for (let i = 0; i < n; i++) {
    const biome = order[i % order.length]!;
    // keep sites away from camp and the border
    let x = 0, y = 0, ok = false;
    for (let t = 0; t < 30 && !ok; t++) {
      x = rng.int(28, MAP_SIZE - 29);
      y = rng.int(28, MAP_SIZE - 29);
      ok = Math.hypot(x - CAMP_POS.x, y - CAMP_POS.y) > 70;
    }
    regions.push({ id: i + 1, name: pickName(biome), biome, seed: { x, y } });
  }
  return { regions };
}

/** Nearest-site lookup. */
export function regionAt(map: RegionMap, pos: Vec2): Region {
  let best = map.regions[0]!, bd = Infinity;
  for (const r of map.regions) {
    const d = (r.seed.x - pos.x) ** 2 + (r.seed.y - pos.y) ** 2;
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}
```

- [ ] **Step 3: Rework mapgen for biomes + bushes**

Replace `packages/shared/src/sim/mapgen.ts` with a biome-aware generator. Key points: signature gains the region map; camp clearing replaces the castle clearing; density varies per biome; bushes appear in meadow/plains.

```ts
import type { Vec2 } from './types';
import { Rng } from './rng';
import { MAP_SIZE, CAMP_POS, CAMP_CLEAR_RADIUS } from './constants';
import { inRiverBand, type RiverParams } from './river';
import { regionAt, type RegionMap, type Biome } from './regions';

export interface MapData {
  nodes: { kind: 'tree' | 'rock' | 'bush'; pos: Vec2 }[];
}

/** trees, rocks, bushes per ~unit cluster attempt, by biome */
const DENSITY: Record<Biome, { tree: number; rock: number; bush: number }> = {
  meadow:    { tree: 0.3, rock: 0.2, bush: 1.0 },
  forest:    { tree: 1.0, rock: 0.3, bush: 0.4 },
  mountains: { tree: 0.4, rock: 1.0, bush: 0.1 },
  swamp:     { tree: 0.7, rock: 0.2, bush: 0.5 },
  tundra:    { tree: 0.3, rock: 0.5, bush: 0.1 },
  plains:    { tree: 0.2, rock: 0.2, bush: 0.8 },
  badlands:  { tree: 0.1, rock: 0.8, bush: 0.1 },
};

export function generateMap(rng: Rng, river: RiverParams, regions: RegionMap): MapData {
  const nodes: MapData['nodes'] = [];
  const used = new Set<string>();
  const add = (kind: 'tree' | 'rock' | 'bush', x: number, y: number) => {
    if (x < 2 || y < 2 || x > MAP_SIZE - 3 || y > MAP_SIZE - 3) return;
    if (Math.hypot(x - CAMP_POS.x, y - CAMP_POS.y) <= CAMP_CLEAR_RADIUS) return;
    if (inRiverBand(x, y, river, 1.2)) return;
    const key = `${x},${y}`;
    if (used.has(key)) return;
    used.add(key);
    nodes.push({ kind, pos: { x, y } });
  };
  // cluster passes scaled by the biome under each cluster centre
  for (let c = 0; c < 220; c++) {
    const cx = rng.int(6, MAP_SIZE - 7), cy = rng.int(6, MAP_SIZE - 7);
    const d = DENSITY[regionAt(regions, { x: cx, y: cy }).biome];
    for (let i = 0, n = rng.int(5, 12); i < n; i++) {
      const x = cx + rng.int(-5, 5), y = cy + rng.int(-5, 5);
      const r = rng.next();
      const total = d.tree + d.rock + d.bush;
      if (r < d.tree / total) add('tree', x, y);
      else if (r < (d.tree + d.rock) / total) add('rock', x, y);
      else add('bush', x, y);
    }
  }
  return { nodes };
}
```

> Note: `spawnPoints` (border ring) is removed — it only fed the wave spawner, which is gone. Phase 2 reintroduces spawn tables keyed by region.

- [ ] **Step 4: Update exports**

In `packages/shared/src/index.ts`:
- Change the mapgen export line to keep `generateMap, type MapData`.
- Add: `export { generateRegions, regionAt, type Region, type RegionMap, type Biome } from './sim/regions';`

- [ ] **Step 5: Typecheck shared**

Run: `npm run -w @lf/shared typecheck`
Expected: FAIL — `sim.ts` still calls `generateMap(this.rng, this.river)` (old arity) and references removed constants. This is expected; it is fixed in Task 4. Do **not** commit yet.

> Tasks 3 and 4 are a single breaking unit for the shared package. Commit only after Task 4's typecheck passes.

---

## Task 3: Survival types (shared `types.ts`)

**Files:**
- Modify: `packages/shared/src/sim/types.ts`

- [ ] **Step 1: Rewrite the type module**

Replace `packages/shared/src/sim/types.ts` with the survival shape. Remove `Resources`/`ResourceKind`, `ClassType`/`WeaponType` from state usage (keep `ClassType` exported only if the client lobby still needs it — it does not after Phase 0; remove it), prune `BuildingType`, add inventory/hunger/ground-item shapes.

```ts
import type { SkillModifiers } from './data/skills';
import type { Slot, ItemId } from './data/items';

export interface Vec2 { x: number; y: number; }

export type BuildingType = 'wood_wall' | 'stone_wall' | 'gate' | 'spike';
export type Phase = 'day' | 'night';
export type EntityId = number;

export interface Building {
  id: EntityId;
  type: BuildingType;
  pos: Vec2;               // grid cell (top-left of footprint)
  hp: number;
  maxHp: number;
}

export interface Equipment {
  head: Slot;
  body: Slot;
  legs: Slot;
}

export interface Player {
  id: EntityId;
  pos: Vec2;
  hp: number;
  maxHp: number;
  alive: boolean;
  respawnTicks: number;
  mods: SkillModifiers;
  inventory: Slot[];       // length INVENTORY_SLOTS (0..8 hotbar, 9..35 backpack)
  equipment: Equipment;    // inert in Phase 0
  hand: number;            // selected hotbar index 0..8
  hunger: number;          // 0..100
  temperature: number;     // 0..100 placeholder, inert until Phase 4
  gatherCooldown: number;
  gatherTarget: EntityId | null;
}

export interface ResourceNode {
  id: EntityId;
  kind: 'tree' | 'rock' | 'bush';
  pos: Vec2;
  amount: number;
  regrowTicks: number;     // bushes regrow; 0 = ready/non-regrowing
}

export interface DroppedItem {
  id: EntityId;
  item: ItemId;
  count: number;
  pos: Vec2;
  ttlTicks: number;
}

export interface SimState {
  tick: number;
  worldSeed: number;
  phase: Phase;
  phaseTicks: number;
  buildings: Map<EntityId, Building>;
  players: Map<EntityId, Player>;
  nodes: Map<EntityId, ResourceNode>;
  groundItems: Map<EntityId, DroppedItem>;
  nextId: EntityId;
}

export type Command =
  | { kind: 'move'; dir: Vec2 }
  | { kind: 'gather' }
  | { kind: 'eat' }
  | { kind: 'select_hand'; slot: number }
  | { kind: 'move_item'; from: number; to: number }
  | { kind: 'drop_item'; slot: number; count: number }
  | { kind: 'build'; type: BuildingType; pos: Vec2 }
  | { kind: 'demolish'; buildingId: EntityId };

export type SimEvent =
  | { kind: 'damage'; pos: Vec2; amount: number; crit: boolean }
  | { kind: 'melee'; pos: Vec2 }
  | { kind: 'node_depleted'; nodeId: EntityId; pos: Vec2 }
  | { kind: 'gather'; pos: Vec2; resource: ItemId; amount: number;
      nodeId: EntityId; remaining: number }
  | { kind: 'pickup'; pos: Vec2; item: ItemId; count: number; playerId: EntityId }
  | { kind: 'eat'; pos: Vec2; playerId: EntityId }
  | { kind: 'item_drop'; pos: Vec2; item: ItemId; count: number }
  | { kind: 'build_placed'; pos: Vec2; type: BuildingType }
  | { kind: 'building_destroyed'; pos: Vec2; type: BuildingType }
  | { kind: 'player_died'; id: EntityId; pos: Vec2 }
  | { kind: 'player_respawn'; id: EntityId; pos: Vec2 }
  | { kind: 'region_enter'; id: EntityId; region: string }
  | { kind: 'phase_change'; phase: Phase };
```

> `Projectile`/`ProjectileKind`, `Enemy`/`EnemyType`, `TeamBonuses`, `Resources`, `ClassType`, `WeaponType` are all removed from `types.ts`. Enemy/projectile combat returns in Phase 2 with its own types. Anything still importing them will surface as a compile error in Task 4 (shared) / Task 6 (server) / Task 7 (client) and must be deleted there.

---

## Task 4: Sim rework (shared `sim.ts`, buildings, snapshot, economy delete)

**Files:**
- Modify: `packages/shared/src/sim/data/buildings.ts`
- Delete: `packages/shared/src/sim/economy.ts`
- Modify: `packages/shared/src/sim/sim.ts`
- Modify: `packages/shared/src/sim/snapshot.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Prune buildings to passive structures with item costs**

Replace `packages/shared/src/sim/data/buildings.ts`:

```ts
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
```

- [ ] **Step 2: Delete the obsolete economy module**

```bash
git rm packages/shared/src/sim/economy.ts
```

(No file in the new sim imports it. Remove its export from `index.ts` if one exists — it is not currently exported, so nothing to change there.)

- [ ] **Step 3: Rewrite the sim**

Replace `packages/shared/src/sim/sim.ts`. The new sim keeps movement/collision and gathering (now into inventory), adds hunger/death-drop/ground-items/region-enter, prices building from inventory, and runs a continuous day/night clock. Towers, enemies, projectiles, income, support, waves, votes, and the team economy are gone.

```ts
import type {
  SimState, SimEvent, Command, Player, Building, EntityId, Vec2,
  ResourceNode, BuildingType, DroppedItem,
} from './types';
import { Rng } from './rng';
import { Grid } from './grid';
import { generateMap, type MapData } from './mapgen';
import { generateRegions, regionAt, type RegionMap } from './regions';
import { BUILDINGS } from './data/buildings';
import { applySkills } from './data/skills';
import { dist, buildingCenter } from './combat';
import { ITEMS, type ItemId } from './data/items';
import {
  addItem, removeItem, countItem, emptyInventory, moveSlot, firstEmpty,
} from './inventory';
import {
  riverParams, inRiver, crossesBridgeRail, inRiverBand, type RiverParams,
} from './river';
import { generateDecor, decorBlocks, type Decor } from './decor';
import {
  MAP_SIZE, CAMP_POS, DAY_TICKS, NIGHT_TICKS, PLAYER_SPEED, PLAYER_MAX_HP,
  RESPAWN_TICKS, INVENTORY_SLOTS, HUNGER_MAX, HUNGER_START,
  HUNGER_DECAY_IDLE, HUNGER_DECAY_ACTIVE, STARVE_DMG, BARE_HAND_YIELD,
  GATHER_COOLDOWN, GATHER_RANGE, ITEM_TTL_TICKS, PICKUP_RANGE,
  NODE_AMOUNT, BUSH_REGROW_TICKS,
} from './constants';

const NODE_ITEM: Record<ResourceNode['kind'], ItemId> = {
  tree: 'wood', rock: 'stone', bush: 'berry',
};

export class Sim {
  readonly state: SimState;
  readonly grid: Grid;
  readonly map: MapData;
  readonly rng: Rng;
  readonly river: RiverParams;
  readonly decor: Decor[];
  readonly regions: RegionMap;
  private moveIntent = new Map<EntityId, Vec2>();
  private lastRegion = new Map<EntityId, number>();
  private buildQueue: { playerId: EntityId; type: BuildingType; pos: Vec2 }[] = [];
  private demolishQueue: EntityId[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.grid = new Grid(MAP_SIZE);
    this.river = riverParams(seed);
    this.regions = generateRegions(seed);
    this.map = generateMap(this.rng, this.river, this.regions);
    this.decor = generateDecor(seed, this.river, this.map.nodes as { kind: 'tree' | 'rock'; pos: Vec2 }[]);
    this.state = {
      tick: 0, worldSeed: seed, phase: 'day', phaseTicks: DAY_TICKS,
      buildings: new Map(), players: new Map(), nodes: new Map(),
      groundItems: new Map(), nextId: 1,
    };
    for (const n of this.map.nodes) {
      const id = this.state.nextId++;
      this.state.nodes.set(id, {
        id, kind: n.kind, pos: n.pos, amount: NODE_AMOUNT[n.kind], regrowTicks: 0,
      });
      this.grid.occupy(n.pos, 1, id);
    }
  }

  /** Rebuild a running sim from a saved snapshot (world persistence). */
  static fromState(state: SimState): Sim {
    const sim = new Sim(state.worldSeed);
    // discard the freshly-generated dynamic state, adopt the saved one
    sim.state.tick = state.tick;
    sim.state.phase = state.phase;
    sim.state.phaseTicks = state.phaseTicks;
    sim.state.nextId = state.nextId;
    sim.state.buildings = state.buildings;
    sim.state.players = state.players;
    sim.state.nodes = state.nodes;
    sim.state.groundItems = state.groundItems;
    // rebuild grid occupancy from the adopted nodes + buildings
    sim.grid.reset();
    for (const n of sim.state.nodes.values()) sim.grid.occupy(n.pos, 1, n.id);
    for (const b of sim.state.buildings.values()) sim.grid.occupy(b.pos, BUILDINGS[b.type].size, b.id);
    return sim;
  }

  addPlayer(skills: string[] = []): Player {
    const id = this.state.nextId++;
    const p: Player = {
      id, pos: { x: CAMP_POS.x + this.rng.int(-3, 3), y: CAMP_POS.y + this.rng.int(-3, 3) },
      hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP, alive: true, respawnTicks: 0,
      mods: applySkills(skills),
      inventory: emptyInventory(INVENTORY_SLOTS),
      equipment: { head: null, body: null, legs: null },
      hand: 0, hunger: HUNGER_START, temperature: 100,
      gatherCooldown: 0, gatherTarget: null,
    };
    this.state.players.set(id, p);
    return p;
  }

  removePlayer(id: EntityId): void {
    this.state.players.delete(id);
    this.moveIntent.delete(id);
    this.lastRegion.delete(id);
  }

  applyCommand(playerId: EntityId, cmd: Command): void {
    const p = this.state.players.get(playerId);
    if (!p || !p.alive) return;
    switch (cmd.kind) {
      case 'move': this.moveIntent.set(playerId, cmd.dir); break;
      case 'gather': {
        let best: ResourceNode | null = null, bd = GATHER_RANGE;
        for (const n of this.state.nodes.values()) {
          if (n.amount <= 0) continue;
          const d = dist({ x: n.pos.x + 0.5, y: n.pos.y + 0.5 }, p.pos);
          if (d <= bd) { bd = d; best = n; }
        }
        if (best) p.gatherTarget = best.id;
        break;
      }
      case 'eat': {
        if (removeItem(p.inventory, 'berry', 1)) {
          p.hunger = Math.min(HUNGER_MAX, p.hunger + (ITEMS.berry.foodValue ?? 0));
        }
        break;
      }
      case 'select_hand':
        if (Number.isInteger(cmd.slot) && cmd.slot >= 0 && cmd.slot < 9) p.hand = cmd.slot;
        break;
      case 'move_item': moveSlot(p.inventory, cmd.from, cmd.to); break;
      case 'drop_item': this.dropFromSlot(p, cmd.slot, cmd.count); break;
      case 'build': this.buildQueue.push({ playerId, type: cmd.type, pos: cmd.pos }); break;
      case 'demolish': this.demolishQueue.push(cmd.buildingId); break;
    }
  }

  step(): SimEvent[] {
    const events: SimEvent[] = [];
    this.state.tick++;
    this.stepClock(events);
    this.stepBuildCommands(events);
    this.stepPlayers(events);
    this.stepGather(events);
    this.stepHunger(events);
    this.stepGroundItems(events);
    this.stepNodeRegrow();
    this.stepRespawns(events);
    this.stepRegions(events);
    return events;
  }

  private stepClock(events: SimEvent[]): void {
    if (--this.state.phaseTicks > 0) return;
    this.state.phase = this.state.phase === 'day' ? 'night' : 'day';
    this.state.phaseTicks = this.state.phase === 'day' ? DAY_TICKS : NIGHT_TICKS;
    events.push({ kind: 'phase_change', phase: this.state.phase });
  }

  private stepBuildCommands(events: SimEvent[]): void {
    for (const req of this.buildQueue) {
      const p = this.state.players.get(req.playerId);
      if (!p || !p.alive) continue;
      const def = BUILDINGS[req.type];
      const pos = { x: Math.floor(req.pos.x), y: Math.floor(req.pos.y) };
      if (!this.grid.canPlace(pos, def.size)) continue;
      if (this.footprintInRiver(pos, def.size)) continue;
      if (this.footprintOnDecor(pos, def.size)) continue;
      if (!this.canAffordBuild(p, def.cost)) continue;
      for (const [item, n] of Object.entries(def.cost)) removeItem(p.inventory, item as ItemId, n!);
      this.makeBuilding(req.type, pos);
      events.push({ kind: 'build_placed', pos, type: req.type });
    }
    this.buildQueue.length = 0;

    for (const id of this.demolishQueue) {
      const b = this.state.buildings.get(id);
      if (!b) continue;
      this.grid.clear(b.pos, BUILDINGS[b.type].size);
      this.state.buildings.delete(id);
    }
    this.demolishQueue.length = 0;
  }

  private canAffordBuild(p: Player, cost: Partial<Record<ItemId, number>>): boolean {
    for (const [item, n] of Object.entries(cost)) {
      if (countItem(p.inventory, item as ItemId) < n!) return false;
    }
    return true;
  }

  /** Channeled gathering → items land in the player's inventory. */
  private stepGather(events: SimEvent[]): void {
    for (const p of this.state.players.values()) {
      if (p.gatherTarget === null || !p.alive) { p.gatherTarget = null; continue; }
      const node = this.state.nodes.get(p.gatherTarget);
      if (!node || node.amount <= 0) { p.gatherTarget = null; continue; }
      const center = { x: node.pos.x + 0.5, y: node.pos.y + 0.5 };
      if (dist(center, p.pos) > GATHER_RANGE + 0.4) { p.gatherTarget = null; continue; }
      if (p.gatherCooldown > 0) continue;
      p.gatherCooldown = GATHER_COOLDOWN;
      const take = Math.min(BARE_HAND_YIELD, node.amount);
      node.amount -= take;
      const item = NODE_ITEM[node.kind];
      const leftover = addItem(p.inventory, item, take);
      if (leftover > 0) this.spawnGroundItem(item, leftover, p.pos);
      events.push({ kind: 'gather', resource: item, amount: take, nodeId: node.id,
        remaining: node.amount, pos: { ...center } });
      if (node.amount <= 0) {
        if (node.kind === 'bush') {
          node.regrowTicks = BUSH_REGROW_TICKS;        // bushes come back
        } else {
          this.grid.clear(node.pos, 1);
          this.state.nodes.delete(node.id);
        }
        events.push({ kind: 'node_depleted', nodeId: node.id, pos: { ...node.pos } });
        for (const o of this.state.players.values()) if (o.gatherTarget === node.id) o.gatherTarget = null;
      }
    }
  }

  private stepHunger(events: SimEvent[]): void {
    for (const p of this.state.players.values()) {
      if (!p.alive) continue;
      const active = this.moveIntent.has(p.id) || p.gatherTarget !== null;
      p.hunger = Math.max(0, p.hunger - (active ? HUNGER_DECAY_ACTIVE : HUNGER_DECAY_IDLE));
      if (p.hunger <= 0) {
        p.hp -= STARVE_DMG;
        if (p.hp <= 0) this.killPlayer(p, events);
      }
    }
  }

  private stepGroundItems(events: SimEvent[]): void {
    for (const gi of [...this.state.groundItems.values()]) {
      if (--gi.ttlTicks <= 0) { this.state.groundItems.delete(gi.id); continue; }
      for (const p of this.state.players.values()) {
        if (!p.alive) continue;
        if (dist(p.pos, gi.pos) > PICKUP_RANGE) continue;
        const leftover = addItem(p.inventory, gi.item, gi.count);
        const got = gi.count - leftover;
        if (got > 0) events.push({ kind: 'pickup', pos: { ...gi.pos }, item: gi.item, count: got, playerId: p.id });
        gi.count = leftover;
        if (gi.count <= 0) { this.state.groundItems.delete(gi.id); break; }
      }
    }
  }

  private stepNodeRegrow(): void {
    for (const n of this.state.nodes.values()) {
      if (n.regrowTicks > 0 && --n.regrowTicks === 0) n.amount = NODE_AMOUNT[n.kind];
    }
  }

  private stepRespawns(events: SimEvent[]): void {
    for (const p of this.state.players.values()) {
      if (p.alive) continue;
      if (--p.respawnTicks <= 0) {
        p.alive = true;
        p.hp = p.maxHp;
        p.hunger = 60;
        p.pos = { x: CAMP_POS.x + this.rng.int(-3, 3), y: CAMP_POS.y + this.rng.int(-3, 3) };
        events.push({ kind: 'player_respawn', id: p.id, pos: { ...p.pos } });
      }
    }
  }

  private stepRegions(events: SimEvent[]): void {
    for (const p of this.state.players.values()) {
      if (!p.alive) continue;
      const r = regionAt(this.regions, p.pos);
      if (this.lastRegion.get(p.id) !== r.id) {
        this.lastRegion.set(p.id, r.id);
        events.push({ kind: 'region_enter', id: p.id, region: r.name });
      }
    }
  }

  private killPlayer(p: Player, events: SimEvent[]): void {
    p.alive = false; p.hp = 0; p.respawnTicks = RESPAWN_TICKS; p.gatherTarget = null;
    // drop the whole inventory + equipment as ground items
    const drop = (s: import('./data/items').Slot) => {
      if (s) this.spawnGroundItem(s.item, s.count, p.pos);
    };
    for (let i = 0; i < p.inventory.length; i++) { drop(p.inventory[i]); p.inventory[i] = null; }
    drop(p.equipment.head); drop(p.equipment.body); drop(p.equipment.legs);
    p.equipment = { head: null, body: null, legs: null };
    events.push({ kind: 'player_died', id: p.id, pos: { ...p.pos } });
  }

  damagePlayer(id: EntityId, amount: number, events: SimEvent[]): void {
    const p = this.state.players.get(id);
    if (!p || !p.alive) return;
    p.hp -= amount;
    events.push({ kind: 'damage', pos: { ...p.pos }, amount, crit: false });
    if (p.hp <= 0) this.killPlayer(p, events);
  }

  private dropFromSlot(p: Player, slot: number, count: number): void {
    if (slot < 0 || slot >= p.inventory.length) return;
    const s = p.inventory[slot];
    if (!s) return;
    const n = Math.min(count, s.count);
    if (n <= 0) return;
    this.spawnGroundItem(s.item, n, { x: p.pos.x, y: p.pos.y });
    s.count -= n;
    if (s.count <= 0) p.inventory[slot] = null;
  }

  private spawnGroundItem(item: ItemId, count: number, pos: Vec2): void {
    const id = this.state.nextId++;
    this.state.groundItems.set(id, {
      id, item, count, ttlTicks: ITEM_TTL_TICKS,
      pos: { x: pos.x + (this.rng.next() - 0.5) * 0.6, y: pos.y + (this.rng.next() - 0.5) * 0.6 },
    });
  }

  private stepPlayers(events: SimEvent[]): void {
    for (const p of this.state.players.values()) {
      if (!p.alive) continue;
      if (p.gatherCooldown > 0) p.gatherCooldown--;
      const dir = this.moveIntent.get(p.id);
      if (dir) {
        p.gatherTarget = null;
        const wading = inRiver(p.pos, this.river);
        const speed = PLAYER_SPEED * (wading ? 0.5 : 1);
        const len = Math.hypot(dir.x, dir.y) || 1;
        this.tryMovePlayer(p, (dir.x / len) * speed, 0);
        this.tryMovePlayer(p, 0, (dir.y / len) * speed);
      }
    }
    // moveIntent is consumed by stepHunger (active check) — cleared at end of step
    // NOTE: clear AFTER hunger so the active flag is correct.
  }

  // called at the very end of step via a small helper to keep ordering explicit
  private clearIntents(): void { this.moveIntent.clear(); }

  private tryMovePlayer(p: Player, dx: number, dy: number): void {
    const next = {
      x: clamp(p.pos.x + dx, 0.5, MAP_SIZE - 0.5),
      y: clamp(p.pos.y + dy, 0.5, MAP_SIZE - 0.5),
    };
    if (this.isSolidAt(next)) return;
    if (crossesBridgeRail(p.pos, next, this.river)) return;
    p.pos.x = next.x; p.pos.y = next.y;
  }

  footprintOnDecor(pos: Vec2, size: number): boolean {
    for (let y = pos.y; y < pos.y + size; y++)
      for (let x = pos.x; x < pos.x + size; x++)
        if (decorBlocks(this.decor, { x: x + 0.5, y: y + 0.5 })) return true;
    return false;
  }
  footprintInRiver(pos: Vec2, size: number): boolean {
    for (let y = pos.y; y < pos.y + size; y++)
      for (let x = pos.x; x < pos.x + size; x++)
        if (inRiverBand(x + 0.5, y + 0.5, this.river, 0.2)) return true;
    return false;
  }
  isSolidAt(pos: Vec2): boolean {
    if (decorBlocks(this.decor, pos)) return true;
    const id = this.grid.occupantAt(pos);
    if (id === 0) return false;
    const b = this.state.buildings.get(id);
    if (b) return !BUILDINGS[b.type].walkable;
    const n = this.state.nodes.get(id);
    return n ? n.amount > 0 : false;     // depleted-but-regrowing bushes are walkable
  }

  private makeBuilding(type: BuildingType, pos: Vec2): Building {
    const def = BUILDINGS[type];
    const id = this.state.nextId++;
    const b: Building = { id, type, pos: { ...pos }, hp: def.hp, maxHp: def.hp };
    this.state.buildings.set(id, b);
    this.grid.occupy(pos, def.size, id);
    return b;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
```

> **Ordering fix for `moveIntent`:** `stepHunger` reads `this.moveIntent.has(p.id)` to decide the active-decay rate, so the map must still be populated when hunger runs. Resolve this cleanly: in `step()`, call `this.clearIntents()` as the **last** line (after `stepRegions`). Update the `step()` body to:
> ```ts
> step(): SimEvent[] {
>   const events: SimEvent[] = [];
>   this.state.tick++;
>   this.stepClock(events);
>   this.stepBuildCommands(events);
>   this.stepPlayers(events);
>   this.stepGather(events);
>   this.stepHunger(events);
>   this.stepGroundItems(events);
>   this.stepNodeRegrow();
>   this.stepRespawns(events);
>   this.stepRegions(events);
>   this.clearIntents();
>   return events;
> }
> ```
> and remove the `moveIntent.clear()` that previously lived at the end of `stepPlayers`.

- [ ] **Step 4: Confirm `Grid` has a `reset()` method**

`Sim.fromState` calls `this.grid.reset()`. Read `packages/shared/src/sim/grid.ts`. If no `reset()` exists, add one that zeroes the occupancy array:

```ts
reset(): void { this.cells.fill(0); }
```

(Use the actual backing-field name from that file — likely `cells` or `occ`.)

- [ ] **Step 5: Serialize ground items in snapshot**

Replace `packages/shared/src/sim/snapshot.ts`:

```ts
import type { SimState } from './types';

export function serializeState(s: SimState): string {
  return JSON.stringify({
    ...s,
    buildings: [...s.buildings.entries()],
    players: [...s.players.entries()],
    nodes: [...s.nodes.entries()],
    groundItems: [...s.groundItems.entries()],
  });
}

export function deserializeState(json: string): SimState {
  const raw = JSON.parse(json);
  return {
    ...raw,
    buildings: new Map(raw.buildings),
    players: new Map(raw.players),
    nodes: new Map(raw.nodes),
    groundItems: new Map(raw.groundItems),
  };
}
```

- [ ] **Step 6: Fix shared barrel exports**

In `packages/shared/src/index.ts`:
- Remove exports of deleted symbols: `combatUpgradeCost, combatDmgMul, combatSpeedMul, TOOL_UPGRADE_COSTS` (from sim), `ENEMIES, type EnemyDef`, `waveComposition, enemyHpScale, enemyDmgScale`, `UPGRADE_CHOICES, type UpgradeDef`, `nearestEnemy` (from combat — keep `dist, buildingCenter`).
- Keep: `Sim`, `Rng`, `Grid`, `generateMap`/`MapData`, `generateRegions`/`regionAt`/region types, `types`, `constants`, `BUILDINGS`/`BuildingDef`, `SKILLS`/`applySkills`/`defaultModifiers`/skill types, `decor` exports, `serializeState`/`deserializeState`, `dist`/`buildingCenter`, river exports, and the Task 1 item/inventory exports.
- Verify `packages/shared/src/sim/combat.ts` still compiles after `nearestEnemy`/`Enemy` removal. If `combat.ts` imports `Enemy`/`ENEMIES`, trim it to only `dist` and `buildingCenter`. Read the file and delete enemy-only helpers (they return in Phase 2).
- `data/waves.ts`, `data/enemies.ts`, `data/upgrades.ts` are now unused. Leave the files in place but remove their exports from `index.ts` so nothing references them; they will be revived/rewritten in Phase 2. (Deleting is also fine — but keeping avoids losing the tuning tables.)

- [ ] **Step 7: Typecheck shared**

Run: `npm run -w @lf/shared typecheck`
Expected: PASS. If errors remain, they are dangling references to removed symbols — delete each at its source per Step 6.

- [ ] **Step 8: Commit (Tasks 2–4 together)**

```bash
git add packages/shared
git commit -m "feat(shared): survival sim core — inventory gather, hunger, ground items, biomes; remove waves/towers/economy"
```

---

## Task 5: World persistence store (server)

**Files:**
- Create: `packages/server/src/world-store.ts`
- Modify: `packages/server/src/db.ts`

- [ ] **Step 1: Create the world store**

`packages/server/src/world-store.ts`:

```ts
import pg from 'pg';
import { serializeState, deserializeState, type SimState } from '@lf/shared';

/** One persisted world per party id, plus device→playerId bindings. */
export interface WorldRecord {
  state: SimState;
  bindings: Record<string, number>;   // deviceId → playerId
}

export interface WorldStore {
  load(partyId: string): Promise<WorldRecord | null>;
  save(partyId: string, rec: WorldRecord): Promise<void>;
  delete(partyId: string): Promise<void>;
}

class PgWorldStore implements WorldStore {
  constructor(private pool: pg.Pool) {}
  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS worlds (
        party_id TEXT PRIMARY KEY,
        state JSONB NOT NULL,
        bindings JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
  }
  async load(partyId: string): Promise<WorldRecord | null> {
    const r = await this.pool.query('SELECT state, bindings FROM worlds WHERE party_id = $1', [partyId]);
    if (r.rows.length === 0) return null;
    try {
      return {
        state: deserializeState(JSON.stringify(r.rows[0].state)),
        bindings: r.rows[0].bindings as Record<string, number>,
      };
    } catch {
      return null;   // corrupt/migrated → caller generates fresh
    }
  }
  async save(partyId: string, rec: WorldRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO worlds (party_id, state, bindings, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (party_id) DO UPDATE SET state = $2, bindings = $3, updated_at = now()`,
      [partyId, serializeState(rec.state), JSON.stringify(rec.bindings)]);
  }
  async delete(partyId: string): Promise<void> {
    await this.pool.query('DELETE FROM worlds WHERE party_id = $1', [partyId]);
  }
}

class MemoryWorldStore implements WorldStore {
  private map = new Map<string, string>();   // store serialized to mimic round-trip
  async load(partyId: string): Promise<WorldRecord | null> {
    const raw = this.map.get(partyId);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return { state: deserializeState(o.state), bindings: o.bindings };
  }
  async save(partyId: string, rec: WorldRecord): Promise<void> {
    this.map.set(partyId, JSON.stringify({ state: serializeState(rec.state), bindings: rec.bindings }));
  }
  async delete(partyId: string): Promise<void> { this.map.delete(partyId); }
}

export async function createWorldStore(pool: pg.Pool | null): Promise<WorldStore> {
  if (pool) { const s = new PgWorldStore(pool); await s.init(); return s; }
  return new MemoryWorldStore();
}
```

- [ ] **Step 2: Expose a shared pg pool from db.ts**

`db.ts` currently builds its own `pg.Pool` inside `PgStore`. Refactor so the pool is created once and shared with the world store. Add to `db.ts`:

```ts
export function createPool(): pg.Pool | null {
  const url = process.env.DATABASE_URL;
  return url ? new pg.Pool({ connectionString: url }) : null;
}
```

Change `PgStore`'s constructor to accept a `pg.Pool` instead of a URL, and update `createStore` to accept an optional pool:

```ts
export async function createStore(pool: pg.Pool | null): Promise<ProfileStore> {
  if (pool) { const store = new PgStore(pool); await store.init(); console.log('[db] using postgres'); return store; }
  console.log('[db] DATABASE_URL not set — using in-memory profile store');
  return new MemoryStore();
}
```

(Adjust `PgStore` internals to use the injected pool. Keep `freshProfile`/`MemoryStore`/`tryUnlockSkill` unchanged.)

- [ ] **Step 3: Typecheck server**

Run: `npm run -w @lf/server typecheck`
Expected: FAIL — `index.ts` still calls `createStore()` with no args, and `room.ts` references removed shared symbols. Fixed in Task 6. Do not commit yet.

---

## Task 6: Server protocol + room + index (4 players, persistence, no waves)

**Files:**
- Modify: `packages/server/src/protocol.ts`
- Modify: `packages/server/src/room.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/lobby.ts`

- [ ] **Step 1: Rework the protocol**

Replace `packages/server/src/protocol.ts`'s message/view types with the survival shape. Remove `ClassType`/`Resources`/`EnemyType`/`ProjectileKind`/`UpgradeDef` imports; add item/inventory/ground-item views.

```ts
import type {
  Command, SimEvent, Phase, BuildingType, EntityId, Vec2, Slot, ItemId,
} from '@lf/shared';

export type ClientMsg =
  | { t: 'hello'; token?: string }
  | { t: 'create_lobby'; solo: boolean }
  | { t: 'join_lobby'; code: string }
  | { t: 'start_game' }
  | { t: 'cmd'; cmd: Command }
  | { t: 'ping'; pos: Vec2 }
  | { t: 'unlock_skill'; skillId: string }
  | { t: 'chat'; text: string }
  | { t: 'latency'; n: number }
  | { t: 'ghost'; type: BuildingType | null; pos: Vec2; ok: boolean }
  | { t: 'leave' };

export interface BuildingView { id: EntityId; type: BuildingType; pos: Vec2; hp: number; maxHp: number; }
export interface NodeView { id: EntityId; kind: 'tree' | 'rock' | 'bush'; pos: Vec2; amount: number; }
export interface GroundItemView { id: EntityId; item: ItemId; count: number; pos: Vec2; }
export interface PlayerView {
  id: EntityId; pos: Vec2; hp: number; maxHp: number; alive: boolean; name: string;
  hunger: number; hand: number; region: string;
  inventory: Slot[]; equipment: { head: Slot; body: Slot; legs: Slot };
}

export type ServerMsg =
  | { t: 'welcome'; token: string; profile: ProfileView }
  | { t: 'lobby'; code: string; players: { name: string }[]; host: boolean }
  | { t: 'game_start'; seed: number; selfId: EntityId; nodes: NodeView[]; buildings: BuildingView[] }
  | { t: 'frame'; tick: number; phase: Phase; phaseTicks: number;
      players: PlayerView[]; buildings: BuildingView[];
      groundItems: GroundItemView[]; events: SimEvent[] }
  | { t: 'ping'; pos: Vec2; from: string }
  | { t: 'profile'; profile: ProfileView }
  | { t: 'lobby_closed' }
  | { t: 'chat'; from: string; text: string }
  | { t: 'latency'; n: number }
  | { t: 'ghost'; from: string; type: BuildingType | null; pos: Vec2; ok: boolean }
  | { t: 'error'; message: string };

export interface ProfileView {
  name: string; skillPoints: number; unlockedSkills: string[];
  bestWave: number; totalKills: number; gamesPlayed: number;
}

export function encode(msg: ServerMsg): string { return JSON.stringify(msg); }
export function decode(data: string): ClientMsg | null {
  try {
    const m = JSON.parse(data);
    return typeof m === 'object' && m !== null && typeof m.t === 'string' ? m as ClientMsg : null;
  } catch { return null; }
}
```

> `nodes` are sent once at `game_start` (full list) and node depletion/regrow is driven by `gather`/`node_depleted` events client-side, matching the existing pattern — so frames stay small. Ground items, being dynamic and few, ship every frame.

- [ ] **Step 2: Rework the room**

Rewrite `packages/server/src/room.ts`. Key changes: `MAX_PLAYERS = 4`; constructor takes a `WorldStore` and a stable `partyId`; `handleStart` loads or generates the world and binds returning devices; remove `choice`/`offerChoice`/`handleVote`/`restartVotes`/`handleRestartVote`/`restart`/`finish`/`trackKills`; periodic + on-empty world save; `validCommand` updated to the new set; `playerViews`/`buildingViews`/`groundItemViews` reflect new shapes.

```ts
import type { WebSocket } from 'ws';
import {
  Sim, TICK_MS, BUILDINGS, regionAt,
  type EntityId, type SimEvent, type Command, type SimState,
} from '@lf/shared';
import {
  encode, type ServerMsg, type BuildingView, type PlayerView,
  type NodeView, type GroundItemView,
} from './protocol';
import type { Profile } from './db';
import type { WorldStore, WorldRecord } from './world-store';

const MAX_PLAYERS = 4;
const RECONNECT_MS = 120_000;
const MAX_CMDS_PER_TICK = 32;
const SAVE_EVERY_TICKS = 30 * 20;          // ~30 s

interface Seat {
  deviceId: string;
  profile: Profile;
  ws: WebSocket | null;
  playerId: EntityId | null;
  disconnectedAt: number | null;
  cmdCount: number;
  lastChat: number;
}

export class Room {
  readonly code: string;
  readonly solo: boolean;
  private seats: Seat[] = [];
  private sim: Sim | null = null;
  private timer: NodeJS.Timeout | null = null;
  private state: 'lobby' | 'playing' = 'lobby';
  private bindings: Record<string, number> = {};   // deviceId → playerId (persisted)
  private seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;

  constructor(code: string, solo: boolean,
              private store: import('./db').ProfileStore,
              private worlds: WorldStore,
              readonly partyId: string,
              private onEmpty: (code: string) => void) {
    this.code = code; this.solo = solo;
  }

  get isFull(): boolean { return this.seats.filter(s => s.ws || this.inWindow(s)).length >= MAX_PLAYERS; }
  get isJoinable(): boolean { return !this.solo && !this.isFull; }   // survival: join anytime
  hasDevice(deviceId: string): boolean { return this.seats.some(s => s.deviceId === deviceId); }
  hasWs(ws: WebSocket): boolean { return this.seats.some(s => s.ws === ws); }
  private inWindow(s: Seat): boolean {
    return s.disconnectedAt !== null && Date.now() - s.disconnectedAt < RECONNECT_MS;
  }

  addPlayer(ws: WebSocket, profile: Profile): void {
    const existing = this.seats.find(s => s.deviceId === profile.deviceId);
    if (existing) {
      existing.ws = ws; existing.disconnectedAt = null; existing.profile = profile;
      if (this.state === 'playing' && this.sim && existing.playerId !== null) this.sendGameStart(existing);
      else this.broadcastLobby();
      return;
    }
    this.seats.push({
      deviceId: profile.deviceId, profile, ws,
      playerId: null, disconnectedAt: null, cmdCount: 0, lastChat: 0,
    });
    if (this.state === 'playing' && this.sim) {
      // survival: late joiners spawn straight into the running world
      this.attachSeatToSim(this.seats[this.seats.length - 1]!);
      this.sendGameStart(this.seats[this.seats.length - 1]!);
    } else {
      this.broadcastLobby();
    }
  }

  handleDisconnect(ws: WebSocket): void {
    const seat = this.seats.find(s => s.ws === ws);
    if (!seat) return;
    seat.ws = null; seat.disconnectedAt = Date.now();
    if (this.state === 'lobby') { this.seats = this.seats.filter(s => s !== seat); this.broadcastLobby(); }
    void this.persist();
    this.checkEmpty();
  }

  handleLeave(ws: WebSocket): void {
    const seat = this.seats.find(s => s.ws === ws);
    if (!seat) return;
    // leaving keeps the player's body/inventory in the saved world (binding retained)
    this.seats = this.seats.filter(s => s !== seat);
    if (this.state === 'lobby') this.broadcastLobby();
    void this.persist();
    this.checkEmpty();
  }

  async handleStart(ws: WebSocket): Promise<void> {
    if (this.state !== 'lobby') return;
    if (this.seats.length === 0 || this.seats[0]!.ws !== ws) return;   // host only
    const rec = await this.worlds.load(this.partyId);
    if (rec) {
      this.sim = Sim.fromState(rec.state);
      this.bindings = rec.bindings;
      this.seed = rec.state.worldSeed;
    } else {
      this.sim = new Sim(this.seed);
      this.bindings = {};
    }
    this.state = 'playing';
    for (const seat of this.seats) this.attachSeatToSim(seat);
    for (const seat of this.seats) this.sendGameStart(seat);
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Reattach a returning device to its saved player, or spawn a fresh one. */
  private attachSeatToSim(seat: Seat): void {
    if (!this.sim) return;
    const bound = this.bindings[seat.deviceId];
    if (bound !== undefined && this.sim.state.players.has(bound)) {
      seat.playerId = bound;
      return;
    }
    const p = this.sim.addPlayer(seat.profile.unlockedSkills);
    seat.playerId = p.id;
    this.bindings[seat.deviceId] = p.id;
  }

  handleCommand(ws: WebSocket, cmd: Command): void {
    if (this.state !== 'playing' || !this.sim) return;
    const seat = this.seats.find(s => s.ws === ws);
    if (!seat || seat.playerId === null) return;
    if (++seat.cmdCount > MAX_CMDS_PER_TICK) return;
    if (!validCommand(cmd)) return;
    this.sim.applyCommand(seat.playerId, cmd);
  }

  handlePing(ws: WebSocket, pos: { x: number; y: number }): void {
    const seat = this.seats.find(s => s.ws === ws);
    if (!seat) return;
    this.broadcast({ t: 'ping', pos, from: seat.profile.name });
  }

  handleChat(ws: WebSocket, text: string): void {
    const seat = this.seats.find(s => s.ws === ws);
    if (!seat) return;
    const clean = text.slice(0, 120).trim();
    if (!clean) return;
    const now = Date.now();
    if (now - seat.lastChat < 400) return;
    seat.lastChat = now;
    this.broadcast({ t: 'chat', from: seat.profile.name, text: clean });
  }

  handleGhost(ws: WebSocket, type: import('@lf/shared').BuildingType | null,
              pos: { x: number; y: number }, ok: boolean): void {
    const seat = this.seats.find(s => s.ws === ws);
    if (!seat) return;
    const msg = encode({ t: 'ghost', from: seat.profile.name, type, pos, ok });
    for (const o of this.seats) if (o !== seat && o.ws?.readyState === o.ws?.OPEN) o.ws!.send(msg);
  }

  private tick(): void {
    if (!this.sim) return;
    const events = this.sim.step();
    this.broadcast(this.buildFrame(events));
    for (const s of this.seats) s.cmdCount = 0;
    if (this.sim.state.tick % SAVE_EVERY_TICKS === 0) void this.persist();
    const before = this.seats.length;
    this.seats = this.seats.filter(s => s.ws !== null || this.inWindow(s));
    if (this.seats.length !== before) this.checkEmpty();
  }

  private async persist(): Promise<void> {
    if (!this.sim) return;
    const rec: WorldRecord = { state: this.sim.state, bindings: this.bindings };
    try { await this.worlds.save(this.partyId, rec); } catch (e) { console.warn(`[room ${this.code}] save failed`, e); }
  }

  closeLobby(): void {
    this.broadcast({ t: 'lobby_closed' });
    this.seats = [];
    this.destroy();
    this.onEmpty(this.code);
  }

  destroy(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  private checkEmpty(): void {
    const active = this.seats.some(s => s.ws !== null || this.inWindow(s));
    if (!active) { void this.persist(); this.destroy(); this.onEmpty(this.code); }
  }

  // ---- views ----

  private buildFrame(events: SimEvent[]): ServerMsg {
    const s = this.sim!.state;
    return {
      t: 'frame', tick: s.tick, phase: s.phase, phaseTicks: s.phaseTicks,
      players: this.playerViews(), buildings: this.buildingViews(),
      groundItems: this.groundItemViews(), events,
    };
  }
  private playerViews(): PlayerView[] {
    const out: PlayerView[] = [];
    for (const seat of this.seats) {
      if (seat.playerId === null) continue;
      const p = this.sim!.state.players.get(seat.playerId);
      if (!p) continue;
      out.push({
        id: p.id, pos: p.pos, hp: p.hp, maxHp: p.maxHp, alive: p.alive, name: seat.profile.name,
        hunger: p.hunger, hand: p.hand, region: regionAt(this.sim!.regions, p.pos).name,
        inventory: p.inventory, equipment: p.equipment,
      });
    }
    return out;
  }
  private buildingViews(): BuildingView[] {
    return [...this.sim!.state.buildings.values()].map(b => ({
      id: b.id, type: b.type, pos: b.pos, hp: b.hp, maxHp: b.maxHp,
    }));
  }
  private groundItemViews(): GroundItemView[] {
    return [...this.sim!.state.groundItems.values()].map(g => ({
      id: g.id, item: g.item, count: g.count, pos: g.pos,
    }));
  }
  private nodeViews(): NodeView[] {
    return [...this.sim!.state.nodes.values()].map(n => ({ id: n.id, kind: n.kind, pos: n.pos, amount: n.amount }));
  }

  private sendGameStart(seat: Seat): void {
    this.send(seat, { t: 'game_start', seed: this.seed, selfId: seat.playerId!,
      nodes: this.nodeViews(), buildings: this.buildingViews() });
  }
  private broadcastLobby(): void {
    for (const seat of this.seats) {
      this.send(seat, { t: 'lobby', code: this.code,
        players: this.seats.map(s => ({ name: s.profile.name })), host: this.seats[0] === seat });
    }
  }
  private broadcast(msg: ServerMsg): void {
    const data = encode(msg);
    for (const seat of this.seats) if (seat.ws?.readyState === seat.ws?.OPEN) seat.ws!.send(data);
  }
  private send(seat: Seat, msg: ServerMsg): void {
    if (seat.ws?.readyState === seat.ws?.OPEN) seat.ws!.send(encode(msg));
  }
}

function validCommand(cmd: Command): boolean {
  switch (cmd.kind) {
    case 'move': return isFiniteVec(cmd.dir);
    case 'gather': case 'eat': return true;
    case 'select_hand': return Number.isInteger(cmd.slot);
    case 'move_item': return Number.isInteger(cmd.from) && Number.isInteger(cmd.to);
    case 'drop_item': return Number.isInteger(cmd.slot) && Number.isInteger(cmd.count) && cmd.count > 0;
    case 'build': return typeof cmd.type === 'string' && cmd.type in BUILDINGS && isFiniteVec(cmd.pos);
    case 'demolish': return Number.isInteger(cmd.buildingId);
    default: return false;
  }
}
function isFiniteVec(v: unknown): boolean {
  return typeof v === 'object' && v !== null &&
    Number.isFinite((v as { x: unknown }).x) && Number.isFinite((v as { y: unknown }).y);
}
```

> `handleStart` is now `async`. Update its caller in `index.ts` (`case 'start_game'`) to `void conn.room?.handleStart(ws);`.

- [ ] **Step 3: Party-keyed lobby + 4-player joins**

In `packages/server/src/lobby.ts`:
- `LobbyManager` constructor takes both stores: `constructor(private store: ProfileStore, private worlds: WorldStore) {}`.
- `createRoom(solo)` generates a `partyId` (use the room `code` as the party id for now — stable per lobby) and passes `this.worlds` + `partyId` to `new Room(...)`.
- `findJoinable` unchanged in spirit; survival rooms remain joinable while not full.

```ts
import { Room } from './room';
import type { ProfileStore } from './db';
import type { WorldStore } from './world-store';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class LobbyManager {
  private rooms = new Map<string, Room>();
  constructor(private store: ProfileStore, private worlds: WorldStore) {}

  createRoom(solo: boolean): Room {
    let code: string;
    do {
      code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    } while (this.rooms.has(code));
    const room = new Room(code, solo, this.store, this.worlds, code, c => this.rooms.delete(c));
    this.rooms.set(code, room);
    return room;
  }
  findJoinable(code: string, deviceId: string): Room | null {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return null;
    if (room.isJoinable) return room;
    if (room.hasDevice(deviceId)) return room;
    return null;
  }
  get roomCount(): number { return this.rooms.size; }
}
```

- [ ] **Step 4: Wire stores + drop removed routes in index.ts**

In `packages/server/src/index.ts`:
- Build the pool once and both stores:

```ts
import { createPool, createStore } from './db';
import { createWorldStore } from './world-store';
// ...
const pool = createPool();
const store = await createStore(pool);
const worlds = await createWorldStore(pool);
const lobbies = new LobbyManager(store, worlds);
```

- `create_lobby` / `join_lobby` no longer carry `klass`: change `addPlayer(ws, conn.profile, msg.klass)` → `addPlayer(ws, conn.profile)` in both cases, and drop `msg.klass` usage.
- `case 'start_game': void conn.room?.handleStart(ws); break;`
- Remove `case 'vote'` and `case 'restart_vote'` entirely.
- Keep `cmd`, `ping`, `chat`, `latency`, `ghost`, `unlock_skill`, `leave`, `hello`.

- [ ] **Step 5: Typecheck server**

Run: `npm run -w @lf/server typecheck`
Expected: PASS. Resolve any dangling `klass`/wave references the compiler flags.

- [ ] **Step 6: Commit**

```bash
git add packages/server
git commit -m "feat(server): survival room — 4 players, world persistence, inventory frames; remove waves/votes"
```

---

## Task 7: Client net + input + main wiring

**Files:**
- Modify: `packages/client/src/net.ts`
- Modify: `packages/client/src/input.ts`
- Modify: `packages/client/src/main.ts`

> Read each file first; the client is the least-seen layer. Mirror the server `protocol.ts` types in `net.ts` (or import shared message types if `net.ts` re-declares them). Below are the required behavioral changes; implement them against the actual current code.

- [ ] **Step 1: Sync net message types**

In `packages/client/src/net.ts`: update `ServerMsg`/`ClientMsg` mirrors to match the new `protocol.ts` (remove `klass`, `vote`, `restart_vote`, `choice_*`, `game_over`, `resources`, `wave`, `enemies`, `projectiles`; add `groundItems`, `PlayerView` inventory/hunger/hand/region fields, new `Command` kinds). Remove class selection from `create_lobby`/`join_lobby`.

- [ ] **Step 2: Input → survival controls**

In `packages/client/src/input.ts`:
- Number keys `1`–`9` and mouse wheel emit `{ kind: 'select_hand', slot }` (wheel cycles `hand`).
- `I` toggles the inventory panel (call into the HUD/inventory module; expose a callback like `onToggleInventory`).
- `E` stays the interaction key. It now resolves context client-side: if a ground item is within pickup range show "pick up" (pickup is automatic server-side, so `E` is optional there); if the held food (hand slot is a `food` item) and no node in reach → emit `{ kind: 'eat' }`; otherwise emit `{ kind: 'gather' }`. Keep the existing channel/prompt UX.
- Build placement: keep the existing ghost/drag flow but it now pays from inventory; the affordability check uses the self `PlayerView.inventory` (passed in from main).
- Remove any class/weapon and wave/vote input handling.

- [ ] **Step 3: Main frame handling**

In `packages/client/src/main.ts`:
- On `game_start`: store `selfId`, seed the world (nodes/buildings), reset per-match UI state. Remove `prevCombatLevel`/`prevTools` logic.
- On `frame`: drive renderer from `players`/`buildings`/`groundItems`; update HUD health + hunger from the self `PlayerView`; update the hotbar/inventory UI from `inventory`/`equipment`/`hand`; spawn ground-item meshes; handle new events (`pickup` pop, `eat` munch, `item_drop`, `player_died` fade + drop burst, `player_respawn` fade-in, `region_enter` toast).
- Remove all wave banner / gold / coins / council / choice / game-over / restart UI calls.
- Prediction: keep own-player movement/gather prediction; do **not** predict inventory/hunger (render straight from frames).

- [ ] **Step 4: Typecheck + build client**

Run: `npm run -w @lf/client build`
Expected: PASS (HUD/inventory UI may be placeholder-wired but must compile). If the build references not-yet-created `ui/inventory.ts`, create a minimal stub exporting the functions main calls, then flesh it out in Task 8.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/net.ts packages/client/src/input.ts packages/client/src/main.ts
git commit -m "feat(client): survival net/input/main wiring — inventory, hunger, ground items; remove waves/classes"
```

---

## Task 8: Inventory UI + HUD rework (use frontend-design)

**Files:**
- Create: `packages/client/src/ui/inventory.ts`
- Modify: `packages/client/src/ui/hud.ts`
- Modify: `packages/client/src/style.css`

- [ ] **Step 1: Invoke the design skill**

Per project rules, before building this UI run `Skill({ skill: "frontend-design" })` for the inventory + survival HUD (hotbar, backpack grid, equipment slots, health + hunger bars, item icons). Follow its output for the visual system. Keep the established CSS pointer-events architecture (`#hud > * { pointer-events: none }` with explicit `auto` opt-ins) — the inventory panel and hotbar opt in.

- [ ] **Step 2: Build the inventory module**

`packages/client/src/ui/inventory.ts` exposes:

```ts
export interface InventoryUI {
  setData(inventory: Slot[], equipment: Equipment, hand: number): void;
  toggle(): void;
  isOpen(): boolean;
  onMove: (from: number, to: number) => void;   // → emit move_item
  onDrop: (slot: number, count: number) => void; // → emit drop_item
  onSelectHand: (slot: number) => void;          // → emit select_hand
}
export function createInventoryUI(root: HTMLElement): InventoryUI;
```

- Always-visible **hotbar** (slots 0–8) with the active slot highlighted (`hand`).
- Toggleable **backpack** (slots 9–35) + 3 equipment slots.
- Drag-and-drop between slots → `onMove`; right-click or shift-click a slot → `onDrop(slot, 1)` (or whole stack with a modifier).
- Item icons: a small canvas/SVG sprite per `ItemId` (wood plank, stone chunk, berry). Use `ITEMS[id].name` for tooltips and stack counts.

- [ ] **Step 3: Rework the HUD**

In `packages/client/src/ui/hud.ts`: remove the wave banner, gold/coins counters, council/choice overlay, combat/tool upgrade slots, and game-over/restart screens' wave wording. Add a **health bar** and a **hunger bar** (segmented or smooth). The hammer build menu now lists only `wood_wall`, `gate`, `spike`, `stone_wall`, each showing its **item** cost from `BUILDINGS[type].cost`, dimmed when the self inventory can't afford it. Add a small **region-name toast** triggered by `region_enter`.

- [ ] **Step 4: Build client**

Run: `npm run -w @lf/client build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/ui/inventory.ts packages/client/src/ui/hud.ts packages/client/src/style.css
git commit -m "feat(client): inventory UI + survival HUD (health/hunger bars, item-cost build menu)"
```

---

## Task 9: Render — ground items, enlarged world, biome tint, region toast

**Files:**
- Modify: `packages/client/src/render/world.ts`
- Modify: `packages/client/src/render/scene.ts`
- Modify: `packages/client/src/render/environment.ts`

- [ ] **Step 1: Enlarge world + cull**

The terrain/ground-cover now spans `MAP_SIZE = 360`. In `environment.ts`/`scene.ts`: size the ground plane and any instanced cover to the new extent, and add camera-frustum (or radius-around-players) culling so off-screen instances are skipped. Verify the camera framing still reads as 2.5D top-down at the larger scale (adjust ortho zoom limits if needed).

- [ ] **Step 2: Biome tint**

Tint terrain by biome using the shared `generateRegions(seed)` + `regionAt` so the client coloring matches the sim's regions exactly (determinism contract). Meadow green, forest deep-green, mountains grey, swamp murk, tundra pale, plains gold, badlands rust. Reuse the existing procedural ground texture, modulated per region.

- [ ] **Step 3: Ground-item meshes + bushes**

In `world.ts`: add a `groundItems` tracked layer — a small bobbing mesh per `GroundItemView` (icon billboard or tiny model), created/updated/removed by id each frame, with a pickup pop on the `pickup` event. Add the `bush` node kind to the node renderer (a low leafy cluster with berries; on depletion it shrinks and regrows when `amount` returns).

- [ ] **Step 4: Region toast + death/respawn**

Wire `region_enter` to the HUD toast (Task 8) and `player_died`/`player_respawn` to a screen fade + an item-scatter burst at the death position.

- [ ] **Step 5: Build client**

Run: `npm run -w @lf/client build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/render
git commit -m "feat(client): render survival world — ground items, biomes, enlarged map, region toast"
```

---

## Task 10: Integration verify + deploy

**Files:** none (verification + deploy only)

- [ ] **Step 1: Full typecheck + build**

Run: `npm run typecheck` (or per-package) and `npm run -w @lf/client build`.
Expected: all PASS.

- [ ] **Step 2: Local manual verification (use the /verify skill)**

Run the server + client locally (`npm run dev` or the project's dev scripts). Verify the success criteria end-to-end:
1. Spawn empty-handed at camp; a region name toast shows.
2. Punch a tree → wood appears in the hotbar; rock → stone; bush → berry.
3. Hunger bar drains over time; eating a berry raises it.
4. Open inventory (`I`), drag items between slots, drop one (`appears on ground`), pick it back up by walking over it.
5. Place a wall/gate/spike — cost is deducted from inventory; can't place without materials.
6. Die (let hunger hit 0 or take fall — for Phase 0, starve) → inventory scatters as ground items, respawn at camp.
7. Open a second client with the same party code → both players in one world; second player joins the running world.
8. Stop and restart the server → reconnect to the same lobby code → world (trees gone where felled, buildings, your inventory) is restored from the `worlds` table.

Fix any issues found, re-running the relevant package build.

- [ ] **Step 3: Commit any fixes, then deploy**

```bash
git add -A && git commit -m "fix: phase 0 survival integration issues"
```

Deploy with the existing pipeline (push branch → merge/fast-forward to `main` on `swaffX/last-fortress` per the established flow → `scripts/deploy-vps.mjs` reads creds from env: `git fetch origin main && git reset --hard origin/main; docker compose up -d --build`). Confirm the Postgres `worlds` table is created on boot (PgWorldStore.init). Verify VPS-local + external `curl http://212.180.120.69/` serves the new bundle.

- [ ] **Step 4: Report**

Summarize what shipped (Phase 0 survival core live) and confirm the world-persistence smoke test passed on the VPS Postgres.

---

## Self-Review (run against the spec)

**Spec coverage:**
- Per-player inventory of item stacks → Task 1 (`items.ts`/`inventory.ts`), Task 3 (`Player.inventory`). ✓
- Empty-handed Minecraft start → Task 4 `addPlayer` (empty inventory), bare-hand gather. ✓
- Punch trees/rocks → items → Task 4 `stepGather`. ✓
- Berry forage + hunger loop → Task 2 (bush, constants), Task 4 (`stepHunger`, `eat`). ✓
- Hunger + health stats → Task 3 fields, Task 4 `stepHunger`/`killPlayer`. ✓
- Large persistent multi-biome world → Task 2 (regions, MAP_SIZE), Task 5 (`world-store`), Task 6 (load/save). ✓
- 4-player co-op → Task 6 (`MAX_PLAYERS=4`, late-join). ✓
- Death → drop + camp respawn → Task 4 (`killPlayer`, `stepRespawns`). ✓
- Structures repriced to inventory items, towers/gold/waves removed → Task 4 (buildings prune, item-priced build; sim drops waves/towers/economy). ✓
- Ground items (overflow, drop, pickup) → Task 4 (`spawnGroundItem`, `stepGroundItems`, `dropFromSlot`). ✓
- Region-name toast / classless start / customization-light → Task 6 (`region` in view), Task 8/9 (toast), Task 6 (no `klass`). ✓ (Deep customization deferred to Phase 6 per spec.)
- World save/load + corrupt-world fallback → Task 5 (`load` try/catch → null), Task 6 (`new Sim` on null). ✓

**Type consistency:** `Slot`/`ItemStack`/`ItemId` (Task 1) used identically in Tasks 3/4/6/8. `Sim.fromState` (Task 4) called by `Room.handleStart` (Task 6). `WorldRecord {state,bindings}` (Task 5) produced/consumed in Task 6. `PlayerView` fields (Task 6) consumed in Task 7/8. `BUILDINGS[type].cost` shape (Task 4) read in Task 6 validation and Task 8 HUD. Command kinds (Task 3) validated in Task 6 `validCommand` and emitted in Task 7. ✓

**Placeholder scan:** The `removeItem` listing in Task 1 Step 1 intentionally contains a deliberately-broken expression that is corrected in the boxed note — implement the boxed version. No `TBD`/`TODO`. Client tasks (7/9) say "read the actual file first" because those files weren't fully quoted here; the required *behaviors* are fully specified, which is the contract. ✓
