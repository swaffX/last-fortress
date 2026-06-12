import * as THREE from 'three';
import type { BuildingType, EnemyType, ClassType } from '@lf/shared';

/**
 * Procedural low-poly models. Each building type/tier gets a distinct silhouette;
 * higher tiers grow taller and gain trim. All geometry built from primitives —
 * no external assets.
 */

const mat = (color: number, emissive = 0) =>
  new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity: emissive ? 0.7 : 0 });

const WOOD = 0x8a6238, WOOD_DARK = 0x5e4023, STONE = 0x8d9299, STONE_DARK = 0x5c6168;
const STEEL = 0xb8c4cf, ROOF = 0xb8512e, GOLD = 0xd9a93f, ICE = 0x7cc7e8;
const ZAP = 0xffe16b, LEAF = 0x3f7a33, TRUNK = 0x6b4a2a, ROCK = 0x7d8087;

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

/** size = footprint cells; model centered on footprint center, base at y=0. */
export function buildingModel(type: BuildingType, tier: number): THREE.Group {
  const t = tier - 1; // 0-based
  switch (type) {
    case 'wood_wall':
      return group(box(0.9, 1 + t * 0.3, 0.9, t >= 2 ? WOOD_DARK : WOOD));
    case 'stone_wall':
      return group(box(0.92, 1.2 + t * 0.35, 0.92, t >= 2 ? STONE_DARK : STONE));
    case 'gate': {
      const h = 1.3 + t * 0.3;
      return group(
        box(0.3, h, 0.9, STONE, h / 2).translateX(-0.32),
        box(0.3, h, 0.9, STONE, h / 2).translateX(0.32),
        box(0.95, 0.25, 0.9, WOOD_DARK, h),
      );
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
    case 'archer_tower':
      return group(
        cyl(0.55, 0.7, 1.6 + t * 0.5, WOOD),
        box(1.3, 0.18, 1.3, WOOD_DARK, 1.65 + t * 0.5),
        cone(0.55, 0.7, ROOF, 2.1 + t * 0.5, 4),
      );
    case 'crossbow_tower':
      return group(
        box(1.1, 1.4 + t * 0.45, 1.1, WOOD_DARK),
        box(1.35, 0.16, 1.35, STONE_DARK, 1.45 + t * 0.45),
        box(0.9, 0.18, 0.18, STEEL, 1.7 + t * 0.45),
        box(0.18, 0.18, 0.9, STEEL, 1.7 + t * 0.45),
      );
    case 'bomb_tower':
      return group(
        cyl(0.75, 0.85, 1.1 + t * 0.35, STONE),
        cyl(0.45, 0.45, 0.5, STONE_DARK, 1.35 + t * 0.35),
        new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), mat(0x2b2b30)).translateY(1.75 + t * 0.35),
      );
    case 'ice_tower':
      return group(
        cyl(0.5, 0.7, 1.5 + t * 0.45, 0x9fb8c8),
        new THREE.Mesh(new THREE.OctahedronGeometry(0.45 + t * 0.1), mat(ICE, ICE)).translateY(2 + t * 0.5),
      );
    case 'lightning_tower':
      return group(
        cyl(0.4, 0.65, 1.8 + t * 0.5, STONE_DARK),
        new THREE.Mesh(new THREE.SphereGeometry(0.3 + t * 0.07, 8, 6), mat(ZAP, ZAP)).translateY(2.15 + t * 0.55),
        cyl(0.04, 0.04, 0.7, STEEL, 2.5 + t * 0.55),
      );
    case 'gold_mine':
      return group(
        box(1.4, 0.8, 1.4, STONE),
        cone(0.9, 0.8, WOOD_DARK, 1.2, 4),
        new THREE.Mesh(new THREE.DodecahedronGeometry(0.25), mat(GOLD, GOLD)).translateY(0.95),
      );
    case 'wood_camp':
      return group(
        box(1.5, 0.7, 1.2, WOOD),
        cone(1, 0.6, ROOF, 1.3, 4),
        cyl(0.14, 0.14, 0.9, TRUNK, 0.45).translateX(0.85),
      );
    case 'stone_quarry':
      return group(
        box(1.5, 0.6, 1.5, STONE_DARK),
        new THREE.Mesh(new THREE.DodecahedronGeometry(0.4), mat(STONE)).translateY(0.85),
        new THREE.Mesh(new THREE.DodecahedronGeometry(0.26), mat(STONE)).translateY(0.7).translateX(0.5),
      );
    case 'healing_totem':
      return group(
        cyl(0.18, 0.26, 1.4 + t * 0.3, TRUNK),
        new THREE.Mesh(new THREE.OctahedronGeometry(0.3), mat(0x7fe08a, 0x7fe08a)).translateY(1.75 + t * 0.3),
      );
    case 'castle': {
      const lvl = tier; // 1..5
      const h = 2.2 + lvl * 0.5;
      const g = group(
        box(3.4, h, 3.4, STONE),
        box(3.7, 0.3, 3.7, STONE_DARK, h),
      );
      // corner turrets
      for (const [dx, dz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
        const tw = cyl(0.45, 0.55, h + 0.8, STONE);
        tw.position.set(dx!, (h + 0.8) / 2, dz!);
        const cap = cone(0.55, 0.7, ROOF, h + 1.15, 6);
        cap.position.set(dx!, h + 1.15, dz!);
        g.add(tw, cap);
      }
      if (lvl >= 3) g.add(cone(0.8, 1.2, ROOF, h + 0.9, 6));
      if (lvl >= 5) {
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), mat(GOLD, GOLD));
        orb.position.y = h + 1.8;
        g.add(orb);
      }
      return g;
    }
  }
}

export function enemyModel(type: EnemyType): THREE.Group {
  switch (type) {
    case 'normal': return zombie(0x6f8f57, 0.5);
    case 'fast': return zombie(0x8fae5a, 0.4, { lean: 0.5 });
    case 'tank': return zombie(0x4f6b45, 0.85, { arms: true });
    case 'spitter': return zombie(0x7da05f, 0.5, { head: 0x9fce6a });
    case 'exploding': return zombie(0xb86f3a, 0.5, { head: 0xe85b2a, glow: true });
    case 'butcher': {
      const g = zombie(0x5d4a4a, 1.5, { arms: true });
      const blade = box(0.2, 1.4, 0.5, 0x9aa3ab, 1);
      blade.position.x = 1.2;
      g.add(blade);
      return g;
    }
  }
}

function zombie(color: number, scale: number,
                opts: { lean?: number; arms?: boolean; head?: number; glow?: boolean } = {}): THREE.Group {
  const body = box(0.6, 0.9, 0.4, color, 0.75);
  if (opts.lean) body.rotation.x = opts.lean * 0.5;
  const headMat = opts.glow ? mat(opts.head ?? color, opts.head ?? color) : mat(opts.head ?? color);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), headMat);
  head.position.y = 1.42;
  head.rotation.z = 0.12;
  const parts: THREE.Object3D[] = [body, head,
    box(0.18, 0.55, 0.18, color, 0.28).translateX(-0.18),
    box(0.18, 0.55, 0.18, color, 0.28).translateX(0.18)];
  if (opts.arms) {
    parts.push(
      box(0.2, 0.7, 0.2, color, 0.85).translateX(-0.45),
      box(0.2, 0.7, 0.2, color, 0.85).translateX(0.45));
  }
  const g = group(...parts);
  g.scale.setScalar(scale * 1.2);
  return g;
}

export function playerModel(klass: ClassType): THREE.Group {
  const armor = klass === 'knight' ? 0x9fb2c8 : 0x5e7a4a;
  const trim = klass === 'knight' ? 0xd9a93f : 0x8a5a2a;
  const g = group(
    box(0.55, 0.8, 0.38, armor, 0.7),
    new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), mat(0xd8b59a)).translateY(1.32),
    klass === 'knight'
      ? cone(0.26, 0.3, trim, 1.65, 4)
      : cone(0.3, 0.35, 0x4a5d3a, 1.62, 6),
    box(0.16, 0.5, 0.16, 0x4a4038, 0.25).translateX(-0.18),
    box(0.16, 0.5, 0.16, 0x4a4038, 0.25).translateX(0.18),
    // weapon
    klass === 'knight'
      ? box(0.08, 0.9, 0.08, 0xc9d2da, 0.95).translateX(0.42)
      : box(0.06, 0.8, 0.06, TRUNK, 0.9).translateX(0.42),
  );
  return g;
}

export function treeModel(): THREE.Group {
  return group(
    cyl(0.12, 0.18, 0.7, TRUNK),
    cone(0.55, 1.1, LEAF, 1.2, 6),
    cone(0.4, 0.8, 0x4a8a3d, 1.7, 6),
  );
}
export function rockModel(): THREE.Group {
  const g = group(new THREE.Mesh(new THREE.DodecahedronGeometry(0.45), mat(ROCK)));
  g.children[0]!.position.y = 0.35;
  return g;
}
