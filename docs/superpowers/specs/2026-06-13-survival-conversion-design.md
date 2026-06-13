# Last Fortress → Open-World Survival — Conversion Design

**Date:** 2026-06-13
**Status:** Approved (Phase 0 design)
**Supersedes loop:** the wave-defense / gold economy of the original Phase 1 build.

This document is the **umbrella design** for converting Last Fortress from a wave-defense
tower-defense game into a persistent, co-op, open-world survival sandbox. It records the
locked architectural decisions and the full phase decomposition, then fully specifies
**Phase 0 (Survival Core)** — the foundation every later phase builds on.

Each later phase (1–6) gets its own spec → plan → build cycle. This file is the source of
truth for sequencing and the locked decisions; do not re-litigate them per phase.

---

## Locked Decisions (apply to all phases)

| Decision | Choice | Consequence |
|---|---|---|
| World persistence | **Persistent** (save/load to DB) | World state (terrain seed, buildings, ground items, per-player inventory + position) saved per party; rejoin resumes. |
| Death | **Respawn at camp + drop inventory** | On HP 0: full inventory drops as ground items at death position; respawn at camp anchor after a delay; hunger reset to mid, HP restored. |
| Co-op size | **Up to 4 players** | Party of 1–4 via party code; net/sync/spawn budgets sized for 4. |
| Map | **Large fixed map, ~8× current, named biome regions** | One deterministically-generated bounded world, 6–10 named biomes; deterministic seed contract preserved (sim + renderer consume identical generation). |
| Legacy TD content | **Passive structures only** (wall / gate / spike) | Towers, gold mines, wood camps, stone quarries, healing totem, gold/coins economy, wave scheduler, council votes, restart votes — all removed. Player does all defense. |
| Classes | **Removed** | No Knight/Hunter. Everyone starts identical and empty-handed. Weapons/tools come from crafting and (later) mob/boss drops. Light character customization (name + colors). |
| Core loop | **Free-roam survival** | No forced waves. Day/night continues; night is dangerous (zombie content lands in Phase 2). Progression = items, structures, and (later) crafting tech, not gold. |

---

## Phase Decomposition (build order)

Each phase produces working, testable software and depends on the ones before it.

- **Phase 0 — Survival Core** *(this spec)*: item system, per-player inventory, empty-handed
  Minecraft-style start, hunger + health, large persistent multi-biome world, 4-player co-op,
  death→drop→respawn, structures repriced to inventory items, towers/gold/waves removed.
- **Phase 1 — Crafting**: recipe graph, crafting table, sticks, material-tiered tools & weapons
  (wood/stone axe-pick-sword), crafting UI.
- **Phase 2 — Creatures & Combat**: passive animals (cow/sheep/pig/wolf/spider + 5 more) with
  loot drops; day hostile mobs (sword/mage/dagger/spear); night zombie packs; danger zones;
  bosses dropping weapons (spear/katana/mage staff). Weapons become stat-bearing items.
- **Phase 3 — Cooking & Farming**: campfire/stove cooking (raw→cooked), tilling, wheat & fruit,
  bread chain; food restores hunger.
- **Phase 4 — Environment**: calendar (clock, day/week/month, seasons), weather events
  (rain/snow/hail/storm/wind) with in-world effects; cold/temperature stat; warmth sources;
  fur clothing/armor that reduces cold.
- **Phase 5 — Taming & Mounts**: horses; crafted harness; tame (E + hold progress bar); ride for
  faster travel; 5-slot horse storage; horse armor.
- **Phase 6 — World Map & Regions**: named-region spawn tables, M-key full map with
  self/teammate/camp markers, deep character customization.

---

## Phase 0 — Survival Core (full spec)

### Goal

Convert the wave-defense arena into a free-roam survival foundation: a real per-player
inventory of item stacks, an empty-handed start, hunger + health survival stats, a large
persistent multi-biome world, 4-player co-op, and death→drop→camp-respawn. Remove the
wave / gold / coins / tower / council machinery. This is the platform every later phase
builds on.

### Success criteria ("done" definition)

A 4-player **persistent** world where a player:
1. spawns empty-handed in a named biome,
2. punches trees/rocks → resources land as **items** in a real inventory grid,
3. forages berry bushes and eats to manage a working hunger stat,
4. places wall / gate / spike paid from inventory items,
5. dies → full inventory drops as ground items → respawns at camp,
6. rejoins later and finds the world (terrain, structures, ground items, own inventory) saved.

No towers, no waves, no gold, no coins, no council votes.

---

### Component 1 — Item System (`packages/shared/src/sim/data/items.ts`, new)

The foundation. Everything downstream (crafting, loot, food, weapons, armor, mounts) keys
off item definitions.

```ts
export type ItemId =
  // raw resources
  | 'wood' | 'stone'
  // forage / food (Phase 0 minimal; expanded in Phase 3)
  | 'berry'
  // placeholders reserved for later phases are NOT added until those phases.
  ;

export type ItemCategory = 'resource' | 'food' | 'tool' | 'weapon' | 'armor' | 'placeable';

export interface ItemDef {
  id: ItemId;
  name: string;
  category: ItemCategory;
  stackSize: number;        // max per slot
  foodValue?: number;       // hunger restored when eaten (food only)
  // fields like toolPower / dmg / warmth are added by later phases, not Phase 0
}

export const ITEMS: Record<ItemId, ItemDef> = {
  wood:  { id: 'wood',  name: 'Wood',  category: 'resource', stackSize: 99 },
  stone: { id: 'stone', name: 'Stone', category: 'resource', stackSize: 99 },
  berry: { id: 'berry', name: 'Berry', category: 'food',     stackSize: 32, foodValue: 18 },
};
```

`ItemStack = { item: ItemId; count: number } | null` (null = empty slot).

**Inventory helper module** (`packages/shared/src/sim/inventory.ts`, new): pure functions
operating on `(ItemStack|null)[]` — `addItem(inv, item, count) → leftover`,
`removeItem(inv, item, count) → boolean`, `countItem`, `moveSlot(inv, from, to)`,
`firstEmpty`. Stacking respects `stackSize`. Deterministic, no side effects, unit-test-friendly.

### Component 2 — Player & State changes (`packages/shared/src/sim/types.ts`)

`Player` (revised):
- **Remove**: `klass`, `weapon`, `axeTier`, `pickTier`, `combatLevel`.
- **Keep**: `id`, `pos`, `hp`, `maxHp`, `attackCooldown`, `alive`, `respawnTicks`, `mods`,
  `gatherCooldown`, `gatherTarget`.
- **Add**:
  - `inventory: (ItemStack | null)[]` — fixed length 36 (slots 0–8 = hotbar, 9–35 = backpack).
  - `equipment: { head: ItemStack|null; body: ItemStack|null; legs: ItemStack|null }` — slots
    exist but are inert in Phase 0 (filled by later phases).
  - `hand: number` — selected hotbar index 0–8.
  - `hunger: number` — 0–100; starts 80.
  - `temperature: number` — 0–100 placeholder, starts 100, inert until Phase 4.

`SimState`:
- **Remove**: `wave`, `pendingSpawns`, `bonuses`, `castleId`, team `resources`.
- **Add**: `groundItems: Map<EntityId, DroppedItem>`, `worldSeed: number`.
- **Keep**: `tick`, `phase`, `phaseTicks` (day/night clock continues), `buildings`,
  `enemies` (empty in Phase 0; zombies arrive Phase 2), `players`, `nodes`, `projectiles`
  (empty in Phase 0), `nextId`, `gameOver` (repurposed: false always in survival; per-player
  death handled individually).

```ts
export interface DroppedItem {
  id: EntityId;
  stack: { item: ItemId; count: number };
  pos: Vec2;
  ttlTicks: number;       // despawn timer; refreshed on death drops
}
```

`ResourceNode.kind` extended: `'tree' | 'rock' | 'bush'`. Bush yields `berry`, depletes,
regrows after a cooldown (regrow keeps the world alive without infinite walking).

### Component 3 — World generation (`packages/shared/src/sim/regions.ts`, new + `mapgen.ts` rework)

- `MAP_SIZE` enlarged ~8× (e.g. current N → N*2.8 per axis ≈ 8× area). Validate perf with
  instanced rendering + camera culling.
- `generateRegions(seed) → RegionMap`: partition the world into 6–10 named biomes via a
  deterministic Voronoi/grid-cell scheme. Each region: `{ id, name, biome, center, bounds }`.
  Biomes: `meadow` (safe spawn), `forest`, `mountains`, `swamp`, `tundra`, `plains` (+ optional
  `badlands`, `riverlands`). The existing river generation folds into region layout.
- `regionAt(regions, pos) → Region` — used for the entry-name toast and (later) spawn tables.
- Node/decor density and palette vary per biome (forest = dense trees, mountains = rock-heavy,
  meadow = bushes + sparse trees). Determinism contract preserved: sim, prediction, and
  renderer all derive identical world from `worldSeed`.
- Camp anchor: a fixed safe point inside the `meadow` region = default respawn + party home.

### Component 4 — Sim systems (`packages/shared/src/sim/sim.ts` rework)

- **Remove**: wave scheduler, enemy spawning from waves, tower firing, income ticks, gold/coin
  economy, council/bonus application. (Enemy/projectile loops stay as dormant code paths —
  no spawners in Phase 0 — so Phase 2 can re-enable.)
- **Gather rework** (`stepGather`): `gather` harvests nearest in-range node by `kind`. Phase 0
  has no tools, so bare-hand yields a small fixed amount per channel hit (wood from tree, stone
  from rock, berry from bush) straight into the player's inventory via `inventory.addItem`. If
  inventory is full, the overflow spawns a `DroppedItem` at the player. Channel/progress
  mechanic and `node_depleted` event preserved. Tool-tier yields return in Phase 1.
- **Hunger** (`stepHunger`): decays slowly each tick (faster while moving/gathering). At 0,
  drains HP gradually. `eat` command consumes one `berry` from hand/inventory and restores
  `foodValue`, clamped to 100.
- **Death & respawn** (`stepPlayers`): HP ≤ 0 → mark dead, spawn `DroppedItem`s for every
  non-null inventory + equipment slot at death pos (clear them from the player), start
  `respawnTicks`. On respawn: teleport to camp anchor, HP = maxHp, hunger = 60, inventory
  empty.
- **Ground items** (`stepGroundItems`): tick `ttlTicks`; despawn at 0; auto-pickup when a live
  player is within pickup range and has room (added to inventory; leftover stays on ground).
- **Building rework**: `validateBuild` and `applyCommand('build')` now charge the **player's
  inventory** (e.g. wall = 4 wood, gate = 6 wood, spike = 3 stone) via `inventory.removeItem`,
  not a team counter. Only `wood_wall`, `gate`, `spike` remain as buildable types (rename set
  in `data/buildings.ts`; tower/economy entries deleted). Buildings still collide and have HP.

### Component 5 — Commands & events (`packages/shared/src/sim/types.ts`)

`Command` (revised set):
```ts
| { kind: 'move'; dir: Vec2 }
| { kind: 'gather' }
| { kind: 'eat' }
| { kind: 'select_hand'; slot: number }            // 0..8
| { kind: 'move_item'; from: number; to: number }  // inventory rearrange (slot indices)
| { kind: 'drop_item'; slot: number; count: number }
| { kind: 'build'; type: BuildingType; pos: Vec2 }
| { kind: 'demolish'; buildingId: EntityId }
```
Removed: `attack` (no-op), `upgrade_combat`, `upgrade_tool`, `upgrade` (tower tiers).

`SimEvent` additions: `{ kind: 'pickup'; pos: Vec2; item: ItemId; count: number }`,
`{ kind: 'eat'; pos: Vec2 }`, `{ kind: 'item_drop'; pos: Vec2; item: ItemId }`,
`{ kind: 'player_died'; id: EntityId; pos: Vec2 }`,
`{ kind: 'player_respawn'; id: EntityId; pos: Vec2 }`,
`{ kind: 'region_enter'; id: EntityId; region: string }`.
Removed: `coins`, `wave_start`, all tower/economy events.

### Component 6 — Server (`packages/server`)

- **World persistence** (`packages/server/src/world-store.ts`, new + `worlds` table in `db.ts`):
  `WorldStore.load(partyId) → SimState | null`, `WorldStore.save(partyId, state)`. Serialize
  `SimState` (Maps → arrays) to JSONB. Room saves periodically (e.g. every ~30 s) and on the
  last player leaving. On room create: load existing world for the party or generate a fresh
  one from a new seed. Memory fallback store mirrors the profile-store pattern.
- **Protocol** (`packages/server/src/protocol.ts`): `PlayerView` gains
  `inventory`, `equipment`, `hand`, `hunger`, `temperature`, `hp/maxHp`, `alive`; drop
  `combatLevel/axeTier/pickTier/klass/weapon`. New `GroundItemView[]`. Frame drops
  `wave/resources/bonuses`; adds `groundItems` and current `region` per player. New
  `ClientMsg` kinds: `select_hand`, `move_item`, `drop_item`, `eat` (plus existing `cmd`
  routing — these can ride inside `cmd`). Remove `vote`, `restart_vote`, council messages.
- **Room** (`packages/server/src/room.ts`): cap raised to 4. Delete wave loop, `offerChoice`,
  vote/restart flows, gold/coin views. `validCommand` whitelist updated to the new command set.
  Lobby never ends on "game over" — it persists; players can leave/rejoin freely.
- **Index/lobby**: party supports 4; world id tied to party for persistence.

### Component 7 — Client (`packages/client`)

UI built with the `/frontend-design` skill during the build phase (per project rules).

- **Inventory UI** (`packages/client/src/ui/inventory.ts`, new): always-on **hotbar**
  (9 slots, active-slot highlight, select via keys 1–9 + mouse wheel); toggleable **backpack
  panel** (I key) showing 27 slots + 3 equipment slots, with drag-and-drop emitting `move_item`;
  right-click / shift to drop emitting `drop_item`. Item icons rendered from a small canvas/SVG
  set.
- **HUD** (`packages/client/src/ui/hud.ts` rework): **health bar + hunger bar**; remove wave
  banner, gold/coins counters, council overlay, combat/tool upgrade slots. Hammer still opens a
  build menu but lists only wall/gate/spike with **item** costs, dimmed when unaffordable from
  inventory.
- **Render** (`packages/client/src/render/*`): ground-item meshes with bob/pickup pop;
  enlarged world with camera-frustum culling of instanced cover; biome-tinted terrain + palette
  per region; region-name toast on `region_enter`; death/respawn fade. Minimal character
  customization at lobby (name + body/accent color); deep customization deferred to Phase 6.
- **Input** (`packages/client/src/input.ts`): 1–9 and wheel → `select_hand`; I → inventory
  toggle; E → `gather`/`pickup`/`eat` context; existing build placement retained but priced
  from inventory. Full M-map deferred to Phase 6; keep the existing minimap.
- **Prediction**: own-player movement/gather prediction preserved; inventory/hunger are
  server-authoritative (shown from frames, no client prediction) to avoid desync.

### Error handling & edge cases

- **Full inventory**: gather/pickup overflow spawns a `DroppedItem` rather than vanishing.
- **Build without materials**: server rejects; client greys the option (no optimistic spend).
- **Death mid-gather/build**: channel cancelled; pending placements dropped.
- **Rejoin after world save**: player restored to saved position + inventory; if the saved
  player slot is gone (new device), spawn fresh at camp with empty inventory.
- **Corrupt / migrated world JSON**: `WorldStore.load` validates shape; on failure, log and
  generate a fresh world rather than crashing the room.
- **4-player frame size**: frames already diff-free JSON; monitor payload, cull ground items
  and entities outside a generous radius of each player if needed.

### Out of scope for Phase 0 (explicitly deferred)

Crafting/recipes, tools beyond bare hand, animals, hostile mobs & zombies, bosses & weapon
drops, cooking, farming beyond berry forage, weather/seasons/calendar, temperature effects,
taming/mounts, the full M-map, and deep character customization. Each is a later phase above.

### Testing

Per standing project instruction, **tests are written only when the user explicitly asks**,
at the end. During the build, correctness is verified with `tsc` typecheck, `vite build`, and
manual in-app verification. The pure modules (`inventory.ts`, `regions.ts`) are designed to be
unit-test-friendly for when tests are requested.
