// Client-only cosmetic data driving procedural creature models + their animation.
// Deliberately NOT in @lf/shared — the deterministic 20 Hz sim must stay free of
// render concerns. Each entry yields a distinct low-poly silhouette via buildCreature().

export type Gait = 'quad' | 'hop' | 'bird' | 'skitter' | 'slither';

export interface AnimParams {
  bob: number;       // body vertical bounce amplitude (world units)
  headBob: number;   // head vertical bounce amplitude
  tailSway: number;  // tail yaw amplitude (radians)
  cadence: number;   // base stride frequency multiplier
}

export interface CreatureBlueprint {
  scale: number;
  body: { w: number; h: number; d: number; col: number; round?: boolean };
  head: { size: number; col: number; snout?: number; muzzleCol?: number };
  ears?: 'pointed' | 'round' | 'long' | 'floppy';
  horns?: 'cow' | 'tusks';
  tail?: 'stub' | 'bushy' | 'thin';
  legs: { count: 2 | 4; thickness: number; length: number; col: number };
  extras?: ('udder' | 'wool' | 'hump' | 'comb' | 'beak')[];
  gait: Gait;
  anim: AnimParams;
}

// The 8 box-bodied animals. spider & snake keep bespoke builders (already distinct
// silhouettes) but gain animation via their tagged rig.
export const CREATURE_BLUEPRINTS: Record<string, CreatureBlueprint> = {
  cow: {
    scale: 1.25, body: { w: 1.0, h: 0.62, d: 0.6, col: 0x6b5640 },
    head: { size: 0.42, col: 0xe8e2d4, snout: 0.18, muzzleCol: 0xd8c8b0 },
    ears: 'floppy', horns: 'cow', tail: 'thin',
    legs: { count: 4, thickness: 0.15, length: 0.5, col: 0x5a4636 },
    extras: ['udder'], gait: 'quad', anim: { bob: 0.05, headBob: 0.04, tailSway: 0.5, cadence: 8 },
  },
  sheep: {
    scale: 1.0, body: { w: 0.85, h: 0.55, d: 0.55, col: 0xe8e2d4, round: true },
    head: { size: 0.3, col: 0x3a322c },
    ears: 'floppy', tail: 'stub',
    legs: { count: 4, thickness: 0.1, length: 0.32, col: 0x2e2620 },
    extras: ['wool'], gait: 'quad', anim: { bob: 0.04, headBob: 0.03, tailSway: 0.3, cadence: 9 },
  },
  pig: {
    scale: 1.0, body: { w: 0.8, h: 0.5, d: 0.5, col: 0xd99a9a, round: true },
    head: { size: 0.36, col: 0xc78a8a, snout: 0.16, muzzleCol: 0xe0a8a8 },
    ears: 'pointed', tail: 'stub',
    legs: { count: 4, thickness: 0.11, length: 0.26, col: 0xb87a7a },
    gait: 'quad', anim: { bob: 0.05, headBob: 0.04, tailSway: 0.6, cadence: 11 },
  },
  boar: {
    scale: 1.0, body: { w: 0.85, h: 0.52, d: 0.55, col: 0x5a4a3a },
    head: { size: 0.4, col: 0x4a3a2a, snout: 0.18, muzzleCol: 0x3a2c1e },
    ears: 'pointed', horns: 'tusks', tail: 'thin',
    legs: { count: 4, thickness: 0.13, length: 0.34, col: 0x3a2c1e },
    extras: ['hump'], gait: 'quad', anim: { bob: 0.05, headBob: 0.05, tailSway: 0.3, cadence: 10 },
  },
  wolf: {
    scale: 1.0, body: { w: 0.82, h: 0.4, d: 0.42, col: 0x6a6f78 },
    head: { size: 0.34, col: 0x565b64, snout: 0.16, muzzleCol: 0x44484f },
    ears: 'pointed', tail: 'bushy',
    legs: { count: 4, thickness: 0.1, length: 0.42, col: 0x4a4e56 },
    gait: 'quad', anim: { bob: 0.04, headBob: 0.04, tailSway: 0.5, cadence: 11 },
  },
  bear: {
    scale: 1.25, body: { w: 1.0, h: 0.7, d: 0.6, col: 0x4a3a2a },
    head: { size: 0.46, col: 0x3a2c1e, snout: 0.14, muzzleCol: 0x2e2218 },
    ears: 'round', tail: 'stub',
    legs: { count: 4, thickness: 0.18, length: 0.4, col: 0x3a2c1e },
    gait: 'quad', anim: { bob: 0.06, headBob: 0.03, tailSway: 0.2, cadence: 7 },
  },
  chicken: {
    scale: 0.7, body: { w: 0.4, h: 0.4, d: 0.45, col: 0xf0ead8, round: true },
    head: { size: 0.24, col: 0xf0ead8 },
    tail: 'thin',
    legs: { count: 2, thickness: 0.05, length: 0.22, col: 0xe0a040 },
    extras: ['comb', 'beak'], gait: 'bird', anim: { bob: 0.03, headBob: 0.08, tailSway: 0.4, cadence: 12 },
  },
  rabbit: {
    scale: 0.6, body: { w: 0.42, h: 0.36, d: 0.5, col: 0xcfc6b4, round: true },
    head: { size: 0.26, col: 0xe8e2d4 },
    ears: 'long', tail: 'stub',
    legs: { count: 4, thickness: 0.08, length: 0.22, col: 0xc0b6a2 },
    gait: 'hop', anim: { bob: 0.0, headBob: 0.05, tailSway: 0.2, cadence: 6 },
  },
};
