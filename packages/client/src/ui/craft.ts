import { RECIPES, ITEMS, countItem, type Recipe } from '@lf/shared';
import type { PlayerView } from '../net';

const ICON: Record<string, string> = {
  wood: '🪵', stone: '🧱', berry: '🫐', stick: '🪵', crafting_table: '🛠',
  wood_axe: '🪓', stone_axe: '🪓', wood_pick: '⛏', stone_pick: '⛏',
  wood_sword: '🗡', stone_sword: '⚔️', wood_spear: '🔱',
};

export interface CraftUI {
  setContext(self: PlayerView | undefined, nearTable: boolean): void;
  toggle(open?: boolean): void;
  isOpen(): boolean;
  onCraft: (recipeId: string) => void;
  onRepair: () => void;
}

export function createCraftUI(root: HTMLElement): CraftUI {
  let self: PlayerView | undefined;
  let nearTable = false;
  let open = false;

  root.className = 'craft-panel hidden';
  root.innerHTML = `<div class="cp-title">Crafting</div>
    <button class="btn ghost cp-repair hidden" id="cp-repair">Repair held tool</button>
    <div class="cp-list" id="cp-list"></div>`;
  const list = root.querySelector('#cp-list') as HTMLElement;
  const repairBtn = root.querySelector('#cp-repair') as HTMLButtonElement;

  const rows = new Map<string, HTMLElement>();
  for (const r of RECIPES) {
    const row = document.createElement('button');
    row.className = 'cp-row';
    row.dataset.id = r.id;
    const cost = r.inputs.map(i => `${i.count}${ICON[i.item] ?? '▪'}`).join(' ');
    row.innerHTML = `<span class="cp-ico">${ICON[r.output.item] ?? '▪'}</span>
      <span class="cp-nm">${ITEMS[r.output.item].name}${r.output.count > 1 ? ` ×${r.output.count}` : ''}</span>
      <span class="cp-cost">${cost}</span>
      <span class="cp-badge" title="needs a crafting table">🛠</span>`;
    row.onclick = () => api.onCraft(r.id);
    list.appendChild(row);
    rows.set(r.id, row);
  }
  repairBtn.onclick = () => api.onRepair();

  function affordable(r: Recipe): boolean {
    if (!self) return false;
    if (r.requiresTable && !nearTable) return false;
    return r.inputs.every(i => countItem(self!.inventory, i.item) >= i.count);
  }

  function render(): void {
    for (const r of RECIPES) {
      const row = rows.get(r.id)!;
      row.classList.toggle('poor', !affordable(r));
      row.classList.toggle('needs-table', r.requiresTable && !nearTable);
    }
    const held = self?.inventory[self.hand];
    const repairable = !!held && ITEMS[held.item].durabilityMax !== undefined
      && held.dur !== undefined && held.dur < (ITEMS[held.item].durabilityMax ?? 0);
    repairBtn.classList.toggle('hidden', !repairable);
  }

  const api: CraftUI = {
    setContext(s, nt) { self = s; nearTable = nt; if (open) render(); },
    toggle(o?: boolean) { open = o ?? !open; root.classList.toggle('hidden', !open); if (open) render(); },
    isOpen() { return open; },
    onCraft: () => {},
    onRepair: () => {},
  };
  return api;
}
