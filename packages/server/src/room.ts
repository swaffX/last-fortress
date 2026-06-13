import type { WebSocket } from 'ws';
import {
  Sim, TICK_MS, BUILDINGS, regionAt,
  type EntityId, type SimEvent, type Command,
} from '@lf/shared';
import {
  encode, type ServerMsg, type BuildingView, type PlayerView,
  type NodeView, type GroundItemView,
} from './protocol';
import type { Profile, ProfileStore } from './db';
import type { WorldStore, WorldRecord } from './world-store';

const MAX_PLAYERS = 4;
const RECONNECT_MS = 120_000;
const MAX_CMDS_PER_TICK = 32;
const SAVE_EVERY_TICKS = 30 * 20;          // ~30 s

interface Seat {
  deviceId: string;
  profile: Profile;
  ws: WebSocket | null;
  playerId: EntityId | null;
  disconnectedAt: number | null;
  cmdCount: number;
  lastChat: number;
}

export class Room {
  readonly code: string;
  readonly solo: boolean;
  private seats: Seat[] = [];
  private sim: Sim | null = null;
  private timer: NodeJS.Timeout | null = null;
  private state: 'lobby' | 'playing' = 'lobby';
  private bindings: Record<string, number> = {};   // deviceId → playerId (persisted)
  private seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;

  constructor(code: string, solo: boolean,
              private store: ProfileStore,
              private worlds: WorldStore,
              readonly partyId: string,
              private onEmpty: (code: string) => void) {
    this.code = code; this.solo = solo;
    void this.store;   // reserved for future profile writes (stats)
  }

  get isFull(): boolean { return this.seats.filter(s => s.ws || this.inWindow(s)).length >= MAX_PLAYERS; }
  get isJoinable(): boolean { return !this.solo && !this.isFull; }   // survival: join anytime
  hasDevice(deviceId: string): boolean { return this.seats.some(s => s.deviceId === deviceId); }
  hasWs(ws: WebSocket): boolean { return this.seats.some(s => s.ws === ws); }
  private inWindow(s: Seat): boolean {
    return s.disconnectedAt !== null && Date.now() - s.disconnectedAt < RECONNECT_MS;
  }

  addPlayer(ws: WebSocket, profile: Profile): void {
    const existing = this.seats.find(s => s.deviceId === profile.deviceId);
    if (existing) {
      existing.ws = ws; existing.disconnectedAt = null; existing.profile = profile;
      if (this.state === 'playing' && this.sim && existing.playerId !== null) this.sendGameStart(existing);
      else this.broadcastLobby();
      return;
    }
    const seat: Seat = {
      deviceId: profile.deviceId, profile, ws,
      playerId: null, disconnectedAt: null, cmdCount: 0, lastChat: 0,
    };
    this.seats.push(seat);
    if (this.state === 'playing' && this.sim) {
      // survival: late joiners spawn straight into the running world
      this.attachSeatToSim(seat);
      this.sendGameStart(seat);
    } else {
      this.broadcastLobby();
    }
  }

  handleDisconnect(ws: WebSocket): void {
    const seat = this.seats.find(s => s.ws === ws);
    if (!seat) return;
    seat.ws = null; seat.disconnectedAt = Date.now();
    if (this.state === 'lobby') { this.seats = this.seats.filter(s => s !== seat); this.broadcastLobby(); }
    void this.persist();
    this.checkEmpty();
  }

  handleLeave(ws: WebSocket): void {
    const seat = this.seats.find(s => s.ws === ws);
    if (!seat) return;
    // leaving keeps the player's body/inventory in the saved world (binding retained)
    this.seats = this.seats.filter(s => s !== seat);
    if (this.state === 'lobby') this.broadcastLobby();
    void this.persist();
    this.checkEmpty();
  }

  async handleStart(ws: WebSocket): Promise<void> {
    if (this.state !== 'lobby') return;
    if (this.seats.length === 0 || this.seats[0]!.ws !== ws) return;   // host only
    const rec = await this.worlds.load(this.partyId);
    if (rec) {
      this.sim = Sim.fromState(rec.state);
      this.bindings = rec.bindings;
      this.seed = rec.state.worldSeed;
    } else {
      this.sim = new Sim(this.seed);
      this.bindings = {};
    }
    this.state = 'playing';
    for (const seat of this.seats) this.attachSeatToSim(seat);
    for (const seat of this.seats) this.sendGameStart(seat);
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Reattach a returning device to its saved player, or spawn a fresh one. */
  private attachSeatToSim(seat: Seat): void {
    if (!this.sim) return;
    const bound = this.bindings[seat.deviceId];
    if (bound !== undefined && this.sim.state.players.has(bound)) {
      seat.playerId = bound;
      return;
    }
    const p = this.sim.addPlayer(seat.profile.unlockedSkills);
    seat.playerId = p.id;
    this.bindings[seat.deviceId] = p.id;
  }

  handleCommand(ws: WebSocket, cmd: Command): void {
    if (this.state !== 'playing' || !this.sim) return;
    const seat = this.seats.find(s => s.ws === ws);
    if (!seat || seat.playerId === null) return;
    if (++seat.cmdCount > MAX_CMDS_PER_TICK) return;
    if (!validCommand(cmd)) return;
    this.sim.applyCommand(seat.playerId, cmd);
  }

  handlePing(ws: WebSocket, pos: { x: number; y: number }): void {
    const seat = this.seats.find(s => s.ws === ws);
    if (!seat) return;
    this.broadcast({ t: 'ping', pos, from: seat.profile.name });
  }

  handleChat(ws: WebSocket, text: string): void {
    const seat = this.seats.find(s => s.ws === ws);
    if (!seat) return;
    const clean = text.slice(0, 120).trim();
    if (!clean) return;
    const now = Date.now();
    if (now - seat.lastChat < 400) return;
    seat.lastChat = now;
    this.broadcast({ t: 'chat', from: seat.profile.name, text: clean });
  }

  handleGhost(ws: WebSocket, type: import('@lf/shared').BuildingType | null,
              pos: { x: number; y: number }, ok: boolean): void {
    const seat = this.seats.find(s => s.ws === ws);
    if (!seat) return;
    const msg = encode({ t: 'ghost', from: seat.profile.name, type, pos, ok });
    for (const o of this.seats) {
      if (o !== seat && o.ws && o.ws.readyState === o.ws.OPEN) o.ws.send(msg);
    }
  }

  private tick(): void {
    if (!this.sim) return;
    const events = this.sim.step();
    this.broadcast(this.buildFrame(events));
    for (const s of this.seats) s.cmdCount = 0;
    if (this.sim.state.tick % SAVE_EVERY_TICKS === 0) void this.persist();
    const before = this.seats.length;
    this.seats = this.seats.filter(s => s.ws !== null || this.inWindow(s));
    if (this.seats.length !== before) this.checkEmpty();
  }

  private async persist(): Promise<void> {
    if (!this.sim) return;
    const rec: WorldRecord = { state: this.sim.state, bindings: this.bindings };
    try { await this.worlds.save(this.partyId, rec); }
    catch (e) { console.warn(`[room ${this.code}] save failed`, e); }
  }

  closeLobby(): void {
    this.broadcast({ t: 'lobby_closed' });
    this.seats = [];
    this.destroy();
    this.onEmpty(this.code);
  }

  destroy(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  private checkEmpty(): void {
    const active = this.seats.some(s => s.ws !== null || this.inWindow(s));
    if (!active) { void this.persist(); this.destroy(); this.onEmpty(this.code); }
  }

  // ---- views ----

  private buildFrame(events: SimEvent[]): ServerMsg {
    const s = this.sim!.state;
    return {
      t: 'frame', tick: s.tick, phase: s.phase, phaseTicks: s.phaseTicks,
      players: this.playerViews(), buildings: this.buildingViews(),
      groundItems: this.groundItemViews(), events,
    };
  }
  private playerViews(): PlayerView[] {
    const out: PlayerView[] = [];
    for (const seat of this.seats) {
      if (seat.playerId === null) continue;
      const p = this.sim!.state.players.get(seat.playerId);
      if (!p) continue;
      out.push({
        id: p.id, pos: p.pos, hp: p.hp, maxHp: p.maxHp, alive: p.alive, name: seat.profile.name,
        hunger: p.hunger, temperature: p.temperature, hand: p.hand, region: regionAt(this.sim!.regions, p.pos).name,
        inventory: p.inventory, equipment: p.equipment,
      });
    }
    return out;
  }
  private buildingViews(): BuildingView[] {
    return [...this.sim!.state.buildings.values()].map(b => ({
      id: b.id, type: b.type, pos: b.pos, hp: b.hp, maxHp: b.maxHp,
    }));
  }
  private groundItemViews(): GroundItemView[] {
    return [...this.sim!.state.groundItems.values()].map(g => ({
      id: g.id, item: g.item, count: g.count, pos: g.pos,
    }));
  }
  private nodeViews(): NodeView[] {
    return [...this.sim!.state.nodes.values()].map(n => ({ id: n.id, kind: n.kind, pos: n.pos, amount: n.amount }));
  }

  private sendGameStart(seat: Seat): void {
    this.send(seat, { t: 'game_start', seed: this.seed, selfId: seat.playerId!,
      nodes: this.nodeViews(), buildings: this.buildingViews() });
  }
  private broadcastLobby(): void {
    for (const seat of this.seats) {
      this.send(seat, { t: 'lobby', code: this.code,
        players: this.seats.map(s => ({ name: s.profile.name })), host: this.seats[0] === seat });
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
    case 'move': return isFiniteVec(cmd.dir);
    case 'gather': case 'eat': return true;
    case 'select_hand': return Number.isInteger(cmd.slot);
    case 'move_item': return Number.isInteger(cmd.from) && Number.isInteger(cmd.to);
    case 'drop_item': return Number.isInteger(cmd.slot) && Number.isInteger(cmd.count) && cmd.count > 0;
    case 'craft': return typeof cmd.recipeId === 'string';
    case 'repair_hand': return true;
    case 'build': return typeof cmd.type === 'string' && cmd.type in BUILDINGS && isFiniteVec(cmd.pos);
    case 'demolish': return Number.isInteger(cmd.buildingId);
    default: return false;
  }
}
function isFiniteVec(v: unknown): boolean {
  return typeof v === 'object' && v !== null &&
    Number.isFinite((v as { x: unknown }).x) && Number.isFinite((v as { y: unknown }).y);
}
