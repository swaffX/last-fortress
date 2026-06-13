import { ITEMS, HOTBAR_SLOTS, type Slot } from '@lf/shared';
import type { PlayerView } from '../net';

type Equipment = PlayerView['equipment'];

const ITEM_ICON: Record<string, string> = {
  wood: '🪵', stone: '🧱', berry: '🫐', stick: '🪵', crafting_table: '🛠',
  wood_axe: '🪓', stone_axe: '🪓', wood_pick: '⛏', stone_pick: '⛏',
  wood_sword: '🗡', stone_sword: '⚔️', wood_spear: '🔱',
};

export interface InventoryUI {
  setData(inventory: Slot[], equipment: Equipment, hand: number): void;
  toggle(open?: boolean): void;
  isOpen(): boolean;
  onMove: (from: number, to: number) => void;
  onDrop: (slot: number, count: number) => void;
  onSelectHand: (slot: number) => void;
}

function slotHtml(s: Slot): string {
  if (!s) return '';
  const ico = ITEM_ICON[s.item] ?? '▪';
  const max = ITEMS[s.item].durabilityMax;
  const bar = (max && s.dur !== undefined)
    ? `<span class="dur"><span class="dur-fill" style="width:${Math.max(0, (s.dur / max) * 100)}%"></span></span>`
    : '';
  return `<span class="it-ico">${ico}</span><span class="it-n">${s.count > 1 ? s.count : ''}</span>${bar}`;
}

export function createInventoryUI(hotbarRoot: HTMLElement, backpackRoot: HTMLElement): InventoryUI {
  let inv: Slot[] = [];
  let hand = 0;
  let open = false;
  let dragFrom: number | null = null;

  const api: InventoryUI = {
    setData(inventory, _equipment, h) { inv = inventory; hand = h; render(); },
    toggle(o?: boolean) { open = o ?? !open; backpackRoot.classList.toggle('hidden', !open); render(); },
    isOpen() { return open; },
    onMove: () => {},
    onDrop: () => {},
    onSelectHand: () => {},
  };

  // build the hotbar shell once (9 slots)
  hotbarRoot.className = 'hotbar';
  hotbarRoot.innerHTML = Array.from({ length: HOTBAR_SLOTS }, (_, i) =>
    `<div class="slot" data-i="${i}"><span class="key">${i + 1}</span></div>`).join('');
  // build the backpack shell (27 slots), hidden until toggled
  backpackRoot.className = 'backpack hidden';
  backpackRoot.innerHTML =
    `<div class="bp-title">Backpack</div><div class="bp-grid" id="bp-grid">` +
    Array.from({ length: 27 }, (_, i) => `<div class="slot" data-i="${i + HOTBAR_SLOTS}"></div>`).join('') +
    `</div>`;

  function wire(el: HTMLElement): void {
    const idx = Number(el.dataset.i);
    el.draggable = true;
    el.addEventListener('dragstart', () => { dragFrom = idx; });
    el.addEventListener('dragover', e => e.preventDefault());
    el.addEventListener('drop', e => {
      e.preventDefault();
      if (dragFrom !== null && dragFrom !== idx) api.onMove(dragFrom, idx);
      dragFrom = null;
    });
    el.addEventListener('click', () => { if (idx < HOTBAR_SLOTS) api.onSelectHand(idx); });
    el.addEventListener('contextmenu', e => { e.preventDefault(); api.onDrop(idx, 1); });
  }
  for (const el of hotbarRoot.querySelectorAll<HTMLElement>('.slot')) wire(el);
  for (const el of backpackRoot.querySelectorAll<HTMLElement>('.slot')) wire(el);

  function render(): void {
    for (const el of hotbarRoot.querySelectorAll<HTMLElement>('.slot')) {
      const i = Number(el.dataset.i);
      el.classList.toggle('active', i === hand);
      const s = inv[i] ?? null;
      el.querySelector('.it-ico')?.remove();
      el.querySelector('.it-n')?.remove();
      el.querySelector('.dur')?.remove();
      if (s) el.insertAdjacentHTML('beforeend', slotHtml(s));
    }
    if (open) {
      for (const el of backpackRoot.querySelectorAll<HTMLElement>('.slot')) {
        const i = Number(el.dataset.i);
        el.innerHTML = slotHtml(inv[i] ?? null);
      }
    }
  }

  return api;
}
