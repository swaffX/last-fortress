import { RECIPES, ITEMS, countItem, type Recipe, type ItemId } from '@lf/shared';
import type { PlayerView } from '../net';

const ICON: Record<string, string> = {
  wood: '🪵', stone: '🧱', berry: '🫐', stick: '🪵', crafting_table: '🛠',
  wood_axe: '🪓', stone_axe: '🪓', wood_pick: '⛏', stone_pick: '⛏',
  wood_sword: '🗡', stone_sword: '⚔️', wood_spear: '🔱',
};

type Cat = 'all' | 'tool' | 'weapon' | 'placeable' | 'resource';
const CATS: { id: Cat; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'tool', label: 'Tools' },
  { id: 'weapon', label: 'Weapons' },
  { id: 'placeable', label: 'Build' },
  { id: 'resource', label: 'Materials' },
];

export interface CraftUI {
  setContext(self: PlayerView | undefined, nearTable: boolean): void;
  toggle(open?: boolean): void;
  isOpen(): boolean;
  onCraft: (recipeId: string) => void;
  onRepair: () => void;
}

function recipeCat(r: Recipe): Cat { return ITEMS[r.output.item].category as Cat; }

export function createCraftUI(root: HTMLElement): CraftUI {
  let self: PlayerView | undefined;
  let nearTable = false;
  let open = false;
  let search = '';
  let cat: Cat = 'all';
  let selected: string = RECIPES[0]!.id;

  root.className = 'craft-overlay hidden';
  root.innerHTML = `
    <div class="craft-modal">
      <div class="cf-head">
        <span class="cf-emblem">⚒</span>
        <div class="cf-titles"><span class="cf-title">The Workbench</span>
          <span class="cf-sub">Survivor's Codex of Making</span></div>
        <button class="cf-close" id="cf-close">✕</button>
      </div>
      <div class="cf-body">
        <div class="cf-left">
          <div class="cf-search"><span>🔍</span><input id="cf-search" placeholder="Search recipes…" maxlength="24"></div>
          <div class="cf-cats" id="cf-cats">${CATS.map(c =>
            `<button class="cf-chip${c.id === 'all' ? ' on' : ''}" data-c="${c.id}">${c.label}</button>`).join('')}</div>
          <div class="cf-list" id="cf-list"></div>
          <div class="cf-repair hidden" id="cf-repair">
            <button class="cf-repair-btn" id="cf-repair-btn"></button>
          </div>
        </div>
        <div class="cf-detail" id="cf-detail"></div>
      </div>
    </div>`;

  const listEl = root.querySelector('#cf-list') as HTMLElement;
  const detailEl = root.querySelector('#cf-detail') as HTMLElement;
  const searchEl = root.querySelector('#cf-search') as HTMLInputElement;
  const repairWrap = root.querySelector('#cf-repair') as HTMLElement;
  const repairBtn = root.querySelector('#cf-repair-btn') as HTMLButtonElement;

  (root.querySelector('#cf-close') as HTMLElement).onclick = () => api.toggle(false);
  root.addEventListener('pointerdown', e => { if (e.target === root) api.toggle(false); });
  searchEl.oninput = () => { search = searchEl.value.toLowerCase(); renderList(); };
  for (const chip of root.querySelectorAll<HTMLElement>('.cf-chip')) {
    chip.onclick = () => {
      cat = chip.dataset.c as Cat;
      for (const c of root.querySelectorAll('.cf-chip')) c.classList.toggle('on', c === chip);
      renderList();
    };
  }
  repairBtn.onclick = () => api.onRepair();

  function have(item: ItemId): number { return self ? countItem(self.inventory, item) : 0; }
  function affordable(r: Recipe): boolean {
    if (!self) return false;
    if (r.requiresTable && !nearTable) return false;
    return r.inputs.every(i => have(i.item) >= i.count);
  }
  function visible(): Recipe[] {
    return RECIPES.filter(r =>
      (cat === 'all' || recipeCat(r) === cat) &&
      (!search || ITEMS[r.output.item].name.toLowerCase().includes(search)));
  }

  function renderList(): void {
    const rows = visible();
    if (!rows.some(r => r.id === selected) && rows.length) selected = rows[0]!.id;
    listEl.innerHTML = rows.map(r => {
      const ok = affordable(r);
      const def = ITEMS[r.output.item];
      return `<button class="cf-row${r.id === selected ? ' sel' : ''}${ok ? '' : ' poor'}" data-id="${r.id}">
        <span class="cf-ric">${ICON[r.output.item] ?? '▪'}</span>
        <span class="cf-rnm">${def.name}</span>
        <span class="cf-rdot ${ok ? 'on' : 'off'}"></span>
      </button>`;
    }).join('') || `<div class="cf-empty">No recipes found.</div>`;
    for (const el of listEl.querySelectorAll<HTMLElement>('.cf-row')) {
      el.onclick = () => { selected = el.dataset.id!; renderList(); renderDetail(); };
    }
    renderDetail();
  }

  function renderDetail(): void {
    const r = RECIPES.find(x => x.id === selected);
    if (!r) { detailEl.innerHTML = ''; return; }
    const def = ITEMS[r.output.item];
    const ok = affordable(r);
    const tableMissing = r.requiresTable && !nearTable;
    const stats: string[] = [];
    if (def.gatherMul) stats.push(`Gather ×${def.gatherMul}`);
    if (def.dmg) stats.push(`Damage ${def.dmg}`);
    if (def.durabilityMax) stats.push(`Durability ${def.durabilityMax}`);
    detailEl.innerHTML = `
      <div class="cf-plaque">
        <div class="cf-bigico">${ICON[r.output.item] ?? '▪'}</div>
        <div class="cf-pmeta">
          <div class="cf-pname">${def.name}${r.output.count > 1 ? ` <em>×${r.output.count}</em>` : ''}</div>
          <div class="cf-tag cf-tag-${def.category}">${def.category}</div>
        </div>
      </div>
      <div class="cf-station ${r.requiresTable ? (nearTable ? 'near' : 'far') : 'hand'}">
        ${r.requiresTable ? (nearTable ? '🛠 Workbench in reach' : '🛠 Needs a workbench nearby') : '✋ Hand-craftable anywhere'}
      </div>
      <div class="cf-mat-h">Materials</div>
      <div class="cf-mats">
        ${r.inputs.map(i => {
          const h = have(i.item), enough = h >= i.count;
          return `<div class="cf-mat ${enough ? 'ok' : 'no'}">
            <span class="cf-mic">${ICON[i.item] ?? '▪'}</span>
            <span class="cf-mnm">${ITEMS[i.item].name}</span>
            <span class="cf-mct">${h}/${i.count}</span></div>`;
        }).join('')}
      </div>
      ${stats.length ? `<div class="cf-stats">${stats.map(s => `<span>${s}</span>`).join('')}</div>` : ''}
      <p class="cf-desc">${r.desc}</p>
      <button class="cf-craft ${ok ? 'ready' : 'block'}" id="cf-craft" ${ok ? '' : 'disabled'}>
        ${tableMissing ? 'Need a Workbench' : ok ? 'Craft' : 'Missing Materials'}
      </button>`;
    const btn = detailEl.querySelector('#cf-craft') as HTMLButtonElement;
    btn.onclick = () => { if (ok) api.onCraft(r.id); };
  }

  function renderRepair(): void {
    const held = self?.inventory[self.hand];
    const max = held ? ITEMS[held.item].durabilityMax : undefined;
    const repairable = !!held && max !== undefined && held.dur !== undefined && held.dur < max;
    repairWrap.classList.toggle('hidden', !repairable);
    if (repairable && held) {
      const def = ITEMS[held.item];
      const matOk = def.repairItem && have(def.repairItem) >= (def.repairCost ?? 1);
      repairBtn.textContent = `🔧 Repair ${def.name}` + (matOk ? '' : ` (need ${def.repairCost} ${def.repairItem})`);
      repairBtn.disabled = !matOk;
      repairBtn.classList.toggle('block', !matOk);
    }
  }

  const api: CraftUI = {
    setContext(s, nt) { self = s; nearTable = nt; if (open) { renderList(); renderRepair(); } },
    toggle(o?: boolean) {
      open = o ?? !open;
      root.classList.toggle('hidden', !open);
      if (open) { renderList(); renderRepair(); searchEl.value = search; }
    },
    isOpen() { return open; },
    onCraft: () => {},
    onRepair: () => {},
  };
  return api;
}
