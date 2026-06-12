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
      const g = group(box(0.9, h, 0.9, t >= 2 ? WOOD_DARK : WOOD));
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
      const g = group(box(0.92, h, 0.92, t >= 2 ? STONE_DARK : STONE));
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
      const g = group(
        cyl(0.55, 0.7, h, t >= 2 ? WOOD_DARK : WOOD),
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
      const g = group(
        box(3.4, h, 3.4, STONE),
        at(box(3.7, 0.3, 3.7, STONE_DARK), 0, h, 0),
        crenels(3.7, h + 0.3, STONE_DARK, 3.7),
        at(box(0.9, 1.3, 0.16, WOOD_DARK), 0, 0.65, 1.72),          // gate door
        at(box(1.1, 0.16, 0.3, IRON), 0, 1.35, 1.72),               // lintel
      );
      const flags: THREE.Mesh[] = [];
      for (const [dx, dz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
        const tw = cyl(0.45, 0.55, h + 0.8, STONE);
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
  const armor = klass === 'knight' ? 0x9fb2c8 : 0x5e7a4a;
  const trim = klass === 'knight' ? GOLD : 0x8a5a2a;

  const body = box(0.55, 0.8, 0.38, armor, 0.7);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), mat(0xd8b59a));
  head.position.y = 1.32;
  const helm = klass === 'knight'
    ? cone(0.26, 0.3, trim, 1.62, 4)
    : cone(0.3, 0.35, 0x4a5d3a, 1.6, 6);

  const legL = box(0.16, 0.5, 0.16, 0x4a4038, -0.24);
  legL.position.set(-0.18, 0.5, 0);
  const legR = box(0.16, 0.5, 0.16, 0x4a4038, -0.24);
  legR.position.set(0.18, 0.5, 0);

  const armL = box(0.14, 0.55, 0.14, armor, -0.22);
  armL.position.set(-0.36, 1.05, 0);
  const armR = box(0.14, 0.55, 0.14, armor, -0.22);
  armR.position.set(0.36, 1.05, 0);

  // weapons attach to the right arm so swings animate them
  if (klass === 'knight') {
    const blade = box(0.07, 0.85, 0.07, 0xc9d2da, -0.75);
    const guard = box(0.22, 0.05, 0.08, trim, -0.4);
    armR.add(blade, guard);
    // shield on left arm
    const shield = box(0.06, 0.5, 0.38, 0x6a7a94, -0.3);
    shield.position.x = -0.08;
    const boss = at(new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), mat(trim)), -0.12, -0.3, 0);
    armL.add(shield, boss);
  } else {
    // bow: curved arc from torus segment + string
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.035, 6, 10, Math.PI), mat(TRUNK));
    bow.rotation.z = Math.PI / 2;
    bow.position.y = -0.35;
    const string = box(0.015, 0.78, 0.015, 0xd8d0c0, -0.35);
    armR.add(bow, string);
    // quiver on back
    const quiver = cyl(0.09, 0.09, 0.45, 0x7a3328, 0);
    quiver.position.set(0.12, 0.95, -0.26);
    quiver.rotation.z = 0.3;
    const fletch = at(box(0.06, 0.12, 0.06, 0xd8d0c0), 0.2, 1.2, -0.28);
    return finishPlayer(body, head, helm, legL, legR, armL, armR, quiver, fletch, klass);
  }
  return finishPlayer(body, head, helm, legL, legR, armL, armR, null, null, klass);
}

function finishPlayer(body: THREE.Mesh, head: THREE.Mesh, helm: THREE.Mesh,
                      legL: THREE.Mesh, legR: THREE.Mesh, armL: THREE.Mesh, armR: THREE.Mesh,
                      extra1: THREE.Object3D | null, extra2: THREE.Object3D | null,
                      klass: ClassType): THREE.Group {
  // cape
  const cape = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.75),
    new THREE.MeshLambertMaterial({ color: klass === 'knight' ? CLOTH : 0x3a4d30, side: THREE.DoubleSide }));
  cape.position.set(0, 0.85, -0.22);
  cape.rotation.x = 0.15;
  const parts: THREE.Object3D[] = [body, head, helm, legL, legR, armL, armR, cape];
  if (extra1) parts.push(extra1);
  if (extra2) parts.push(extra2);
  const g = group(...parts);
  g.userData.legs = [legL, legR];
  g.userData.arms = [armL, armR];
  g.userData.body = body;
  g.userData.head = head;
  g.userData.flags = [cape];
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
    // oak: thick trunk, 3 overlapping leaf blobs
    const b1 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 0), mat(leafColor));
    b1.position.set(0, 1.35, 0);
    const b2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0), mat(leafColor2));
    b2.position.set(0.4, 1.15, 0.15);
    const b3 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 0), mat(leafColor));
    b3.position.set(-0.35, 1.2, -0.1);
    g = group(cyl(0.16, 0.24, 1, TRUNK), b1, b2, b3);
    sway = [b1, b2, b3];
  } else if (variant === 2) {
    // tall fir: three stacked slim cones
    const c1 = cone(0.5, 0.9, leafColor, 1.1, 7);
    const c2 = cone(0.38, 0.8, leafColor2, 1.7, 7);
    const c3 = cone(0.25, 0.7, leafColor, 2.25, 7);
    g = group(cyl(0.1, 0.16, 0.8, TRUNK), c1, c2, c3);
    sway = [c1, c2, c3];
  } else {
    const crown1 = cone(0.55, 1.1, leafColor, 1.2, 6);
    const crown2 = cone(0.4, 0.8, leafColor2, 1.7, 6);
    g = group(cyl(0.12, 0.18, 0.7, TRUNK), crown1, crown2);
    sway = [crown1, crown2];
  }
  g.userData.sway = sway;
  return g;
}
export function rockModel(): THREE.Group {
  const g = group(new THREE.Mesh(new THREE.DodecahedronGeometry(0.45), mat(ROCK)));
  g.children[0]!.position.y = 0.35;
  return g;
}
