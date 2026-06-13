import { ITEMS, isDurable, type ItemId, type Slot } from './data/items';

/** Add `count` of `item`; returns the leftover that did not fit. */
export function addItem(inv: Slot[], item: ItemId, count: number): number {
  const max = ITEMS[item].stackSize;
  // top up existing stacks first
  for (const s of inv) {
    if (count <= 0) break;
    if (s && s.item === item && s.dur === undefined && s.count < max) {
      const room = max - s.count;
      const put = Math.min(room, count);
      s.count += put; count -= put;
    }
  }
  // then fill empty slots
  for (let i = 0; i < inv.length && count > 0; i++) {
    if (inv[i] === null) {
      const put = Math.min(max, count);
      inv[i] = { item, count: put }; count -= put;
    }
  }
  return count;
}

/** Remove `count` of `item`; returns true only if the full amount was removed. */
export function removeItem(inv: Slot[], item: ItemId, count: number): boolean {
  if (countItem(inv, item) < count) return false;
  for (let i = 0; i < inv.length && count > 0; i++) {
    const s = inv[i];
    if (s && s.item === item) {
      const take = Math.min(s.count, count);
      s.count -= take; count -= take;
      if (s.count === 0) inv[i] = null;
    }
  }
  return true;
}

export function countItem(inv: Slot[], item: ItemId): number {
  let n = 0;
  for (const s of inv) if (s && s.item === item) n += s.count;
  return n;
}

export function firstEmpty(inv: Slot[]): number {
  return inv.findIndex(s => s === null);
}

/** Swap or merge two slots (drag-and-drop). Mutates `inv`. */
export function moveSlot(inv: Slot[], from: number, to: number): void {
  if (from === to || from < 0 || to < 0 || from >= inv.length || to >= inv.length) return;
  const a = inv[from], b = inv[to];
  if (!a) return;
  if (b && a.item === b.item) {
    const max = ITEMS[a.item].stackSize;
    const move = Math.min(a.count, max - b.count);
    b.count += move; a.count -= move;
    if (a.count === 0) inv[from] = null;
    return;
  }
  inv[from] = b ?? null;
  inv[to] = a;
}

export function emptyInventory(size: number): Slot[] {
  return Array.from({ length: size }, () => null as Slot);
}

/**
 * Place `count` of `item` into the inventory. Durable items go one-per-slot
 * with full durability; everything else stacks via addItem. Returns leftover.
 */
export function giveItem(inv: Slot[], item: ItemId, count: number): number {
  if (!isDurable(item)) return addItem(inv, item, count);
  const max = ITEMS[item].durabilityMax!;
  let left = count;
  for (let i = 0; i < inv.length && left > 0; i++) {
    if (inv[i] === null) { inv[i] = { item, count: 1, dur: max }; left--; }
  }
  return left;
}
