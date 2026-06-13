import type {
  SimState, SimEvent, Command, Player, Building, EntityId, Vec2,
  ResourceNode, BuildingType, Creature, ProjectileKind,
} from './types';
import { Rng } from './rng';
import { Grid } from './grid';
import { generateMap, type MapData } from './mapgen';
import { generateRegions, regionAt, type RegionMap } from './regions';
import { BUILDINGS } from './data/buildings';
import { applySkills } from './data/skills';
import { dist, buildingCenter } from './combat';
import { ITEMS, isDurable, type ItemId, type Slot } from './data/items';
import {
  addItem, removeItem, countItem, emptyInventory, moveSlot, giveItem, firstEmpty,
} from './inventory';
import { recipeById } from './data/recipes';
import { CREATURES } from './data/creatures';
import { spawnPlan } from './data/spawning';
import {
  riverParams, inRiver, crossesBridgeRail, inRiverBand, type RiverParams,
} from './river';
import { generateDecor, decorBlocks, type Decor } from './decor';
import {
  MAP_SIZE, CAMP_POS, DAY_TICKS, NIGHT_TICKS, PLAYER_SPEED, PLAYER_MAX_HP,
  RESPAWN_TICKS, INVENTORY_SLOTS, HUNGER_MAX, HUNGER_START,
  HUNGER_DECAY_IDLE, HUNGER_DECAY_ACTIVE, STARVE_DMG, BARE_HAND_YIELD,
  GATHER_COOLDOWN, GATHER_RANGE, ITEM_TTL_TICKS, PICKUP_RANGE,
  NODE_AMOUNT, BUSH_REGROW_TICKS, TICK_RATE,
} from './constants';

const NODE_ITEM: Record<ResourceNode['kind'], ItemId> = {
  tree: 'wood', rock: 'stone', bush: 'berry',
};

const CRAFT_TABLE_RANGE = 3.5;
const TOTAL_CREATURE_CAP = 60;
const SPAWN_MIN_DIST = 18;
const DESPAWN_DIST = 90;
const PROJECTILE_SPEED = { spit: 9, bolt: 16 } as const;
const BARE_HAND_DMG = 4;
const SWING_COOLDOWN = 11;
const KNOCKBACK = 0.55;          // impulse applied to a creature on melee hit
const HIT_STAGGER = 8;           // ticks a creature is stunned after a hit
const SWING_HALF_DOT = 0.0;      // forward 180° sweep; aim-assist guarantees the pointed target

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
  private craftQueue: { playerId: EntityId; recipeId: string }[] = [];
  private repairQueue: EntityId[] = [];
  private attackQueue: { playerId: EntityId; dir: Vec2 }[] = [];

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
      groundItems: new Map(), creatures: new Map(), projectiles: new Map(), nextId: 1,
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
      gatherCooldown: 0, gatherTarget: null, attackCooldown: 0,
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
      case 'craft': this.craftQueue.push({ playerId, recipeId: cmd.recipeId }); break;
      case 'repair_hand': this.repairQueue.push(playerId); break;
      case 'attack': this.attackQueue.push({ playerId, dir: cmd.dir }); break;
      case 'build': this.buildQueue.push({ playerId, type: cmd.type, pos: cmd.pos }); break;
      case 'demolish': this.demolishQueue.push(cmd.buildingId); break;
    }
  }

  step(): SimEvent[] {
    const events: SimEvent[] = [];
    this.state.tick++;
    this.stepClock(events);
    this.stepSpawning(events);
    this.stepBuildCommands(events);
    this.stepCraft(events);
    this.stepPlayers(events);
    this.stepAttacks(events);
    this.stepGather(events);
    this.stepCreatures(events);
    this.stepProjectiles(events);
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

  private nearCraftingTable(p: Player): boolean {
    for (const b of this.state.buildings.values()) {
      if (b.type !== 'crafting_table') continue;
      if (dist(buildingCenter(b.pos, 1), p.pos) <= CRAFT_TABLE_RANGE) return true;
    }
    return false;
  }

  private stepCraft(events: SimEvent[]): void {
    for (const req of this.craftQueue) {
      const p = this.state.players.get(req.playerId);
      if (!p || !p.alive) continue;
      const recipe = recipeById(req.recipeId);
      if (!recipe) continue;
      if (recipe.requiresTable && !this.nearCraftingTable(p)) continue;
      if (!recipe.inputs.every(i => countItem(p.inventory, i.item) >= i.count)) continue;
      for (const i of recipe.inputs) removeItem(p.inventory, i.item, i.count);
      const leftover = giveItem(p.inventory, recipe.output.item, recipe.output.count);
      if (leftover > 0) this.spawnGroundItem(recipe.output.item, leftover, p.pos);
      events.push({ kind: 'craft', pos: { ...p.pos }, item: recipe.output.item });
    }
    this.craftQueue.length = 0;

    for (const id of this.repairQueue) {
      const p = this.state.players.get(id);
      if (!p || !p.alive) continue;
      const s = p.inventory[p.hand];
      if (!s || !isDurable(s.item) || s.dur === undefined) continue;
      const def = ITEMS[s.item];
      if (def.durabilityMax === undefined || s.dur >= def.durabilityMax) continue;
      const mat = def.repairItem, cost = def.repairCost ?? 1;
      if (!mat || countItem(p.inventory, mat) < cost) continue;
      removeItem(p.inventory, mat, cost);
      s.dur = def.durabilityMax;
      events.push({ kind: 'repair', pos: { ...p.pos }, playerId: p.id });
    }
    this.repairQueue.length = 0;
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
      const held = p.inventory[p.hand];
      const heldDef = held ? ITEMS[held.item] : undefined;
      const matches = !!heldDef && heldDef.toolKind ===
        (node.kind === 'tree' ? 'axe' : node.kind === 'rock' ? 'pick' : undefined);
      const mul = matches ? (heldDef!.gatherMul ?? 1) : 1;
      p.gatherCooldown = matches ? Math.max(4, Math.round(GATHER_COOLDOWN / 1.5)) : GATHER_COOLDOWN;
      const take = Math.min(BARE_HAND_YIELD * mul, node.amount);
      node.amount -= take;
      // wear the tool when it was the right tool for the job
      if (matches && held && held.dur !== undefined) {
        held.dur -= 1;
        if (held.dur <= 0) {
          const broken = held.item;
          p.inventory[p.hand] = null;
          events.push({ kind: 'tool_broke', pos: { ...p.pos }, item: broken, playerId: p.id });
        }
      }
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
        let leftover: number;
        if (isDurable(gi.item)) {
          const slot = firstEmpty(p.inventory);
          if (slot < 0) { leftover = gi.count; }
          else { p.inventory[slot] = { item: gi.item, count: 1, dur: gi.dur }; leftover = gi.count - 1; }
        } else {
          leftover = addItem(p.inventory, gi.item, gi.count);
        }
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
    const drop = (s: Slot) => { if (s) this.spawnGroundItem(s.item, s.count, p.pos, s.dur); };
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
    this.spawnGroundItem(s.item, n, { x: p.pos.x, y: p.pos.y }, s.dur);
    s.count -= n;
    if (s.count <= 0) p.inventory[slot] = null;
  }

  private spawnGroundItem(item: ItemId, count: number, pos: Vec2, dur?: number): void {
    const id = this.state.nextId++;
    this.state.groundItems.set(id, {
      id, item, count, dur, ttlTicks: ITEM_TTL_TICKS,
      pos: { x: pos.x + (this.rng.next() - 0.5) * 0.6, y: pos.y + (this.rng.next() - 0.5) * 0.6 },
    });
  }

  private stepPlayers(_events: SimEvent[]): void {
    for (const p of this.state.players.values()) {
      if (!p.alive) continue;
      if (p.gatherCooldown > 0) p.gatherCooldown--;
      if (p.attackCooldown > 0) p.attackCooldown--;
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

  // ---- combat: player swing ----
  private stepAttacks(events: SimEvent[]): void {
    for (const req of this.attackQueue) {
      const p = this.state.players.get(req.playerId);
      if (!p || !p.alive || p.attackCooldown > 0) continue;
      const len = Math.hypot(req.dir.x, req.dir.y) || 1;
      const dir = { x: req.dir.x / len, y: req.dir.y / len };
      const held = p.inventory[p.hand];
      const def = held ? ITEMS[held.item] : undefined;
      const isWeapon = def?.category === 'weapon';
      const dmg = isWeapon ? (def!.dmg ?? BARE_HAND_DMG) : BARE_HAND_DMG;
      const reach = isWeapon ? (def!.reach ?? 2.2) : 1.4;
      p.attackCooldown = SWING_COOLDOWN;
      events.push({ kind: 'swing', pos: { ...p.pos }, dir });

      if (isWeapon && def!.ranged) {
        this.spawnProjectile('bolt', p.pos, dir, dmg, true, events);
      } else {
        // forward sweep + aim assist: always land the creature most in line with the
        // cursor (within reach), plus any others inside the forward arc.
        let assistId: EntityId | null = null, assistDot = -2;
        const inReach: { id: EntityId; dot: number }[] = [];
        for (const c of this.state.creatures.values()) {
          const dx = c.pos.x - p.pos.x, dy = c.pos.y - p.pos.y;
          const d = Math.hypot(dx, dy);
          const r = reach + CREATURES[c.species]!.radius;
          if (d > r + 0.3) continue;
          const dot = (dx / (d || 1)) * dir.x + (dy / (d || 1)) * dir.y;
          if (dot > assistDot) { assistDot = dot; assistId = c.id; }
          if (dot >= SWING_HALF_DOT) inReach.push({ id: c.id, dot });
        }
        const hitIds = new Set(inReach.map(h => h.id));
        if (assistId !== null && assistDot >= -0.15) hitIds.add(assistId);  // forgive a wide miss
        for (const id of hitIds) this.hitCreature(id, dmg, dir, events);
      }
      if (isWeapon && held && held.dur !== undefined) {
        held.dur -= 1;
        if (held.dur <= 0) {
          const it = held.item; p.inventory[p.hand] = null;
          events.push({ kind: 'tool_broke', pos: { ...p.pos }, item: it, playerId: p.id });
        }
      }
    }
    this.attackQueue.length = 0;
  }

  // ---- spawning ----
  private stepSpawning(events: SimEvent[]): void {
    if (this.state.tick % 10 !== 0) return;
    if (this.state.creatures.size >= TOTAL_CREATURE_CAP) return;
    const players = [...this.state.players.values()].filter(p => p.alive);
    if (players.length === 0) return;
    const anchor = players[this.rng.int(0, players.length - 1)]!;
    const ang = this.rng.next() * Math.PI * 2;
    const rad = SPAWN_MIN_DIST + this.rng.next() * 22;
    const pos = {
      x: clamp(anchor.pos.x + Math.cos(ang) * rad, 4, MAP_SIZE - 4),
      y: clamp(anchor.pos.y + Math.sin(ang) * rad, 4, MAP_SIZE - 4),
    };
    if (this.isSolidAt(pos) || inRiver(pos, this.river)) return;
    if (dist(pos, CAMP_POS) < 22) return;
    const biome = regionAt(this.regions, pos).biome;
    const plan = spawnPlan(biome, this.state.phase);
    for (const t of plan) {
      const have = [...this.state.creatures.values()]
        .filter(c => CREATURES[c.species]!.faction === t.faction && c.biome === biome).length;
      if (have >= t.count) continue;
      const species = t.species[this.rng.int(0, t.species.length - 1)]!;
      this.spawnCreature(species, pos, biome, events);
      return;
    }
  }

  private spawnCreature(species: string, pos: Vec2, biome: string, events: SimEvent[]): Creature {
    const def = CREATURES[species]!;
    const id = this.state.nextId++;
    const c: Creature = {
      id, species, pos: { ...pos }, hp: def.hp, maxHp: def.hp,
      target: null, attackCooldown: 0, provoked: false, fleeTicks: 0,
      staggerTicks: 0, knock: { x: 0, y: 0 },
      wanderDir: { x: this.rng.next() * 2 - 1, y: this.rng.next() * 2 - 1 }, biome,
    };
    this.state.creatures.set(id, c);
    events.push({ kind: 'creature_spawn', id, species, pos: { ...pos } });
    return c;
  }

  // ---- creature AI ----
  private nearestPlayer(pos: Vec2, maxR: number): Player | null {
    let best: Player | null = null, bd = maxR;
    for (const p of this.state.players.values()) {
      if (!p.alive) continue;
      const d = dist(p.pos, pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  private stepCreatures(events: SimEvent[]): void {
    const players = [...this.state.players.values()].filter(p => p.alive);
    for (const c of [...this.state.creatures.values()]) {
      const def = CREATURES[c.species]!;
      if (c.attackCooldown > 0) c.attackCooldown--;
      if (c.fleeTicks > 0) c.fleeTicks--;
      if (c.staggerTicks > 0) c.staggerTicks--;

      if (players.length && players.every(p => dist(p.pos, c.pos) > DESPAWN_DIST)) {
        this.state.creatures.delete(c.id); continue;
      }

      // apply decaying knockback (slides the body, respecting walls)
      if (Math.abs(c.knock.x) + Math.abs(c.knock.y) > 0.005) {
        const nx = clamp(c.pos.x + c.knock.x, 0.5, MAP_SIZE - 0.5);
        const ny = clamp(c.pos.y + c.knock.y, 0.5, MAP_SIZE - 0.5);
        if (!this.isSolidAt({ x: nx, y: c.pos.y })) c.pos.x = nx;
        if (!this.isSolidAt({ x: c.pos.x, y: ny })) c.pos.y = ny;
        c.knock.x *= 0.78; c.knock.y *= 0.78;
      }
      // staggered creatures can't act this tick (but still slide from knockback)
      if (c.staggerTicks > 0) continue;

      const speed = def.speed / TICK_RATE;
      const step = (tx: number, ty: number, s: number) => {
        const dx = tx - c.pos.x, dy = ty - c.pos.y, len = Math.hypot(dx, dy) || 1;
        const nx = clamp(c.pos.x + (dx / len) * s, 0.5, MAP_SIZE - 0.5);
        const ny = clamp(c.pos.y + (dy / len) * s, 0.5, MAP_SIZE - 0.5);
        if (!this.isSolidAt({ x: nx, y: c.pos.y })) c.pos.x = nx;
        if (!this.isSolidAt({ x: c.pos.x, y: ny })) c.pos.y = ny;
      };
      const engage = (p: Player) => {
        if (dist(p.pos, c.pos) <= def.attackRange) {
          if (c.attackCooldown === 0) {
            c.attackCooldown = def.attackCooldownTicks;
            if (def.ranged) this.spawnProjectile(def.ranged, c.pos, norm(sub(p.pos, c.pos)), def.dmg, false, events);
            else this.damagePlayer(p.id, def.dmg, events);
          }
        } else step(p.pos.x, p.pos.y, speed);
      };

      switch (def.behavior) {
        case 'flee': {
          const threat = this.nearestPlayer(c.pos, def.aggroRange);
          if (threat && (c.fleeTicks > 0 || dist(threat.pos, c.pos) < def.aggroRange)) {
            step(c.pos.x * 2 - threat.pos.x, c.pos.y * 2 - threat.pos.y, speed * 1.1);
          } else if (this.state.tick % 4 === 0) {
            step(c.pos.x + c.wanderDir.x, c.pos.y + c.wanderDir.y, speed * 0.4);
            if (this.rng.next() < 0.02) c.wanderDir = { x: this.rng.next() * 2 - 1, y: this.rng.next() * 2 - 1 };
          }
          break;
        }
        case 'neutral': {
          const t = c.provoked ? this.nearestPlayer(c.pos, def.aggroRange + 4) : null;
          if (t) engage(t);
          else if (this.state.tick % 4 === 0) step(c.pos.x + c.wanderDir.x, c.pos.y + c.wanderDir.y, speed * 0.4);
          break;
        }
        case 'aggressive':
        case 'pack': {
          const t = this.nearestPlayer(c.pos, def.aggroRange);
          if (t) engage(t);
          else if (this.state.tick % 4 === 0) step(c.pos.x + c.wanderDir.x, c.pos.y + c.wanderDir.y, speed * 0.4);
          break;
        }
        case 'march': {
          const t = this.nearestPlayer(c.pos, 999);
          const goal = t ? t.pos : CAMP_POS;
          if (t && dist(t.pos, c.pos) <= def.attackRange) engage(t);
          else step(goal.x, goal.y, speed);
          break;
        }
      }
    }
    this.separateCreatures();
  }

  private separateCreatures(): void {
    const arr = [...this.state.creatures.values()];
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i]!, b = arr[j]!;
      const ra = CREATURES[a.species]!.radius + CREATURES[b.species]!.radius;
      const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y, d = Math.hypot(dx, dy);
      if (d > 0 && d < ra) {
        const push = (ra - d) / 2, nx = dx / d, ny = dy / d;
        a.pos.x -= nx * push; a.pos.y -= ny * push;
        b.pos.x += nx * push; b.pos.y += ny * push;
      }
    }
  }

  /** Melee hit: knockback + brief stagger, then damage. */
  private hitCreature(id: EntityId, amount: number, dir: Vec2, events: SimEvent[]): void {
    const c = this.state.creatures.get(id);
    if (!c) return;
    const def = CREATURES[c.species]!;
    const mass = def.faction === 'boss' ? 0.25 : def.radius > 0.7 ? 0.5 : 1;
    c.knock.x += dir.x * KNOCKBACK * mass;
    c.knock.y += dir.y * KNOCKBACK * mass;
    c.staggerTicks = Math.max(c.staggerTicks, HIT_STAGGER);
    this.damageCreature(id, amount, events);
  }

  damageCreature(id: EntityId, amount: number, events: SimEvent[]): void {
    const c = this.state.creatures.get(id);
    if (!c) return;
    c.hp -= amount;
    c.provoked = true;
    c.fleeTicks = 60;
    events.push({ kind: 'damage', pos: { ...c.pos }, amount, crit: false });
    if (c.hp > 0) return;
    const def = CREATURES[c.species]!;
    this.state.creatures.delete(id);
    events.push({ kind: 'creature_death', id, species: c.species, pos: { ...c.pos } });
    for (const e of def.loot) {
      if (this.rng.next() > e.chance) continue;
      const n = e.min + this.rng.int(0, e.max - e.min);
      if (n > 0) this.spawnGroundItem(e.item, n, c.pos);
    }
    if (def.bossDrop) this.spawnGroundItem(def.bossDrop, 1, c.pos, ITEMS[def.bossDrop].durabilityMax);
  }

  // ---- projectiles ----
  private spawnProjectile(kind: ProjectileKind, from: Vec2, dir: Vec2, dmg: number,
                          fromPlayer: boolean, events: SimEvent[]): void {
    const id = this.state.nextId++;
    const d = norm(dir);
    this.state.projectiles.set(id, {
      id, kind, pos: { ...from }, dir: d, speed: PROJECTILE_SPEED[kind], dmg, fromPlayer, ttlTicks: 80,
    });
    events.push({ kind: 'projectile', from: { ...from }, to: { x: from.x + d.x * 6, y: from.y + d.y * 6 }, kind2: kind });
  }

  private stepProjectiles(events: SimEvent[]): void {
    for (const pr of [...this.state.projectiles.values()]) {
      if (--pr.ttlTicks <= 0) { this.state.projectiles.delete(pr.id); continue; }
      const s = pr.speed / TICK_RATE;
      pr.pos.x += pr.dir.x * s; pr.pos.y += pr.dir.y * s;
      if (this.isSolidAt(pr.pos)) { this.state.projectiles.delete(pr.id); continue; }
      if (pr.fromPlayer) {
        for (const c of this.state.creatures.values()) {
          if (dist(c.pos, pr.pos) <= CREATURES[c.species]!.radius + 0.3) {
            this.damageCreature(c.id, pr.dmg, events); this.state.projectiles.delete(pr.id); break;
          }
        }
      } else {
        for (const p of this.state.players.values()) {
          if (p.alive && dist(p.pos, pr.pos) <= 0.6) {
            this.damagePlayer(p.id, pr.dmg, events); this.state.projectiles.delete(pr.id); break;
          }
        }
      }
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
function sub(a: Vec2, b: Vec2): Vec2 { return { x: a.x - b.x, y: a.y - b.y }; }
function norm(v: Vec2): Vec2 { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; }
