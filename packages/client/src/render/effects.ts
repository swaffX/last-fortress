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

/** Pooled particle and beam effects driven by SimEvents. */
export class Effects {
  private pool: Particle[] = [];
  private active: Particle[] = [];
  private beams: Beam[] = [];
  private geo = new THREE.BoxGeometry(0.14, 0.14, 0.14);

  constructor(private scene: THREE.Scene, private stage: Stage) {}

  handle(events: SimEvent[]): void {
    for (const e of events) {
      switch (e.kind) {
        case 'projectile': {
          const color = e.weapon === 'ice' ? 0x7cc7e8 : e.weapon === 'bomb' ? 0x2b2b30
            : e.weapon === 'bolt' ? 0xc9d2da : 0xd9b88a;
          this.tracer(e.from.x, e.from.y, e.to.x, e.to.y, color);
          break;
        }
        case 'explosion':
          this.burst(e.pos.x, e.pos.y, 0xff8c3b, Math.round(10 * e.radius), 0.5, 5);
          this.burst(e.pos.x, e.pos.y, 0x57514a, Math.round(6 * e.radius), 0.9, 3);
          this.stage.addShake(0.25 + e.radius * 0.1);
          break;
        case 'chain': {
          for (let i = 0; i + 1 < e.points.length; i++) {
            this.bolt(e.points[i]!.x, e.points[i]!.y, e.points[i + 1]!.x, e.points[i + 1]!.y);
          }
          break;
        }
        case 'death':
          this.burst(e.pos.x, e.pos.y, 0x8a2f25, 8, 0.6, 3.5);
          if (e.enemy === 'butcher') this.stage.addShake(0.8);
          break;
        case 'building_destroyed':
          this.burst(e.pos.x + 0.5, e.pos.y + 0.5, 0x8d9299, 14, 0.9, 4);
          this.stage.addShake(0.3);
          break;
        case 'build_placed':
          this.burst(e.pos.x + 0.5, e.pos.y + 0.5, 0xd9b88a, 8, 0.4, 2.5);
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
