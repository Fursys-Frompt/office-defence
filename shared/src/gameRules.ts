import type { FacilityType, ResourceInventory, ResourceType, ZombieType } from './types.js';

export const resourceKeys: ResourceType[] = ['chairParts', 'deskParts', 'partitionMaterial', 'powerModule', 'medKit'];

export const facilityKeys: FacilityType[] = ['partitionBarricade', 'deskBarricade', 'medStation', 'powerAmplifier'];

export const RESOURCE_LABELS: Record<ResourceType, string> = {
  chairParts: 'Chair',
  deskParts: 'Desk',
  partitionMaterial: 'Panel',
  powerModule: 'Power',
  medKit: 'Med'
};

export const EQUIPMENT_LABELS: Record<ResourceType, string> = {
  chairParts: 'Chair Shield',
  deskParts: 'Desk Barrage',
  partitionMaterial: 'Panel Guard',
  powerModule: 'Power Core',
  medKit: 'Med Reserve'
};

export const EQUIPMENT_DESCRIPTIONS: Record<ResourceType, string> = {
  chairParts: 'Orbit damage',
  deskParts: 'Auto shots',
  partitionMaterial: 'Damage guard',
  powerModule: 'Attack boost',
  medKit: 'HP reserve'
};

export const FACILITY_LABELS: Record<FacilityType, string> = {
  partitionBarricade: 'Panel',
  deskBarricade: 'Desk',
  medStation: 'Med Box',
  powerAmplifier: 'Amp'
};

export const FACILITY_COSTS: Record<FacilityType, Partial<ResourceInventory>> = {
  partitionBarricade: { chairParts: 1, partitionMaterial: 1 },
  deskBarricade: { deskParts: 2, partitionMaterial: 1 },
  medStation: { medKit: 1, deskParts: 1 },
  powerAmplifier: { powerModule: 1, partitionMaterial: 2 }
};

export const FACILITY_HP: Record<FacilityType, number> = {
  partitionBarricade: 130,
  deskBarricade: 190,
  medStation: 120,
  powerAmplifier: 110
};

export const ZOMBIE_SCORE: Record<ZombieType, number> = {
  normal: 10,
  runner: 15,
  tanker: 30
};
