import * as THREE from 'three';
import type { BuildingType } from '@lf/shared';
import { assetInstance } from './assets';
import { CREATURE_BLUEPRINTS, type CreatureBlueprint } from './creature-blueprints';

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
    case 'crafting_table': {
      const top = box(0.92, 0.18, 0.92, WOOD, 0.78);
      const legs = new THREE.Group();
      for (const [x, z] of [[-0.36, -0.36], [0.36, -0.36], [-0.36, 0.36], [0.36, 0.36]] as const)
        legs.add(at(box(0.1, 0.7, 0.1, WOOD_DARK, 0.35), x, 0, z));
      const g = group(top, legs);
      g.add(at(box(0.3, 0.06, 0.18, IRON, 0.9), 0.1, 0, 0.1));   // a saw on the bench
      return g;
    }
  }
}


export function playerModel(): THREE.Group {
  const knight = false;   // classless survivor — ranger silhouette
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
  const weaponParts: THREE.Object3D[] = [];
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
    weaponParts.push(blade, tip, guard, grip, pommel);
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
    weaponParts.push(bow, string, arrow);
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
  g.userData.weaponParts = weaponParts;   // hidden while a tool is in hand
  return g;
}

/** Hand tools shown while gathering — attached to the right arm. */
export function toolModel(kind: 'axe' | 'pick'): THREE.Group {
  const g = new THREE.Group();
  const handle = box(0.06, 0.7, 0.06, TRUNK, -0.5);
  g.add(handle);
  if (kind === 'axe') {
    const headBlock = box(0.08, 0.16, 0.3, IRON, -0.82);
    headBlock.position.z = 0.1;
    const edge = box(0.06, 0.18, 0.06, 0xd5dde6, -0.82);
    edge.position.z = 0.27;
    g.add(headBlock, edge);
  } else {
    const headBar = box(0.07, 0.09, 0.55, IRON, -0.82);
    const tipF = cone(0.05, 0.14, 0x9aa3ab, -0.82, 4);
    tipF.rotation.x = Math.PI / 2;
    tipF.position.z = 0.33;
    const tipB = cone(0.05, 0.14, 0x9aa3ab, -0.82, 4);
    tipB.rotation.x = -Math.PI / 2;
    tipB.position.z = -0.33;
    g.add(headBar, tipF, tipB);
  }
  g.traverse(o => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  return g;
}

/**
 * Three tree species with per-instance hue jitter so forests read as organic.
 * variant: 0 = pine, 1 = oak (blobby crown), 2 = tall fir.
 */
export function treeModel(variant = 0, jitter = 0): THREE.Group {
  const asset = assetInstance('tree');
  if (asset) { asset.rotation.y = jitter * 6.28; return asset; }
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

/** Berry bush — leafy mound with red berries. */
export function bushModel(): THREE.Group {
  const blobs: THREE.Mesh[] = [];
  for (const [x, y, z, r] of [[0, 0.3, 0, 0.34], [0.28, 0.24, 0.1, 0.24],
                              [-0.24, 0.22, -0.12, 0.22], [0.05, 0.46, -0.05, 0.22]] as const) {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat(0x3b6b30));
    b.position.set(x, y, z); b.scale.y = 0.8;
    blobs.push(b);
  }
  const g = group(...blobs);
  for (let i = 0; i < 7; i++) {
    const berry = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 4), mat(0xc23a4a));
    berry.position.set((Math.random() - 0.5) * 0.6, 0.2 + Math.random() * 0.35, (Math.random() - 0.5) * 0.6);
    g.add(berry);
  }
  g.userData.sway = blobs;
  return g;
}

const ITEM_COLOR: Record<string, number> = {
  wood: 0x9c6b35, stone: 0x8d9299, berry: 0xc23a4a, stick: 0xb08a55,
  crafting_table: 0x7a5230, wood_axe: 0x9c6b35, stone_axe: 0x8d9299,
  wood_pick: 0x9c6b35, stone_pick: 0x8d9299, wood_sword: 0xb08a55,
  stone_sword: 0x9aa3ab, wood_spear: 0xb08a55,
  raw_meat: 0xb5564a, leather: 0x8a5a32, wool: 0xe8e2d4, silk: 0xd8e0e8,
  pelt: 0x6a5a48, feather: 0xe0d8c8, hide: 0x9a7048, bone: 0xe8e2cc, venom: 0x7ed040,
  katana: 0xcfd6de, war_spear: 0x9aa3ab, mage_staff: 0xb060ff,
};

// ---- creatures ----
const FACTION_RING: Record<string, number> = {
  animal: 0x8aa84f, bandit: 0xe08a3a, zombie: 0x6f8f57, boss: 0xc43a31,
};

function spiderModel(col: number): THREE.Group {
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), mat(col));
  body.position.y = 0.4; body.scale.y = 0.7;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 7, 5), mat(col));
  head.position.set(0, 0.4, 0.4);
  const legs: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const side = i < 4 ? -1 : 1;
    const k = i % 4;
    const len = 0.5;
    const geo = new THREE.BoxGeometry(len, 0.06, 0.06);
    geo.translate(side * len / 2, 0, 0);            // extend outward (±X) from the hip
    const leg = new THREE.Mesh(geo, mat(col));
    leg.position.set(side * 0.16, 0.4, (k - 1.5) * 0.18);   // hip at body side, spread front/back
    leg.rotation.z = side * -0.4;                   // outer end dips toward the ground
    leg.userData.baseRz = side * -0.4;
    legs.push(leg);
  }
  for (const ex of [-0.08, 0.08]) head.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.04, 4, 3), mat(0xff3322, 0xff3322)), ex, 0.05, 0.18));
  const g = group(body, head, ...legs);
  g.userData.legs = legs.slice(0, 4); g.userData.body = body;
  g.userData.rig = { legs: legs.slice(0, 8), body, head };
  g.userData.gait = 'skitter';
  g.userData.anim = { bob: 0.02, headBob: 0, tailSway: 0, cadence: 18 };
  return g;
}

function snakeModel(col: number): THREE.Group {
  const segs: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const seg = new THREE.Mesh(new THREE.SphereGeometry(0.18 - i * 0.02, 7, 5), mat(col));
    seg.position.set(0, 0.18, -i * 0.28);
    segs.push(seg);
  }
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 7, 5), mat(col));
  head.position.set(0, 0.2, 0.3); head.scale.z = 1.3;
  const g = group(head, ...segs);
  g.userData.body = head; g.userData.legs = [];
  g.userData.rig = { legs: [], body: head, head, segments: segs };
  g.userData.gait = 'slither';
  g.userData.anim = { bob: 0, headBob: 0, tailSway: 0, cadence: 6 };
  return g;
}

function humanoidTinted(armor: number, weapon: 'sword' | 'staff' | 'spear' | 'none'): THREE.Group {
  const g = playerModel();
  // retint body/head-ish parts
  const body = g.userData.body as THREE.Mesh | undefined;
  if (body) (body.material as THREE.MeshLambertMaterial).color.setHex(armor);
  const arms = g.userData.arms as THREE.Mesh[] | undefined;
  if (arms && weapon !== 'none') {
    const w = weapon === 'staff' ? box(0.06, 1.1, 0.06, 0x6a4a2a, -0.5)
      : weapon === 'spear' ? box(0.05, 1.3, 0.05, 0x8a6238, -0.6)
      : box(0.08, 0.7, 0.05, 0xcfd6de, -0.35);
    arms[1]!.add(w);
    if (weapon === 'staff') w.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), mat(0xb060ff, 0xb060ff)), 0, -1.05, 0));
  }
  return g;
}

function zombieModel(col: number, scale: number): THREE.Group {
  const body = box(0.56, 0.82, 0.4, col, 0.72);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), mat(0x9fce6a));
  head.position.y = 1.36;
  for (const ex of [-0.1, 0.1]) head.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.02), mat(0xff2a1a, 0xff2a1a)), ex, 0.05, 0.22));
  const legL = box(0.18, 0.55, 0.18, col, -0.26); legL.position.set(-0.16, 0.55, 0);
  const legR = box(0.18, 0.55, 0.18, col, -0.26); legR.position.set(0.16, 0.55, 0);
  const armL = box(0.16, 0.6, 0.16, col, -0.25); armL.position.set(-0.42, 1.15, 0.1); armL.rotation.x = -1.2;
  const armR = box(0.16, 0.6, 0.16, col, -0.25); armR.position.set(0.42, 1.15, 0.1); armR.rotation.x = -1.2;
  const g = group(body, head, legL, legR, armL, armR);
  g.scale.setScalar(scale);
  g.userData.legs = [legL, legR]; g.userData.arms = [armL, armR]; g.userData.body = body; g.userData.head = head;
  return g;
}

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
  g.userData.rig = { legs, body, head, tail };
  g.userData.gait = spec.gait;
  g.userData.anim = spec.anim;
  // back-compat keys still read by older code paths
  g.userData.legs = legs; g.userData.body = body; g.userData.head = head;
  return g;
}

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

export function projectileModel(kind: 'spit' | 'bolt'): THREE.Group {
  if (kind === 'spit') {
    const blob = new THREE.Mesh(new THREE.SphereGeometry(0.16, 7, 5), mat(0x8fdc4a, 0x8fdc4a));
    blob.scale.z = 1.4;
    return group(blob);
  }
  const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), mat(0xb060ff, 0xb060ff));
  shard.scale.z = 1.6;
  return group(shard);
}

/** Ground ring color per faction (drawn by world.ts under creatures). */
export function factionRingColor(faction: string): number { return FACTION_RING[faction] ?? 0x888888; }

/** Small bobbing pickup on the ground. */
export function itemModel(item: string): THREE.Group {
  const color = ITEM_COLOR[item] ?? 0xcccccc;
  let mesh: THREE.Mesh;
  if (item === 'berry') mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 7, 6), mat(color, color));
  else if (item === 'stone') mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.18), mat(color));
  else if (item === 'crafting_table') mesh = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.32), mat(color));
  else if (item.endsWith('_sword') || item === 'wood_spear') mesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.06), mat(color));
  else if (item.includes('axe') || item.includes('pick')) mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.06), mat(color));
  else mesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.18), mat(color));
  mesh.position.y = 0.3;
  const g = group(mesh);
  g.userData.bob = mesh;
  return g;
}
