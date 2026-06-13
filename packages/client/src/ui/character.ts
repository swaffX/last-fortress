import * as THREE from 'three';
import { RECIPES, ITEMS, BUILDINGS, countItem, type Recipe, type ItemId, type BuildingType } from '@lf/shared';
import type { PlayerView } from '../net';
import { playerModel } from '../render/models';

const ICON: Record<string, string> = {
  wood: '🪵', stone: '🧱', berry: '🫐', stick: '🪵', crafting_table: '🛠',
  wood_axe: '🪓', stone_axe: '🪓', wood_pick: '⛏', stone_pick: '⛏',
  wood_sword: '🗡', stone_sword: '⚔️', wood_spear: '🔱',
};
const BUILD: { type: BuildingType; name: string; ico: string }[] = [
  { type: 'wood_wall', name: 'Wood Wall', ico: '🪵' },
  { type: 'stone_wall', name: 'Stone Wall', ico: '🧱' },
  { type: 'gate', name: 'Gate', ico: '🚪' },
  { type: 'spike', name: 'Spikes', ico: '🗡' },
  { type: 'crafting_table', name: 'Workbench', ico: '🛠' },
];

export interface CharacterUI {
  setContext(self: PlayerView | undefined, phase: 'day' | 'night', phaseTicks: number, nearTable: boolean): void;
  toggle(open?: boolean): void;
  isOpen(): boolean;
  onCraft: (recipeId: string) => void;
  onPlace: (type: BuildingType) => void;
  onRepair: () => void;
}

const BASICS: Recipe[] = RECIPES.filter(r => !r.requiresTable);

/** Self-contained spinning 3D portrait of the survivor model. */
class Portrait {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 0.8, 0.1, 100);
  private model: THREE.Group | null = null;
  private raf = 0;
  private last = 0;
  private spin = 0;

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
    const key = new THREE.DirectionalLight(0xfff0d8, 1.5);
    key.position.set(2.5, 4, 3);
    this.scene.add(key);
    const rim = new THREE.PointLight(0xd9a93f, 14, 12);
    rim.position.set(-2, 2.2, -1.5);
    this.scene.add(rim);
    const fill = new THREE.PointLight(0x6db8d8, 6, 10);
    fill.position.set(2, 1, -2);
    this.scene.add(fill);

    this.model = playerModel();
    this.scene.add(this.model);
    // soft contact shadow disc under the feet
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.6, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.01;
    this.scene.add(disc);

    this.camera.position.set(0, 1.25, 4.0);
    this.camera.lookAt(0, 1.0, 0);
  }

  private resize(): void {
    if (!this.renderer) return;
    const w = Math.max(120, this.host.clientWidth);
    const h = Math.max(150, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start(): void {
    this.init();
    this.resize();
    this.last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.spin += dt * 0.55;
      if (this.model) {
        this.model.rotation.y = Math.sin(this.spin) * 0.6;      // sway turn, not full spin
        const body = this.model.userData.body as THREE.Mesh | undefined;
        if (body) body.position.y = 0.75 + Math.sin(now * 0.0022) * 0.02;   // idle breath
        const arms = this.model.userData.arms as THREE.Mesh[] | undefined;
        if (arms) { arms[0]!.rotation.x = Math.sin(now * 0.0018) * 0.05; arms[1]!.rotation.x = -Math.sin(now * 0.0018) * 0.05; }
        const flags = this.model.userData.flags as THREE.Mesh[] | undefined;
        if (flags) for (const f of flags) f.rotation.x = 0.15 + Math.sin(now * 0.003) * 0.08;
      }
      this.renderer!.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(loop);
  }
  stop(): void { cancelAnimationFrame(this.raf); this.raf = 0; }
}

export function createCharacterUI(root: HTMLElement): CharacterUI {
  let self: PlayerView | undefined;
  let open = false;
  let phase: 'day' | 'night' = 'day';
  let phaseTicks = 0;

  root.className = 'char-overlay hidden';
  root.innerHTML = `
    <div class="char-modal">
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
        <div class="ch-secthead"><span class="ch-coltitle">Make</span><span class="ch-secthint">hand · anywhere</span></div>
        <div class="ch-list" id="ch-craft"></div>
        <div class="ch-secthead"><span class="ch-coltitle">Build</span><span class="ch-secthint">select · then place</span></div>
        <div class="ch-list ch-build" id="ch-build"></div>
      </div>
      <div class="ch-col ch-right">
        <div class="ch-coltitle">Status</div>
        <div class="ch-vitals" id="ch-vitals"></div>
        <div class="ch-info" id="ch-info"></div>
        <div class="ch-hint">More gear needs a Workbench — craft one, place it, then press <b>C</b> beside it.</div>
      </div>
    </div>`;

  const portrait = new Portrait(root.querySelector('#ch-portrait') as HTMLElement);
  const craftEl = root.querySelector('#ch-craft') as HTMLElement;
  const buildEl = root.querySelector('#ch-build') as HTMLElement;
  const vitalsEl = root.querySelector('#ch-vitals') as HTMLElement;
  const infoEl = root.querySelector('#ch-info') as HTMLElement;
  const repairBtn = root.querySelector('#ch-repair') as HTMLButtonElement;

  (root.querySelector('#ch-close') as HTMLElement).onclick = () => api.toggle(false);
  root.addEventListener('pointerdown', e => { if (e.target === root) api.toggle(false); });
  repairBtn.onclick = () => api.onRepair();

  function have(item: ItemId): number { return self ? countItem(self.inventory, item) : 0; }
  function canCraft(r: Recipe): boolean { return r.inputs.every(i => have(i.item) >= i.count); }
  function canBuild(type: BuildingType): boolean {
    return (Object.entries(BUILDINGS[type].cost) as [ItemId, number][]).every(([k, v]) => have(k) >= v);
  }
  const pills = (entries: { item: ItemId; count: number }[]) =>
    entries.map(i => {
      const enough = have(i.item) >= i.count;
      return `<span class="ch-pill ${enough ? '' : 'short'}">${ICON[i.item] ?? '▪'} ${i.count}</span>`;
    }).join('');

  function render(): void {
    craftEl.innerHTML = BASICS.map(r => {
      const ok = canCraft(r);
      return `<button class="ch-card${ok ? '' : ' locked'}" data-craft="${r.id}">
        <span class="ch-tile">${ICON[r.output.item] ?? '▪'}</span>
        <span class="ch-cnm">${ITEMS[r.output.item].name}${r.output.count > 1 ? `<em> ×${r.output.count}</em>` : ''}</span>
        <span class="ch-pills">${pills(r.inputs)}</span></button>`;
    }).join('');
    buildEl.innerHTML = BUILD.map(b => {
      const cost = (Object.entries(BUILDINGS[b.type].cost) as [ItemId, number][]).map(([k, v]) => ({ item: k, count: v }));
      const ok = canBuild(b.type);
      return `<button class="ch-card build${ok ? '' : ' locked'}" data-build="${b.type}">
        <span class="ch-tile">${b.ico}</span>
        <span class="ch-cnm">${b.name}</span>
        <span class="ch-pills">${pills(cost)}</span></button>`;
    }).join('');
    for (const el of craftEl.querySelectorAll<HTMLElement>('[data-craft]'))
      el.onclick = () => api.onCraft(el.dataset.craft!);
    for (const el of buildEl.querySelectorAll<HTMLElement>('[data-build]'))
      el.onclick = () => { api.onPlace(el.dataset.build as BuildingType); api.toggle(false); };

    const held = self?.inventory[self.hand];
    setEq('hand', held ? ITEMS[held.item].name : null);
    for (const s of ['head', 'body', 'legs'] as const) {
      const eq = self?.equipment[s];
      setEq(s, eq ? ITEMS[eq.item].name : null);
    }
    (root.querySelector('#ch-name') as HTMLElement).textContent = self?.name ?? '—';
    (root.querySelector('#ch-namesub') as HTMLElement).textContent =
      self ? `${phase === 'day' ? 'Day' : 'Night'} · ${self.region}` : '';

    const max = held ? ITEMS[held.item].durabilityMax : undefined;
    const repairable = !!held && max !== undefined && held.dur !== undefined && held.dur < max;
    repairBtn.classList.toggle('hidden', !repairable);
    if (repairable && held) {
      const def = ITEMS[held.item];
      const matOk = def.repairItem && have(def.repairItem) >= (def.repairCost ?? 1);
      repairBtn.textContent = `🔧 Repair ${def.name}`;
      repairBtn.disabled = !matOk;
      repairBtn.classList.toggle('block', !matOk);
    }
    renderVitals();
  }

  function setEq(slot: string, name: string | null): void {
    const el = root.querySelector(`#eq-${slot}`) as HTMLElement;
    el.textContent = name ?? 'empty';
    el.classList.toggle('empty', !name);
  }

  function bar(label: string, ico: string, val: number, max: number, cls: string): string {
    const pct = Math.max(0, Math.min(100, (val / max) * 100));
    return `<div class="ch-vit">
      <div class="ch-vlbl"><span>${ico}</span>${label}<b>${Math.round(val)}</b></div>
      <div class="ch-vtrack ${cls}"><div class="ch-vfill" style="width:${pct}%"></div></div></div>`;
  }
  function renderVitals(): void {
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

  const api: CharacterUI = {
    setContext(s, ph, pt, _nt) { self = s; phase = ph; phaseTicks = pt; if (open) render(); },
    toggle(o?: boolean) {
      const next = o ?? !open;
      if (next === open) return;
      open = next;
      root.classList.toggle('hidden', !open);
      if (open) { render(); requestAnimationFrame(() => portrait.start()); }
      else portrait.stop();
    },
    isOpen() { return open; },
    onCraft: () => {},
    onPlace: () => {},
    onRepair: () => {},
  };
  return api;
}
