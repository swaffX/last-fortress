import type { Vec2, EntityId } from './types';

/** Occupancy grid. 0 = free, otherwise the occupying entity id. */
export class Grid {
  private cells: Int32Array;
  constructor(readonly size: number) { this.cells = new Int32Array(size * size); }
  private idx(x: number, y: number) { return y * this.size + x; }

  inBounds(pos: Vec2, footprint = 1): boolean {
    return pos.x >= 0 && pos.y >= 0 &&
      pos.x + footprint <= this.size && pos.y + footprint <= this.size;
  }
  canPlace(pos: Vec2, footprint: number): boolean {
    if (!this.inBounds(pos, footprint)) return false;
    for (let y = pos.y; y < pos.y + footprint; y++)
      for (let x = pos.x; x < pos.x + footprint; x++)
        if (this.cells[this.idx(x, y)] !== 0) return false;
    return true;
  }
  occupy(pos: Vec2, footprint: number, id: EntityId): void {
    for (let y = pos.y; y < pos.y + footprint; y++)
      for (let x = pos.x; x < pos.x + footprint; x++)
        this.cells[this.idx(x, y)] = id;
  }
  clear(pos: Vec2, footprint: number): void {
    for (let y = pos.y; y < pos.y + footprint; y++)
      for (let x = pos.x; x < pos.x + footprint; x++)
        this.cells[this.idx(x, y)] = 0;
  }
  occupantAt(pos: Vec2): EntityId {
    const x = Math.floor(pos.x), y = Math.floor(pos.y);
    if (!this.inBounds({ x, y })) return 0;
    return this.cells[this.idx(x, y)]!;
  }
}
