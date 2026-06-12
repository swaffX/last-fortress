import * as THREE from 'three';
import { Rng, MAP_SIZE, CASTLE_POS } from '@lf/shared';
import type { NodeView } from '../net';

/**
 * Visual-only map decorations, generated deterministically from the game seed
 * so every player sees the same world. Nothing here touches gameplay.
 *
 * Layers: abandoned houses, ruined village stubs, cemetery, ruined watchtowers,
 * swamp patches, drifting fog, instanced grass/flowers, torch posts near castle.
 */

const mat = (color: number, emissive = 0) =>
  new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity: emissive ? 0.8 : 0 });

/** Streaky tileable water texture: deep blue base, lighter flow lines, sparkle dots. */
function makeWaterTexture(): THREE.CanvasTexture {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0, '#27506e');
  grad.addColorStop(0.5, '#1e425e');
  grad.addColorStop(1, '#27506e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  // horizontal flow streaks (x-tileable: draw twice, offset by S)
  for (let i = 0; i < 26; i++) {
    const y = Math.random() * S, x = Math.random() * S;
    const w = 18 + Math.random() * 34, a = 0.1 + Math.random() * 0.18;
    ctx.strokeStyle = `rgba(140,190,220,${a})`;
    ctx.lineWidth = 1 + Math.random() * 1.4;
    for (const ox of [0, -S, S]) {
      ctx.beginPath();
      ctx.moveTo(x + ox, y);
      ctx.quadraticCurveTo(x + ox + w / 2, y - 2 + Math.random() * 4, x + ox + w, y);
      ctx.stroke();
    }
  }
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(190,225,245,${0.15 + Math.random() * 0.25})`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 1.5, 1);
  }
  return new THREE.CanvasTexture(canvas);
}

const STONE = 0x8d9299, STONE_DARK = 0x5c6168, WOOD_DARK = 0x5e4023;
const RUIN = 0x6e6f6a, GRAVE = 0x9a9d9f, DEADWOOD = 0x4a3b2c, SWAMP = 0x2c3d2a;

const CX = CASTLE_POS.x + 2, CY = CASTLE_POS.y + 2;

export class Environment {
  private root = new THREE.Group();
  private fogPlanes: THREE.Mesh[] = [];
  private flames: THREE.Mesh[] = [];
  private smoke: THREE.Mesh[] = [];
  private lights: { light: THREE.PointLight; base: number; phase: number }[] = [];
  private waterTex: THREE.CanvasTexture | null = null;
  private time = 0;
  private occupied: { x: number; y: number; r: number }[] = [];

  constructor(private scene: THREE.Scene, seed: number, nodes: NodeView[]) {
    const rng = new Rng((seed ^ 0xdec0de) >>> 0);
    for (const n of nodes) this.occupied.push({ x: n.pos.x, y: n.pos.y, r: 1.5 });

    this.groundPatches(rng);
    this.river(rng);
    this.paths(rng);
    this.campfire();
    this.houses(rng);
    this.ruinedVillage(rng);
    this.cemetery(rng);
    this.watchtowers(rng);
    this.swamps(rng);
    this.fog(rng);
    this.grassAndFlowers(rng);
    this.bushesAndProps(rng);
    this.torchPosts();

    this.root.traverse(o => {
      if (o instanceof THREE.Mesh && !(o.material as THREE.Material).transparent) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    scene.add(this.root);
  }

  dispose(): void { this.scene.remove(this.root); }

  /** Find a free spot in a radius band around the castle; marks it occupied. */
  private spot(rng: Rng, minR: number, maxR: number, clearance: number): { x: number; y: number } | null {
    for (let i = 0; i < 40; i++) {
      const a = rng.next() * Math.PI * 2;
      const r = minR + rng.next() * (maxR - minR);
      const x = CX + Math.cos(a) * r, y = CY + Math.sin(a) * r;
      if (x < 6 || y < 6 || x > MAP_SIZE - 6 || y > MAP_SIZE - 6) continue;
      if (this.occupied.some(o => Math.hypot(o.x - x, o.y - y) < o.r + clearance)) continue;
      this.occupied.push({ x, y, r: clearance });
      return { x, y };
    }
    return null;
  }

  private place(g: THREE.Group, x: number, y: number, rotY: number): void {
    g.position.set(x, 0, y);
    g.rotation.y = rotY;
    this.root.add(g);
  }

  // ---- winding river with banks and two wooden bridges (visual only) ----
  private river(rng: Rng): void {
    // animated water texture shared by all segments
    this.waterTex = makeWaterTexture();
    this.waterTex.wrapS = this.waterTex.wrapT = THREE.RepeatWrapping;
    const waterMat = new THREE.MeshLambertMaterial({
      map: this.waterTex, transparent: true, opacity: 0.92,
      emissive: 0x1a3a52, emissiveIntensity: 0.25,
    });
    const bankMat = new THREE.MeshLambertMaterial({ color: 0x8a7350, transparent: true, opacity: 0.7, depthWrite: false });

    // sine path crossing the whole map, offset to one side of the castle
    const side = rng.next() < 0.5 ? -1 : 1;
    const offset = side * (24 + rng.next() * 6);
    const amp = 6 + rng.next() * 5;
    const freq = 0.05 + rng.next() * 0.03;
    const phase = rng.next() * Math.PI * 2;
    const yAt = (x: number) => CY + offset + Math.sin(x * freq + phase) * amp;
    const W = 3.4;

    const step = 3;
    for (let x = 2; x < MAP_SIZE - 2; x += step) {
      const y0 = yAt(x), y1 = yAt(x + step);
      const dir = Math.atan2(y1 - y0, step);
      const len = Math.hypot(step, y1 - y0) + 0.4;
      const cx = x + step / 2, cy = (y0 + y1) / 2;
      // banks first (wider, under the water)
      const bank = new THREE.Mesh(new THREE.PlaneGeometry(len + 0.6, W + 1.6), bankMat);
      bank.rotation.x = -Math.PI / 2;
      bank.rotation.z = -dir;
      bank.position.set(cx, 0.028, cy);
      // water surface
      const water = new THREE.Mesh(new THREE.PlaneGeometry(len, W), waterMat);
      water.rotation.x = -Math.PI / 2;
      water.rotation.z = -dir;
      water.position.set(cx, 0.045, cy);
      this.root.add(bank, water);
      // reeds and stones along the banks
      if (rng.next() < 0.5) {
        const reed = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.5 + rng.next() * 0.3, 4), mat(0x55683a));
        reed.position.set(cx + (rng.next() - 0.5) * 2, 0.28, cy + (W / 2 + 0.4) * (rng.next() < 0.5 ? 1 : -1));
        this.root.add(reed);
      }
      if (rng.next() < 0.3) {
        const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16 + rng.next() * 0.1), mat(0x7d8087));
        st.position.set(cx + (rng.next() - 0.5) * 2, 0.1, cy + (W / 2 + 0.3) * (rng.next() < 0.5 ? 1 : -1));
        this.root.add(st);
      }
      // keep decor generators away from the riverbed
      this.occupied.push({ x: cx, y: cy, r: W / 2 + 1.5 });
    }

    // two plank bridges crossing the river
    for (const bx of [MAP_SIZE * 0.3, MAP_SIZE * 0.68]) {
      const by = yAt(bx);
      const slope = Math.atan2(yAt(bx + 1) - yAt(bx - 1), 2);
      const g = new THREE.Group();
      // deck: slightly arched planks spanning the water
      const span = W + 2.4;
      for (let i = 0; i < 9; i++) {
        const t = i / 8;
        const plank = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, span / 9 + 0.05), mat(0x8a6238));
        plank.position.set(0, 0.35 + Math.sin(t * Math.PI) * 0.25, -span / 2 + (t * span));
        plank.rotation.x = -Math.cos(t * Math.PI) * 0.22;
        g.add(plank);
      }
      // rails + posts
      for (const sx of [-0.8, 0.8]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, span), mat(WOOD_DARK));
        rail.position.set(sx, 0.95, 0);
        g.add(rail);
        for (const pz of [-span / 2 + 0.2, 0, span / 2 - 0.2]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 0.1), mat(WOOD_DARK));
          post.position.set(sx, 0.6, pz);
          g.add(post);
        }
      }
      // support legs into the water
      for (const pz of [-W / 2, W / 2]) {
        for (const sx of [-0.6, 0.6]) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.6, 5), mat(0x4a3b28));
          leg.position.set(sx, 0.2, pz);
          g.add(leg);
        }
      }
      // lanterns at both ends — real warm point lights
      for (const pz of [-span / 2, span / 2]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.3, 5), mat(WOOD_DARK));
        pole.position.set(0.8, 0.95, pz);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), mat(0xffd9a0, 0xffb050));
        lamp.position.set(0.8, 1.65, pz);
        g.add(pole, lamp);
        const light = new THREE.PointLight(0xffa94d, 0.9, 7, 1.8);
        light.position.set(0.8, 1.7, pz);
        g.add(light);
        this.lights.push({ light, base: 0.9, phase: Math.random() * 6 });
      }
      // bridge sits perpendicular to flow direction
      g.rotation.y = -slope;
      g.position.set(bx, 0, by);
      this.root.add(g);
      this.occupied.push({ x: bx, y: by, r: 4 });
    }
  }

  // ---- worn dirt paths radiating from the castle gate in 4 directions ----
  private paths(rng: Rng): void {
    for (let d = 0; d < 4; d++) {
      const a = (d / 4) * Math.PI * 2 + Math.PI / 4 + (rng.next() - 0.5) * 0.3;
      let px = CX + Math.cos(a) * 7, py = CY + Math.sin(a) * 7;
      let dir = a;
      for (let seg = 0; seg < 14; seg++) {
        const len = 3.5 + rng.next() * 2;
        const strip = new THREE.Mesh(
          new THREE.PlaneGeometry(1.3 + rng.next() * 0.5, len),
          new THREE.MeshLambertMaterial({ color: 0x8a7350, transparent: true, opacity: 0.45, depthWrite: false }));
        strip.rotation.x = -Math.PI / 2;
        strip.rotation.z = -dir + Math.PI / 2;
        strip.position.set(px + Math.cos(dir) * len / 2, 0.025, py + Math.sin(dir) * len / 2);
        this.root.add(strip);
        px += Math.cos(dir) * len;
        py += Math.sin(dir) * len;
        dir += (rng.next() - 0.5) * 0.5;   // winding
        if (px < 8 || py < 8 || px > MAP_SIZE - 8 || py > MAP_SIZE - 8) break;
      }
    }
  }

  // ---- campfire by the castle gate: log seats, animated flame, smoke ----
  private campfire(): void {
    const g = new THREE.Group();
    const fx = CX + 4.5, fy = CY + 6.5;
    // stone circle
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12), mat(STONE_DARK));
      s.position.set(Math.cos(a) * 0.5, 0.08, Math.sin(a) * 0.5);
      g.add(s);
    }
    // crossed logs
    for (const r of [0.5, 2.1]) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.8, 5), mat(0x5e4023));
      log.rotation.z = Math.PI / 2 - 0.3;
      log.rotation.y = r;
      log.position.y = 0.12;
      g.add(log);
    }
    // seat logs
    for (const [lx, lz] of [[-1.2, 0.4], [1, -0.9]] as const) {
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 1.4, 6), mat(0x6b4a2a));
      seat.rotation.z = Math.PI / 2;
      seat.rotation.y = lx;
      seat.position.set(lx, 0.16, lz);
      g.add(seat);
    }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 5), mat(0xffaa33, 0xff8c3b));
    flame.position.y = 0.35;
    g.add(flame);
    this.flames.push(flame);
    const fireLight = new THREE.PointLight(0xff8c3b, 1.4, 9, 1.6);
    fireLight.position.y = 0.8;
    g.add(fireLight);
    this.lights.push({ light: fireLight, base: 1.4, phase: 1.3 });
    // smoke puffs — recycled small spheres rising
    for (let i = 0; i < 4; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.12, 5, 4),
        new THREE.MeshBasicMaterial({ color: 0x55606a, transparent: true, opacity: 0.3, depthWrite: false }));
      puff.userData.phase = i / 4;
      puff.position.y = 0.6;
      g.add(puff);
      this.smoke.push(puff);
    }
    g.position.set(fx, 0, fy);
    this.root.add(g);
  }

  // ---- abandoned houses: tilted walls, collapsed roof half ----
  private houses(rng: Rng): void {
    for (let i = 0; i < 6; i++) {
      const p = this.spot(rng, 22, 42, 4);
      if (!p) continue;
      const g = new THREE.Group();
      const w = 2.4 + rng.next() * 1.2, d = 2 + rng.next();
      const wallH = 1.2;
      const back = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, 0.18), mat(RUIN));
      back.position.set(0, wallH / 2, -d / 2);
      const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.18, wallH * 0.8, d), mat(RUIN));
      sideL.position.set(-w / 2, wallH * 0.4, 0);
      sideL.rotation.z = 0.06;
      const sideR = new THREE.Mesh(new THREE.BoxGeometry(0.18, wallH * 0.55, d * 0.7), mat(RUIN));
      sideR.position.set(w / 2, wallH * 0.27, -d * 0.1);
      sideR.rotation.z = -0.12;
      // half-collapsed roof leaning on the back wall
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.1, d * 0.8), mat(WOOD_DARK));
      roof.position.set(0, wallH * 0.85, -d * 0.15);
      roof.rotation.x = -0.5;
      // rubble
      for (let r = 0; r < 4; r++) {
        const rb = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16 + rng.next() * 0.15), mat(STONE_DARK));
        rb.position.set((rng.next() - 0.5) * w, 0.12, (rng.next() - 0.3) * d);
        g.add(rb);
      }
      g.add(back, sideL, sideR, roof);
      // barrels, crates and a fence stretch beside each house
      for (let b = 0; b < rng.int(1, 3); b++) {
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.45, 8), mat(0x7a5a32));
        barrel.position.set(w / 2 + 0.5 + b * 0.45, 0.22, (rng.next() - 0.5) * d);
        g.add(barrel);
      }
      if (rng.next() < 0.7) {
        const crate = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), mat(0x8a6238));
        crate.position.set(-w / 2 - 0.5, 0.22, d * 0.3);
        crate.rotation.y = rng.next();
        g.add(crate);
      }
      for (let f = 0; f < 4; f++) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.08), mat(WOOD_DARK));
        post.position.set(-w / 2 + f * 0.6, 0.27, d / 2 + 0.8);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.05), mat(WOOD_DARK));
        rail.position.set(-w / 2 + f * 0.6 + 0.3, 0.4, d / 2 + 0.8);
        g.add(post, rail);
      }
      this.place(g, p.x, p.y, rng.next() * Math.PI * 2);
    }
  }

  // ---- ruined village: clusters of broken wall stubs ----
  private ruinedVillage(rng: Rng): void {
    for (let c = 0; c < 2; c++) {
      const center = this.spot(rng, 30, 48, 6);
      if (!center) continue;
      for (let i = 0; i < 5 + rng.int(0, 3); i++) {
        const g = new THREE.Group();
        const stub = new THREE.Mesh(
          new THREE.BoxGeometry(0.8 + rng.next(), 0.3 + rng.next() * 0.8, 0.25), mat(RUIN));
        stub.position.y = stub.geometry.parameters.height / 2;
        const char = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.2), mat(0x2b2622));
        char.position.set(0.3, 0.08, 0.3); // charred beam
        char.rotation.y = rng.next();
        g.add(stub, char);
        this.place(g, center.x + (rng.next() - 0.5) * 8, center.y + (rng.next() - 0.5) * 8,
                   rng.next() * Math.PI * 2);
      }
    }
  }

  // ---- cemetery: gravestones, crosses, a dead tree ----
  private cemetery(rng: Rng): void {
    for (let c = 0; c < 2; c++) {
      const center = this.spot(rng, 34, 52, 6);
      if (!center) continue;
      const g = new THREE.Group();
      for (let i = 0; i < 7 + rng.int(0, 4); i++) {
        const x = (rng.next() - 0.5) * 7, z = (rng.next() - 0.5) * 7;
        if (rng.next() < 0.6) {
          const stone = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 0.12), mat(GRAVE));
          stone.position.set(x, 0.3, z);
          stone.rotation.z = (rng.next() - 0.5) * 0.3;
          stone.rotation.y = (rng.next() - 0.5) * 0.6;
          const top = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 8, 1, false, 0, Math.PI), mat(GRAVE));
          top.rotation.z = Math.PI / 2;
          top.rotation.y = stone.rotation.y;
          top.position.set(x, 0.6, z);
          g.add(stone, top);
        } else {
          const v = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), mat(DEADWOOD));
          v.position.set(x, 0.35, z);
          const hbar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.08), mat(DEADWOOD));
          hbar.position.set(x, 0.5, z);
          hbar.rotation.z = (rng.next() - 0.5) * 0.2;
          g.add(v, hbar);
        }
      }
      // dead tree: bare trunk + crooked branches
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.16, 1.6, 5), mat(DEADWOOD));
      trunk.position.y = 0.8;
      const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.9, 4), mat(DEADWOOD));
      b1.position.set(0.3, 1.5, 0); b1.rotation.z = -0.9;
      const b2 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.7, 4), mat(DEADWOOD));
      b2.position.set(-0.25, 1.3, 0.1); b2.rotation.z = 0.8;
      g.add(trunk, b1, b2);
      this.place(g, center.x, center.y, rng.next() * Math.PI * 2);
    }
  }

  // ---- ruined watchtowers: broken cylinder with jagged top ----
  private watchtowers(rng: Rng): void {
    for (let i = 0; i < 3; i++) {
      const p = this.spot(rng, 26, 50, 4);
      if (!p) continue;
      const g = new THREE.Group();
      const h = 2 + rng.next() * 1.5;
      const towerBody = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, h, 8), mat(STONE));
      towerBody.position.y = h / 2;
      g.add(towerBody);
      // jagged broken rim
      for (let j = 0; j < 6; j++) {
        const a = (j / 6) * Math.PI * 2;
        const jag = new THREE.Mesh(
          new THREE.BoxGeometry(0.3, 0.2 + rng.next() * 0.6, 0.25), mat(STONE_DARK));
        jag.position.set(Math.cos(a) * 0.62, h + 0.15, Math.sin(a) * 0.62);
        jag.rotation.y = a;
        g.add(jag);
      }
      // fallen stones
      for (let j = 0; j < 5; j++) {
        const fb = new THREE.Mesh(new THREE.DodecahedronGeometry(0.18 + rng.next() * 0.18), mat(STONE));
        fb.position.set((rng.next() - 0.5) * 3.5, 0.15, (rng.next() - 0.5) * 3.5);
        g.add(fb);
      }
      this.place(g, p.x, p.y, rng.next() * Math.PI * 2);
    }
  }

  // ---- swamp patches: dark discs + bubbles + reeds ----
  private swamps(rng: Rng): void {
    for (let i = 0; i < 3; i++) {
      const p = this.spot(rng, 44, 56, 6);
      if (!p) continue;
      const g = new THREE.Group();
      const r = 3 + rng.next() * 2.5;
      const pool = new THREE.Mesh(new THREE.CircleGeometry(r, 16),
        new THREE.MeshLambertMaterial({ color: SWAMP, transparent: true, opacity: 0.9 }));
      pool.rotation.x = -Math.PI / 2;
      pool.position.y = 0.03;
      g.add(pool);
      for (let j = 0; j < 6; j++) {
        const a = rng.next() * Math.PI * 2, rr = rng.next() * r * 0.8;
        const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.07 + rng.next() * 0.07, 5, 4),
          mat(0x4a6648));
        bubble.position.set(Math.cos(a) * rr, 0.05, Math.sin(a) * rr);
        g.add(bubble);
        const reed = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.5 + rng.next() * 0.4, 4),
          mat(0x55683a));
        reed.position.set(Math.cos(a + 1) * r * 0.9, 0.3, Math.sin(a + 1) * r * 0.9);
        reed.rotation.z = (rng.next() - 0.5) * 0.3;
        g.add(reed);
      }
      this.place(g, p.x, p.y, 0);
    }
  }

  // ---- drifting translucent fog patches near map edges ----
  private fog(rng: Rng): void {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rng.next() * 0.5;
      const r = 48 + rng.next() * 10;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(10 + rng.next() * 8, 7 + rng.next() * 5),
        new THREE.MeshBasicMaterial({
          color: 0x9db2c4, transparent: true, opacity: 0.12, depthWrite: false,
        }));
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(CX + Math.cos(a) * r, 0.8 + rng.next(), CY + Math.sin(a) * r);
      plane.userData.basePos = plane.position.clone();
      plane.userData.phase = rng.next() * Math.PI * 2;
      this.root.add(plane);
      this.fogPlanes.push(plane);
    }
  }

  // ---- big soft color discs break up the flat green ground ----
  private groundPatches(rng: Rng): void {
    const palette = [0x4f7340, 0x456a36, 0x55794a, 0x5d8044, 0x6b6a3a];
    for (let i = 0; i < 70; i++) {
      const x = 4 + rng.next() * (MAP_SIZE - 8), y = 4 + rng.next() * (MAP_SIZE - 8);
      const patch = new THREE.Mesh(
        new THREE.CircleGeometry(2 + rng.next() * 5, 10),
        new THREE.MeshLambertMaterial({
          color: rng.pick(palette), transparent: true, opacity: 0.5, depthWrite: false,
        }));
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(x, 0.012 + i * 0.0004, y);
      patch.receiveShadow = true;
      this.root.add(patch);
    }
    // worn dirt ring around the castle clearing
    const dirt = new THREE.Mesh(
      new THREE.RingGeometry(4.6, 7.2, 24),
      new THREE.MeshLambertMaterial({ color: 0x7a6647, transparent: true, opacity: 0.55, depthWrite: false }));
    dirt.rotation.x = -Math.PI / 2;
    dirt.position.set(CX, 0.04, CY);
    this.root.add(dirt);
  }

  // ---- instanced grass tufts + flowers: cheap ground cover ----
  private grassAndFlowers(rng: Rng): void {
    const grassGeo = new THREE.ConeGeometry(0.06, 0.3, 4);
    for (const [color, total] of [[0x57883f, 900], [0x6a9a4a, 500]] as const) {
      const grass = new THREE.InstancedMesh(grassGeo, mat(color), total);
      const m4 = new THREE.Matrix4();
      let placed = 0;
      for (let i = 0; i < total * 3 && placed < total; i++) {
        const x = 5 + rng.next() * (MAP_SIZE - 10), y = 5 + rng.next() * (MAP_SIZE - 10);
        if (Math.hypot(x - CX, y - CY) < 8) continue;
        m4.makeRotationY(rng.next() * Math.PI);
        const s = 0.7 + rng.next() * 0.9;
        m4.scale(new THREE.Vector3(s, s, s));
        m4.setPosition(x, 0.15 * s, y);
        grass.setMatrixAt(placed++, m4);
      }
      grass.count = placed;
      this.root.add(grass);
    }

    const m4 = new THREE.Matrix4();
    const flowerGeo = new THREE.SphereGeometry(0.06, 5, 4);
    const colors = [0xd86a8a, 0xe8b64c, 0xc8d8e8, 0xb86fd8];
    for (const color of colors) {
      const flowers = new THREE.InstancedMesh(flowerGeo, mat(color), 90);
      let fp = 0;
      for (let i = 0; i < 270 && fp < 90; i++) {
        const x = 8 + rng.next() * (MAP_SIZE - 16), y = 8 + rng.next() * (MAP_SIZE - 16);
        if (Math.hypot(x - CX, y - CY) < 10) continue;
        m4.identity();
        m4.setPosition(x, 0.1, y);
        flowers.setMatrixAt(fp++, m4);
      }
      flowers.count = fp;
      this.root.add(flowers);
    }
  }

  // ---- bushes, stumps, pebbles, fallen logs scattered everywhere ----
  private bushesAndProps(rng: Rng): void {
    const m4 = new THREE.Matrix4();
    // bushes — instanced squashed icospheres, two greens
    const bushGeo = new THREE.IcosahedronGeometry(0.45, 0);
    for (const [color, total] of [[0x3f7a33, 120], [0x4a8a3d, 80]] as const) {
      const bushes = new THREE.InstancedMesh(bushGeo, mat(color), total);
      bushes.castShadow = true;
      let placed = 0;
      for (let i = 0; i < total * 3 && placed < total; i++) {
        const x = 5 + rng.next() * (MAP_SIZE - 10), y = 5 + rng.next() * (MAP_SIZE - 10);
        if (Math.hypot(x - CX, y - CY) < 9) continue;
        if (this.occupied.some(o => Math.hypot(o.x - x, o.y - y) < 1.2)) continue;
        const s = 0.5 + rng.next() * 0.8;
        m4.makeRotationY(rng.next() * Math.PI);
        m4.scale(new THREE.Vector3(s, s * 0.65, s));
        m4.setPosition(x, 0.22 * s, y);
        bushes.setMatrixAt(placed++, m4);
      }
      bushes.count = placed;
      this.root.add(bushes);
    }
    // pebbles
    const pebbleGeo = new THREE.DodecahedronGeometry(0.12, 0);
    const pebbles = new THREE.InstancedMesh(pebbleGeo, mat(0x7d8087), 220);
    let pp = 0;
    for (let i = 0; i < 660 && pp < 220; i++) {
      const x = 4 + rng.next() * (MAP_SIZE - 8), y = 4 + rng.next() * (MAP_SIZE - 8);
      if (Math.hypot(x - CX, y - CY) < 7) continue;
      const s = 0.5 + rng.next();
      m4.makeRotationY(rng.next() * Math.PI);
      m4.scale(new THREE.Vector3(s, s * 0.7, s));
      m4.setPosition(x, 0.06 * s, y);
      pebbles.setMatrixAt(pp++, m4);
    }
    pebbles.count = pp;
    this.root.add(pebbles);
    // tree stumps
    for (let i = 0; i < 26; i++) {
      const p = this.spot(rng, 14, 58, 1.2);
      if (!p) continue;
      const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.3, 7), mat(0x6b4a2a));
      stump.position.set(p.x, 0.15, p.y);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 7), mat(0xa3845c));
      top.position.set(p.x, 0.31, p.y);
      this.root.add(stump, top);
    }
    // fallen logs
    for (let i = 0; i < 14; i++) {
      const p = this.spot(rng, 16, 58, 1.6);
      if (!p) continue;
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 1.6 + rng.next(), 6), mat(0x5e4023));
      log.rotation.z = Math.PI / 2;
      log.rotation.y = rng.next() * Math.PI;
      log.position.set(p.x, 0.17, p.y);
      this.root.add(log);
    }
  }

  // ---- torch posts ringing the castle clearing, flame flicker ----
  private torchPosts(): void {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const g = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.6, 5), mat(WOOD_DARK));
      post.position.y = 0.8;
      const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.1, 0.2, 6), mat(0x3a3f45));
      cage.position.y = 1.65;
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 5), mat(0xffaa33, 0xff8c3b));
      flame.position.y = 1.85;
      g.add(post, cage, flame);
      const torchLight = new THREE.PointLight(0xff9540, 1.1, 8, 1.7);
      torchLight.position.y = 1.9;
      g.add(torchLight);
      this.lights.push({ light: torchLight, base: 1.1, phase: i * 1.9 });
      g.position.set(CX + Math.cos(a) * 9, 0, CY + Math.sin(a) * 9);
      this.root.add(g);
      this.flames.push(flame);
    }
  }

  update(dt: number): void {
    this.time += dt;
    // flowing water
    if (this.waterTex) this.waterTex.offset.x = (this.time * 0.06) % 1;
    // firelight flicker
    for (const { light, base, phase } of this.lights) {
      light.intensity = base * (0.85 + Math.sin(this.time * 9 + phase) * 0.1
                              + Math.sin(this.time * 23 + phase * 2) * 0.05);
    }
    for (const f of this.fogPlanes) {
      const base = f.userData.basePos as THREE.Vector3;
      const ph = f.userData.phase as number;
      f.position.x = base.x + Math.sin(this.time * 0.08 + ph) * 4;
      f.position.z = base.z + Math.cos(this.time * 0.06 + ph) * 3;
      (f.material as THREE.MeshBasicMaterial).opacity =
        0.09 + Math.sin(this.time * 0.3 + ph) * 0.04;
    }
    for (let i = 0; i < this.flames.length; i++) {
      const fl = this.flames[i]!;
      const k = Math.sin(this.time * 11 + i * 2.3) * 0.5 + Math.sin(this.time * 7.3 + i) * 0.5;
      fl.scale.set(1 + k * 0.15, 1 + k * 0.3, 1 + k * 0.15);
      (fl.material as THREE.MeshLambertMaterial).emissiveIntensity = 0.7 + k * 0.25;
    }
    for (const puff of this.smoke) {
      const ph = ((this.time * 0.25 + (puff.userData.phase as number)) % 1);
      puff.position.y = 0.6 + ph * 2.2;
      puff.position.x = Math.sin(this.time * 0.7 + ph * 6) * 0.2;
      const m = puff.material as THREE.MeshBasicMaterial;
      m.opacity = 0.32 * (1 - ph);
      puff.scale.setScalar(0.7 + ph * 1.6);
    }
  }
}
