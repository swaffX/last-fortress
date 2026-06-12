import type { Resources } from './types';
import type { TierStats } from './data/buildings';

export type Cost = TierStats['cost'];

export function scaleCost(cost: Cost, mul: number): Cost {
  const out: Cost = {};
  if (cost.wood) out.wood = Math.ceil(cost.wood * mul);
  if (cost.stone) out.stone = Math.ceil(cost.stone * mul);
  if (cost.gold) out.gold = Math.ceil(cost.gold * mul);
  return out;
}
export function canAfford(res: Resources, cost: Cost): boolean {
  return (cost.wood ?? 0) <= res.wood &&
         (cost.stone ?? 0) <= res.stone &&
         (cost.gold ?? 0) <= res.gold;
}
export function charge(res: Resources, cost: Cost): void {
  res.wood -= cost.wood ?? 0;
  res.stone -= cost.stone ?? 0;
  res.gold -= cost.gold ?? 0;
}
export function refund(res: Resources, cost: Cost, ratio: number): void {
  res.wood += Math.floor((cost.wood ?? 0) * ratio);
  res.stone += Math.floor((cost.stone ?? 0) * ratio);
  res.gold += Math.floor((cost.gold ?? 0) * ratio);
}
