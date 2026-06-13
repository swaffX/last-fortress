import * as THREE from 'three';
import {
  BUILDINGS, MAP_SIZE, riverParams, inRiver, inRiverBand, onBridge, crossesBridgeRail,
  decorBlocks, type EntityId, type RiverParams, type Decor,
} from '@lf/shared';
import type { BuildingView, PlayerView, NodeView, GroundItemView, CreatureView, ProjectileView } from '../net';
import {
  buildingModel, playerModel, treeModel, rockModel, bushModel, itemModel, toolModel,
  creatureModel, projectileModel,
} from './models';

interface Tracked {
  obj: THREE.Group;
  kind: string;            // "building:archer_tower:2" etc — rebuild when it changes
  from: THREE.Vector3;     // interpolation source
  to: THREE.Vector3;       // interpolation target
  hpBar?: THREE.Sprite;
  animT: number;           // personal animation clock (desynced per entity)
  attackT: number;         // >0 while playing an attack lunge
  deadT: number;           // >0 while playing death fall (enemies removed server-side, players stay)
  recoilT: number;         // tower recoil
  heading: number;         // current smoothed facing
  targetHeading: number;   // where the entity wants to face
  turnRate: number;        // smoothed angular velocity — drives banking lean
  stepSign: number;        // walk-cycle phase sign, flips on each stride
  toolT: number;           // >0 while a gathering tool is in hand
  toolKind: 'axe' | 'pick' | null;
  hitT: number;            // >0 right after taking damage — flash/shake window
  lastHp: number;
  swingHeading: number | null;   // locked facing while a swing plays
  mixer: THREE.AnimationMixer | null;   // set when the model is a GLB with clips
  actIdle: THREE.AnimationAction | null;
  actWalk: THREE.AnimationAction | null;
}

/** shortest-path angular damp: eases rotation instead of snapping */
function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * Math.min(1, lambda * dt);
}

/** Syncs server entity views into the Three scene; runs procedural animations. */
export class World {
  private tracked = new Map<EntityId, Tracked>();
  private nodes = new Map<EntityId, THREE.Group>();
  private groundItems = new Map<EntityId, THREE.Group>();
  private lerpT = 1;
  private frameInterval = 0.05;   // measured server frame cadence
  private lastFrameAt = 0;
  private time = 0;
  selfId: EntityId = -1;
  private selfPredicted: THREE.Vector3 | null = null;
  private selfDir = { x: 0, y: 0 };
  private riverP: RiverParams | null = null;
  /** latest frame views — prediction collides against the same world the sim does */
  colliders: { buildings: BuildingView[]; nodes: NodeView[] } = { buildings: [], nodes: [] };
  decor: Decor[] = [];

  setSeed(seed: number): void { this.riverP = riverParams(seed); }

  /** Fired once per stride of any walking player (footprints, dust, sfx). */
  onStep: (x: number, z: number, heading: number, side: -1 | 1, isSelf: boolean) => void = () => {};

  // ---- hover outline: parchment frame around the building under the cursor ----
  private hoverLine: THREE.Line | null = null;
  private hoverKey = '';

  setHover(b: BuildingView | null): void {
    const key = b ? `${b.id}` : '';
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    if (this.hoverLine) { this.scene.remove(this.hoverLine); this.hoverLine = null; }
    if (!b) return;
    const s = BUILDINGS[b.type].size;
    const x0 = b.pos.x - 0.08, x1 = b.pos.x + s + 0.08;
    const z0 = b.pos.y - 0.08, z1 = b.pos.y + s + 0.08;
    const pts = [
      new THREE.Vector3(x0, 0.1, z0), new THREE.Vector3(x1, 0.1, z0),
      new THREE.Vector3(x1, 0.1, z1), new THREE.Vector3(x0, 0.1, z1),
      new THREE.Vector3(x0, 0.1, z0),
    ];
    this.hoverLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xe8dfc8 }));
    this.scene.add(this.hoverLine);
  }

  // ---- lootable highlight: pulsing ring under the node the E key would hit ----
  private nodeRing: THREE.Mesh | null = null;
  private nodeRingTarget: EntityId | null = null;

  highlightNode(id: EntityId | null): void {
    if (id === this.nodeRingTarget) return;
    this.nodeRingTarget = id;
    if (!this.nodeRing) {
      this.nodeRing = new THREE.Mesh(
        new THREE.RingGeometry(0.55, 0.72, 16),
        new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.8, depthWrite: false }));
      this.nodeRing.rotation.x = -Math.PI / 2;
      this.nodeRing.position.y = 0.06;
      this.scene.add(this.nodeRing);
    }
    const g = id !== null ? this.nodes.get(id) : undefined;
    this.nodeRing.visible = !!g;
    if (g) this.nodeRing.position.set(g.position.x, 0.06, g.position.z);
  }

  // ---- teammate's build cursor: same green/red preview you see yourself ----
  private remoteGhost: THREE.Group | null = null;
  private remoteGhostKind: string | null = null;
  private remoteGhostPlate: THREE.Mesh | null = null;

  setRemoteGhost(type: string | null, pos: { x: number; y: number }, ok: boolean): void {
    if (!type) {
      if (this.remoteGhost) {
        this.scene.remove(this.remoteGhost);
        this.remoteGhost = null; this.remoteGhostKind = null; this.remoteGhostPlate = null;
      }
      return;
    }
    const size = BUILDINGS[type as keyof typeof BUILDINGS].size;
    if (this.remoteGhostKind !== type) {
      if (this.remoteGhost) this.scene.remove(this.remoteGhost);
      const model = buildingModel(type as Parameters<typeof buildingModel>[0], 1);
      model.traverse(o => {
        if (o instanceof THREE.Mesh) {
          const m = (o.material as THREE.MeshLambertMaterial).clone();
          m.transparent = true; m.opacity = 0.45;
          o.material = m;
          o.castShadow = false;
        }
      });
      this.remoteGhostPlate = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({ color: 0x6fbf63, transparent: true, opacity: 0.35, depthWrite: false }));
      this.remoteGhostPlate.rotation.x = -Math.PI / 2;
      this.remoteGhostPlate.position.y = 0.04;
      const g = new THREE.Group();
      g.add(model, this.remoteGhostPlate);
      this.remoteGhost = g;
      this.remoteGhostKind = type;
      this.scene.add(g);
    }
    this.remoteGhost!.position.set(pos.x + size / 2, 0, pos.y + size / 2);
    (this.remoteGhostPlate!.material as THREE.MeshBasicMaterial)
      .color.setHex(ok ? 0x6fbf63 : 0xc43a31);
  }

  private isSolidAt(x: number, y: number): boolean {
    if (decorBlocks(this.decor, { x, y })) return true;
    const cx = Math.floor(x), cy = Math.floor(y);
    for (const b of this.colliders.buildings) {
      if (BUILDINGS[b.type].walkable) continue;
      const s = BUILDINGS[b.type].size;
      if (cx >= b.pos.x && cx < b.pos.x + s && cy >= b.pos.y && cy < b.pos.y + s) return true;
    }
    for (const n of this.colliders.nodes) {
      if (n.pos.x === cx && n.pos.y === cy) return true;
    }
    return false;
  }

  constructor(private scene: THREE.Scene) {}

  setNodes(nodes: NodeView[]): void {
    for (const g of this.nodes.values()) this.scene.remove(g);
    this.nodes.clear();
    for (const n of nodes) {
      const hash = (n.pos.x * 73856093 ^ n.pos.y * 19349663) >>> 0;
      const g = n.kind === 'tree'
        ? treeModel(hash % 3, (hash % 100) / 100)
        : n.kind === 'bush' ? bushModel() : rockModel();
      g.position.set(n.pos.x + 0.5, 0, n.pos.y + 0.5);
      g.rotation.y = (n.pos.x * 7 + n.pos.y * 13) % 6.28;
      const s = 0.85 + ((hash >> 4) % 40) / 100;     // 0.85–1.25 size spread
      g.scale.setScalar(s);
      this.scene.add(g);
      this.nodes.set(n.id, g);
    }
  }

  /** Reconcile ground-item meshes against the latest frame (create/move/remove). */
  private syncGroundItems(items: GroundItemView[]): void {
    const seen = new Set<EntityId>();
    for (const gi of items) {
      seen.add(gi.id);
      let g = this.groundItems.get(gi.id);
      if (!g) {
        g = itemModel(gi.item);
        g.position.set(gi.pos.x, 0, gi.pos.y);
        this.scene.add(g);
        this.groundItems.set(gi.id, g);
      } else {
        g.position.x = gi.pos.x; g.position.z = gi.pos.y;
      }
    }
    for (const [id, g] of this.groundItems) {
      if (!seen.has(id)) { this.scene.remove(g); this.groundItems.delete(id); }
    }
  }

  /** Drop all entities (used when a fresh match starts in the same session). */
  reset(): void {
    for (const t of this.tracked.values()) this.scene.remove(t.obj);
    this.tracked.clear();
    for (const g of this.nodes.values()) this.scene.remove(g);
    this.nodes.clear();
    for (const g of this.groundItems.values()) this.scene.remove(g);
    this.groundItems.clear();
    this.selfPredicted = null;
  }

  /** Called once per server frame (20 Hz). render() interpolates between frames. */
  applyFrame(players: PlayerView[], buildings: BuildingView[],
             groundItems: GroundItemView[], creatures: CreatureView[] = [],
             projectiles: ProjectileView[] = []): void {
    const seen = new Set<EntityId>();

    for (const p of players) {
      seen.add(p.id);
      const t = this.upsert(p.id, `player:${p.alive}`, p.pos.x, p.pos.y,
        () => playerModel(), 1);   // hp shown on the nameplate, not the bar
      this.updateNameplate(t, p.id === this.selfId ? 'You' : p.name, p.hp / p.maxHp,
        p.id === this.selfId);
    }
    for (const c of creatures) {
      seen.add(c.id);
      this.upsert(c.id, `creature:${c.species}`, c.pos.x, c.pos.y,
        () => creatureModel(c.species), c.hp / c.maxHp);
    }
    for (const pr of projectiles) {
      seen.add(pr.id);
      this.upsert(pr.id, `proj:${pr.kind}`, pr.pos.x, pr.pos.y,
        () => projectileModel(pr.kind), 1);
    }
    for (const b of buildings) {
      seen.add(b.id);
      const size = BUILDINGS[b.type].size;
      this.upsert(b.id, `building:${b.type}`,
        b.pos.x + size / 2, b.pos.y + size / 2,
        () => buildingModel(b.type, 1),
        b.hp / b.maxHp, 2.6 + size);
    }

    for (const [id, t] of this.tracked) {
      if (!seen.has(id)) { this.scene.remove(t.obj); this.tracked.delete(id); }
    }
    this.syncGroundItems(groundItems);
    // adapt interpolation window to the real frame cadence (EMA, clamped)
    const now = performance.now() / 1000;
    if (this.lastFrameAt > 0) {
      const gap = Math.min(0.15, Math.max(0.03, now - this.lastFrameAt));
      this.frameInterval = this.frameInterval * 0.8 + gap * 0.2;
    }
    this.lastFrameAt = now;
    this.lerpT = 0;
  }

  /** Current movement input of the local player — drives client-side prediction. */
  setSelfDir(x: number, y: number): void { this.selfDir = { x, y }; }

  /** While aiming (mouse held), the self player faces this heading; null = free. */
  private aimHeading: number | null = null;
  setAimHeading(h: number | null): void { this.aimHeading = h; }

  removeNode(id: EntityId): void {
    const g = this.nodes.get(id);
    if (g) { this.scene.remove(g); this.nodes.delete(id); }
  }

  // ---- destruction: trees topple over, rocks crumble into the ground ----
  private dying: { obj: THREE.Group; t: number; kind: 'tree' | 'rock' | 'bush'; dir: number }[] = [];

  breakNode(id: EntityId, kind: 'tree' | 'rock' | 'bush'): void {
    const g = this.nodes.get(id);
    if (!g) return;
    this.nodes.delete(id);
    this.dying.push({ obj: g, t: 1, kind, dir: Math.random() * Math.PI * 2 });
  }

  /** Fired when a tracked building loses hp — main spawns dust there. */
  onBuildingHit: (x: number, z: number) => void = () => {};

  private upsert(id: EntityId, kind: string, x: number, y: number,
                 make: () => THREE.Group, hpRatio: number, barHeight = 2): Tracked {
    let t = this.tracked.get(id);
    if (t && t.kind !== kind) {
      // player death/respawn transitions reuse position but rebuild the model
      const dyingPlayer = kind.startsWith('player:') &&
        t.kind.endsWith(':true') && kind.endsWith(':false');
      this.scene.remove(t.obj);
      t = undefined;
      if (dyingPlayer) {
        const fresh = this.create(id, kind, x, y, make, barHeight);
        fresh.deadT = 1;
        updateHpBar(fresh.hpBar!, hpRatio);
        return fresh;
      }
    }
    if (!t) {
      t = this.create(id, kind, x, y, make, barHeight);
    } else {
      t.from.copy(t.obj.position);
      t.to.set(x, 0, y);
    }
    // damage-taken feedback: hp dropped since the last frame
    if (t.lastHp >= 0 && hpRatio < t.lastHp - 0.001) {
      t.hitT = 0.3;
      if (kind.startsWith('building')) this.onBuildingHit(x, y);
    }
    t.lastHp = hpRatio;
    updateHpBar(t.hpBar!, hpRatio);
    return t;
  }

  private create(id: EntityId, kind: string, x: number, y: number,
                 make: () => THREE.Group, barHeight: number): Tracked {
    const obj = make();
    obj.position.set(x, 0, y);
    const hpBar = makeHpBar();
    hpBar.position.y = barHeight;
    obj.add(hpBar);
    this.scene.add(obj);
    const t: Tracked = {
      obj, kind,
      from: new THREE.Vector3(x, 0, y), to: new THREE.Vector3(x, 0, y),
      hpBar, animT: (id % 31) * 0.21, attackT: 0, deadT: 0, recoilT: 0,
      heading: 0, targetHeading: 0, turnRate: 0, stepSign: 1,
      toolT: 0, toolKind: null, hitT: 0, lastHp: -1, swingHeading: null,
      mixer: null, actIdle: null, actWalk: null,
    };
    // GLB models carry animation clips — crossfade idle⇄walk by movement
    const clips = obj.userData.clips as THREE.AnimationClip[] | undefined;
    if (clips && clips.length) {
      const mixer = new THREE.AnimationMixer((obj.userData.assetRoot as THREE.Object3D) ?? obj);
      const find = (re: RegExp) => clips.find(c => re.test(c.name));
      const idleC = find(/idle/i) ?? clips[0]!;
      const walkC = find(/walk|run|gallop|move/i) ?? idleC;
      const idle = mixer.clipAction(idleC), walk = mixer.clipAction(walkC);
      idle.play(); walk.play(); idle.setEffectiveWeight(1); walk.setEffectiveWeight(0);
      t.mixer = mixer; t.actIdle = idle; t.actWalk = walk;
    }
    this.tracked.set(id, t);
    return t;
  }

  /** Nameplate sprite: name text with an hp bar underneath, hovering overhead. */
  private updateNameplate(t: Tracked, name: string, hpRatio: number, self: boolean): void {
    let plate = t.obj.userData.plate as THREE.Sprite | undefined;
    if (!plate) {
      const canvas = document.createElement('canvas');
      canvas.width = 128; canvas.height = 40;
      plate = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(canvas), depthTest: false,
      }));
      plate.scale.set(2.2, 0.69, 1);
      plate.position.y = 2.35;
      plate.userData.canvas = canvas;
      plate.userData.key = '';
      t.obj.add(plate);
      t.obj.userData.plate = plate;
      if (t.hpBar) t.hpBar.visible = false;   // nameplate replaces the bare bar
    }
    const key = `${name}|${hpRatio.toFixed(2)}|${self}`;
    if (plate.userData.key === key) return;
    plate.userData.key = key;
    const canvas = plate.userData.canvas as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 128, 40);
    ctx.font = '700 16px "Alegreya Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(name, 64, 16);
    ctx.fillStyle = self ? '#8fe07a' : '#e8dfc8';
    ctx.fillText(name, 64, 16);
    // hp bar under the name
    ctx.fillStyle = 'rgba(7,11,18,0.85)';
    ctx.fillRect(24, 24, 80, 9);
    const c = hpRatio > 0.5 ? '#6fbf63' : hpRatio > 0.25 ? '#e8b64c' : '#c43a31';
    ctx.fillStyle = c;
    ctx.fillRect(25, 25, 78 * Math.max(0, hpRatio), 7);
    (plate.material.map as THREE.CanvasTexture).needsUpdate = true;
  }

  /** Point the matching tower's turret at a target; kick recoil. Called on projectile events. */
  aimTower(from: { x: number; y: number }, to: { x: number; y: number }): void {
    let best: Tracked | null = null;
    let bd = 1.6;
    for (const t of this.tracked.values()) {
      if (!t.obj.userData.turret) continue;
      const d = Math.hypot(t.obj.position.x - from.x, t.obj.position.z - from.y);
      if (d < bd) { bd = d; best = t; }
    }
    if (!best) return;
    const turret = best.obj.userData.turret as THREE.Object3D;
    turret.rotation.y = Math.atan2(to.x - best.obj.position.x, to.y - best.obj.position.z);
    best.recoilT = 1;
  }

  /** Trigger an attack lunge on a specific entity (own player on attack input). */
  lunge(id: EntityId): void {
    const t = this.tracked.get(id);
    if (t && t.attackT <= 0) t.attackT = 1;
  }

  /** Swing animation for the nearest player to an action position (hits, chops). */
  lungePlayerAt(x: number, y: number): void {
    let best: Tracked | null = null;
    let bd = 3.4;
    for (const [, t] of this.tracked) {
      if (!t.kind.startsWith('player:')) continue;
      const d = Math.hypot(t.obj.position.x - x, t.obj.position.z - y);
      if (d < bd) { bd = d; best = t; }
    }
    if (best && best.attackT <= 0) best.attackT = 1;
  }

  // ---- weapon swing slash VFX ----
  private slashes: { mesh: THREE.Mesh; t: number }[] = [];

  /** Player swing: face the cursor, lunge, and sweep a fading arc slash toward it. */
  playerSwing(pos: { x: number; y: number }, dir: { x: number; y: number }): void {
    const len = Math.hypot(dir.x, dir.y) || 1;
    const dx = dir.x / len, dy = dir.y / len;
    const heading = Math.atan2(dx, dy);

    // turn the nearest player to face the swing and trigger the lunge
    let best: Tracked | null = null, bd = 3.4;
    for (const [, t] of this.tracked) {
      if (!t.kind.startsWith('player:')) continue;
      const d = Math.hypot(t.obj.position.x - pos.x, t.obj.position.z - pos.y);
      if (d < bd) { bd = d; best = t; }
    }
    if (best) {
      best.targetHeading = heading;
      best.heading = heading;           // snap so the body faces the cursor instantly
      best.obj.rotation.y = heading;
      best.swingHeading = heading;      // hold this facing while the swing plays
      best.attackT = 1;
    }

    // slash ribbon built directly from the aim vector (no rotation guesswork):
    // forward(h) = (sin h, cos h) matches the heading convention used everywhere.
    const ox = best ? best.obj.position.x : pos.x;
    const oz = best ? best.obj.position.z : pos.y;
    const SPREAD = 1.0, INNER = 0.7, OUTER = 1.7, SEG = 10, Y = 1.0;
    const verts: number[] = [];
    for (let i = 0; i <= SEG; i++) {
      const a = heading - SPREAD + (2 * SPREAD) * (i / SEG);
      const fx = Math.sin(a), fz = Math.cos(a);
      verts.push(ox + fx * INNER, Y, oz + fz * INNER);
      verts.push(ox + fx * OUTER, Y, oz + fz * OUTER);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const idx: number[] = [];
    for (let i = 0; i < SEG; i++) {
      const a0 = i * 2, b0 = i * 2 + 1, a1 = i * 2 + 2, b1 = i * 2 + 3;
      idx.push(a0, b0, a1, b0, b1, a1);
    }
    geo.setIndex(idx);
    const arc = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0xeef2ff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    this.scene.add(arc);
    this.slashes.push({ mesh: arc, t: 1 });
  }

  /**
   * Gathering swing: the nearest player faces the node, the weapon is
   * swapped for an axe/pickaxe in the right hand, and an overhead chop plays.
   */
  gatherSwing(x: number, y: number, resource: 'wood' | 'stone' | 'berry'): void {
    let best: Tracked | null = null;
    let bd = 3.4;
    for (const [, t] of this.tracked) {
      if (!t.kind.startsWith('player:')) continue;
      const d = Math.hypot(t.obj.position.x - x, t.obj.position.z - y);
      if (d < bd) { bd = d; best = t; }
    }
    if (!best) return;
    best.toolKind = resource === 'wood' ? 'axe' : resource === 'stone' ? 'pick' : null;
    best.toolT = resource === 'berry' ? 0 : 0.55;   // berries are hand-picked
    best.attackT = 1;                       // reuse the chop arc
    best.targetHeading = Math.atan2(x - best.obj.position.x, y - best.obj.position.z);
  }

  /** dt-based interpolation + prediction + procedural animation. */
  render(dt: number): void {
    this.time += dt;
    this.lerpT = Math.min(1, this.lerpT + dt / this.frameInterval);

    for (const [id, t] of this.tracked) {
      const isBuilding = t.kind.startsWith('building');

      if (id === this.selfId && t.kind.endsWith(':true')) {
        // client-side prediction: move instantly at sim speed, blend toward server
        if (!this.selfPredicted) this.selfPredicted = t.to.clone();
        const len = Math.hypot(this.selfDir.x, this.selfDir.y);
        const moving = len > 0.001;
        if (moving) {
          // mirror the sim: river slowdown + axis-separated solid collision
          const wading = this.riverP &&
            inRiver({ x: this.selfPredicted.x, y: this.selfPredicted.z }, this.riverP);
          const speed = wading ? 3 : 6;
          const stepX = (this.selfDir.x / len) * speed * dt;
          const stepY = (this.selfDir.y / len) * speed * dt;
          for (const [mx, my] of [[stepX, 0], [0, stepY]] as const) {
            const from = { x: this.selfPredicted.x, y: this.selfPredicted.z };
            const nx = THREE.MathUtils.clamp(from.x + mx, 0.5, MAP_SIZE - 0.5);
            const ny = THREE.MathUtils.clamp(from.y + my, 0.5, MAP_SIZE - 0.5);
            if (this.isSolidAt(nx, ny)) continue;
            if (this.riverP && crossesBridgeRail(from, { x: nx, y: ny }, this.riverP)) continue;
            this.selfPredicted.x = nx;
            this.selfPredicted.z = ny;
          }
        }
        // reconcile: gentle pull normally, hard snap if server disagrees a lot
        const err = this.selfPredicted.distanceTo(t.to);
        const pull = err > 2 ? 1 : Math.min(1, dt * (moving ? 2.5 : 8));
        this.selfPredicted.lerp(t.to, pull);
        t.obj.position.copy(this.selfPredicted);
        if (moving) t.targetHeading = Math.atan2(this.selfDir.x, this.selfDir.y);
        if (this.aimHeading !== null) t.targetHeading = this.aimHeading;   // combat stance
        if (t.swingHeading !== null) { if (t.attackT > 0) t.targetHeading = t.swingHeading; else t.swingHeading = null; }
        this.applyHeading(t, dt, (this.aimHeading !== null || t.swingHeading !== null) ? 26 : 12);
        this.applyDeckHeight(t, dt);
        if (t.mixer) this.tickMixer(t, moving, dt); else this.animateCharacter(t, moving, dt);
        continue;
      }

      t.obj.position.lerpVectors(t.from, t.to, this.lerpT);
      if (!isBuilding) {
        const dx = t.to.x - t.from.x, dz = t.to.z - t.from.z;
        const moving = Math.abs(dx) + Math.abs(dz) > 0.004;
        if (moving) t.targetHeading = Math.atan2(dx, dz);
        if (t.swingHeading !== null) { if (t.attackT > 0) t.targetHeading = t.swingHeading; else t.swingHeading = null; }
        this.applyHeading(t, dt, t.swingHeading !== null ? 30 : (t.kind.startsWith('player') ? 12 : 7));
        if (t.kind.startsWith('proj:')) {
          t.obj.position.y = 1.1;   // projectiles fly chest-height
        } else {
          this.applyDeckHeight(t, dt);
          if (t.mixer) this.tickMixer(t, moving, dt); else this.animateCharacter(t, moving, dt);
        }
      } else {
        this.animateBuilding(t, dt);
      }
    }

    // weapon slash arcs fade + expand
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const s = this.slashes[i]!;
      s.t -= dt * 5;
      if (s.t <= 0) { this.scene.remove(s.mesh); s.mesh.geometry.dispose(); this.slashes.splice(i, 1); continue; }
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = s.t * 0.8;
    }

    // falling trees / crumbling rocks
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i]!;
      d.t -= dt;
      if (d.t <= 0) {
        this.scene.remove(d.obj);
        this.dying.splice(i, 1);
        continue;
      }
      const k = 1 - d.t;   // 0 → 1 over the second
      if (d.kind === 'tree') {
        // tip over with accelerating ease, then sink into the ground
        const fall = Math.min(1, k * 1.6);
        d.obj.rotation.x = Math.cos(d.dir) * fall * (Math.PI / 2.2);
        d.obj.rotation.z = Math.sin(d.dir) * fall * (Math.PI / 2.2);
        if (k > 0.65) d.obj.position.y = -(k - 0.65) * 2.2;
      } else {
        // rocks shrink and sink
        const s = Math.max(0.01, 1 - k * 1.2);
        d.obj.scale.setScalar(s);
        d.obj.position.y = -k * 0.4;
        d.obj.rotation.y += dt * 2;
      }
    }

    // lootable ring pulse
    if (this.nodeRing?.visible) {
      const k = 1 + Math.sin(this.time * 5) * 0.12;
      this.nodeRing.scale.setScalar(k);
      (this.nodeRing.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(this.time * 5) * 0.25;
    }

    // ambient: tree sway
    for (const g of this.nodes.values()) {
      const sway = g.userData.sway as THREE.Object3D[] | undefined;
      if (!sway) continue;
      const phase = g.position.x * 0.7 + g.position.z * 0.4;
      for (const s of sway) {
        s.rotation.x = Math.sin(this.time * 0.8 + phase) * 0.04;
        s.rotation.z = Math.cos(this.time * 0.6 + phase) * 0.04;
      }
    }

    // ground items bob and spin
    for (const g of this.groundItems.values()) {
      const bob = g.userData.bob as THREE.Mesh | undefined;
      if (!bob) continue;
      bob.position.y = 0.3 + Math.sin(this.time * 3 + g.position.x) * 0.08;
      bob.rotation.y += dt * 1.5;
    }
  }

  /** Advance a GLB creature's mixer, crossfading idle⇄walk by movement. */
  private tickMixer(t: Tracked, moving: boolean, dt: number): void {
    if (!t.mixer) return;
    if (t.actWalk && t.actIdle) {
      const cur = t.actWalk.getEffectiveWeight();
      const w = cur + ((moving ? 1 : 0) - cur) * Math.min(1, dt * 8);
      t.actWalk.setEffectiveWeight(w);
      t.actIdle.setEffectiveWeight(1 - w);
    }
    t.mixer.update(dt);
  }

  /** Eased turning + banking: characters lean into turns instead of snapping. */
  private applyHeading(t: Tracked, dt: number, lambda: number): void {
    const before = t.heading;
    t.heading = dampAngle(t.heading, t.targetHeading, lambda, dt);
    let dh = t.heading - before;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const instRate = dt > 0 ? dh / dt : 0;
    t.turnRate += (instRate - t.turnRate) * Math.min(1, dt * 10);
    t.obj.rotation.y = t.heading;
    // banking lean is for the humanoid rig; GLB quadrupeds must stay upright
    t.obj.rotation.z = t.mixer ? 0 : THREE.MathUtils.clamp(-t.turnRate * 0.045, -0.16, 0.16);
  }

  /** Characters step up onto the bridge deck instead of clipping through it. */
  private applyDeckHeight(t: Tracked, dt: number): void {
    if (!this.riverP) return;
    const pos = { x: t.obj.position.x, y: t.obj.position.z };
    const onDeck = onBridge(pos) && inRiverBand(pos.x, pos.y, this.riverP, 1.2);
    const targetY = onDeck ? 0.45 : 0;
    t.obj.position.y += (targetY - t.obj.position.y) * Math.min(1, dt * 10);
  }

  /** Red damage flash on body+head, restoring original emissive afterwards. */
  private applyHitFlash(t: Tracked, dt: number): void {
    if (t.hitT <= 0) return;
    t.hitT = Math.max(0, t.hitT - dt);
    const u = t.obj.userData;
    const parts = [u.body, u.head].filter(Boolean) as THREE.Mesh[];
    for (const m of parts) {
      const mat = m.material as THREE.MeshLambertMaterial;
      if (m.userData.origEmissive === undefined) {
        m.userData.origEmissive = mat.emissive.getHex();
        m.userData.origEmissiveI = mat.emissiveIntensity;
      }
      if (t.hitT > 0) {
        mat.emissive.setHex(0xff4433);
        mat.emissiveIntensity = t.hitT * 2.5;
      } else {
        mat.emissive.setHex(m.userData.origEmissive as number);
        mat.emissiveIntensity = m.userData.origEmissiveI as number;
      }
    }
  }

  private animateCharacter(t: Tracked, moving: boolean, dt: number): void {
    this.applyHitFlash(t, dt);
    const u = t.obj.userData;
    const legs = u.legs as THREE.Mesh[] | undefined;
    const arms = u.arms as THREE.Mesh[] | undefined;
    const body = u.body as THREE.Mesh | undefined;
    if (!legs || !arms || !body) return;

    // death fall (players keep their corpse until respawn)
    if (t.kind.startsWith('player:') && t.kind.endsWith(':false')) {
      t.deadT = Math.max(0, t.deadT - dt * 2);
      t.obj.rotation.x = -Math.PI / 2 * (1 - t.deadT);
      t.obj.position.y = -0.1 * (1 - t.deadT);
      return;
    }
    t.obj.rotation.x = 0;

    t.animT += dt;
    const isZombie = t.kind.startsWith('enemy');
    const rate = moving ? (isZombie ? 7 : 10) : 1.6;
    const swing = Math.sin(t.animT * rate);
    const head = u.head as THREE.Mesh | undefined;

    if (moving) {
      // stride event when the swing phase flips (player feet hit the ground)
      const sign = swing >= 0 ? 1 : -1;
      if (sign !== t.stepSign && !isZombie) {
        t.stepSign = sign;
        const id = [...this.tracked.entries()].find(([, v]) => v === t)?.[0];
        this.onStep(t.obj.position.x, t.obj.position.z, t.heading,
          sign as -1 | 1, id === this.selfId);
      }
      legs[0]!.rotation.x = swing * 0.7;
      legs[1]!.rotation.x = -swing * 0.7;
      const armBase = isZombie ? -0.9 : 0;
      arms[0]!.rotation.x = armBase - swing * (isZombie ? 0.15 : 0.45);
      arms[1]!.rotation.x = armBase + swing * (isZombie ? 0.15 : 0.45);
      body.position.y = 0.75 + Math.abs(Math.sin(t.animT * rate)) * 0.05;
      // lean into the run, hips roll with the stride, head bobs slightly
      body.rotation.x = isZombie ? 0 : 0.09;
      body.rotation.z = swing * 0.04;
      if (head) {
        head.position.y = 1.36 + Math.abs(swing) * 0.03;
        head.rotation.y = 0;
      }
    } else {
      // idle: weight shift, slow breathing, lazy look-around
      legs[0]!.rotation.x = legs[1]!.rotation.x = 0;
      body.position.y = 0.75 + Math.sin(t.animT * 1.6) * 0.018;
      body.rotation.x = 0;
      body.rotation.z = Math.sin(t.animT * 0.8) * 0.025;
      const armBase = isZombie ? -0.9 : 0;
      arms[0]!.rotation.x = armBase + Math.sin(t.animT * 1.6) * 0.05;
      arms[1]!.rotation.x = armBase - Math.sin(t.animT * 1.6 + 0.6) * 0.05;
      if (head && !isZombie) {
        head.rotation.y = Math.sin(t.animT * 0.45) * 0.4;       // scan surroundings
        head.position.y = 1.36;
      }
      // zombies standing still are attacking something — periodic lunge
      if (isZombie && t.attackT <= 0 && Math.random() < dt * 1.2) t.attackT = 1;
    }

    // gathering tool: hide the weapon, show axe/pick in the right hand
    if (t.toolT > 0) {
      t.toolT = Math.max(0, t.toolT - dt);
      const armR = arms[1]!;
      let tool = armR.userData[`tool_${t.toolKind}`] as THREE.Group | undefined;
      if (!tool && t.toolKind) {
        tool = toolModel(t.toolKind);
        armR.add(tool);
        armR.userData[`tool_${t.toolKind}`] = tool;
      }
      const weapon = u.weaponParts as THREE.Object3D[] | undefined;
      if (weapon) for (const w of weapon) w.visible = false;
      for (const k of ['axe', 'pick'] as const) {
        const tm = armR.userData[`tool_${k}`] as THREE.Group | undefined;
        if (tm) tm.visible = k === t.toolKind;
      }
    } else {
      const armR = arms[1]!;
      const weapon = u.weaponParts as THREE.Object3D[] | undefined;
      if (weapon) for (const w of weapon) w.visible = true;
      for (const k of ['axe', 'pick'] as const) {
        const tm = armR.userData[`tool_${k}`] as THREE.Group | undefined;
        if (tm) tm.visible = false;
      }
    }

    // attack lunge: arms slam down, body pitches into the strike
    if (t.attackT > 0) {
      t.attackT = Math.max(0, t.attackT - dt * 3.5);
      const k = Math.sin((1 - t.attackT) * Math.PI);
      const armBase = isZombie ? -0.9 : 0;
      arms[1]!.rotation.x = armBase - k * 1.6;
      if (!isZombie) arms[0]!.rotation.x = 0;
      body.rotation.x += k * 0.12;
    }

    // cape / cloth flutter
    const flags = u.flags as THREE.Mesh[] | undefined;
    if (flags) {
      for (const f of flags) {
        f.rotation.x = 0.15 + Math.sin(this.time * 3 + t.animT) * 0.08 + (moving ? 0.25 : 0);
      }
    }
  }

  private animateBuilding(t: Tracked, dt: number): void {
    const u = t.obj.userData;
    // impact shudder: quick decaying wobble when the structure takes a hit
    if (t.hitT > 0) {
      t.hitT = Math.max(0, t.hitT - dt);
      t.obj.rotation.z = Math.sin(t.hitT * 55) * 0.045 * t.hitT;
      t.obj.position.y = Math.sin(t.hitT * 70) * 0.03 * t.hitT;
    } else if (t.obj.rotation.z !== 0) {
      t.obj.rotation.z = 0;
      t.obj.position.y = 0;
    }
    const turret = u.turret as THREE.Object3D | undefined;
    if (turret && t.recoilT > 0) {
      t.recoilT = Math.max(0, t.recoilT - dt * 5);
      turret.position.z = -Math.sin(t.recoilT * Math.PI) * 0.12;
    }
    const spin = u.spin as THREE.Object3D[] | undefined;
    if (spin) for (const s of spin) s.rotation.y += dt * 1.2;
    const pulse = u.pulse as THREE.Mesh[] | undefined;
    if (pulse) {
      const k = 0.55 + Math.sin(this.time * 2.5 + t.animT) * 0.3;
      for (const p of pulse) (p.material as THREE.MeshLambertMaterial).emissiveIntensity = k;
    }
    const flags = u.flags as THREE.Mesh[] | undefined;
    if (flags) {
      for (let i = 0; i < flags.length; i++) {
        flags[i]!.rotation.y = Math.sin(this.time * 2.2 + i * 1.7) * 0.35;
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
