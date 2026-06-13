import {
  BUILDINGS, MAP_SIZE, riverParams, riverYAt, RIVER_WIDTH, BRIDGE_XS, CASTLE_POS,
  combatUpgradeCost,
  type BuildingType, type Resources, type Phase, type SimEvent,
} from '@lf/shared';
import type { UpgradeDef } from '@lf/shared';
import type { BuildingView, EnemyView, PlayerView, NodeView } from '../net';

const BUILD_ITEMS: { type: BuildingType; ico: string; name: string }[] = [
  { type: 'wood_wall', ico: '🪵', name: 'Wall' },
  { type: 'stone_wall', ico: '🧱', name: 'S.Wall' },
  { type: 'gate', ico: '🚪', name: 'Gate' },
  { type: 'spike', ico: '🗡', name: 'Spikes' },
  { type: 'archer_tower', ico: '🏹', name: 'Archer' },
  { type: 'crossbow_tower', ico: '🎯', name: 'X-Bow' },
  { type: 'bomb_tower', ico: '💣', name: 'Bomb' },
  { type: 'ice_tower', ico: '❄️', name: 'Ice' },
  { type: 'lightning_tower', ico: '⚡', name: 'Tesla' },
  { type: 'wood_camp', ico: '🪓', name: 'Lumber' },
  { type: 'stone_quarry', ico: '⛏', name: 'Quarry' },
  { type: 'gold_mine', ico: '🪙', name: 'Mine' },
  { type: 'healing_totem', ico: '✨', name: 'Totem' },
];

function costStr(type: BuildingType): string {
  const c = BUILDINGS[type].tiers[0]!.cost;
  const parts: string[] = [];
  if (c.wood) parts.push(`${c.wood}W`);
  if (c.stone) parts.push(`${c.stone}S`);
  if (c.gold) parts.push(`${c.gold}G`);
  if (c.coins) parts.push(`${c.coins}C`);
  return parts.join(' ');
}

/** crafting costs + labels per current tier (mirrors the server table) */
const TOOL_COSTS: Record<'axe' | 'pick', Record<number, { w: number; s: number } | null>> = {
  axe: { 1: { w: 60, s: 20 }, 2: { w: 150, s: 80 }, 3: null },
  pick: { 1: { w: 40, s: 30 }, 2: { w: 100, s: 90 }, 3: null },
};
const TOOL_COST_LABEL: Record<'axe' | 'pick', Record<number, string>> = {
  axe: { 1: '▲ 60W 20S', 2: '▲ 150W 80S', 3: 'MAX' },
  pick: { 1: '▲ 40W 30S', 2: '▲ 100W 90S', 3: 'MAX' },
};

export class Hud {
  private root: HTMLElement;
  private mini!: CanvasRenderingContext2D;
  private terrain: HTMLCanvasElement | null = null;
  private miniNodes = new Map<number, NodeView>();
  private lastRes: Resources = { wood: -1, stone: -1, gold: -1, coins: -1 };
  onBuildSelect: (type: BuildingType | null) => void = () => {};
  onUpgrade: (id: number) => void = () => {};
  onDemolish: (id: number) => void = () => {};
  private activeBuild: BuildingType | null = null;
  private selectedId: number | null = null;

  constructor() {
    this.root = document.getElementById('hud')!;
    this.root.innerHTML = `
      <div class="res-bar">
        <div class="res" data-r="wood"><span class="ico">🪵</span><span class="v">0</span></div>
        <div class="res" data-r="stone"><span class="ico">🧱</span><span class="v">0</span></div>
        <div class="res" data-r="gold"><span class="ico">🪙</span><span class="v">0</span></div>
        <div class="res" data-r="coins"><span class="ico">💰</span><span class="v">0</span></div>
      </div>
      <div class="hud-top">
        <span class="wave-label">Wave <b id="wave-n">0</b></span>
        <span class="phase-pill day" id="phase-pill">Day</span>
        <span id="phase-timer" style="font-variant-numeric:tabular-nums;color:var(--steel)"></span>
      </div>
      <div class="castle-bar">
        <div class="track"><div class="fill" id="castle-fill" style="width:100%"></div></div>
        <div class="lbl">Castle</div>
      </div>
      <div class="boss-bar hidden" id="boss-bar">
        <div class="nm">The Butcher</div>
        <div class="track"><div class="fill" id="boss-fill" style="width:100%"></div></div>
      </div>
      <div class="party-panel" id="party-panel"></div>
      <div class="build-bar" id="inv-bar">
        <button class="build-slot" id="inv-hammer" title="Build menu (B)">
          <span class="ico">🔨</span><span class="nm">Build</span><span class="cost">B</span>
        </button>
        <button class="build-slot" id="inv-axe">
          <span class="ico">🪓</span><span class="nm">Axe <b id="axe-tier">I</b></span><span class="cost" id="axe-cost"></span>
        </button>
        <button class="build-slot" id="inv-pick">
          <span class="ico">⛏</span><span class="nm">Pick <b id="pick-tier">I</b></span><span class="cost" id="pick-cost"></span>
        </button>
        <button class="build-slot" id="inv-strike">
          <span class="ico">⚔️</span><span class="nm">Strike <b id="strike-lv">0</b></span><span class="cost" id="strike-cost"></span>
        </button>
      </div>
      <div class="build-menu hidden" id="build-menu">
        <div class="bm-title">Construction</div>
        <div class="bm-grid" id="bm-grid"></div>
      </div>
      <div class="hud-hint">WASD move · Auto-attack · [E] gather near trees/rocks · B build · K skills</div>
      <div class="minimap"><canvas id="minimap" width="164" height="164"></canvas></div>
      <div class="sel-panel hidden" id="sel-panel"></div>
      <div class="interact-prompt hidden" id="interact-prompt"></div>
      <div class="perf-panel" id="perf-panel"><span id="perf-fps">0</span> FPS · <span id="perf-ping">—</span> ms</div>
      <div class="chat-box" id="chat-box">
        <div class="chat-log" id="chat-log"></div>
        <input class="chat-input hidden" id="chat-input" maxlength="120" placeholder="Press Enter to chat…">
      </div>
      <div class="choice-overlay hidden" id="choice-overlay"></div>
      <div class="dmg-layer" id="dmg-layer"></div>
      <div class="notif-stack" id="notif-stack"></div>
      <div id="banner-slot"></div>
    `;
    // central build menu grid
    const grid = this.q('#bm-grid');
    for (const item of BUILD_ITEMS) {
      const btn = document.createElement('button');
      btn.className = 'build-slot';
      btn.dataset.type = item.type;
      btn.innerHTML = `<span class="ico">${item.ico}</span><span class="nm">${item.name}</span><span class="cost">${costStr(item.type)}</span>`;
      btn.onclick = () => { this.toggleBuild(item.type); this.toggleBuildMenu(false); };
      grid.appendChild(btn);
    }
    (this.q('#inv-hammer')).onclick = () => this.toggleBuildMenu();
    (this.q('#inv-axe')).onclick = () => this.onToolUpgrade('axe');
    (this.q('#inv-pick')).onclick = () => this.onToolUpgrade('pick');
    (this.q('#inv-strike')).onclick = () => this.onCombatUpgrade();
    this.mini = (this.q('#minimap') as HTMLCanvasElement).getContext('2d')!;
  }

  onToolUpgrade: (tool: 'axe' | 'pick') => void = () => {};
  onCombatUpgrade: () => void = () => {};

  /** Tiny celebratory popup pinned above an inventory slot. */
  slotPopup(slotId: string, text: string): void {
    const slot = this.q(`#${slotId}`);
    const rect = slot.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'slot-popup';
    el.textContent = text;
    el.style.left = `${rect.left + rect.width / 2}px`;
    el.style.top = `${rect.top - 8}px`;
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  setCombat(level: number, coins: number, cost: number): void {
    this.q('#strike-lv').textContent = String(level);
    const milestone = (level + 1) % 5 === 0 ? ' ★' : '';
    this.q('#strike-cost').textContent = `▲ ${cost}💰${milestone}`;
    this.q('#inv-strike').classList.toggle('poor', coins < cost);
  }

  toggleBuildMenu(open?: boolean): void {
    const el = this.q('#build-menu');
    const show = open ?? el.classList.contains('hidden');
    el.classList.toggle('hidden', !show);
  }
  get buildMenuOpen(): boolean { return !this.q('#build-menu').classList.contains('hidden'); }

  private lastTools = { axe: 1, pick: 1 };

  /** Refresh tool tiers + crafting costs on the inventory bar. */
  setTools(tools: { axe: number; pick: number }): void {
    this.lastTools = { ...tools };
    const roman = ['', 'I', 'II', 'III'];
    this.q('#axe-tier').textContent = roman[tools.axe] ?? 'III';
    this.q('#pick-tier').textContent = roman[tools.pick] ?? 'III';
    this.q('#axe-cost').textContent = TOOL_COST_LABEL.axe[Math.min(3, tools.axe)]!;
    this.q('#pick-cost').textContent = TOOL_COST_LABEL.pick[Math.min(3, tools.pick)]!;
  }

  private q(sel: string): HTMLElement { return this.root.querySelector(sel)!; }

  show(): void { this.root.classList.remove('hidden'); }
  hide(): void { this.root.classList.add('hidden'); }

  toggleBuild(type: BuildingType | null): void {
    this.activeBuild = this.activeBuild === type ? null : type;
    this.onBuildSelect(this.activeBuild);
    for (const el of this.root.querySelectorAll('#bm-grid .build-slot')) {
      el.classList.toggle('active', (el as HTMLElement).dataset.type === this.activeBuild);
    }
  }
  buildByIndex(i: number): void {
    const item = BUILD_ITEMS[i];
    if (item) this.toggleBuild(item.type);
  }
  clearBuild(): void { if (this.activeBuild) this.toggleBuild(this.activeBuild); }

  selectBuilding(b: BuildingView | null): void {
    this.selectedId = b?.id ?? null;
    const panel = this.q('#sel-panel');
    if (!b) { panel.classList.add('hidden'); return; }
    const def = BUILDINGS[b.type];
    const maxTier = def.tiers.length;
    const next = b.tier < maxTier ? def.tiers[b.tier]! : null;
    const nextCost = next
      ? Object.entries(next.cost).map(([k, v]) => `${v}${k[0]!.toUpperCase()}`).join(' ')
      : null;
    panel.classList.remove('hidden');
    panel.innerHTML = `
      <div class="nm">${b.type.replace(/_/g, ' ')}</div>
      <div class="tier">Tier ${b.tier} / ${maxTier}</div>
      <div class="hp">HP ${b.hp} / ${b.maxHp}</div>
      ${next ? `<button class="btn" id="up-btn">Upgrade · ${nextCost}</button>` : ''}
      ${b.type !== 'castle' ? '<button class="btn ghost" id="dem-btn">Demolish</button>' : ''}
    `;
    panel.querySelector('#up-btn')?.addEventListener('click', () => this.onUpgrade(b.id));
    panel.querySelector('#dem-btn')?.addEventListener('click', () => this.onDemolish(b.id));
  }
  get selected(): number | null { return this.selectedId; }

  /** Reposition the floating selection panel above the building (screen px). */
  moveSelPanel(pt: { x: number; y: number } | null): void {
    const panel = this.q('#sel-panel');
    if (!pt || panel.classList.contains('hidden')) return;
    panel.style.left = `${pt.x}px`;
    panel.style.top = `${pt.y}px`;
  }

  updateFrame(wave: number, phase: Phase, phaseTicks: number, res: Resources,
              players: PlayerView[], enemies: EnemyView[], buildings: BuildingView[],
              castleLevel: number, selfId: number): void {
    this.q('#wave-n').textContent = String(wave);
    const pill = this.q('#phase-pill');
    pill.textContent = phase === 'day' ? 'Day' : 'Night';
    pill.className = `phase-pill ${phase}`;
    this.q('#phase-timer').textContent =
      phase === 'day' && phaseTicks >= 0 ? `${Math.ceil(phaseTicks / 20)}s` : '';

    for (const key of ['wood', 'stone', 'gold', 'coins'] as const) {
      if (res[key] !== this.lastRes[key]) {
        const el = this.root.querySelector(`.res[data-r="${key}"]`)! as HTMLElement;
        el.querySelector('.v')!.textContent = String(res[key]);
        el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
      }
    }
    this.lastRes = { ...res };

    const castle = buildings.find(b => b.type === 'castle');
    if (castle) {
      (this.q('#castle-fill')).style.width = `${(castle.hp / castle.maxHp) * 100}%`;
    }

    const boss = enemies.find(e => e.type === 'butcher');
    this.q('#boss-bar').classList.toggle('hidden', !boss);
    if (boss) this.q('#boss-fill').style.width = `${(boss.hp / boss.maxHp) * 100}%`;

    // build menu state: locked by castle level, dimmed when unaffordable
    for (const el of this.root.querySelectorAll('#bm-grid .build-slot')) {
      const type = (el as HTMLElement).dataset.type as BuildingType;
      el.classList.toggle('locked', BUILDINGS[type].unlockCastleLevel > castleLevel);
      const c = BUILDINGS[type].tiers[0]!.cost;
      const afford = (c.wood ?? 0) <= res.wood && (c.stone ?? 0) <= res.stone
        && (c.gold ?? 0) <= res.gold && (c.coins ?? 0) <= res.coins;
      el.classList.toggle('poor', !afford);
    }

    // inventory affordability: tools (wood/stone) and strike (gold)
    for (const tool of ['axe', 'pick'] as const) {
      const cost = TOOL_COSTS[tool][Math.min(3, this.lastTools[tool])];
      this.q(`#inv-${tool}`).classList.toggle('poor',
        !cost || res.wood < cost.w || res.stone < cost.s);
    }
    const self = players.find(p => p.id === selfId);
    if (self) this.setCombat(self.combatLevel, res.coins, combatUpgradeCost(self.combatLevel));

    // party panel
    const panel = this.q('#party-panel');
    panel.innerHTML = players.map(p => `
      <div class="party-member ${p.alive ? '' : 'dead'}">
        <div class="nm"><span>${p.id === selfId ? 'You' : esc(p.name)}</span><span class="kl">${p.klass}</span></div>
        <div class="hp-track"><div class="hp-fill" style="width:${(p.hp / p.maxHp) * 100}%"></div></div>
      </div>`).join('');

    this.drawMinimap(players, enemies, buildings, selfId);
  }

  /** Paint the static terrain layer once per game: meadow, river, bridges, fringe. */
  initMinimapTerrain(seed: number, nodes: NodeView[]): void {
    this.miniNodes.clear();
    for (const n of nodes) this.miniNodes.set(n.id, n);
    const c = document.createElement('canvas');
    c.width = c.height = 164;
    const ctx = c.getContext('2d')!;
    const s = 164 / MAP_SIZE;
    // meadow base with subtle radial shading
    const grad = ctx.createRadialGradient(82, 82, 20, 82, 82, 120);
    grad.addColorStop(0, '#55794a');
    grad.addColorStop(0.7, '#46663c');
    grad.addColorStop(1, '#314a28');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 164, 164);
    // mottled grass speckles
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(108,138,74,0.25)' : 'rgba(48,68,38,0.25)';
      ctx.fillRect(Math.random() * 164, Math.random() * 164, 2, 2);
    }
    // river ribbon sampled from the shared channel math
    const p = riverParams(seed);
    ctx.strokeStyle = '#3e6e96';
    ctx.lineWidth = RIVER_WIDTH * s;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let x = 0; x <= MAP_SIZE; x += 2) {
      const y = riverYAt(x, p);
      if (x === 0) ctx.moveTo(x * s, y * s); else ctx.lineTo(x * s, y * s);
    }
    ctx.stroke();
    // sandy banks hint
    ctx.strokeStyle = 'rgba(138,115,80,0.5)';
    ctx.lineWidth = (RIVER_WIDTH + 1.6) * s;
    ctx.globalCompositeOperation = 'destination-over';
    ctx.beginPath();
    for (let x = 0; x <= MAP_SIZE; x += 2) {
      const y = riverYAt(x, p);
      if (x === 0) ctx.moveTo(x * s, y * s); else ctx.lineTo(x * s, y * s);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    // bridges
    ctx.fillStyle = '#8a6238';
    for (const bx of BRIDGE_XS) {
      const by = riverYAt(bx, p);
      ctx.fillRect(bx * s - 2, (by - RIVER_WIDTH / 2 - 1) * s, 4, (RIVER_WIDTH + 2) * s);
    }
    // castle clearing dirt ring
    ctx.fillStyle = 'rgba(122,102,71,0.45)';
    ctx.beginPath();
    ctx.arc((CASTLE_POS.x + 2) * s, (CASTLE_POS.y + 2) * s, 8.5, 0, Math.PI * 2);
    ctx.fill();
    this.terrain = c;
  }

  removeMinimapNode(id: number): void { this.miniNodes.delete(id); }

  private drawMinimap(players: PlayerView[], enemies: EnemyView[],
                      buildings: BuildingView[], selfId: number): void {
    const ctx = this.mini;
    const s = 164 / MAP_SIZE;
    if (this.terrain) ctx.drawImage(this.terrain, 0, 0);
    else { ctx.fillStyle = '#16202f'; ctx.fillRect(0, 0, 164, 164); }
    // forests and rocks
    for (const n of this.miniNodes.values()) {
      ctx.fillStyle = n.kind === 'tree' ? '#2e5526' : '#7d8087';
      ctx.fillRect(n.pos.x * s - 0.8, n.pos.y * s - 0.8, 1.8, 1.8);
    }
    // player structures
    for (const b of buildings) {
      if (b.type === 'castle') continue;
      const sz = BUILDINGS[b.type].size;
      ctx.fillStyle = '#c9d2da';
      ctx.fillRect(b.pos.x * s, b.pos.y * s, Math.max(2, sz * s), Math.max(2, sz * s));
    }
    const castle = buildings.find(b => b.type === 'castle');
    if (castle) {
      ctx.fillStyle = '#e8b64c';
      ctx.strokeStyle = '#8a6a20';
      ctx.fillRect(castle.pos.x * s - 1, castle.pos.y * s - 1, 4 * s + 2, 4 * s + 2);
      ctx.strokeRect(castle.pos.x * s - 1, castle.pos.y * s - 1, 4 * s + 2, 4 * s + 2);
    }
    // enemies pulse red
    ctx.fillStyle = '#e0473c';
    for (const e of enemies) {
      const r = e.type === 'butcher' ? 3 : 1.4;
      ctx.beginPath();
      ctx.arc(e.pos.x * s, e.pos.y * s, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // players: ringed dots
    for (const p of players) {
      ctx.fillStyle = p.id === selfId ? '#8fe07a' : '#6db8d8';
      ctx.beginPath();
      ctx.arc(p.pos.x * s, p.pos.y * s, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.stroke();
    }
  }

  handleEvents(events: SimEvent[], project: (x: number, y: number) => { x: number; y: number } | null): void {
    const layer = this.q('#dmg-layer');
    for (const e of events) {
      if (e.kind === 'damage' || e.kind === 'coins' || e.kind === 'gather') {
        const pt = project(e.pos.x, e.pos.y);
        if (!pt) continue;
        const el = document.createElement('div');
        if (e.kind === 'gather') {
          el.className = 'dmg-num gather';
          el.textContent = `+${e.amount} ${e.resource === 'wood' ? '🪵' : '🧱'}`;
        } else if (e.kind === 'coins') {
          el.className = 'dmg-num coins';
          el.textContent = `+${e.amount}`;
        } else {
          el.className = `dmg-num${e.crit ? ' crit' : ''}`;
          el.textContent = String(e.amount);
        }
        el.style.left = `${pt.x + (Math.random() - 0.5) * 24}px`;
        el.style.top = `${pt.y - 20}px`;
        layer.appendChild(el);
        setTimeout(() => el.remove(), 950);
      } else if (e.kind === 'wave_start') {
        this.banner(e.boss ? `⚔ BOSS — THE BUTCHER ⚔` : `Wave ${e.wave}`, e.boss);
      } else if (e.kind === 'phase_change' && e.phase === 'day') {
        this.banner('Dawn Breaks', false);
        this.notify('Night survived. Build and repair!');
      }
    }
    if (layer.childElementCount > 80) {
      while (layer.childElementCount > 60) layer.firstElementChild!.remove();
    }
  }

  setPerf(fps: number, ping: number | null): void {
    this.q('#perf-fps').textContent = String(fps);
    this.q('#perf-ping').textContent = ping === null ? '—' : String(ping);
  }

  // ---- chat ----
  onChat: (text: string) => void = () => {};

  addChat(from: string, text: string): void {
    const log = this.q('#chat-log');
    const el = document.createElement('div');
    el.className = 'chat-msg';
    el.innerHTML = `<b>${esc(from)}</b> ${esc(text)}`;
    log.appendChild(el);
    while (log.childElementCount > 7) log.firstElementChild!.remove();
    setTimeout(() => { el.classList.add('faded'); }, 9000);
  }

  get chatOpen(): boolean { return !this.q('#chat-input').classList.contains('hidden'); }

  openChat(): void {
    const input = this.q('#chat-input') as HTMLInputElement;
    input.classList.remove('hidden');
    input.focus();
  }

  /** Closes the chat input; returns the typed text (empty = cancelled). */
  closeChat(send: boolean): void {
    const input = this.q('#chat-input') as HTMLInputElement;
    const text = input.value.trim();
    input.value = '';
    input.classList.add('hidden');
    input.blur();
    if (send && text) this.onChat(text);
  }

  /** Contextual interaction prompt; with `progress` it becomes a channel bar. */
  showPrompt(label: string | null, progress: number | null = null): void {
    const el = this.q('#interact-prompt');
    if (!label) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    if (progress !== null) {
      el.innerHTML = `<span>${label}</span><div class="ip-track"><div class="ip-fill" style="width:${Math.round(progress * 100)}%"></div></div>`;
    } else if (el.textContent !== label || el.querySelector('.ip-track')) {
      el.textContent = label;
    }
  }

  // ---- wave-upgrade vote overlay ----
  onVote: (option: number) => void = () => {};
  private choiceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Defer until the dawn banner has finished so the two never overlap. */
  showChoiceDelayed(options: UpgradeDef[]): void {
    if (this.choiceTimer) clearTimeout(this.choiceTimer);
    this.choiceTimer = setTimeout(() => this.showChoice(options), 3200);
  }

  showChoice(options: UpgradeDef[]): void {
    const el = this.q('#choice-overlay');
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="choice-title">Council of War</div>
      <div class="choice-sub">The team must agree unanimously</div>
      <div class="choice-cards">
        ${options.map((o, i) => `
          <button class="choice-card" data-i="${i}">
            <div class="nm">${o.name}</div>
            <div class="ds">${o.desc}</div>
            <div class="vt" id="choice-votes-${i}"></div>
          </button>`).join('')}
      </div>`;
    for (const btn of el.querySelectorAll('.choice-card')) {
      (btn as HTMLElement).onclick = () => {
        this.onVote(Number((btn as HTMLElement).dataset.i));
        for (const b of el.querySelectorAll('.choice-card')) b.classList.toggle('picked', b === btn);
      };
    }
  }

  updateChoiceVotes(votes: (number | null)[]): void {
    const el = this.q('#choice-overlay');
    for (let i = 0; i < 3; i++) {
      const slot = el.querySelector(`#choice-votes-${i}`);
      if (!slot) continue;
      const n = votes.filter(v => v === i).length;
      slot.textContent = n > 0 ? '🗳'.repeat(n) : '';
    }
  }

  hideChoice(): void {
    if (this.choiceTimer) { clearTimeout(this.choiceTimer); this.choiceTimer = null; }
    this.q('#choice-overlay').classList.add('hidden');
  }

  banner(text: string, boss: boolean): void {
    const slot = this.q('#banner-slot');
    slot.innerHTML = `<div class="wave-banner${boss ? ' boss' : ''}">${text}</div>`;
    setTimeout(() => { slot.innerHTML = ''; }, 2900);
  }

  notify(text: string): void {
    const stack = this.q('#notif-stack');
    const el = document.createElement('div');
    el.className = 'notif';
    el.textContent = text;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 4000);
    while (stack.childElementCount > 5) stack.firstElementChild!.remove();
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
}
