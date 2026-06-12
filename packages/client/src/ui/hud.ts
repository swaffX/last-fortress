import {
  BUILDINGS, MAP_SIZE, type BuildingType, type Resources, type Phase, type SimEvent,
} from '@lf/shared';
import type { BuildingView, EnemyView, PlayerView } from '../net';

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
  return parts.join(' ');
}

export class Hud {
  private root: HTMLElement;
  private mini!: CanvasRenderingContext2D;
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
      <div class="build-bar" id="build-bar"></div>
      <div class="hud-hint">WASD move · Click attack · 1-9 build · U upgrade · K skills · Alt+Click ping</div>
      <div class="minimap"><canvas id="minimap" width="164" height="164"></canvas></div>
      <div class="sel-panel hidden" id="sel-panel"></div>
      <div class="dmg-layer" id="dmg-layer"></div>
      <div class="notif-stack" id="notif-stack"></div>
      <div id="banner-slot"></div>
    `;
    const bar = this.q('#build-bar');
    for (const item of BUILD_ITEMS) {
      const btn = document.createElement('button');
      btn.className = 'build-slot';
      btn.dataset.type = item.type;
      btn.innerHTML = `<span class="ico">${item.ico}</span><span class="nm">${item.name}</span><span class="cost">${costStr(item.type)}</span>`;
      btn.onclick = () => this.toggleBuild(item.type);
      bar.appendChild(btn);
    }
    this.mini = (this.q('#minimap') as HTMLCanvasElement).getContext('2d')!;
  }

  private q(sel: string): HTMLElement { return this.root.querySelector(sel)!; }

  show(): void { this.root.classList.remove('hidden'); }
  hide(): void { this.root.classList.add('hidden'); }

  toggleBuild(type: BuildingType | null): void {
    this.activeBuild = this.activeBuild === type ? null : type;
    this.onBuildSelect(this.activeBuild);
    for (const el of this.root.querySelectorAll('.build-slot')) {
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

    // build slot state: locked by castle level, dimmed when unaffordable
    for (const el of this.root.querySelectorAll('.build-slot')) {
      const type = (el as HTMLElement).dataset.type as BuildingType;
      el.classList.toggle('locked', BUILDINGS[type].unlockCastleLevel > castleLevel);
      const c = BUILDINGS[type].tiers[0]!.cost;
      const afford = (c.wood ?? 0) <= res.wood && (c.stone ?? 0) <= res.stone && (c.gold ?? 0) <= res.gold;
      el.classList.toggle('poor', !afford);
    }

    // party panel
    const panel = this.q('#party-panel');
    panel.innerHTML = players.map(p => `
      <div class="party-member ${p.alive ? '' : 'dead'}">
        <div class="nm"><span>${p.id === selfId ? 'You' : esc(p.name)}</span><span class="kl">${p.klass}</span></div>
        <div class="hp-track"><div class="hp-fill" style="width:${(p.hp / p.maxHp) * 100}%"></div></div>
      </div>`).join('');

    this.drawMinimap(players, enemies, buildings, selfId);
  }

  private drawMinimap(players: PlayerView[], enemies: EnemyView[],
                      buildings: BuildingView[], selfId: number): void {
    const ctx = this.mini;
    const s = 164 / MAP_SIZE;
    ctx.fillStyle = '#16202f';
    ctx.fillRect(0, 0, 164, 164);
    ctx.fillStyle = '#8fa3bd';
    for (const b of buildings) {
      if (b.type === 'castle') continue;
      ctx.fillRect(b.pos.x * s, b.pos.y * s, Math.max(2, 2 * s), Math.max(2, 2 * s));
    }
    const castle = buildings.find(b => b.type === 'castle');
    if (castle) {
      ctx.fillStyle = '#e8b64c';
      ctx.fillRect(castle.pos.x * s - 1, castle.pos.y * s - 1, 4 * s + 2, 4 * s + 2);
    }
    ctx.fillStyle = '#c43a31';
    for (const e of enemies) ctx.fillRect(e.pos.x * s - 1, e.pos.y * s - 1, 2.4, 2.4);
    for (const p of players) {
      ctx.fillStyle = p.id === selfId ? '#6fbf63' : '#6db8d8';
      ctx.beginPath();
      ctx.arc(p.pos.x * s, p.pos.y * s, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  handleEvents(events: SimEvent[], project: (x: number, y: number) => { x: number; y: number } | null): void {
    const layer = this.q('#dmg-layer');
    for (const e of events) {
      if (e.kind === 'damage' || e.kind === 'coins') {
        const pt = project(e.pos.x, e.pos.y);
        if (!pt) continue;
        const el = document.createElement('div');
        if (e.kind === 'coins') {
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
