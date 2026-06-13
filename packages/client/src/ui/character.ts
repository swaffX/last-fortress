import { RECIPES, ITEMS, BUILDINGS, countItem, type Recipe, type ItemId, type BuildingType } from '@lf/shared';
import type { PlayerView } from '../net';

const ICON: Record<string, string> = {
  wood: '🪵', stone: '🧱', berry: '🫐', stick: '🪵', crafting_table: '🛠',
  wood_axe: '🪓', stone_axe: '🪓', wood_pick: '⛏', stone_pick: '⛏',
  wood_sword: '🗡', stone_sword: '⚔️', wood_spear: '🔱',
};
const BUILD: { type: BuildingType; name: string }[] = [
  { type: 'wood_wall', name: 'Wood Wall' },
  { type: 'stone_wall', name: 'Stone Wall' },
  { type: 'gate', name: 'Gate' },
  { type: 'spike', name: 'Spikes' },
  { type: 'crafting_table', name: 'Workbench' },
];

export interface CharacterUI {
  setContext(self: PlayerView | undefined, phase: 'day' | 'night', phaseTicks: number, nearTable: boolean): void;
  toggle(open?: boolean): void;
  isOpen(): boolean;
  onCraft: (recipeId: string) => void;
  onPlace: (type: BuildingType) => void;
  onRepair: () => void;
}

/** Always-available basics: hand-craftable recipes (no workbench needed). */
const BASICS: Recipe[] = RECIPES.filter(r => !r.requiresTable);

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
        <div class="ch-avatar" id="ch-avatar"><div class="ch-figure">🧍</div></div>
        <div class="ch-name" id="ch-name">—</div>
        <div class="ch-equip">
          <div class="ch-eq" data-s="head"><span>⛑</span><b>Head</b><i id="eq-head">—</i></div>
          <div class="ch-eq" data-s="body"><span>🥋</span><b>Body</b><i id="eq-body">—</i></div>
          <div class="ch-eq" data-s="legs"><span>👖</span><b>Legs</b><i id="eq-legs">—</i></div>
          <div class="ch-eq hand" data-s="hand"><span>✋</span><b>In Hand</b><i id="eq-hand">—</i></div>
        </div>
        <button class="ch-repair hidden" id="ch-repair"></button>
      </div>
      <div class="ch-col ch-mid">
        <div class="ch-coltitle">Make</div>
        <div class="ch-sub">Craft by hand — anywhere</div>
        <div class="ch-list" id="ch-craft"></div>
        <div class="ch-coltitle" style="margin-top:6px">Build</div>
        <div class="ch-sub">Select, then place in the world</div>
        <div class="ch-list ch-build" id="ch-build"></div>
      </div>
      <div class="ch-col ch-right">
        <div class="ch-coltitle">Status</div>
        <div class="ch-vitals" id="ch-vitals"></div>
        <div class="ch-hint">More gear needs a Workbench — craft one, place it, press <b>C</b> beside it.</div>
      </div>
    </div>`;

  const craftEl = root.querySelector('#ch-craft') as HTMLElement;
  const buildEl = root.querySelector('#ch-build') as HTMLElement;
  const vitalsEl = root.querySelector('#ch-vitals') as HTMLElement;
  const repairBtn = root.querySelector('#ch-repair') as HTMLButtonElement;

  (root.querySelector('#ch-close') as HTMLElement).onclick = () => api.toggle(false);
  root.addEventListener('pointerdown', e => { if (e.target === root) api.toggle(false); });
  repairBtn.onclick = () => api.onRepair();

  function have(item: ItemId): number { return self ? countItem(self.inventory, item) : 0; }
  function canCraft(r: Recipe): boolean { return r.inputs.every(i => have(i.item) >= i.count); }
  function canBuild(type: BuildingType): boolean {
    return (Object.entries(BUILDINGS[type].cost) as [ItemId, number][]).every(([k, v]) => have(k) >= v);
  }
  const costStr = (entries: { item: ItemId; count: number }[]) =>
    entries.map(i => `${i.count}${ICON[i.item] ?? '▪'}`).join(' ');

  function render(): void {
    craftEl.innerHTML = BASICS.map(r => {
      const ok = canCraft(r);
      return `<button class="ch-row${ok ? '' : ' poor'}" data-craft="${r.id}">
        <span class="ch-ric">${ICON[r.output.item] ?? '▪'}</span>
        <span class="ch-rnm">${ITEMS[r.output.item].name}${r.output.count > 1 ? ` ×${r.output.count}` : ''}</span>
        <span class="ch-rcost">${costStr(r.inputs)}</span></button>`;
    }).join('');
    buildEl.innerHTML = BUILD.map(b => {
      const cost = (Object.entries(BUILDINGS[b.type].cost) as [ItemId, number][])
        .map(([k, v]) => ({ item: k, count: v }));
      const ok = canBuild(b.type);
      return `<button class="ch-row${ok ? '' : ' poor'}" data-build="${b.type}">
        <span class="ch-ric">${ICON[b.type === 'crafting_table' ? 'crafting_table' : (b.type.startsWith('stone') ? 'stone' : 'wood')] ?? '▪'}</span>
        <span class="ch-rnm">${b.name}</span>
        <span class="ch-rcost">${costStr(cost)}</span></button>`;
    }).join('');
    for (const el of craftEl.querySelectorAll<HTMLElement>('[data-craft]'))
      el.onclick = () => api.onCraft(el.dataset.craft!);
    for (const el of buildEl.querySelectorAll<HTMLElement>('[data-build]'))
      el.onclick = () => { api.onPlace(el.dataset.build as BuildingType); api.toggle(false); };

    // equipment / hand
    const held = self?.inventory[self.hand];
    (root.querySelector('#eq-hand') as HTMLElement).textContent = held ? ITEMS[held.item].name : '—';
    (root.querySelector('#ch-name') as HTMLElement).textContent = self?.name ?? '—';
    for (const s of ['head', 'body', 'legs'] as const) {
      const eq = self?.equipment[s];
      (root.querySelector(`#eq-${s}`) as HTMLElement).textContent = eq ? ITEMS[eq.item].name : '—';
    }
    // repair
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

  function bar(label: string, ico: string, val: number, max: number, color: string): string {
    const pct = Math.max(0, Math.min(100, (val / max) * 100));
    return `<div class="ch-vit"><div class="ch-vlbl"><span>${ico}</span>${label}<b>${Math.round(val)}</b></div>
      <div class="ch-vtrack"><div class="ch-vfill" style="width:${pct}%;background:${color}"></div></div></div>`;
  }
  function renderVitals(): void {
    if (!self) { vitalsEl.innerHTML = ''; return; }
    const time = phase === 'day' ? `Day · ${Math.ceil(phaseTicks / 20)}s` : 'Night';
    vitalsEl.innerHTML =
      bar('Health', '❤', self.hp, self.maxHp, 'linear-gradient(90deg,#c43a31,#e05b4a)') +
      bar('Hunger', '🍖', self.hunger, 100, 'linear-gradient(90deg,#c08a3a,#e8b64c)') +
      bar('Warmth', '🌡', self.temperature, 100, 'linear-gradient(90deg,#5aa0c8,#8fd0e8)') +
      `<div class="ch-stat"><span>🧭</span>Region<b>${self.region}</b></div>` +
      `<div class="ch-stat"><span>🕗</span>Time<b>${time}</b></div>`;
  }

  const api: CharacterUI = {
    setContext(s, ph, pt, _nt) { self = s; phase = ph; phaseTicks = pt; if (open) render(); },
    toggle(o?: boolean) { open = o ?? !open; root.classList.toggle('hidden', !open); if (open) render(); },
    isOpen() { return open; },
    onCraft: () => {},
    onPlace: () => {},
    onRepair: () => {},
  };
  return api;
}
