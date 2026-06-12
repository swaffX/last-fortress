/**
 * Wave-vote team upgrades: every 3rd cleared wave the team is offered three
 * random choices and must agree unanimously. Application logic lives in
 * Sim.applyUpgrade — these are the definitions the UI shows.
 */
export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
}

export const UPGRADE_CHOICES: UpgradeDef[] = [
  { id: 'sharp_steel', name: 'Sharpened Steel', desc: '+15% player damage' },
  { id: 'siege_works', name: 'Siege Works', desc: '+20% tower damage' },
  { id: 'weakening_curse', name: 'Weakening Curse', desc: 'Enemies deal 15% less damage' },
  { id: 'fortify', name: 'Fortify', desc: 'Castle max HP +25% and repaired 30%' },
  { id: 'prosperity', name: 'Prosperity', desc: '+25% resource income' },
  { id: 'war_spoils', name: 'War Spoils', desc: '+30% coins from kills' },
  { id: 'fleet_footed', name: 'Fleet Footed', desc: '+12% movement speed' },
  { id: 'masons_call', name: "Mason's Call", desc: 'All structures repaired 50%' },
];
