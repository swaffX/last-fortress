export const TICK_RATE = 20;                 // ticks per second
export const TICK_MS = 1000 / TICK_RATE;
export const MAP_SIZE = 128;                 // grid cells per side; world units == cells
export const CASTLE_POS = { x: 62, y: 62 };  // 4x4 footprint centered on map
export const DAY_TICKS = 90 * TICK_RATE;     // 90 s build phase
export const PLAYER_SPEED = 6 / TICK_RATE;   // 6 units/s, per-tick
export const PLAYER_MAX_HP = 100;
export const RESPAWN_TICKS = 8 * TICK_RATE;
export const GATHER_AMOUNT = 5;              // resources per hit on a node
export const START_RESOURCES = { wood: 100, stone: 50, gold: 0, coins: 0 };
