import * as THREE from 'three';
import {
  RECIPES, ITEMS, BUILDINGS, countItem,
  type Recipe, type ItemId, type BuildingType, type Slot,
} from '@lf/shared';
import type { PlayerView } from '../net';
import { playerModel } from '../render/models';

const ICON: Record<string, string> = {
  wood: '🪵', stone: '🧱', berry: '🫐', stick: '🪵', crafting_table: '🛠',
  wood_axe: '🪓', stone_axe: '🪓', wood_pick: '⛏', stone_pick: '⛏',
  wood_sword: '🗡', stone_sword: '⚔️', wood_spear: '🔱',
  raw_meat: '🍖', leather: '🟫', wool: '☁️', silk: '🕸', pelt: '🟤',
  feather: '🪶', hide: '🟫', bone: '🦴', venom: '🧪',
  katana: '🗡', war_spear: '🔱', mage_staff: '🪄',
};
const BUILD: { type: BuildingType; ico: string; name: string }[] = [
  { type: 'wood_wall', ico: '🪵', name: 'Wood Wall' },
  { type: 'stone_wall', ico: '🧱', name: 'Stone Wall' },
  { type: 'gate', ico: '🚪', name: 'Gate' },
  { type: 'spike', ico: '🗡', name: 'Spikes' },
  { type: 'crafting_table', ico: '🛠', name: 'Workbench' },
];

type Cat = 'all' | 'tool' | 'weapon' | 'build' | 'food';

export interface CharacterUI {
  setContext(self: PlayerView | undefined, phase: 'day' | 'night', phaseTicks: number, nearTable: boolean): void;
  toggle(open?: boolean): void;
  isOpen(): boolean;
  onCraft: (recipeId: string) => void;
  onPlace: (type: BuildingType) => void;
  onRepair: () => void;
  onMoveItem: (from: number, to: number) => void;
  onDropItem: (slot: number, count: number) => void;
  onSelectHand: (slot: number) => void;
}

/** Spinning 3D portrait (own mini Three scene, runs only while open). */
class Portrait {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 0.8, 0.1, 100);
  private model: THREE.Group | null = null;
  private raf = 0; private last = 0; private spin = 0;
  constructor(private host: HTMLElement) {}
  private init(): void {
    if (this.renderer) return;
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x20160c, 0.9));
    const key = new THREE.DirectionalLight(0xfff0d8, 1.5); key.position.set(2.5, 4, 3); this.scene.add(key);
    const rim = new THREE.PointLight(0xd9a93f, 14, 12); rim.position.set(-2, 2.2, -1.5); this.scene.add(rim);
    const fill = new THREE.PointLight(0x6db8d8, 6, 10); fill.position.set(2, 1, -2); this.scene.add(fill);
    this.model = playerModel(); this.scene.add(this.model);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.6, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.01; this.scene.add(disc);
    this.camera.position.set(0, 1.25, 4.0); this.camera.lookAt(0, 1.0, 0);
  }
  private resize(): void {
    if (!this.renderer) return;
    const w = Math.max(120, this.host.clientWidth), h = Math.max(150, this.host.clientHeight);
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  start(): void {
    this.init(); this.resize(); this.last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now; this.spin += dt * 0.55;
      if (this.model) {
        this.model.rotation.y = Math.sin(this.spin) * 0.6;
        const body = this.model.userData.body as THREE.Mesh | undefined;
        if (body) body.position.y = 0.75 + Math.sin(now * 0.0022) * 0.02;
      }
      this.renderer!.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(loop);
  }
  stop(): void { cancelAnimationFrame(this.raf); this.raf = 0; }
}

function slotInner(s: Slot): string {
  if (!s) return '';
  const ico = ICON[s.item] ?? '▪';
  const max = ITEMS[s.item].durabilityMax;
  const bar = (max && s.dur !== undefined)
    ? `<span class="dur"><span class="dur-fill" style="width:${Math.max(0, (s.dur / max) * 100)}%"></span></span>` : '';
  return `<span class="it-ico">${ico}</span><span class="it-n">${s.count > 1 ? s.count : ''}</span>${bar}`;
}

export function createCharacterUI(root: HTMLElement): CharacterUI {
  let self: PlayerView | undefined;
  let open = false;
  let phase: 'day' | 'night' = 'day';
  let phaseTicks = 0;
  let nearTable = false;
  let cat: Cat = 'all';
  let dragFrom: number | null = null;

  root.className = 'char-overlay hidden';
  root.innerHTML = `
    <div class="char-modal wide">
      <button class="cf-close" id="ch-close">✕</button>
      <div class="ch-col ch-left">
        <div class="ch-coltitle">Survivor</div>
        <div class="ch-portrait" id="ch-portrait"><div class="ch-pglow"></div></div>
        <div class="ch-name" id="ch-name">—</div>
        <div class="ch-namesub" id="ch-namesub"></div>
        <div class="ch-equip">
          <div class="ch-eq" data-s="head"><span class="ch-eqi">⛑</span><b>Head</b><i id="eq-head">empty</i></div>
          <div class="ch-eq" data-s="body"><span class="ch-eqi">🥋</span><b>Body</b><i id="eq-body">empty</i></div>
          <div class="ch-eq" data-s="legs"><span class="ch-eqi">👖</span><b>Legs</b><i id="eq-legs">empty</i></div>
          <div class="ch-eq hand" data-s="hand"><span class="ch-eqi">✋</span><b>In Hand</b><i id="eq-hand">empty</i></div>
        </div>
        <button class="ch-repair hidden" id="ch-repair"></button>
      </div>
      <div class="ch-col ch-mid">
        <div class="ch-secthead"><span class="ch-coltitle">Inventory</span><span class="ch-secthint">drag · right-click drops</span></div>
        <div class="ch-invgrid" id="ch-inv"></div>
        <div class="ch-secthead"><span class="ch-coltitle">Crafting</span><span class="ch-secthint" id="ch-tablehint"></span></div>
        <div class="ch-cats" id="ch-cats">
          ${(['all', 'tool', 'weapon', 'build', 'food'] as Cat[]).map(c =>
            `<button class="ch-chip${c === 'all' ? ' on' : ''}" data-c="${c}">${c === 'all' ? 'All' : c[0]!.toUpperCase() + c.slice(1)}</button>`).join('')}
        </div>
        <div class="ch-list" id="ch-craft"></div>
      </div>
      <div class="ch-col ch-right">
        <div class="ch-coltitle">Status</div>
        <div class="ch-vitals" id="ch-vitals"></div>
        <div class="ch-info" id="ch-info"></div>
        <div class="ch-hint">Tools/weapons need a <b>Workbench</b> nearby. Hand-craft basics anywhere.</div>
      </div>
    </div>`;

  const portrait = new Portrait(root.querySelector('#ch-portrait') as HTMLElement);
  const invEl = root.querySelector('#ch-inv') as HTMLElement;
  const craftEl = root.querySelector('#ch-craft') as HTMLElement;
  const vitalsEl = root.querySelector('#ch-vitals') as HTMLElement;
  const infoEl = root.querySelector('#ch-info') as HTMLElement;
  const repairBtn = root.querySelector('#ch-repair') as HTMLButtonElement;
  const tableHint = root.querySelector('#ch-tablehint') as HTMLElement;

  (root.querySelector('#ch-close') as HTMLElement).onclick = () => api.toggle(false);
  root.addEventListener('pointerdown', e => { if (e.target === root) api.toggle(false); });
  repairBtn.onclick = () => api.onRepair();
  for (const chip of root.querySelectorAll<HTMLElement>('.ch-chip')) {
    chip.onclick = () => {
      cat = chip.dataset.c as Cat;
      for (const c of root.querySelectorAll('.ch-chip')) c.classList.toggle('on', c === chip);
      buildCraft();
    };
  }

  // build the 36 inventory cells once, wire drag/drop/click
  invEl.innerHTML = Array.from({ length: 36 }, (_, i) =>
    `<div class="ch-slot${i < 9 ? ' hot' : ''}" data-i="${i}">${i < 9 ? `<span class="key">${i + 1}</span>` : ''}</div>`).join('');
  for (const el of invEl.querySelectorAll<HTMLElement>('.ch-slot')) {
    const idx = Number(el.dataset.i);
    el.draggable = true;
    el.addEventListener('dragstart', () => { dragFrom = idx; });
    el.addEventListener('dragover', e => e.preventDefault());
    el.addEventListener('drop', e => { e.preventDefault(); if (dragFrom !== null && dragFrom !== idx) api.onMoveItem(dragFrom, idx); dragFrom = null; });
    el.addEventListener('click', () => { if (idx < 9) api.onSelectHand(idx); });
    el.addEventListener('contextmenu', e => { e.preventDefault(); api.onDropItem(idx, 1); });
  }

  function have(item: ItemId): number { return self ? countItem(self.inventory, item) : 0; }
  function canCraft(r: Recipe): boolean {
    if (r.requiresTable && !nearTable) return false;
    return r.inputs.every(i => have(i.item) >= i.count);
  }
  function canBuild(type: BuildingType): boolean {
    return (Object.entries(BUILDINGS[type].cost) as [ItemId, number][]).every(([k, v]) => have(k) >= v);
  }
  const pills = (entries: { item: ItemId; count: number }[]) => entries.map(i =>
    `<span class="ch-pill ${have(i.item) >= i.count ? '' : 'short'}">${ICON[i.item] ?? '▪'} ${i.count}</span>`).join('');

  function recipeCat(r: Recipe): Cat {
    const c = ITEMS[r.output.item].category;
    return c === 'tool' ? 'tool' : c === 'weapon' ? 'weapon' : c === 'food' ? 'food' : c === 'placeable' ? 'build' : 'all';
  }

  function renderInv(): void {
    for (const el of invEl.querySelectorAll<HTMLElement>('.ch-slot')) {
      const i = Number(el.dataset.i);
      el.classList.toggle('active', !!self && i === self.hand);
      el.querySelector('.it-ico')?.remove(); el.querySelector('.it-n')?.remove(); el.querySelector('.dur')?.remove();
      const s = self?.inventory[i] ?? null;
      if (s) el.insertAdjacentHTML('beforeend', slotInner(s));
    }
  }

  /** Build the card buttons once per category change (NOT every frame — clicks need stable nodes). */
  function buildCraft(): void {
    const recipes = RECIPES.filter(r => cat === 'all' || recipeCat(r) === cat);
    const builds = (cat === 'all' || cat === 'build') ? BUILD : [];
    const rows: string[] = [];
    for (const r of recipes) {
      rows.push(`<button class="ch-card" data-craft="${r.id}">
        <span class="ch-tile">${ICON[r.output.item] ?? '▪'}</span>
        <span class="ch-cnm">${ITEMS[r.output.item].name}${r.output.count > 1 ? `<em> ×${r.output.count}</em>` : ''}${r.requiresTable ? ' <small>🛠</small>' : ''}</span>
        <span class="ch-pills"></span></button>`);
    }
    for (const b of builds) {
      rows.push(`<button class="ch-card build" data-build="${b.type}">
        <span class="ch-tile">${b.ico}</span><span class="ch-cnm">${b.name} <small>place</small></span>
        <span class="ch-pills"></span></button>`);
    }
    craftEl.innerHTML = rows.join('') || '<div class="ch-empty">No recipes here.</div>';
    for (const el of craftEl.querySelectorAll<HTMLElement>('[data-craft]')) el.onclick = () => api.onCraft(el.dataset.craft!);
    for (const el of craftEl.querySelectorAll<HTMLElement>('[data-build]')) el.onclick = () => { api.onPlace(el.dataset.build as BuildingType); api.toggle(false); };
    refreshCraft();
  }

  /** Per-frame: only update affordability classes + cost pills (keeps buttons + listeners alive). */
  function refreshCraft(): void {
    tableHint.textContent = nearTable ? '🛠 workbench in reach' : 'basics by hand';
    for (const el of craftEl.querySelectorAll<HTMLElement>('[data-craft]')) {
      const r = RECIPES.find(x => x.id === el.dataset.craft); if (!r) continue;
      el.classList.toggle('locked', !canCraft(r));
      const p = el.querySelector('.ch-pills'); if (p) p.innerHTML = pills(r.inputs);
    }
    for (const el of craftEl.querySelectorAll<HTMLElement>('[data-build]')) {
      const type = el.dataset.build as BuildingType;
      el.classList.toggle('locked', !canBuild(type));
      const cost = (Object.entries(BUILDINGS[type].cost) as [ItemId, number][]).map(([k, v]) => ({ item: k, count: v }));
      const p = el.querySelector('.ch-pills'); if (p) p.innerHTML = pills(cost);
    }
  }

  function setEq(slot: string, name: string | null): void {
    const el = root.querySelector(`#eq-${slot}`) as HTMLElement;
    el.textContent = name ?? 'empty'; el.classList.toggle('empty', !name);
  }
  function bar(label: string, ico: string, val: number, max: number, cls: string): string {
    const pct = Math.max(0, Math.min(100, (val / max) * 100));
    return `<div class="ch-vit"><div class="ch-vlbl"><span>${ico}</span>${label}<b>${Math.round(val)}</b></div>
      <div class="ch-vtrack ${cls}"><div class="ch-vfill" style="width:${pct}%"></div></div></div>`;
  }
  function renderRight(): void {
    if (!self) { vitalsEl.innerHTML = ''; infoEl.innerHTML = ''; return; }
    vitalsEl.innerHTML =
      bar('Health', '❤', self.hp, self.maxHp, 'v-hp') +
      bar('Hunger', '🍖', self.hunger, 100, 'v-hunger') +
      bar('Warmth', '🌡', self.temperature, 100, 'v-warm');
    const time = phase === 'day' ? `Day · ${Math.ceil(phaseTicks / 20)}s` : 'Night';
    infoEl.innerHTML =
      `<div class="ch-irow"><span>🧭</span>Region<b>${self.region}</b></div>` +
      `<div class="ch-irow"><span>🕗</span>Time<b>${time}</b></div>`;
  }

  function render(): void {
    renderInv(); refreshCraft(); renderRight();
    const held = self?.inventory[self.hand];
    setEq('hand', held ? ITEMS[held.item].name : null);
    for (const s of ['head', 'body', 'legs'] as const) {
      const eq = self?.equipment[s]; setEq(s, eq ? ITEMS[eq.item].name : null);
    }
    (root.querySelector('#ch-name') as HTMLElement).textContent = self?.name ?? '—';
    (root.querySelector('#ch-namesub') as HTMLElement).textContent = self ? `${phase === 'day' ? 'Day' : 'Night'} · ${self.region}` : '';
    const max = held ? ITEMS[held.item].durabilityMax : undefined;
    const repairable = !!held && max !== undefined && held.dur !== undefined && held.dur < max;
    repairBtn.classList.toggle('hidden', !repairable);
    if (repairable && held) {
      const def = ITEMS[held.item];
      const matOk = def.repairItem && have(def.repairItem) >= (def.repairCost ?? 1);
      repairBtn.textContent = `🔧 Repair ${def.name}`; repairBtn.disabled = !matOk;
      repairBtn.classList.toggle('block', !matOk);
    }
  }

  const api: CharacterUI = {
    setContext(s, ph, pt, nt) { self = s; phase = ph; phaseTicks = pt; nearTable = nt; if (open) render(); },
    toggle(o?: boolean) {
      const next = o ?? !open; if (next === open) return; open = next;
      root.classList.toggle('hidden', !open);
      if (open) { buildCraft(); render(); requestAnimationFrame(() => portrait.start()); } else portrait.stop();
    },
    isOpen() { return open; },
    onCraft: () => {}, onPlace: () => {}, onRepair: () => {},
    onMoveItem: () => {}, onDropItem: () => {}, onSelectHand: () => {},
  };
  return api;
}
