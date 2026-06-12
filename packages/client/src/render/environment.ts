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

const STONE = 0x8d9299, STONE_DARK = 0x5c6168, WOOD_DARK = 0x5e4023;
const RUIN = 0x6e6f6a, GRAVE = 0x9a9d9f, DEADWOOD = 0x4a3b2c, SWAMP = 0x2c3d2a;

const CX = CASTLE_POS.x + 2, CY = CASTLE_POS.y + 2;

export class Environment {
  private root = new THREE.Group();
  private fogPlanes: THREE.Mesh[] = [];
  private flames: THREE.Mesh[] = [];
  private time = 0;
  private occupied: { x: number; y: number; r: number }[] = [];

  constructor(private scene: THREE.Scene, seed: number, nodes: NodeView[]) {
    const rng = new Rng((seed ^ 0xdec0de) >>> 0);
    for (const n of nodes) this.occupied.push({ x: n.pos.x, y: n.pos.y, r: 1.5 });

    this.houses(rng);
    this.ruinedVillage(rng);
    this.cemetery(rng);
    this.watchtowers(rng);
    this.swamps(rng);
    this.fog(rng);
    this.grassAndFlowers(rng);
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

  // ---- instanced grass tufts + flowers: cheap ground cover ----
  private grassAndFlowers(rng: Rng): void {
    const grassGeo = new THREE.ConeGeometry(0.05, 0.28, 4);
    const grass = new THREE.InstancedMesh(grassGeo, mat(0x57883f), 320);
    const m4 = new THREE.Matrix4();
    let placed = 0;
    for (let i = 0; i < 800 && placed < 320; i++) {
      const x = 6 + rng.next() * (MAP_SIZE - 12), y = 6 + rng.next() * (MAP_SIZE - 12);
      if (Math.hypot(x - CX, y - CY) < 8) continue;
      m4.makeRotationY(rng.next() * Math.PI);
      m4.setPosition(x, 0.14, y);
      grass.setMatrixAt(placed++, m4);
    }
    grass.count = placed;
    this.root.add(grass);

    const flowerGeo = new THREE.SphereGeometry(0.06, 5, 4);
    const colors = [0xd86a8a, 0xe8b64c, 0xc8d8e8];
    for (const color of colors) {
      const flowers = new THREE.InstancedMesh(flowerGeo, mat(color), 40);
      let fp = 0;
      for (let i = 0; i < 120 && fp < 40; i++) {
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
      g.position.set(CX + Math.cos(a) * 9, 0, CY + Math.sin(a) * 9);
      this.root.add(g);
      this.flames.push(flame);
    }
  }

  update(dt: number): void {
    this.time += dt;
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
  }
}
