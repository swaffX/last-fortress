import * as THREE from 'three';
import {
  BUILDINGS, MAP_SIZE, inRiverBand, type BuildingType, type Command, type RiverParams,
} from '@lf/shared';
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
  private rectAnchor: { x: number; y: number } | null = null;
  private rectLine: THREE.Line | null = null;

  send: (cmd: Command) => void = () => {};
  ping: (pos: { x: number; y: number }) => void = () => {};
  onAttack: () => void = () => {};
  onBuildCancel: () => void = () => {};
  private lastPlacedCell: string | null = null;
  onSelectAt: (cell: { x: number; y: number }) => void = () => {};
  buildings: BuildingView[] = [];
  nodes: NodeView[] = [];
  riverP: RiverParams | null = null;

  constructor(private stage: Stage, private canvas: HTMLCanvasElement) {
    addEventListener('keydown', e => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.key.toLowerCase());
    });
    addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('pointermove', e => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    canvas.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (this.buildType) this.onBuildCancel();   // right-click exits build mode
    });
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const w = this.stage.screenToWorld(e.clientX, e.clientY);
      if (e.altKey) { this.ping(w); return; }
      if (this.buildType) {
        this.mouse.down = true;
        if (BUILDINGS[this.buildType].size === 1) {
          // drag → rectangle outline of walls; placement happens on release
          this.rectAnchor = this.snap(w);
        } else {
          this.tryPlace(w);
        }
        return;
      }
      // building under cursor → select; otherwise attack
      const cell = { x: Math.floor(w.x), y: Math.floor(w.y) };
      const hit = this.buildingAt(cell);
      if (hit) { this.onSelectAt(cell); return; }
      this.mouse.down = true;
      this.onSelectAt({ x: -1, y: -1 });  // deselect
      // fire immediately — waiting for the 50 ms tick swallows quick clicks
      this.send({ kind: 'attack', dir: { x: w.x, y: w.y } });
      this.onAttack();
    });
    addEventListener('pointerup', e => {
      if (this.rectAnchor && this.buildType) {
        // place the full perimeter; the server builds as far as resources allow
        const end = this.snap(this.stage.screenToWorld(e.clientX, e.clientY));
        for (const cell of this.rectPerimeter(this.rectAnchor, end)) {
          if (this.isValid(cell, 1)) this.send({ kind: 'build', type: this.buildType, pos: cell });
        }
      }
      this.rectAnchor = null;
      this.hideRectLine();
      this.mouse.down = false;
      this.lastPlacedCell = null;
    });
  }

  private rectPerimeter(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number }[] {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    const out: { x: number; y: number }[] = [];
    for (let x = x0; x <= x1; x++) {
      out.push({ x, y: y0 });
      if (y1 !== y0) out.push({ x, y: y1 });
    }
    for (let y = y0 + 1; y < y1; y++) {
      out.push({ x: x0, y });
      if (x1 !== x0) out.push({ x: x1, y });
    }
    return out;
  }

  private hideRectLine(): void {
    if (this.rectLine) { this.stage.scene.remove(this.rectLine); this.rectLine = null; }
  }

  private updateRectLine(a: { x: number; y: number }, b: { x: number; y: number }): void {
    this.hideRectLine();
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x) + 1;
    const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y) + 1;
    const pts = [
      new THREE.Vector3(x0, 0.12, y0), new THREE.Vector3(x1, 0.12, y0),
      new THREE.Vector3(x1, 0.12, y1), new THREE.Vector3(x0, 0.12, y1),
      new THREE.Vector3(x0, 0.12, y0),
    ];
    this.rectLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x6fbf63 }));
    this.stage.scene.add(this.rectLine);
  }

  /** Place at the snapped cell if free; dedupes while drag-painting walls. */
  private tryPlace(w: { x: number; y: number }): void {
    if (!this.buildType) return;
    const cell = this.snap(w);
    const key = `${cell.x},${cell.y}`;
    if (key === this.lastPlacedCell) return;
    if (this.isValid(cell, BUILDINGS[this.buildType].size)) {
      this.send({ kind: 'build', type: this.buildType, pos: cell });
      this.lastPlacedCell = key;
    }
  }

  setBuildType(type: BuildingType | null): void {
    this.buildType = type;
    this.rectAnchor = null;
    this.hideRectLine();
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
        if (this.riverP && inRiverBand(x + 0.5, y + 0.5, this.riverP, 0.2)) return false;
        for (const n of this.nodes) {
          if (n.pos.x === x && n.pos.y === y) return false;
        }
      }
    }
    return true;
  }

  /** Current normalized-intent move direction (for client-side prediction). */
  get dir(): { x: number; y: number } {
    let dx = 0, dy = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
    return { x: dx, y: dy };
  }

  /** Called at ~20 Hz to push held-input commands. */
  tick(): void {
    const { x: dx, y: dy } = this.dir;
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
    if (this.rectAnchor) this.updateRectLine(this.rectAnchor, cell);
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
