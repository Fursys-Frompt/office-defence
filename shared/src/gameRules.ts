import type { FacilityType, ResourceInventory, ResourceType, ZombieType } from './types.js';

export const resourceKeys: ResourceType[] = ['chairParts', 'deskParts', 'partitionMaterial', 'powerModule', 'medKit'];

export const facilityKeys: FacilityType[] = ['partitionBarricade', 'deskBarricade', 'medStation', 'powerAmplifier'];

export const RESOURCE_LABELS: Record<ResourceType, string> = {
  chairParts: '의자',
  deskParts: '책상',
  partitionMaterial: '파티션',
  powerModule: '전력',
  medKit: '구급'
};

export const EQUIPMENT_LABELS: Record<ResourceType, string> = {
  chairParts: '근접 방어',
  deskParts: '사거리 부품',
  partitionMaterial: '피해 완화',
  powerModule: '전력 장판',
  medKit: '소모 회복'
};

export const EQUIPMENT_DESCRIPTIONS: Record<ResourceType, string> = {
  chairParts: '짧은 범위 방어',
  deskParts: '공격 사거리 증가',
  partitionMaterial: '받는 피해 감소',
  powerModule: '사용 시 강화 구역',
  medKit: '사용 시 체력 회복'
};

export const FACILITY_LABELS: Record<FacilityType, string> = {
  partitionBarricade: '파티션',
  deskBarricade: '책상',
  medStation: '구급소',
  powerAmplifier: '증폭기'
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
