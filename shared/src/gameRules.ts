import type { FacilityType, ResourceInventory, ResourceType, ZombieType } from './types.js';

export const resourceKeys: ResourceType[] = ['chairParts', 'deskParts', 'partitionMaterial', 'medKit'];

export const facilityKeys: FacilityType[] = ['partitionBarricade', 'deskBarricade', 'medStation'];

export const RESOURCE_LABELS: Record<ResourceType, string> = {
  chairParts: '의자',
  deskParts: '책상',
  partitionMaterial: '파티션',
  medKit: '구급'
};

export const EQUIPMENT_LABELS: Record<ResourceType, string> = {
  chairParts: '근접 방어',
  deskParts: '사거리 부품',
  partitionMaterial: '방어 전개',
  medKit: '소모 회복'
};

export const EQUIPMENT_DESCRIPTIONS: Record<ResourceType, string> = {
  chairParts: '주변 적을 밀어내고 피해를 줍니다.',
  deskParts: '공격 사거리와 자동 공격 빈도를 높입니다.',
  partitionMaterial: '사용 시 사방에 임시 바리케이드를 전개합니다.',
  medKit: '사용 시 체력을 회복합니다.'
};

export const FACILITY_LABELS: Record<FacilityType, string> = {
  partitionBarricade: '파티션 바리케이드',
  deskBarricade: '책상 바리케이드',
  medStation: '구급 거점'
};

export const FACILITY_COSTS: Record<FacilityType, Partial<ResourceInventory>> = {
  partitionBarricade: { chairParts: 1, partitionMaterial: 1 },
  deskBarricade: { deskParts: 2, partitionMaterial: 1 },
  medStation: { medKit: 1, deskParts: 1 }
};

export const FACILITY_HP: Record<FacilityType, number> = {
  partitionBarricade: 130,
  deskBarricade: 190,
  medStation: 120
};

export const ZOMBIE_SCORE: Record<ZombieType, number> = {
  normal: 10,
  runner: 15,
  tanker: 30
};
