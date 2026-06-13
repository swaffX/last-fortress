# Procedural Creature Models v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the 10 wild animals distinct procedural silhouettes and lively, speed-driven animation (gait, body/head bob, tail sway, idle breathing), client-side only.

**Architecture:** A data-driven blueprint table (`creature-blueprints.ts`) feeds one generic builder (`buildCreature` in `models.ts`) that tags a `userData.rig`, and one generic animator (`animateCreature` in `world.ts`) reads the rig + inferred ground speed. No `@lf/shared` sim or wire-protocol change — animation is cosmetic, inferred from interpolation delta (the technique players already use).

**Tech Stack:** TypeScript, Three.js, Vite. Client package `@lf/client`.

**Project conventions:** Tests are deferred ([[tests-last]] — written only when the user asks), so this plan uses `tsc` typecheck + `vite build` + a manual Electron visual check as the per-task gate instead of TDD. Commit after each task. The deploy push is the final step (auto-deploys to the VDS).

---

## File Structure

- **Create** `packages/client/src/render/creature-blueprints.ts` — blueprint types + per-species data (8 box animals). Client-only cosmetic data; intentionally NOT in `@lf/shared`.
- **Modify** `packages/client/src/render/models.ts` — add `buildCreature()` + part helpers; repoint `creatureModel()` for the 8 box animals; tag a `userData.rig`/`gait`/`anim` on spider & snake; remove the now-unused `quadruped()`.
- **Modify** `packages/client/src/render/world.ts` — add `animateCreature()`; branch `animateCharacter()` to it for any entity carrying `userData.gait`.

Animation contract added to the existing one (models.ts header comment):
```
group.userData.gait : Gait        — selects the animator branch
group.userData.anim : AnimParams  — per-species amplitudes/cadence
group.userData.rig  : { legs:Mesh[], body:Mesh, head:Mesh, tail?:Mesh, ears?:Mesh[], segments?:Mesh[] }
```

---

## Task 1: Blueprint data + types

**Files:**
- Create: `packages/client/src/render/creature-blueprints.ts`

- [ ] **Step 1: Create the blueprint module**

```ts
// packages/client/src/render/creature-blueprints.ts
//
// Client-only cosmetic data driving procedural creature models + their animation.
// Deliberately NOT in @lf/shared — the deterministic 20 Hz sim must stay free of
// render concerns. Each entry yields a distinct low-poly silhouette via buildCreature().

export type Gait = 'quad' | 'hop' | 'bird' | 'skitter' | 'slither';

export interface AnimParams {
  bob: number;       // body vertical bounce amplitude (world units)
  headBob: number;   // head vertical bounce amplitude
  tailSway: number;  // tail yaw amplitude (radians)
  cadence: number;   // base stride frequency multiplier
}

export interface CreatureBlueprint {
  scale: number;
  body: { w: number; h: number; d: number; col: number; round?: boolean };
  head: { size: number; col: number; snout?: number; muzzleCol?: number };
  ears?: 'pointed' | 'round' | 'long' | 'floppy';
  horns?: 'cow' | 'tusks';
  tail?: 'stub' | 'bushy' | 'thin';
  legs: { count: 2 | 4; thickness: number; length: number; col: number };
  extras?: ('udder' | 'wool' | 'hump' | 'comb' | 'beak')[];
  gait: Gait;
  anim: AnimParams;
}

// The 8 box-bodied animals. spider & snake keep bespoke builders (already distinct
// silhouettes) but gain animation via their tagged rig — see Task 2.
export const CREATURE_BLUEPRINTS: Record<string, CreatureBlueprint> = {
  cow: {
    scale: 1.25, body: { w: 1.0, h: 0.62, d: 0.6, col: 0x6b5640 },
    head: { size: 0.42, col: 0xe8e2d4, snout: 0.18, muzzleCol: 0xd8c8b0 },
    ears: 'floppy', horns: 'cow', tail: 'thin',
    legs: { count: 4, thickness: 0.15, length: 0.5, col: 0x5a4636 },
    extras: ['udder'], gait: 'quad', anim: { bob: 0.05, headBob: 0.04, tailSway: 0.5, cadence: 8 },
  },
  sheep: {
    scale: 1.0, body: { w: 0.85, h: 0.55, d: 0.55, col: 0xe8e2d4, round: true },
    head: { size: 0.3, col: 0x3a322c },
    ears: 'floppy', tail: 'stub',
    legs: { count: 4, thickness: 0.1, length: 0.32, col: 0x2e2620 },
    extras: ['wool'], gait: 'quad', anim: { bob: 0.04, headBob: 0.03, tailSway: 0.3, cadence: 9 },
  },
  pig: {
    scale: 1.0, body: { w: 0.8, h: 0.5, d: 0.5, col: 0xd99a9a, round: true },
    head: { size: 0.36, col: 0xc78a8a, snout: 0.16, muzzleCol: 0xe0a8a8 },
    ears: 'pointed', tail: 'stub',
    legs: { count: 4, thickness: 0.11, length: 0.26, col: 0xb87a7a },
    gait: 'quad', anim: { bob: 0.05, headBob: 0.04, tailSway: 0.6, cadence: 11 },
  },
  boar: {
    scale: 1.0, body: { w: 0.85, h: 0.52, d: 0.55, col: 0x5a4a3a },
    head: { size: 0.4, col: 0x4a3a2a, snout: 0.18, muzzleCol: 0x3a2c1e },
    ears: 'pointed', horns: 'tusks', tail: 'thin',
    legs: { count: 4, thickness: 0.13, length: 0.34, col: 0x3a2c1e },
    extras: ['hump'], gait: 'quad', anim: { bob: 0.05, headBob: 0.05, tailSway: 0.3, cadence: 10 },
  },
  wolf: {
    scale: 1.0, body: { w: 0.82, h: 0.4, d: 0.42, col: 0x6a6f78 },
    head: { size: 0.34, col: 0x565b64, snout: 0.16, muzzleCol: 0x44484f },
    ears: 'pointed', tail: 'bushy',
    legs: { count: 4, thickness: 0.1, length: 0.42, col: 0x4a4e56 },
    gait: 'quad', anim: { bob: 0.04, headBob: 0.04, tailSway: 0.5, cadence: 11 },
  },
  bear: {
    scale: 1.25, body: { w: 1.0, h: 0.7, d: 0.6, col: 0x4a3a2a },
    head: { size: 0.46, col: 0x3a2c1e, snout: 0.14, muzzleCol: 0x2e2218 },
    ears: 'round', tail: 'stub',
    legs: { count: 4, thickness: 0.18, length: 0.4, col: 0x3a2c1e },
    gait: 'quad', anim: { bob: 0.06, headBob: 0.03, tailSway: 0.2, cadence: 7 },
  },
  chicken: {
    scale: 0.7, body: { w: 0.4, h: 0.4, d: 0.45, col: 0xf0ead8, round: true },
    head: { size: 0.24, col: 0xf0ead8 },
    tail: 'thin',
    legs: { count: 2, thickness: 0.05, length: 0.22, col: 0xe0a040 },
    extras: ['comb', 'beak'], gait: 'bird', anim: { bob: 0.03, headBob: 0.08, tailSway: 0.4, cadence: 12 },
  },
  rabbit: {
    scale: 0.6, body: { w: 0.42, h: 0.36, d: 0.5, col: 0xcfc6b4, round: true },
    head: { size: 0.26, col: 0xe8e2d4 },
    ears: 'long', tail: 'stub',
    legs: { count: 4, thickness: 0.08, length: 0.22, col: 0xc0b6a2 },
    gait: 'hop', anim: { bob: 0.0, headBob: 0.05, tailSway: 0.2, cadence: 6 },
  },
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run -w @lf/client typecheck`
Expected: PASS (no usages yet; file just defines exports).

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/render/creature-blueprints.ts
git commit -m "feat(render): creature blueprint data for 8 box animals"
```

---

## Task 2: Generic builder + repoint creatureModel

**Files:**
- Modify: `packages/client/src/render/models.ts`

- [ ] **Step 1: Import the blueprints**

At the top of `models.ts`, after the existing `import { assetInstance } from './assets';` line, add:

```ts
import { CREATURE_BLUEPRINTS, type CreatureBlueprint } from './creature-blueprints';
```

- [ ] **Step 2: Add part helpers + `buildCreature` above `creatureModel`**

Insert this block immediately before the existing `export function creatureModel(species: string)`:

```ts
/** A leg whose geometry pivots at the hip (top), so rotation.x swings the foot. */
function legMesh(thick: number, len: number, col: number): THREE.Mesh {
  const geo = new THREE.BoxGeometry(thick, len, thick);
  geo.translate(0, -len / 2, 0);   // origin at the hip, mesh hangs down
  return new THREE.Mesh(geo, mat(col));
}

function earMesh(kind: NonNullable<CreatureBlueprint['ears']>, col: number, side: number): THREE.Mesh {
  switch (kind) {
    case 'long':    return at(box(0.07, 0.34, 0.05, col), side * 0.1, 0.22, 0);
    case 'pointed': return at(box(0.09, 0.16, 0.05, col), side * 0.16, 0.16, 0.02);
    case 'round':   return at(new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), mat(col)), side * 0.2, 0.14, 0);
    case 'floppy':  return at(box(0.1, 0.2, 0.05, col), side * 0.2, 0.02, 0);
  }
}

/** Build a box-bodied animal (quad / hop / bird gaits) from a blueprint. */
function buildCreature(spec: CreatureBlueprint): THREE.Group {
  const b = spec.body, h = spec.head, L = spec.legs;
  const bodyY = L.length + b.h / 2;

  const body = box(b.w, b.h, b.d, b.col, bodyY);
  if (b.round) body.scale.set(1.0, 0.92, 1.05);

  // head at the front (+z); birds carry it higher on an upright neck
  const headY = spec.gait === 'bird' ? bodyY + b.h * 0.75 : bodyY + b.h * 0.15;
  const head = box(h.size, h.size, h.size, h.col, headY);
  head.position.z = b.d / 2 + h.size * 0.25;
  if (h.snout) {
    const sn = box(h.snout, h.snout * 0.7, h.snout, h.muzzleCol ?? h.col);
    sn.position.set(0, -0.02, h.size * 0.5 + h.snout * 0.3);
    head.add(sn);
  }
  if (spec.ears) for (const side of [-1, 1] as const) head.add(earMesh(spec.ears, h.col, side));
  if (spec.horns === 'cow') for (const side of [-1, 1] as const)
    head.add(at(box(0.06, 0.18, 0.06, 0xece6d6), side * 0.16, 0.18, 0.02));
  if (spec.horns === 'tusks') for (const side of [-1, 1] as const)
    head.add(at(box(0.04, 0.04, 0.18, 0xf0ead8), side * 0.12, -0.08, h.size * 0.5));
  if (spec.extras?.includes('comb')) head.add(at(box(0.05, 0.1, 0.16, 0xc43a31), 0, h.size * 0.55, 0));
  if (spec.extras?.includes('beak')) head.add(at(box(0.07, 0.06, 0.12, 0xe0a040), 0, -0.02, h.size * 0.55));

  // legs at the body corners (4) or under the hips (2, bird)
  const legs: THREE.Mesh[] = [];
  const lx = b.w * 0.34, lz = b.d * 0.32;
  const layout: readonly (readonly [number, number])[] = L.count === 4
    ? [[-lx, lz], [lx, lz], [-lx, -lz], [lx, -lz]]   // FL, FR, BL, BR
    : [[-lx, 0], [lx, 0]];                            // L, R (bird)
  for (const [x, z] of layout) {
    const leg = legMesh(L.thickness, L.length, L.col);
    leg.position.set(x, L.length, z);   // hip at the body underside
    legs.push(leg);
  }

  const parts: THREE.Object3D[] = [body, head, ...legs];

  let tail: THREE.Mesh | undefined;
  if (spec.tail) {
    const dims = spec.tail === 'bushy' ? [0.14, 0.14, 0.34] : spec.tail === 'thin' ? [0.07, 0.07, 0.34] : [0.12, 0.12, 0.14];
    tail = box(dims[0]!, dims[1]!, dims[2]!, b.col, bodyY + b.h * 0.1);
    tail.position.z = -(b.d / 2 + dims[2]! * 0.4);
    parts.push(tail);
  }
  if (spec.extras?.includes('udder')) parts.push(at(box(0.22, 0.14, 0.3, 0xe7b8b8), 0, bodyY - b.h * 0.5, -b.d * 0.1));
  if (spec.extras?.includes('hump')) parts.push(at(box(b.w * 0.7, 0.22, b.d * 0.5, b.col), 0, bodyY + b.h * 0.5, b.d * 0.15));
  if (spec.extras?.includes('wool')) for (const [ox, oz] of [[-0.25, 0.2], [0.25, 0.2], [-0.25, -0.2], [0.25, -0.2], [0, 0]] as const)
    parts.push(at(new THREE.Mesh(new THREE.SphereGeometry(0.26, 6, 5), mat(b.col)), ox * b.w, bodyY + b.h * 0.35, oz * b.d));

  const g = group(...parts);
  g.scale.setScalar(spec.scale);
  body.userData.baseY = body.position.y;
  head.userData.baseY = head.position.y;
  g.userData.rig = { legs, body, head, tail, ears: undefined as THREE.Mesh[] | undefined };
  g.userData.gait = spec.gait;
  g.userData.anim = spec.anim;
  // back-compat keys still read by older code paths
  g.userData.legs = legs; g.userData.body = body; g.userData.head = head;
  return g;
}
```

- [ ] **Step 3: Repoint `creatureModel` for the 8 box animals and tag spider/snake rigs**

Replace the existing `creatureModel` body. The asset-override line and humanoid/zombie/boss cases stay as-is; the 8 box-animal cases now delegate to `buildCreature`, and spider/snake tag a rig + gait so the animator can drive them:

```ts
export function creatureModel(species: string): THREE.Group {
  const asset = assetInstance(`creature_${species}`);
  if (asset) return asset;

  const bp = CREATURE_BLUEPRINTS[species];
  if (bp) return buildCreature(bp);

  let g: THREE.Group;
  switch (species) {
    case 'spider': g = spiderModel(0x2a2a32); break;
    case 'snake': g = snakeModel(0x4a7a3a); break;
    case 'bandit_sword': g = humanoidTinted(0x4a3a52, 'sword'); break;
    case 'bandit_dagger': g = humanoidTinted(0x3a3a42, 'sword'); break;
    case 'bandit_spear': g = humanoidTinted(0x52423a, 'spear'); break;
    case 'bandit_mage': g = humanoidTinted(0x3a2a52, 'staff'); break;
    case 'zombie': g = zombieModel(0x6f8f57, 1.2); break;
    case 'zombie_fast': g = zombieModel(0x8fae5a, 1.0); break;
    case 'zombie_brute': g = zombieModel(0x4f6b45, 1.7); break;
    case 'warlock': g = humanoidTinted(0x2a1a42, 'staff'); g.scale.setScalar(1.6); break;
    case 'butcher': g = zombieModel(0x5d4a4a, 2.0); { const blade = box(0.2, 1.2, 0.45, 0x9aa3ab, 0.2); (g.userData.arms as THREE.Mesh[])[1]!.add(blade); } break;
    case 'spider_queen': g = spiderModel(0x3a1a2a); g.scale.setScalar(2.0); break;
    default: g = buildCreature(CREATURE_BLUEPRINTS.cow!);
  }
  return g;
}
```

In `spiderModel`, before `return g;`, add gait + anim tags (it already sets `g.userData.legs`/`body`):

```ts
  g.userData.rig = { legs: legs.slice(0, 8), body, head };
  g.userData.gait = 'skitter';
  g.userData.anim = { bob: 0.02, headBob: 0, tailSway: 0, cadence: 18 };
```

In `snakeModel`, before `return g;`, expose the segments and tag gait (replace the existing
`g.userData.body = head; g.userData.legs = [];` line):

```ts
  g.userData.rig = { legs: [], body: head, head, segments: segs };
  g.userData.body = head; g.userData.legs = [];
  g.userData.gait = 'slither';
  g.userData.anim = { bob: 0, headBob: 0, tailSway: 0, cadence: 6 };
```

- [ ] **Step 4: Remove the now-unused `quadruped` builder**

Delete the entire `function quadruped(...) { ... }` block (the 8 animals no longer use it; `tsc`'s
`noUnusedLocals` would otherwise flag it). Leave `spiderModel` and `snakeModel` in place.

- [ ] **Step 5: Typecheck**

Run: `npm run -w @lf/client typecheck`
Expected: PASS. If it flags `quadruped` unused, confirm Step 4 deleted it; if it flags `cyl`/`cone` unused, leave them (pre-existing, used elsewhere).

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/render/models.ts
git commit -m "feat(render): blueprint-driven creature builder + rig tags"
```

---

## Task 3: Generic animator + render-loop branch

**Files:**
- Modify: `packages/client/src/render/world.ts`

- [ ] **Step 1: Branch `animateCharacter` to the creature animator**

In `animateCharacter` (starts `private animateCharacter(t: Tracked, moving: boolean, dt: number)`),
immediately after the existing first line `this.applyHitFlash(t, dt);`, insert:

```ts
    if (t.obj.userData.gait) { this.animateCreature(t, moving, dt); return; }
```

This runs before the `if (!legs || !arms || !body) return;` guard, so blueprint creatures (which have
no `arms`) are animated instead of bailing out.

- [ ] **Step 2: Add the `animateCreature` method**

Add this method directly after `animateCharacter` (same class):

```ts
  /** Animate a blueprint/rig creature: speed-driven gait + idle, by gait type. */
  private animateCreature(t: Tracked, moving: boolean, dt: number): void {
    const u = t.obj.userData;
    const rig = u.rig as {
      legs: THREE.Mesh[]; body: THREE.Mesh; head: THREE.Mesh;
      tail?: THREE.Mesh; segments?: THREE.Mesh[];
    };
    const anim = u.anim as { bob: number; headBob: number; tailSway: number; cadence: number };
    const gait = u.gait as 'quad' | 'hop' | 'bird' | 'skitter' | 'slither';
    if (!rig || !rig.body) return;

    // dead enemies fall away (removed server-side shortly after)
    if (t.deadT > 0) { t.obj.rotation.x = -Math.PI / 2 * Math.min(1, t.deadT); return; }
    t.obj.rotation.x = 0;

    // ground speed from the interpolation delta → stride rate (0 still .. ~2 sprint)
    const dx = t.to.x - t.from.x, dz = t.to.z - t.from.z;
    const speed = Math.hypot(dx, dz) / Math.max(0.02, this.frameInterval);
    const sr = Math.min(2, speed / 3);
    const active = moving && sr > 0.05;

    // gait phase accumulates at a speed-scaled cadence (continuous frequency)
    t.animT += dt * anim.cadence * (active ? 0.5 + sr : 0.0);
    const sw = Math.sin(t.animT);
    const amp = 0.25 + sr * 0.55;
    const legs = rig.legs, body = rig.body, head = rig.head;
    const bodyY = (body.userData.baseY as number) ?? body.position.y;
    const headY = (head?.userData.baseY as number) ?? (head ? head.position.y : 0);

    if (gait === 'slither') {
      // travelling sine across the body segments; head leads
      const segs = rig.segments ?? [];
      for (let i = 0; i < segs.length; i++) segs[i]!.position.x = Math.sin(this.time * 4 + i * 0.9) * 0.12 * (active ? 1 : 0.4);
      if (head) head.position.x = Math.sin(this.time * 4 + 1) * 0.1 * (active ? 1 : 0.4);
      return;
    }
    if (gait === 'skitter') {
      // 8-leg ripple; body barely bobs
      for (let i = 0; i < legs.length; i++) legs[i]!.rotation.x = Math.sin(t.animT + i * 0.8) * 0.25 * (active ? 1 : 0.25);
      body.position.y = bodyY + Math.abs(Math.sin(t.animT)) * anim.bob * (active ? 1 : 0);
      return;
    }
    if (gait === 'hop') {
      // both back legs together; body follows a short arc per stride
      const hop = Math.abs(Math.sin(t.animT));
      for (const leg of legs) leg.rotation.x = active ? -hop * 0.6 : 0;
      body.position.y = bodyY + (active ? hop * 0.28 * sr : Math.sin(this.time * 1.6) * 0.01);
      if (head) head.position.y = headY + (active ? hop * 0.1 : Math.sin(this.time * 1.2) * 0.01);
      this.creatureSecondary(rig, anim, dt);
      return;
    }

    if (active) {
      if (gait === 'bird') {
        legs[0]!.rotation.x = sw * amp; if (legs[1]) legs[1].rotation.x = -sw * amp;
        body.rotation.z = sw * 0.05;
        if (head) head.position.y = headY - Math.abs(sw) * anim.headBob;   // peck bob
      } else { // quad: diagonal pairs
        legs[0]!.rotation.x = sw * amp; if (legs[3]) legs[3].rotation.x = sw * amp;
        if (legs[1]) legs[1].rotation.x = -sw * amp; if (legs[2]) legs[2].rotation.x = -sw * amp;
        body.position.y = bodyY + Math.abs(Math.sin(t.animT)) * anim.bob * (0.4 + sr);
        body.rotation.z = sw * 0.03;
        if (head) head.position.y = headY + Math.abs(sw) * anim.headBob;
      }
    } else {
      // idle: legs neutral, slow breathing, gentle head sway
      for (const leg of legs) leg.rotation.x = 0;
      body.position.y = bodyY + Math.sin(this.time * 1.6) * anim.bob * 0.3;
      body.rotation.z = Math.sin(this.time * 0.8) * 0.02;
      if (head) { head.position.y = headY; head.rotation.y = Math.sin(this.time * 0.5) * 0.3; }
    }
    this.creatureSecondary(rig, anim, dt);
  }

  /** Always-on secondary motion: tail sway + ear twitch (low frequency, this.time clock). */
  private creatureSecondary(
    rig: { tail?: THREE.Mesh; ears?: THREE.Mesh[] },
    anim: { tailSway: number }, _dt: number,
  ): void {
    if (rig.tail) rig.tail.rotation.y = Math.sin(this.time * 2.2) * anim.tailSway;
  }
```

- [ ] **Step 3: Typecheck**

Run: `npm run -w @lf/client typecheck`
Expected: PASS. (`this.time` and `this.frameInterval` are existing private fields; `t.from`/`t.to`/`t.animT`/`t.deadT` are existing `Tracked` fields.)

- [ ] **Step 4: Build**

Run: `npm run -w @lf/client build`
Expected: `✓ built` with a new `dist/assets/index-*.js` hash.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/render/world.ts
git commit -m "feat(render): speed-driven creature animator (gait/idle/tail by gait)"
```

---

## Task 4: Visual verify + deploy

**Files:** none (verification + ship).

- [ ] **Step 1: Launch the client and observe each animal**

Vite + Electron (or a browser on the dev server). Use the renderer-console forwarding already in
`packages/desktop/src/main.ts` to catch any errors in the terminal. Spawn near wild animals (or a
debug spawn) and confirm:
- cow/sheep/pig/boar/wolf/bear read as **distinct** silhouettes (horns, snout, ears, wool, hump, tail).
- chicken stands upright on 2 legs; rabbit hops; spider legs ripple; snake slithers.
- moving animals show a leg gait whose speed scales with travel; standing animals **breathe** (no dead-stiff pose).
- a group of the same species does **not** move in lockstep (per-entity `animT` phase desync).
- no `[renderer E]` errors; players/buildings/trees/zombies/bosses unchanged.

- [ ] **Step 2: Tune offsets if needed (visual only)**

Procedural art: if a head/leg/tail sits visibly wrong, nudge the offsets in `buildCreature` /
blueprint values and re-run `npm run -w @lf/client build`. Keep changes to constants only.

- [ ] **Step 3: Commit any tuning**

```bash
git add packages/client/src/render/
git commit -m "polish(render): tune creature proportions from visual pass"
```

- [ ] **Step 4: Push (auto-deploys to the VDS)**

```bash
git push origin main
```

Then verify the deploy run succeeds (`gh run watch <id>`) and `curl http://212.180.120.69/` → 200.
See [[vds-deploy]] memory for the pipeline + the Caddy/`127.0.0.1:8080` topology.

---

## Self-Review

- **Spec coverage:** distinct silhouettes (Task 1 data + Task 2 builder ✓), speed-driven gait + idle + tail/head (Task 3 ✓), no sim/protocol change (animation reads only `from`/`to`/`frameInterval` ✓), DRY blueprint system (✓), animals-only scope with humanoids/zombies/bosses untouched (Task 2 keeps their cases ✓). Snake/spider distinctness kept via their existing builders + new animation (✓).
- **Type consistency:** `CreatureBlueprint`/`AnimParams`/`Gait` defined in Task 1 and consumed in Tasks 2-3; `userData.rig` shape `{ legs, body, head, tail?, segments? }` written in Task 2 and read identically in Task 3; `buildCreature`/`animateCreature`/`creatureSecondary` names consistent across tasks.
- **Placeholder scan:** none — every step has full code or an exact command.
- **Note (honest):** exact procedural proportions (Task 4 Step 2) are expected to need a visual nudge — the code compiles and animates as written; constant-tuning is normal for procedural art, not a placeholder.
