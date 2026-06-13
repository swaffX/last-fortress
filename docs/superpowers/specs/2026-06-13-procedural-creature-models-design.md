# Procedural Creature Models v2 — Design

**Date:** 2026-06-13
**Status:** Approved (brainstorming) → ready for implementation plan
**Scope:** Client rendering only. Animals first (8 quadrupeds + spider + snake). No sim/protocol change.

## Problem

Current creature visuals are weak:

- **Samey silhouettes.** `creatureModel()` (`packages/client/src/render/models.ts`) builds every
  four-legged animal from one generic `quadruped()` box-body + 4 box-legs + box-head, only recolored
  and rescaled. Cow, sheep, pig, boar, wolf, bear, chicken, rabbit are the *same shape*. They read as
  "a simple object," not as distinct animals.
- **Stiff / absent animation.** Procedural (non-GLB) creatures get only a basic leg swing + waddle via
  `userData.legs` in `world.ts`. No head, tail, ear, or breathing motion; no real gait. They slide
  forward "dümdüz."
- The GLB asset path (`assetInstance('creature_<species>')`) exists but assets are absent, so everything
  falls back to the weak procedural boxes.

## Goals

1. Each animal has a **distinct procedural silhouette** (horns, snout, ears, tail, body proportions, leg
   count) — recognizable without color alone.
2. **Lively, speed-driven animation**: a real leg gait cycle scaled by actual ground speed, plus body bob,
   head bob, tail sway, ear twitch, and an idle (breathing) pose when standing still — with per-species
   gait flavor (quadruped trot, rabbit hop, snake slither, spider skitter, chicken bird-walk).
3. **Zero sim / protocol change** — animation is pure client cosmetic, inferred from position delta (the
   same speed-from-interpolation technique players already use in `world.ts`).
4. **DRY + extensible** — a data-driven blueprint system, not copy-pasted per-species builders, so
   humanoids/zombies/bosses can adopt it later.

## Non-Goals (this pass)

- Humanoids (bandits, mage, warlock), zombies, and bosses (butcher, spider_queen) — they keep their
  current models; the new system is designed to extend to them in a follow-up.
- Player model changes.
- Behavior-state-driven animation (graze head-down, panic gallop) — that would need a server-side
  `CreatureView` field; deferred. Animation is driven only by inferred speed this pass.
- GLB / external 3D assets — explicitly the rejected approach; stay code-only and deterministic-friendly.
- Automated tests — deferred per project convention; verify visually in the Electron client.

## Architecture

Three units, each with one clear job:

```
creature-blueprints.ts  (DATA)  ── per-species spec: proportions, parts, colors, gait, anim params
        │
        ▼
buildCreature(spec)  (models.ts) ── generic builder → THREE.Group, tags userData.rig
        │
        ▼
animateCreature(rig, profile, speed, t)  (world.ts) ── generic per-frame animator
```

- `creatureModel(species)` becomes: `const a = assetInstance('creature_'+species); if (a) return a;
  return buildCreature(BLUEPRINTS[species] ?? FALLBACK);` — GLB override path preserved, unknown species
  fall back to a generic blueprint.
- The old `quadruped()`, `spiderModel()`, `snakeModel()` builders are **replaced** by blueprint-driven
  construction. `humanoidTinted()` and `zombieModel()` stay untouched this pass.

### Unit 1 — `creature-blueprints.ts` (new)

A plain data table. One entry per animal species. Proposed shape (final field names settled in the plan):

```ts
type Gait = 'quad' | 'hop' | 'slither' | 'skitter' | 'bird';

interface CreatureBlueprint {
  scale: number;                                    // overall group scale
  body: { w: number; h: number; d: number; col: number; round?: boolean };
  head: { size: number; col: number; snout?: number; muzzleCol?: number };
  ears?: 'pointed' | 'round' | 'long' | 'floppy';
  horns?: 'cow' | 'tusks';
  tail?: 'stub' | 'bushy' | 'thin';
  legs: { count: 4 | 2; thickness: number; length: number };
  extras?: ('udder' | 'wool' | 'hump' | 'comb' | 'beak')[];
  gait: Gait;
  anim: { bob: number; headBob: number; tailSway: number; cadence: number };
}

const BLUEPRINTS: Record<string, CreatureBlueprint> = { /* per species, see table below */ };
```

Lives under `packages/client/src/render/` (client-only cosmetic data; do not put it in `@lf/shared`,
which is the deterministic sim and must stay free of render concerns).

### Unit 2 — `buildCreature(spec)` (in `models.ts`)

Pure constructor. Reads a blueprint, assembles parts from the existing `box()`/`mat()`/`group()`/`at()`
primitives, and returns a `THREE.Group`. Tags a structured rig for the animator:

```ts
g.userData.rig = { legs: Mesh[], body: Mesh, head: Mesh, tail?: Mesh, ears?: Mesh[], snout?: Mesh };
g.userData.gait = spec.gait;
g.userData.anim = spec.anim;
```

Keeps backward-compat keys (`userData.legs`, `userData.body`, `userData.head`) so any existing reads keep
working during the transition.

Part assembly is conditional on the spec (horns only if `horns`, ears shaped by `ears`, etc.), so one
function yields ten distinct silhouettes. Leg layout differs by `legs.count` (4 = corner quadruped,
2 = bird stance).

### Unit 3 — `animateCreature(rig, profile, speed, t, dt)` (in `world.ts`)

Pure per-frame animator, called from the existing render loop where tracked entities animate. Replaces
the ad-hoc leg-swing block for creatures. Logic by gait:

- **speed** = distance the entity interpolated this frame ÷ frame interval (reuse the players' technique;
  `from`/`to`/`lerpT`/`frameInterval` already on the tracked entity). Normalized to a 0..1+ "stride rate."
- **quad**: diagonal leg pairs out of phase — `(FL, BR)` vs `(FR, BL)` swing `±A·sin(animT·cadence)` where
  `A` scales with speed; body bob `= bob·|sin(2·animT·cadence)|·speed`; head bob + tail sway low-frequency
  always-on; ear twitch occasional.
- **bird** (chicken): 2-leg alternating step, head peck bob, tail-feather flick.
- **hop** (rabbit): both legs swing together; body follows a short vertical arc per stride; ears lag.
- **slither** (snake): no legs — a traveling sine wave across body segments; head leads.
- **skitter** (spider): fast 8-leg ripple (phase offset per leg); minimal body bob.
- **idle** (speed ≈ 0): legs neutral; body breathing = tiny `scale.y` sine; occasional ear twitch; gentle
  head bob. Keeps creatures alive while standing.

Per-entity phase desync uses the existing `tracked.animT` seed so a herd doesn't move in lockstep.

## Per-Animal Silhouette Table

| Species | Distinct features | Gait |
|---|---|---|
| cow | large boxy body, **horns**, **udder**, floppy ears, thick legs | quad (slow) |
| sheep | round **wool** body (clustered cubes), short legs, stub tail, small head | quad |
| pig | round body, **snout**, tiny legs, curly stub tail | quad (fast trot) |
| boar | hunched body + **hump**, **tusks**, dark bristly, low head | quad (aggressive) |
| wolf | lean low body, **pointed ears**, snout, **bushy tail** | quad (lope) |
| bear | massive body, **round ears**, no neck, heavy legs | quad (lumber) |
| chicken | small, **beak** + **comb**, tail feathers, **2 legs** | bird (peck idle) |
| rabbit | **long ears**, tiny, short body, stub tail | hop |
| spider | sphere body, **8 legs**, eye dots | skitter |
| snake | **segmented** tapering body, no legs, flat head | slither |

## Data Flow

1. Server sends `CreatureView { id, species, pos, hp, maxHp }` (unchanged).
2. `world.ts` upsert creates the mesh via `creatureModel(species)` → `buildCreature(BLUEPRINTS[species])`.
3. Each render frame: read `obj.userData.rig`/`gait`/`anim`, compute inferred `speed`, call
   `animateCreature(...)`. No network or sim involvement.

## Determinism & Performance

- Animation is **cosmetic, client-only** — the authoritative 20 Hz sim in `@lf/shared` is untouched, so
  determinism and replay are unaffected.
- Per-frame cost is a handful of `sin`/rotation/position writes per visible creature — negligible; no new
  geometry per frame (rig parts built once at spawn).

## Files Touched

- **new** `packages/client/src/render/creature-blueprints.ts` — blueprint data + types.
- **edit** `packages/client/src/render/models.ts` — add `buildCreature()`, repoint `creatureModel()` for
  the 10 animals, remove the now-unused `quadruped()`/`spiderModel()`/`snakeModel()`.
- **edit** `packages/client/src/render/world.ts` — add `animateCreature()`, call it for creature entities
  in the render loop; keep player/humanoid animation as-is.

## Verification

- `tsc` typecheck + `vite build`.
- Visual check in the Electron client against the live VDS (now survival): spawn/observe each animal,
  confirm distinct silhouette + speed-scaled gait + idle breathing; confirm a moving herd desyncs.
- No regression to players, buildings, trees, or existing humanoid/zombie/boss creatures.

## Future Extension (out of scope, noted for continuity)

- Extend the blueprint system to humanoids/zombies/bosses (biped rig + weapon mount).
- Optional `CreatureView` behavior field to drive state-specific animation (graze/flee/attack).
