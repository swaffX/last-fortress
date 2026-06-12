import type {
  SimState, SimEvent, Command, Player, Building, Enemy, EnemyType,
  ClassType, EntityId, Vec2, ResourceNode, BuildingType,
} from './types';
import { Rng } from './rng';
import { Grid } from './grid';
import { generateMap, type MapData } from './mapgen';
import { BUILDINGS } from './data/buildings';
import { ENEMIES } from './data/enemies';
import { waveComposition, enemyHpScale, enemyDmgScale } from './data/waves';
import { applySkills, defaultModifiers, type SkillModifiers } from './data/skills';
import { canAfford, charge, refund, scaleCost } from './economy';
import { dist, buildingCenter, nearestEnemy } from './combat';
import { riverParams, inRiver, type RiverParams } from './river';
import {
  MAP_SIZE, CASTLE_POS, DAY_TICKS, PLAYER_SPEED, PLAYER_MAX_HP,
  START_RESOURCES, RESPAWN_TICKS, GATHER_AMOUNT, TICK_RATE,
} from './constants';

const WEAPON_STATS = {
  sword:    { range: 2.3, dmg: 25, cooldown: 10 },
  bow:      { range: 8,   dmg: 15, cooldown: 14 },
  crossbow: { range: 10,  dmg: 22, cooldown: 22 },
} as const;

export class Sim {
  readonly state: SimState;
  readonly grid: Grid;
  readonly map: MapData;
  readonly rng: Rng;
  readonly river: RiverParams;
  private moveIntent = new Map<EntityId, Vec2>();
  private attackIntent = new Map<EntityId, Vec2>();
  private buildQueue: { playerId: EntityId; type: BuildingType; pos: Vec2 }[] = [];
  private upgradeQueue: EntityId[] = [];
  private demolishQueue: EntityId[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.grid = new Grid(MAP_SIZE);
    this.map = generateMap(this.rng);
    this.river = riverParams(seed);
    this.state = {
      tick: 0, phase: 'day', phaseTicks: DAY_TICKS, wave: 0,
      pendingSpawns: [], resources: { ...START_RESOURCES },
      buildings: new Map(), enemies: new Map(), players: new Map(),
      nodes: new Map(), castleId: 0, nextId: 1, gameOver: false,
    };
    const castle = this.makeBuilding('castle', CASTLE_POS, 1);
    this.state.castleId = castle.id;
    // resource nodes occupy the grid so buildings can't overlap them
    for (const n of this.map.nodes) {
      const id = this.state.nextId++;
      this.state.nodes.set(id, { id, kind: n.kind, pos: n.pos, amount: 200 });
      this.grid.occupy(n.pos, 1, id);
    }
  }

  get castleLevel(): number {
    return this.state.buildings.get(this.state.castleId)?.tier ?? 1;
  }

  addPlayer(klass: ClassType, skills: string[] = []): Player {
    const id = this.state.nextId++;
    const p: Player = {
      id, klass, weapon: klass === 'knight' ? 'sword' : 'bow',
      pos: { x: CASTLE_POS.x + 2, y: CASTLE_POS.y + 6 },
      hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP,
      attackCooldown: 0, alive: true, respawnTicks: 0,
      mods: applySkills(skills),
    };
    this.state.players.set(id, p);
    return p;
  }

  removePlayer(id: EntityId): void {
    this.state.players.delete(id);
    this.moveIntent.delete(id);
    this.attackIntent.delete(id);
  }

  applyCommand(playerId: EntityId, cmd: Command): void {
    const p = this.state.players.get(playerId);
    if (!p || !p.alive || this.state.gameOver) return;
    switch (cmd.kind) {
      case 'move': this.moveIntent.set(playerId, cmd.dir); break;
      case 'attack': this.attackIntent.set(playerId, cmd.dir); break;
      case 'build': this.buildQueue.push({ playerId, type: cmd.type, pos: cmd.pos }); break;
      case 'upgrade': this.upgradeQueue.push(cmd.buildingId); break;
      case 'demolish': this.demolishQueue.push(cmd.buildingId); break;
    }
  }

  step(): SimEvent[] {
    const events: SimEvent[] = [];
    if (this.state.gameOver) return events;
    this.state.tick++;
    this.stepClock(events);
    this.stepBuildCommands(events);
    this.stepIncome();
    this.stepPlayers(events);
    this.stepGather();
    this.stepTowers(events);
    this.stepPlayerCombat(events);
    this.stepSpawns();
    this.stepEnemies(events);
    this.stepSupport();
    this.stepRespawns();
    this.attackIntent.clear();
    return events;
  }

  // ---- clock & waves ----

  private stepClock(events: SimEvent[]): void {
    if (this.state.phase === 'night') {
      if (this.state.pendingSpawns.length === 0 && this.state.enemies.size === 0) {
        this.state.phase = 'day';
        this.state.phaseTicks = DAY_TICKS;
        events.push({ kind: 'phase_change', phase: 'day' });
      }
      return;
    }
    this.state.phaseTicks--;
    if (this.state.phaseTicks > 0) return;
    this.state.phase = 'night';
    this.state.wave++;
    events.push({ kind: 'phase_change', phase: 'night' });
    const comp = waveComposition(this.state.wave, this.rng);
    const boss = comp.some(s => s.type === 'butcher');
    events.push({ kind: 'wave_start', wave: this.state.wave, boss });
    this.state.pendingSpawns = comp.map(s => ({
      type: s.type, atTick: this.state.tick + s.delayTicks,
    }));
    this.state.phaseTicks = Number.MAX_SAFE_INTEGER; // night ends on wave clear
  }

  private stepSpawns(): void {
    if (this.state.pendingSpawns.length === 0) return;
    const due = this.state.pendingSpawns.filter(s => s.atTick <= this.state.tick);
    if (due.length === 0) return;
    this.state.pendingSpawns = this.state.pendingSpawns.filter(s => s.atTick > this.state.tick);
    for (const s of due) {
      const sp = this.rng.pick(this.map.spawnPoints);
      this.spawnEnemy(s.type, { x: sp.x, y: sp.y }, this.state.wave);
    }
  }

  // ---- building & economy ----

  /** Aggregate skill modifiers across the team: max of each field (Phase 1 simplification). */
  teamMods(): SkillModifiers {
    const out = defaultModifiers();
    for (const p of this.state.players.values()) {
      out.towerDmgMul = Math.max(out.towerDmgMul, p.mods.towerDmgMul);
      out.towerRangeMul = Math.max(out.towerRangeMul, p.mods.towerRangeMul);
      out.incomeMul = Math.max(out.incomeMul, p.mods.incomeMul);
      out.healMul = Math.max(out.healMul, p.mods.healMul);
      out.coinMul = Math.max(out.coinMul, p.mods.coinMul);
      out.buildCostMul = Math.min(out.buildCostMul, p.mods.buildCostMul);
    }
    return out;
  }

  private stepBuildCommands(events: SimEvent[]): void {
    const team = this.teamMods();
    for (const req of this.buildQueue) {
      const def = BUILDINGS[req.type];
      if (req.type === 'castle') continue;
      if (def.unlockCastleLevel > this.castleLevel) continue;
      const pos = { x: Math.floor(req.pos.x), y: Math.floor(req.pos.y) };
      if (!this.grid.canPlace(pos, def.size)) continue;
      const cost = scaleCost(def.tiers[0]!.cost, team.buildCostMul);
      if (!canAfford(this.state.resources, cost)) continue;
      charge(this.state.resources, cost);
      this.makeBuilding(req.type, pos, 1);
      events.push({ kind: 'build_placed', pos, type: req.type });
    }
    this.buildQueue.length = 0;

    for (const id of this.upgradeQueue) {
      const b = this.state.buildings.get(id);
      if (!b) continue;
      const def = BUILDINGS[b.type];
      if (b.tier >= def.tiers.length) continue;
      const next = def.tiers[b.tier]!;            // tier is 1-based; tiers[tier] = next
      const cost = scaleCost(next.cost, team.buildCostMul);
      if (!canAfford(this.state.resources, cost)) continue;
      charge(this.state.resources, cost);
      b.tier++;
      const hpRatio = b.hp / b.maxHp;
      b.maxHp = next.hp;
      b.hp = Math.round(next.hp * hpRatio);
      b.cooldown = Math.min(b.cooldown, next.cooldownTicks ?? 0);
    }
    this.upgradeQueue.length = 0;

    for (const id of this.demolishQueue) {
      const b = this.state.buildings.get(id);
      if (!b || b.type === 'castle') continue;
      const def = BUILDINGS[b.type];
      refund(this.state.resources, def.tiers[0]!.cost, 0.5);
      this.grid.clear(b.pos, def.size);
      this.state.buildings.delete(id);
    }
    this.demolishQueue.length = 0;
  }

  private stepIncome(): void {
    const mul = this.teamMods().incomeMul;
    for (const b of this.state.buildings.values()) {
      const stats = BUILDINGS[b.type].tiers[b.tier - 1]!;
      if (!stats.income || !stats.cooldownTicks) continue;
      if (--b.cooldown > 0) continue;
      b.cooldown = stats.cooldownTicks;
      this.state.resources.wood += Math.round((stats.income.wood ?? 0) * mul);
      this.state.resources.stone += Math.round((stats.income.stone ?? 0) * mul);
      this.state.resources.gold += Math.round((stats.income.gold ?? 0) * mul);
    }
  }

  private stepGather(): void {
    for (const [pid] of this.attackIntent) {
      const p = this.state.players.get(pid);
      if (!p || !p.alive || p.attackCooldown > 0) continue;
      let best: { node: ResourceNode; d: number } | null = null;
      for (const n of this.state.nodes.values()) {
        const d = dist({ x: n.pos.x + 0.5, y: n.pos.y + 0.5 }, p.pos);
        if (d <= 1.6 && (!best || d < best.d)) best = { node: n, d };
      }
      if (!best) continue;  // not near a node → combat handles this intent
      p.attackCooldown = 12;
      const take = Math.min(GATHER_AMOUNT, best.node.amount);
      best.node.amount -= take;
      const kind = best.node.kind === 'tree' ? 'wood' : 'stone';
      this.state.resources[kind] += take;
      if (best.node.amount <= 0) {
        this.grid.clear(best.node.pos, 1);
        this.state.nodes.delete(best.node.id);
      }
      this.attackIntent.delete(pid);
    }
  }

  // ---- combat ----

  spawnEnemy(type: EnemyType, pos: Vec2, wave: number): Enemy {
    const def = ENEMIES[type];
    const hp = Math.round(def.hp * enemyHpScale(Math.max(1, wave)));
    const id = this.state.nextId++;
    const e: Enemy = {
      id, type, pos: { ...pos }, hp, maxHp: hp,
      speedMul: 1, slowTicks: 0, attackCooldown: 0,
      targetBuildingId: null, enraged: false,
    };
    this.state.enemies.set(id, e);
    return e;
  }

  damageEnemy(id: EntityId, amount: number, events: SimEvent[], crit = false): void {
    const e = this.state.enemies.get(id);
    if (!e) return;
    e.hp -= amount;
    events.push({ kind: 'damage', pos: { ...e.pos }, amount, crit });
    if (e.hp > 0) return;
    this.state.enemies.delete(id);
    const def = ENEMIES[e.type];
    const coins = Math.round(def.coins * this.teamMods().coinMul);
    this.state.resources.coins += coins;
    events.push({ kind: 'death', pos: { ...e.pos }, enemy: e.type });
    events.push({ kind: 'coins', pos: { ...e.pos }, amount: coins });
    if (def.explodeOnDeath) {
      this.explode(e.pos, def.explodeOnDeath.radius, def.explodeOnDeath.dmg, events);
    }
  }

  private explode(at: Vec2, radius: number, dmg: number, events: SimEvent[]): void {
    events.push({ kind: 'explosion', pos: { ...at }, radius });
    for (const e of [...this.state.enemies.values()]) {
      if (dist(e.pos, at) <= radius) this.damageEnemy(e.id, dmg, events);
    }
    for (const b of [...this.state.buildings.values()]) {
      const size = BUILDINGS[b.type].size;
      if (dist(buildingCenter(b.pos, size), at) <= radius + size / 2) {
        this.damageBuilding(b.id, dmg, events);
      }
    }
    for (const p of this.state.players.values()) {
      if (p.alive && dist(p.pos, at) <= radius) this.damagePlayer(p.id, dmg);
    }
  }

  damageBuilding(id: EntityId, amount: number, events: SimEvent[]): void {
    const b = this.state.buildings.get(id);
    if (!b) return;
    b.hp -= amount;
    if (b.hp > 0) return;
    const def = BUILDINGS[b.type];
    events.push({ kind: 'building_destroyed', pos: { ...b.pos }, type: b.type });
    if (b.type === 'castle') {
      this.state.gameOver = true;
      events.push({ kind: 'game_over', wave: this.state.wave });
      return;
    }
    this.grid.clear(b.pos, def.size);
    this.state.buildings.delete(id);
  }

  damagePlayer(id: EntityId, amount: number): void {
    const p = this.state.players.get(id);
    if (!p || !p.alive) return;
    p.hp -= amount;
    if (p.hp <= 0) { p.alive = false; p.hp = 0; p.respawnTicks = RESPAWN_TICKS; }
  }

  private stepTowers(events: SimEvent[]): void {
    const team = this.teamMods();
    for (const b of this.state.buildings.values()) {
      const stats = BUILDINGS[b.type].tiers[b.tier - 1]!;
      if (!stats.dmg || !stats.range || !stats.cooldownTicks) continue;
      if (b.cooldown > 0) { b.cooldown--; continue; }
      const center = buildingCenter(b.pos, BUILDINGS[b.type].size);
      const range = stats.range * team.towerRangeMul;
      const target = nearestEnemy(this.state.enemies.values(), center, range);
      if (!target) continue;
      b.cooldown = stats.cooldownTicks;
      const dmg = Math.round(stats.dmg * team.towerDmgMul);

      if (b.type === 'bomb_tower') {
        events.push({ kind: 'projectile', from: center, to: { ...target.pos }, weapon: 'bomb' });
        this.explode(target.pos, stats.aoeRadius!, dmg, events);
      } else if (b.type === 'lightning_tower') {
        const points: Vec2[] = [center];
        let cur: Enemy | null = target;
        const hit = new Set<EntityId>();
        for (let i = 0; i < (stats.chainTargets ?? 1) && cur; i++) {
          points.push({ ...cur.pos });
          hit.add(cur.id);
          const from = cur.pos;
          this.damageEnemy(cur.id, dmg, events);
          cur = nearestEnemy(
            [...this.state.enemies.values()].filter(e => !hit.has(e.id)), from, 4);
        }
        events.push({ kind: 'chain', points });
      } else {
        const weapon = b.type === 'ice_tower' ? 'ice'
          : b.type === 'crossbow_tower' ? 'bolt' : 'arrow';
        events.push({ kind: 'projectile', from: center, to: { ...target.pos }, weapon });
        if (stats.slowMul) {
          target.speedMul = stats.slowMul;
          target.slowTicks = stats.slowTicks!;
        }
        this.damageEnemy(target.id, dmg, events);
      }
    }
  }

  /** Players auto-attack the nearest enemy in weapon range — no input needed. */
  private stepPlayerCombat(events: SimEvent[]): void {
    for (const p of this.state.players.values()) {
      if (!p.alive || p.attackCooldown > 0) continue;
      const w = WEAPON_STATS[p.weapon];
      // class passives: knight +25% melee dmg, hunter +20% ranged range
      let dmg = w.dmg * p.mods.playerDmgMul;
      if (p.klass === 'knight' && p.weapon === 'sword') dmg *= 1.25;
      let range = w.range;
      if (p.klass === 'hunter' && p.weapon !== 'sword') range *= 1.2;
      const target = nearestEnemy(this.state.enemies.values(), p.pos, range);
      if (!target) continue;
      p.attackCooldown = Math.round(w.cooldown / p.mods.playerAttackSpeedMul);
      const crit = this.rng.next() < p.mods.critChance;
      if (crit) dmg *= 2;
      if (p.weapon !== 'sword') {
        events.push({ kind: 'projectile', from: { ...p.pos }, to: { ...target.pos },
                      weapon: p.weapon === 'bow' ? 'arrow' : 'bolt' });
      } else {
        events.push({ kind: 'melee', pos: { ...p.pos } });
      }
      this.damageEnemy(target.id, Math.round(dmg), events, crit);
    }
  }

  private stepEnemies(events: SimEvent[]): void {
    const castle = this.state.buildings.get(this.state.castleId);
    if (!castle) return;
    const castleCenter = buildingCenter(castle.pos, BUILDINGS.castle.size);

    for (const e of [...this.state.enemies.values()]) {
      const def = ENEMIES[e.type];
      if (e.attackCooldown > 0) e.attackCooldown--;
      if (e.slowTicks > 0 && --e.slowTicks === 0) e.speedMul = 1;
      if (e.type === 'butcher' && !e.enraged && e.hp < e.maxHp * 0.5) e.enraged = true;

      const speed = (def.speed / TICK_RATE) * e.speedMul * (e.enraged ? 1.6 : 1);
      const dmg = Math.round(def.dmg * enemyDmgScale(Math.max(1, this.state.wave)) * (e.enraged ? 1.5 : 1));

      // 1. player in attack range → attack player
      let nearPlayer: Player | null = null; let pd = def.attackRange;
      for (const p of this.state.players.values()) {
        if (!p.alive) continue;
        const d = dist(p.pos, e.pos);
        if (d <= pd) { pd = d; nearPlayer = p; }
      }
      if (nearPlayer) {
        if (e.attackCooldown === 0) {
          e.attackCooldown = def.attackCooldownTicks;
          if (def.attackRange > 2) {
            events.push({ kind: 'projectile', from: { ...e.pos }, to: { ...nearPlayer.pos }, weapon: 'spit' });
          }
          this.damagePlayer(nearPlayer.id, dmg);
        }
        continue;
      }

      // 2. building blocking the path (or in range) → attack it
      const targetB = this.findBlockingBuilding(e, castleCenter, def.attackRange);
      if (targetB) {
        if (e.attackCooldown === 0) {
          e.attackCooldown = def.attackCooldownTicks;
          if (def.attackRange > 2) {
            const size = BUILDINGS[targetB.type].size;
            events.push({ kind: 'projectile', from: { ...e.pos },
              to: buildingCenter(targetB.pos, size), weapon: 'spit' });
          }
          this.damageBuilding(targetB.id, dmg, events);
        }
        continue;  // hold position while attacking
      }

      // 3. walk toward the castle (rivers slow the horde too — natural moat)
      const wading = inRiver(e.pos, this.river);
      const moveSpeed = speed * (wading ? 0.55 : 1);
      const dx = castleCenter.x - e.pos.x, dy = castleCenter.y - e.pos.y;
      const len = Math.hypot(dx, dy) || 1;
      e.pos.x += (dx / len) * moveSpeed;
      e.pos.y += (dy / len) * moveSpeed;
      if (wading && (this.state.tick + e.id) % 9 === 0) {
        events.push({ kind: 'splash', pos: { ...e.pos } });
      }
    }
  }

  /** Building within `range` of the enemy along its path to the castle. */
  private findBlockingBuilding(e: Enemy, castleCenter: Vec2, range: number): Building | null {
    const dx = castleCenter.x - e.pos.x, dy = castleCenter.y - e.pos.y;
    const len = Math.hypot(dx, dy) || 1;
    const probes: Vec2[] = [
      e.pos,
      { x: e.pos.x + (dx / len) * range, y: e.pos.y + (dy / len) * range },
      { x: e.pos.x + (dx / len) * 1.0, y: e.pos.y + (dy / len) * 1.0 },
    ];
    for (const probe of probes) {
      const id = this.grid.occupantAt(probe);
      const b = this.state.buildings.get(id);
      if (b) return b;
    }
    return null;
  }

  // ---- support & respawn ----

  private stepSupport(): void {
    const healMul = this.teamMods().healMul;
    for (const b of this.state.buildings.values()) {
      const stats = BUILDINGS[b.type].tiers[b.tier - 1]!;
      if (!stats.heal || !stats.range || !stats.cooldownTicks) continue;
      if (--b.cooldown > 0) continue;
      b.cooldown = stats.cooldownTicks;
      const heal = Math.round(stats.heal * healMul);
      const center = buildingCenter(b.pos, BUILDINGS[b.type].size);
      for (const p of this.state.players.values()) {
        if (p.alive && dist(p.pos, center) <= stats.range) {
          p.hp = Math.min(p.maxHp, p.hp + heal);
        }
      }
      for (const other of this.state.buildings.values()) {
        if (other.id === b.id) continue;
        const oc = buildingCenter(other.pos, BUILDINGS[other.type].size);
        if (dist(oc, center) <= stats.range) {
          other.hp = Math.min(other.maxHp, other.hp + heal);
        }
      }
    }
  }

  private stepRespawns(): void {
    for (const p of this.state.players.values()) {
      if (p.alive) continue;
      if (--p.respawnTicks <= 0) {
        p.alive = true;
        p.hp = p.maxHp;
        p.pos = { x: CASTLE_POS.x + 2, y: CASTLE_POS.y + 6 };
      }
    }
  }

  private stepPlayers(events: SimEvent[]): void {
    for (const p of this.state.players.values()) {
      if (!p.alive) continue;
      if (p.attackCooldown > 0) p.attackCooldown--;
      const dir = this.moveIntent.get(p.id);
      if (dir) {
        const wading = inRiver(p.pos, this.river);
        const speed = PLAYER_SPEED * (wading ? 0.5 : 1);
        const len = Math.hypot(dir.x, dir.y) || 1;
        p.pos.x = clamp(p.pos.x + (dir.x / len) * speed, 0, MAP_SIZE - 1);
        p.pos.y = clamp(p.pos.y + (dir.y / len) * speed, 0, MAP_SIZE - 1);
        if (wading && (this.state.tick + p.id) % 7 === 0) {
          events.push({ kind: 'splash', pos: { ...p.pos } });
        }
      }
    }
    this.moveIntent.clear();
  }

  private makeBuilding(type: BuildingType, pos: Vec2, tier: number): Building {
    const def = BUILDINGS[type];
    const stats = def.tiers[tier - 1]!;
    const id = this.state.nextId++;
    const b: Building = {
      id, type, tier, pos: { ...pos },
      hp: stats.hp, maxHp: stats.hp, cooldown: stats.cooldownTicks ?? 0,
    };
    this.state.buildings.set(id, b);
    this.grid.occupy(pos, def.size, id);
    return b;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
