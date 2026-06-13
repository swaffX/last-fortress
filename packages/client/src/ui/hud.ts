import {
  BUILDINGS, MAP_SIZE, riverParams, riverYAt, RIVER_WIDTH, BRIDGE_XS, CAMP_POS,
  ITEMS, countItem,
  type BuildingType, type Phase, type SimEvent, type ItemId,
} from '@lf/shared';
import type { BuildingView, PlayerView, NodeView } from '../net';

const BUILD_ITEMS: { type: BuildingType; ico: string; name: string }[] = [
  { type: 'wood_wall', ico: '🪵', name: 'Wall' },
  { type: 'stone_wall', ico: '🧱', name: 'S.Wall' },
  { type: 'gate', ico: '🚪', name: 'Gate' },
  { type: 'spike', ico: '🗡', name: 'Spikes' },
];

const ITEM_ICON: Record<ItemId, string> = { wood: '🪵', stone: '🧱', berry: '🫐' };

function costStr(type: BuildingType): string {
  const c = BUILDINGS[type].cost;
  return (Object.entries(c) as [ItemId, number][])
    .map(([k, v]) => `${v}${ITEM_ICON[k]}`).join(' ');
}

export class Hud {
  private root: HTMLElement;
  private mini!: CanvasRenderingContext2D;
  private terrain: HTMLCanvasElement | null = null;
  private miniNodes = new Map<number, NodeView>();
  onBuildSelect: (type: BuildingType | null) => void = () => {};
  onDemolish: (id: number) => void = () => {};
  private activeBuild: BuildingType | null = null;
  private selectedId: number | null = null;

  constructor() {
    this.root = document.getElementById('hud')!;
    this.root.innerHTML = `
      <div class="hud-top">
        <span class="phase-pill day" id="phase-pill">Day</span>
        <span id="phase-timer" style="font-variant-numeric:tabular-nums;color:var(--steel)"></span>
        <span class="region-name" id="region-name"></span>
      </div>
      <div class="vitals" id="vitals">
        <div class="vital hp"><span class="ico">❤</span><div class="track"><div class="fill" id="hp-fill"></div></div><span class="v" id="hp-v"></span></div>
        <div class="vital hunger"><span class="ico">🍖</span><div class="track"><div class="fill" id="hunger-fill"></div></div><span class="v" id="hunger-v"></span></div>
      </div>
      <div class="party-panel" id="party-panel"></div>
      <div id="hotbar-slot"></div>
      <div id="backpack-slot"></div>
      <div class="build-menu hidden" id="build-menu">
        <div class="bm-title">Construction</div>
        <div class="bm-grid" id="bm-grid"></div>
      </div>
      <div class="hud-hint">WASD move · [E] gather/eat · 1–9 hotbar · I bag · B build · Enter chat</div>
      <div class="minimap"><canvas id="minimap" width="164" height="164"></canvas></div>
      <div class="sel-panel hidden" id="sel-panel"></div>
      <div class="interact-prompt hidden" id="interact-prompt"></div>
      <div class="region-toast hidden" id="region-toast"></div>
      <div class="perf-panel" id="perf-panel"><span id="perf-fps">0</span> FPS · <span id="perf-ping">—</span> ms</div>
      <div class="chat-box" id="chat-box">
        <div class="chat-log" id="chat-log"></div>
        <input class="chat-input hidden" id="chat-input" maxlength="120" placeholder="Press Enter to chat…">
      </div>
      <div class="dmg-layer" id="dmg-layer"></div>
      <div class="notif-stack" id="notif-stack"></div>
      <div id="banner-slot"></div>
    `;
    const grid = this.q('#bm-grid');
    for (const item of BUILD_ITEMS) {
      const btn = document.createElement('button');
      btn.className = 'build-slot';
      btn.dataset.type = item.type;
      btn.innerHTML = `<span class="ico">${item.ico}</span><span class="nm">${item.name}</span><span class="cost">${costStr(item.type)}</span>`;
      btn.onclick = () => { this.toggleBuild(item.type); this.toggleBuildMenu(false); };
      grid.appendChild(btn);
    }
    this.mini = (this.q('#minimap') as HTMLCanvasElement).getContext('2d')!;
  }

  private q(sel: string): HTMLElement { return this.root.querySelector(sel)!; }
  show(): void { this.root.classList.remove('hidden'); }
  hide(): void { this.root.classList.add('hidden'); }

  toggleBuildMenu(open?: boolean): void {
    const el = this.q('#build-menu');
    const show = open ?? el.classList.contains('hidden');
    el.classList.toggle('hidden', !show);
  }
  get buildMenuOpen(): boolean { return !this.q('#build-menu').classList.contains('hidden'); }

  toggleBuild(type: BuildingType | null): void {
    this.activeBuild = this.activeBuild === type ? null : type;
    this.onBuildSelect(this.activeBuild);
    for (const el of this.root.querySelectorAll('#bm-grid .build-slot')) {
      el.classList.toggle('active', (el as HTMLElement).dataset.type === this.activeBuild);
    }
  }
  clearBuild(): void { if (this.activeBuild) this.toggleBuild(this.activeBuild); }

  selectBuilding(b: BuildingView | null): void {
    this.selectedId = b?.id ?? null;
    const panel = this.q('#sel-panel');
    if (!b) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    panel.innerHTML = `
      <div class="nm">${b.type.replace(/_/g, ' ')}</div>
      <div class="hp">HP ${Math.round(b.hp)} / ${b.maxHp}</div>
      <button class="btn ghost" id="dem-btn">Demolish</button>
    `;
    panel.querySelector('#dem-btn')?.addEventListener('click', () => this.onDemolish(b.id));
  }
  get selected(): number | null { return this.selectedId; }

  moveSelPanel(pt: { x: number; y: number } | null): void {
    const panel = this.q('#sel-panel');
    if (!pt || panel.classList.contains('hidden')) return;
    panel.style.left = `${pt.x}px`;
    panel.style.top = `${pt.y}px`;
  }

  /** Per-frame HUD refresh driven by the local player's view. */
  updateFrame(self: PlayerView | undefined, players: PlayerView[], buildings: BuildingView[],
              phase: Phase, phaseTicks: number, selfId: number): void {
    const pill = this.q('#phase-pill');
    pill.textContent = phase === 'day' ? 'Day' : 'Night';
    pill.className = `phase-pill ${phase}`;
    this.q('#phase-timer').textContent = `${Math.ceil(phaseTicks / 20)}s`;

    if (self) {
      this.q('#region-name').textContent = self.region;
      const hpPct = (self.hp / self.maxHp) * 100;
      (this.q('#hp-fill')).style.width = `${Math.max(0, hpPct)}%`;
      this.q('#hp-v').textContent = String(Math.max(0, Math.round(self.hp)));
      const hungerPct = self.hunger;
      (this.q('#hunger-fill')).style.width = `${Math.max(0, hungerPct)}%`;
      this.q('#hunger-v').textContent = String(Math.round(self.hunger));
      this.q('#hunger-fill').classList.toggle('low', self.hunger < 25);

      // build menu affordability from the local inventory
      for (const el of this.root.querySelectorAll('#bm-grid .build-slot')) {
        const type = (el as HTMLElement).dataset.type as BuildingType;
        const cost = BUILDINGS[type].cost;
        const afford = (Object.entries(cost) as [ItemId, number][])
          .every(([k, v]) => countItem(self.inventory, k) >= v);
        el.classList.toggle('poor', !afford);
      }
    }

    const panel = this.q('#party-panel');
    panel.innerHTML = players.map(p => `
      <div class="party-member ${p.alive ? '' : 'dead'}">
        <div class="nm">${p.id === selfId ? 'You' : esc(p.name)}</div>
        <div class="hp-track"><div class="hp-fill" style="width:${(p.hp / p.maxHp) * 100}%"></div></div>
      </div>`).join('');

    this.drawMinimap(players, buildings, selfId);
  }

  // ---- minimap ----
  initMinimapTerrain(seed: number, nodes: NodeView[]): void {
    this.miniNodes.clear();
    for (const n of nodes) this.miniNodes.set(n.id, n);
    const c = document.createElement('canvas');
    c.width = c.height = 164;
    const ctx = c.getContext('2d')!;
    const s = 164 / MAP_SIZE;
    const grad = ctx.createRadialGradient(82, 82, 20, 82, 82, 120);
    grad.addColorStop(0, '#55794a');
    grad.addColorStop(0.7, '#46663c');
    grad.addColorStop(1, '#314a28');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 164, 164);
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(108,138,74,0.25)' : 'rgba(48,68,38,0.25)';
      ctx.fillRect(Math.random() * 164, Math.random() * 164, 2, 2);
    }
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
    ctx.fillStyle = '#8a6238';
    for (const bx of BRIDGE_XS) {
      const by = riverYAt(bx, p);
      ctx.fillRect(bx * s - 2, (by - RIVER_WIDTH / 2 - 1) * s, 4, (RIVER_WIDTH + 2) * s);
    }
    ctx.fillStyle = 'rgba(122,102,71,0.45)';
    ctx.beginPath();
    ctx.arc(CAMP_POS.x * s, CAMP_POS.y * s, 9, 0, Math.PI * 2);
    ctx.fill();
    this.terrain = c;
  }

  removeMinimapNode(id: number): void { this.miniNodes.delete(id); }

  private drawMinimap(players: PlayerView[], buildings: BuildingView[], selfId: number): void {
    const ctx = this.mini;
    const s = 164 / MAP_SIZE;
    if (this.terrain) ctx.drawImage(this.terrain, 0, 0);
    else { ctx.fillStyle = '#16202f'; ctx.fillRect(0, 0, 164, 164); }
    for (const n of this.miniNodes.values()) {
      ctx.fillStyle = n.kind === 'tree' ? '#2e5526' : n.kind === 'bush' ? '#6a9a3a' : '#7d8087';
      ctx.fillRect(n.pos.x * s - 0.6, n.pos.y * s - 0.6, 1.4, 1.4);
    }
    for (const b of buildings) {
      const sz = BUILDINGS[b.type].size;
      ctx.fillStyle = '#c9d2da';
      ctx.fillRect(b.pos.x * s, b.pos.y * s, Math.max(2, sz * s), Math.max(2, sz * s));
    }
    // camp marker
    ctx.fillStyle = '#e8b64c';
    ctx.beginPath();
    ctx.arc(CAMP_POS.x * s, CAMP_POS.y * s, 3, 0, Math.PI * 2);
    ctx.fill();
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
      let txt: string | null = null;
      let cls = 'dmg-num';
      let pos: { x: number; y: number } | null = null;
      if (e.kind === 'damage') { txt = String(Math.round(e.amount)); cls = `dmg-num${e.crit ? ' crit' : ''}`; pos = e.pos; }
      else if (e.kind === 'gather') { txt = `+${e.amount} ${ITEM_ICON[e.resource]}`; cls = 'dmg-num gather'; pos = e.pos; }
      else if (e.kind === 'pickup') { txt = `+${e.count} ${ITEM_ICON[e.item]}`; cls = 'dmg-num gather'; pos = e.pos; }
      if (!txt || !pos) continue;
      const pt = project(pos.x, pos.y);
      if (!pt) continue;
      const el = document.createElement('div');
      el.className = cls;
      el.textContent = txt;
      el.style.left = `${pt.x + (Math.random() - 0.5) * 24}px`;
      el.style.top = `${pt.y - 20}px`;
      layer.appendChild(el);
      setTimeout(() => el.remove(), 950);
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
  closeChat(send: boolean): void {
    const input = this.q('#chat-input') as HTMLInputElement;
    const text = input.value.trim();
    input.value = '';
    input.classList.add('hidden');
    input.blur();
    if (send && text) this.onChat(text);
  }

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

  /** Region name toast on crossing into a new biome. */
  regionToast(name: string): void {
    const el = this.q('#region-toast');
    el.textContent = name;
    el.classList.remove('hidden');
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    setTimeout(() => el.classList.add('hidden'), 2600);
  }

  banner(text: string): void {
    const slot = this.q('#banner-slot');
    slot.innerHTML = `<div class="wave-banner">${text}</div>`;
    setTimeout(() => { slot.innerHTML = ''; }, 2600);
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
