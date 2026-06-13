import type {
  SimState, SimEvent, Command, Player, Building, EntityId, Vec2,
  ResourceNode, BuildingType,
} from './types';
import { Rng } from './rng';
import { Grid } from './grid';
import { generateMap, type MapData } from './mapgen';
import { generateRegions, regionAt, type RegionMap } from './regions';
import { BUILDINGS } from './data/buildings';
import { applySkills } from './data/skills';
import { dist } from './combat';
import { ITEMS, type ItemId, type Slot } from './data/items';
import {
  addItem, removeItem, countItem, emptyInventory, moveSlot,
} from './inventory';
import {
  riverParams, inRiver, crossesBridgeRail, inRiverBand, type RiverParams,
} from './river';
import { generateDecor, decorBlocks, type Decor } from './decor';
import {
  MAP_SIZE, CAMP_POS, DAY_TICKS, NIGHT_TICKS, PLAYER_SPEED, PLAYER_MAX_HP,
  RESPAWN_TICKS, INVENTORY_SLOTS, HUNGER_MAX, HUNGER_START,
  HUNGER_DECAY_IDLE, HUNGER_DECAY_ACTIVE, STARVE_DMG, BARE_HAND_YIELD,
  GATHER_COOLDOWN, GATHER_RANGE, ITEM_TTL_TICKS, PICKUP_RANGE,
  NODE_AMOUNT, BUSH_REGROW_TICKS,
} from './constants';

const NODE_ITEM: Record<ResourceNode['kind'], ItemId> = {
  tree: 'wood', rock: 'stone', bush: 'berry',
};

export class Sim {
  readonly state: SimState;
  readonly grid: Grid;
  readonly map: MapData;
  readonly rng: Rng;
  readonly river: RiverParams;
  readonly decor: Decor[];
  readonly regions: RegionMap;
  private moveIntent = new Map<EntityId, Vec2>();
  private lastRegion = new Map<EntityId, number>();
  private buildQueue: { playerId: EntityId; type: BuildingType; pos: Vec2 }[] = [];
  private demolishQueue: EntityId[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.grid = new Grid(MAP_SIZE);
    this.river = riverParams(seed);
    this.regions = generateRegions(seed);
    this.map = generateMap(this.rng, this.river, this.regions);
    this.decor = generateDecor(seed, this.river, this.map.nodes);
    this.state = {
      tick: 0, worldSeed: seed, phase: 'day', phaseTicks: DAY_TICKS,
      buildings: new Map(), players: new Map(), nodes: new Map(),
      groundItems: new Map(), nextId: 1,
    };
    for (const n of this.map.nodes) {
      const id = this.state.nextId++;
      this.state.nodes.set(id, {
        id, kind: n.kind, pos: n.pos, amount: NODE_AMOUNT[n.kind], regrowTicks: 0,
      });
      this.grid.occupy(n.pos, 1, id);
    }
  }

  /** Rebuild a running sim from a saved snapshot (world persistence). */
  static fromState(state: SimState): Sim {
    const sim = new Sim(state.worldSeed);
    sim.state.tick = state.tick;
    sim.state.phase = state.phase;
    sim.state.phaseTicks = state.phaseTicks;
    sim.state.nextId = state.nextId;
    sim.state.buildings = state.buildings;
    sim.state.players = state.players;
    sim.state.nodes = state.nodes;
    sim.state.groundItems = state.groundItems;
    sim.grid.reset();
    for (const n of sim.state.nodes.values()) if (n.amount > 0) sim.grid.occupy(n.pos, 1, n.id);
    for (const b of sim.state.buildings.values()) sim.grid.occupy(b.pos, BUILDINGS[b.type].size, b.id);
    return sim;
  }

  addPlayer(skills: string[] = []): Player {
    const id = this.state.nextId++;
    const p: Player = {
      id, pos: { x: CAMP_POS.x + this.rng.int(-3, 3), y: CAMP_POS.y + this.rng.int(-3, 3) },
      hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP, alive: true, respawnTicks: 0,
      mods: applySkills(skills),
      inventory: emptyInventory(INVENTORY_SLOTS),
      equipment: { head: null, body: null, legs: null },
      hand: 0, hunger: HUNGER_START, temperature: 100,
      gatherCooldown: 0, gatherTarget: null,
    };
    this.state.players.set(id, p);
    return p;
  }

  removePlayer(id: EntityId): void {
    this.state.players.delete(id);
    this.moveIntent.delete(id);
    this.lastRegion.delete(id);
  }

  applyCommand(playerId: EntityId, cmd: Command): void {
    const p = this.state.players.get(playerId);
    if (!p || !p.alive) return;
    switch (cmd.kind) {
      case 'move': this.moveIntent.set(playerId, cmd.dir); break;
      case 'gather': {
        let best: ResourceNode | null = null, bd = GATHER_RANGE;
        for (const n of this.state.nodes.values()) {
          if (n.amount <= 0) continue;
          const d = dist({ x: n.pos.x + 0.5, y: n.pos.y + 0.5 }, p.pos);
          if (d <= bd) { bd = d; best = n; }
        }
        if (best) p.gatherTarget = best.id;
        break;
      }
      case 'eat': {
        if (removeItem(p.inventory, 'berry', 1)) {
          p.hunger = Math.min(HUNGER_MAX, p.hunger + (ITEMS.berry.foodValue ?? 0));
        }
        break;
      }
      case 'select_hand':
        if (Number.isInteger(cmd.slot) && cmd.slot >= 0 && cmd.slot < 9) p.hand = cmd.slot;
        break;
      case 'move_item': moveSlot(p.inventory, cmd.from, cmd.to); break;
      case 'drop_item': this.dropFromSlot(p, cmd.slot, cmd.count); break;
      case 'build': this.buildQueue.push({ playerId, type: cmd.type, pos: cmd.pos }); break;
      case 'demolish': this.demolishQueue.push(cmd.buildingId); break;
    }
  }

  step(): SimEvent[] {
    const events: SimEvent[] = [];
    this.state.tick++;
    this.stepClock(events);
    this.stepBuildCommands(events);
    this.stepPlayers(events);
    this.stepGather(events);
    this.stepHunger(events);
    this.stepGroundItems(events);
    this.stepNodeRegrow();
    this.stepRespawns(events);
    this.stepRegions(events);
    this.clearIntents();
    return events;
  }

  private stepClock(events: SimEvent[]): void {
    if (--this.state.phaseTicks > 0) return;
    this.state.phase = this.state.phase === 'day' ? 'night' : 'day';
    this.state.phaseTicks = this.state.phase === 'day' ? DAY_TICKS : NIGHT_TICKS;
    events.push({ kind: 'phase_change', phase: this.state.phase });
  }

  private stepBuildCommands(events: SimEvent[]): void {
    for (const req of this.buildQueue) {
      const p = this.state.players.get(req.playerId);
      if (!p || !p.alive) continue;
      const def = BUILDINGS[req.type];
      const pos = { x: Math.floor(req.pos.x), y: Math.floor(req.pos.y) };
      if (!this.grid.canPlace(pos, def.size)) continue;
      if (this.footprintInRiver(pos, def.size)) continue;
      if (this.footprintOnDecor(pos, def.size)) continue;
      if (!this.canAffordBuild(p, def.cost)) continue;
      for (const [item, n] of Object.entries(def.cost)) removeItem(p.inventory, item as ItemId, n!);
      this.makeBuilding(req.type, pos);
      events.push({ kind: 'build_placed', pos, type: req.type });
    }
    this.buildQueue.length = 0;

    for (const id of this.demolishQueue) {
      const b = this.state.buildings.get(id);
      if (!b) continue;
      this.grid.clear(b.pos, BUILDINGS[b.type].size);
      this.state.buildings.delete(id);
    }
    this.demolishQueue.length = 0;
  }

  private canAffordBuild(p: Player, cost: Partial<Record<ItemId, number>>): boolean {
    for (const [item, n] of Object.entries(cost)) {
      if (countItem(p.inventory, item as ItemId) < n!) return false;
    }
    return true;
  }

  /** Channeled gathering → items land in the player's inventory. */
  private stepGather(events: SimEvent[]): void {
    for (const p of this.state.players.values()) {
      if (p.gatherTarget === null || !p.alive) { p.gatherTarget = null; continue; }
      const node = this.state.nodes.get(p.gatherTarget);
      if (!node || node.amount <= 0) { p.gatherTarget = null; continue; }
      const center = { x: node.pos.x + 0.5, y: node.pos.y + 0.5 };
      if (dist(center, p.pos) > GATHER_RANGE + 0.4) { p.gatherTarget = null; continue; }
      if (p.gatherCooldown > 0) continue;
      p.gatherCooldown = GATHER_COOLDOWN;
      const take = Math.min(BARE_HAND_YIELD, node.amount);
      node.amount -= take;
      const item = NODE_ITEM[node.kind];
      const leftover = addItem(p.inventory, item, take);
      if (leftover > 0) this.spawnGroundItem(item, leftover, p.pos);
      events.push({ kind: 'gather', resource: item, amount: take, nodeId: node.id,
        remaining: node.amount, pos: { ...center } });
      if (node.amount <= 0) {
        if (node.kind === 'bush') {
          node.regrowTicks = BUSH_REGROW_TICKS;
          this.grid.clear(node.pos, 1);     // depleted bush is walkable until regrow
        } else {
          this.grid.clear(node.pos, 1);
          this.state.nodes.delete(node.id);
        }
        events.push({ kind: 'node_depleted', nodeId: node.id, pos: { ...node.pos } });
        for (const o of this.state.players.values()) if (o.gatherTarget === node.id) o.gatherTarget = null;
      }
    }
  }

  private stepHunger(events: SimEvent[]): void {
    for (const p of this.state.players.values()) {
      if (!p.alive) continue;
      const active = this.moveIntent.has(p.id) || p.gatherTarget !== null;
      p.hunger = Math.max(0, p.hunger - (active ? HUNGER_DECAY_ACTIVE : HUNGER_DECAY_IDLE));
      if (p.hunger <= 0) {
        p.hp -= STARVE_DMG;
        if (p.hp <= 0) this.killPlayer(p, events);
      }
    }
  }

  private stepGroundItems(events: SimEvent[]): void {
    for (const gi of [...this.state.groundItems.values()]) {
      if (--gi.ttlTicks <= 0) { this.state.groundItems.delete(gi.id); continue; }
      for (const p of this.state.players.values()) {
        if (!p.alive) continue;
        if (dist(p.pos, gi.pos) > PICKUP_RANGE) continue;
        const leftover = addItem(p.inventory, gi.item, gi.count);
        const got = gi.count - leftover;
        if (got > 0) events.push({ kind: 'pickup', pos: { ...gi.pos }, item: gi.item, count: got, playerId: p.id });
        gi.count = leftover;
        if (gi.count <= 0) { this.state.groundItems.delete(gi.id); break; }
      }
    }
  }

  private stepNodeRegrow(): void {
    for (const n of this.state.nodes.values()) {
      if (n.regrowTicks > 0 && --n.regrowTicks === 0) {
        n.amount = NODE_AMOUNT[n.kind];
        this.grid.occupy(n.pos, 1, n.id);    // regrown bush blocks again
      }
    }
  }

  private stepRespawns(events: SimEvent[]): void {
    for (const p of this.state.players.values()) {
      if (p.alive) continue;
      if (--p.respawnTicks <= 0) {
        p.alive = true;
        p.hp = p.maxHp;
        p.hunger = 60;
        p.pos = { x: CAMP_POS.x + this.rng.int(-3, 3), y: CAMP_POS.y + this.rng.int(-3, 3) };
        events.push({ kind: 'player_respawn', id: p.id, pos: { ...p.pos } });
      }
    }
  }

  private stepRegions(events: SimEvent[]): void {
    for (const p of this.state.players.values()) {
      if (!p.alive) continue;
      const r = regionAt(this.regions, p.pos);
      if (this.lastRegion.get(p.id) !== r.id) {
        this.lastRegion.set(p.id, r.id);
        events.push({ kind: 'region_enter', id: p.id, region: r.name });
      }
    }
  }

  private killPlayer(p: Player, events: SimEvent[]): void {
    p.alive = false; p.hp = 0; p.respawnTicks = RESPAWN_TICKS; p.gatherTarget = null;
    const drop = (s: Slot) => { if (s) this.spawnGroundItem(s.item, s.count, p.pos); };
    for (let i = 0; i < p.inventory.length; i++) { drop(p.inventory[i]!); p.inventory[i] = null; }
    drop(p.equipment.head); drop(p.equipment.body); drop(p.equipment.legs);
    p.equipment = { head: null, body: null, legs: null };
    events.push({ kind: 'player_died', id: p.id, pos: { ...p.pos } });
  }

  damagePlayer(id: EntityId, amount: number, events: SimEvent[]): void {
    const p = this.state.players.get(id);
    if (!p || !p.alive) return;
    p.hp -= amount;
    events.push({ kind: 'damage', pos: { ...p.pos }, amount, crit: false });
    if (p.hp <= 0) this.killPlayer(p, events);
  }

  private dropFromSlot(p: Player, slot: number, count: number): void {
    if (slot < 0 || slot >= p.inventory.length) return;
    const s = p.inventory[slot];
    if (!s) return;
    const n = Math.min(count, s.count);
    if (n <= 0) return;
    this.spawnGroundItem(s.item, n, { x: p.pos.x, y: p.pos.y });
    s.count -= n;
    if (s.count <= 0) p.inventory[slot] = null;
  }

  private spawnGroundItem(item: ItemId, count: number, pos: Vec2): void {
    const id = this.state.nextId++;
    this.state.groundItems.set(id, {
      id, item, count, ttlTicks: ITEM_TTL_TICKS,
      pos: { x: pos.x + (this.rng.next() - 0.5) * 0.6, y: pos.y + (this.rng.next() - 0.5) * 0.6 },
    });
  }

  private stepPlayers(_events: SimEvent[]): void {
    for (const p of this.state.players.values()) {
      if (!p.alive) continue;
      if (p.gatherCooldown > 0) p.gatherCooldown--;
      const dir = this.moveIntent.get(p.id);
      if (dir) {
        p.gatherTarget = null;
        const wading = inRiver(p.pos, this.river);
        const speed = PLAYER_SPEED * (wading ? 0.5 : 1);
        const len = Math.hypot(dir.x, dir.y) || 1;
        this.tryMovePlayer(p, (dir.x / len) * speed, 0);
        this.tryMovePlayer(p, 0, (dir.y / len) * speed);
      }
    }
  }

  private clearIntents(): void { this.moveIntent.clear(); }

  private tryMovePlayer(p: Player, dx: number, dy: number): void {
    const next = {
      x: clamp(p.pos.x + dx, 0.5, MAP_SIZE - 0.5),
      y: clamp(p.pos.y + dy, 0.5, MAP_SIZE - 0.5),
    };
    if (this.isSolidAt(next)) return;
    if (crossesBridgeRail(p.pos, next, this.river)) return;
    p.pos.x = next.x; p.pos.y = next.y;
  }

  footprintOnDecor(pos: Vec2, size: number): boolean {
    for (let y = pos.y; y < pos.y + size; y++)
      for (let x = pos.x; x < pos.x + size; x++)
        if (decorBlocks(this.decor, { x: x + 0.5, y: y + 0.5 })) return true;
    return false;
  }
  footprintInRiver(pos: Vec2, size: number): boolean {
    for (let y = pos.y; y < pos.y + size; y++)
      for (let x = pos.x; x < pos.x + size; x++)
        if (inRiverBand(x + 0.5, y + 0.5, this.river, 0.2)) return true;
    return false;
  }
  isSolidAt(pos: Vec2): boolean {
    if (decorBlocks(this.decor, pos)) return true;
    const id = this.grid.occupantAt(pos);
    if (id === 0) return false;
    const b = this.state.buildings.get(id);
    if (b) return !BUILDINGS[b.type].walkable;
    const n = this.state.nodes.get(id);
    return n ? n.amount > 0 : false;
  }

  private makeBuilding(type: BuildingType, pos: Vec2): Building {
    const def = BUILDINGS[type];
    const id = this.state.nextId++;
    const b: Building = { id, type, pos: { ...pos }, hp: def.hp, maxHp: def.hp };
    this.state.buildings.set(id, b);
    this.grid.occupy(pos, def.size, id);
    return b;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
