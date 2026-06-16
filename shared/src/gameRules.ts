import type { Facility, FacilityType, ResourceInventory, ResourceType, Vec2, Wall, ZombieType } from './types.js';

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
  partitionMaterial: '사용 시 이동 방향 뒤쪽에 임시 바리케이드를 전개합니다.',
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
