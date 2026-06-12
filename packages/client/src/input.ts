import * as THREE from 'three';
import {
  BUILDINGS, MAP_SIZE, inRiverBand, decorBlocks,
  type BuildingType, type Command, type RiverParams, type Decor,
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
  private ghostIcon: THREE.Sprite | null = null;
  private ghostIconOk: boolean | null = null;
  /** last hovered cell while in build mode — shared with teammates */
  ghostCell: { x: number; y: number } | null = null;
  ghostOk = false;
  get activeType(): BuildingType | null { return this.buildType; }

  send: (cmd: Command) => void = () => {};
  ping: (pos: { x: number; y: number }) => void = () => {};
  onAttack: () => void = () => {};
  onBuildCancel: () => void = () => {};
  private lastPlacedCell: string | null = null;
  onSelectAt: (cell: { x: number; y: number }) => void = () => {};
  buildings: BuildingView[] = [];
  nodes: NodeView[] = [];
  riverP: RiverParams | null = null;
  decor: Decor[] = [];

  constructor(private stage: Stage, private canvas: HTMLCanvasElement) {
    addEventListener('keydown', e => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.key.toLowerCase());
    });
    addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
    // window-level listeners: overlays can never swallow world input.
    // UI clicks are filtered out by target instead.
    addEventListener('pointermove', e => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    addEventListener('contextmenu', e => {
      if (!isUiTarget(e.target)) e.preventDefault();
      if (this.buildType) this.onBuildCancel();   // right-click exits build mode
    });
    addEventListener('pointerdown', e => {
      if (e.button !== 0 || isUiTarget(e.target)) return;
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
    // floating ✓ / ✗ marker above the preview
    this.ghostIcon = makeGhostIcon();
    this.ghostIcon.position.y = 2.6;
    this.ghostIconOk = null;
    g.add(this.ghostIcon);
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
        if (decorBlocks(this.decor, { x: x + 0.5, y: y + 0.5 })) return false;
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
    this.ghostCell = cell;
    const ok = this.isValid(cell, size);
    this.ghostOk = ok;
    (this.ghostPlate!.material as THREE.MeshBasicMaterial).color.setHex(ok ? 0x6fbf63 : 0xc43a31);
    if (this.ghostIcon && ok !== this.ghostIconOk) {
      this.ghostIconOk = ok;
      drawGhostIcon(this.ghostIcon, ok);
    }
  }

  consumeKey(key: string): boolean {
    if (this.keys.has(key)) { this.keys.delete(key); return true; }
    return false;
  }
}

/** true when the event landed on interactive UI rather than the game world */
function isUiTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement &&
    target.closest('button, input, a, .overlay, .choice-overlay, .sel-panel, .minimap, .build-bar, .screen, .chat-input') !== null;
}

function makeGhostIcon(): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas), depthTest: false,
  }));
  sprite.scale.setScalar(0.8);
  sprite.userData.canvas = canvas;
  return sprite;
}

function drawGhostIcon(sprite: THREE.Sprite, ok: boolean): void {
  const canvas = sprite.userData.canvas as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 64, 64);
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  if (ok) {
    ctx.strokeStyle = '#6fbf63';
    ctx.beginPath();
    ctx.moveTo(14, 34); ctx.lineTo(27, 48); ctx.lineTo(50, 17);
    ctx.stroke();
  } else {
    ctx.strokeStyle = '#e0473c';
    ctx.beginPath();
    ctx.moveTo(17, 17); ctx.lineTo(47, 47);
    ctx.moveTo(47, 17); ctx.lineTo(17, 47);
    ctx.stroke();
  }
  (sprite.material.map as THREE.CanvasTexture).needsUpdate = true;
}
