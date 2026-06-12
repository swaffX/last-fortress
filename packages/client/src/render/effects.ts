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
  private geo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
  private flashGeo = new THREE.SphereGeometry(0.16, 6, 5);
  private ringGeo = new THREE.RingGeometry(0.9, 1, 20);
  private bloodBudget = 0;

  constructor(private scene: THREE.Scene, private stage: Stage) {}

  handle(events: SimEvent[]): void {
    for (const e of events) {
      switch (e.kind) {
        case 'projectile': {
          const color = e.weapon === 'ice' ? 0x7cc7e8 : e.weapon === 'bomb' ? 0x2b2b30
            : e.weapon === 'bolt' ? 0xc9d2da : e.weapon === 'spit' ? 0x8fdc4a : 0xd9b88a;
          this.tracer(e.from.x, e.from.y, e.to.x, e.to.y, color);
          // muzzle flash at origin, impact burst at target
          if (e.weapon !== 'spit') this.flash(e.from.x, 1.6, e.from.y, 0xffd9a0);
          this.burst(e.to.x, e.to.y, color, e.weapon === 'spit' ? 5 : 3, 0.25, 1.8);
          break;
        }
        case 'explosion':
          this.burst(e.pos.x, e.pos.y, 0xff8c3b, Math.round(10 * e.radius), 0.5, 5);
          this.burst(e.pos.x, e.pos.y, 0xffd24a, Math.round(5 * e.radius), 0.3, 6);
          this.burst(e.pos.x, e.pos.y, 0x57514a, Math.round(6 * e.radius), 0.9, 3);
          this.shockwave(e.pos.x, e.pos.y, e.radius * 1.6, 0xffaa55);
          this.flash(e.pos.x, 0.7, e.pos.y, 0xffe9b0);
          this.stage.addShake(0.25 + e.radius * 0.1);
          break;
        case 'damage':
          // light blood spritz, budgeted so hordes don't drown the GPU
          if (this.bloodBudget > 0 && e.amount >= 8) {
            this.bloodBudget--;
            this.burst(e.pos.x, e.pos.y, 0x8a2f25, 3, 0.35, 2.2);
          }
          break;
        case 'chain': {
          for (let i = 0; i + 1 < e.points.length; i++) {
            this.bolt(e.points[i]!.x, e.points[i]!.y, e.points[i + 1]!.x, e.points[i + 1]!.y);
          }
          break;
        }
        case 'death':
          this.burst(e.pos.x, e.pos.y, 0x8a2f25, 8, 0.6, 3.5);
          this.burst(e.pos.x, e.pos.y, 0x5d6b48, 4, 0.5, 2.5);
          if (e.enemy === 'butcher') {
            this.stage.addShake(0.8);
            this.shockwave(e.pos.x, e.pos.y, 4, 0xc43a31);
          }
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
        case 'splash':
          this.burst(e.pos.x, e.pos.y, 0x9fd4f0, 5, 0.35, 2.2);
          this.shockwave(e.pos.x, e.pos.y, 0.9, 0x9fd4f0);
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

  private tracer(x1: number, z1: number, x2: number, z2: number, color: number): void {
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
