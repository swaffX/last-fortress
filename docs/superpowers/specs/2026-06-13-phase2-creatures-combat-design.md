# Phase 2 — Creatures & Combat Design

**Date:** 2026-06-13
**Status:** Approved
**Builds on:** Phase 0 (Survival Core) + Phase 1 (Crafting). Work now lands directly on `main`.

Phase 2 brings the world to life: passive and predatory animals with loot, daytime bandit
mobs, nightly zombie packs, biome danger zones, and bosses that drop powerful weapons. Crafted
weapons finally have real targets via a manual swing combat model. One large implementation
plan (Phase 0 scale).

---

## Locked Decisions

| Decision | Choice |
|---|---|
| Combat | **Manual swing** — left-click sweeps the held weapon through a front arc; weapon `dmg` + durability drain; bare hand = weak punch. |
| Animal behavior | **Mixed** — herbivores flee when hit; predators are aggressive/neutral and fight. |
| Scope | **Full set in one plan** — 10 animals, 4 day-bandit classes, 3 zombie types, 3 bosses, danger zones, loot + weapon drops. |

---

## Architecture

A single data-driven **`Creature`** entity replaces the Phase-0-removed `Enemy`. Species are
declared in `data/creatures.ts` (faction, behavior, stats, attack, loot table); spawn pressure
is declared in `data/spawning.ts` (per-biome faction weights, day/night gating, population
caps). The sim gains `stepSpawning` (maintains populations away from players, despawns the far
ones) and `stepCreatures` (AI: flee / aggro / pack / march, melee + ranged attacks, death →
loot). Projectiles return for ranged attackers. Players attack with a new `attack { dir }`
command that sweeps a front arc. Determinism contract preserved — spawns use the sim RNG; the
renderer only reflects creature views.

---

## Components

### 1. Item expansion (`data/items.ts`)

New items:
- **Food (raw):** `raw_meat` (food, restores a little now; cooking in Phase 3 makes it better).
- **Materials:** `leather`, `wool`, `silk`, `pelt`, `feather`, `hide`, `bone`, `venom`.
- **Boss weapons:** `katana` (dmg 48, dur 220), `war_spear` (dmg 40, dur 200, reach), `mage_staff`
  (dmg 44, dur 160, ranged — fires a bolt on swing). These extend the existing
  `wood_sword/stone_sword/wood_spear` weapon line.

Weapon `ItemDef` gains optional `reach?: number` (arc length, default ~2.2) and
`ranged?: boolean` (mage staff fires a projectile instead of an arc).

### 2. Creature data (`data/creatures.ts`, new)

```ts
export type Faction = 'animal' | 'bandit' | 'zombie' | 'boss';
export type Behavior = 'flee' | 'aggressive' | 'neutral' | 'pack' | 'march';

export interface LootEntry { item: ItemId; min: number; max: number; chance: number; }

export interface CreatureDef {
  id: string;            // species key
  faction: Faction;
  behavior: Behavior;
  hp: number;
  dmg: number;
  speed: number;         // units/sec
  radius: number;        // body/separation radius
  attackRange: number;   // melee ~1.2, ranged > 2
  attackCooldownTicks: number;
  ranged?: 'spit' | 'bolt';   // ranged attackers fire projectiles
  aggroRange: number;    // how close before aggressive/neutral engage
  loot: LootEntry[];
  bossDrop?: ItemId;     // guaranteed weapon drop for bosses
  scale?: number;        // render size hint
}
```

Roster (~20):
- **Herbivores (flee):** `cow` (loot meat+leather), `sheep` (wool+meat), `pig` (meat),
  `chicken` (feather+meat), `rabbit` (meat+hide).
- **Predators (aggressive/neutral):** `wolf` (pelt+meat, pack), `boar` (hide+meat, neutral),
  `bear` (pelt+meat+bone, aggressive), `spider` (silk+venom, aggressive, ranged spit),
  `snake` (hide+venom, neutral).
- **Bandits (day, danger zones, aggressive):** `bandit_sword`, `bandit_dagger` (fast),
  `bandit_spear` (reach), `bandit_mage` (ranged bolt). Loot scraps (wood/stone/leather) +
  rare weapon (`wood_sword`/`stone_sword`).
- **Zombies (night, march):** `zombie` , `zombie_fast`, `zombie_brute`. Loot `bone`, `raw_meat`.
- **Bosses (danger zones / deep night, march+aggressive):** `warlock` (ranged, drops
  `mage_staff`), `butcher` (heavy melee, drops `katana`), `spider_queen` (ranged + spawns no
  adds for now, drops `war_spear`).

### 3. Spawning (`data/spawning.ts`, new)

Per-biome **safety** + faction weights:
- Safe biomes (`meadow`, `plains`): animals only, moderate density; no spawns near the camp
  clearing.
- Danger biomes (`badlands`, `swamp`, `mountains`): predators + day bandits + nightly heavy
  zombies + a chance of a roaming boss.
- Neutral (`forest`, `tundra`): mix, lighter danger.

A `spawnPlan(phase, biome)` returns target counts per faction. The sim keeps a soft population
cap per faction and total; it spawns at valid points (on land, off bridges, away from players
≥ a min radius, inside the requesting biome) and despawns creatures far from every player.
Night raises zombie targets sharply; day zeroes zombies and enables bandits in danger biomes.

### 4. Sim — creatures, AI, attacks, loot (`sim.ts`)

- `Creature` runtime type (id, def key, faction, pos, hp, maxHp, target, attackCooldown,
  fleeTicks, slow fields) in `types.ts`; `creatures: Map` in `SimState`; `projectiles` map
  returns.
- `stepSpawning(events)`: maintain populations per the spawn plan; emit `creature_spawn`.
- `stepCreatures(events)`: per creature, run behavior —
  - **flee:** if recently damaged or a player is within aggroRange, run directly away; else
    wander slowly.
  - **aggressive / neutral:** neutral engages only after being hit (a `provoked` flag);
    aggressive engages any player within aggroRange. Move toward the target; in attackRange,
    attack (melee damage or fire a projectile for ranged).
  - **pack:** like aggressive plus separation/cohesion with same-species neighbors.
  - **march (zombies/bosses):** target nearest player, else the camp anchor; attack buildings
    blocking the path (reuse the Phase-1-removed blocking logic, restored against `Creature`).
  - Separation bucket grid (reused) keeps bodies from stacking.
  - On death: roll the loot table → `spawnGroundItem` per entry; bosses additionally drop
    `bossDrop` as a durable weapon; emit `creature_death`.
- Creature attacks damage players via `damagePlayer` (already drops inventory on death).
- `stepProjectiles` restored: homing toward target; on impact damages player/creature/building.

### 5. Player combat (`sim.ts`, `types.ts`)

- New command `{ kind: 'attack'; dir: Vec2 }`. On apply: if `attackCooldown` is 0, sweep —
  gather every creature whose angle from `dir` is within the weapon arc (~120°) and distance ≤
  `reach` (weapon `reach` or bare-hand 1.4); apply weapon `dmg` (bare hand small) to each;
  drain 1 durability on the held weapon (break → `tool_broke`); set `attackCooldown` from the
  weapon. A `ranged` weapon (mage staff) instead fires a `bolt` projectile toward `dir`.
- Emit `swing { pos, dir }` for the client animation and `damage` per hit.
- Bare-hand punch also lets early players kill weak animals (chicken/rabbit) before crafting.

### 6. Server (`protocol.ts`, `room.ts`)

- `CreatureView { id, species, faction, pos, hp, maxHp, state }` and `ProjectileView { id,
  kind, pos }` added; `frame` carries `creatures` + `projectiles`.
- `validCommand` accepts `attack` (finite `dir`).
- No new top-level messages; spawns/deaths/swings ride the events array.
- Persistence: creatures + projectiles are transient — **excluded** from the saved world
  snapshot (re-spawned from the plan on load). `snapshot.ts` simply omits them.

### 7. Client (`packages/client`)

- **Models** (`render/models.ts`): rebuild a `creatureModel(species)` factory — quadruped
  animals (cow/sheep/pig/wolf/bear/boar), bird (chicken), small (rabbit), spider/snake,
  humanoid bandits (reuse player rig tinted, with a weapon), zombies (the old zombie rig,
  restored), and larger boss variants. `projectileModel` restored for `spit`/`bolt`.
- **Render** (`render/world.ts`): a `creatures` tracked layer (interp + walk/attack anims +
  hp bars + faction ring color), `projectiles` layer, and the **player swing** animation on
  `swing` events (arc slash VFX in the aim direction).
- **Effects/Audio**: hit sparks, blood puffs, death poofs; swing/whoosh, growl, bandit shout,
  zombie groan, boss roar, projectile hiss.
- **HUD**: a small **threat indicator** (nearby hostile count / "DANGER" when in a danger biome
  at night), boss health bar at the top when a boss is active, and damage numbers (already
  present) for combat.
- **Input** (`input.ts`/`main.ts`): **left-click = attack** in the aim direction (currently
  left-click selects/deselects buildings — keep selection only when hovering a building;
  otherwise a click swings). Send `attack { dir }` toward the cursor world point.
- **Ambiance** (`render/scene.ts`): danger biomes at night push a red-tinted fog + tense music
  cue; safe biomes stay calm.

### Error handling & edge cases
- **Spawn flood / perf:** hard total-creature cap; spawns throttled per tick; far creatures
  despawn. 4-player frames monitored — cull creature views beyond a generous radius of every
  player if payload grows.
- **Click ambiguity:** a left-click over an own building still selects it (build/inspect);
  clicks on open ground or enemies swing. Build-placement mode swallows the swing.
- **Death loop:** a player killed by a creature drops inventory + respawns at camp (Phase 0
  path); creatures lose their dead target and re-acquire.
- **Boss uniqueness:** at most one boss per danger biome at a time; a boss despawns if all
  players leave its biome for long enough (its drop is only on kill).
- **Ranged through walls:** projectiles check building collision on impact so walls block shots.

### Out of scope (later phases)
Cooking raw meat (Phase 3), fur clothing & cold (Phase 4), taming animals/horses (Phase 5),
metal/iron weapon tiers, ranged player bows (could be a later combat pass).

### Testing
Per standing instruction, tests are written only when explicitly requested. Verify with `tsc`
+ `vite build` + a WS smoke: spawn near an animal and confirm a left-click swing kills it and
drops loot; stand in a danger biome at night and confirm zombies spawn and path toward the
player; kill a (debug-spawned) boss and confirm the weapon drop.
