import * as THREE from 'three';
import type { BuildingType, EnemyType, ClassType } from '@lf/shared';

/**
 * Procedural low-poly models — no external assets.
 *
 * Animation contract (read by world.ts):
 *   group.userData.legs   : Mesh[]   — alternating walk swing
 *   group.userData.arms   : Mesh[]   — opposite swing / attack lunge
 *   group.userData.body   : Mesh     — bob & breath
 *   group.userData.turret : Object3D — tower head, rotated toward targets
 *   group.userData.spin   : Object3D[] — slow ambient spin (crystals)
 *   group.userData.pulse  : Mesh[]   — emissive pulse
 *   group.userData.flags  : Mesh[]   — banner wave
 */

const mat = (color: number, emissive = 0) =>
  new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity: emissive ? 0.7 : 0 });

/** lazily built shared surface textures — stone block courses, wood grain */
let stoneTexCache: THREE.CanvasTexture | null = null;
let woodTexCache: THREE.CanvasTexture | null = null;

function stoneTex(): THREE.CanvasTexture {
  if (stoneTexCache) return stoneTexCache;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#9da2a8';
  ctx.fillRect(0, 0, S, S);
  // staggered block courses with mortar lines and per-block shading
  const rowH = 16;
  for (let row = 0; row < S / rowH; row++) {
    const off = (row % 2) * 16;
    for (let x = -1; x < S / 32 + 1; x++) {
      const shade = 150 + Math.floor(Math.random() * 40);
      ctx.fillStyle = `rgb(${shade},${shade + 3},${shade + 8})`;
      ctx.fillRect(x * 32 + off + 1, row * rowH + 1, 30, rowH - 2);
    }
  }
  ctx.strokeStyle = 'rgba(60,64,70,0.5)';
  for (let i = 0; i < 60; i++) {  // chips and cracks
    ctx.beginPath();
    const x = Math.random() * S, y = Math.random() * S;
    ctx.moveTo(x, y); ctx.lineTo(x + Math.random() * 6 - 3, y + Math.random() * 6);
    ctx.stroke();
  }
  stoneTexCache = new THREE.CanvasTexture(c);
  stoneTexCache.wrapS = stoneTexCache.wrapT = THREE.RepeatWrapping;
  return stoneTexCache;
}

function woodTex(): THREE.CanvasTexture {
  if (woodTexCache) return woodTexCache;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#9c8054';
  ctx.fillRect(0, 0, S, S);
  // vertical planks with grain streaks
  for (let p = 0; p < 6; p++) {
    const shade = 130 + Math.floor(Math.random() * 35);
    ctx.fillStyle = `rgb(${shade},${Math.floor(shade * 0.78)},${Math.floor(shade * 0.5)})`;
    ctx.fillRect(p * 22 + 1, 0, 20, S);
    ctx.strokeStyle = 'rgba(70,50,28,0.45)';
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      const x = p * 22 + 3 + Math.random() * 16;
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 3, S * 0.3, x - 3, S * 0.6, x + 2, S);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = 'rgba(60,42,24,0.7)';
  for (let p = 0; p <= 6; p++) { ctx.beginPath(); ctx.moveTo(p * 22, 0); ctx.lineTo(p * 22, S); ctx.stroke(); }
  woodTexCache = new THREE.CanvasTexture(c);
  woodTexCache.wrapS = woodTexCache.wrapT = THREE.RepeatWrapping;
  return woodTexCache;
}

const stoneMat = (tint = 0xffffff) => new THREE.MeshLambertMaterial({ map: stoneTex(), color: tint });
const woodMat = (tint = 0xffffff) => new THREE.MeshLambertMaterial({ map: woodTex(), color: tint });

const WOOD = 0x8a6238, WOOD_DARK = 0x5e4023, STONE = 0x8d9299, STONE_DARK = 0x5c6168;
const STEEL = 0xb8c4cf, IRON = 0x6a7078, ROOF = 0xb8512e, GOLD = 0xd9a93f, ICE = 0x7cc7e8;
const ZAP = 0xffe16b, LEAF = 0x3f7a33, TRUNK = 0x6b4a2a, ROCK = 0x7d8087;
const EMBER = 0xff8c3b, CLOTH = 0xd95f18;

function group(...parts: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  for (const p of parts) {
    p.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.add(p);
  }
  return g;
}
function box(w: number, h: number, d: number, color: number, y = h / 2): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.y = y;
  return m;
}
function cyl(rt: number, rb: number, h: number, color: number, y = h / 2, seg = 6): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color));
  m.position.y = y;
  return m;
}
function cone(r: number, h: number, color: number, y: number, seg = 6): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat(color));
  m.position.y = y;
  return m;
}
function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}
/** small triangular banner on a pole */
function banner(h: number, color = CLOTH): THREE.Group {
  const pole = cyl(0.03, 0.03, h, WOOD_DARK);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3), new THREE.MeshLambertMaterial({
    color, side: THREE.DoubleSide,
  }));
  flag.position.set(0.27, h - 0.2, 0);
  const g = new THREE.Group();
  g.add(pole, flag);
  g.userData.flagMesh = flag;
  return g;
}
/** crenellation row along the top edge of a wall section */
function crenels(width: number, y: number, color: number, depth = 0.2): THREE.Group {
  const g = new THREE.Group();
  const n = Math.max(2, Math.round(width / 0.3));
  for (let i = 0; i < n; i += 2) {
    g.add(at(box(width / n, 0.18, depth, color), -width / 2 + (i + 0.5) * (width / n), y, 0));
  }
  return g;
}

/** size = footprint cells; model centered on footprint center, base at y=0. */
export function buildingModel(type: BuildingType, tier: number): THREE.Group {
  const t = tier - 1; // 0-based
  switch (type) {
    case 'wood_wall': {
      const h = 1 + t * 0.3;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.9, h, 0.9), woodMat(t >= 2 ? 0x9a8060 : 0xd0b890));
      wall.position.y = h / 2;
      const g = group(wall);
      // horizontal plank lines from tier 2, iron band at tier 3
      if (t >= 1) {
        g.add(at(box(0.96, 0.08, 0.96, WOOD_DARK), 0, h * 0.35, 0));
        g.add(at(box(0.96, 0.08, 0.96, WOOD_DARK), 0, h * 0.7, 0));
      }
      if (t >= 2) g.add(at(box(0.98, 0.1, 0.98, IRON), 0, h - 0.06, 0));
      return g;
    }
    case 'stone_wall': {
      const h = 1.2 + t * 0.35;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.92, h, 0.92), stoneMat(t >= 2 ? 0x9aa0aa : 0xd8dde4));
      wall.position.y = h / 2;
      const g = group(wall);
      if (t >= 1) g.add(crenels(0.92, h + 0.09, STONE_DARK, 0.92));
      if (t >= 2) g.add(at(box(0.98, 0.12, 0.98, IRON), 0, h * 0.5, 0));
      return g;
    }
    case 'gate': {
      const h = 1.3 + t * 0.3;
      const g = group(
        at(box(0.3, h, 0.9, STONE), -0.32, h / 2, 0),
        at(box(0.3, h, 0.9, STONE), 0.32, h / 2, 0),
        at(box(0.95, 0.25, 0.9, t >= 2 ? IRON : WOOD_DARK), 0, h, 0),
        at(box(0.5, h * 0.75, 0.12, WOOD_DARK), 0, h * 0.37, 0),  // door leaf
      );
      if (t >= 1) g.add(crenels(0.95, h + 0.2, STONE_DARK, 0.9));
      if (t >= 2) g.add(at(banner(h + 0.8), 0.42, 0, 0.42));
      return g;
    }
    case 'spike': {
      const g = new THREE.Group();
      for (let i = 0; i < 4 + t * 2; i++) {
        const s = cone(0.08, 0.5 + t * 0.15, t >= 2 ? STEEL : WOOD_DARK, 0.25 + t * 0.08, 4);
        s.position.x = (Math.random() - 0.5) * 0.6;
        s.position.z = (Math.random() - 0.5) * 0.6;
        s.rotation.z = (Math.random() - 0.5) * 0.4;
        g.add(s);
      }
      return group(box(0.9, 0.1, 0.9, WOOD, 0.05), g);
    }
    case 'archer_tower': {
      const h = 1.6 + t * 0.5;
      const turret = new THREE.Group();
      turret.position.y = h + 0.25;
      // archer figurine + bow crossbar
      turret.add(
        at(box(0.22, 0.4, 0.16, 0x5e7a4a), 0, 0.2, 0),
        at(new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), mat(0xd8b59a)), 0, 0.5, 0),
        at(box(0.04, 0.5, 0.04, TRUNK), 0, 0.3, 0.18),
      );
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, h, 8),
        woodMat(t >= 2 ? 0x9a8060 : 0xd0b890));
      tower.position.y = h / 2;
      const g = group(
        tower,
        at(box(1.3, 0.18, 1.3, WOOD_DARK), 0, h, 0),
        crenels(1.3, h + 0.17, WOOD_DARK, 1.3),
        turret,
        cone(0.5, 0.6, ROOF, h + 1.1, 4),
      );
      if (t >= 1) g.add(at(box(0.08, h * 0.8, 0.08, IRON), 0.62, h * 0.4, 0.62),
                        at(box(0.08, h * 0.8, 0.08, IRON), -0.62, h * 0.4, -0.62));
      if (t >= 2) g.add(at(banner(h + 1.2), -0.6, 0, 0.6));
      g.userData.turret = turret;
      return g;
    }
    case 'crossbow_tower': {
      const h = 1.4 + t * 0.45;
      const turret = new THREE.Group();
      turret.position.y = h + 0.3;
      turret.add(
        at(box(0.9, 0.14, 0.14, STEEL), 0, 0, 0),                   // bow arms
        at(box(0.14, 0.14, 0.8, WOOD_DARK), 0, 0, 0.15),            // stock
        at(box(0.5, 0.1, 0.06, IRON), 0, 0.12, 0.4),                // sight
      );
      const g = group(
        box(1.1, h, 1.1, t >= 2 ? STONE_DARK : WOOD_DARK),
        at(box(1.35, 0.16, 1.35, STONE_DARK), 0, h, 0),
        crenels(1.35, h + 0.16, STONE_DARK, 1.35),
        turret,
      );
      if (t >= 1) g.add(at(box(1.16, 0.12, 1.16, IRON), 0, h * 0.5, 0));
      if (t >= 2) g.add(at(banner(h + 1), 0.62, 0, -0.62));
      g.userData.turret = turret;
      return g;
    }
    case 'bomb_tower': {
      const h = 1.1 + t * 0.35;
      const turret = new THREE.Group();
      turret.position.y = h + 0.35;
      const barrel = cyl(0.16, 0.22, 0.8, IRON, 0, 8);
      barrel.rotation.x = -0.7;
      barrel.position.set(0, 0.15, 0.2);
      turret.add(barrel, new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), mat(0x2b2b30)));
      const g = group(
        cyl(0.75, 0.85, h, STONE),
        at(box(0.9, 0.2, 0.9, STONE_DARK), 0, h, 0),
        turret,
      );
      if (t >= 1) g.add(at(cyl(0.78, 0.78, 0.14, IRON), 0, h * 0.55, 0));
      if (t >= 2) g.add(at(box(0.3, 0.3, 0.3, 0x2b2b30), 0.7, 0.15, 0.5),
                        at(box(0.26, 0.26, 0.26, 0x2b2b30), 0.5, 0.13, 0.75));  // shell pile
      g.userData.turret = turret;
      return g;
    }
    case 'ice_tower': {
      const h = 1.5 + t * 0.45;
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.42 + t * 0.1), mat(ICE, ICE));
      crystal.position.y = h + 0.55;
      const g = group(
        cyl(0.5, 0.7, h, 0x9fb8c8),
        crystal,
      );
      for (let i = 0; i < 3 + t; i++) {
        const shard = cone(0.1, 0.4, ICE, 0.2, 4);
        const a = (i / (3 + t)) * Math.PI * 2;
        shard.position.set(Math.cos(a) * 0.7, 0.2, Math.sin(a) * 0.7);
        shard.rotation.z = (Math.random() - 0.5) * 0.5;
        g.add(shard);
      }
      g.userData.spin = [crystal];
      g.userData.pulse = [crystal];
      return g;
    }
    case 'lightning_tower': {
      const h = 1.8 + t * 0.5;
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.3 + t * 0.07, 8, 6), mat(ZAP, ZAP));
      orb.position.y = h + 0.4;
      const g = group(
        cyl(0.4, 0.65, h, STONE_DARK),
        orb,
        cyl(0.04, 0.04, 0.7, STEEL, h + 0.75),
      );
      // coil rings
      for (let i = 0; i < 2 + t; i++) {
        g.add(at(cyl(0.46 - i * 0.06, 0.46 - i * 0.06, 0.06, IRON), 0, h * 0.35 + i * 0.3, 0));
      }
      g.userData.pulse = [orb];
      return g;
    }
    case 'gold_mine': {
      const g = group(
        box(1.4, 0.8, 1.4, STONE),
        cone(0.9, 0.8, WOOD_DARK, 1.2, 4),
        at(new THREE.Mesh(new THREE.DodecahedronGeometry(0.25), mat(GOLD, GOLD)), 0, 0.95, 0),
        at(box(0.5, 0.6, 0.1, WOOD_DARK), 0, 0.3, 0.71),            // entrance frame
      );
      if (t >= 1) g.add(at(new THREE.Mesh(new THREE.DodecahedronGeometry(0.16), mat(GOLD, GOLD)), 0.55, 0.12, 0.55));
      if (t >= 2) g.add(at(banner(1.6, GOLD), -0.6, 0, -0.6));
      return g;
    }
    case 'wood_camp': {
      const g = group(
        box(1.5, 0.7, 1.2, WOOD),
        cone(1, 0.6, ROOF, 1.3, 4),
        at(cyl(0.14, 0.14, 0.9, TRUNK, 0.45), 0.85, 0, 0),
      );
      // log pile grows with tier
      for (let i = 0; i <= t; i++) {
        const log = cyl(0.1, 0.1, 0.7, TRUNK, 0.1 + Math.floor(i / 2) * 0.18, 6);
        log.rotation.z = Math.PI / 2;
        log.position.set(-0.7, 0.1 + Math.floor(i / 2) * 0.18, 0.6 - (i % 2) * 0.22);
        g.add(log);
      }
      if (t >= 2) g.add(at(box(0.5, 0.06, 0.06, STEEL), 0.85, 0.95, 0)); // axe blade
      return g;
    }
    case 'stone_quarry': {
      const g = group(
        box(1.5, 0.6, 1.5, STONE_DARK),
        at(new THREE.Mesh(new THREE.DodecahedronGeometry(0.4), mat(STONE)), 0, 0.85, 0),
        at(new THREE.Mesh(new THREE.DodecahedronGeometry(0.26), mat(STONE)), 0.5, 0.7, 0.2),
      );
      if (t >= 1) g.add(at(new THREE.Mesh(new THREE.DodecahedronGeometry(0.2), mat(STONE)), -0.5, 0.7, -0.3));
      if (t >= 2) g.add(at(box(0.08, 0.7, 0.08, WOOD_DARK), 0.6, 0.95, -0.5),
                        at(box(0.3, 0.08, 0.08, IRON), 0.6, 1.3, -0.5)); // pickaxe
      return g;
    }
    case 'healing_totem': {
      const h = 1.4 + t * 0.3;
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), mat(0x7fe08a, 0x7fe08a));
      gem.position.y = h + 0.35;
      const g = group(cyl(0.18, 0.26, h, TRUNK), gem);
      // carved rings
      for (let i = 0; i <= t; i++) {
        g.add(at(cyl(0.24, 0.24, 0.06, 0x7fe08a), 0, h * 0.25 + i * 0.35, 0));
      }
      g.userData.spin = [gem];
      g.userData.pulse = [gem];
      return g;
    }
    case 'castle': {
      const lvl = tier; // 1..5
      const h = 2.2 + lvl * 0.5;
      const keep = new THREE.Mesh(new THREE.BoxGeometry(3.4, h, 3.4), stoneMat(0xd2d8e0));
      keep.position.y = h / 2;
      const g = group(
        keep,
        at(box(3.7, 0.3, 3.7, STONE_DARK), 0, h, 0),
        crenels(3.7, h + 0.3, STONE_DARK, 3.7),
        at(box(0.9, 1.3, 0.16, WOOD_DARK), 0, 0.65, 1.72),          // gate door
        at(box(1.1, 0.16, 0.3, IRON), 0, 1.35, 1.72),               // lintel
      );
      const flags: THREE.Mesh[] = [];
      for (const [dx, dz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
        const tw = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, h + 0.8, 8), stoneMat(0xc8cfd8));
        tw.position.set(dx!, (h + 0.8) / 2, dz!);
        const cap = cone(0.55, 0.7, ROOF, h + 1.15, 6);
        cap.position.set(dx!, h + 1.15, dz!);
        g.add(tw, cap);
        if (lvl >= 2) {
          const b = banner(1);
          b.position.set(dx!, h + 1.4, dz!);
          g.add(b);
          flags.push(b.userData.flagMesh as THREE.Mesh);
        }
      }
      // window slits, emissive — lit from within
      for (const dz of [1.71, -1.71]) {
        for (const dx of [-0.9, 0.9]) {
          g.add(at(box(0.16, 0.4, 0.04, 0xffd9a0), dx, h * 0.6, dz));
        }
      }
      if (lvl >= 3) g.add(cone(0.8, 1.2, ROOF, h + 0.9, 6));
      if (lvl >= 4) g.add(at(cyl(0.6, 0.7, h + 1.4, STONE), 0, (h + 1.4) / 2, 0),
                          cone(0.75, 0.9, ROOF, h + 1.85, 6));
      if (lvl >= 5) {
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), mat(GOLD, GOLD));
        orb.position.y = h + 2.6;
        g.add(orb);
        g.userData.pulse = [orb];
      }
      g.userData.flags = flags;
      return g;
    }
  }
}

/** ground ring color per enemy type — instant silhouette readability */
const RING_COLORS: Record<EnemyType, number> = {
  normal: 0x8aa84f, fast: 0xcfe06a, tank: 0x4f6b45,
  spitter: 0x6fd86a, exploding: 0xff7733, butcher: 0xc43a31,
};

export function enemyModel(type: EnemyType): THREE.Group {
  const g = enemyBody(type);
  // type-colored ring under the feet
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.66, 12),
    new THREE.MeshBasicMaterial({
      color: RING_COLORS[type], transparent: true, opacity: 0.45, depthWrite: false,
    }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  ring.scale.setScalar(type === 'butcher' ? 1.8 : type === 'tank' ? 1.3 : 1);
  g.add(ring);
  return g;
}

function enemyBody(type: EnemyType): THREE.Group {
  switch (type) {
    case 'normal': return zombie(0x6f8f57, 0.6);
    case 'fast': return zombie(0x8fae5a, 0.5, { lean: 0.5 });
    case 'tank': return zombie(0x4f6b45, 1.0, { bigArms: true });
    case 'spitter': return zombie(0x7da05f, 0.6, { head: 0x9fce6a, sack: true });
    case 'exploding': return zombie(0xb86f3a, 0.6, { head: 0xe85b2a, glow: true });
    case 'butcher': {
      const g = zombie(0x5d4a4a, 1.7, { bigArms: true });
      const blade = box(0.2, 1.4, 0.5, 0x9aa3ab, 0.2);
      blade.position.x = 0.55;
      // attach cleaver to right arm so attack lunge swings it
      (g.userData.arms as THREE.Mesh[])[1]!.add(blade);
      const hook = box(0.08, 0.5, 0.08, IRON, 0.1);
      hook.position.x = -0.5;
      (g.userData.arms as THREE.Mesh[])[0]!.add(hook);
      // apron
      g.add(at(box(0.5, 0.7, 0.05, 0x7a3328), 0, 0.85, 0.27));
      return g;
    }
  }
}

function zombie(color: number, scale: number,
                opts: { lean?: number; bigArms?: boolean; head?: number;
                        glow?: boolean; sack?: boolean } = {}): THREE.Group {
  const body = box(0.6, 0.9, 0.4, color, 0.75);
  if (opts.lean) body.rotation.x = opts.lean * 0.5;
  const headMat = opts.glow ? mat(opts.head ?? color, opts.head ?? color) : mat(opts.head ?? color);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), headMat);
  head.position.y = 1.42;
  head.rotation.z = 0.12;
  // glowing red eyes — readable even at night
  for (const ex of [-0.1, 0.1]) {
    head.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.02), mat(0xff2a1a, 0xff2a1a)), ex, 0.05, 0.22));
  }

  const legL = box(0.18, 0.55, 0.18, color, -0.26);
  legL.position.set(-0.18, 0.55, 0);
  const legR = box(0.18, 0.55, 0.18, color, -0.26);
  legR.position.set(0.18, 0.55, 0);

  const armW = opts.bigArms ? 0.24 : 0.16;
  const armL = box(armW, 0.6, armW, color, -0.25);
  armL.position.set(-(0.3 + armW / 2), 1.15, 0.1);
  armL.rotation.x = -0.9; // zombie reach
  const armR = box(armW, 0.6, armW, color, -0.25);
  armR.position.set(0.3 + armW / 2, 1.15, 0.1);
  armR.rotation.x = -0.9;

  const parts: THREE.Object3D[] = [body, head, legL, legR, armL, armR];
  if (opts.sack) {
    parts.push(at(new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), mat(0xbfe07a, 0xbfe07a)), 0, 0.85, -0.3));
  }
  const g = group(...parts);
  g.scale.setScalar(scale * 1.2);
  g.userData.legs = [legL, legR];
  g.userData.arms = [armL, armR];
  g.userData.body = body;
  g.userData.head = head;
  return g;
}

export function playerModel(klass: ClassType): THREE.Group {
  const knight = klass === 'knight';
  const armor = knight ? 0x9fb2c8 : 0x5e7a4a;
  const armorDark = knight ? 0x6a7d96 : 0x42583a;
  const trim = knight ? GOLD : 0xb8742a;
  const capeColor = knight ? CLOTH : 0x3a4d30;
  const capeInner = knight ? 0x8a3a18 : 0x2a3a24;

  // --- torso: chest plate over tunic, belt with buckle, shoulder pauldrons ---
  const body = box(0.56, 0.82, 0.4, armor, 0.72);
  body.add(at(box(0.6, 0.34, 0.44, armorDark), 0, 0.05, 0));                  // chest plate band
  body.add(at(box(0.6, 0.08, 0.44, 0x3a3028), 0, -0.26, 0));                  // belt
  body.add(at(box(0.12, 0.12, 0.05, trim), 0, -0.26, 0.22));                  // buckle
  body.add(at(box(0.58, 0.06, 0.42, trim), 0, 0.24, 0));                      // collar trim
  for (const sx of [-0.34, 0.34]) {                                            // pauldrons
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat(armorDark));
    pad.position.set(sx, 0.36, 0);
    body.add(pad);
    body.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), mat(trim)), sx, 0.42, 0));
  }

  // --- head + helmet ---
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), mat(0xd8b59a));
  head.position.y = 1.36;
  let helm: THREE.Mesh;
  if (knight) {
    helm = cyl(0.24, 0.26, 0.34, armor, 1.58, 8);                             // full helm
    helm.add(at(box(0.5, 0.05, 0.05, armorDark), 0, -0.08, 0.18));            // visor slit
    helm.add(at(box(0.06, 0.06, 0.52, trim), 0, 0.2, 0));                     // crest rail
    const plume = cone(0.07, 0.42, 0xc43a31, 0, 5);                           // red plume
    plume.position.set(0, 0.36, -0.12);
    plume.rotation.x = 0.5;
    helm.add(plume);
  } else {
    helm = cone(0.31, 0.42, 0x4a5d3a, 1.62, 6);                               // hood
    helm.add(at(box(0.44, 0.1, 0.44, 0x42583a), 0, -0.18, 0));                // hood rim
    helm.add(at(box(0.1, 0.04, 0.1, trim), 0, 0.18, 0));                      // clasp
  }

  // --- legs with boots ---
  const legL = box(0.17, 0.52, 0.17, 0x4a4038, -0.25);
  legL.position.set(-0.18, 0.52, 0);
  legL.add(at(box(0.19, 0.14, 0.24, 0x32281e), 0, -0.45, 0.03));              // boot
  const legR = box(0.17, 0.52, 0.17, 0x4a4038, -0.25);
  legR.position.set(0.18, 0.52, 0);
  legR.add(at(box(0.19, 0.14, 0.24, 0x32281e), 0, -0.45, 0.03));

  // --- arms with gauntlets ---
  const armL = box(0.15, 0.56, 0.15, armor, -0.23);
  armL.position.set(-0.38, 1.08, 0);
  armL.add(at(box(0.18, 0.16, 0.18, armorDark), 0, -0.42, 0));                // gauntlet
  const armR = box(0.15, 0.56, 0.15, armor, -0.23);
  armR.position.set(0.38, 1.08, 0);
  armR.add(at(box(0.18, 0.16, 0.18, armorDark), 0, -0.42, 0));

  const extras: THREE.Object3D[] = [];
  if (knight) {
    // longsword: tapered blade, glinting edge, crossguard, wrapped grip, pommel
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.95, 0.035), mat(0xd5dde6));
    blade.position.y = -0.85;
    blade.add(at(box(0.03, 0.95, 0.04, 0xf2f6fa), 0, 0, 0));                  // edge highlight
    const tip = cone(0.06, 0.14, 0xd5dde6, -1.38, 4);
    const guard = box(0.3, 0.05, 0.09, trim, -0.42);
    const grip = box(0.06, 0.18, 0.06, 0x3a3028, -0.32);
    const pommel = at(new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), mat(trim)), 0, -0.2, 0);
    armR.add(blade, tip, guard, grip, pommel);
    // heater shield: two-tone field + gold boss + trim
    const shield = box(0.07, 0.62, 0.46, 0x6a7a94, -0.32);
    shield.position.x = -0.1;
    shield.add(at(box(0.08, 0.62, 0.16, 0x2e4a78), 0, 0, 0));                 // center stripe
    shield.add(at(box(0.09, 0.66, 0.5, trim), 0.01, 0, 0));                   // rim (slightly behind)
    shield.children[1]!.scale.set(0.4, 1, 1);
    shield.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), mat(trim)), -0.06, 0, 0));
    armL.add(shield);
  } else {
    // recurve bow with grip wrap + nocked arrow
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.035, 6, 12, Math.PI), mat(TRUNK));
    bow.rotation.z = Math.PI / 2;
    bow.position.y = -0.38;
    bow.add(at(box(0.06, 0.14, 0.06, 0x3a3028), 0.42, 0, 0));                 // grip wrap (at arc center)
    const string = box(0.015, 0.82, 0.015, 0xd8d0c0, -0.38);
    const arrow = box(0.025, 0.025, 0.5, 0x8a6238, -0.38);
    arrow.position.z = 0.12;
    arrow.add(at(cone(0.03, 0.08, 0x9aa3ab, 0, 4), 0, 0, 0.28));
    arrow.children[0]!.rotation.x = Math.PI / 2;
    armR.add(bow, string, arrow);
    // quiver with fletched arrows
    const quiver = cyl(0.09, 0.1, 0.48, 0x7a3328, 0);
    quiver.position.set(0.14, 0.98, -0.28);
    quiver.rotation.z = 0.3;
    quiver.add(at(box(0.04, 0.06, 0.04, trim), 0, 0.1, 0));                   // strap stud
    extras.push(quiver);
    for (const [fx, fy] of [[0.18, 1.26], [0.24, 1.22]] as const) {
      extras.push(at(box(0.05, 0.12, 0.05, 0xd8d0c0), fx, fy, -0.3));
    }
  }

  // --- double-layer cape: outer cloth + inner lining, tapered by scale ---
  const capeOuter = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.88),
    new THREE.MeshLambertMaterial({ color: capeColor, side: THREE.DoubleSide }));
  capeOuter.position.set(0, 0.82, -0.24);
  capeOuter.rotation.x = 0.15;
  capeOuter.scale.set(1, 1, 1);
  const capeInnerMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.78),
    new THREE.MeshLambertMaterial({ color: capeInner, side: THREE.DoubleSide }));
  capeInnerMesh.position.set(0, 0.8, -0.21);
  capeInnerMesh.rotation.x = 0.13;
  // shoulder clasps holding the cape
  const claspL = at(new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), mat(trim, trim)), -0.22, 1.12, -0.16);
  const claspR = at(new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), mat(trim, trim)), 0.22, 1.12, -0.16);

  const g = group(body, head, helm, legL, legR, armL, armR,
                  capeOuter, capeInnerMesh, claspL, claspR, ...extras);
  g.userData.legs = [legL, legR];
  g.userData.arms = [armL, armR];
  g.userData.body = body;
  g.userData.head = head;
  g.userData.flags = [capeOuter, capeInnerMesh];
  return g;
}

/**
 * Three tree species with per-instance hue jitter so forests read as organic.
 * variant: 0 = pine, 1 = oak (blobby crown), 2 = tall fir.
 */
export function treeModel(variant = 0, jitter = 0): THREE.Group {
  const leafColor = new THREE.Color(LEAF).offsetHSL(jitter * 0.06 - 0.03, jitter * 0.15 - 0.05, jitter * 0.1 - 0.05).getHex();
  const leafColor2 = new THREE.Color(0x4a8a3d).offsetHSL(jitter * 0.05 - 0.025, 0, jitter * 0.08 - 0.04).getHex();
  let sway: THREE.Object3D[];
  let g: THREE.Group;
  if (variant === 1) {
    // oak: bent thick trunk, root flare, cloud of squashed leaf blobs
    const trunk = cyl(0.14, 0.22, 1.1, TRUNK);
    trunk.rotation.z = (jitter - 0.5) * 0.18;
    const blobs: THREE.Mesh[] = [];
    const blobDefs: [number, number, number, number, number][] = [
      [0.62, 0, 1.5, 0, 0],         [0.46, 0.42, 1.28, 0.18, 1],
      [0.42, -0.38, 1.32, -0.12, 0], [0.36, 0.1, 1.78, -0.2, 1],
      [0.3, -0.15, 1.05, 0.3, 0],
    ];
    for (const [r, x, y, z, alt] of blobDefs) {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat(alt ? leafColor2 : leafColor));
      b.position.set(x, y, z);
      b.scale.y = 0.8;
      b.rotation.set(jitter * 2, jitter * 4, jitter);
      blobs.push(b);
    }
    g = group(trunk, ...blobs);
    sway = blobs;
  } else if (variant === 2) {
    // tall fir: four stacked slim cones, drooping tips
    const c1 = cone(0.55, 0.85, leafColor, 1.0, 7);
    const c2 = cone(0.44, 0.8, leafColor2, 1.55, 7);
    const c3 = cone(0.32, 0.7, leafColor, 2.05, 7);
    const c4 = cone(0.2, 0.55, leafColor2, 2.5, 7);
    g = group(cyl(0.09, 0.17, 0.9, TRUNK), c1, c2, c3, c4);
    sway = [c1, c2, c3, c4];
  } else {
    // pine: classic double cone, slight asymmetry
    const crown1 = cone(0.58, 1.15, leafColor, 1.2, 7);
    crown1.rotation.y = jitter * 3;
    const crown2 = cone(0.42, 0.85, leafColor2, 1.75, 7);
    crown2.position.x = (jitter - 0.5) * 0.12;
    g = group(cyl(0.12, 0.2, 0.75, TRUNK), crown1, crown2);
    sway = [crown1, crown2];
  }
  // root flare: three small wedges at the base
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + jitter * 2;
    const root = cone(0.09, 0.22, TRUNK, 0.1, 4);
    root.position.set(Math.cos(a) * 0.16, 0.08, Math.sin(a) * 0.16);
    root.rotation.z = Math.cos(a) * 0.5;
    root.rotation.x = -Math.sin(a) * 0.5;
    g.add(root);
  }
  g.userData.sway = sway;
  return g;
}
export function rockModel(): THREE.Group {
  // boulder cluster: one big + two satellites + mossy cap
  const main = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45), mat(ROCK));
  main.position.y = 0.32;
  main.rotation.set(0.3, 0.8, 0.1);
  const s1 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.24), mat(0x6e7178));
  s1.position.set(0.42, 0.16, 0.18);
  s1.rotation.y = 1.4;
  const s2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.18), mat(0x8a8d94));
  s2.position.set(-0.35, 0.12, -0.22);
  const moss = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), mat(0x4a6b35));
  moss.position.set(-0.05, 0.62, -0.05);
  moss.scale.set(1, 0.35, 1);
  return group(main, s1, s2, moss);
}
