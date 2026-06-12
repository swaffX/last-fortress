import type { WebSocket } from 'ws';
import {
  Sim, TICK_MS, BUILDINGS, UPGRADE_CHOICES,
  type ClassType, type EntityId, type SimEvent, type Command,
} from '@lf/shared';
import {
  encode, type ServerMsg, type BuildingView, type EnemyView, type PlayerView,
  type NodeView, type ProjectileView,
} from './protocol';
import type { Profile, ProfileStore } from './db';

const MAX_PLAYERS = 2;
const RECONNECT_MS = 60_000;
const MAX_CMDS_PER_TICK = 24;   // hold-to-gather sends every input tick

/** crafting costs per target tier */
const TOOL_COSTS: Record<'axe' | 'pick', Record<number, { wood: number; stone: number } | undefined>> = {
  axe: { 2: { wood: 60, stone: 20 }, 3: { wood: 150, stone: 80 } },
  pick: { 2: { wood: 40, stone: 30 }, 3: { wood: 100, stone: 90 } },
};

interface Seat {
  deviceId: string;
  profile: Profile;
  klass: ClassType;
  ws: WebSocket | null;          // null while disconnected (reconnect window)
  playerId: EntityId | null;     // assigned at game start
  disconnectedAt: number | null;
  cmdCount: number;              // rate limit, reset each tick
  kills: number;
  lastChat: number;
}

export class Room {
  readonly code: string;
  private seats: Seat[] = [];
  private sim: Sim | null = null;
  private seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  private timer: NodeJS.Timeout | null = null;
  private state: 'lobby' | 'playing' | 'over' = 'lobby';
  readonly solo: boolean;
  /** wave-upgrade vote in progress (null = none) */
  private choice: { options: typeof UPGRADE_CHOICES; votes: Map<string, number> } | null = null;
  private restartVotes = new Set<string>();

  constructor(code: string, solo: boolean, private store: ProfileStore,
              private onEmpty: (code: string) => void) {
    this.code = code;
    this.solo = solo;
  }

  get isFull(): boolean { return this.seats.filter(s => s.ws || this.inWindow(s)).length >= MAX_PLAYERS; }
  get isJoinable(): boolean { return this.state === 'lobby' && !this.solo && !this.isFull; }
  hasDevice(deviceId: string): boolean { return this.seats.some(s => s.deviceId === deviceId); }
  hasWs(ws: WebSocket): boolean { return this.seats.some(s => s.ws === ws); }

  private inWindow(s: Seat): boolean {
    return s.disconnectedAt !== null && Date.now() - s.disconnectedAt < RECONNECT_MS;
  }

  addPlayer(ws: WebSocket, profile: Profile, klass: ClassType): void {
    // reconnect: same device returning?
    const existing = this.seats.find(s => s.deviceId === profile.deviceId);
    if (existing) {
      existing.ws = ws;
      existing.disconnectedAt = null;
      existing.profile = profile;
      if (this.state === 'playing' && this.sim && existing.playerId !== null) {
        this.sendGameStart(existing);
      } else {
        this.broadcastLobby();
      }
      return;
    }
    this.seats.push({
      deviceId: profile.deviceId, profile, klass, ws,
      playerId: null, disconnectedAt: null, cmdCount: 0, kills: 0, lastChat: 0,
    });
    this.broadcastLobby();
  }

  handleDisconnect(ws: WebSocket): void {
    const seat = this.seats.find(s => s.ws === ws);
    if (!seat) return;
    seat.ws = null;
    seat.disconnectedAt = Date.now();
    if (this.state === 'lobby') {
      this.seats = this.seats.filter(s => s !== seat);
      this.broadcastLobby();
    }
    this.checkEmpty();
  }

  handleLeave(ws: WebSocket): void {
    const seat = this.seats.find(s => s.ws === ws);
    if (!seat) return;
    if (this.state === 'over') { this.closeLobby(); return; }   // main menu dissolves the lobby
    if (this.sim && seat.playerId !== null) this.sim.removePlayer(seat.playerId);
    this.seats = this.seats.filter(s => s !== seat);
    if (this.state === 'lobby') this.broadcastLobby();
    this.checkEmpty();
  }

  handleStart(ws: WebSocket): void {
    if (this.state !== 'lobby') return;
    if (this.seats.length === 0 || this.seats[0]!.ws !== ws) return;  // host only
    this.state = 'playing';
    this.sim = new Sim(this.seed);
    for (const seat of this.seats) {
      const p = this.sim.addPlayer(seat.klass, seat.profile.unlockedSkills, seat.profile.tools);
      seat.playerId = p.id;
    }
    for (const seat of this.seats) this.sendGameStart(seat);
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  handleCommand(ws: WebSocket, cmd: Command): void {
    if (this.state !== 'playing' || !this.sim) return;
    const seat = this.seats.find(s => s.ws === ws);
    if (!seat || seat.playerId === null) return;
    if (++seat.cmdCount > MAX_CMDS_PER_TICK) return;            // rate limit: silent drop
    if (!validCommand(cmd)) { console.warn(`[room ${this.code}] invalid cmd dropped`); return; }
    this.sim.applyCommand(seat.playerId, cmd);
  }

  handlePing(ws: WebSocket, pos: { x: number; y: number }): void {
    const seat = this.seats.find(s => s.ws === ws);
    if (!seat) return;
    this.broadcast({ t: 'ping', pos, from: seat.profile.name });
  }

  /** Tool upgrades cost raw materials (crafting), persist on the profile. */
  handleToolUpgrade(ws: WebSocket, tool: 'axe' | 'pick'): { profile: Profile } | null {
    const seat = this.seats.find(s => s.ws === ws);
    if (!seat || !this.sim || this.state !== 'playing') return null;
    const tier = seat.profile.tools[tool];
    const cost = TOOL_COSTS[tool][tier + 1];
    if (!cost) return null;
    const res = this.sim.state.resources;
    if (res.wood < cost.wood || res.stone < cost.stone) return null;
    res.wood -= cost.wood;
    res.stone -= cost.stone;
    seat.profile.tools[tool] = tier + 1;
    if (seat.playerId !== null) this.sim.setPlayerTool(seat.playerId, tool, tier + 1);
    void this.store.save(seat.profile);
    return { profile: seat.profile };
  }

  handleChat(ws: WebSocket, text: string): void {
    const seat = this.seats.find(s => s.ws === ws);
    if (!seat) return;
    const clean = text.slice(0, 120).trim();
    if (!clean) return;
    const now = Date.now();
    if (now - seat.lastChat < 400) return;   // rate limit
    seat.lastChat = now;
    this.broadcast({ t: 'chat', from: seat.profile.name, text: clean });
  }

  /** Relay a player's build-cursor ghost to teammates. */
  handleGhost(ws: WebSocket, type: import('@lf/shared').BuildingType | null,
              pos: { x: number; y: number }, ok: boolean): void {
    const seat = this.seats.find(s => s.ws === ws);
    if (!seat) return;
    const msg = encode({ t: 'ghost', from: seat.profile.name, type, pos, ok });
    for (const other of this.seats) {
      if (other !== seat && other.ws && other.ws.readyState === other.ws.OPEN) other.ws.send(msg);
    }
  }

  private tick(): void {
    if (!this.sim) return;
    const events = this.sim.step();
    this.trackKills(events);
    // every 3rd survived wave: offer a team upgrade vote at dawn
    for (const e of events) {
      if (e.kind === 'phase_change' && e.phase === 'day' &&
          this.sim.state.wave > 0 && this.sim.state.wave % 3 === 0 && !this.choice) {
        this.offerChoice();
      }
    }
    this.broadcast(this.buildFrame(events));
    for (const s of this.seats) s.cmdCount = 0;

    if (this.sim.state.gameOver) void this.finish();
    // expire reconnect windows
    const before = this.seats.length;
    this.seats = this.seats.filter(s => s.ws !== null || this.inWindow(s));
    if (this.seats.length !== before) this.checkEmpty();
  }

  // ---- wave-upgrade voting: unanimous or nothing ----

  private offerChoice(): void {
    const pool = [...UPGRADE_CHOICES];
    const options: typeof UPGRADE_CHOICES = [];
    for (let i = 0; i < 3 && pool.length > 0; i++) {
      options.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]!);
    }
    this.choice = { options, votes: new Map() };
    this.broadcast({ t: 'choice_offer', options });
  }

  handleVote(ws: WebSocket, option: number): void {
    if (!this.choice || !this.sim) return;
    const seat = this.seats.find(s => s.ws === ws);
    if (!seat || option < 0 || option >= this.choice.options.length) return;
    this.choice.votes.set(seat.deviceId, option);
    const active = this.seats.filter(s => s.ws !== null);
    this.broadcast({
      t: 'choice_state',
      votes: active.map(s => this.choice!.votes.get(s.deviceId) ?? null),
    });
    // unanimity across all connected seats
    const votes = active.map(s => this.choice!.votes.get(s.deviceId));
    if (votes.length > 0 && votes.every(v => v !== undefined && v === votes[0])) {
      const picked = this.choice.options[votes[0]!]!;
      this.sim.applyUpgrade(picked.id);
      this.broadcast({ t: 'choice_applied', option: picked });
      this.choice = null;
    }
  }

  // ---- game-over flow: unanimous Try Again restarts; any Main Menu closes ----

  handleRestartVote(ws: WebSocket): void {
    if (this.state !== 'over') return;
    const seat = this.seats.find(s => s.ws === ws);
    if (!seat) return;
    this.restartVotes.add(seat.deviceId);
    const active = this.seats.filter(s => s.ws !== null);
    this.broadcast({ t: 'restart_state', votes: this.restartVotes.size, needed: active.length });
    if (active.every(s => this.restartVotes.has(s.deviceId))) this.restart();
  }

  private restart(): void {
    this.restartVotes.clear();
    this.choice = null;
    this.seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    this.sim = new Sim(this.seed);
    for (const seat of this.seats) {
      seat.kills = 0;
      const p = this.sim.addPlayer(seat.klass, seat.profile.unlockedSkills, seat.profile.tools);
      seat.playerId = p.id;
    }
    this.state = 'playing';
    for (const seat of this.seats) this.sendGameStart(seat);
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Any player choosing Main Menu after game over dissolves the lobby. */
  closeLobby(): void {
    this.broadcast({ t: 'lobby_closed' });
    this.seats = [];
    this.destroy();
    this.onEmpty(this.code);
  }

  private trackKills(events: SimEvent[]): void {
    // Phase 1: kills credited to the team; split evenly on save.
    const deaths = events.filter(e => e.kind === 'death').length;
    if (deaths === 0 || this.seats.length === 0) return;
    for (const s of this.seats) s.kills += deaths / this.seats.length;
  }

  private async finish(): Promise<void> {
    if (this.state === 'over' || !this.sim) return;
    this.state = 'over';
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const wave = this.sim.state.wave;
    const coins = this.sim.state.resources.coins;
    const skillPointsEarned = Math.max(1, Math.floor(wave / 2));
    for (const seat of this.seats) {
      seat.profile.gamesPlayed++;
      seat.profile.totalKills += Math.round(seat.kills);
      seat.profile.bestWave = Math.max(seat.profile.bestWave, wave);
      seat.profile.skillPoints += skillPointsEarned;
      await this.store.save(seat.profile);
      this.send(seat, { t: 'game_over', wave, coinsEarned: coins, skillPointsEarned });
      this.send(seat, { t: 'profile', profile: seat.profile });
    }
  }

  destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private checkEmpty(): void {
    const active = this.seats.some(s => s.ws !== null || this.inWindow(s));
    if (!active) {
      this.destroy();
      this.onEmpty(this.code);
    }
  }

  // ---- views & messaging ----

  private buildFrame(events: SimEvent[]): ServerMsg {
    const s = this.sim!.state;
    return {
      t: 'frame',
      tick: s.tick, phase: s.phase,
      phaseTicks: s.phase === 'day' ? s.phaseTicks : -1,
      wave: s.wave, resources: s.resources,
      players: this.playerViews(), enemies: this.enemyViews(),
      buildings: this.buildingViews(),
      projectiles: [...s.projectiles.values()].map(pr => ({
        id: pr.id, kind: pr.kind, pos: pr.pos,
      })) as ProjectileView[],
      events,
    };
  }

  private playerViews(): PlayerView[] {
    const out: PlayerView[] = [];
    for (const seat of this.seats) {
      if (seat.playerId === null) continue;
      const p = this.sim!.state.players.get(seat.playerId);
      if (!p) continue;
      out.push({ id: p.id, klass: p.klass, pos: p.pos, hp: p.hp, maxHp: p.maxHp,
                 alive: p.alive, name: seat.profile.name });
    }
    return out;
  }
  private enemyViews(): EnemyView[] {
    return [...this.sim!.state.enemies.values()].map(e => ({
      id: e.id, type: e.type, pos: e.pos, hp: e.hp, maxHp: e.maxHp,
      slowed: e.slowTicks > 0, enraged: e.enraged,
    }));
  }
  private buildingViews(): BuildingView[] {
    return [...this.sim!.state.buildings.values()].map(b => ({
      id: b.id, type: b.type, tier: b.tier, pos: b.pos, hp: b.hp, maxHp: b.maxHp,
    }));
  }
  private nodeViews(): NodeView[] {
    return [...this.sim!.state.nodes.values()].map(n => ({
      id: n.id, kind: n.kind, pos: n.pos, amount: n.amount,
    }));
  }

  private sendGameStart(seat: Seat): void {
    this.send(seat, {
      t: 'game_start', seed: this.seed, selfId: seat.playerId!,
      nodes: this.nodeViews(), buildings: this.buildingViews(),
    });
  }

  private broadcastLobby(): void {
    for (const seat of this.seats) {
      this.send(seat, {
        t: 'lobby', code: this.code,
        players: this.seats.map(s => ({ name: s.profile.name, klass: s.klass })),
        host: this.seats[0] === seat,
      });
    }
  }

  private broadcast(msg: ServerMsg): void {
    const data = encode(msg);
    for (const seat of this.seats) {
      if (seat.ws && seat.ws.readyState === seat.ws.OPEN) seat.ws.send(data);
    }
  }
  private send(seat: Seat, msg: ServerMsg): void {
    if (seat.ws && seat.ws.readyState === seat.ws.OPEN) seat.ws.send(encode(msg));
  }
}

function validCommand(cmd: Command): boolean {
  switch (cmd.kind) {
    case 'move': case 'attack':
      return isFiniteVec(cmd.dir);
    case 'build':
      return typeof cmd.type === 'string' && cmd.type in BUILDINGS && isFiniteVec(cmd.pos);
    case 'upgrade': case 'demolish':
      return Number.isInteger(cmd.buildingId);
    default:
      return false;
  }
}
function isFiniteVec(v: unknown): boolean {
  return typeof v === 'object' && v !== null &&
    Number.isFinite((v as { x: unknown }).x) && Number.isFinite((v as { y: unknown }).y);
}
