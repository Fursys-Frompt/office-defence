import type {
  Facility,
  FacilityType,
  ResourceInventory,
  ResourceType,
  SupportEquipmentType,
  Vec2,
  Wall,
  WeaponType,
  ZombieType
} from './types.js';

export const resourceKeys: ResourceType[] = [
  'partitionMaterial',
  'mixCoffee',
  'keycapSet',
  'paperBundle',
  'officeMotor',
  'batteryPack',
  'rubberPart',
  'approvalKit'
];

export const usableResourceKeys: ResourceType[] = ['mixCoffee', 'partitionMaterial'];
export const craftMaterialKeys: ResourceType[] = ['keycapSet', 'paperBundle', 'officeMotor', 'batteryPack', 'rubberPart', 'approvalKit'];

export const facilityKeys: FacilityType[] = ['partitionBarricade', 'deskBarricade', 'medStation'];

export const weaponKeys: WeaponType[] = ['keyboardShotgun', 'printerCannon', 'plunger', 'corporateCardBoomerang', 'guardFlashlight'];
export const supportEquipmentKeys: SupportEquipmentType[] = ['robotVacuumDrone', 'mzKeycap', 'annualLeaveShield', 'emergencyAed'];

export const RESOURCE_LABELS: Record<ResourceType, string> = {
  partitionMaterial: '파티션',
  mixCoffee: '믹스커피',
  keycapSet: '키캡',
  paperBundle: '문서',
  officeMotor: '모터',
  batteryPack: '배터리',
  rubberPart: '고무',
  approvalKit: '결재'
};

export const EQUIPMENT_LABELS: Record<ResourceType, string> = {
  partitionMaterial: '방어 전개',
  mixCoffee: '소모 회복',
  keycapSet: '제작 재료',
  paperBundle: '제작 재료',
  officeMotor: '제작 재료',
  batteryPack: '제작 재료',
  rubberPart: '제작 재료',
  approvalKit: '제작 재료'
};

export const EQUIPMENT_DESCRIPTIONS: Record<ResourceType, string> = {
  partitionMaterial: '사용 시 이동 방향 뒤쪽에 임시 바리케이드를 전개합니다.',
  mixCoffee: '사용 시 체력을 회복합니다.',
  keycapSet: '키보드 샷건과 MZ의 키캡 제작에 사용합니다.',
  paperBundle: '프린터 캐논과 연차 신청서 방패 제작에 사용합니다.',
  officeMotor: '발사 장치와 로봇청소기 드론 제작에 사용합니다.',
  batteryPack: '전원이 필요한 장비 제작에 사용합니다.',
  rubberPart: '뚫어뻥 제작에 사용합니다.',
  approvalKit: '법인카드 부메랑과 방어 장비 제작에 사용합니다.'
};

export const FACILITY_LABELS: Record<FacilityType, string> = {
  partitionBarricade: '파티션 바리케이드',
  deskBarricade: '책상 바리케이드',
  medStation: '탕비 거점'
};

export const FACILITY_COSTS: Record<FacilityType, Partial<ResourceInventory>> = {
  partitionBarricade: { partitionMaterial: 1, paperBundle: 1 },
  deskBarricade: { paperBundle: 2, rubberPart: 1 },
  medStation: { mixCoffee: 1, paperBundle: 1 }
};

export const WEAPON_LABELS: Record<WeaponType, string> = {
  keyboardShotgun: '키보드 샷건',
  printerCannon: '프린터 캐논',
  plunger: '뚫어뻥',
  corporateCardBoomerang: '법인카드 부메랑',
  guardFlashlight: '경비아저씨의 손전등'
};

export const SUPPORT_EQUIPMENT_LABELS: Record<SupportEquipmentType, string> = {
  robotVacuumDrone: '로봇청소기 드론',
  mzKeycap: 'MZ의 키캡',
  annualLeaveShield: '연차 신청서 방패',
  emergencyAed: '비상 AED'
};

export const WEAPON_COSTS: Record<WeaponType, Partial<ResourceInventory>> = {
  keyboardShotgun: { keycapSet: 3, officeMotor: 1 },
  printerCannon: { paperBundle: 3, officeMotor: 1 },
  plunger: { rubberPart: 3 },
  corporateCardBoomerang: { approvalKit: 2 },
  guardFlashlight: { batteryPack: 2, approvalKit: 1 }
};

export const SUPPORT_EQUIPMENT_COSTS: Record<SupportEquipmentType, Partial<ResourceInventory>> = {
  robotVacuumDrone: { officeMotor: 1, batteryPack: 2 },
  mzKeycap: { keycapSet: 2, batteryPack: 1 },
  annualLeaveShield: { paperBundle: 2, partitionMaterial: 1, approvalKit: 1 },
  emergencyAed: { mixCoffee: 1, batteryPack: 2, officeMotor: 1, rubberPart: 1, approvalKit: 1 }
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

export type PartitionPlacement = {
  valid: boolean;
  position: Vec2;
  width: number;
  height: number;
};

const PARTITION_THICKNESS = 26;
const PARTITION_BASE_LENGTH = 118;
const PARTITION_LENGTH_PER_LEVEL = 18;
const PARTITION_PLAYER_GAP = 54;
const PARTITION_MAX_EXTRA_DISTANCE = 176;
const PARTITION_STEP = 8;
const PARTITION_PERPENDICULAR_OFFSETS = [0, -16, 16, -32, 32, -48, 48, -64, 64];

export function getPartitionPlacement(
  playerPosition: Vec2,
  aim: Vec2,
  partitionLevel: number,
  walls: Wall[],
  facilities: Pick<Facility, 'type' | 'position' | 'width' | 'height'>[]
): PartitionPlacement {
  const forward = normalizeVec(aim);
  const direction = lengthVec(forward) > 0 ? forward : { x: 1, y: 0 };
  const horizontalAim = Math.abs(direction.x) >= Math.abs(direction.y);
  const barrierLength = PARTITION_BASE_LENGTH + Math.max(0, partitionLevel) * PARTITION_LENGTH_PER_LEVEL;
  const width = horizontalAim ? PARTITION_THICKNESS : barrierLength;
  const height = horizontalAim ? barrierLength : PARTITION_THICKNESS;
  const sign = -(horizontalAim ? Math.sign(direction.x || 1) : Math.sign(direction.y || 1));
  const baseDistance = (horizontalAim ? width : height) / 2 + PARTITION_PLAYER_GAP;
  let fallback = makePartitionCandidate(playerPosition, horizontalAim, sign, baseDistance, 0, width, height);
  let best: PartitionPlacement | undefined;

  for (let extra = 0; extra <= PARTITION_MAX_EXTRA_DISTANCE; extra += PARTITION_STEP) {
    for (const offset of PARTITION_PERPENDICULAR_OFFSETS) {
      const candidate = makePartitionCandidate(playerPosition, horizontalAim, sign, baseDistance + extra, offset, width, height);
      fallback = extra === 0 && offset === 0 ? candidate : fallback;
      if (partitionCollides(candidate, walls, facilities)) continue;
      const score = extra + Math.abs(offset) * 1.45;
      if (!best || score < placementScore(playerPosition, best, horizontalAim, sign, baseDistance)) best = candidate;
    }
  }

  return best ?? { ...fallback, valid: false };
}

function makePartitionCandidate(
  playerPosition: Vec2,
  horizontalAim: boolean,
  sign: number,
  distance: number,
  perpendicularOffset: number,
  width: number,
  height: number
): PartitionPlacement {
  return {
    valid: true,
    position: {
      x: playerPosition.x + (horizontalAim ? sign * distance : perpendicularOffset),
      y: playerPosition.y + (horizontalAim ? perpendicularOffset : sign * distance)
    },
    width,
    height
  };
}

function placementScore(
  playerPosition: Vec2,
  placement: PartitionPlacement,
  horizontalAim: boolean,
  sign: number,
  baseDistance: number
) {
  const forwardDistance = horizontalAim
    ? (placement.position.x - playerPosition.x) * sign
    : (placement.position.y - playerPosition.y) * sign;
  const perpendicularOffset = horizontalAim
    ? placement.position.y - playerPosition.y
    : placement.position.x - playerPosition.x;
  return Math.max(0, forwardDistance - baseDistance) + Math.abs(perpendicularOffset) * 1.45;
}

function partitionCollides(
  placement: PartitionPlacement,
  walls: Wall[],
  facilities: Pick<Facility, 'type' | 'position' | 'width' | 'height'>[]
) {
  const rect = rectFromPlacement(placement);
  return walls.some((wall) => rectsOverlap(rect, wall)) || facilities.some((facility) => {
    if (facility.type === 'medStation') return false;
    return rectsOverlap(rect, rectFromFacility(facility));
  });
}

function rectFromPlacement(placement: Pick<PartitionPlacement, 'position' | 'width' | 'height'>): Wall {
  return {
    x: placement.position.x - placement.width / 2,
    y: placement.position.y - placement.height / 2,
    width: placement.width,
    height: placement.height
  };
}

function rectFromFacility(facility: Pick<Facility, 'position' | 'width' | 'height'>): Wall {
  const width = facility.width ?? 56;
  const height = facility.height ?? 56;
  return {
    x: facility.position.x - width / 2,
    y: facility.position.y - height / 2,
    width,
    height
  };
}

function rectsOverlap(a: Wall, b: Wall) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function normalizeVec(vector: Vec2): Vec2 {
  const size = lengthVec(vector);
  if (size <= 0.001) return { x: 0, y: 0 };
  return { x: vector.x / size, y: vector.y / size };
}

function lengthVec(vector: Vec2) {
  return Math.hypot(vector.x, vector.y);
}
