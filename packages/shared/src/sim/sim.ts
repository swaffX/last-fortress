import type {
  SimState, SimEvent, Command, Player, Building, Enemy, EnemyType,
  ClassType, EntityId, Vec2, ResourceNode, BuildingType, Projectile, ProjectileKind,
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
import {
  riverParams, inRiver, inRiverBand, crossesBridgeRail, type RiverParams,
} from './river';
import { generateDecor, decorBlocks, type Decor } from './decor';
import {
  MAP_SIZE, CASTLE_POS, DAY_TICKS, PLAYER_SPEED, PLAYER_MAX_HP,
  START_RESOURCES, RESPAWN_TICKS, GATHER_AMOUNT, TICK_RATE,
} from './constants';

const WEAPON_STATS = {
  sword:    { range: 2.3, dmg: 25, cooldown: 10 },
  bow:      { range: 8,   dmg: 15, cooldown: 14 },
  crossbow: { range: 10,  dmg: 22, cooldown: 22 },
} as const;

const PROJECTILE_SPEED: Record<ProjectileKind, number> = {
  arrow: 16, bolt: 19, spit: 9, bomb: 8,
};
const ENEMY_AGGRO_RANGE = 6;     // players this close pull zombies off the castle path
// E-key reach. Slightly larger than the client prompt radius (2.2) so a
// prediction lead can never show the prompt while the server says "too far".
const GATHER_RANGE = 2.8;
/** tool tier → resources per swing */
const TOOL_YIELD = [0, 4, 7, 11];

/** crafting costs per target tier — tools are match progression, not persistent */
export const TOOL_UPGRADE_COSTS: Record<'axe' | 'pick',
  Record<number, { wood: number; stone: number } | undefined>> = {
  axe: { 2: { wood: 60, stone: 20 }, 3: { wood: 150, stone: 80 } },
  pick: { 2: { wood: 40, stone: 30 }, 3: { wood: 100, stone: 90 } },
};

/**
 * Strike upgrades: each level +8% damage; every 5th level additionally
 * +6% attack speed — steady growth with milestone spikes.
 */
export function combatUpgradeCost(level: number): number {
  return 15 + level * 10;
}
export function combatDmgMul(level: number): number {
  return 1 + level * 0.08;
}
export function combatSpeedMul(level: number): number {
  return 1 + Math.floor(level / 5) * 0.06;
}

export class Sim {
  readonly state: SimState;
  readonly grid: Grid;
  readonly map: MapData;
  readonly rng: Rng;
  readonly river: RiverParams;
  readonly decor: Decor[];
  private moveIntent = new Map<EntityId, Vec2>();
  private buildQueue: { playerId: EntityId; type: BuildingType; pos: Vec2 }[] = [];
  private upgradeQueue: EntityId[] = [];
  private demolishQueue: EntityId[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.grid = new Grid(MAP_SIZE);
    this.river = riverParams(seed);
    this.map = generateMap(this.rng, this.river);
    this.decor = generateDecor(seed, this.river, this.map.nodes);
    this.state = {
      tick: 0, phase: 'day', phaseTicks: DAY_TICKS, wave: 0,
      pendingSpawns: [], resources: { ...START_RESOURCES },
      buildings: new Map(), enemies: new Map(), players: new Map(),
      nodes: new Map(), projectiles: new Map(),
      bonuses: {
        playerDmgMul: 1, towerDmgMul: 1, enemyDmgMul: 1,
        incomeMul: 1, coinMul: 1, playerSpeedMul: 1,
      },
      castleId: 0, nextId: 1, gameOver: false,
    };
    const castle = this.makeBuilding('castle', CASTLE_POS, 1);
    this.state.castleId = castle.id;
    // resource nodes occupy the grid so buildings can't overlap them.
    // Sized so one full channel fells a tree in ~6 swings (~2.5 s at tier I).
    for (const n of this.map.nodes) {
      const id = this.state.nextId++;
      this.state.nodes.set(id, { id, kind: n.kind, pos: n.pos, amount: n.kind === 'tree' ? 24 : 36 });
      this.grid.occupy(n.pos, 1, id);
    }
  }

  get castleLevel(): number {
    return this.state.buildings.get(this.state.castleId)?.tier ?? 1;
  }

  addPlayer(klass: ClassType, skills: string[] = [],
            tools: { axe: number; pick: number } = { axe: 1, pick: 1 }): Player {
    const id = this.state.nextId++;
    const p: Player = {
      id, klass, weapon: klass === 'knight' ? 'sword' : 'bow',
      pos: { x: CASTLE_POS.x + 2, y: CASTLE_POS.y + 6 },
      hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP,
      attackCooldown: 0, alive: true, respawnTicks: 0,
      mods: applySkills(skills),
      axeTier: tools.axe, pickTier: tools.pick, gatherCooldown: 0, gatherTarget: null,
      combatLevel: 0,
    };
    this.state.players.set(id, p);
    return p;
  }

  setPlayerTool(playerId: EntityId, tool: 'axe' | 'pick', tier: number): void {
    const p = this.state.players.get(playerId);
    if (!p) return;
    if (tool === 'axe') p.axeTier = tier; else p.pickTier = tier;
  }

  removePlayer(id: EntityId): void {
    this.state.players.delete(id);
    this.moveIntent.delete(id);
  }

  applyCommand(playerId: EntityId, cmd: Command): void {
    const p = this.state.players.get(playerId);
    if (!p || !p.alive || this.state.gameOver) return;
    switch (cmd.kind) {
      case 'move': this.moveIntent.set(playerId, cmd.dir); break;
      case 'attack': break;   // combat is automatic; kept for protocol compat
      case 'gather': {
        // single press starts a channel on the nearest node in reach
        let best: ResourceNode | null = null;
        let bd = 2.8;
        for (const n of this.state.nodes.values()) {
          const d = dist({ x: n.pos.x + 0.5, y: n.pos.y + 0.5 }, p.pos);
          if (d <= bd) { bd = d; best = n; }
        }
        if (best) p.gatherTarget = best.id;
        break;
      }
      case 'upgrade_tool': {
        const tier = cmd.tool === 'axe' ? p.axeTier : p.pickTier;
        const cost = TOOL_UPGRADE_COSTS[cmd.tool][tier + 1];
        if (cost && this.state.resources.wood >= cost.wood &&
            this.state.resources.stone >= cost.stone) {
          this.state.resources.wood -= cost.wood;
          this.state.resources.stone -= cost.stone;
          if (cmd.tool === 'axe') p.axeTier++; else p.pickTier++;
        }
        break;
      }
      case 'upgrade_combat': {
        // paid in coins — the kill currency naturally funds combat growth
        const cost = combatUpgradeCost(p.combatLevel);
        if (this.state.resources.coins >= cost) {
          this.state.resources.coins -= cost;
          p.combatLevel++;
        }
        break;
      }
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
    this.stepGather(events);
    this.stepTowers(events);
    this.stepPlayerCombat(events);
    this.stepProjectiles(events);
    this.stepSpawns();
    this.stepEnemies(events);
    this.stepSeparation();
    this.stepSupport();
    this.stepRespawns();
    return events;
  }

  /** Apply a unanimously voted team upgrade. */
  applyUpgrade(id: string): void {
    const b = this.state.bonuses;
    switch (id) {
      case 'sharp_steel': b.playerDmgMul *= 1.15; break;
      case 'siege_works': b.towerDmgMul *= 1.2; break;
      case 'weakening_curse': b.enemyDmgMul *= 0.85; break;
      case 'fortify': {
        const castle = this.state.buildings.get(this.state.castleId);
        if (castle) {
          castle.maxHp = Math.round(castle.maxHp * 1.25);
          castle.hp = Math.min(castle.maxHp, Math.round(castle.hp + castle.maxHp * 0.3));
        }
        break;
      }
      case 'prosperity': b.incomeMul *= 1.25; break;
      case 'war_spoils': b.coinMul *= 1.3; break;
      case 'fleet_footed': b.playerSpeedMul *= 1.12; break;
      case 'masons_call':
        for (const bld of this.state.buildings.values()) {
          bld.hp = Math.min(bld.maxHp, Math.round(bld.hp + bld.maxHp * 0.5));
        }
        break;
    }
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
      if (this.footprintInRiver(pos, def.size)) continue;   // no construction in the riverbed
      if (this.footprintOnDecor(pos, def.size)) continue;   // nor inside ruins/houses
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
    const mul = this.teamMods().incomeMul * this.state.bonuses.incomeMul;
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

  /** Channeled gathering: one E press keeps the player swinging until the
   *  node is destroyed, the player walks away, or the player moves. */
  private stepGather(events: SimEvent[]): void {
    for (const p of this.state.players.values()) {
      if (p.gatherTarget === null) continue;
      if (!p.alive) { p.gatherTarget = null; continue; }
      const node = this.state.nodes.get(p.gatherTarget);
      if (!node) { p.gatherTarget = null; continue; }
      const center = { x: node.pos.x + 0.5, y: node.pos.y + 0.5 };
      if (dist(center, p.pos) > GATHER_RANGE + 0.4) { p.gatherTarget = null; continue; }
      if (p.gatherCooldown > 0) continue;
      p.gatherCooldown = 8;
      const tier = node.kind === 'tree' ? p.axeTier : p.pickTier;
      const take = Math.min(TOOL_YIELD[Math.min(3, Math.max(1, tier))]!, node.amount);
      node.amount -= take;
      const kind = node.kind === 'tree' ? 'wood' : 'stone';
      this.state.resources[kind] += take;
      events.push({
        kind: 'gather', resource: kind, amount: take,
        nodeId: node.id, remaining: node.amount, pos: { ...center },
      });
      if (node.amount <= 0) {
        this.grid.clear(node.pos, 1);
        this.state.nodes.delete(node.id);
        events.push({ kind: 'node_depleted', nodeId: node.id, pos: { ...node.pos } });
        for (const other of this.state.players.values()) {
          if (other.gatherTarget === node.id) other.gatherTarget = null;
        }
      }
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

  /** Launch a homing projectile; damage applies in stepProjectiles on impact. */
  private spawnProjectile(kind: ProjectileKind, from: Vec2, dmg: number, opts: {
    targetEnemy?: EntityId; targetPlayer?: EntityId; targetBuilding?: EntityId;
    targetPos?: Vec2; crit?: boolean; aoeRadius?: number; slowMul?: number; slowTicks?: number;
  }): void {
    const id = this.state.nextId++;
    const tp = opts.targetPos
      ?? (opts.targetEnemy !== undefined ? this.state.enemies.get(opts.targetEnemy)?.pos : undefined)
      ?? (opts.targetPlayer !== undefined ? this.state.players.get(opts.targetPlayer)?.pos : undefined)
      ?? from;
    this.state.projectiles.set(id, {
      id, kind, pos: { ...from }, speed: PROJECTILE_SPEED[kind], dmg,
      crit: opts.crit ?? false,
      targetEnemy: opts.targetEnemy ?? null,
      targetPlayer: opts.targetPlayer ?? null,
      targetBuilding: opts.targetBuilding ?? null,
      targetPos: { ...tp },
      aoeRadius: opts.aoeRadius, slowMul: opts.slowMul, slowTicks: opts.slowTicks,
    });
  }

  private stepProjectiles(events: SimEvent[]): void {
    for (const pr of [...this.state.projectiles.values()]) {
      // home toward the live target; fall back to last known point
      const enemy = pr.targetEnemy !== null ? this.state.enemies.get(pr.targetEnemy) : undefined;
      const player = pr.targetPlayer !== null ? this.state.players.get(pr.targetPlayer) : undefined;
      const building = pr.targetBuilding !== null ? this.state.buildings.get(pr.targetBuilding) : undefined;
      const aim = enemy?.pos
        ?? (player?.alive ? player.pos : undefined)
        ?? (building ? buildingCenter(building.pos, BUILDINGS[building.type].size) : undefined)
        ?? pr.targetPos;
      pr.targetPos = { ...aim };
      const step = pr.speed / TICK_RATE;
      const dx = aim.x - pr.pos.x, dy = aim.y - pr.pos.y;
      const d = Math.hypot(dx, dy);
      if (d > step) {
        pr.pos.x += (dx / d) * step;
        pr.pos.y += (dy / d) * step;
        continue;
      }
      // impact
      pr.pos = { ...aim };
      this.state.projectiles.delete(pr.id);
      if (pr.kind === 'bomb') {
        this.explode(pr.pos, pr.aoeRadius ?? 2, pr.dmg, events);
      } else if (enemy) {
        if (pr.slowMul) { enemy.speedMul = pr.slowMul; enemy.slowTicks = pr.slowTicks!; }
        this.damageEnemy(enemy.id, pr.dmg, events, pr.crit);
      } else if (player?.alive) {
        this.damagePlayer(player.id, pr.dmg);
        events.push({ kind: 'damage', pos: { ...player.pos }, amount: pr.dmg, crit: false });
      } else if (building) {
        this.damageBuilding(building.id, pr.dmg, events);
      }
    }
  }

  damageEnemy(id: EntityId, amount: number, events: SimEvent[], crit = false): void {
    const e = this.state.enemies.get(id);
    if (!e) return;
    e.hp -= amount;
    events.push({ kind: 'damage', pos: { ...e.pos }, amount, crit });
    if (e.hp > 0) return;
    this.state.enemies.delete(id);
    const def = ENEMIES[e.type];
    const coins = Math.round(def.coins * this.teamMods().coinMul * this.state.bonuses.coinMul);
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
      const dmg = Math.round(stats.dmg * team.towerDmgMul * this.state.bonuses.towerDmgMul);

      if (b.type === 'bomb_tower') {
        events.push({ kind: 'projectile', from: center, to: { ...target.pos }, weapon: 'bomb' });
        this.spawnProjectile('bomb', center, dmg, {
          targetPos: { ...target.pos }, aoeRadius: stats.aoeRadius,
        });
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
      } else if (b.type === 'ice_tower') {
        // ice stays hitscan — the frost beam visual reads as instant
        events.push({ kind: 'projectile', from: center, to: { ...target.pos }, weapon: 'ice' });
        target.speedMul = stats.slowMul!;
        target.slowTicks = stats.slowTicks!;
        this.damageEnemy(target.id, dmg, events);
      } else {
        const weapon = b.type === 'crossbow_tower' ? 'bolt' : 'arrow';
        events.push({ kind: 'projectile', from: center, to: { ...target.pos }, weapon });
        this.spawnProjectile(weapon, center, dmg, { targetEnemy: target.id });
      }
    }
  }

  /** Players auto-attack the nearest enemy in weapon range — no input needed. */
  private stepPlayerCombat(events: SimEvent[]): void {
    for (const p of this.state.players.values()) {
      if (!p.alive || p.attackCooldown > 0) continue;
      const w = WEAPON_STATS[p.weapon];
      // class passives: knight +25% melee dmg, hunter +20% ranged range
      let dmg = w.dmg * p.mods.playerDmgMul * this.state.bonuses.playerDmgMul
        * combatDmgMul(p.combatLevel);
      if (p.klass === 'knight' && p.weapon === 'sword') dmg *= 1.25;
      let range = w.range;
      if (p.klass === 'hunter' && p.weapon !== 'sword') range *= 1.2;
      const target = nearestEnemy(this.state.enemies.values(), p.pos, range);
      if (!target) continue;
      p.attackCooldown = Math.round(w.cooldown /
        (p.mods.playerAttackSpeedMul * combatSpeedMul(p.combatLevel)));
      const crit = this.rng.next() < p.mods.critChance;
      if (crit) dmg *= 2;
      if (p.weapon !== 'sword') {
        // ranged shots fly as real projectiles: damage lands when the arrow does
        const weapon = p.weapon === 'bow' ? 'arrow' : 'bolt';
        events.push({ kind: 'projectile', from: { ...p.pos }, to: { ...target.pos }, weapon });
        this.spawnProjectile(weapon, p.pos, Math.round(dmg), { targetEnemy: target.id, crit });
      } else {
        events.push({ kind: 'melee', pos: { ...p.pos } });
        this.damageEnemy(target.id, Math.round(dmg), events, crit);
      }
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
      const dmg = Math.round(def.dmg * enemyDmgScale(Math.max(1, this.state.wave))
        * (e.enraged ? 1.5 : 1) * this.state.bonuses.enemyDmgMul);

      // 1. aggro: a player nearby pulls the zombie off its castle path entirely
      let aggro: Player | null = null; let ad = ENEMY_AGGRO_RANGE;
      for (const p of this.state.players.values()) {
        if (!p.alive) continue;
        const d = dist(p.pos, e.pos);
        if (d <= ad) { ad = d; aggro = p; }
      }
      if (aggro) {
        if (ad <= def.attackRange) {
          // in range: stand and fight
          if (e.attackCooldown === 0) {
            e.attackCooldown = def.attackCooldownTicks;
            if (def.attackRange > 2) {
              events.push({ kind: 'projectile', from: { ...e.pos }, to: { ...aggro.pos }, weapon: 'spit' });
              this.spawnProjectile('spit', e.pos, dmg, { targetPlayer: aggro.id });
            } else {
              this.damagePlayer(aggro.id, dmg);
            }
          }
        } else {
          this.moveEnemyToward(e, aggro.pos, speed, events);
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
            this.spawnProjectile('spit', e.pos, dmg, { targetBuilding: targetB.id });
          } else {
            this.damageBuilding(targetB.id, dmg, events);
          }
        }
        continue;  // hold position while attacking
      }

      // 3. march on the castle
      this.moveEnemyToward(e, castleCenter, speed, events);
    }
  }

  private moveEnemyToward(e: Enemy, target: Vec2, speed: number, events: SimEvent[]): void {
    const wading = inRiver(e.pos, this.river);
    const moveSpeed = speed * (wading ? 0.55 : 1);
    const dx = target.x - e.pos.x, dy = target.y - e.pos.y;
    const len = Math.hypot(dx, dy) || 1;
    e.pos.x += (dx / len) * moveSpeed;
    e.pos.y += (dy / len) * moveSpeed;
    if (wading && (this.state.tick + e.id) % 9 === 0) {
      events.push({ kind: 'splash', pos: { ...e.pos } });
    }
  }

  /** Soft-body separation: zombies shoulder each other apart instead of stacking. */
  private stepSeparation(): void {
    if (this.state.enemies.size < 2) return;
    const buckets = new Map<number, Enemy[]>();
    const key = (x: number, y: number) => (Math.floor(x / 2) << 10) | Math.floor(y / 2);
    for (const e of this.state.enemies.values()) {
      const k = key(e.pos.x, e.pos.y);
      const arr = buckets.get(k);
      if (arr) arr.push(e); else buckets.set(k, [e]);
    }
    for (const e of this.state.enemies.values()) {
      const ra = ENEMIES[e.type].radius;
      const bx = Math.floor(e.pos.x / 2), by = Math.floor(e.pos.y / 2);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const cell = buckets.get(((bx + ox) << 10) | (by + oy));
        if (!cell) continue;
        for (const o of cell) {
          if (o.id <= e.id) continue;   // each pair once
          const rb = ENEMIES[o.type].radius;
          const minD = (ra + rb) * 0.9;
          const dx = o.pos.x - e.pos.x, dy = o.pos.y - e.pos.y;
          const d = Math.hypot(dx, dy);
          if (d >= minD || d === 0) continue;
          const push = (minD - d) / 2;
          const nx = dx / d, ny = dy / d;
          e.pos.x -= nx * push; e.pos.y -= ny * push;
          o.pos.x += nx * push; o.pos.y += ny * push;
        }
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
      if (p.gatherCooldown > 0) p.gatherCooldown--;
      const dir = this.moveIntent.get(p.id);
      if (dir) {
        p.gatherTarget = null;   // moving cancels the gathering channel
        const wading = inRiver(p.pos, this.river);
        const speed = PLAYER_SPEED * this.state.bonuses.playerSpeedMul * (wading ? 0.5 : 1);
        const len = Math.hypot(dir.x, dir.y) || 1;
        // axis-separated movement: blocked on one axis still slides on the other
        this.tryMovePlayer(p, (dir.x / len) * speed, 0);
        this.tryMovePlayer(p, 0, (dir.y / len) * speed);
        if (wading && (this.state.tick + p.id) % 7 === 0) {
          events.push({ kind: 'splash', pos: { ...p.pos } });
        }
      }
    }
    this.moveIntent.clear();
  }

  /** Solid-world collision: buildings (except gates), resource nodes, bridge rails. */
  private tryMovePlayer(p: Player, dx: number, dy: number): void {
    const next = {
      x: clamp(p.pos.x + dx, 0.5, MAP_SIZE - 0.5),
      y: clamp(p.pos.y + dy, 0.5, MAP_SIZE - 0.5),
    };
    if (this.isSolidAt(next)) return;
    if (crossesBridgeRail(p.pos, next, this.river)) return;
    p.pos.x = next.x;
    p.pos.y = next.y;
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
    if (decorBlocks(this.decor, pos)) return true;   // houses, towers, the windmill
    const id = this.grid.occupantAt(pos);
    if (id === 0) return false;
    const b = this.state.buildings.get(id);
    if (b) return !BUILDINGS[b.type].walkable;   // gates are passable
    return this.state.nodes.has(id);             // trees and rocks are solid
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
