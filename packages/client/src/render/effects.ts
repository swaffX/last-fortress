import * as THREE from 'three';
import type { SimEvent } from '@lf/shared';
import type { Stage } from './scene';

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  gravity: number;
}
interface Beam { line: THREE.Line; life: number; }
interface Ring { mesh: THREE.Mesh; life: number; maxLife: number; maxScale: number; }
interface Flash { mesh: THREE.Mesh; life: number; }

/** Pooled particle and beam effects driven by SimEvents. */
export class Effects {
  private pool: Particle[] = [];
  private active: Particle[] = [];
  private beams: Beam[] = [];
  private rings: Ring[] = [];
  private flashes: Flash[] = [];
  private prints: { mesh: THREE.Mesh; life: number }[] = [];
  private geo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
  private flashGeo = new THREE.SphereGeometry(0.16, 6, 5);
  private ringGeo = new THREE.RingGeometry(0.9, 1, 20);
  private bloodBudget = 0;

  constructor(private scene: THREE.Scene, private stage: Stage) {}

  handle(events: SimEvent[]): void {
    for (const e of events) {
      switch (e.kind) {
        case 'damage':
          if (this.bloodBudget > 0 && e.amount >= 8) {
            this.bloodBudget--;
            this.burst(e.pos.x, e.pos.y, 0x8a2f25, 3, 0.35, 2.2);
          }
          break;
        case 'player_died':
          this.burst(e.pos.x, e.pos.y, 0x8a2f25, 8, 0.6, 3.5);
          this.shockwave(e.pos.x, e.pos.y, 2, 0xc43a31);
          this.stage.addShake(0.4);
          break;
        case 'building_destroyed':
          this.burst(e.pos.x + 0.5, e.pos.y + 0.5, 0x8d9299, 14, 0.9, 4);
          this.burst(e.pos.x + 0.5, e.pos.y + 0.5, 0x5e4023, 8, 0.7, 3);
          this.shockwave(e.pos.x + 0.5, e.pos.y + 0.5, 2.2, 0x8d9299);
          this.stage.addShake(0.3);
          break;
        case 'build_placed':
          this.burst(e.pos.x + 0.5, e.pos.y + 0.5, 0xd9b88a, 8, 0.4, 2.5);
          this.shockwave(e.pos.x + 0.5, e.pos.y + 0.5, 1.4, 0xd9b88a);
          break;
        case 'item_drop':
          this.burst(e.pos.x, e.pos.y, 0xd9b88a, 4, 0.3, 1.8);
          break;
      }
    }
  }

  private spawn(x: number, z: number, color: number): Particle {
    let p = this.pool.pop();
    if (!p) {
      p = {
        mesh: new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color, transparent: true })),
        vel: new THREE.Vector3(), life: 0, maxLife: 0, gravity: 9,
      };
    }
    (p.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    p.mesh.position.set(x, 0.6, z);
    this.scene.add(p.mesh);
    this.active.push(p);
    return p;
  }

  private burst(x: number, z: number, color: number, count: number, life: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      const p = this.spawn(x, z, color);
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      p.vel.set(Math.cos(a) * s, 2 + Math.random() * 3.5, Math.sin(a) * s);
      p.life = p.maxLife = life * (0.6 + Math.random() * 0.4);
      p.gravity = 9;
    }
  }

  /** Node destruction: wood splinters + leaves, or stone shards + dust. */
  nodeBreak(x: number, y: number, kind: 'tree' | 'rock'): void {
    if (kind === 'tree') {
      this.burst(x, y, 0x8a6238, 14, 0.7, 4);     // splinters
      this.burst(x, y, 0x3f7a33, 10, 0.9, 3);     // leaves
      this.shockwave(x, y, 1.6, 0x8a6238);
    } else {
      this.burst(x, y, 0x7d8087, 14, 0.7, 4);     // shards
      this.burst(x, y, 0xb8b4a8, 8, 0.5, 2.5);    // dust
      this.shockwave(x, y, 1.4, 0x9aa0a8);
    }
    this.stage.addShake(0.12);
  }

  /** small chip burst on every gathering swing */
  gatherHit(x: number, y: number, kind: 'wood' | 'stone'): void {
    this.burst(x, y, kind === 'wood' ? 0xa3845c : 0x9aa0a8, 4, 0.35, 2.2);
  }

  /** Soft dust puff kicked up behind a moving character (wind trail). */
  trail(x: number, z: number): void {
    const p = this.spawn(x + (Math.random() - 0.5) * 0.3, z + (Math.random() - 0.5) * 0.3, 0xcfd8cf);
    p.mesh.position.y = 0.15;
    p.vel.set((Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 0.6);
    p.life = p.maxLife = 0.5 + Math.random() * 0.3;
    p.gravity = -0.4;   // drifts up like stirred dust
    (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.35;
  }

  /** Fading boot print decal, alternating left/right of the heading. */
  footprint(x: number, z: number, heading: number, side: -1 | 1): void {
    const print = new THREE.Mesh(
      new THREE.PlaneGeometry(0.1, 0.22),
      new THREE.MeshBasicMaterial({ color: 0x2c2419, transparent: true, opacity: 0.32, depthWrite: false }));
    print.rotation.x = -Math.PI / 2;
    print.rotation.z = -heading;
    const ox = Math.cos(heading) * 0.14 * side, oz = -Math.sin(heading) * 0.14 * side;
    print.position.set(x + ox, 0.022, z + oz);
    this.scene.add(print);
    this.prints.push({ mesh: print, life: 5 });
    if (this.prints.length > 64) {
      const old = this.prints.shift()!;
      this.scene.remove(old.mesh);
      (old.mesh.material as THREE.Material).dispose();
    }
  }

  /** expanding fading ring on the ground */
  private shockwave(x: number, z: number, maxScale: number, color: number): void {
    const mesh = new THREE.Mesh(this.ringGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.08, z);
    mesh.scale.setScalar(0.1);
    this.scene.add(mesh);
    this.rings.push({ mesh, life: 0.45, maxLife: 0.45, maxScale });
  }

  /** brief glowing sphere (muzzle flash / explosion core) */
  private flash(x: number, y: number, z: number, color: number): void {
    const mesh = new THREE.Mesh(this.flashGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.flashes.push({ mesh, life: 0.09 });
  }

  tracer(x1: number, z1: number, x2: number, z2: number, color: number): void {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x1, 1.6, z1), new THREE.Vector3(x2, 0.8, z2),
    ]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true }));
    this.scene.add(line);
    this.beams.push({ line, life: 0.12 });
  }

  private bolt(x1: number, z1: number, x2: number, z2: number): void {
    const pts: THREE.Vector3[] = [];
    const segs = 6;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      pts.push(new THREE.Vector3(
        x1 + (x2 - x1) * t + (i > 0 && i < segs ? (Math.random() - 0.5) * 0.7 : 0),
        1.8 - t * 1.0 + (i > 0 && i < segs ? (Math.random() - 0.5) * 0.5 : 0),
        z1 + (z2 - z1) * t + (i > 0 && i < segs ? (Math.random() - 0.5) * 0.7 : 0),
      ));
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xffe16b, transparent: true }));
    this.scene.add(line);
    this.beams.push({ line, life: 0.18 });
  }

  update(dt: number): void {
    this.bloodBudget = Math.min(6, this.bloodBudget + dt * 20);
    for (let i = this.prints.length - 1; i >= 0; i--) {
      const fp = this.prints[i]!;
      fp.life -= dt;
      if (fp.life <= 0) {
        this.scene.remove(fp.mesh);
        (fp.mesh.material as THREE.Material).dispose();
        this.prints.splice(i, 1);
      } else if (fp.life < 1.5) {
        (fp.mesh.material as THREE.MeshBasicMaterial).opacity = 0.32 * (fp.life / 1.5);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.life -= dt;
      if (r.life <= 0) {
        this.scene.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const k = 1 - r.life / r.maxLife;
      r.mesh.scale.setScalar(0.1 + k * r.maxScale);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]!;
      f.life -= dt;
      if (f.life <= 0) {
        this.scene.remove(f.mesh);
        (f.mesh.material as THREE.Material).dispose();
        this.flashes.splice(i, 1);
      } else {
        f.mesh.scale.setScalar(1 + (0.09 - f.life) * 8);
      }
    }
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i]!;
      p.life -= dt;
      if (p.life <= 0 || p.mesh.position.y < 0) {
        this.scene.remove(p.mesh);
        this.active.splice(i, 1);
        this.pool.push(p);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.life / p.maxLife;
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i]!;
      b.life -= dt;
      if (b.life <= 0) {
        this.scene.remove(b.line);
        b.line.geometry.dispose();
        this.beams.splice(i, 1);
      } else {
        (b.line.material as THREE.LineBasicMaterial).opacity = Math.min(1, b.life / 0.08);
      }
    }
  }
}
