import type { EnemyType } from '../types';
import type { Rng } from '../rng';
import { TICK_RATE } from '../constants';

export interface SpawnEntry { type: EnemyType; delayTicks: number; }

export function enemyHpScale(wave: number): number { return 1 + 0.12 * (wave - 1); }
export function enemyDmgScale(wave: number): number { return 1 + 0.08 * (wave - 1); }

/** Pattern cycle: rest waves are light, boss every 10th, elites mixed in late. */
export function waveComposition(wave: number, rng: Rng): SpawnEntry[] {
  const out: SpawnEntry[] = [];
  const isBoss = wave % 10 === 0;
  const isRest = !isBoss && wave % 5 === 4;
  const base = 6 + Math.floor(wave * 1.8);
  const count = Math.floor(isRest ? base * 0.4 : base);

  const pool: EnemyType[] = ['normal'];
  if (wave >= 2) pool.push('fast');
  if (wave >= 4) pool.push('spitter');
  if (wave >= 6) pool.push('tank');
  if (wave >= 8) pool.push('exploding');

  let t = 0;
  for (let i = 0; i < count; i++) {
    out.push({ type: rng.pick(pool), delayTicks: t });
    t += rng.int(Math.floor(TICK_RATE * 0.3), Math.floor(TICK_RATE * 1.2));
  }
  if (isBoss) out.push({ type: 'butcher', delayTicks: t + TICK_RATE * 3 });
  return out;
}
