# Phase 2 — Creatures & Combat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
>
> **Testing deviation (user instruction):** No test suites during the build — tests last, only when asked. Each task ends with **typecheck + build + WS-smoke** verification.

**Goal:** Populate the survival world with animals (flee/predator), daytime bandits, nightly zombie packs, biome danger zones, and bosses that drop weapons — and give crafted weapons real targets via a manual swing combat model.

**Architecture:** One data-driven `Creature` entity (declared in `data/creatures.ts`) replaces the removed `Enemy`. Spawn pressure lives in `data/spawning.ts` (per-biome faction weights, day/night gating, caps). The sim gains `stepSpawning`, `stepCreatures` (flee/aggro/pack/march AI + melee/ranged attacks + death loot) and a restored `stepProjectiles`. Players attack with `attack { dir }` — a front-arc sweep that drains weapon durability. Creatures/projectiles are transient (excluded from the saved world). The client adds creature/projectile render layers, a swing animation, a threat/boss HUD, and danger-biome ambiance.

**Tech Stack:** TypeScript strict monorepo — `@lf/shared`, `@lf/server`, `@lf/client` (Three.js). Work lands on `main`.

**Spec:** `docs/superpowers/specs/2026-06-13-phase2-creatures-combat-design.md`

---

## File Structure

- `packages/shared/src/sim/data/items.ts` *(modify)* — combat materials, `raw_meat`, boss weapons, weapon `reach`/`ranged`.
- `packages/shared/src/sim/data/creatures.ts` *(new)* — `CreatureDef`, `LootEntry`, `CREATURES`.
- `packages/shared/src/sim/data/spawning.ts` *(new)* — biome safety + `spawnPlan`.
- `packages/shared/src/sim/types.ts` *(modify)* — `Creature`, `Projectile`, state maps, `attack` cmd, events, `Player.attackCooldown`.
- `packages/shared/src/sim/sim.ts` *(modify)* — spawning, creature AI, attacks, projectiles, player swing, loot.
- `packages/shared/src/sim/snapshot.ts` *(modify)* — omit creatures/projectiles.
- `packages/shared/src/index.ts` *(modify)* — export creatures/spawning.
- `packages/server/src/protocol.ts` *(modify)* — `CreatureView`, `ProjectileView`, frame fields.
- `packages/server/src/room.ts` *(modify)* — views + `attack` validation.
- `packages/client/src/render/models.ts` *(modify)* — `creatureModel`, `projectileModel`.
- `packages/client/src/render/world.ts` *(modify)* — creature + projectile layers, swing anim.
- `packages/client/src/render/effects.ts`, `audio.ts` *(modify)* — combat VFX/SFX.
- `packages/client/src/net.ts`, `main.ts`, `input.ts`, `ui/hud.ts` *(modify)* — left-click attack, threat/boss HUD.

Verify: `npm run -w @lf/shared typecheck`, `npm run -w @lf/server typecheck`, `npm run -w @lf/client build`.

---

## Task 1: Item expansion — combat materials, raw meat, boss weapons (shared)

**Files:** Modify `packages/shared/src/sim/data/items.ts`.

- [ ] **Step 1: Add IDs, fields, and entries**

In `items.ts`, extend the `ItemId` union with:
`'raw_meat' | 'leather' | 'wool' | 'silk' | 'pelt' | 'feather' | 'hide' | 'bone' | 'venom' | 'katana' | 'war_spear' | 'mage_staff'`.

Add two optional fields to `ItemDef`:
```ts
  reach?: number;     // melee arc length (weapons); default 2.2
  ranged?: boolean;   // fires a projectile on swing instead of an arc
```

Add to `ITEMS`:
```ts
  raw_meat: { id: 'raw_meat', name: 'Raw Meat', category: 'food', stackSize: 16, foodValue: 10 },
  leather: { id: 'leather', name: 'Leather', category: 'resource', stackSize: 64 },
  wool:    { id: 'wool',    name: 'Wool',    category: 'resource', stackSize: 64 },
  silk:    { id: 'silk',    name: 'Silk',    category: 'resource', stackSize: 64 },
  pelt:    { id: 'pelt',    name: 'Fur Pelt',category: 'resource', stackSize: 64 },
  feather: { id: 'feather', name: 'Feather', category: 'resource', stackSize: 64 },
  hide:    { id: 'hide',    name: 'Hide',    category: 'resource', stackSize: 64 },
  bone:    { id: 'bone',    name: 'Bone',    category: 'resource', stackSize: 64 },
  venom:   { id: 'venom',   name: 'Venom',   category: 'resource', stackSize: 64 },
  katana:  { id: 'katana',  name: 'Katana',  category: 'weapon', stackSize: 1, dmg: 48, durabilityMax: 220, reach: 2.4, repairItem: 'stone', repairCost: 2 },
  war_spear:{ id: 'war_spear', name: 'War Spear', category: 'weapon', stackSize: 1, dmg: 40, durabilityMax: 200, reach: 3.0, repairItem: 'stone', repairCost: 2 },
  mage_staff:{ id: 'mage_staff', name: 'Mage Staff', category: 'weapon', stackSize: 1, dmg: 44, durabilityMax: 160, ranged: true, repairItem: 'bone', repairCost: 2 },
```

Also give the existing weapons a reach for the arc (edit their entries):
`wood_sword` + `reach: 2.0`, `stone_sword` + `reach: 2.2`, `wood_spear` + `reach: 2.8`.

- [ ] **Step 2: Typecheck shared**

Run: `npm run -w @lf/shared typecheck`
Expected: PASS (additive; new optional fields).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/sim/data/items.ts
git commit -m "feat(shared): combat materials, raw meat, boss weapons + weapon reach/ranged"
```

---

## Task 2: Creature + spawning data (shared)

**Files:** Create `packages/shared/src/sim/data/creatures.ts`, `packages/shared/src/sim/data/spawning.ts`; modify `packages/shared/src/index.ts`.

- [ ] **Step 1: Creature definitions**

`packages/shared/src/sim/data/creatures.ts`:

```ts
import type { ItemId } from './items';

export type Faction = 'animal' | 'bandit' | 'zombie' | 'boss';
export type Behavior = 'flee' | 'aggressive' | 'neutral' | 'pack' | 'march';

export interface LootEntry { item: ItemId; min: number; max: number; chance: number; }

export interface CreatureDef {
  id: string;
  faction: Faction;
  behavior: Behavior;
  hp: number;
  dmg: number;
  speed: number;              // units/sec
  radius: number;
  attackRange: number;
  attackCooldownTicks: number;
  ranged?: 'spit' | 'bolt';
  aggroRange: number;
  loot: LootEntry[];
  bossDrop?: ItemId;
  scale?: number;
}

const L = (item: ItemId, min: number, max: number, chance = 1): LootEntry => ({ item, min, max, chance });

export const CREATURES: Record<string, CreatureDef> = {
  // ---- herbivores: flee ----
  cow:    { id: 'cow', faction: 'animal', behavior: 'flee', hp: 30, dmg: 0, speed: 2.2, radius: 0.6, attackRange: 0, attackCooldownTicks: 0, aggroRange: 7, scale: 1.2, loot: [L('raw_meat', 2, 3), L('leather', 1, 2)] },
  sheep:  { id: 'sheep', faction: 'animal', behavior: 'flee', hp: 22, dmg: 0, speed: 2.4, radius: 0.5, attackRange: 0, attackCooldownTicks: 0, aggroRange: 7, loot: [L('wool', 1, 3), L('raw_meat', 1, 2)] },
  pig:    { id: 'pig', faction: 'animal', behavior: 'flee', hp: 24, dmg: 0, speed: 2.3, radius: 0.5, attackRange: 0, attackCooldownTicks: 0, aggroRange: 7, loot: [L('raw_meat', 2, 4)] },
  chicken:{ id: 'chicken', faction: 'animal', behavior: 'flee', hp: 8, dmg: 0, speed: 2.8, radius: 0.32, attackRange: 0, attackCooldownTicks: 0, aggroRange: 6, scale: 0.7, loot: [L('feather', 1, 3), L('raw_meat', 1, 1)] },
  rabbit: { id: 'rabbit', faction: 'animal', behavior: 'flee', hp: 6, dmg: 0, speed: 3.4, radius: 0.28, attackRange: 0, attackCooldownTicks: 0, aggroRange: 6, scale: 0.6, loot: [L('raw_meat', 1, 1), L('hide', 1, 1, 0.6)] },
  // ---- predators: aggressive / neutral ----
  wolf:   { id: 'wolf', faction: 'animal', behavior: 'pack', hp: 34, dmg: 9, speed: 3.2, radius: 0.5, attackRange: 1.3, attackCooldownTicks: 18, aggroRange: 9, loot: [L('pelt', 1, 2), L('raw_meat', 1, 2)] },
  boar:   { id: 'boar', faction: 'animal', behavior: 'neutral', hp: 40, dmg: 11, speed: 2.8, radius: 0.55, attackRange: 1.3, attackCooldownTicks: 22, aggroRange: 6, loot: [L('hide', 1, 2), L('raw_meat', 2, 3)] },
  bear:   { id: 'bear', faction: 'animal', behavior: 'aggressive', hp: 80, dmg: 20, speed: 2.9, radius: 0.7, attackRange: 1.5, attackCooldownTicks: 26, aggroRange: 8, scale: 1.4, loot: [L('pelt', 2, 3), L('raw_meat', 3, 4), L('bone', 1, 2)] },
  spider: { id: 'spider', faction: 'animal', behavior: 'aggressive', hp: 26, dmg: 8, speed: 3.0, radius: 0.5, attackRange: 6, attackCooldownTicks: 30, ranged: 'spit', aggroRange: 8, loot: [L('silk', 1, 3), L('venom', 1, 1, 0.7)] },
  snake:  { id: 'snake', faction: 'animal', behavior: 'neutral', hp: 16, dmg: 10, speed: 2.4, radius: 0.34, attackRange: 1.2, attackCooldownTicks: 20, aggroRange: 5, scale: 0.7, loot: [L('hide', 1, 1), L('venom', 1, 1)] },
  // ---- bandits: day, danger zones ----
  bandit_sword: { id: 'bandit_sword', faction: 'bandit', behavior: 'aggressive', hp: 50, dmg: 12, speed: 3.0, radius: 0.5, attackRange: 1.4, attackCooldownTicks: 16, aggroRange: 10, loot: [L('wood', 2, 4), L('leather', 1, 2), L('wood_sword', 1, 1, 0.15)] },
  bandit_dagger:{ id: 'bandit_dagger', faction: 'bandit', behavior: 'aggressive', hp: 38, dmg: 9, speed: 3.8, radius: 0.45, attackRange: 1.2, attackCooldownTicks: 12, aggroRange: 11, loot: [L('stone', 2, 4), L('hide', 1, 2)] },
  bandit_spear: { id: 'bandit_spear', faction: 'bandit', behavior: 'aggressive', hp: 46, dmg: 14, speed: 2.8, radius: 0.5, attackRange: 2.6, attackCooldownTicks: 20, aggroRange: 10, loot: [L('wood', 3, 5), L('wood_spear', 1, 1, 0.12)] },
  bandit_mage:  { id: 'bandit_mage', faction: 'bandit', behavior: 'aggressive', hp: 36, dmg: 13, speed: 2.6, radius: 0.5, attackRange: 8, attackCooldownTicks: 36, ranged: 'bolt', aggroRange: 11, loot: [L('bone', 1, 2), L('venom', 1, 1, 0.5)] },
  // ---- zombies: night, march ----
  zombie:       { id: 'zombie', faction: 'zombie', behavior: 'march', hp: 40, dmg: 10, speed: 1.9, radius: 0.5, attackRange: 1.3, attackCooldownTicks: 22, aggroRange: 6, loot: [L('bone', 1, 1, 0.5), L('raw_meat', 1, 1, 0.3)] },
  zombie_fast:  { id: 'zombie_fast', faction: 'zombie', behavior: 'march', hp: 26, dmg: 8, speed: 3.4, radius: 0.45, attackRange: 1.2, attackCooldownTicks: 16, aggroRange: 8, scale: 0.95, loot: [L('bone', 1, 1, 0.4)] },
  zombie_brute: { id: 'zombie_brute', faction: 'zombie', behavior: 'march', hp: 120, dmg: 22, speed: 1.5, radius: 0.7, attackRange: 1.5, attackCooldownTicks: 30, aggroRange: 6, scale: 1.4, loot: [L('bone', 2, 3), L('raw_meat', 1, 2)] },
  // ---- bosses ----
  warlock:      { id: 'warlock', faction: 'boss', behavior: 'march', hp: 600, dmg: 26, speed: 2.0, radius: 0.8, attackRange: 9, attackCooldownTicks: 28, ranged: 'bolt', aggroRange: 16, scale: 1.6, bossDrop: 'mage_staff', loot: [L('bone', 4, 6), L('venom', 2, 3)] },
  butcher:      { id: 'butcher', faction: 'boss', behavior: 'march', hp: 850, dmg: 40, speed: 2.2, radius: 0.9, attackRange: 1.8, attackCooldownTicks: 24, aggroRange: 16, scale: 1.9, bossDrop: 'katana', loot: [L('raw_meat', 5, 8), L('leather', 3, 5)] },
  spider_queen: { id: 'spider_queen', faction: 'boss', behavior: 'aggressive', hp: 700, dmg: 24, speed: 2.6, radius: 0.95, attackRange: 8, attackCooldownTicks: 26, ranged: 'spit', aggroRange: 16, scale: 1.9, bossDrop: 'war_spear', loot: [L('silk', 6, 10), L('venom', 4, 6)] },
};

export function creatureDef(id: string): CreatureDef | undefined { return CREATURES[id]; }
```

- [ ] **Step 2: Spawn plan**

`packages/shared/src/sim/data/spawning.ts`:

```ts
import type { Biome } from '../regions';
import type { Faction } from './creatures';

export type Danger = 'safe' | 'neutral' | 'danger';

export const BIOME_DANGER: Record<Biome, Danger> = {
  meadow: 'safe', plains: 'safe',
  forest: 'neutral', tundra: 'neutral', riverlands: 'neutral' as never,
  swamp: 'danger', mountains: 'danger', badlands: 'danger',
};

/** Species pools per faction, drawn at spawn time. */
export const POOLS: Record<Faction, string[]> = {
  animal: ['cow', 'sheep', 'pig', 'chicken', 'rabbit', 'wolf', 'boar', 'bear', 'spider', 'snake'],
  bandit: ['bandit_sword', 'bandit_dagger', 'bandit_spear', 'bandit_mage'],
  zombie: ['zombie', 'zombie_fast', 'zombie_brute'],
  boss:   ['warlock', 'butcher', 'spider_queen'],
};

/** Herbivores vs predators split for the animal pool by danger. */
export const HERBIVORES = ['cow', 'sheep', 'pig', 'chicken', 'rabbit'];
export const PREDATORS = ['wolf', 'boar', 'bear', 'spider', 'snake'];

export interface SpawnTarget { faction: Faction; species: string[]; count: number; }

/**
 * Target populations for a biome given the phase. Counts are per-biome soft caps;
 * the sim tops up toward them and despawns the excess/far creatures.
 */
export function spawnPlan(biome: Biome, phase: 'day' | 'night'): SpawnTarget[] {
  const danger = BIOME_DANGER[biome] ?? 'neutral';
  const out: SpawnTarget[] = [];
  if (phase === 'day') {
    if (danger === 'safe') out.push({ faction: 'animal', species: HERBIVORES, count: 6 });
    else if (danger === 'neutral') out.push({ faction: 'animal', species: [...HERBIVORES, ...PREDATORS], count: 5 });
    else {
      out.push({ faction: 'animal', species: PREDATORS, count: 3 });
      out.push({ faction: 'bandit', species: POOLS.bandit, count: 3 });
    }
  } else {
    // night
    if (danger === 'safe') out.push({ faction: 'zombie', species: ['zombie'], count: 3 });
    else if (danger === 'neutral') out.push({ faction: 'zombie', species: ['zombie', 'zombie_fast'], count: 6 });
    else out.push({ faction: 'zombie', species: POOLS.zombie, count: 10 });
  }
  return out;
}
```

> Note: `regions.ts` `Biome` is `'meadow'|'forest'|'mountains'|'swamp'|'tundra'|'plains'|'badlands'`.
> The `riverlands` key above is a typed escape hatch that will never be hit (no such biome) — drop
> it and keep the record to exactly the seven real biomes when implementing:
> ```ts
> export const BIOME_DANGER: Record<Biome, Danger> = {
>   meadow: 'safe', plains: 'safe', forest: 'neutral', tundra: 'neutral',
>   swamp: 'danger', mountains: 'danger', badlands: 'danger',
> };
> ```
> Use this seven-key version.

- [ ] **Step 3: Export**

In `packages/shared/src/index.ts` add:
```ts
export { CREATURES, creatureDef, type CreatureDef, type LootEntry, type Faction, type Behavior } from './sim/data/creatures';
export { spawnPlan, BIOME_DANGER, type Danger, type SpawnTarget } from './sim/data/spawning';
```

- [ ] **Step 4: Typecheck shared**

Run: `npm run -w @lf/shared typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sim/data/creatures.ts packages/shared/src/sim/data/spawning.ts packages/shared/src/index.ts
git commit -m "feat(shared): creature roster + biome spawn plan"
```

---

## Task 3: Types — Creature, Projectile, commands, events (shared)

**Files:** Modify `packages/shared/src/sim/types.ts`.

- [ ] **Step 1: Add runtime entity types**

In `types.ts`, add `attackCooldown` to `Player`:
```ts
  gatherCooldown: number;
  gatherTarget: EntityId | null;
  attackCooldown: number;   // swing cooldown ticks
```

Add the entities + projectile:
```ts
export type ProjectileKind = 'spit' | 'bolt';

export interface Creature {
  id: EntityId;
  species: string;          // CREATURES key
  pos: Vec2;
  hp: number;
  maxHp: number;
  target: EntityId | null;  // current player target
  attackCooldown: number;
  provoked: boolean;        // neutral creatures engage once hit
  fleeTicks: number;        // herbivore panic timer
  wanderDir: Vec2;          // idle drift
  biome: string;            // spawn biome name (for despawn/plan)
}

export interface Projectile {
  id: EntityId;
  kind: ProjectileKind;
  pos: Vec2;
  dir: Vec2;                // normalized travel
  speed: number;
  dmg: number;
  fromPlayer: boolean;      // true = player shot (hits creatures), false = hits players
  ttlTicks: number;
}
```

Add the maps to `SimState`:
```ts
  groundItems: Map<EntityId, DroppedItem>;
  creatures: Map<EntityId, Creature>;
  projectiles: Map<EntityId, Projectile>;
  nextId: EntityId;
```

Add the command:
```ts
  | { kind: 'attack'; dir: Vec2 }
```

Add events:
```ts
  | { kind: 'swing'; pos: Vec2; dir: Vec2 }
  | { kind: 'creature_spawn'; id: EntityId; species: string; pos: Vec2 }
  | { kind: 'creature_death'; id: EntityId; species: string; pos: Vec2 }
  | { kind: 'projectile'; from: Vec2; to: Vec2; kind2: ProjectileKind }
```

> Note: the projectile event uses `kind2` because the discriminant key `kind` is already taken
> by the event union tag. The client reads `e.kind2` for the visual.

- [ ] **Step 2: Typecheck** — FAIL expected (sim/server/client unaware). Fold into Task 4. Do not commit.

---

## Task 4: Sim — spawning, AI, attacks, projectiles, swing, loot (shared)

**Files:** Modify `packages/shared/src/sim/sim.ts`, `packages/shared/src/sim/snapshot.ts`.

- [ ] **Step 1: Imports + state init**

In `sim.ts`, extend imports:
```ts
import { dist, buildingCenter } from './combat';
import { ITEMS, isDurable, type ItemId, type Slot } from './data/items';
import { CREATURES, creatureDef, type CreatureDef } from './data/creatures';
import { spawnPlan } from './data/spawning';
import { regionAt } from './regions';
```
Add constants near the others:
```ts
const TOTAL_CREATURE_CAP = 60;
const SPAWN_MIN_DIST = 18;       // not within this range of any player
const DESPAWN_DIST = 90;         // cull beyond this from every player
const PROJECTILE_SPEED = { spit: 9, bolt: 16 } as const;
const BARE_HAND_DMG = 4;
const SWING_COOLDOWN = 12;       // default ticks between swings
```
In the constructor's state literal, add the maps:
```ts
      groundItems: new Map(), creatures: new Map(), projectiles: new Map(), nextId: 1,
```
In `addPlayer`, add `attackCooldown: 0,` to the player object.
In `Sim.fromState`, do not copy creatures/projectiles (they stay the fresh empty maps).

- [ ] **Step 2: Step order**

In `step()`, insert after `stepClock(events)`:
```ts
    this.stepClock(events);
    this.stepSpawning(events);
```
and after `stepGather(events)`:
```ts
    this.stepGather(events);
    this.stepCreatures(events);
    this.stepProjectiles(events);
```

- [ ] **Step 3: applyCommand — attack**

Add a case in `applyCommand`'s switch (before `build`):
```ts
      case 'attack': this.playerSwing(this.state.players.get(playerId)!, cmd.dir, events_unused_use_queue); break;
```
Because `applyCommand` has no events array, queue the swing instead:
```ts
      case 'attack': this.attackQueue.push({ playerId, dir: cmd.dir }); break;
```
Add the queue field near the others:
```ts
  private attackQueue: { playerId: EntityId; dir: Vec2 }[] = [];
```
And drain it inside `step()` right after `stepPlayers(events)`:
```ts
    this.stepPlayers(events);
    this.stepAttacks(events);
```

- [ ] **Step 4: Player swing**

Add to `Sim`:
```ts
  private stepAttacks(events: SimEvent[]): void {
    for (const req of this.attackQueue) {
      const p = this.state.players.get(req.playerId);
      if (!p || !p.alive || p.attackCooldown > 0) continue;
      const len = Math.hypot(req.dir.x, req.dir.y) || 1;
      const dir = { x: req.dir.x / len, y: req.dir.y / len };
      const held = p.inventory[p.hand];
      const def = held ? ITEMS[held.item] : undefined;
      const isWeapon = def?.category === 'weapon';
      const dmg = isWeapon ? (def!.dmg ?? BARE_HAND_DMG) : BARE_HAND_DMG;
      const reach = isWeapon ? (def!.reach ?? 2.2) : 1.4;
      p.attackCooldown = SWING_COOLDOWN;
      events.push({ kind: 'swing', pos: { ...p.pos }, dir });

      if (isWeapon && def!.ranged) {
        this.spawnProjectile('bolt', p.pos, dir, dmg, true);
      } else {
        // front arc sweep: hit creatures within reach and ~120°
        for (const c of this.state.creatures.values()) {
          const dx = c.pos.x - p.pos.x, dy = c.pos.y - p.pos.y;
          const d = Math.hypot(dx, dy);
          if (d > reach + c.pos ? 0 : 0) { /* noop */ }
          if (d > reach + 0.6) continue;
          const dot = (dx / (d || 1)) * dir.x + (dy / (d || 1)) * dir.y;
          if (dot < 0.4) continue;       // outside ~120° cone
          this.damageCreature(c.id, dmg, events);
        }
      }
      // weapon wear
      if (isWeapon && held && held.dur !== undefined) {
        held.dur -= 1;
        if (held.dur <= 0) { const it = held.item; p.inventory[p.hand] = null; events.push({ kind: 'tool_broke', pos: { ...p.pos }, item: it, playerId: p.id }); }
      }
    }
    this.attackQueue.length = 0;
  }
```
> Clean up the stray `if (d > reach + c.pos ? 0 : 0)` line — it is a typo; delete it. The real
> guard is the `if (d > reach + 0.6) continue;` line.

Decrement `attackCooldown` in `stepPlayers` alongside `gatherCooldown`:
```ts
      if (p.gatherCooldown > 0) p.gatherCooldown--;
      if (p.attackCooldown > 0) p.attackCooldown--;
```

- [ ] **Step 5: Spawning**

```ts
  private stepSpawning(events: SimEvent[]): void {
    if (this.state.tick % 10 !== 0) return;                 // throttle to ~2/s
    if (this.state.creatures.size >= TOTAL_CREATURE_CAP) return;
    const players = [...this.state.players.values()].filter(p => p.alive);
    if (players.length === 0) return;
    // sample a candidate point near (but not too near) a random player
    const anchor = players[this.rng.int(0, players.length - 1)]!;
    const ang = this.rng.next() * Math.PI * 2;
    const rad = SPAWN_MIN_DIST + this.rng.next() * 22;
    const x = clamp(anchor.pos.x + Math.cos(ang) * rad, 4, MAP_SIZE - 4);
    const y = clamp(anchor.pos.y + Math.sin(ang) * rad, 4, MAP_SIZE - 4);
    const pos = { x, y };
    if (this.isSolidAt(pos) || inRiver(pos, this.river)) return;
    if (dist(pos, CAMP_POS) < 22) return;                   // keep the camp clear
    const biome = regionAt(this.regions, pos).biome;
    const plan = spawnPlan(biome, this.state.phase);
    for (const t of plan) {
      const have = [...this.state.creatures.values()]
        .filter(c => CREATURES[c.species]!.faction === t.faction && c.biome === biome).length;
      if (have >= t.count) continue;
      const species = t.species[this.rng.int(0, t.species.length - 1)]!;
      this.spawnCreature(species, pos, biome, events);
      return;                                               // one spawn per tick
    }
  }

  private spawnCreature(species: string, pos: Vec2, biome: string, events: SimEvent[]): Creature {
    const def = CREATURES[species]!;
    const id = this.state.nextId++;
    const c: Creature = {
      id, species, pos: { ...pos }, hp: def.hp, maxHp: def.hp,
      target: null, attackCooldown: 0, provoked: false, fleeTicks: 0,
      wanderDir: { x: this.rng.next() * 2 - 1, y: this.rng.next() * 2 - 1 }, biome,
    };
    this.state.creatures.set(id, c);
    events.push({ kind: 'creature_spawn', id, species, pos: { ...pos } });
    return c;
  }
```
Add `Creature` to the type import at the top of `sim.ts`:
```ts
import type {
  SimState, SimEvent, Command, Player, Building, EntityId, Vec2,
  ResourceNode, BuildingType, Creature, Projectile, ProjectileKind,
} from './types';
```

- [ ] **Step 6: Creature AI**

```ts
  private nearestPlayer(pos: Vec2, maxR: number): Player | null {
    let best: Player | null = null, bd = maxR;
    for (const p of this.state.players.values()) {
      if (!p.alive) continue;
      const d = dist(p.pos, pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  private stepCreatures(events: SimEvent[]): void {
    const players = [...this.state.players.values()].filter(p => p.alive);
    for (const c of [...this.state.creatures.values()]) {
      const def = CREATURES[c.species]!;
      if (c.attackCooldown > 0) c.attackCooldown--;
      if (c.fleeTicks > 0) c.fleeTicks--;

      // despawn if far from every player
      if (players.length && players.every(p => dist(p.pos, c.pos) > DESPAWN_DIST)) {
        this.state.creatures.delete(c.id); continue;
      }

      const speed = def.speed / TICK_RATE;
      const step = (tx: number, ty: number, s: number) => {
        const dx = tx - c.pos.x, dy = ty - c.pos.y, len = Math.hypot(dx, dy) || 1;
        const nx = clamp(c.pos.x + (dx / len) * s, 0.5, MAP_SIZE - 0.5);
        const ny = clamp(c.pos.y + (dy / len) * s, 0.5, MAP_SIZE - 0.5);
        if (!this.isSolidAt({ x: nx, y: c.pos.y })) c.pos.x = nx;
        if (!this.isSolidAt({ x: c.pos.x, y: ny })) c.pos.y = ny;
      };

      const engage = (p: Player) => {
        if (dist(p.pos, c.pos) <= def.attackRange) {
          if (c.attackCooldown === 0) {
            c.attackCooldown = def.attackCooldownTicks;
            if (def.ranged) this.spawnProjectile(def.ranged, c.pos, norm(sub(p.pos, c.pos)), def.dmg, false);
            else { this.damagePlayer(p.id, def.dmg, events); }
          }
        } else step(p.pos.x, p.pos.y, speed);
      };

      switch (def.behavior) {
        case 'flee': {
          const threat = this.nearestPlayer(c.pos, def.aggroRange);
          if (threat && (c.fleeTicks > 0 || dist(threat.pos, c.pos) < def.aggroRange)) {
            step(c.pos.x * 2 - threat.pos.x, c.pos.y * 2 - threat.pos.y, speed * 1.1);
          } else if (this.state.tick % 4 === 0) {
            step(c.pos.x + c.wanderDir.x, c.pos.y + c.wanderDir.y, speed * 0.4);
            if (this.rng.next() < 0.02) c.wanderDir = { x: this.rng.next() * 2 - 1, y: this.rng.next() * 2 - 1 };
          }
          break;
        }
        case 'neutral': {
          const t = c.provoked ? this.nearestPlayer(c.pos, def.aggroRange + 4) : null;
          if (t) engage(t);
          else if (this.state.tick % 4 === 0) step(c.pos.x + c.wanderDir.x, c.pos.y + c.wanderDir.y, speed * 0.4);
          break;
        }
        case 'aggressive':
        case 'pack': {
          const t = this.nearestPlayer(c.pos, def.aggroRange);
          if (t) engage(t);
          else if (this.state.tick % 4 === 0) step(c.pos.x + c.wanderDir.x, c.pos.y + c.wanderDir.y, speed * 0.4);
          break;
        }
        case 'march': {
          const t = this.nearestPlayer(c.pos, 999) ?? null;
          const goal = t ? t.pos : CAMP_POS;
          if (t && dist(t.pos, c.pos) <= def.attackRange) engage(t);
          else step(goal.x, goal.y, speed);
          break;
        }
      }
    }
    this.separateCreatures();
  }

  private separateCreatures(): void {
    const arr = [...this.state.creatures.values()];
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i]!, b = arr[j]!;
      const ra = CREATURES[a.species]!.radius + CREATURES[b.species]!.radius;
      const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y, d = Math.hypot(dx, dy);
      if (d > 0 && d < ra) {
        const push = (ra - d) / 2, nx = dx / d, ny = dy / d;
        a.pos.x -= nx * push; a.pos.y -= ny * push;
        b.pos.x += nx * push; b.pos.y += ny * push;
      }
    }
  }
```
Add small vector helpers at the bottom of the file (next to `clamp`):
```ts
function sub(a: Vec2, b: Vec2): Vec2 { return { x: a.x - b.x, y: a.y - b.y }; }
function norm(v: Vec2): Vec2 { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; }
```
`Vec2` is already imported; ensure `TICK_RATE` and `inRiver` are imported (TICK_RATE from constants — add it; `inRiver` already imported).
Add `TICK_RATE` to the constants import block in `sim.ts`.

- [ ] **Step 7: Damage + loot + projectiles**

```ts
  damageCreature(id: EntityId, amount: number, events: SimEvent[]): void {
    const c = this.state.creatures.get(id);
    if (!c) return;
    c.hp -= amount;
    c.provoked = true;
    c.fleeTicks = 60;          // panic for 3s (herbivores run)
    events.push({ kind: 'damage', pos: { ...c.pos }, amount, crit: false });
    if (c.hp > 0) return;
    const def = CREATURES[c.species]!;
    this.state.creatures.delete(id);
    events.push({ kind: 'creature_death', id, species: c.species, pos: { ...c.pos } });
    for (const e of def.loot) {
      if (this.rng.next() > e.chance) continue;
      const n = e.min + this.rng.int(0, e.max - e.min);
      if (n > 0) this.spawnGroundItem(e.item, n, c.pos);
    }
    if (def.bossDrop) this.spawnGroundItem(def.bossDrop, 1, c.pos, ITEMS[def.bossDrop].durabilityMax);
  }

  private spawnProjectile(kind: ProjectileKind, from: Vec2, dir: Vec2, dmg: number, fromPlayer: boolean): void {
    const id = this.state.nextId++;
    this.state.projectiles.set(id, {
      id, kind, pos: { ...from }, dir: norm(dir), speed: PROJECTILE_SPEED[kind], dmg, fromPlayer, ttlTicks: 80,
    });
    this.state.projectiles.get(id)!;   // keep ref
    // (event for the visual is pushed by the caller context via stepProjectiles spawn? push here)
  }

  private stepProjectiles(events: SimEvent[]): void {
    for (const pr of [...this.state.projectiles.values()]) {
      if (--pr.ttlTicks <= 0) { this.state.projectiles.delete(pr.id); continue; }
      const s = pr.speed / TICK_RATE;
      pr.pos.x += pr.dir.x * s; pr.pos.y += pr.dir.y * s;
      if (this.isSolidAt(pr.pos)) { this.state.projectiles.delete(pr.id); continue; }
      if (pr.fromPlayer) {
        for (const c of this.state.creatures.values()) {
          if (dist(c.pos, pr.pos) <= CREATURES[c.species]!.radius + 0.3) {
            this.damageCreature(c.id, pr.dmg, events); this.state.projectiles.delete(pr.id); break;
          }
        }
      } else {
        for (const p of this.state.players.values()) {
          if (p.alive && dist(p.pos, pr.pos) <= 0.6) {
            this.damagePlayer(p.id, pr.dmg, events); this.state.projectiles.delete(pr.id); break;
          }
        }
      }
    }
  }
```
> `spawnProjectile` should also emit the `projectile` visual event. Since it is called from
> contexts that hold `events`, change its signature to take `events` and push:
> ```ts
> private spawnProjectile(kind: ProjectileKind, from: Vec2, dir: Vec2, dmg: number, fromPlayer: boolean, events: SimEvent[]): void {
>   const id = this.state.nextId++;
>   const d = norm(dir);
>   this.state.projectiles.set(id, { id, kind, pos: { ...from }, dir: d, speed: PROJECTILE_SPEED[kind], dmg, fromPlayer, ttlTicks: 80 });
>   events.push({ kind: 'projectile', from: { ...from }, to: { x: from.x + d.x * 6, y: from.y + d.y * 6 }, kind2: kind });
> }
> ```
> Update the two call sites (`stepAttacks` ranged, `engage` ranged) to pass `events`.

- [ ] **Step 8: Snapshot omits transient entities**

In `snapshot.ts`, change `serializeState` to drop creatures/projectiles, and `deserializeState`
to seed empty maps:
```ts
export function serializeState(s: SimState): string {
  const { creatures: _c, projectiles: _p, ...rest } = s;
  return JSON.stringify({
    ...rest,
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
    creatures: new Map(),
    projectiles: new Map(),
  };
}
```
`Sim.fromState` already only copies the four persisted maps, so creatures/projectiles use the
fresh empties — consistent.

- [ ] **Step 9: Typecheck shared**

Run: `npm run -w @lf/shared typecheck`
Expected: PASS. Fix any dangling references the compiler flags (the typo line in Step 4, the
`spawnProjectile` signature in Step 7).

- [ ] **Step 10: Commit (Tasks 3+4)**

```bash
git add packages/shared
git commit -m "feat(shared): creature AI, spawning, projectiles, arc-swing combat, loot drops"
```

---

## Task 5: Server — views + attack validation (server)

**Files:** Modify `packages/server/src/protocol.ts`, `packages/server/src/room.ts`.

- [ ] **Step 1: Views**

In `protocol.ts` add:
```ts
export interface CreatureView { id: EntityId; species: string; pos: Vec2; hp: number; maxHp: number; }
export interface ProjectileView { id: EntityId; kind: 'spit' | 'bolt'; pos: Vec2; }
```
Add `creatures` + `projectiles` to the `frame` message:
```ts
  | { t: 'frame'; tick: number; phase: Phase; phaseTicks: number;
      players: PlayerView[]; buildings: BuildingView[];
      groundItems: GroundItemView[]; creatures: CreatureView[]; projectiles: ProjectileView[]; events: SimEvent[] }
```

- [ ] **Step 2: Room views + validation**

In `room.ts`, add view builders and include them in `buildFrame`:
```ts
  private creatureViews(): import('./protocol').CreatureView[] {
    return [...this.sim!.state.creatures.values()].map(c => ({
      id: c.id, species: c.species, pos: c.pos, hp: c.hp, maxHp: c.maxHp,
    }));
  }
  private projectileViews(): import('./protocol').ProjectileView[] {
    return [...this.sim!.state.projectiles.values()].map(p => ({ id: p.id, kind: p.kind, pos: p.pos }));
  }
```
In `buildFrame`'s returned object add `creatures: this.creatureViews(), projectiles: this.projectileViews(),`.
Add to `validCommand`:
```ts
    case 'attack': return isFiniteVec(cmd.dir);
```

- [ ] **Step 3: Typecheck server**

Run: `npm run -w @lf/server typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/server
git commit -m "feat(server): creature/projectile views + attack command"
```

---

## Task 6: Client models — creatures + projectiles (client)

**Files:** Modify `packages/client/src/render/models.ts`.

- [ ] **Step 1: Add `creatureModel` + `projectileModel`**

Append to `models.ts` a `creatureModel(species: string)` factory returning a `THREE.Group` with
the animation contract userData (`legs`, `body`, `head`, `arms` where relevant) so `world.ts`'s
existing character animator drives walk cycles. Build low-poly forms:
- quadrupeds (cow/sheep/pig/boar/bear/wolf): a box body on 4 short legs, a head box, tinted per
  species (cow `0x6b5640` with white patches, sheep `0xe8e2d4`, pig `0xd99a9a`, wolf `0x6a6f78`,
  bear `0x4a3a2a`, boar `0x5a4a3a`); set `userData.legs` to the 4 legs and `userData.body`.
- chicken/rabbit: small body + head, tiny legs.
- spider: low body + 8 thin legs (`userData.legs` = a subset for a skitter), dark `0x2a2a32`.
- snake: a segmented low cylinder chain, `0x4a7a3a`.
- bandits: reuse the player rig via `playerModel()` tinted darker with a weapon box in the right
  hand; `userData` already set by `playerModel`.
- zombies: the green humanoid rig (body/head/arms/legs) with reaching arms, `0x6f8f57`;
  `zombie_brute` bigger and darker.
- bosses: scaled-up variants — `warlock` a robed humanoid with a glowing orb, `butcher` a huge
  zombie with a cleaver, `spider_queen` a giant spider. Use the species `scale` from
  `CREATURES[species].scale`.

Provide a `factionRing(faction)` color (animal green-grey, bandit orange, zombie sickly green,
boss red) drawn as a ground ring like the old enemy ring for readability.

Restore `projectileModel(kind: 'spit' | 'bolt')`: `spit` a green sphere, `bolt` a glowing
violet shard.

Export both: `export function creatureModel(species: string): THREE.Group` and
`export function projectileModel(kind: 'spit'|'bolt'): THREE.Group`.

- [ ] **Step 2: Build client**

Run: `npm run -w @lf/client build`
Expected: PASS (models compile; not yet referenced).

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/render/models.ts
git commit -m "feat(client): creature + projectile models"
```

---

## Task 7: Client render — creature/projectile layers + swing animation (client)

**Files:** Modify `packages/client/src/render/world.ts`, `packages/client/src/net.ts`.

- [ ] **Step 1: Net view types**

In `net.ts`, add `CreatureView, ProjectileView` to the re-exported types from
`../../server/src/protocol`.

- [ ] **Step 2: Creature + projectile layers**

In `world.ts`:
- Import `creatureModel, projectileModel` and `CREATURES` from `@lf/shared`.
- Extend `applyFrame` to take `creatures: CreatureView[]` and `projectiles: ProjectileView[]`:
  ```ts
  applyFrame(players, buildings, groundItems, creatures, projectiles) { ... }
  ```
  Upsert each creature as `creature:${species}` via `creatureModel(species)` with hp ratio
  (reuse `upsert` + the existing character animator — creature models expose the same
  `userData.legs/body`). Upsert each projectile as `proj:${kind}` at chest height (y≈1.1).
  Add both ids to the `seen` set so stale ones are culled.
- Add a **player swing** animation: on a `swing` event (handled in main), call
  `world.playerSwing(playerId or pos, dir)` which triggers a quick arc slash — reuse the
  `attackT` lunge on the nearest player Tracked and spawn a transient arc mesh (a thin ring
  segment) oriented along `dir` that fades in ~0.2s.

- [ ] **Step 3: Build client**

Run: `npm run -w @lf/client build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/render/world.ts packages/client/src/net.ts
git commit -m "feat(client): creature + projectile render layers, swing slash"
```

---

## Task 8: Client — left-click attack, threat/boss HUD, combat FX, ambiance (client)

**Files:** Modify `packages/client/src/main.ts`, `packages/client/src/input.ts`,
`packages/client/src/ui/hud.ts`, `packages/client/src/render/effects.ts`,
`packages/client/src/audio.ts`, `packages/client/src/render/scene.ts`.

- [ ] **Step 1: Left-click attack**

In `input.ts` `pointerdown`: when not in build mode and the click is **not** over an own
building, emit an attack toward the cursor world point instead of just deselecting:
```ts
      const hit = this.buildingAt(cell);
      if (hit) { this.onSelectAt(cell); return; }
      // open ground → swing toward the cursor
      this.onAttack({ x: w.x, y: w.y });
```
Add `onAttack: (worldPt: {x:number;y:number}) => void = () => {};` to `Input`.
In `main.ts`, wire it: compute direction from the predicted self position to the world point and
send `attack`:
```ts
input.onAttack = pt => {
  const sp = world.positionOf(selfId); if (!sp) return;
  net.send({ t: 'cmd', cmd: { kind: 'attack', dir: { x: pt.x - sp.x, y: pt.y - sp.z } } });
};
```

- [ ] **Step 2: Frame wiring**

In `main.ts` `frame` handler, pass the new arrays to the renderer:
```ts
      world.applyFrame(msg.players, msg.buildings, msg.groundItems, msg.creatures, msg.projectiles);
```
Handle events:
```ts
        if (e.kind === 'swing') world.playerSwing(e.pos, e.dir);
        if (e.kind === 'creature_death') { effects.nodeBreak(e.pos.x, e.pos.y, 'tree'); audio.growl?.(); }
        if (e.kind === 'projectile') effects.tracer?.(e.from.x, e.from.y, e.to.x, e.to.y, e.kind2 === 'bolt' ? 0xb060ff : 0x8fdc4a);
```
Restore an effects tracer/whoosh if not present (Phase 0 trimmed some). Add minimal `tracer`
back to `effects.ts` if missing.

- [ ] **Step 3: Threat + boss HUD**

In `ui/hud.ts`, add a small threat readout (top-center under the phase pill) and a boss bar:
- `updateThreat(count: number, danger: boolean)` → shows `⚔ N nearby` and a red `DANGER` tag
  when in a danger biome at night.
- `setBoss(name: string | null, hpRatio: number)` → a top centered boss health bar.
In `main.ts` compute the nearby hostile count from `msg.creatures` (faction via
`CREATURES[species].faction !== 'animal'` within ~16u of self) and the largest boss present.

- [ ] **Step 4: Combat FX/SFX + ambiance**

- `effects.ts`: blood puff on `damage` over creatures (already partly there), death poof on
  `creature_death`, projectile impact spark.
- `audio.ts`: `swing` whoosh, creature growl/groan, boss roar on `creature_spawn` of a boss,
  projectile hiss.
- `scene.ts`: when the self player is in a danger biome at night, lerp the fog toward a dark red
  and raise tension; otherwise normal night. Drive from a `setDanger(boolean)` called in main.

- [ ] **Step 5: Build client**

Run: `npm run -w @lf/client build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/client
git commit -m "feat(client): left-click swing combat, threat/boss HUD, combat FX + danger ambiance"
```

---

## Task 9: Integration verification

**Files:** none.

- [ ] **Step 1: Full typecheck + build**

Run: `npm run typecheck` then `npm run -w @lf/client build`. Expected: all PASS.

- [ ] **Step 2: WS smoke**

Boot `PORT=8123 npm run -w @lf/server start`. Bot: connect → solo lobby → on `game_start`, wait
until a `creature_spawn` of an `animal` appears in frame events, walk adjacent to it, send
`attack { dir }` toward it repeatedly; assert the creature's hp drops and on death a loot
ground item (e.g. `raw_meat`) appears in `groundItems`. Then advance time to night (or just
assert zombie spawns appear in a danger biome by walking there). Print SUCCESS with the killed
species + dropped items.

- [ ] **Step 3: Report**

Summarize: animals spawn and flee/fight per behavior, left-click swing damages and kills them
dropping loot, zombies spawn at night, bosses drop their weapon. Ready for local browser test.

---

## Self-Review

**Spec coverage:**
- Combat materials / raw meat / boss weapons / weapon reach+ranged → Task 1. ✓
- Creature roster (10 animals, 4 bandits, 3 zombies, 3 bosses) + loot tables → Task 2 (`creatures.ts`). ✓
- Biome danger + spawn plan (day/night gating, safe/danger) → Task 2 (`spawning.ts`). ✓
- Creature/Projectile types, attack command, events, Player.attackCooldown → Task 3. ✓
- Spawning (caps, away-from-players, despawn) → Task 4 Step 5. ✓
- AI flee/aggressive/neutral/pack/march + separation → Task 4 Step 6. ✓
- Manual arc swing + bare hand + durability + ranged staff → Task 4 Step 4. ✓
- Damage + loot drop + boss weapon drop → Task 4 Step 7. ✓
- Projectiles restored (player & creature) → Task 4 Steps 7. ✓
- Transient persistence (omit from snapshot) → Task 4 Step 8. ✓
- Server views + attack validation → Task 5. ✓
- Client creature/projectile models → Task 6. ✓
- Render layers + swing animation → Task 7. ✓
- Left-click attack, threat/boss HUD, combat FX, danger ambiance → Task 8. ✓

**Type consistency:** `Creature`/`Projectile`/`ProjectileKind` (Task 3) used in Task 4/5/6/7.
`CreatureDef`/`CREATURES`/`spawnPlan` (Task 2) consumed in Task 4. `CreatureView`/`ProjectileView`
(Task 5) consumed in Task 7. `attack { dir }` (Task 3) emitted in Task 8, validated in Task 5,
applied in Task 4. `projectile` event uses `kind2` consistently (Task 3 note → Task 8 reads
`e.kind2`). `spawnProjectile(..., events)` final signature (Task 4 Step 7 note) matches both call
sites. ✓

**Placeholder scan:** Task 4 Step 4 contains one deliberately-flagged typo line
(`if (d > reach + c.pos ? 0 : 0)`) with an explicit instruction to delete it — implement the
clean version. Task 6/7/8 give behavioral specs with concrete signatures/wiring for the large
client files (same approach as Phase 0/1), not literal full-file dumps; the interfaces
(`creatureModel`, `applyFrame` arity, `onAttack`, `playerSwing`, `updateThreat`/`setBoss`) are
fully specified. No TBD/TODO. ✓
