# Last Fortress Phase 1 — Plan 1: Monorepo + Shared Simulation Core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic, headless game simulation (`packages/shared`) that both server and client will run: grid/map, economy, buildings, combat, enemy AI, waves, day/night — fully unit-tested with vitest.

**Architecture:** npm-workspaces monorepo. `packages/shared` exports a `Sim` class stepped at a fixed 20 Hz tick. All state lives in plain serializable objects; all randomness through a seeded PRNG so two sims with the same seed + commands produce identical state. Managers (economy, building, combat, enemy, wave) are modules operating on `SimState`, composed by `Sim.step()`. `Sim.step()` returns an event list (`SimEvent[]`) that the future client uses for VFX/SFX and the server forwards to clients.

**Tech Stack:** TypeScript 5 (strict), Node 22, npm workspaces, vitest.

**Conventions for all tasks:**
- Run commands from repo root: `C:\Users\oguz\Desktop\her şey\fable`
- Test command: `npm test -w packages/shared` (vitest run)
- Type check: `npm run typecheck -w packages/shared`
- Commit after every green test run. Commit messages: conventional commits.

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `.gitignore`, `tsconfig.base.json`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/vitest.config.ts`
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/test/smoke.test.ts`

- [ ] **Step 1: Root package.json**

```json
{
  "name": "last-fortress",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "npm test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present"
  }
}
```

- [ ] **Step 2: .gitignore**

```
node_modules/
dist/
*.tsbuildinfo
.env
```

- [ ] **Step 3: tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 4: packages/shared/package.json**

```json
{
  "name": "@lf/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 5: packages/shared/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

- [ ] **Step 6: packages/shared/vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
```

- [ ] **Step 7: src/index.ts placeholder export + smoke test**

`src/index.ts`:
```ts
export const SHARED_VERSION = '0.1.0';
```

`test/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { SHARED_VERSION } from '../src/index';

describe('workspace', () => {
  it('resolves the shared package', () => {
    expect(SHARED_VERSION).toBe('0.1.0');
  });
});
```

- [ ] **Step 8: Install and run**

Run: `npm install` then `npm test -w packages/shared`
Expected: 1 test passes.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold npm-workspaces monorepo with shared package"
```

---

### Task 2: Core types, constants, seeded PRNG

**Files:**
- Create: `packages/shared/src/sim/types.ts`
- Create: `packages/shared/src/sim/constants.ts`
- Create: `packages/shared/src/sim/rng.ts`
- Test: `packages/shared/test/rng.test.ts`

- [ ] **Step 1: Write failing PRNG test**

`test/rng.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Rng } from '../src/sim/rng';

describe('Rng', () => {
  it('is deterministic for the same seed', () => {
    const a = new Rng(42), b = new Rng(42);
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
  });
  it('produces values in [0,1)', () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('int(min,max) is inclusive of both ends over many draws', () => {
    const r = new Rng(1);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.int(0, 3));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL** (`Cannot find module '../src/sim/rng'`)

- [ ] **Step 3: Implement rng, types, constants**

`src/sim/rng.ts` (mulberry32):
```ts
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  /** float in [0,1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** integer in [min,max] inclusive */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)]!;
  }
}
```

`src/sim/types.ts`:
```ts
export interface Vec2 { x: number; y: number; }

export type ResourceKind = 'wood' | 'stone' | 'gold' | 'coins';
export type Resources = Record<ResourceKind, number>;

export type BuildingType =
  | 'wood_wall' | 'stone_wall' | 'gate' | 'spike'
  | 'archer_tower' | 'crossbow_tower' | 'bomb_tower' | 'ice_tower' | 'lightning_tower'
  | 'gold_mine' | 'wood_camp' | 'stone_quarry'
  | 'healing_totem'
  | 'castle';

export type EnemyType = 'normal' | 'fast' | 'tank' | 'spitter' | 'exploding' | 'butcher';
export type ClassType = 'knight' | 'hunter';
export type WeaponType = 'sword' | 'bow' | 'crossbow';
export type Phase = 'day' | 'night';

export type EntityId = number;

export interface Building {
  id: EntityId;
  type: BuildingType;
  tier: number;            // 1..3 (castle: level 1..5)
  pos: Vec2;               // grid cell of footprint origin (top-left)
  hp: number;
  maxHp: number;
  cooldown: number;        // ticks until next action (tower fire / income)
}

export interface Enemy {
  id: EntityId;
  type: EnemyType;
  pos: Vec2;               // world position (float, world units == grid cells)
  hp: number;
  maxHp: number;
  speedMul: number;        // 1 normally, <1 while slowed
  slowTicks: number;
  attackCooldown: number;
  targetBuildingId: EntityId | null;
  enraged: boolean;        // butcher phase 2
}

export interface Player {
  id: EntityId;
  klass: ClassType;
  weapon: WeaponType;
  pos: Vec2;
  hp: number;
  maxHp: number;
  attackCooldown: number;
  alive: boolean;
  respawnTicks: number;
}

export interface ResourceNode {
  id: EntityId;
  kind: 'tree' | 'rock';
  pos: Vec2;               // grid cell
  amount: number;          // remaining harvestable amount
}

export interface SimState {
  tick: number;
  phase: Phase;
  phaseTicks: number;      // ticks remaining in current phase
  wave: number;            // last started wave number (0 before first night)
  pendingSpawns: { type: EnemyType; atTick: number }[];
  resources: Resources;    // shared team economy
  buildings: Map<EntityId, Building>;
  enemies: Map<EntityId, Enemy>;
  players: Map<EntityId, Player>;
  nodes: Map<EntityId, ResourceNode>;
  castleId: EntityId;
  nextId: EntityId;
  gameOver: boolean;
}

export type Command =
  | { kind: 'move'; dir: Vec2 }                                  // dir normalized client-side; re-normalized in sim
  | { kind: 'attack'; dir: Vec2 }
  | { kind: 'build'; type: BuildingType; pos: Vec2 }
  | { kind: 'upgrade'; buildingId: EntityId }
  | { kind: 'demolish'; buildingId: EntityId };

export type SimEvent =
  | { kind: 'projectile'; from: Vec2; to: Vec2; weapon: 'arrow' | 'bolt' | 'bomb' | 'ice' | 'lightning' }
  | { kind: 'damage'; pos: Vec2; amount: number; crit: boolean }
  | { kind: 'explosion'; pos: Vec2; radius: number }
  | { kind: 'chain'; points: Vec2[] }
  | { kind: 'death'; pos: Vec2; enemy: EnemyType }
  | { kind: 'coins'; pos: Vec2; amount: number }
  | { kind: 'build_placed'; pos: Vec2; type: BuildingType }
  | { kind: 'building_destroyed'; pos: Vec2; type: BuildingType }
  | { kind: 'wave_start'; wave: number; boss: boolean }
  | { kind: 'phase_change'; phase: Phase }
  | { kind: 'game_over'; wave: number };
```

`src/sim/constants.ts`:
```ts
export const TICK_RATE = 20;                 // ticks per second
export const TICK_MS = 1000 / TICK_RATE;
export const MAP_SIZE = 128;                 // grid cells per side; world units == cells
export const CASTLE_POS = { x: 62, y: 62 };  // 4x4 footprint centered on map
export const DAY_TICKS = 90 * TICK_RATE;     // 90 s build phase
export const PLAYER_SPEED = 6 / TICK_RATE;   // 6 units/s, per-tick
export const PLAYER_MAX_HP = 100;
export const RESPAWN_TICKS = 8 * TICK_RATE;
export const GATHER_AMOUNT = 5;              // resources per hit on a node
export const START_RESOURCES = { wood: 100, stone: 50, gold: 0, coins: 0 };
```

- [ ] **Step 4: Run tests, expect PASS** — `npm test -w packages/shared`

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(sim): core types, constants, seeded mulberry32 rng"`

---

### Task 3: Balance data (buildings, enemies, waves)

**Files:**
- Create: `packages/shared/src/sim/data/buildings.ts`
- Create: `packages/shared/src/sim/data/enemies.ts`
- Create: `packages/shared/src/sim/data/waves.ts`
- Test: `packages/shared/test/data.test.ts`

- [ ] **Step 1: Write failing data-shape tests**

`test/data.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { BUILDINGS, type BuildingDef } from '../src/sim/data/buildings';
import { ENEMIES } from '../src/sim/data/enemies';
import { waveComposition, enemyHpScale, enemyDmgScale } from '../src/sim/data/waves';
import { Rng } from '../src/sim/rng';

describe('building data', () => {
  it('every non-castle building has 3 tiers; castle has 5', () => {
    for (const [type, def] of Object.entries(BUILDINGS) as [string, BuildingDef][]) {
      expect(def.tiers.length).toBe(type === 'castle' ? 5 : 3);
    }
  });
  it('tier stats are monotonically non-decreasing in hp', () => {
    for (const def of Object.values(BUILDINGS)) {
      for (let i = 1; i < def.tiers.length; i++) {
        expect(def.tiers[i]!.hp).toBeGreaterThanOrEqual(def.tiers[i - 1]!.hp);
      }
    }
  });
});

describe('enemy data', () => {
  it('defines all six enemy types', () => {
    expect(Object.keys(ENEMIES).sort()).toEqual(
      ['butcher', 'exploding', 'fast', 'normal', 'spitter', 'tank']);
  });
});

describe('waves', () => {
  it('wave 10 contains the butcher boss', () => {
    const comp = waveComposition(10, new Rng(1));
    expect(comp.some(s => s.type === 'butcher')).toBe(true);
  });
  it('non-boss waves contain no boss', () => {
    const comp = waveComposition(7, new Rng(1));
    expect(comp.every(s => s.type !== 'butcher')).toBe(true);
  });
  it('enemy count grows with wave number', () => {
    const c3 = waveComposition(3, new Rng(1)).length;
    const c13 = waveComposition(13, new Rng(1)).length;
    expect(c13).toBeGreaterThan(c3);
  });
  it('hp/dmg scaling grows without bound', () => {
    expect(enemyHpScale(50)).toBeGreaterThan(enemyHpScale(10));
    expect(enemyDmgScale(50)).toBeGreaterThan(enemyDmgScale(10));
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (modules missing)

- [ ] **Step 3: Implement data modules**

`src/sim/data/buildings.ts`:
```ts
import type { BuildingType } from '../types';

export interface TierStats {
  cost: { wood?: number; stone?: number; gold?: number };
  hp: number;
  dmg?: number;            // towers / spike
  range?: number;          // world units
  cooldownTicks?: number;  // ticks between shots / income / heal pulses
  aoeRadius?: number;      // bomb tower
  slowMul?: number;        // ice tower: speed multiplier applied
  slowTicks?: number;
  chainTargets?: number;   // lightning tower
  income?: { wood?: number; stone?: number; gold?: number }; // per cooldown pulse
  heal?: number;           // healing totem per pulse
}

export interface BuildingDef {
  size: number;                 // square footprint in cells
  unlockCastleLevel: number;    // castle level required to build
  walkable: boolean;            // gate is walkable for players, spike for enemies
  tiers: TierStats[];
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  wood_wall: { size: 1, unlockCastleLevel: 1, walkable: false, tiers: [
    { cost: { wood: 10 }, hp: 120 },
    { cost: { wood: 30 }, hp: 300 },
    { cost: { wood: 80 }, hp: 650 },
  ]},
  stone_wall: { size: 1, unlockCastleLevel: 2, walkable: false, tiers: [
    { cost: { stone: 15 }, hp: 350 },
    { cost: { stone: 40 }, hp: 800 },
    { cost: { stone: 100 }, hp: 1600 },
  ]},
  gate: { size: 1, unlockCastleLevel: 1, walkable: true, tiers: [
    { cost: { wood: 20 }, hp: 150 },
    { cost: { wood: 50 }, hp: 380 },
    { cost: { wood: 120, stone: 30 }, hp: 800 },
  ]},
  spike: { size: 1, unlockCastleLevel: 1, walkable: false, tiers: [
    { cost: { wood: 15 }, hp: 80, dmg: 4, cooldownTicks: 10, range: 0.9 },
    { cost: { wood: 40 }, hp: 180, dmg: 9, cooldownTicks: 10, range: 0.9 },
    { cost: { wood: 90, stone: 20 }, hp: 350, dmg: 18, cooldownTicks: 10, range: 0.9 },
  ]},
  archer_tower: { size: 2, unlockCastleLevel: 1, walkable: false, tiers: [
    { cost: { wood: 50 }, hp: 250, dmg: 12, range: 9, cooldownTicks: 16 },
    { cost: { wood: 120, stone: 30 }, hp: 480, dmg: 22, range: 10, cooldownTicks: 14 },
    { cost: { wood: 250, stone: 80, gold: 20 }, hp: 900, dmg: 40, range: 11, cooldownTicks: 12 },
  ]},
  crossbow_tower: { size: 2, unlockCastleLevel: 2, walkable: false, tiers: [
    { cost: { wood: 80, stone: 20 }, hp: 300, dmg: 30, range: 12, cooldownTicks: 30 },
    { cost: { wood: 160, stone: 60 }, hp: 560, dmg: 55, range: 13, cooldownTicks: 26 },
    { cost: { wood: 320, stone: 140, gold: 40 }, hp: 1000, dmg: 100, range: 14, cooldownTicks: 22 },
  ]},
  bomb_tower: { size: 2, unlockCastleLevel: 3, walkable: false, tiers: [
    { cost: { stone: 100, gold: 10 }, hp: 350, dmg: 35, range: 8, cooldownTicks: 50, aoeRadius: 2.5 },
    { cost: { stone: 220, gold: 30 }, hp: 650, dmg: 65, range: 9, cooldownTicks: 44, aoeRadius: 3 },
    { cost: { stone: 450, gold: 80 }, hp: 1200, dmg: 120, range: 10, cooldownTicks: 38, aoeRadius: 3.5 },
  ]},
  ice_tower: { size: 2, unlockCastleLevel: 3, walkable: false, tiers: [
    { cost: { stone: 80, gold: 15 }, hp: 280, dmg: 6, range: 8, cooldownTicks: 20, slowMul: 0.6, slowTicks: 40 },
    { cost: { stone: 170, gold: 40 }, hp: 520, dmg: 12, range: 9, cooldownTicks: 18, slowMul: 0.5, slowTicks: 50 },
    { cost: { stone: 350, gold: 90 }, hp: 950, dmg: 22, range: 10, cooldownTicks: 16, slowMul: 0.4, slowTicks: 60 },
  ]},
  lightning_tower: { size: 2, unlockCastleLevel: 4, walkable: false, tiers: [
    { cost: { stone: 150, gold: 40 }, hp: 320, dmg: 20, range: 9, cooldownTicks: 36, chainTargets: 3 },
    { cost: { stone: 300, gold: 90 }, hp: 600, dmg: 35, range: 10, cooldownTicks: 32, chainTargets: 4 },
    { cost: { stone: 600, gold: 200 }, hp: 1100, dmg: 60, range: 11, cooldownTicks: 28, chainTargets: 5 },
  ]},
  gold_mine: { size: 2, unlockCastleLevel: 2, walkable: false, tiers: [
    { cost: { wood: 100, stone: 50 }, hp: 200, cooldownTicks: 100, income: { gold: 5 } },
    { cost: { wood: 200, stone: 120 }, hp: 380, cooldownTicks: 90, income: { gold: 10 } },
    { cost: { wood: 400, stone: 250 }, hp: 700, cooldownTicks: 80, income: { gold: 18 } },
  ]},
  wood_camp: { size: 2, unlockCastleLevel: 1, walkable: false, tiers: [
    { cost: { wood: 40 }, hp: 180, cooldownTicks: 100, income: { wood: 8 } },
    { cost: { wood: 100, stone: 20 }, hp: 340, cooldownTicks: 90, income: { wood: 15 } },
    { cost: { wood: 220, stone: 60 }, hp: 620, cooldownTicks: 80, income: { wood: 26 } },
  ]},
  stone_quarry: { size: 2, unlockCastleLevel: 1, walkable: false, tiers: [
    { cost: { wood: 60 }, hp: 200, cooldownTicks: 100, income: { stone: 6 } },
    { cost: { wood: 140, stone: 30 }, hp: 380, cooldownTicks: 90, income: { stone: 12 } },
    { cost: { wood: 300, stone: 80 }, hp: 700, cooldownTicks: 80, income: { stone: 22 } },
  ]},
  healing_totem: { size: 1, unlockCastleLevel: 2, walkable: false, tiers: [
    { cost: { wood: 80, gold: 10 }, hp: 150, range: 6, cooldownTicks: 20, heal: 3 },
    { cost: { wood: 160, gold: 30 }, hp: 280, range: 7, cooldownTicks: 18, heal: 6 },
    { cost: { wood: 320, gold: 70 }, hp: 500, range: 8, cooldownTicks: 16, heal: 11 },
  ]},
  castle: { size: 4, unlockCastleLevel: 1, walkable: false, tiers: [
    { cost: {}, hp: 2000 },
    { cost: { wood: 300, stone: 150 }, hp: 3500 },
    { cost: { wood: 600, stone: 400, gold: 50 }, hp: 5500 },
    { cost: { wood: 1200, stone: 800, gold: 150 }, hp: 8000 },
    { cost: { wood: 2500, stone: 1600, gold: 400 }, hp: 12000 },
  ]},
};
```

`src/sim/data/enemies.ts`:
```ts
import type { EnemyType } from '../types';

export interface EnemyDef {
  hp: number;
  speed: number;          // world units per second
  dmg: number;
  attackRange: number;    // melee ~1.2; spitter ranged
  attackCooldownTicks: number;
  coins: number;
  radius: number;         // collision/visual radius
  explodeOnDeath?: { dmg: number; radius: number };  // exploding zombie
}

export const ENEMIES: Record<EnemyType, EnemyDef> = {
  normal:    { hp: 50,   speed: 2.2, dmg: 8,  attackRange: 1.2, attackCooldownTicks: 20, coins: 3,  radius: 0.4 },
  fast:      { hp: 30,   speed: 4.5, dmg: 5,  attackRange: 1.2, attackCooldownTicks: 16, coins: 4,  radius: 0.35 },
  tank:      { hp: 300,  speed: 1.2, dmg: 25, attackRange: 1.4, attackCooldownTicks: 30, coins: 12, radius: 0.7 },
  spitter:   { hp: 45,   speed: 2.0, dmg: 10, attackRange: 6.0, attackCooldownTicks: 40, coins: 6,  radius: 0.4 },
  exploding: { hp: 40,   speed: 2.8, dmg: 5,  attackRange: 1.2, attackCooldownTicks: 20, coins: 8,  radius: 0.45,
               explodeOnDeath: { dmg: 40, radius: 2.5 } },
  butcher:   { hp: 3500, speed: 1.6, dmg: 80, attackRange: 1.8, attackCooldownTicks: 36, coins: 200, radius: 1.2 },
};
```

`src/sim/data/waves.ts`:
```ts
import type { EnemyType } from '../types';
import type { Rng } from '../rng';
import { TICK_RATE } from '../constants';

export interface SpawnEntry { type: EnemyType; delayTicks: number; }

export function enemyHpScale(wave: number): number { return 1 + 0.12 * (wave - 1); }
export function enemyDmgScale(wave: number): number { return 1 + 0.08 * (wave - 1); }

/** Pattern cycle: rest waves are light, boss every 10th, elites mixed in late. */
export function waveComposition(wave: number, rng: Rng): SpawnEntry[] {
  const out: SpawnEntry[] = [];
  const isBoss = wave % 10 === 0;
  const isRest = !isBoss && wave % 5 === 4;     // wave 4, 9(no: 9%10!=0 → rest), 14, ...
  const base = 6 + Math.floor(wave * 1.8);
  const count = Math.floor(isRest ? base * 0.4 : base);

  const pool: EnemyType[] = ['normal'];
  if (wave >= 2) pool.push('fast');
  if (wave >= 4) pool.push('spitter');
  if (wave >= 6) pool.push('tank');
  if (wave >= 8) pool.push('exploding');

  let t = 0;
  for (let i = 0; i < count; i++) {
    out.push({ type: rng.pick(pool), delayTicks: t });
    t += rng.int(Math.floor(TICK_RATE * 0.3), Math.floor(TICK_RATE * 1.2));
  }
  if (isBoss) out.push({ type: 'butcher', delayTicks: t + TICK_RATE * 3 });
  return out;
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit** — `git commit -am "feat(sim): balance data for buildings, enemies, wave composition"`

---

### Task 4: Grid + map generation

**Files:**
- Create: `packages/shared/src/sim/grid.ts`
- Create: `packages/shared/src/sim/mapgen.ts`
- Test: `packages/shared/test/grid.test.ts`

- [ ] **Step 1: Write failing tests**

`test/grid.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Grid } from '../src/sim/grid';
import { generateMap } from '../src/sim/mapgen';
import { Rng } from '../src/sim/rng';
import { MAP_SIZE, CASTLE_POS } from '../src/sim/constants';

describe('Grid', () => {
  it('rejects placement outside bounds', () => {
    const g = new Grid(MAP_SIZE);
    expect(g.canPlace({ x: -1, y: 5 }, 1)).toBe(false);
    expect(g.canPlace({ x: MAP_SIZE - 1, y: 5 }, 2)).toBe(false);
  });
  it('rejects overlapping placements and frees on clear', () => {
    const g = new Grid(MAP_SIZE);
    g.occupy({ x: 10, y: 10 }, 2, 99);
    expect(g.canPlace({ x: 11, y: 11 }, 2)).toBe(false);
    expect(g.occupantAt({ x: 11, y: 11 })).toBe(99);
    g.clear({ x: 10, y: 10 }, 2);
    expect(g.canPlace({ x: 11, y: 11 }, 2)).toBe(true);
  });
});

describe('generateMap', () => {
  it('is deterministic for the same seed', () => {
    const a = generateMap(new Rng(5));
    const b = generateMap(new Rng(5));
    expect(a.nodes.map(n => ({ ...n }))).toEqual(b.nodes.map(n => ({ ...n })));
  });
  it('keeps a clear area around the castle', () => {
    const m = generateMap(new Rng(5));
    for (const n of m.nodes) {
      const dx = n.pos.x - (CASTLE_POS.x + 2), dy = n.pos.y - (CASTLE_POS.y + 2);
      expect(Math.hypot(dx, dy)).toBeGreaterThan(10);
    }
  });
  it('spawn points sit on the map border region', () => {
    const m = generateMap(new Rng(5));
    expect(m.spawnPoints.length).toBeGreaterThanOrEqual(8);
    for (const p of m.spawnPoints) {
      const nearEdge = p.x < 6 || p.y < 6 || p.x > MAP_SIZE - 6 || p.y > MAP_SIZE - 6;
      expect(nearEdge).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement**

`src/sim/grid.ts`:
```ts
import type { Vec2, EntityId } from './types';

/** Occupancy grid. 0 = free, otherwise the occupying entity id. */
export class Grid {
  private cells: Int32Array;
  constructor(readonly size: number) { this.cells = new Int32Array(size * size); }
  private idx(x: number, y: number) { return y * this.size + x; }

  inBounds(pos: Vec2, footprint = 1): boolean {
    return pos.x >= 0 && pos.y >= 0 &&
      pos.x + footprint <= this.size && pos.y + footprint <= this.size;
  }
  canPlace(pos: Vec2, footprint: number): boolean {
    if (!this.inBounds(pos, footprint)) return false;
    for (let y = pos.y; y < pos.y + footprint; y++)
      for (let x = pos.x; x < pos.x + footprint; x++)
        if (this.cells[this.idx(x, y)] !== 0) return false;
    return true;
  }
  occupy(pos: Vec2, footprint: number, id: EntityId): void {
    for (let y = pos.y; y < pos.y + footprint; y++)
      for (let x = pos.x; x < pos.x + footprint; x++)
        this.cells[this.idx(x, y)] = id;
  }
  clear(pos: Vec2, footprint: number): void {
    for (let y = pos.y; y < pos.y + footprint; y++)
      for (let x = pos.x; x < pos.x + footprint; x++)
        this.cells[this.idx(x, y)] = 0;
  }
  occupantAt(pos: Vec2): EntityId {
    const x = Math.floor(pos.x), y = Math.floor(pos.y);
    if (!this.inBounds({ x, y })) return 0;
    return this.cells[this.idx(x, y)]!;
  }
}
```

`src/sim/mapgen.ts`:
```ts
import type { Vec2 } from './types';
import { Rng } from './rng';
import { MAP_SIZE, CASTLE_POS } from './constants';

export interface MapData {
  nodes: { kind: 'tree' | 'rock'; pos: Vec2 }[];
  spawnPoints: Vec2[];
}

const CASTLE_CENTER = { x: CASTLE_POS.x + 2, y: CASTLE_POS.y + 2 };
const CLEAR_RADIUS = 12;

export function generateMap(rng: Rng): MapData {
  const nodes: MapData['nodes'] = [];
  const used = new Set<string>();
  // forest clusters
  for (let c = 0; c < 14; c++) {
    const cx = rng.int(8, MAP_SIZE - 9), cy = rng.int(8, MAP_SIZE - 9);
    for (let i = 0; i < rng.int(5, 12); i++) {
      const x = cx + rng.int(-4, 4), y = cy + rng.int(-4, 4);
      tryAdd(nodes, used, 'tree', x, y);
    }
  }
  // stone deposits
  for (let c = 0; c < 8; c++) {
    const cx = rng.int(8, MAP_SIZE - 9), cy = rng.int(8, MAP_SIZE - 9);
    for (let i = 0; i < rng.int(3, 6); i++) {
      const x = cx + rng.int(-2, 2), y = cy + rng.int(-2, 2);
      tryAdd(nodes, used, 'rock', x, y);
    }
  }
  // 12 spawn points around the border
  const spawnPoints: Vec2[] = [];
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    spawnPoints.push({
      x: Math.round(CASTLE_CENTER.x + Math.cos(angle) * (MAP_SIZE / 2 - 4)),
      y: Math.round(CASTLE_CENTER.y + Math.sin(angle) * (MAP_SIZE / 2 - 4)),
    });
  }
  return { nodes, spawnPoints };
}

function tryAdd(nodes: MapData['nodes'], used: Set<string>,
                kind: 'tree' | 'rock', x: number, y: number): void {
  if (x < 2 || y < 2 || x > MAP_SIZE - 3 || y > MAP_SIZE - 3) return;
  if (Math.hypot(x - CASTLE_CENTER.x, y - CASTLE_CENTER.y) <= CLEAR_RADIUS) return;
  const key = `${x},${y}`;
  if (used.has(key)) return;
  used.add(key);
  nodes.push({ kind, pos: { x, y } });
}
```

Note: spawn points lie on a circle of radius `MAP_SIZE/2 - 4` = 60 around the castle center (~64,64); every point lands within 6 cells of an edge on at least one axis. If the border test fails for diagonal points, relax the circle to radius 62 — but verify with the test, don't guess.

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit** — `git commit -am "feat(sim): occupancy grid and deterministic map generation"`

---

### Task 5: Sim skeleton — state init, players, day/night clock

**Files:**
- Create: `packages/shared/src/sim/sim.ts`
- Modify: `packages/shared/src/index.ts` (re-export sim public API)
- Test: `packages/shared/test/sim-core.test.ts`

- [ ] **Step 1: Write failing tests**

`test/sim-core.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { DAY_TICKS, START_RESOURCES, CASTLE_POS } from '../src/sim/constants';

describe('Sim init', () => {
  it('starts in day phase with castle placed and starting resources', () => {
    const sim = new Sim(123);
    expect(sim.state.phase).toBe('day');
    expect(sim.state.resources).toEqual(START_RESOURCES);
    const castle = sim.state.buildings.get(sim.state.castleId)!;
    expect(castle.type).toBe('castle');
    expect(castle.pos).toEqual(CASTLE_POS);
  });
  it('adds players near the castle with class stats', () => {
    const sim = new Sim(123);
    const p = sim.addPlayer('knight');
    expect(p.alive).toBe(true);
    expect(sim.state.players.size).toBe(1);
  });
});

describe('day/night clock', () => {
  it('switches to night after DAY_TICKS and emits events', () => {
    const sim = new Sim(123);
    let phaseEvents = 0;
    for (let i = 0; i < DAY_TICKS + 1; i++) {
      for (const e of sim.step()) {
        if (e.kind === 'phase_change' && e.phase === 'night') phaseEvents++;
      }
    }
    expect(sim.state.phase).toBe('night');
    expect(phaseEvents).toBe(1);
    expect(sim.state.wave).toBe(1);
  });
});

describe('movement', () => {
  it('move command moves the player and clamps to map', () => {
    const sim = new Sim(123);
    const p = sim.addPlayer('knight');
    const x0 = p.pos.x;
    sim.applyCommand(p.id, { kind: 'move', dir: { x: 1, y: 0 } });
    sim.step();
    expect(sim.state.players.get(p.id)!.pos.x).toBeGreaterThan(x0);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement Sim skeleton**

`src/sim/sim.ts`:
```ts
import type {
  SimState, SimEvent, Command, Player, Building, ClassType, EntityId, Vec2,
} from './types';
import { Rng } from './rng';
import { Grid } from './grid';
import { generateMap, type MapData } from './mapgen';
import { BUILDINGS } from './data/buildings';
import {
  MAP_SIZE, CASTLE_POS, DAY_TICKS, PLAYER_SPEED, PLAYER_MAX_HP, START_RESOURCES,
} from './constants';

export class Sim {
  readonly state: SimState;
  readonly grid: Grid;
  readonly map: MapData;
  readonly rng: Rng;
  private moveIntent = new Map<EntityId, Vec2>();
  private attackIntent = new Map<EntityId, Vec2>();

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.grid = new Grid(MAP_SIZE);
    this.map = generateMap(this.rng);
    this.state = {
      tick: 0, phase: 'day', phaseTicks: DAY_TICKS, wave: 0,
      pendingSpawns: [], resources: { ...START_RESOURCES },
      buildings: new Map(), enemies: new Map(), players: new Map(),
      nodes: new Map(), castleId: 0, nextId: 1, gameOver: false,
    };
    // castle
    const castle = this.makeBuilding('castle', CASTLE_POS, 1);
    this.state.castleId = castle.id;
    // resource nodes occupy the grid so buildings can't overlap them
    for (const n of this.map.nodes) {
      const id = this.state.nextId++;
      this.state.nodes.set(id, { id, kind: n.kind, pos: n.pos, amount: 200 });
      this.grid.occupy(n.pos, 1, id);
    }
  }

  addPlayer(klass: ClassType): Player {
    const id = this.state.nextId++;
    const p: Player = {
      id, klass, weapon: klass === 'knight' ? 'sword' : 'bow',
      pos: { x: CASTLE_POS.x + 2, y: CASTLE_POS.y + 6 },
      hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP,
      attackCooldown: 0, alive: true, respawnTicks: 0,
    };
    this.state.players.set(id, p);
    return p;
  }

  applyCommand(playerId: EntityId, cmd: Command): void {
    const p = this.state.players.get(playerId);
    if (!p || !p.alive || this.state.gameOver) return;
    switch (cmd.kind) {
      case 'move': this.moveIntent.set(playerId, cmd.dir); break;
      case 'attack': this.attackIntent.set(playerId, cmd.dir); break;
      // build/upgrade/demolish wired in Task 6
    }
  }

  step(): SimEvent[] {
    const events: SimEvent[] = [];
    if (this.state.gameOver) return events;
    this.state.tick++;
    this.stepClock(events);
    this.stepPlayers();
    return events;
  }

  private stepClock(events: SimEvent[]): void {
    this.state.phaseTicks--;
    if (this.state.phaseTicks > 0) return;
    if (this.state.phase === 'day') {
      this.state.phase = 'night';
      this.state.wave++;
      events.push({ kind: 'phase_change', phase: 'night' });
      // wave scheduling wired in Task 8; phaseTicks managed there.
      this.state.phaseTicks = Number.MAX_SAFE_INTEGER; // night ends when wave cleared
    } else {
      this.state.phase = 'day';
      this.state.phaseTicks = DAY_TICKS;
      events.push({ kind: 'phase_change', phase: 'day' });
    }
  }

  private stepPlayers(): void {
    for (const p of this.state.players.values()) {
      if (!p.alive) continue;
      if (p.attackCooldown > 0) p.attackCooldown--;
      const dir = this.moveIntent.get(p.id);
      if (dir) {
        const len = Math.hypot(dir.x, dir.y) || 1;
        p.pos.x = clamp(p.pos.x + (dir.x / len) * PLAYER_SPEED, 0, MAP_SIZE - 1);
        p.pos.y = clamp(p.pos.y + (dir.y / len) * PLAYER_SPEED, 0, MAP_SIZE - 1);
      }
    }
    this.moveIntent.clear();
  }

  protected makeBuilding(type: Building['type'], pos: Vec2, tier: number): Building {
    const def = BUILDINGS[type];
    const stats = def.tiers[tier - 1]!;
    const id = this.state.nextId++;
    const b: Building = {
      id, type, tier, pos: { ...pos },
      hp: stats.hp, maxHp: stats.hp, cooldown: stats.cooldownTicks ?? 0,
    };
    this.state.buildings.set(id, b);
    this.grid.occupy(pos, def.size, id);
    return b;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
```

Update `src/index.ts`:
```ts
export const SHARED_VERSION = '0.1.0';
export { Sim } from './sim/sim';
export { Rng } from './sim/rng';
export * from './sim/types';
export * from './sim/constants';
export { BUILDINGS } from './sim/data/buildings';
export { ENEMIES } from './sim/data/enemies';
export { waveComposition, enemyHpScale, enemyDmgScale } from './sim/data/waves';
```

Note for the day/night test: night start increments `wave` immediately; Task 8 replaces the `MAX_SAFE_INTEGER` placeholder with wave-clear detection. The Task 5 test only checks the transition and wave counter.

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit** — `git commit -am "feat(sim): sim skeleton with state init, players, day/night clock"`

---

### Task 6: BuildingManager — build, upgrade, demolish, gather, income

**Files:**
- Create: `packages/shared/src/sim/economy.ts`
- Modify: `packages/shared/src/sim/sim.ts`
- Test: `packages/shared/test/building.test.ts`

- [ ] **Step 1: Write failing tests**

`test/building.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { BUILDINGS } from '../src/sim/data/buildings';

function freshSim() {
  const sim = new Sim(123);
  const p = sim.addPlayer('knight');
  return { sim, p };
}
/** find an empty 2x2 area near the castle */
function freeSpot(sim: Sim, size: number) {
  for (let y = 70; y < 90; y++) for (let x = 70; x < 90; x++) {
    if (sim.grid.canPlace({ x, y }, size)) return { x, y };
  }
  throw new Error('no free spot');
}

describe('build', () => {
  it('places a building, charges cost, occupies grid', () => {
    const { sim, p } = freshSim();
    const pos = freeSpot(sim, 2);
    const woodBefore = sim.state.resources.wood;
    sim.applyCommand(p.id, { kind: 'build', type: 'archer_tower', pos });
    const events = sim.step();
    expect(events.some(e => e.kind === 'build_placed')).toBe(true);
    expect(sim.state.resources.wood)
      .toBe(woodBefore - BUILDINGS.archer_tower.tiers[0]!.cost.wood!);
    expect(sim.grid.canPlace(pos, 2)).toBe(false);
  });
  it('rejects when resources are insufficient', () => {
    const { sim, p } = freshSim();
    sim.state.resources.wood = 0; sim.state.resources.stone = 0;
    const pos = freeSpot(sim, 2);
    sim.applyCommand(p.id, { kind: 'build', type: 'archer_tower', pos });
    sim.step();
    expect([...sim.state.buildings.values()].filter(b => b.type === 'archer_tower')).toHaveLength(0);
  });
  it('rejects buildings locked behind castle level', () => {
    const { sim, p } = freshSim();
    sim.state.resources.stone = 9999; sim.state.resources.gold = 9999;
    const pos = freeSpot(sim, 2);
    sim.applyCommand(p.id, { kind: 'build', type: 'bomb_tower', pos }); // needs castle 3
    sim.step();
    expect([...sim.state.buildings.values()].filter(b => b.type === 'bomb_tower')).toHaveLength(0);
  });
  it('rejects occupied cells', () => {
    const { sim, p } = freshSim();
    const pos = freeSpot(sim, 2);
    sim.applyCommand(p.id, { kind: 'build', type: 'wood_camp', pos });
    sim.step();
    sim.applyCommand(p.id, { kind: 'build', type: 'wood_camp', pos });
    sim.step();
    expect([...sim.state.buildings.values()].filter(b => b.type === 'wood_camp')).toHaveLength(1);
  });
});

describe('upgrade', () => {
  it('upgrades tier, charges next-tier cost, raises hp', () => {
    const { sim, p } = freshSim();
    sim.state.resources.wood = 9999; sim.state.resources.stone = 9999;
    const pos = freeSpot(sim, 1);
    sim.applyCommand(p.id, { kind: 'build', type: 'wood_wall', pos });
    sim.step();
    const wall = [...sim.state.buildings.values()].find(b => b.type === 'wood_wall')!;
    sim.applyCommand(p.id, { kind: 'upgrade', buildingId: wall.id });
    sim.step();
    expect(wall.tier).toBe(2);
    expect(wall.maxHp).toBe(BUILDINGS.wood_wall.tiers[1]!.hp);
  });
  it('upgrading the castle raises its level and unlocks buildings', () => {
    const { sim, p } = freshSim();
    sim.state.resources.wood = 99999; sim.state.resources.stone = 99999; sim.state.resources.gold = 99999;
    sim.applyCommand(p.id, { kind: 'upgrade', buildingId: sim.state.castleId });
    sim.step();
    sim.applyCommand(p.id, { kind: 'upgrade', buildingId: sim.state.castleId });
    sim.step();
    expect(sim.state.buildings.get(sim.state.castleId)!.tier).toBe(3);
    const pos = freeSpot(sim, 2);
    sim.applyCommand(p.id, { kind: 'build', type: 'bomb_tower', pos });
    sim.step();
    expect([...sim.state.buildings.values()].some(b => b.type === 'bomb_tower')).toBe(true);
  });
});

describe('demolish', () => {
  it('removes the building, refunds 50% of tier-1 cost, frees grid', () => {
    const { sim, p } = freshSim();
    const pos = freeSpot(sim, 1);
    sim.applyCommand(p.id, { kind: 'build', type: 'wood_wall', pos }); // 10 wood
    sim.step();
    const wall = [...sim.state.buildings.values()].find(b => b.type === 'wood_wall')!;
    const woodBefore = sim.state.resources.wood;
    sim.applyCommand(p.id, { kind: 'demolish', buildingId: wall.id });
    sim.step();
    expect(sim.state.buildings.has(wall.id)).toBe(false);
    expect(sim.state.resources.wood).toBe(woodBefore + 5);
    expect(sim.grid.canPlace(pos, 1)).toBe(true);
  });
  it('cannot demolish the castle', () => {
    const { sim, p } = freshSim();
    sim.applyCommand(p.id, { kind: 'demolish', buildingId: sim.state.castleId });
    sim.step();
    expect(sim.state.buildings.has(sim.state.castleId)).toBe(true);
  });
});

describe('economy income', () => {
  it('wood_camp generates wood every cooldown pulse', () => {
    const { sim, p } = freshSim();
    const pos = freeSpot(sim, 2);
    sim.applyCommand(p.id, { kind: 'build', type: 'wood_camp', pos });
    sim.step();
    const before = sim.state.resources.wood;
    for (let i = 0; i < 101; i++) sim.step();   // tier1 cooldown = 100 ticks
    expect(sim.state.resources.wood).toBe(before + 8);
  });
});

describe('gathering', () => {
  it('attacking a tree yields wood and depletes the node', () => {
    const { sim, p } = freshSim();
    const node = [...sim.state.nodes.values()].find(n => n.kind === 'tree')!;
    p.pos = { x: node.pos.x + 0.5, y: node.pos.y + 1.2 }; // adjacent
    const before = sim.state.resources.wood;
    sim.applyCommand(p.id, { kind: 'attack', dir: { x: 0, y: -1 } });
    sim.step();
    expect(sim.state.resources.wood).toBe(before + 5);
    expect(node.amount).toBe(195);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement economy module + wire into Sim**

`src/sim/economy.ts`:
```ts
import type { Resources } from './types';
import type { TierStats } from './data/buildings';

export function canAfford(res: Resources, cost: TierStats['cost']): boolean {
  return (cost.wood ?? 0) <= res.wood &&
         (cost.stone ?? 0) <= res.stone &&
         (cost.gold ?? 0) <= res.gold;
}
export function charge(res: Resources, cost: TierStats['cost']): void {
  res.wood -= cost.wood ?? 0;
  res.stone -= cost.stone ?? 0;
  res.gold -= cost.gold ?? 0;
}
export function refund(res: Resources, cost: TierStats['cost'], ratio: number): void {
  res.wood += Math.floor((cost.wood ?? 0) * ratio);
  res.stone += Math.floor((cost.stone ?? 0) * ratio);
  res.gold += Math.floor((cost.gold ?? 0) * ratio);
}
```

Modify `src/sim/sim.ts` — add to `applyCommand` switch:
```ts
      case 'build': this.buildQueue.push({ playerId, type: cmd.type, pos: cmd.pos }); break;
      case 'upgrade': this.upgradeQueue.push(cmd.buildingId); break;
      case 'demolish': this.demolishQueue.push(cmd.buildingId); break;
```

Add fields:
```ts
  private buildQueue: { playerId: EntityId; type: Building['type']; pos: Vec2 }[] = [];
  private upgradeQueue: EntityId[] = [];
  private demolishQueue: EntityId[] = [];
```

Add to `step()` after `stepClock`:
```ts
    this.stepBuildCommands(events);
    this.stepIncome();
    this.stepGather(events);
```

New methods on `Sim` (import `canAfford`, `charge`, `refund` from `./economy`, `GATHER_AMOUNT` from `./constants`):
```ts
  get castleLevel(): number {
    return this.state.buildings.get(this.state.castleId)!.tier;
  }

  private stepBuildCommands(events: SimEvent[]): void {
    for (const req of this.buildQueue) {
      const def = BUILDINGS[req.type];
      if (req.type === 'castle') continue;
      if (def.unlockCastleLevel > this.castleLevel) continue;
      const pos = { x: Math.floor(req.pos.x), y: Math.floor(req.pos.y) };
      if (!this.grid.canPlace(pos, def.size)) continue;
      const cost = def.tiers[0]!.cost;
      if (!canAfford(this.state.resources, cost)) continue;
      charge(this.state.resources, cost);
      this.makeBuilding(req.type, pos, 1);
      events.push({ kind: 'build_placed', pos, type: req.type });
    }
    this.buildQueue.length = 0;

    for (const id of this.upgradeQueue) {
      const b = this.state.buildings.get(id);
      if (!b) continue;
      const def = BUILDINGS[b.type];
      if (b.tier >= def.tiers.length) continue;
      const next = def.tiers[b.tier]!;            // tier is 1-based; tiers[tier] = next
      if (!canAfford(this.state.resources, next.cost)) continue;
      charge(this.state.resources, next.cost);
      b.tier++;
      const hpRatio = b.hp / b.maxHp;
      b.maxHp = next.hp;
      b.hp = Math.round(next.hp * hpRatio);
    }
    this.upgradeQueue.length = 0;

    for (const id of this.demolishQueue) {
      const b = this.state.buildings.get(id);
      if (!b || b.type === 'castle') continue;
      const def = BUILDINGS[b.type];
      refund(this.state.resources, def.tiers[0]!.cost, 0.5);
      this.grid.clear(b.pos, def.size);
      this.state.buildings.delete(id);
    }
    this.demolishQueue.length = 0;
  }

  private stepIncome(): void {
    for (const b of this.state.buildings.values()) {
      const stats = BUILDINGS[b.type].tiers[b.tier - 1]!;
      if (!stats.income || !stats.cooldownTicks) continue;
      if (--b.cooldown > 0) continue;
      b.cooldown = stats.cooldownTicks;
      this.state.resources.wood += stats.income.wood ?? 0;
      this.state.resources.stone += stats.income.stone ?? 0;
      this.state.resources.gold += stats.income.gold ?? 0;
    }
  }

  private stepGather(events: SimEvent[]): void {
    for (const [pid, dir] of this.attackIntent) {
      const p = this.state.players.get(pid);
      if (!p || !p.alive || p.attackCooldown > 0) continue;
      // nearest node within melee gather range (1.6)
      let best: { node: import('./types').ResourceNode; d: number } | null = null;
      for (const n of this.state.nodes.values()) {
        const d = Math.hypot(n.pos.x + 0.5 - p.pos.x, n.pos.y + 0.5 - p.pos.y);
        if (d <= 1.6 && (!best || d < best.d)) best = { node: n, d };
      }
      if (!best) continue;  // combat attack handled in Task 7
      p.attackCooldown = 12;
      const take = Math.min(GATHER_AMOUNT, best.node.amount);
      best.node.amount -= take;
      const kind = best.node.kind === 'tree' ? 'wood' : 'stone';
      this.state.resources[kind] += take;
      if (best.node.amount <= 0) {
        this.grid.clear(best.node.pos, 1);
        this.state.nodes.delete(best.node.id);
      }
      this.attackIntent.delete(pid);
    }
  }
```

Note: `attackIntent` is cleared per-consumer: `stepGather` deletes entries it consumed; Task 7's combat consumes the rest and clears the map at end of step.

- [ ] **Step 4: Run, expect PASS** (all building tests + earlier suites)

- [ ] **Step 5: Commit** — `git commit -am "feat(sim): building placement, upgrades, demolish, income, gathering"`

---

### Task 7: CombatManager — towers, player attacks, damage, deaths

**Files:**
- Create: `packages/shared/src/sim/combat.ts`
- Modify: `packages/shared/src/sim/sim.ts`
- Test: `packages/shared/test/combat.test.ts`

- [ ] **Step 1: Write failing tests**

`test/combat.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { ENEMIES } from '../src/sim/data/enemies';

/** Test helper exposed on Sim for tests/server: spawn enemy at position. */
describe('towers', () => {
  it('archer tower damages the nearest enemy in range and emits projectile event', () => {
    const sim = new Sim(123);
    const p = sim.addPlayer('knight');
    sim.state.resources.wood = 9999;
    sim.applyCommand(p.id, { kind: 'build', type: 'archer_tower', pos: { x: 70, y: 70 } });
    sim.step();
    const e = sim.spawnEnemy('normal', { x: 73, y: 73 }, 1);
    const hp0 = e.hp;
    let sawProjectile = false;
    for (let i = 0; i < 20; i++) {
      for (const ev of sim.step()) if (ev.kind === 'projectile') sawProjectile = true;
    }
    expect(e.hp).toBeLessThan(hp0);
    expect(sawProjectile).toBe(true);
  });
  it('bomb tower deals AoE damage to clustered enemies', () => {
    const sim = new Sim(123);
    const p = sim.addPlayer('knight');
    sim.state.resources.stone = 9999; sim.state.resources.gold = 9999;
    const castle = sim.state.buildings.get(sim.state.castleId)!;
    castle.tier = 3;  // unlock bomb tower
    sim.applyCommand(p.id, { kind: 'build', type: 'bomb_tower', pos: { x: 70, y: 70 } });
    sim.step();
    const a = sim.spawnEnemy('normal', { x: 74, y: 71 }, 1);
    const b = sim.spawnEnemy('normal', { x: 74.5, y: 71.5 }, 1);
    for (let i = 0; i < 60; i++) sim.step();
    expect(a.hp).toBeLessThan(a.maxHp);
    expect(b.hp).toBeLessThan(b.maxHp);
  });
  it('ice tower slows enemies', () => {
    const sim = new Sim(123);
    const p = sim.addPlayer('knight');
    sim.state.resources.stone = 9999; sim.state.resources.gold = 9999;
    sim.state.buildings.get(sim.state.castleId)!.tier = 3;
    sim.applyCommand(p.id, { kind: 'build', type: 'ice_tower', pos: { x: 70, y: 70 } });
    sim.step();
    const e = sim.spawnEnemy('normal', { x: 73, y: 71 }, 1);
    for (let i = 0; i < 25; i++) sim.step();
    expect(e.speedMul).toBeLessThan(1);
  });
  it('lightning tower chains across multiple enemies', () => {
    const sim = new Sim(123);
    const p = sim.addPlayer('knight');
    sim.state.resources.stone = 9999; sim.state.resources.gold = 9999;
    sim.state.buildings.get(sim.state.castleId)!.tier = 4;
    sim.applyCommand(p.id, { kind: 'build', type: 'lightning_tower', pos: { x: 70, y: 70 } });
    sim.step();
    const a = sim.spawnEnemy('normal', { x: 73, y: 71 }, 1);
    const b = sim.spawnEnemy('normal', { x: 74, y: 72 }, 1);
    const c = sim.spawnEnemy('normal', { x: 75, y: 73 }, 1);
    let chain = false;
    for (let i = 0; i < 40; i++) {
      for (const ev of sim.step()) if (ev.kind === 'chain' && ev.points.length >= 3) chain = true;
    }
    expect(chain).toBe(true);
    expect(a.hp).toBeLessThan(a.maxHp);
    expect(b.hp).toBeLessThan(b.maxHp);
    expect(c.hp).toBeLessThan(c.maxHp);
  });
});

describe('player combat', () => {
  it('knight melee attack damages adjacent enemy; coins on kill', () => {
    const sim = new Sim(123);
    const p = sim.addPlayer('knight');
    const e = sim.spawnEnemy('normal', { x: p.pos.x + 1, y: p.pos.y }, 1);
    e.hp = 1;
    sim.applyCommand(p.id, { kind: 'attack', dir: { x: 1, y: 0 } });
    const events = sim.step();
    expect(events.some(ev => ev.kind === 'death')).toBe(true);
    expect(sim.state.resources.coins).toBe(ENEMIES.normal.coins);
    expect(sim.state.enemies.size).toBe(0);
  });
  it('hunter bow attack hits at range', () => {
    const sim = new Sim(123);
    const p = sim.addPlayer('hunter');
    const e = sim.spawnEnemy('normal', { x: p.pos.x + 6, y: p.pos.y }, 1);
    const hp0 = e.hp;
    sim.applyCommand(p.id, { kind: 'attack', dir: { x: 1, y: 0 } });
    sim.step();
    expect(e.hp).toBeLessThan(hp0);
  });
});

describe('exploding zombie', () => {
  it('explodes on death damaging nearby buildings', () => {
    const sim = new Sim(123);
    const p = sim.addPlayer('knight');
    sim.state.resources.wood = 9999;
    sim.applyCommand(p.id, { kind: 'build', type: 'wood_wall', pos: { x: 70, y: 70 } });
    sim.step();
    const wall = [...sim.state.buildings.values()].find(b => b.type === 'wood_wall')!;
    const e = sim.spawnEnemy('exploding', { x: 70.5, y: 71.5 }, 1);
    e.hp = 1;
    sim.damageEnemy(e.id, 5, []);   // public helper; kills it
    expect(wall.hp).toBeLessThan(wall.maxHp);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement combat**

`src/sim/combat.ts` — pure helpers:
```ts
import type { Enemy, Vec2 } from './types';

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
/** center of a building footprint */
export function buildingCenter(pos: Vec2, size: number): Vec2 {
  return { x: pos.x + size / 2, y: pos.y + size / 2 };
}
export function nearestEnemy(enemies: Iterable<Enemy>, from: Vec2, maxRange: number): Enemy | null {
  let best: Enemy | null = null; let bd = maxRange;
  for (const e of enemies) {
    const d = dist(e.pos, from);
    if (d <= bd) { bd = d; best = e; }
  }
  return best;
}
```

Modify `src/sim/sim.ts`:

Add public helpers (used by tests, Task 8 wave spawning, and the server):
```ts
  spawnEnemy(type: EnemyType, pos: Vec2, wave: number): Enemy {
    const def = ENEMIES[type];
    const id = this.state.nextId++;
    const e: Enemy = {
      id, type, pos: { ...pos },
      hp: Math.round(def.hp * enemyHpScale(wave)),
      maxHp: Math.round(def.hp * enemyHpScale(wave)),
      speedMul: 1, slowTicks: 0, attackCooldown: 0,
      targetBuildingId: null, enraged: false,
    };
    this.state.enemies.set(id, e);
    return e;
  }

  damageEnemy(id: EntityId, amount: number, events: SimEvent[]): void {
    const e = this.state.enemies.get(id);
    if (!e) return;
    e.hp -= amount;
    events.push({ kind: 'damage', pos: { ...e.pos }, amount, crit: false });
    if (e.hp > 0) return;
    this.state.enemies.delete(id);
    const def = ENEMIES[e.type];
    this.state.resources.coins += def.coins;
    events.push({ kind: 'death', pos: { ...e.pos }, enemy: e.type });
    events.push({ kind: 'coins', pos: { ...e.pos }, amount: def.coins });
    if (def.explodeOnDeath) {
      this.explode(e.pos, def.explodeOnDeath.radius, def.explodeOnDeath.dmg, events);
    }
  }

  private explode(at: Vec2, radius: number, dmg: number, events: SimEvent[]): void {
    events.push({ kind: 'explosion', pos: { ...at }, radius });
    for (const e of [...this.state.enemies.values()]) {
      if (dist(e.pos, at) <= radius) this.damageEnemy(e.id, dmg, events);
    }
    for (const b of [...this.state.buildings.values()]) {
      const c = buildingCenter(b.pos, BUILDINGS[b.type].size);
      if (dist(c, at) <= radius + BUILDINGS[b.type].size / 2) {
        this.damageBuilding(b.id, dmg, events);
      }
    }
    for (const p of this.state.players.values()) {
      if (p.alive && dist(p.pos, at) <= radius) this.damagePlayer(p.id, dmg);
    }
  }

  damageBuilding(id: EntityId, amount: number, events: SimEvent[]): void {
    const b = this.state.buildings.get(id);
    if (!b) return;
    b.hp -= amount;
    if (b.hp > 0) return;
    const def = BUILDINGS[b.type];
    events.push({ kind: 'building_destroyed', pos: { ...b.pos }, type: b.type });
    if (b.type === 'castle') {
      this.state.gameOver = true;
      events.push({ kind: 'game_over', wave: this.state.wave });
      return;
    }
    this.grid.clear(b.pos, def.size);
    this.state.buildings.delete(id);
  }

  damagePlayer(id: EntityId, amount: number): void {
    const p = this.state.players.get(id);
    if (!p || !p.alive) return;
    p.hp -= amount;
    if (p.hp <= 0) { p.alive = false; p.respawnTicks = RESPAWN_TICKS; }
  }
```

Add to `step()` after `stepGather`:
```ts
    this.stepTowers(events);
    this.stepPlayerCombat(events);
    this.stepSupport();
    this.stepRespawns();
```

```ts
  private stepTowers(events: SimEvent[]): void {
    for (const b of this.state.buildings.values()) {
      const stats = BUILDINGS[b.type].tiers[b.tier - 1]!;
      if (!stats.dmg || !stats.range || !stats.cooldownTicks) continue;
      if (b.cooldown > 0) { b.cooldown--; continue; }
      const center = buildingCenter(b.pos, BUILDINGS[b.type].size);
      const target = nearestEnemy(this.state.enemies.values(), center, stats.range);
      if (!target) continue;
      b.cooldown = stats.cooldownTicks;

      if (b.type === 'bomb_tower') {
        events.push({ kind: 'projectile', from: center, to: { ...target.pos }, weapon: 'bomb' });
        this.explode(target.pos, stats.aoeRadius!, stats.dmg, events);
      } else if (b.type === 'lightning_tower') {
        const points: Vec2[] = [center];
        let cur = target;
        const hit = new Set<EntityId>();
        for (let i = 0; i < (stats.chainTargets ?? 1); i++) {
          points.push({ ...cur.pos });
          hit.add(cur.id);
          this.damageEnemy(cur.id, stats.dmg, events);
          const next = nearestEnemy(
            [...this.state.enemies.values()].filter(e => !hit.has(e.id)), cur.pos, 4);
          if (!next) break;
          cur = next;
        }
        events.push({ kind: 'chain', points });
      } else {
        const weapon = b.type === 'ice_tower' ? 'ice'
          : b.type === 'crossbow_tower' ? 'bolt' : 'arrow';
        events.push({ kind: 'projectile', from: center, to: { ...target.pos }, weapon });
        if (stats.slowMul) {
          target.speedMul = stats.slowMul;
          target.slowTicks = stats.slowTicks!;
        }
        this.damageEnemy(target.id, stats.dmg, events);
      }
    }
  }

  private stepPlayerCombat(events: SimEvent[]): void {
    for (const [pid, dir] of this.attackIntent) {
      const p = this.state.players.get(pid);
      if (!p || !p.alive || p.attackCooldown > 0) continue;
      const range = p.weapon === 'sword' ? 1.8 : p.weapon === 'bow' ? 8 : 10;
      const dmg = p.weapon === 'sword' ? 25 : p.weapon === 'bow' ? 15 : 22;
      const cd = p.weapon === 'sword' ? 10 : p.weapon === 'bow' ? 14 : 22;
      // class passives: knight +25% melee dmg, hunter +20% ranged range
      const finalDmg = p.klass === 'knight' && p.weapon === 'sword' ? Math.round(dmg * 1.25) : dmg;
      const finalRange = p.klass === 'hunter' && p.weapon !== 'sword' ? range * 1.2 : range;
      const target = nearestEnemy(this.state.enemies.values(), p.pos, finalRange);
      if (!target) continue;
      p.attackCooldown = cd;
      if (p.weapon !== 'sword') {
        events.push({ kind: 'projectile', from: { ...p.pos }, to: { ...target.pos },
                      weapon: p.weapon === 'bow' ? 'arrow' : 'bolt' });
      }
      this.damageEnemy(target.id, finalDmg, events);
    }
    this.attackIntent.clear();
  }

  private stepSupport(): void {
    for (const b of this.state.buildings.values()) {
      const stats = BUILDINGS[b.type].tiers[b.tier - 1]!;
      if (!stats.heal || !stats.range || !stats.cooldownTicks) continue;
      if (--b.cooldown > 0) continue;
      b.cooldown = stats.cooldownTicks;
      const center = buildingCenter(b.pos, BUILDINGS[b.type].size);
      for (const p of this.state.players.values()) {
        if (p.alive && dist(p.pos, center) <= stats.range) {
          p.hp = Math.min(p.maxHp, p.hp + stats.heal);
        }
      }
      for (const other of this.state.buildings.values()) {
        const oc = buildingCenter(other.pos, BUILDINGS[other.type].size);
        if (dist(oc, center) <= stats.range) {
          other.hp = Math.min(other.maxHp, other.hp + stats.heal);
        }
      }
    }
  }

  private stepRespawns(): void {
    for (const p of this.state.players.values()) {
      if (p.alive) continue;
      if (--p.respawnTicks <= 0) {
        p.alive = true;
        p.hp = p.maxHp;
        p.pos = { x: CASTLE_POS.x + 2, y: CASTLE_POS.y + 6 };
      }
    }
  }
```

Required new imports in `sim.ts`: `ENEMIES` from `./data/enemies`, `enemyHpScale` from `./data/waves`, `dist`, `buildingCenter`, `nearestEnemy` from `./combat`, `RESPAWN_TICKS` from `./constants`, types `Enemy`, `EnemyType`.

Ordering note: `stepGather` runs before `stepPlayerCombat` and deletes consumed intents, so a player adjacent to a tree gathers; otherwise the same attack press hits enemies.

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit** — `git commit -am "feat(sim): tower combat, player attacks, AoE/slow/chain, deaths and coins"`

---

### Task 8: EnemyManager + WaveManager — AI movement, attacks, wave lifecycle

**Files:**
- Modify: `packages/shared/src/sim/sim.ts`
- Test: `packages/shared/test/waves.test.ts`

- [ ] **Step 1: Write failing tests**

`test/waves.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { DAY_TICKS, TICK_RATE, CASTLE_POS } from '../src/sim/constants';

function skipToNight(sim: Sim) {
  while (sim.state.phase === 'day') sim.step();
}

describe('wave lifecycle', () => {
  it('night start schedules spawns; enemies appear over time', () => {
    const sim = new Sim(42);
    sim.addPlayer('knight');
    skipToNight(sim);
    expect(sim.state.pendingSpawns.length).toBeGreaterThan(0);
    for (let i = 0; i < TICK_RATE * 30; i++) sim.step();
    expect(sim.state.enemies.size + killedSoFar(sim)).toBeGreaterThan(0);
  });
  it('night ends and day returns when all enemies are dead and spawns exhausted', () => {
    const sim = new Sim(42);
    sim.addPlayer('knight');
    skipToNight(sim);
    // cheat: clear pending spawns and enemies → next step should flip to day
    sim.state.pendingSpawns.length = 0;
    sim.state.enemies.clear();
    let backToDay = false;
    for (let i = 0; i < 5 && !backToDay; i++) {
      for (const e of sim.step()) if (e.kind === 'phase_change' && e.phase === 'day') backToDay = true;
    }
    expect(backToDay).toBe(true);
    expect(sim.state.phaseTicks).toBe(DAY_TICKS);
  });
});

function killedSoFar(sim: Sim): number {
  // proxy: coins earned implies kills happened
  return sim.state.resources.coins > 0 ? 1 : 0;
}

describe('enemy AI', () => {
  it('enemy moves toward the castle', () => {
    const sim = new Sim(42);
    const e = sim.spawnEnemy('normal', { x: 10, y: 64 }, 1);
    const d0 = Math.hypot(e.pos.x - (CASTLE_POS.x + 2), e.pos.y - (CASTLE_POS.y + 2));
    for (let i = 0; i < TICK_RATE * 5; i++) sim.step();
    const d1 = Math.hypot(e.pos.x - (CASTLE_POS.x + 2), e.pos.y - (CASTLE_POS.y + 2));
    expect(d1).toBeLessThan(d0);
  });
  it('enemy attacks a wall blocking its path', () => {
    const sim = new Sim(42);
    const p = sim.addPlayer('knight');
    sim.state.resources.wood = 9999;
    // wall directly between spawn and castle on the x axis
    sim.applyCommand(p.id, { kind: 'build', type: 'wood_wall', pos: { x: 50, y: 64 } });
    sim.step();
    const wall = [...sim.state.buildings.values()].find(b => b.type === 'wood_wall')!;
    sim.spawnEnemy('normal', { x: 48, y: 64.5 }, 1);
    for (let i = 0; i < TICK_RATE * 10; i++) sim.step();
    expect(wall.hp).toBeLessThan(wall.maxHp);
  });
  it('spitter attacks from range without closing to melee', () => {
    const sim = new Sim(42);
    const e = sim.spawnEnemy('spitter', { x: CASTLE_POS.x - 8, y: CASTLE_POS.y + 2 }, 1);
    const castle = sim.state.buildings.get(sim.state.castleId)!;
    for (let i = 0; i < TICK_RATE * 10; i++) sim.step();
    expect(castle.hp).toBeLessThan(castle.maxHp);
    expect(Math.hypot(e.pos.x - (CASTLE_POS.x + 2), e.pos.y - (CASTLE_POS.y + 2)))
      .toBeGreaterThan(3);
  });
  it('butcher enrages below 50% hp', () => {
    const sim = new Sim(42);
    const boss = sim.spawnEnemy('butcher', { x: 30, y: 64 }, 10);
    boss.hp = Math.floor(boss.maxHp * 0.4);
    sim.step();
    expect(boss.enraged).toBe(true);
  });
  it('castle destruction ends the game', () => {
    const sim = new Sim(42);
    const castle = sim.state.buildings.get(sim.state.castleId)!;
    castle.hp = 1;
    sim.spawnEnemy('tank', { x: CASTLE_POS.x + 2, y: CASTLE_POS.y - 1 }, 1);
    let over = false;
    for (let i = 0; i < TICK_RATE * 20 && !over; i++) {
      for (const e of sim.step()) if (e.kind === 'game_over') over = true;
    }
    expect(over).toBe(true);
    expect(sim.state.gameOver).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement wave scheduling + enemy AI in `sim.ts`**

Replace the night branch of `stepClock`:
```ts
    if (this.state.phase === 'day') {
      this.state.phase = 'night';
      this.state.wave++;
      events.push({ kind: 'phase_change', phase: 'night' });
      const comp = waveComposition(this.state.wave, this.rng);
      const boss = comp.some(s => s.type === 'butcher');
      events.push({ kind: 'wave_start', wave: this.state.wave, boss });
      this.state.pendingSpawns = comp.map(s => ({
        type: s.type, atTick: this.state.tick + s.delayTicks,
      }));
      this.state.phaseTicks = Number.MAX_SAFE_INTEGER;
    }
```

Change the clock decrement so night ends on wave-clear, not timer. New `stepClock` top:
```ts
  private stepClock(events: SimEvent[]): void {
    if (this.state.phase === 'night') {
      if (this.state.pendingSpawns.length === 0 && this.state.enemies.size === 0) {
        this.state.phase = 'day';
        this.state.phaseTicks = DAY_TICKS;
        events.push({ kind: 'phase_change', phase: 'day' });
      }
      return;
    }
    this.state.phaseTicks--;
    if (this.state.phaseTicks > 0) return;
    // ... night-start branch above
  }
```

Add to `step()` after `stepTowers`... (final order: clock, build, income, gather, towers, playerCombat, spawns, enemies, support, respawns):
```ts
    this.stepSpawns();
    this.stepEnemies(events);
```

```ts
  private stepSpawns(): void {
    if (this.state.pendingSpawns.length === 0) return;
    const due = this.state.pendingSpawns.filter(s => s.atTick <= this.state.tick);
    if (due.length === 0) return;
    this.state.pendingSpawns = this.state.pendingSpawns.filter(s => s.atTick > this.state.tick);
    for (const s of due) {
      const sp = this.rng.pick(this.map.spawnPoints);
      this.spawnEnemy(s.type, { x: sp.x, y: sp.y }, this.state.wave);
    }
  }

  private stepEnemies(events: SimEvent[]): void {
    const castle = this.state.buildings.get(this.state.castleId);
    if (!castle) return;
    const castleCenter = buildingCenter(castle.pos, BUILDINGS.castle.size);

    for (const e of [...this.state.enemies.values()]) {
      const def = ENEMIES[e.type];
      if (e.attackCooldown > 0) e.attackCooldown--;
      if (e.slowTicks > 0 && --e.slowTicks === 0) e.speedMul = 1;
      if (e.type === 'butcher' && !e.enraged && e.hp < e.maxHp * 0.5) e.enraged = true;

      const speed = (def.speed / TICK_RATE) * e.speedMul * (e.enraged ? 1.6 : 1);
      const dmg = Math.round(def.dmg * enemyDmgScale(this.state.wave) * (e.enraged ? 1.5 : 1));

      // 1. nearest player in attack range? attack player.
      let nearPlayer: Player | null = null; let pd = def.attackRange;
      for (const p of this.state.players.values()) {
        if (!p.alive) continue;
        const d = dist(p.pos, e.pos);
        if (d <= pd) { pd = d; nearPlayer = p; }
      }
      if (nearPlayer && e.attackCooldown === 0) {
        e.attackCooldown = def.attackCooldownTicks;
        this.damagePlayer(nearPlayer.id, dmg);
        continue;
      }

      // 2. building in attack range (current target or whatever is in front)? attack it.
      const targetB = this.findBlockingBuilding(e, castleCenter, def.attackRange);
      if (targetB) {
        if (e.attackCooldown === 0) {
          e.attackCooldown = def.attackCooldownTicks;
          this.damageBuilding(targetB.id, dmg, events);
        }
        continue;  // stop moving while attacking
      }

      // 3. otherwise walk toward the castle
      const dx = castleCenter.x - e.pos.x, dy = castleCenter.y - e.pos.y;
      const len = Math.hypot(dx, dy) || 1;
      e.pos.x += (dx / len) * speed;
      e.pos.y += (dy / len) * speed;
    }
  }

  /** Building whose footprint is within `range` of the enemy along its path (incl. castle). */
  private findBlockingBuilding(e: Enemy, castleCenter: Vec2, range: number): Building | null {
    // probe the cell ahead of the enemy plus its current cell
    const dx = castleCenter.x - e.pos.x, dy = castleCenter.y - e.pos.y;
    const len = Math.hypot(dx, dy) || 1;
    const probes = [
      e.pos,
      { x: e.pos.x + (dx / len) * range, y: e.pos.y + (dy / len) * range },
    ];
    for (const probe of probes) {
      const id = this.grid.occupantAt(probe);
      const b = this.state.buildings.get(id);
      if (b) return b;
    }
    return null;
  }
```

Spitter ranged behavior — in step 2 of `stepEnemies`, the generic `findBlockingBuilding(e, castleCenter, def.attackRange)` with the spitter's `attackRange: 6` makes it stop and shoot from distance automatically when probing 6 units ahead. No special case needed, but the probe at `range` must check the building footprint: `occupantAt` already returns the castle for any cell of its 4x4 footprint.

Required new imports: `waveComposition`, `enemyDmgScale`, `TICK_RATE`, type `Player`.

- [ ] **Step 4: Run full suite, expect PASS**

- [ ] **Step 5: Commit** — `git commit -am "feat(sim): wave scheduling, enemy AI, boss enrage, night/day lifecycle"`

---

### Task 9: Skill tree

**Files:**
- Create: `packages/shared/src/sim/data/skills.ts`
- Modify: `packages/shared/src/sim/sim.ts`, `packages/shared/src/sim/types.ts`
- Test: `packages/shared/test/skills.test.ts`

- [ ] **Step 1: Write failing tests**

`test/skills.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { SKILLS, applySkills, type SkillModifiers, defaultModifiers } from '../src/sim/data/skills';

describe('skill tree data', () => {
  it('has three branches with 4-5 nodes each', () => {
    const branches = new Set(SKILLS.map(s => s.branch));
    expect([...branches].sort()).toEqual(['combat', 'economy', 'engineering']);
    for (const br of branches) {
      const n = SKILLS.filter(s => s.branch === br).length;
      expect(n).toBeGreaterThanOrEqual(4);
      expect(n).toBeLessThanOrEqual(5);
    }
  });
  it('nodes have ascending costs within a branch', () => {
    for (const br of ['combat', 'economy', 'engineering'] as const) {
      const nodes = SKILLS.filter(s => s.branch === br);
      for (let i = 1; i < nodes.length; i++) {
        expect(nodes[i]!.cost).toBeGreaterThan(nodes[i - 1]!.cost);
      }
    }
  });
});

describe('applySkills', () => {
  it('combines modifiers from unlocked skill ids', () => {
    const ids = SKILLS.filter(s => s.branch === 'combat').slice(0, 2).map(s => s.id);
    const mods: SkillModifiers = applySkills(ids);
    expect(mods.playerDmgMul).toBeGreaterThan(1);
  });
  it('returns identity modifiers for no skills', () => {
    expect(applySkills([])).toEqual(defaultModifiers());
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement**

`src/sim/data/skills.ts`:
```ts
export type SkillBranch = 'combat' | 'engineering' | 'economy';

export interface SkillModifiers {
  playerDmgMul: number;
  playerAttackSpeedMul: number;   // divides cooldown
  critChance: number;             // 0..1
  towerDmgMul: number;
  towerRangeMul: number;
  buildCostMul: number;           // <1 = cheaper
  incomeMul: number;
  healMul: number;
  coinMul: number;
}

export function defaultModifiers(): SkillModifiers {
  return {
    playerDmgMul: 1, playerAttackSpeedMul: 1, critChance: 0,
    towerDmgMul: 1, towerRangeMul: 1, buildCostMul: 1,
    incomeMul: 1, healMul: 1, coinMul: 1,
  };
}

export interface SkillDef {
  id: string;
  branch: SkillBranch;
  name: string;
  cost: number;                   // skill points
  apply: (m: SkillModifiers) => void;
}

export const SKILLS: SkillDef[] = [
  // combat
  { id: 'cmb_dmg1',  branch: 'combat', name: 'Sharpened Steel', cost: 1, apply: m => { m.playerDmgMul *= 1.1; } },
  { id: 'cmb_spd1',  branch: 'combat', name: 'Quick Hands',     cost: 2, apply: m => { m.playerAttackSpeedMul *= 1.15; } },
  { id: 'cmb_crit1', branch: 'combat', name: 'Keen Eye',        cost: 3, apply: m => { m.critChance += 0.1; } },
  { id: 'cmb_dmg2',  branch: 'combat', name: 'Executioner',     cost: 5, apply: m => { m.playerDmgMul *= 1.2; } },
  // engineering
  { id: 'eng_twr1',  branch: 'engineering', name: 'Reinforced Mounts', cost: 1, apply: m => { m.towerDmgMul *= 1.1; } },
  { id: 'eng_rng1',  branch: 'engineering', name: 'Long Sights',       cost: 2, apply: m => { m.towerRangeMul *= 1.1; } },
  { id: 'eng_cost1', branch: 'engineering', name: 'Efficient Plans',   cost: 3, apply: m => { m.buildCostMul *= 0.9; } },
  { id: 'eng_twr2',  branch: 'engineering', name: 'Siege Doctrine',    cost: 5, apply: m => { m.towerDmgMul *= 1.2; } },
  // economy
  { id: 'eco_inc1',  branch: 'economy', name: 'Industrious',  cost: 1, apply: m => { m.incomeMul *= 1.15; } },
  { id: 'eco_coin1', branch: 'economy', name: 'Looter',       cost: 2, apply: m => { m.coinMul *= 1.2; } },
  { id: 'eco_heal1', branch: 'economy', name: 'Field Medic',  cost: 3, apply: m => { m.healMul *= 1.25; } },
  { id: 'eco_inc2',  branch: 'economy', name: 'Tycoon',       cost: 5, apply: m => { m.incomeMul *= 1.25; } },
];

export function applySkills(unlockedIds: string[]): SkillModifiers {
  const m = defaultModifiers();
  for (const id of unlockedIds) SKILLS.find(s => s.id === id)?.apply(m);
  return m;
}
```

Wire into `sim.ts`:
- Add `skills: string[]` parameter to `addPlayer(klass: ClassType, skills: string[] = [])`; store `mods = applySkills(skills)` on a new `Player` field `mods: SkillModifiers` (add to `types.ts`; import the type from `data/skills`).
- In `stepPlayerCombat`: `finalDmg = Math.round(base * p.mods.playerDmgMul)`, cooldown `Math.round(cd / p.mods.playerAttackSpeedMul)`, crit roll `this.rng.next() < p.mods.critChance` doubles damage and sets `crit: true` on the damage event (pass crit through `damageEnemy` via a new optional arg `crit = false`).
- In `stepTowers`: multiply `stats.dmg` by team-average `towerDmgMul` — Phase 1 simplification: use the **maximum** of connected players' modifiers (`teamMods()` private helper computing max per field). Document in code comment.
- In `stepIncome`: multiply income by `teamMods().incomeMul`, `Math.round`.
- In `stepBuildCommands`: multiply costs by `teamMods().buildCostMul` (apply `Math.ceil` per resource) before `canAfford`/`charge`.
- Coin reward in `damageEnemy`: multiply by `teamMods().coinMul`, `Math.round`.
- Add `teamMods` test in `skills.test.ts` only if behavior surfaces bugs; sim-level integration is covered by existing suites staying green.

- [ ] **Step 4: Run full suite, expect PASS** (existing tests must stay green — identity modifiers change nothing)

- [ ] **Step 5: Commit** — `git commit -am "feat(sim): skill tree modifiers wired into combat, towers, economy"`

---

### Task 10: Snapshot serialization + determinism test

**Files:**
- Create: `packages/shared/src/sim/snapshot.ts`
- Test: `packages/shared/test/determinism.test.ts`

- [ ] **Step 1: Write failing tests**

`test/determinism.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { serializeState, deserializeState } from '../src/sim/snapshot';
import { DAY_TICKS } from '../src/sim/constants';

describe('determinism', () => {
  it('two sims with same seed and same commands produce identical serialized state', () => {
    const a = new Sim(777), b = new Sim(777);
    const pa = a.addPlayer('hunter'), pb = b.addPlayer('hunter');
    const script = (sim: Sim, pid: number, i: number) => {
      if (i % 3 === 0) sim.applyCommand(pid, { kind: 'move', dir: { x: 1, y: 0.5 } });
      if (i % 7 === 0) sim.applyCommand(pid, { kind: 'attack', dir: { x: 1, y: 0 } });
      if (i === 50) sim.applyCommand(pid, { kind: 'build', type: 'archer_tower', pos: { x: 70, y: 70 } });
    };
    for (let i = 0; i < DAY_TICKS + 1200; i++) {
      script(a, pa.id, i); script(b, pb.id, i);
      a.step(); b.step();
    }
    expect(serializeState(a.state)).toEqual(serializeState(b.state));
  });
});

describe('snapshot roundtrip', () => {
  it('serialize → deserialize preserves state', () => {
    const sim = new Sim(9);
    sim.addPlayer('knight');
    for (let i = 0; i < 200; i++) sim.step();
    const json = serializeState(sim.state);
    const restored = deserializeState(json);
    expect(serializeState(restored)).toEqual(json);
    expect(restored.buildings.size).toBe(sim.state.buildings.size);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement**

`src/sim/snapshot.ts`:
```ts
import type { SimState } from './types';

/** JSON-safe full-state snapshot. Phase 1 uses JSON; Plan 2 adds binary deltas on top. */
export function serializeState(s: SimState): string {
  return JSON.stringify({
    ...s,
    buildings: [...s.buildings.entries()],
    enemies: [...s.enemies.entries()],
    players: [...s.players.entries()],
    nodes: [...s.nodes.entries()],
  });
}

export function deserializeState(json: string): SimState {
  const raw = JSON.parse(json);
  return {
    ...raw,
    buildings: new Map(raw.buildings),
    enemies: new Map(raw.enemies),
    players: new Map(raw.players),
    nodes: new Map(raw.nodes),
  };
}
```

Export both from `src/index.ts`.

If the determinism test fails: the only allowed sources of nondeterminism are iteration order (Maps preserve insertion order — fine) and unseeded randomness. Search for any `Math.random` usage — there must be none; all randomness goes through `this.rng`.

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit** — `git commit -am "feat(sim): state serialization and cross-sim determinism guarantee"`

---

### Task 11: Full-game smoke test + typecheck gate

**Files:**
- Test: `packages/shared/test/smoke-game.test.ts`

- [ ] **Step 1: Write the long-run smoke test**

`test/smoke-game.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { TICK_RATE } from '../src/sim/constants';

describe('full game smoke', () => {
  it('survives 5 simulated minutes with two active players without crashing', () => {
    const sim = new Sim(2026);
    const p1 = sim.addPlayer('knight');
    const p2 = sim.addPlayer('hunter');
    for (let i = 0; i < TICK_RATE * 300; i++) {
      // crude bot behavior: both players spam attack, p1 builds towers around the castle
      sim.applyCommand(p1.id, { kind: 'attack', dir: { x: 1, y: 0 } });
      sim.applyCommand(p2.id, { kind: 'attack', dir: { x: -1, y: 0 } });
      if (i % 200 === 0) {
        sim.applyCommand(p1.id, { kind: 'build', type: 'archer_tower',
          pos: { x: 56 + (i / 200) * 3, y: 70 } });
      }
      sim.step();
    }
    // game may or may not be over depending on defense; it must not throw and state must be sane
    expect(sim.state.tick).toBe(TICK_RATE * 300);
    expect(sim.state.resources.wood).toBeGreaterThanOrEqual(0);
    expect(sim.state.resources.coins).toBeGreaterThanOrEqual(0);
    for (const e of sim.state.enemies.values()) {
      expect(Number.isFinite(e.pos.x)).toBe(true);
      expect(Number.isFinite(e.pos.y)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run full suite + typecheck**

Run: `npm test -w packages/shared` then `npm run typecheck -w packages/shared`
Expected: all suites pass; tsc exits 0. Fix anything that surfaces — negative-resource bugs and NaN positions are the usual suspects.

- [ ] **Step 3: Commit** — `git commit -am "test(sim): full-game smoke test and typecheck gate"`

---

## Done Criteria (Plan 1)

- `npm test -w packages/shared` green: rng, data, grid, sim-core, building, combat, waves, skills, determinism, smoke.
- `npm run typecheck -w packages/shared` exits 0.
- `Sim` public API stable for Plan 2 (server): `new Sim(seed)`, `addPlayer(klass, skills)`, `applyCommand(playerId, cmd)`, `step(): SimEvent[]`, `spawnEnemy`, `serializeState`/`deserializeState`, `state`, `grid`, `map`.

## Next Plans

- **Plan 2 (server):** uWebSockets.js/ws server, LobbyManager (party codes), per-room Sim tick loop, JSON full snapshot → binary delta protocol, device-token auth, Postgres profiles (skill tree points/unlocks), reconnect window, integration tests with fake WS clients.
- **Plan 3 (client + deploy):** Vite + Three.js renderer (tilted ortho camera, instanced low-poly meshes per building tier/enemy), NetworkManager interpolation + own-player prediction, HTML/CSS HUD (build menu, minimap, wave/resources/castle HP, party panel, damage numbers), EffectManager (pooled particles, camera shake), WebAudio procedural SFX/music, docker-compose + Caddy deploy.
