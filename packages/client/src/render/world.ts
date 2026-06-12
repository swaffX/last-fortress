import * as THREE from 'three';
import { BUILDINGS, type EntityId } from '@lf/shared';
import type { BuildingView, EnemyView, PlayerView, NodeView } from '../net';
import { buildingModel, enemyModel, playerModel, treeModel, rockModel } from './models';

interface Tracked {
  obj: THREE.Group;
  kind: string;            // "building:archer_tower:2" etc — rebuild when it changes
  from: THREE.Vector3;     // interpolation source
  to: THREE.Vector3;       // interpolation target
  hpBar?: THREE.Sprite;
}

/** Syncs server entity views into the Three scene with interpolation. */
export class World {
  private tracked = new Map<EntityId, Tracked>();
  private nodes = new Map<EntityId, THREE.Group>();
  private lerpT = 1;
  selfId: EntityId = -1;

  constructor(private scene: THREE.Scene) {}

  setNodes(nodes: NodeView[]): void {
    for (const g of this.nodes.values()) this.scene.remove(g);
    this.nodes.clear();
    for (const n of nodes) {
      const g = n.kind === 'tree' ? treeModel() : rockModel();
      g.position.set(n.pos.x + 0.5, 0, n.pos.y + 0.5);
      g.rotation.y = (n.pos.x * 7 + n.pos.y * 13) % 6.28;
      this.scene.add(g);
      this.nodes.set(n.id, g);
    }
  }

  /** Called once per server frame (20 Hz). render() interpolates between frames. */
  applyFrame(players: PlayerView[], enemies: EnemyView[], buildings: BuildingView[],
             depletedNodeIds?: EntityId[]): void {
    const seen = new Set<EntityId>();

    for (const p of players) {
      seen.add(p.id);
      this.upsert(p.id, `player:${p.klass}:${p.alive}`, p.pos.x, p.pos.y,
        () => {
          const m = playerModel(p.klass);
          if (!p.alive) m.rotation.x = Math.PI / 2;
          return m;
        }, p.hp / p.maxHp);
    }
    for (const e of enemies) {
      seen.add(e.id);
      const t = this.upsert(e.id, `enemy:${e.type}:${e.enraged}`, e.pos.x, e.pos.y,
        () => {
          const m = enemyModel(e.type);
          if (e.enraged) m.scale.multiplyScalar(1.15);
          return m;
        }, e.hp / e.maxHp);
      // slowed tint
      t.obj.traverse(o => {
        if (o instanceof THREE.Mesh) {
          const m = o.material as THREE.MeshLambertMaterial;
          if (e.slowed) m.color.offsetHSL(0, 0, 0); // tint via emissive instead
          m.emissive ??= new THREE.Color(0);
        }
      });
    }
    for (const b of buildings) {
      seen.add(b.id);
      const size = BUILDINGS[b.type].size;
      this.upsert(b.id, `building:${b.type}:${b.tier}`,
        b.pos.x + size / 2, b.pos.y + size / 2,
        () => buildingModel(b.type, b.tier),
        b.hp / b.maxHp, 2.6 + size);
    }

    for (const [id, t] of this.tracked) {
      if (!seen.has(id)) { this.scene.remove(t.obj); this.tracked.delete(id); }
    }
    if (depletedNodeIds) {
      for (const id of depletedNodeIds) {
        const g = this.nodes.get(id);
        if (g) { this.scene.remove(g); this.nodes.delete(id); }
      }
    }
    this.lerpT = 0;
  }

  private upsert(id: EntityId, kind: string, x: number, y: number,
                 make: () => THREE.Group, hpRatio: number, barHeight = 2): Tracked {
    let t = this.tracked.get(id);
    if (t && t.kind !== kind) { this.scene.remove(t.obj); t = undefined; }
    if (!t) {
      const obj = make();
      obj.position.set(x, 0, y);
      const hpBar = makeHpBar();
      hpBar.position.y = barHeight;
      obj.add(hpBar);
      this.scene.add(obj);
      t = { obj, kind, from: new THREE.Vector3(x, 0, y), to: new THREE.Vector3(x, 0, y), hpBar };
      this.tracked.set(id, t);
    } else {
      t.from.copy(t.obj.position);
      t.to.set(x, 0, y);
    }
    updateHpBar(t.hpBar!, hpRatio);
    return t;
  }

  /** dt-based interpolation between the last two server frames (50 ms apart). */
  render(dt: number): void {
    this.lerpT = Math.min(1, this.lerpT + dt / 0.05);
    for (const t of this.tracked.values()) {
      t.obj.position.lerpVectors(t.from, t.to, this.lerpT);
      const dx = t.to.x - t.from.x, dz = t.to.z - t.from.z;
      if (Math.abs(dx) + Math.abs(dz) > 0.001 && !t.kind.startsWith('building')) {
        t.obj.rotation.y = Math.atan2(dx, dz);
      }
    }
  }

  positionOf(id: EntityId): THREE.Vector3 | null {
    return this.tracked.get(id)?.obj.position ?? null;
  }
}

function makeHpBar(): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 8;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas), depthTest: false,
  }));
  sprite.scale.set(1.4, 0.18, 1);
  sprite.userData.canvas = canvas;
  sprite.userData.ratio = -1;
  return sprite;
}

function updateHpBar(sprite: THREE.Sprite, ratio: number): void {
  if (Math.abs(sprite.userData.ratio - ratio) < 0.01) return;
  sprite.userData.ratio = ratio;
  sprite.visible = ratio < 0.999;
  const canvas = sprite.userData.canvas as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 64, 8);
  ctx.fillStyle = '#0d1420';
  ctx.fillRect(0, 0, 64, 8);
  ctx.fillStyle = ratio > 0.5 ? '#6fbf63' : ratio > 0.25 ? '#e8b64c' : '#c43a31';
  ctx.fillRect(1, 1, 62 * Math.max(0, ratio), 6);
  (sprite.material.map as THREE.CanvasTexture).needsUpdate = true;
}
