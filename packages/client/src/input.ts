import * as THREE from 'three';
import { BUILDINGS, MAP_SIZE, type BuildingType, type Command } from '@lf/shared';
import type { Stage } from './render/scene';
import type { BuildingView, NodeView } from './net';
import { buildingModel } from './render/models';

/**
 * Keyboard/mouse input → server commands. Owns the build-placement ghost
 * with client-side validity preview (green/red).
 */
export class Input {
  private keys = new Set<string>();
  private mouse = { x: 0, y: 0, down: false };
  private buildType: BuildingType | null = null;
  private ghost: THREE.Group | null = null;
  private ghostPlate: THREE.Mesh | null = null;
  private ghostRot = 0;

  send: (cmd: Command) => void = () => {};
  ping: (pos: { x: number; y: number }) => void = () => {};
  onAttack: () => void = () => {};
  onSelectAt: (cell: { x: number; y: number }) => void = () => {};
  buildings: BuildingView[] = [];
  nodes: NodeView[] = [];

  constructor(private stage: Stage, private canvas: HTMLCanvasElement) {
    addEventListener('keydown', e => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.key.toLowerCase());
    });
    addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('pointermove', e => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const w = this.stage.screenToWorld(e.clientX, e.clientY);
      if (e.altKey) { this.ping(w); return; }
      if (this.buildType) {
        const cell = this.snap(w);
        if (this.isValid(cell, BUILDINGS[this.buildType].size)) {
          this.send({ kind: 'build', type: this.buildType, pos: cell });
        }
        return;
      }
      // building under cursor → select; otherwise attack
      const cell = { x: Math.floor(w.x), y: Math.floor(w.y) };
      const hit = this.buildingAt(cell);
      if (hit) { this.onSelectAt(cell); return; }
      this.mouse.down = true;
      this.onSelectAt({ x: -1, y: -1 });  // deselect
    });
    addEventListener('pointerup', () => { this.mouse.down = false; });
  }

  setBuildType(type: BuildingType | null): void {
    this.buildType = type;
    if (this.ghost) { this.stage.scene.remove(this.ghost); this.ghost = null; this.ghostPlate = null; }
    if (!type) return;
    const model = buildingModel(type, 1);
    model.traverse(o => {
      if (o instanceof THREE.Mesh) {
        const m = (o.material as THREE.MeshLambertMaterial).clone();
        m.transparent = true; m.opacity = 0.55;
        o.material = m;
        o.castShadow = false;
      }
    });
    const size = BUILDINGS[type].size;
    this.ghostPlate = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ color: 0x6fbf63, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.ghostPlate.rotation.x = -Math.PI / 2;
    this.ghostPlate.position.y = 0.04;
    const g = new THREE.Group();
    g.add(model, this.ghostPlate);
    this.ghost = g;
    this.stage.scene.add(g);
  }

  private snap(w: { x: number; y: number }): { x: number; y: number } {
    const size = this.buildType ? BUILDINGS[this.buildType].size : 1;
    return {
      x: Math.max(0, Math.min(MAP_SIZE - size, Math.floor(w.x - size / 2 + 0.5))),
      y: Math.max(0, Math.min(MAP_SIZE - size, Math.floor(w.y - size / 2 + 0.5))),
    };
  }

  private buildingAt(cell: { x: number; y: number }): BuildingView | null {
    for (const b of this.buildings) {
      const s = BUILDINGS[b.type].size;
      if (cell.x >= b.pos.x && cell.x < b.pos.x + s &&
          cell.y >= b.pos.y && cell.y < b.pos.y + s) return b;
    }
    return null;
  }

  private isValid(cell: { x: number; y: number }, size: number): boolean {
    for (let y = cell.y; y < cell.y + size; y++) {
      for (let x = cell.x; x < cell.x + size; x++) {
        if (x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE) return false;
        if (this.buildingAt({ x, y })) return false;
        for (const n of this.nodes) {
          if (n.pos.x === x && n.pos.y === y) return false;
        }
      }
    }
    return true;
  }

  /** Called at ~20 Hz to push held-input commands. */
  tick(): void {
    let dx = 0, dy = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
    if (dx || dy) this.send({ kind: 'move', dir: { x: dx, y: dy } });
    if (this.mouse.down && !this.buildType) {
      const w = this.stage.screenToWorld(this.mouse.x, this.mouse.y);
      this.send({ kind: 'attack', dir: { x: w.x, y: w.y } });
      this.onAttack();
    }
    if (this.keys.has('r') && this.ghost) {
      this.ghostRot += Math.PI / 2;
      this.ghost.children[0]!.rotation.y = this.ghostRot;
      this.keys.delete('r');
    }
  }

  /** Per-render-frame ghost positioning. */
  updateGhost(): void {
    if (!this.ghost || !this.buildType) return;
    const w = this.stage.screenToWorld(this.mouse.x, this.mouse.y);
    const cell = this.snap(w);
    const size = BUILDINGS[this.buildType].size;
    this.ghost.position.set(cell.x + size / 2, 0, cell.y + size / 2);
    const ok = this.isValid(cell, size);
    (this.ghostPlate!.material as THREE.MeshBasicMaterial).color.setHex(ok ? 0x6fbf63 : 0xc43a31);
  }

  consumeKey(key: string): boolean {
    if (this.keys.has(key)) { this.keys.delete(key); return true; }
    return false;
  }
}
