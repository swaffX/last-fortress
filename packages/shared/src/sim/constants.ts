export const TICK_RATE = 20;                 // ticks per second
export const TICK_MS = 1000 / TICK_RATE;
export const MAP_SIZE = 360;                 // ~8× the old 128² play area
export const CAMP_POS = { x: 180, y: 180 };  // forced-meadow camp / respawn anchor (map center)
export const CAMP_CLEAR_RADIUS = 14;         // no nodes/decor inside the camp clearing

// Continuous day/night — no waves. Night is the dangerous phase (content lands in Phase 2).
export const DAY_TICKS = 150 * TICK_RATE;
export const NIGHT_TICKS = 90 * TICK_RATE;

export const PLAYER_SPEED = 6 / TICK_RATE;   // 6 units/s, per-tick
export const PLAYER_MAX_HP = 100;
export const RESPAWN_TICKS = 6 * TICK_RATE;

// Inventory layout
export const HOTBAR_SLOTS = 9;
export const BACKPACK_SLOTS = 27;
export const INVENTORY_SLOTS = HOTBAR_SLOTS + BACKPACK_SLOTS; // 36

// Survival stats
export const HUNGER_MAX = 100;
export const HUNGER_START = 80;
export const HUNGER_DECAY_IDLE = 0.012;      // per tick (~0.24/s)
export const HUNGER_DECAY_ACTIVE = 0.03;     // while moving/gathering
export const STARVE_DMG = 0.4;               // hp/tick at hunger 0

// Bare-hand gathering (tools arrive in Phase 1)
export const BARE_HAND_YIELD = 1;            // resource units per swing
export const GATHER_COOLDOWN = 10;           // ticks between swings
export const GATHER_RANGE = 2.8;

// Ground items
export const ITEM_TTL_TICKS = 180 * TICK_RATE;   // 3 min despawn
export const PICKUP_RANGE = 1.3;

// Node sizes
export const NODE_AMOUNT = { tree: 18, rock: 24, bush: 6 } as const;
export const BUSH_REGROW_TICKS = 60 * TICK_RATE;
