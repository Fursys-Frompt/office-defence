import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  CraftingStation,
  DayNightPhase,
  Facility,
  FacilityType,
  FeedbackEvent,
  GameDifficulty,
  GameMode,
  GamePhase,
  GameSnapshot,
  MapTheme,
  Player,
  PlayerInput,
  ResourceInventory,
  ResourceNode,
  ResourceType,
  RoomSummary,
  RoomSettings,
  ServerToClientEvents,
  SpawnWarning,
  SupportEquipmentType,
  SupportZone,
  UpgradeOption,
  UpgradeType,
  Vec2,
  WavePhase,
  Wall,
  WeaponType,
  Zombie,
  ZombieType
} from '../../shared/src/types.js';
import {
  FACILITY_COSTS,
  FACILITY_HP,
  SUPPORT_EQUIPMENT_COSTS,
  WEAPON_COSTS,
  ZOMBIE_SCORE,
  craftMaterialKeys,
  getPartitionPlacement
} from '../../shared/src/gameRules.js';

type Room = {
  id: string;
  title: string;
  phase: GamePhase;
  settings: RoomSettings;
  players: Map<string, Player>;
  results: Player[];
  inputs: Map<string, PlayerInput>;
  processedItemRequests: Map<string, number>;
  processedCraftRequests: Map<string, number>;
  processedSupportRequests: Map<string, number>;
  zombies: Zombie[];
  spawnWarnings: SpawnWarning[];
  resources: ResourceNode[];
  craftingStations: CraftingStation[];
  facilities: Facility[];
  powerZones: GameSnapshot['powerZones'];
  supportZones: SupportZone[];
  projectiles: GameSnapshot['projectiles'];
  feedbackEvents: Array<FeedbackEvent & { ttl: number }>;
  wave: number;
  wavePhase: WavePhase;
  waveTimer: number;
  countdown: number;
  remainingSec: number;
  endedElapsedSec: number;
  map: {
    width: number;
    height: number;
    name: string;
    theme: MapTheme;
  };
  startedAt: number;
  lastWaveAt: number;
  nextZombieSpawnAt: number;
  nextResourceSpawnAt: number;
  recentDamage: Map<string, { amount: number; lastAt: number }>;
  nextReliefSupplyAt: number;
  killTargetReachedAt: Map<string, number>;
  playerRespawnAt: Map<string, number>;
  walls: Wall[];
  wallHp: Map<string, number>;
};

type DirectorState = {
  aliveCount: number;
  playerScale: number;
  relief: number;
  earlyEase: number;
  lowestHpRatio: number;
  recentDamage: number;
};

type DifficultyTuning = {
  spawnCount: number;
  zombieCap: number;
  spawnDelay: number;
  zombieHp: number;
  zombieDamage: number;
};

const app = express();
const server = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: { origin: '*' }
});

const PORT = Number(process.env.PORT ?? 3000);
const MAP_WIDTH = 1600;
const MAP_HEIGHT = 1000;
const TICK_RATE = 20;
const DT = 1 / TICK_RATE;
const PLAYER_RADIUS = 18;
const ZOMBIE_RADIUS = 16;
const RESOURCE_RADIUS = 16;
const FACILITY_RADIUS = 28;
const PROJECTILE_RADIUS = 5;
const PROJECTILE_SPEED = 700;
const CRAFTING_STATION_RADIUS = 112;
const BASE_ATTACK_RANGE = 360;
const POWER_ZONE_RADIUS = 145;
const POWER_ZONE_TTL = 8;
const POWER_ZONE_DAMAGE_BONUS = 0.35;
const POWER_ZONE_RANGE_BONUS = 110;
const ZOMBIE_SPAWN_WARNING_SEC = 1.25;
const DAY_NIGHT_CYCLE_SEC = 90;
const SUPPLY_CACHE_HP = 900;
const SUPPLY_DEFENSE_RESPAWN_SEC = 5;
const MAX_CRAFT_LEVEL = 5;
const DIFFICULTY_TUNING: Record<GameDifficulty, DifficultyTuning> = {
  easy: {
    spawnCount: 0.78,
    zombieCap: 0.82,
    spawnDelay: 1.18,
    zombieHp: 0.86,
    zombieDamage: 0.75
  },
  normal: {
    spawnCount: 1,
    zombieCap: 1,
    spawnDelay: 1,
    zombieHp: 1,
    zombieDamage: 1
  },
  hard: {
    spawnCount: 1.22,
    zombieCap: 1.18,
    spawnDelay: 0.86,
    zombieHp: 1.16,
    zombieDamage: 1.25
  }
};
const RESOURCE_DROP_WEIGHTS: Array<{ type: ResourceType; weight: number }> = [
  { type: 'partitionMaterial', weight: 22 },
  { type: 'mixCoffee', weight: 12 },
  { type: 'keycapSet', weight: 13 },
  { type: 'paperBundle', weight: 15 },
  { type: 'officeMotor', weight: 11 },
  { type: 'batteryPack', weight: 11 },
  { type: 'rubberPart', weight: 9 },
  { type: 'approvalKit', weight: 7 }
];
const RECOVERY_DROP_BONUS: Array<{ type: ResourceType; weight: number }> = [
  { type: 'mixCoffee', weight: 18 },
  { type: 'partitionMaterial', weight: 10 }
];
const RELIEF_SUPPLY_DROP_BONUS: Array<{ type: ResourceType; weight: number }> = [
  { type: 'mixCoffee', weight: 16 },
  { type: 'partitionMaterial', weight: 14 }
];
const DEFAULT_SETTINGS: RoomSettings = {
  maxPlayers: 6,
  gameMode: 'timedSurvival',
  difficulty: 'normal',
  gameDurationSec: 180,
  killTarget: 100,
  pvpEnabled: false
};

type MapPreset = {
  name: string;
  theme: MapTheme;
  width: number;
  height: number;
  walls: Wall[];
  initialResources: number;
  resourceLimit: number;
};
const DEFAULT_ROOM_TITLE = '생존 방';
const LEVEL_KILL_THRESHOLDS = [3, 7, 12, 18, 25, 33, 42, 52];
const MAX_PENDING_UPGRADES = 2;
const UPGRADE_POOL: Array<Omit<UpgradeOption, 'id'>> = [
  { type: 'range', title: '시야 확보', description: '모든 무기 사거리가 10% 증가합니다.' },
  { type: 'damage', title: '집중 타격', description: '기본 공격과 제작 무기 피해가 크게 증가합니다.' },
  { type: 'maxHp', title: '응급 체력', description: '최대 체력이 18 증가하고 즉시 회복합니다.' },
  { type: 'moveSpeed', title: '동선 숙달', description: '이동 속도가 7% 증가합니다.' },
  { type: 'coffee', title: '카페인 충전', description: '믹스커피 회복량이 증가하고 즉시 조금 회복합니다.' },
  { type: 'partition', title: '파티션 전개', description: '파티션 바리케이드 길이와 내구도가 증가합니다.' },
  { type: 'supply', title: '긴급 보급', description: '랜덤 제작 재료 3개를 즉시 획득합니다.' },
  { type: 'nightMove', title: '야간 적응', description: '밤이 깊을수록 이동 속도가 증가합니다.' },
  { type: 'resourceSense', title: '자원 감각', description: '자원 수집 반경이 증가합니다.' },
  { type: 'partitionReinforce', title: '튼튼한 파티션', description: '설치하는 파티션 내구도가 크게 증가합니다.' },
  { type: 'finisher', title: '마무리 일격', description: '체력이 낮은 좀비에게 주는 피해가 증가합니다.' }
];

const rooms = new Map<string, Room>();
const socketRooms = new Map<string, string>();
const killTimers = new Map<string, number>();
const equipmentTimers = new Map<string, number>();
const feedbackTimers = new Map<string, number>();
const zombieAiTimers = new Map<string, {
  nextSpecialAt: number;
  dashUntil: number;
  dashDirection: Vec2;
  leapCooldownUntil: number;
}>();

function boundaryWalls(width: number, height: number): Wall[] {
  return [
    { x: 0, y: 0, width, height: 24 },
    { x: 0, y: height - 24, width, height: 24 },
    { x: 0, y: 0, width: 24, height },
    { x: width - 24, y: 0, width: 24, height }
  ];
}

const MAP_PRESETS: Record<GameMode, MapPreset> = {
  timedSurvival: {
    name: '분할 사무실',
    theme: 'officeGrid',
    width: 1600,
    height: 1000,
    initialResources: 14,
    resourceLimit: 24,
    walls: [
    ...boundaryWalls(1600, 1000),
    { x: 360, y: 120, width: 22, height: 360 },
    { x: 680, y: 0, width: 22, height: 300 },
    { x: 980, y: 190, width: 22, height: 360 },
    { x: 1200, y: 560, width: 22, height: 320 },
    { x: 220, y: 650, width: 420, height: 22 },
    { x: 720, y: 520, width: 500, height: 22 },
    { x: 1100, y: 120, width: 300, height: 22 }
    ]
  },
  endless: {
    name: '순환 복도',
    theme: 'serviceLoop',
    width: 1800,
    height: 1080,
    initialResources: 18,
    resourceLimit: 30,
    walls: [
    ...boundaryWalls(1800, 1080),
    { x: 260, y: 170, width: 22, height: 320 },
    { x: 260, y: 590, width: 22, height: 320 },
    { x: 610, y: 120, width: 22, height: 270 },
    { x: 610, y: 690, width: 22, height: 270 },
    { x: 960, y: 120, width: 22, height: 270 },
    { x: 960, y: 690, width: 22, height: 270 },
    { x: 1310, y: 120, width: 22, height: 270 },
    { x: 1310, y: 690, width: 22, height: 270 },
    { x: 430, y: 520, width: 320, height: 22 },
    { x: 900, y: 520, width: 320, height: 22 },
    { x: 1370, y: 520, width: 240, height: 22 }
    ]
  },
  killTarget: {
    name: '중앙 교전 구역',
    theme: 'killArena',
    width: 1500,
    height: 1100,
    initialResources: 10,
    resourceLimit: 18,
    walls: [
    ...boundaryWalls(1500, 1100),
    { x: 210, y: 150, width: 360, height: 24 },
    { x: 930, y: 150, width: 360, height: 24 },
    { x: 210, y: 926, width: 360, height: 24 },
    { x: 930, y: 926, width: 360, height: 24 },
    { x: 390, y: 320, width: 24, height: 460 },
    { x: 1086, y: 320, width: 24, height: 460 },
    { x: 610, y: 430, width: 280, height: 24 },
    { x: 610, y: 646, width: 280, height: 24 },
    { x: 720, y: 260, width: 60, height: 130 },
    { x: 720, y: 710, width: 60, height: 130 }
    ]
  },
  supplyDefense: {
    name: '물자 방어 구역',
    theme: 'killArena',
    width: 1500,
    height: 1100,
    initialResources: 16,
    resourceLimit: 26,
    walls: [
    ...boundaryWalls(1500, 1100),
    { x: 210, y: 150, width: 360, height: 24 },
    { x: 930, y: 150, width: 360, height: 24 },
    { x: 210, y: 926, width: 360, height: 24 },
    { x: 930, y: 926, width: 360, height: 24 },
    { x: 390, y: 320, width: 24, height: 220 },
    { x: 390, y: 640, width: 24, height: 220 },
    { x: 1086, y: 320, width: 24, height: 220 },
    { x: 1086, y: 640, width: 24, height: 220 },
    { x: 560, y: 410, width: 170, height: 24 },
    { x: 770, y: 666, width: 170, height: 24 }
    ]
  }
};

const MODE_LABELS: Record<GameMode, string> = {
  timedSurvival: '제한시간 생존',
  endless: '무제한 생존',
  killTarget: '좀비 처치 목표',
  supplyDefense: '물자 지키기'
};

function createRoom(id: string, settings?: Partial<RoomSettings>, title?: string): Room {
  const sanitizedSettings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...settings });
  return {
    id,
    title: sanitizeRoomTitle(title),
    phase: 'lobby',
    settings: sanitizedSettings,
    players: new Map(),
    results: [],
  inputs: new Map(),
  processedItemRequests: new Map(),
  processedCraftRequests: new Map(),
  processedSupportRequests: new Map(),
  zombies: [],
  spawnWarnings: [],
  resources: [],
  craftingStations: [],
  facilities: [],
  powerZones: [],
  supportZones: [],
    projectiles: [],
    feedbackEvents: [],
    wave: 1,
    wavePhase: 'combat',
    waveTimer: DAY_NIGHT_CYCLE_SEC,
    countdown: 0,
    remainingSec: sanitizedSettings.gameMode === 'endless' ? 0 : sanitizedSettings.gameDurationSec,
    endedElapsedSec: 0,
    map: mapForMode(sanitizedSettings.gameMode),
    startedAt: 0,
    lastWaveAt: 0,
    nextZombieSpawnAt: 0,
    nextResourceSpawnAt: 0,
    recentDamage: new Map(),
    nextReliefSupplyAt: 0,
  killTargetReachedAt: new Map(),
    playerRespawnAt: new Map(),
    walls: wallsForMode(sanitizedSettings.gameMode),
    wallHp: new Map()
  };
}

function sanitizeSettings(settings: Partial<RoomSettings>): RoomSettings {
  const gameMode = isGameMode(settings.gameMode) ? settings.gameMode : DEFAULT_SETTINGS.gameMode;
  const difficulty = isGameDifficulty(settings.difficulty) ? settings.difficulty : DEFAULT_SETTINGS.difficulty;
  return {
    maxPlayers: clamp(Math.round(settings.maxPlayers ?? DEFAULT_SETTINGS.maxPlayers), 2, 8),
    gameMode,
    difficulty,
    gameDurationSec: clamp(Math.round(settings.gameDurationSec ?? DEFAULT_SETTINGS.gameDurationSec), 60, 600),
    killTarget: clamp(Math.round(settings.killTarget ?? DEFAULT_SETTINGS.killTarget), 10, 1000),
    pvpEnabled: Boolean(settings.pvpEnabled)
  };
}

function isGameMode(value: unknown): value is GameMode {
  return value === 'timedSurvival' || value === 'endless' || value === 'killTarget' || value === 'supplyDefense';
}

function isGameDifficulty(value: unknown): value is GameDifficulty {
  return value === 'easy' || value === 'normal' || value === 'hard';
}

function wallsForMode(mode: GameMode) {
  return MAP_PRESETS[mode].walls.map((wall) => ({ ...wall }));
}

function mapForMode(mode: GameMode) {
  const preset = MAP_PRESETS[mode];
  return {
    width: preset.width,
    height: preset.height,
    name: preset.name,
    theme: preset.theme
  };
}

function craftingStationsForMode(mode: GameMode): CraftingStation[] {
  const map = mapForMode(mode);
  const baseStations = mode === 'endless'
    ? [
        { x: 420, y: 210 },
        { x: map.width - 420, y: map.height - 210 }
      ]
    : mode === 'killTarget' || mode === 'supplyDefense'
      ? [
          { x: 300, y: 250 },
          { x: map.width - 300, y: map.height - 250 }
        ]
      : [
          { x: 260, y: 210 },
          { x: 940, y: 820 },
          { x: 1340, y: 780 }
        ];
  return baseStations.map((position, index) => ({
    id: `craft_${mode}_${index}`,
    position,
    width: 118,
    height: 78,
    interactionRadius: CRAFTING_STATION_RADIUS
  }));
}

function sanitizeRoomTitle(title?: string) {
  const sanitized = title?.trim().replace(/\s+/g, ' ').slice(0, 24);
  return sanitized || DEFAULT_ROOM_TITLE;
}

function makeRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function createPlayer(id: string, nickname: string, host: boolean, avatarId = 0): Player {
  return {
    id,
    nickname: nickname.trim().slice(0, 16) || 'Survivor',
    avatarId: sanitizeAvatarId(avatarId),
    ready: false,
    host,
    alive: true,
    hp: 100,
    maxHp: 100,
    position: randomFreePosition(),
    aim: { x: 1, y: 0 },
    score: 0,
    kills: 0,
    combo: 0,
    level: 1,
    nextLevelKills: LEVEL_KILL_THRESHOLDS[0],
    pendingUpgradeChoices: [],
    pendingUpgradeCount: 0,
    upgrades: emptyUpgrades(),
    inventory: emptyInventory(),
    craftedWeapons: [],
    weaponLevels: {},
    equippedWeapon: undefined,
    craftedSupportEquipment: [],
    supportEquipmentLevels: {},
    equippedSupportEquipment: undefined,
    activeSupportEquipment: undefined,
    supportExpiresAt: undefined,
    resourcesCollected: 0,
    facilitiesBuilt: 0,
    survivalSec: 0
  };
}

function emptyInventory(): ResourceInventory {
  return {
    partitionMaterial: 0,
    mixCoffee: 0,
    keycapSet: 0,
    paperBundle: 0,
    officeMotor: 0,
    batteryPack: 0,
    rubberPart: 0,
    approvalKit: 0
  };
}

function sanitizeAvatarId(avatarId: number) {
  return clamp(Math.round(Number.isFinite(avatarId) ? avatarId : 0), 0, 3);
}

function randomFreePosition(activeWalls: Wall[] = MAP_PRESETS.timedSurvival.walls, map = mapForMode('timedSurvival')): Vec2 {
  for (let i = 0; i < 80; i += 1) {
    const point = {
      x: 80 + Math.random() * (map.width - 160),
      y: 80 + Math.random() * (map.height - 160)
    };
    if (!collidesWithWalls(point, PLAYER_RADIUS, activeWalls)) return point;
  }
  return { x: 120, y: 120 };
}

function snapshot(room: Room): GameSnapshot {
  const elapsedSec = elapsedSeconds(room);
  return {
    roomId: room.id,
    roomTitle: room.title,
    phase: room.phase,
    settings: room.settings,
    players: [...room.players.values()],
    results: room.results,
    zombies: room.zombies,
    spawnWarnings: room.spawnWarnings,
    resources: room.resources,
    craftingStations: room.craftingStations,
    facilities: room.facilities,
    powerZones: room.powerZones,
    supportZones: room.supportZones,
    projectiles: room.projectiles,
    walls: room.walls,
    feedbackEvents: room.feedbackEvents.map(({ ttl: _ttl, ...event }) => event),
    wave: room.wave,
    wavePhase: room.wavePhase,
    waveTimeRemaining: Math.max(0, Math.ceil(room.waveTimer)),
    dayNightProgress: dayNightProgress(elapsedSec),
    nightIntensity: nightIntensity(elapsedSec),
    dayNightPhase: dayNightPhase(elapsedSec),
    countdown: Math.ceil(room.countdown),
    remainingSec: room.settings.gameMode === 'endless' ? 0 : Math.max(0, Math.ceil(room.remainingSec)),
    elapsedSec: Math.max(0, Math.floor(elapsedSec)),
    objective: objectiveState(room, elapsedSec),
    map: room.map
  };
}

function broadcast(room: Room) {
  io.to(room.id).emit('snapshot', snapshot(room));
}

function elapsedSeconds(room: Room) {
  if (room.phase !== 'playing' && room.phase !== 'paused' && room.phase !== 'ended') return 0;
  if (room.phase === 'ended') return room.endedElapsedSec;
  if (room.settings.gameMode === 'timedSurvival') return room.settings.gameDurationSec - room.remainingSec;
  return Math.max(0, (Date.now() - room.startedAt) / 1000);
}

function dayNightProgress(elapsed: number) {
  return ((elapsed % DAY_NIGHT_CYCLE_SEC) + DAY_NIGHT_CYCLE_SEC) % DAY_NIGHT_CYCLE_SEC / DAY_NIGHT_CYCLE_SEC;
}

function nightIntensity(elapsed: number) {
  const progress = dayNightProgress(elapsed);
  return clamp((1 - Math.cos(progress * Math.PI * 2)) / 2, 0, 1);
}

function dayNightPhase(elapsed: number): DayNightPhase {
  const progress = dayNightProgress(elapsed);
  if (progress < 0.22 || progress >= 0.9) return 'day';
  if (progress < 0.42) return 'dusk';
  if (progress < 0.72) return 'night';
  return 'dawn';
}

function leadingPlayerKills(room: Room) {
  let kills = 0;
  for (const player of room.players.values()) kills = Math.max(kills, player.kills);
  return kills;
}

function objectiveState(room: Room, elapsed: number): GameSnapshot['objective'] {
  const aliveCount = [...room.players.values()].filter((player) => player.alive).length;
  const failed = room.phase === 'ended' && aliveCount === 0;
  if (room.settings.gameMode === 'endless') {
    return {
      mode: room.settings.gameMode,
      label: MODE_LABELS.endless,
      current: Math.floor(elapsed),
      completed: false,
      failed
    };
  }
  if (room.settings.gameMode === 'killTarget') {
    const kills = leadingPlayerKills(room);
    return {
      mode: room.settings.gameMode,
      label: MODE_LABELS.killTarget,
      current: kills,
      target: room.settings.killTarget,
      completed: hasKillTargetWinner(room),
      failed
    };
  }
  if (room.settings.gameMode === 'supplyDefense') {
    return {
      mode: room.settings.gameMode,
      label: MODE_LABELS.supplyDefense,
      current: Math.min(room.settings.gameDurationSec, Math.floor(elapsed)),
      target: room.settings.gameDurationSec,
      completed: room.remainingSec <= 0 && supplyCacheHp(room) > 0,
      failed: supplyCacheHp(room) <= 0
    };
  }
  return {
    mode: room.settings.gameMode,
    label: MODE_LABELS.timedSurvival,
    current: Math.min(room.settings.gameDurationSec, Math.floor(elapsed)),
    target: room.settings.gameDurationSec,
    completed: room.remainingSec <= 0,
    failed
  };
}

function shouldEndGame(room: Room) {
  const aliveCount = [...room.players.values()].filter((player) => player.alive).length;
  if (room.settings.gameMode === 'supplyDefense') return room.remainingSec <= 0 || supplyCacheHp(room) <= 0;
  if (aliveCount === 0) return true;
  if (room.settings.gameMode === 'timedSurvival') return room.remainingSec <= 0;
  if (room.settings.gameMode === 'killTarget') return hasKillTargetWinner(room);
  return false;
}

function hasKillTargetWinner(room: Room) {
  return room.killTargetReachedAt.size > 0 || [...room.players.values()].some((player) => player.kills >= room.settings.killTarget);
}

function emptyUpgrades() {
  return {
    range: 0,
    damage: 0,
    maxHp: 0,
    moveSpeed: 0,
    coffee: 0,
    partition: 0,
    supply: 0,
    nightMove: 0,
    resourceSense: 0,
    partitionReinforce: 0,
    finisher: 0
  };
}

function roomSummaries(): RoomSummary[] {
  return [...rooms.values()]
    .filter((room) => room.phase === 'lobby')
    .map((room) => {
      const players = [...room.players.values()];
      const host = players.find((player) => player.host) ?? players[0];
      return {
        roomId: room.id,
        roomTitle: room.title,
        phase: room.phase,
        playerCount: players.length,
        maxPlayers: room.settings.maxPlayers,
        readyCount: players.filter((player) => player.ready).length,
        gameMode: room.settings.gameMode,
        difficulty: room.settings.difficulty,
        gameDurationSec: room.settings.gameDurationSec,
        killTarget: room.settings.killTarget,
        pvpEnabled: room.settings.pvpEnabled,
        hostNickname: host?.nickname ?? 'Host'
      };
    })
    .sort((a, b) => a.roomId.localeCompare(b.roomId));
}

function broadcastRoomList() {
  io.emit('roomList', roomSummaries());
}

function startCountdown(room: Room) {
  room.phase = 'countdown';
  room.countdown = 3;
  broadcastRoomList();
}

function startGame(room: Room) {
  room.phase = 'playing';
  room.wave = 1;
  room.wavePhase = 'combat';
  room.waveTimer = DAY_NIGHT_CYCLE_SEC;
  room.remainingSec = room.settings.gameMode === 'endless' ? 0 : room.settings.gameDurationSec;
  room.endedElapsedSec = 0;
  room.startedAt = Date.now();
  room.lastWaveAt = 0;
  room.nextZombieSpawnAt = 2.2;
  room.nextResourceSpawnAt = 0;
  room.recentDamage = new Map();
  room.nextReliefSupplyAt = 18;
  room.killTargetReachedAt = new Map();
  room.playerRespawnAt = new Map();
  clearZombieAiTimers(room);
  room.zombies = [];
  room.spawnWarnings = [];
  room.processedItemRequests = new Map();
  room.processedCraftRequests = new Map();
  room.processedSupportRequests = new Map();
  room.projectiles = [];
  room.facilities = [];
  room.powerZones = [];
  room.supportZones = [];
  room.results = [];
  room.feedbackEvents = [];
  room.map = mapForMode(room.settings.gameMode);
  room.walls = wallsForMode(room.settings.gameMode);
  room.wallHp = new Map();
  room.craftingStations = craftingStationsForMode(room.settings.gameMode);
  if (room.settings.gameMode === 'supplyDefense') room.facilities.push(createSupplyCache(room));
  room.resources = Array.from({ length: MAP_PRESETS[room.settings.gameMode].initialResources }, () => createResource(room));
  for (const player of room.players.values()) {
    killTimers.delete(comboKey(room, player.id));
    clearEquipmentTimers(room, player.id);
    clearFeedbackTimers(room, player.id);
    player.ready = false;
    player.alive = true;
    player.hp = 100;
    player.maxHp = 100;
    player.position = randomFreePosition(room.walls, room.map);
    player.score = 0;
    player.kills = 0;
    player.combo = 0;
    player.level = 1;
    player.nextLevelKills = LEVEL_KILL_THRESHOLDS[0];
    player.pendingUpgradeChoices = [];
    player.pendingUpgradeCount = 0;
    player.upgrades = emptyUpgrades();
    player.inventory = emptyInventory();
    player.craftedWeapons = [];
    player.weaponLevels = {};
    player.equippedWeapon = undefined;
    player.craftedSupportEquipment = [];
    player.supportEquipmentLevels = {};
    player.equippedSupportEquipment = undefined;
    player.activeSupportEquipment = undefined;
    player.supportExpiresAt = undefined;
    player.resourcesCollected = 0;
    player.facilitiesBuilt = 0;
    player.survivalSec = 0;
  }
}

function endGame(room: Room) {
  room.endedElapsedSec = elapsedSeconds(room);
  room.phase = 'ended';
  const alive = [...room.players.values()].filter((player) => player.alive);
  if (alive.length === 1) alive[0].score += 50;
  room.results = [...room.players.values()]
    .map((player) => ({ ...player, inventory: { ...player.inventory }, position: { ...player.position }, aim: { ...player.aim } }))
    .sort((a, b) => compareResults(room, a, b));
}

function compareResults(room: Room, a: Player, b: Player) {
  if (room.settings.gameMode === 'killTarget') {
    const aReachedAt = room.killTargetReachedAt.get(a.id);
    const bReachedAt = room.killTargetReachedAt.get(b.id);
    if (aReachedAt !== undefined || bReachedAt !== undefined) {
      if (aReachedAt === undefined) return 1;
      if (bReachedAt === undefined) return -1;
      if (aReachedAt !== bReachedAt) return aReachedAt - bReachedAt;
    }
    if (a.kills !== b.kills) return b.kills - a.kills;
  }
  if (a.score !== b.score) return b.score - a.score;
  if (a.kills !== b.kills) return b.kills - a.kills;
  return b.survivalSec - a.survivalSec;
}

function tickRoom(room: Room) {
  if (room.phase === 'lobby') return;
  if (room.phase === 'paused') return;

  if (room.phase === 'countdown') {
    room.countdown -= DT;
    if (room.countdown <= 0) startGame(room);
    return;
  }

  if (room.phase !== 'playing') return;

  if (room.settings.gameMode !== 'endless') room.remainingSec -= DT;
  const elapsed = elapsedSeconds(room);
  updateDayNightCycle(room, elapsed);
  updatePowerZones(room);
  updatePlayers(room, elapsed);
  updateRespawns(room, elapsed);
  updateProjectiles(room);
  updateZombies(room);
  spawnWorld(room, elapsed);
  updateFeedbackEvents(room);
  applySurvivalScore(room, elapsed);

  if (shouldEndGame(room)) endGame(room);
}

function updateDayNightCycle(room: Room, elapsed: number) {
  const cycle = Math.floor(elapsed / DAY_NIGHT_CYCLE_SEC) + 1;
  const previousCycle = room.wave;
  room.wave = cycle;
  room.wavePhase = 'combat';
  room.waveTimer = DAY_NIGHT_CYCLE_SEC - (elapsed % DAY_NIGHT_CYCLE_SEC);
  if (cycle > previousCycle) {
    room.nextZombieSpawnAt = Math.min(room.nextZombieSpawnAt, 0.8);
    pushFeedback(room, 'build', { x: room.map.width / 2, y: room.map.height / 2 }, '새 하루', 0.2);
  }
}

function updatePlayers(room: Room, elapsed: number) {
  for (const player of room.players.values()) {
    const input = room.inputs.get(player.id);
    if (!input) continue;

    const move = normalize(input.move);
    const speed = player.alive ? playerMoveSpeed(player, elapsed) : 255;
    player.position = movePlayerWithSlide(room, player.position, move, speed);
    const aim = normalize(input.aim);
    if (length(aim) > 0) player.aim = aim;

    if (!player.alive) continue;
    refreshCombo(room, player);

    if (input.useItem) processItemUseInput(room, player, input);
    processCraftingInput(room, player, input);
    processSupportInput(room, player, input);

    if (input.shooting && canAct(room, player.id, 'shoot', weaponCooldown(player))) {
      fireEquippedWeapon(room, player);
    }
    if (input.melee && canAct(room, player.id, 'melee', player.combo >= 4 ? 0.26 : 0.32)) {
      meleeAttack(room, player);
    }

    collectResources(room, player);
    updateEquipment(room, player, elapsed);
    updateSupportEquipment(room, player, elapsed);
  }
}

const cooldowns = new Map<string, number>();

function canAct(room: Room, playerId: string, action: string, cooldown: number) {
  const key = `${room.id}:${playerId}:${action}`;
  const now = Date.now() / 1000;
  const previous = cooldowns.get(key) ?? 0;
  if (now - previous < cooldown) return false;
  cooldowns.set(key, now);
  return true;
}

function meleeAttack(room: Room, player: Player) {
  const damage = 28 + player.upgrades.damage * 3 + comboDamageBonus(player);
  for (const zombie of room.zombies) {
    if (distance(player.position, zombie.position) < 54) damageZombie(room, zombie, damage, player.id);
  }
  if (!room.settings.pvpEnabled) return;
  for (const target of room.players.values()) {
    if (target.id !== player.id && target.alive && distance(player.position, target.position) < 44) {
      damagePlayer(room, target, 20 + comboDamageBonus(player), player);
    }
  }
}

function processItemUseInput(room: Room, player: Player, input: PlayerInput) {
  if (!input.useItem) return;
  const requestId = input.useItemRequestId;
  if (requestId === undefined) {
    useItem(room, player, input.useItem);
    return;
  }
  const previous = room.processedItemRequests.get(player.id) ?? 0;
  if (requestId <= previous) return;
  room.processedItemRequests.set(player.id, requestId);
  useItem(room, player, input.useItem);
}

function useItem(room: Room, player: Player, type: ResourceType) {
  if (player.inventory[type] <= 0 || !canAct(room, player.id, `use:${type}`, 0.35)) return;

  if (type === 'mixCoffee') {
    if (player.hp >= player.maxHp - 1) return;
    player.inventory.mixCoffee -= 1;
    const heal = 28 + player.upgrades.coffee * 10;
    player.hp = Math.min(player.maxHp, player.hp + heal);
    pushFeedback(room, 'heal', player.position, `+${heal}`);
    return;
  }

  if (type === 'partitionMaterial') {
    if (!deployPartitionBarricades(room, player)) return;
    player.inventory.partitionMaterial -= 1;
    pushFeedback(room, 'build', player.position, '파티션');
  }
}

function processCraftingInput(room: Room, player: Player, input: PlayerInput) {
  const requestId = input.craftRequestId;
  if (requestId === undefined) return;
  const previous = room.processedCraftRequests.get(player.id) ?? 0;
  if (requestId <= previous) return;
  room.processedCraftRequests.set(player.id, requestId);
  if (input.craftWeapon) craftWeapon(room, player, input.craftWeapon);
  if (input.equipWeapon) equipWeapon(player, input.equipWeapon);
  if (input.craftSupport) craftSupportEquipment(room, player, input.craftSupport);
  if (input.equipSupport) equipSupportEquipment(player, input.equipSupport, room);
}

function processSupportInput(room: Room, player: Player, input: PlayerInput) {
  const requestId = input.supportRequestId;
  if (requestId === undefined || !input.activateSupport) return;
  const previous = room.processedSupportRequests.get(player.id) ?? 0;
  if (requestId <= previous) return;
  room.processedSupportRequests.set(player.id, requestId);
  activateSupportEquipment(room, player, input.activateSupport);
}

function craftWeapon(room: Room, player: Player, weapon: WeaponType) {
  if (!isNearCraftingStation(room, player)) return;
  const cost = WEAPON_COSTS[weapon];
  if (!cost || !hasResources(player.inventory, cost)) return;
  const currentLevel = equipmentLevel(player.weaponLevels, weapon, player.craftedWeapons.includes(weapon));
  if (currentLevel >= MAX_CRAFT_LEVEL) {
    equipWeapon(player, weapon);
    return;
  }
  spendResources(player.inventory, cost);
  if (!player.craftedWeapons.includes(weapon)) player.craftedWeapons.push(weapon);
  player.weaponLevels[weapon] = currentLevel + 1;
  player.equippedWeapon = weapon;
  pushFeedback(room, 'build', player.position, `${weaponFeedbackLabel(weapon)} +${player.weaponLevels[weapon]}`);
}

function equipWeapon(player: Player, weapon: WeaponType) {
  if (!player.craftedWeapons.includes(weapon)) return;
  player.equippedWeapon = weapon;
}

function craftSupportEquipment(room: Room, player: Player, support: SupportEquipmentType) {
  if (!isNearCraftingStation(room, player)) return;
  const cost = SUPPORT_EQUIPMENT_COSTS[support];
  if (!cost || !hasResources(player.inventory, cost)) return;
  const currentLevel = equipmentLevel(player.supportEquipmentLevels, support, player.craftedSupportEquipment.includes(support));
  if (currentLevel >= MAX_CRAFT_LEVEL) {
    equipSupportEquipment(player, support, room);
    return;
  }
  spendResources(player.inventory, cost);
  if (!player.craftedSupportEquipment.includes(support)) player.craftedSupportEquipment.push(support);
  player.supportEquipmentLevels[support] = currentLevel + 1;
  equipSupportEquipment(player, support, room);
  pushFeedback(room, 'build', player.position, `${supportFeedbackLabel(support)} +${player.supportEquipmentLevels[support]}`);
}

function equipSupportEquipment(player: Player, support: SupportEquipmentType, room?: Room) {
  if (!player.craftedSupportEquipment.includes(support)) return;
  clearUnequippedSupportEffects(player, support, room);
  player.equippedSupportEquipment = support;
}

function clearUnequippedSupportEffects(player: Player, nextSupport: SupportEquipmentType, room?: Room) {
  if (player.activeSupportEquipment && player.activeSupportEquipment !== nextSupport) {
    player.activeSupportEquipment = undefined;
    player.supportExpiresAt = undefined;
  }
  if (room) room.supportZones = room.supportZones.filter((zone) => zone.ownerId !== player.id);
}

function activateSupportEquipment(room: Room, player: Player, support: SupportEquipmentType) {
  if (player.equippedSupportEquipment !== support || !player.craftedSupportEquipment.includes(support)) return;
  if (support === 'robotVacuumDrone' || support === 'mzKeycap' || support === 'annualLeaveShield' || support === 'emergencyAed') return;
  const level = supportLevel(player, support);
  const cooldown = Math.max(4.5, 8 - (level - 1) * 0.7);
  if (!canAct(room, player.id, `support:${support}`, cooldown)) return;
  player.activeSupportEquipment = support;
  player.supportExpiresAt = elapsedSeconds(room) + 3 + (level - 1) * 0.35;
  deploySupportZone(room, player, support, {
    x: player.position.x + player.aim.x * 78,
    y: player.position.y + player.aim.y * 78
  }, level);
}

function deploySupportZone(room: Room, player: Player, support: SupportEquipmentType, position: Vec2, level: number) {
  room.supportZones.push({
    id: makeId('keycap'),
    ownerId: player.id,
    type: support,
    position: clampToMap(room, position, 24),
    radius: 190 + (level - 1) * 22,
    ttl: 3 + (level - 1) * 0.35
  });
  pushFeedback(room, 'build', position, '시끌');
}

function isNearCraftingStation(room: Room, player: Player) {
  return room.craftingStations.some((station) => distance(player.position, station.position) <= station.interactionRadius);
}

function weaponFeedbackLabel(weapon: WeaponType) {
  if (weapon === 'keyboardShotgun') return '키보드';
  if (weapon === 'printerCannon') return '프린터';
  if (weapon === 'plunger') return '뚫어뻥';
  if (weapon === 'corporateCardBoomerang') return '법카';
  return '손전등';
}

function supportFeedbackLabel(support: SupportEquipmentType) {
  if (support === 'robotVacuumDrone') return '청소기';
  if (support === 'mzKeycap') return '키캡';
  if (support === 'emergencyAed') return 'AED';
  return '연차';
}

function equipmentLevel<T extends string>(levels: Partial<Record<T, number>> | undefined, type: T, fallbackOwned: boolean) {
  return Math.max(fallbackOwned ? 1 : 0, levels?.[type] ?? 0);
}

function weaponLevel(player: Player, weapon?: WeaponType) {
  if (!weapon) return 0;
  return equipmentLevel(player.weaponLevels, weapon, player.craftedWeapons.includes(weapon));
}

function supportLevel(player: Player, support?: SupportEquipmentType) {
  if (!support) return 0;
  return equipmentLevel(player.supportEquipmentLevels, support, player.craftedSupportEquipment.includes(support));
}

function craftPower(level: number) {
  return 1.22 + Math.max(0, level - 1) * 0.24;
}

function weaponCooldown(player: Player) {
  const comboBoost = player.combo >= 5 ? 0.9 : 1;
  const levelBoost = Math.max(0.74, 1 - Math.max(0, weaponLevel(player, player.equippedWeapon) - 1) * 0.06);
  if (player.equippedWeapon === 'keyboardShotgun') return 0.78 * comboBoost * levelBoost;
  if (player.equippedWeapon === 'printerCannon') return 1.18 * comboBoost * levelBoost;
  if (player.equippedWeapon === 'plunger') return 0.62 * comboBoost * levelBoost;
  if (player.equippedWeapon === 'corporateCardBoomerang') return 0.86 * comboBoost * levelBoost;
  if (player.equippedWeapon === 'guardFlashlight') return 0.95 * comboBoost * levelBoost;
  return player.combo >= 5 ? 0.44 : 0.52;
}

function fireEquippedWeapon(room: Room, player: Player) {
  const weapon = player.equippedWeapon;
  if (hitOverlappingTarget(room, player)) return;
  if (!weapon) {
    const attackRange = playerAttackRange(room, player);
    room.projectiles.push({
      id: makeId('shot'),
      ownerId: player.id,
      position: { ...player.position },
      velocity: { x: player.aim.x * PROJECTILE_SPEED, y: player.aim.y * PROJECTILE_SPEED },
      ttl: attackRange / PROJECTILE_SPEED,
      variant: 'default'
    });
    return;
  }
  const level = weaponLevel(player, weapon);
  const power = craftPower(level);

  if (weapon === 'keyboardShotgun') {
    const pelletCount = 7 + Math.floor((level - 1) / 2) * 2;
    const center = (pelletCount - 1) / 2;
    for (let i = 0; i < pelletCount; i += 1) {
      const dir = rotate(player.aim, (i - center) * 0.13);
      room.projectiles.push({
        id: makeId('keycap'),
        ownerId: player.id,
        position: { ...player.position },
        velocity: { x: dir.x * PROJECTILE_SPEED, y: dir.y * PROJECTILE_SPEED },
        ttl: (320 + (level - 1) * 26) / PROJECTILE_SPEED,
        variant: weapon,
        damage: (16 + player.upgrades.damage * 1.8) * power
      });
    }
    return;
  }

  if (weapon === 'printerCannon') {
    room.projectiles.push({
      id: makeId('paperBall'),
      ownerId: player.id,
      position: { ...player.position },
      velocity: { x: player.aim.x * 520, y: player.aim.y * 520 },
      ttl: (470 + (level - 1) * 30) / 520,
      variant: weapon,
      damage: (68 + player.upgrades.damage * 2.8) * power,
      radius: 128 + (level - 1) * 14
    });
    return;
  }

  if (weapon === 'plunger') {
    hitTargetsInCone(room, player, 146 + (level - 1) * 16, 0.96, (54 + player.upgrades.damage * 2.8) * power, 132 + (level - 1) * 18);
    pushFeedback(room, 'hit', {
      x: player.position.x + player.aim.x * 54,
      y: player.position.y + player.aim.y * 54
    }, '밀쳐냄', 0.08);
    return;
  }

  if (weapon === 'corporateCardBoomerang') {
    const dir = player.aim;
    room.projectiles.push({
      id: makeId('card'),
      ownerId: player.id,
      position: { ...player.position },
      velocity: { x: dir.x * 620, y: dir.y * 620 },
      ttl: 410 / 620,
      variant: weapon,
      damage: (38 + player.upgrades.damage * 2.2) * power,
      pierce: 5 + Math.floor((level - 1) / 2)
    });
    room.projectiles.push({
      id: makeId('cardBack'),
      ownerId: player.id,
      position: {
        x: player.position.x + dir.x * 250,
        y: player.position.y + dir.y * 250
      },
      velocity: { x: -dir.x * 620, y: -dir.y * 620 },
      ttl: 330 / 620,
      variant: weapon,
      damage: (38 + player.upgrades.damage * 2.2) * power,
      pierce: 5 + Math.floor((level - 1) / 2)
    });
    return;
  }

  if (weapon === 'guardFlashlight') {
    hitTargetsInCone(room, player, 420 + (level - 1) * 34, 0.34 + (level - 1) * 0.03, (26 + player.upgrades.damage * 1.8) * power, 0);
    pushFeedback(room, 'hit', {
      x: player.position.x + player.aim.x * 150,
      y: player.position.y + player.aim.y * 150
    }, '눈뽕', 0.12);
  }
}

function hitOverlappingTarget(room: Room, player: Player) {
  const overlapRange = PLAYER_RADIUS + ZOMBIE_RADIUS + 4;
  const zombie = room.zombies
    .filter((candidate) => distance(player.position, candidate.position) <= overlapRange)
    .sort((a, b) => distance(player.position, a.position) - distance(player.position, b.position))[0];
  if (zombie) {
    damageZombie(room, zombie, rangedDamage(room, player), player.id);
    pushFeedback(room, 'hit', zombie.position, '근접', 0.08);
    return true;
  }
  if (!room.settings.pvpEnabled) return false;
  const target = [...room.players.values()]
    .filter((candidate) => candidate.id !== player.id && candidate.alive && distance(player.position, candidate.position) <= PLAYER_RADIUS * 2)
    .sort((a, b) => distance(player.position, a.position) - distance(player.position, b.position))[0];
  if (!target) return false;
  damagePlayer(room, target, rangedDamage(room, player), player);
  pushFeedback(room, 'hit', target.position, '근접', 0.08);
  return true;
}

function updatePowerZones(room: Room) {
  room.powerZones = room.powerZones
    .map((zone) => ({ ...zone, ttl: zone.ttl - DT }))
    .filter((zone) => zone.ttl > 0);
  room.supportZones = room.supportZones
    .map((zone) => ({ ...zone, ttl: zone.ttl - DT }))
    .filter((zone) => {
      if (zone.ttl <= 0) return false;
      const owner = room.players.get(zone.ownerId);
      return Boolean(owner?.alive && owner.equippedSupportEquipment === zone.type);
    });
}

function playerAttackRange(room: Room, player: Player) {
  const zoneBonus = isInPowerZone(room, player.position) ? POWER_ZONE_RANGE_BONUS : 0;
  const levelBonus = 1 + player.upgrades.range * 0.1;
  return (BASE_ATTACK_RANGE + zoneBonus) * levelBonus;
}

function isInPowerZone(room: Room, point: Vec2) {
  return room.powerZones.some((zone) => distance(point, zone.position) <= zone.radius);
}

function buildFacility(room: Room, player: Player, type: FacilityType) {
  if (!canAct(room, player.id, `build:${type}`, 0.6)) return;
  const cost = facilityCost(type);
  if (!hasResources(player.inventory, cost)) return;
  const position = {
    x: player.position.x + player.aim.x * 52,
    y: player.position.y + player.aim.y * 52
  };
  if (collidesWithWalls(position, FACILITY_RADIUS, room.walls) || collidesWithFacilities(room, position, FACILITY_RADIUS)) return;
  spendResources(player.inventory, cost);
  player.facilitiesBuilt += 1;
  player.score += 20;
  pushFeedback(room, 'build', position, '+20');
  room.facilities.push({
    id: makeId('facility'),
    type,
    ownerId: player.id,
    hp: facilityHp(type),
    position
  });
}

function facilityCost(type: FacilityType): Partial<ResourceInventory> {
  return FACILITY_COSTS[type] ?? {};
}

function hasResources(inventory: ResourceInventory, cost: Partial<ResourceInventory>) {
  return Object.entries(cost).every(([type, amount]) => inventory[type as keyof ResourceInventory] >= amount);
}

function spendResources(inventory: ResourceInventory, cost: Partial<ResourceInventory>) {
  for (const [type, amount] of Object.entries(cost)) {
    inventory[type as keyof ResourceInventory] -= amount;
  }
}

function facilityHp(type: FacilityType) {
  return FACILITY_HP[type] ?? SUPPLY_CACHE_HP;
}

function createSupplyCache(room: Room): Facility {
  return {
    id: makeId('supply'),
    type: 'supplyCache',
    ownerId: 'system',
    hp: SUPPLY_CACHE_HP,
    position: { x: room.map.width / 2, y: room.map.height / 2 },
    width: 116,
    height: 86
  };
}

function supplyCache(room: Room) {
  return room.facilities.find((facility) => facility.type === 'supplyCache');
}

function supplyCacheHp(room: Room) {
  return supplyCache(room)?.hp ?? 0;
}

function collectResources(room: Room, player: Player) {
  const before = room.resources.length;
  const collectRadius = PLAYER_RADIUS + RESOURCE_RADIUS + player.upgrades.resourceSense * 10;
  room.resources = room.resources.filter((resource) => {
    if (distance(player.position, resource.position) < collectRadius) {
      player.inventory[resource.type] += 1;
      player.resourcesCollected += 1;
      const score = resource.type === 'mixCoffee' ? 8 : craftMaterialKeys.includes(resource.type) ? 6 : 5;
      player.score += score;
      pushFeedback(room, 'collect', resource.position, `x${player.inventory[resource.type]}`);
      return false;
    }
    return true;
  });
  if (before !== room.resources.length) room.nextResourceSpawnAt = Math.min(room.nextResourceSpawnAt, 1);
}

function updateEquipment(_room: Room, _player: Player, _elapsed: number) {
  // Passive item equipment was removed in favor of crafted weapons and support equipment.
}

function canEquipmentAct(room: Room, playerId: string, action: string, cooldown: number) {
  const key = `${room.id}:${playerId}:equipment:${action}`;
  const now = Date.now() / 1000;
  const previous = equipmentTimers.get(key) ?? 0;
  if (now - previous < cooldown) return false;
  equipmentTimers.set(key, now);
  return true;
}

type AutoAttackTarget =
  | { kind: 'zombie'; position: Vec2; distance: number; zombie: Zombie }
  | { kind: 'player'; position: Vec2; distance: number; player: Player };

function nearestAutoAttackTargets(room: Room, player: Player, count: number, maxDistance: number): AutoAttackTarget[] {
  const zombieTargets: AutoAttackTarget[] = room.zombies.map((zombie) => ({
    kind: 'zombie',
    position: zombie.position,
    distance: distance(player.position, zombie.position),
    zombie
  }));
  const playerTargets: AutoAttackTarget[] = room.settings.pvpEnabled
    ? [...room.players.values()]
        .filter((target) => target.id !== player.id && target.alive)
        .map((target) => ({
          kind: 'player',
          position: target.position,
          distance: distance(player.position, target.position),
          player: target
        }))
    : [];

  return [...zombieTargets, ...playerTargets]
    .filter((target) => target.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count);
}

function damageAutoAttackTarget(room: Room, target: AutoAttackTarget, damage: number, attacker: Player) {
  if (target.kind === 'zombie') damageZombie(room, target.zombie, damage, attacker.id);
  else damagePlayer(room, target.player, damage, attacker);
}

function hitTargetsInCone(room: Room, player: Player, range: number, halfAngle: number, damage: number, knockback: number) {
  for (const zombie of room.zombies) {
    const offset = { x: zombie.position.x - player.position.x, y: zombie.position.y - player.position.y };
    const targetDistance = length(offset);
    if (targetDistance > range || targetDistance <= 0.01) continue;
    const dir = { x: offset.x / targetDistance, y: offset.y / targetDistance };
    const dot = dir.x * player.aim.x + dir.y * player.aim.y;
    if (dot < Math.cos(halfAngle)) continue;
    damageZombie(room, zombie, damage, player.id);
    if (knockback > 0 && zombie.hp > 0) {
      zombie.position = clampToMap(room, {
        x: zombie.position.x + dir.x * knockback,
        y: zombie.position.y + dir.y * knockback
      }, ZOMBIE_RADIUS);
    }
  }
  if (!room.settings.pvpEnabled) return;
  for (const target of room.players.values()) {
    if (target.id === player.id || !target.alive) continue;
    const offset = { x: target.position.x - player.position.x, y: target.position.y - player.position.y };
    const targetDistance = length(offset);
    if (targetDistance > range || targetDistance <= 0.01) continue;
    const dir = { x: offset.x / targetDistance, y: offset.y / targetDistance };
    const dot = dir.x * player.aim.x + dir.y * player.aim.y;
    if (dot >= Math.cos(halfAngle)) damagePlayer(room, target, damage, player);
  }
}

function updateSupportEquipment(room: Room, player: Player, elapsed: number) {
  if (player.supportExpiresAt !== undefined && elapsed >= player.supportExpiresAt) {
    player.activeSupportEquipment = undefined;
    player.supportExpiresAt = undefined;
  }
  if (player.equippedSupportEquipment === 'robotVacuumDrone') {
    const level = supportLevel(player, 'robotVacuumDrone');
    if (!canEquipmentAct(room, player.id, 'vacuumDrone', Math.max(0.55, 0.95 - (level - 1) * 0.07))) return;
    const targets = nearestAutoAttackTargets(room, player, 1, 160 + (level - 1) * 18);
    const target = targets[0];
    if (!target) return;
    damageAutoAttackTarget(room, target, (16 + player.upgrades.damage) * craftPower(level), player);
    pushFeedback(room, 'hit', target.position, '위잉', 0.16);
    return;
  }
  if (player.equippedSupportEquipment === 'mzKeycap') {
    const level = supportLevel(player, 'mzKeycap');
    if (!canEquipmentAct(room, player.id, 'mzKeycap:passive', Math.max(4.4, 7.2 - (level - 1) * 0.55))) return;
    const nearestZombie = [...room.zombies]
      .filter((zombie) => distance(player.position, zombie.position) <= 430 + (level - 1) * 48)
      .sort((a, b) => distance(player.position, a.position) - distance(player.position, b.position))[0];
    if (!nearestZombie) return;
    const dir = normalize({
      x: nearestZombie.position.x - player.position.x,
      y: nearestZombie.position.y - player.position.y
    });
    deploySupportZone(room, player, 'mzKeycap', {
      x: player.position.x + dir.x * 88,
      y: player.position.y + dir.y * 88
    }, level);
  }
}

function updateProjectiles(room: Room) {
  const live = [];
  for (const projectile of room.projectiles) {
    projectile.ttl -= DT;
    projectile.position.x += projectile.velocity.x * DT;
    projectile.position.y += projectile.velocity.y * DT;
    if (projectile.ttl <= 0 || collidesWithWalls(projectile.position, PROJECTILE_RADIUS, room.walls)) {
      if (projectile.variant === 'printerCannon' && projectile.radius) explodeProjectile(room, projectile);
      continue;
    }

    let hit = false;
    const owner = room.players.get(projectile.ownerId);
    const damage = projectile.damage ?? (owner ? rangedDamage(room, owner) : 14);
    for (const zombie of room.zombies) {
      if (distance(projectile.position, zombie.position) < ZOMBIE_RADIUS + PROJECTILE_RADIUS) {
        if (projectile.variant === 'printerCannon' && projectile.radius) {
          damageZombie(room, zombie, damage, projectile.ownerId);
          explodeProjectile(room, projectile);
          hit = true;
          break;
        }
        damageZombie(room, zombie, damage, projectile.ownerId);
        if ((projectile.pierce ?? 0) > 0) {
          projectile.pierce = (projectile.pierce ?? 0) - 1;
        } else {
          hit = true;
          break;
        }
      }
    }
    if (!hit && room.settings.pvpEnabled) {
      for (const player of room.players.values()) {
        if (player.id !== projectile.ownerId && player.alive && distance(projectile.position, player.position) < PLAYER_RADIUS) {
          damagePlayer(room, player, damage, owner);
          hit = true;
          break;
        }
      }
    }
    if (!hit) live.push(projectile);
  }
  room.projectiles = live;
}

function explodeProjectile(room: Room, projectile: GameSnapshot['projectiles'][number]) {
  const radius = projectile.radius ?? 0;
  if (radius <= 0) return;
  const baseDamage = projectile.damage ?? 24;
  for (const zombie of room.zombies) {
    const targetDistance = distance(projectile.position, zombie.position);
    if (targetDistance <= radius) {
      const falloff = 1 - targetDistance / radius;
      damageZombie(room, zombie, baseDamage * (0.42 + falloff * 0.58), projectile.ownerId);
    }
  }
  const owner = room.players.get(projectile.ownerId);
  if (room.settings.pvpEnabled && owner) {
    for (const player of room.players.values()) {
      if (player.id !== projectile.ownerId && player.alive && distance(projectile.position, player.position) <= radius) {
        damagePlayer(room, player, Math.max(16, baseDamage * 0.34), owner);
      }
    }
  }
  pushFeedback(room, 'hit', projectile.position, '광역!', 0.08);
}

function updateZombies(room: Room) {
  for (const zombie of room.zombies) {
    const target = chooseZombieTarget(room, zombie);
    if (!target) continue;
    const targetInput = room.inputs.get(target.id);
    const lead = targetInput ? normalize(targetInput.move) : { x: 0, y: 0 };
    const targetPoint = {
      x: target.position.x + lead.x * (zombie.type === 'runner' ? 64 : 34),
      y: target.position.y + lead.y * (zombie.type === 'runner' ? 64 : 34)
    };
    const dir = normalize({ x: targetPoint.x - zombie.position.x, y: targetPoint.y - zombie.position.y });
    const chaseBoost = distance(zombie.position, target.position) > 360 ? 1.2 : 1;
    const flashlightSlow = flashlightSlowMultiplier(room, zombie);
    zombie.position = moveZombieWithPatterns(room, zombie, dir, targetPoint, zombieSpeed(zombie.type, room.wave) * chaseBoost * flashlightSlow);

    for (const facility of room.facilities) {
      if (distance(zombie.position, facility.position) < ZOMBIE_RADIUS + facilityHitRadius(facility)) {
        facility.hp -= facilityDamagePerSecond(zombie, facility) * DT;
      }
    }
    if (room.players.has(target.id) && distance(zombie.position, target.position) < ZOMBIE_RADIUS + PLAYER_RADIUS) {
      const damageScale = DIFFICULTY_TUNING[room.settings.difficulty].zombieDamage;
      const biteDamage = (zombie.type === 'tanker' ? 24 * DT : zombie.type === 'runner' ? 17 * DT : 12 * DT) * damageScale;
      damagePlayer(room, target, biteDamage);
    }
  }
  room.facilities = room.facilities.filter((facility) => facility.hp > 0);
  room.zombies = room.zombies.filter((zombie) => {
    if (zombie.hp > 0) return true;
    zombieAiTimers.delete(zombieAiKey(room, zombie));
    return false;
  });
}

function facilityHitRadius(facility: Facility) {
  if (facility.type === 'supplyCache') return Math.max(facility.width ?? 0, facility.height ?? 0, FACILITY_RADIUS * 2) / 2;
  return FACILITY_RADIUS;
}

function facilityDamagePerSecond(zombie: Zombie, facility: Facility) {
  if (facility.type !== 'supplyCache') return 14;
  if (zombie.type === 'tanker') return 46;
  if (zombie.type === 'runner') return 24;
  return 32;
}

function damageZombie(room: Room, zombie: Zombie, damage: number, attackerId: string) {
  if (zombie.hp <= 0) return;
  const attacker = room.players.get(attackerId);
  const finalDamage = attacker ? zombieDamageWithUpgrades(attacker, zombie, damage) : damage;
  zombie.hp -= finalDamage;
  pushFeedback(room, 'hit', zombie.position, `${Math.round(finalDamage)}`, 0.08);
  if (zombie.hp > 0) return;
  if (!attacker) return;
  attacker.kills += 1;
  registerKillTargetProgress(room, attacker);
  checkLevelUp(room, attacker);
  const combo = registerKillCombo(room, attacker);
  const score = zombieScore(zombie.type);
  attacker.score += score;
  pushFeedback(room, 'kill', zombie.position, `+${score}`);
}

function registerKillTargetProgress(room: Room, player: Player) {
  if (room.settings.gameMode !== 'killTarget') return;
  if (player.kills < room.settings.killTarget) return;
  if (room.killTargetReachedAt.has(player.id)) return;
  room.killTargetReachedAt.set(player.id, elapsedSeconds(room));
  pushFeedback(room, 'kill', player.position, '목표 달성', 0.18);
}

function damagePlayer(room: Room, target: Player, damage: number, attacker?: Player) {
  if (!target.alive) return;
  const reduction = Math.min(0.18, target.upgrades.maxHp * 0.025);
  const shieldLevel = supportLevel(target, 'annualLeaveShield');
  const elapsed = elapsedSeconds(room);
  if (
    target.equippedSupportEquipment === 'annualLeaveShield'
    && shieldLevel > 0
    && (target.supportExpiresAt ?? 0) <= elapsed
    && canAct(room, target.id, 'support:annualLeaveShield:auto', Math.max(8, 14 - (shieldLevel - 1) * 1.2))
  ) {
    target.activeSupportEquipment = 'annualLeaveShield';
    target.supportExpiresAt = elapsed + 2.8 + (shieldLevel - 1) * 0.3;
    pushFeedback(room, 'build', target.position, '연차', 0.16);
  }
  const shieldReduction = target.activeSupportEquipment === 'annualLeaveShield' && (target.supportExpiresAt ?? 0) > elapsed
    ? Math.min(0.72, 0.45 + Math.max(0, shieldLevel - 1) * 0.06)
    : 0;
  const effectiveDamage = damage * (1 - reduction) * (1 - shieldReduction);
  target.hp -= effectiveDamage;
  recordRecentDamage(room, target.id, effectiveDamage);
  pushFeedback(room, 'hit', target.position, `-${Math.max(1, Math.round(effectiveDamage))}`, 0.12);
  if (target.hp > 0) return;
  if (consumeEmergencyAed(room, target)) return;
  target.hp = 0;
  target.alive = false;
  if (room.settings.gameMode === 'supplyDefense') {
    room.playerRespawnAt.set(target.id, elapsed + SUPPLY_DEFENSE_RESPAWN_SEC);
  }
  if (attacker && attacker.id !== target.id) attacker.score += 40;
  pushFeedback(room, 'playerDown', target.position, 'DOWN');
}

function updateRespawns(room: Room, elapsed: number) {
  if (room.settings.gameMode !== 'supplyDefense') return;
  for (const player of room.players.values()) {
    if (player.alive) {
      room.playerRespawnAt.delete(player.id);
      continue;
    }
    const respawnAt = room.playerRespawnAt.get(player.id);
    if (respawnAt === undefined || elapsed < respawnAt) continue;
    player.alive = true;
    player.hp = Math.max(1, Math.round(player.maxHp * 0.65));
    player.position = supplyDefenseRespawnPosition(room);
    player.combo = 0;
    room.playerRespawnAt.delete(player.id);
    pushFeedback(room, 'heal', player.position, '복귀', 0.12);
  }
}

function supplyDefenseRespawnPosition(room: Room) {
  const supply = supplyCache(room);
  const center = supply?.position ?? { x: room.map.width / 2, y: room.map.height / 2 };
  for (let i = 0; i < 36; i += 1) {
    const angle = i * 1.256 + Math.random() * 0.5;
    const radius = 150 + (i % 6) * 24;
    const point = clampToMap(room, {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius
    }, PLAYER_RADIUS);
    if (!collidesWithWalls(point, PLAYER_RADIUS, room.walls) && !collidesWithFacilities(room, point, PLAYER_RADIUS)) return point;
  }
  return randomFreePosition(room.walls, room.map);
}

function consumeEmergencyAed(room: Room, player: Player) {
  if (player.equippedSupportEquipment !== 'emergencyAed') return false;
  const index = player.craftedSupportEquipment.indexOf('emergencyAed');
  if (index < 0) return false;
  const level = supportLevel(player, 'emergencyAed');
  if (level <= 1) {
    player.craftedSupportEquipment.splice(index, 1);
    delete player.supportEquipmentLevels.emergencyAed;
    if (player.equippedSupportEquipment === 'emergencyAed') player.equippedSupportEquipment = undefined;
  } else {
    player.supportEquipmentLevels.emergencyAed = level - 1;
  }
  if (player.activeSupportEquipment === 'emergencyAed') {
    player.activeSupportEquipment = undefined;
    player.supportExpiresAt = undefined;
  }
  player.hp = Math.max(1, Math.round(player.maxHp * (0.32 + Math.max(0, level - 1) * 0.08)));
  pushFeedback(room, 'heal', player.position, 'AED');
  return true;
}

function checkLevelUp(room: Room, player: Player) {
  while (player.kills >= player.nextLevelKills && player.pendingUpgradeCount < MAX_PENDING_UPGRADES) {
    player.level += 1;
    player.pendingUpgradeCount += 1;
    player.nextLevelKills = nextLevelKillRequirement(player.level);
    player.pendingUpgradeChoices = createUpgradeChoices(player);
    player.hp = Math.min(player.maxHp, player.hp + 10);
    pushFeedback(room, 'heal', player.position, `Lv ${player.level}`, 0.08);
  }
}

function nextLevelKillRequirement(level: number) {
  return LEVEL_KILL_THRESHOLDS[level - 1] ?? LEVEL_KILL_THRESHOLDS[LEVEL_KILL_THRESHOLDS.length - 1] + (level - LEVEL_KILL_THRESHOLDS.length) * 12;
}

function createUpgradeChoices(player: Player): UpgradeOption[] {
  const weighted = [...UPGRADE_POOL].sort((a, b) => {
    const aLevel = player.upgrades[a.type];
    const bLevel = player.upgrades[b.type];
    return aLevel - bLevel || Math.random() - 0.5;
  });
  return weighted.slice(0, 3).map((upgrade) => ({
    ...upgrade,
    id: `${upgrade.type}:${player.level}:${Math.random().toString(36).slice(2, 7)}`
  }));
}

function chooseUpgrade(room: Room, player: Player, upgradeId: string) {
  if (!player.alive || player.pendingUpgradeCount <= 0) return;
  const selected = player.pendingUpgradeChoices.find((upgrade) => upgrade.id === upgradeId);
  if (!selected) return;
  applyUpgrade(room, player, selected.type);
  player.pendingUpgradeCount -= 1;
  player.pendingUpgradeChoices = player.pendingUpgradeCount > 0 ? createUpgradeChoices(player) : [];
  checkLevelUp(room, player);
}

function applyUpgrade(room: Room, player: Player, type: UpgradeType) {
  player.upgrades[type] += 1;
  if (type === 'supply') {
    grantSupplyUpgrade(room, player);
    return;
  }
  if (type === 'maxHp') {
    player.maxHp += 18;
    player.hp = Math.min(player.maxHp, player.hp + 24);
    pushFeedback(room, 'heal', player.position, '+HP');
    return;
  }
  if (type === 'coffee') {
    player.hp = Math.min(player.maxHp, player.hp + 12);
  }
  pushFeedback(room, 'build', player.position, 'UP');
}

function grantSupplyUpgrade(room: Room, player: Player) {
  const gained: ResourceType[] = [];
  for (let i = 0; i < 3; i += 1) {
    const type = craftMaterialKeys[Math.floor(Math.random() * craftMaterialKeys.length)];
    player.inventory[type] += 1;
    gained.push(type);
  }
  pushFeedback(room, 'collect', player.position, `보급 +${gained.length}`);
}

function deployPartitionBarricades(room: Room, player: Player) {
  const placement = getPartitionPlacement(player.position, player.aim, player.upgrades.partition, room.walls, room.facilities);
  if (!placement.valid) return false;
  room.facilities.push({
    id: makeId('facility'),
    type: 'partitionBarricade',
    ownerId: player.id,
    hp: 155 + player.upgrades.partition * 45 + player.upgrades.partitionReinforce * 65,
    position: placement.position,
    width: placement.width,
    height: placement.height
  });
  return true;
}

function spawnWorld(room: Room, elapsed: number) {
  room.nextZombieSpawnAt -= DT;
  room.nextResourceSpawnAt -= DT;
  room.nextReliefSupplyAt -= DT;
  const director = getDirectorState(room, elapsed);
  const difficulty = DIFFICULTY_TUNING[room.settings.difficulty];
  updateSpawnWarnings(room);
  if (room.nextZombieSpawnAt <= 0) {
    const night = nightIntensity(elapsed);
    const spawnCountScale = 0.38 + night * 1.22;
    const spawnCapScale = 0.55 + night * 0.85;
    const spawnDelayScale = 1.7 - night * 0.95;
    const pressure = Math.floor(elapsed / 30);
    const baseCount = 3 + Math.ceil(room.wave * 1.05) + Math.floor(pressure * 1.05) + Math.max(0, director.aliveCount - 1) * 1.55;
    const easedCount = baseCount * spawnCountScale * (1 - director.earlyEase * 0.25) * (1 - director.relief * 0.38) * director.playerScale * difficulty.spawnCount;
    const count = Math.min(Math.max(1, Math.round(easedCount)), 26);
    const cap = Math.round((30 + director.aliveCount * 10 + room.wave * 4) * spawnCapScale * (1 - director.relief * 0.22) * difficulty.zombieCap);
    const pendingCount = room.spawnWarnings.length;
    for (let i = 0; i < count && room.zombies.length + pendingCount + i < cap; i += 1) {
      room.spawnWarnings.push(createSpawnWarning(room, undefined, director));
    }
    if (night >= 0.72 && room.wave >= 2 && director.relief < 0.45 && director.earlyEase <= 0) {
      const burstCount = Math.max(1, Math.round(director.aliveCount * (1.2 + night - director.relief)));
      const nextPendingCount = room.spawnWarnings.length;
      for (let i = 0; i < burstCount && room.zombies.length + nextPendingCount + i < cap; i += 1) {
        room.spawnWarnings.push(createSpawnWarning(room, 'runner', director, room.wave + 1));
      }
    }
    room.nextZombieSpawnAt = Math.max(0.8, (4.4 - room.wave * 0.13 + director.earlyEase * 0.75 + director.relief * 1.65) * spawnDelayScale * difficulty.spawnDelay);
  }
  const resourceLimit = MAP_PRESETS[room.settings.gameMode].resourceLimit;
  if (room.nextResourceSpawnAt <= 0 && room.resources.length < resourceLimit) {
    room.resources.push(createResource(room, director));
    room.nextResourceSpawnAt = 3.4 + Math.random() * 4.8 - director.relief * 1.5;
  }
  if (director.relief >= 0.62 && room.nextReliefSupplyAt <= 0 && room.resources.length < resourceLimit + 4) {
    room.resources.push(createResource(room, director, true));
    room.nextReliefSupplyAt = 14 + Math.random() * 8;
  }
  room.lastWaveAt = elapsed;
}

function updateSpawnWarnings(room: Room) {
  const ready: SpawnWarning[] = [];
  room.spawnWarnings = room.spawnWarnings
    .map((warning) => ({ ...warning, ttl: warning.ttl - DT }))
    .filter((warning) => {
      if (warning.ttl > 0) return true;
      ready.push(warning);
      return false;
    });
  for (const warning of ready) {
    room.zombies.push(createZombie(room, room.wave, warning.type, undefined, warning.position));
  }
}

function getDirectorState(room: Room, elapsed: number): DirectorState {
  const alive = [...room.players.values()].filter((player) => player.alive);
  const aliveCount = Math.max(1, alive.length);
  const totalPlayers = Math.max(1, room.players.size);
  const lowestHpRatio = alive.length > 0 ? Math.min(...alive.map((player) => player.hp / player.maxHp)) : 0;
  const recentDamage = recentDamagePressure(room);
  const deathPressure = (totalPlayers - alive.length) / totalPlayers;
  const crowdPressure = clamp(room.zombies.length / (aliveCount * 28), 0, 1);
  const lowHpPressure = clamp((0.62 - lowestHpRatio) / 0.45, 0, 1);
  const relief = clamp(lowHpPressure * 0.44 + recentDamage * 0.28 + deathPressure * 0.18 + crowdPressure * 0.1, 0, 0.9);
  const earlyEase = clamp((45 - elapsed) / 45, 0, 1);
  const playerScale = totalPlayers === 1 ? 0.88 : totalPlayers === 2 ? 0.94 : 1;
  return { aliveCount, playerScale, relief, earlyEase, lowestHpRatio, recentDamage };
}

function recentDamagePressure(room: Room) {
  const now = Date.now() / 1000;
  let total = 0;
  for (const [playerId, entry] of room.recentDamage) {
    if (now - entry.lastAt > 12) {
      room.recentDamage.delete(playerId);
      continue;
    }
    const fade = 1 - (now - entry.lastAt) / 12;
    total += entry.amount * fade;
  }
  return clamp(total / 150, 0, 1);
}

function recordRecentDamage(room: Room, playerId: string, damage: number) {
  const now = Date.now() / 1000;
  const previous = room.recentDamage.get(playerId);
  const amount = (previous && now - previous.lastAt <= 12 ? previous.amount * 0.65 : 0) + damage;
  room.recentDamage.set(playerId, { amount, lastAt: now });
}

function applySurvivalScore(room: Room, elapsed: number) {
  for (const player of room.players.values()) {
    if (!player.alive) continue;
    const wholeSeconds = Math.floor(elapsed);
    if (wholeSeconds > player.survivalSec) {
      player.score += wholeSeconds - player.survivalSec;
      player.survivalSec = wholeSeconds;
    }
  }
}

function pushFeedback(room: Room, type: FeedbackEvent['type'], position: Vec2, text: string, minInterval = 0) {
  if (minInterval > 0 && !canPushFeedback(room, type, minInterval)) return;
  room.feedbackEvents.push({
    id: makeId('fx'),
    type,
    position: { ...position },
    text,
    ttl: 0.8
  });
  if (room.feedbackEvents.length > 42) room.feedbackEvents.splice(0, room.feedbackEvents.length - 42);
}

function canPushFeedback(room: Room, type: FeedbackEvent['type'], minInterval: number) {
  const key = `${room.id}:feedback:${type}`;
  const now = Date.now() / 1000;
  const previous = feedbackTimers.get(key) ?? 0;
  if (now - previous < minInterval) return false;
  feedbackTimers.set(key, now);
  return true;
}

function updateFeedbackEvents(room: Room) {
  room.feedbackEvents = room.feedbackEvents
    .map((event) => ({ ...event, ttl: event.ttl - DT }))
    .filter((event) => event.ttl > 0);
}

function createSpawnWarning(room: Room, forcedType?: ZombieType, director?: DirectorState, wave = room.wave): SpawnWarning {
  const zombie = createZombie(room, wave, forcedType, director);
  return {
    id: makeId('spawn'),
    type: zombie.type,
    position: zombie.position,
    ttl: ZOMBIE_SPAWN_WARNING_SEC,
    duration: ZOMBIE_SPAWN_WARNING_SEC
  };
}

function createZombie(room: Room, wave: number, forcedType?: ZombieType, director?: DirectorState, position = randomEdgePosition(room)): Zombie {
  const roll = Math.random();
  const reliefFactor = 1 - (director?.relief ?? 0) * 0.65;
  const earlyFactor = 1 - (director?.earlyEase ?? 0) * 0.8;
  const night = nightIntensity(elapsedSeconds(room));
  const nightTypeScale = 0.45 + night * 0.9;
  const tankerChance = wave >= 3 ? Math.min(0.055 + wave * 0.022, 0.24) * reliefFactor * earlyFactor * nightTypeScale : 0;
  const runnerChance = wave >= 2 ? Math.min(0.21 + wave * 0.032, 0.46) * (1 - (director?.relief ?? 0) * 0.45) * earlyFactor * nightTypeScale : 0;
  const type: ZombieType = forcedType ?? (roll < tankerChance ? 'tanker' : roll < tankerChance + runnerChance ? 'runner' : 'normal');
  const scaling = Math.max(0, wave - 1);
  const hpScale = DIFFICULTY_TUNING[room.settings.difficulty].zombieHp;
  const baseHp = type === 'tanker' ? 105 + scaling * 8 : type === 'runner' ? 22 + scaling * 2 : 32 + scaling * 3;
  return {
    id: makeId('zombie'),
    type,
    hp: Math.round(baseHp * hpScale),
    position
  };
}

function createResource(room?: Room, director?: DirectorState, reliefSupply = false): ResourceNode {
  const relief = director?.relief ?? 0;
  const lowestHpRatio = director?.lowestHpRatio ?? 1;
  const needRecovery = reliefSupply || relief >= 0.5 || lowestHpRatio <= 0.45;
  const weights = [
    ...RESOURCE_DROP_WEIGHTS,
    ...(needRecovery ? RECOVERY_DROP_BONUS : []),
    ...(reliefSupply ? RELIEF_SUPPLY_DROP_BONUS : [])
  ];
  return {
    id: makeId('resource'),
    type: weightedResourceType(weights),
    position: room && needRecovery ? resourceNearVulnerablePlayer(room) : randomFreePosition(room?.walls, room?.map)
  };
}

function weightedResourceType(weights: Array<{ type: ResourceType; weight: number }>) {
  const totalWeight = weights.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const item of weights) {
    roll -= item.weight;
    if (roll <= 0) return item.type;
  }
  return weights[weights.length - 1]?.type ?? 'partitionMaterial';
}

function resourceNearVulnerablePlayer(room: Room) {
  const target = [...room.players.values()]
    .filter((player) => player.alive)
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
  if (!target) return randomFreePosition(room.walls, room.map);
  for (let i = 0; i < 30; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 120 + Math.random() * 180;
    const point = clampToMap(room, {
      x: target.position.x + Math.cos(angle) * radius,
      y: target.position.y + Math.sin(angle) * radius
    }, RESOURCE_RADIUS);
    if (!collidesWithWalls(point, RESOURCE_RADIUS, room.walls) && !collidesWithFacilities(room, point, RESOURCE_RADIUS)) return point;
  }
  return randomFreePosition(room.walls, room.map);
}

function randomEdgePosition(room: Room): Vec2 {
  const { width, height } = room.map;
  if (room.settings.gameMode === 'killTarget') {
    const gates = [
      { x: width / 2, y: 42 },
      { x: width - 42, y: height / 2 },
      { x: width / 2, y: height - 42 },
      { x: 42, y: height / 2 }
    ];
    const gate = gates[Math.floor(Math.random() * gates.length)];
    return {
      x: clamp(gate.x + (Math.random() - 0.5) * 180, 42, width - 42),
      y: clamp(gate.y + (Math.random() - 0.5) * 180, 42, height - 42)
    };
  }
  if (room.settings.gameMode === 'endless') {
    const fromHorizontal = Math.random() < 0.68;
    if (fromHorizontal) return { x: Math.random() < 0.5 ? 42 : width - 42, y: 160 + Math.random() * (height - 320) };
    return { x: 180 + Math.random() * (width - 360), y: Math.random() < 0.5 ? 42 : height - 42 };
  }
  const side = Math.floor(Math.random() * 4);
  if (side === 0) return { x: Math.random() * width, y: 40 };
  if (side === 1) return { x: width - 40, y: Math.random() * height };
  if (side === 2) return { x: Math.random() * width, y: height - 40 };
  return { x: 40, y: Math.random() * height };
}

function nearestAlivePlayer(room: Room, point: Vec2) {
  return [...room.players.values()]
    .filter((player) => player.alive)
    .sort((a, b) => distance(point, a.position) - distance(point, b.position))[0];
}

function chooseZombieTarget(room: Room, zombie: Zombie) {
  const aggroZone = room.supportZones
    .filter((zone) => zone.type === 'mzKeycap' && distance(zombie.position, zone.position) <= zone.radius)
    .sort((a, b) => distance(zombie.position, a.position) - distance(zombie.position, b.position))[0];
  if (aggroZone) {
    return {
      id: aggroZone.id,
      nickname: 'keycap',
      avatarId: 0,
      ready: false,
      host: false,
      alive: true,
      hp: 1,
      maxHp: 1,
      position: aggroZone.position,
      aim: { x: 1, y: 0 },
      score: 0,
      kills: 0,
      combo: 0,
      level: 1,
      nextLevelKills: 0,
      pendingUpgradeChoices: [],
      pendingUpgradeCount: 0,
      upgrades: emptyUpgrades(),
      inventory: emptyInventory(),
      craftedWeapons: [],
      weaponLevels: {},
      craftedSupportEquipment: [],
      supportEquipmentLevels: {},
      resourcesCollected: 0,
      facilitiesBuilt: 0,
      survivalSec: 0
    };
  }
  const noisyPlayer = noisyKeycapTarget(room, zombie.position);
  if (noisyPlayer) return noisyPlayer;
  const supplyTarget = supplyDefenseTarget(room);
  if (supplyTarget) return supplyTarget;
  const alive = [...room.players.values()].filter((player) => player.alive);
  if (alive.length === 0) return undefined;
  if (zombie.type === 'runner') {
    return alive
      .sort((a, b) => {
        const aScore = distance(zombie.position, a.position) + a.hp * 2.4;
        const bScore = distance(zombie.position, b.position) + b.hp * 2.4;
        return aScore - bScore;
      })[0];
  }
  if (zombie.type === 'tanker') {
    return alive
      .sort((a, b) => {
        const aThreat = a.craftedWeapons.length * 2 + a.craftedSupportEquipment.length + a.inventory.partitionMaterial;
        const bThreat = b.craftedWeapons.length * 2 + b.craftedSupportEquipment.length + b.inventory.partitionMaterial;
        return distance(zombie.position, a.position) - aThreat * 18 - (distance(zombie.position, b.position) - bThreat * 18);
      })[0];
  }
  return nearestAlivePlayer(room, zombie.position);
}

function supplyDefenseTarget(room: Room): Player | undefined {
  if (room.settings.gameMode !== 'supplyDefense') return undefined;
  const supply = supplyCache(room);
  if (!supply) return undefined;
  return {
    id: supply.id,
    nickname: 'supply',
    avatarId: 0,
    ready: false,
    host: false,
    alive: true,
    hp: supply.hp,
    maxHp: SUPPLY_CACHE_HP,
    position: supply.position,
    aim: { x: 1, y: 0 },
    score: 0,
    kills: 0,
    combo: 0,
    level: 1,
    nextLevelKills: 0,
    pendingUpgradeChoices: [],
    pendingUpgradeCount: 0,
    upgrades: emptyUpgrades(),
    inventory: emptyInventory(),
    craftedWeapons: [],
    weaponLevels: {},
    craftedSupportEquipment: [],
    supportEquipmentLevels: {},
    resourcesCollected: 0,
    facilitiesBuilt: 0,
    survivalSec: 0
  };
}

function noisyKeycapTarget(room: Room, point: Vec2) {
  return [...room.players.values()]
    .filter((player) => player.alive && player.equippedSupportEquipment === 'mzKeycap')
    .map((player) => {
      const level = supportLevel(player, 'mzKeycap');
      const radius = 420 + (level - 1) * 58;
      const targetDistance = distance(point, player.position);
      return { player, level, radius, targetDistance };
    })
    .filter((candidate) => candidate.targetDistance <= candidate.radius)
    .sort((a, b) => {
      const aScore = a.targetDistance - a.level * 42;
      const bScore = b.targetDistance - b.level * 42;
      return aScore - bScore;
    })[0]?.player;
}

function flashlightSlowMultiplier(room: Room, zombie: Zombie) {
  const night = nightIntensity(elapsedSeconds(room));
  if (night < 0.18) return 1;
  let slow = 1;
  for (const player of room.players.values()) {
    if (!player.alive || player.equippedWeapon !== 'guardFlashlight') continue;
    const level = weaponLevel(player, 'guardFlashlight');
    const range = 450 + (level - 1) * 42;
    const halfAngle = 0.46 + (level - 1) * 0.04;
    if (!isPointInCone(player.position, player.aim, zombie.position, range, halfAngle)) continue;
    slow = Math.min(slow, 0.78 - Math.min(0.16, (level - 1) * 0.04) - night * 0.08);
  }
  return clamp(slow, 0.54, 1);
}

function isPointInCone(origin: Vec2, aim: Vec2, point: Vec2, range: number, halfAngle: number) {
  const offset = { x: point.x - origin.x, y: point.y - origin.y };
  const targetDistance = length(offset);
  if (targetDistance > range || targetDistance <= 0.01) return false;
  const dir = { x: offset.x / targetDistance, y: offset.y / targetDistance };
  return dir.x * aim.x + dir.y * aim.y >= Math.cos(halfAngle);
}

function nearestFacility(room: Room, point: Vec2) {
  return room.facilities.sort((a, b) => distance(point, a.position) - distance(point, b.position))[0];
}

function rangedDamage(room: Room, player: Player) {
  const base = 11 + player.upgrades.damage * 3 + comboDamageBonus(player);
  return isInPowerZone(room, player.position) ? base * (1 + POWER_ZONE_DAMAGE_BONUS) : base;
}

function playerMoveSpeed(player: Player, elapsed: number) {
  const nightBonus = player.upgrades.nightMove * 0.055 * nightIntensity(elapsed);
  return 220 * (1 + player.upgrades.moveSpeed * 0.07 + nightBonus);
}

function comboDamageBonus(player: Player) {
  return 0;
}

function zombieDamageWithUpgrades(attacker: Player, zombie: Zombie, damage: number) {
  if (attacker.upgrades.finisher <= 0) return damage;
  const threshold = 22 + attacker.upgrades.finisher * 10;
  if (zombie.hp > threshold) return damage;
  return damage * (1 + attacker.upgrades.finisher * 0.18);
}

function registerKillCombo(room: Room, player: Player) {
  const key = comboKey(room, player.id);
  const now = Date.now() / 1000;
  const previous = killTimers.get(key) ?? 0;
  player.combo = now - previous <= 3.6 ? Math.min(player.combo + 1, 12) : 1;
  killTimers.set(key, now);
  return player.combo;
}

function refreshCombo(room: Room, player: Player) {
  const previous = killTimers.get(comboKey(room, player.id)) ?? 0;
  if (player.combo > 0 && Date.now() / 1000 - previous > 4.2) player.combo = 0;
}

function comboKey(room: Room, playerId: string) {
  return `${room.id}:${playerId}`;
}

function clearEquipmentTimers(room: Room, playerId: string) {
  const prefix = `${room.id}:${playerId}:equipment:`;
  for (const key of equipmentTimers.keys()) {
    if (key.startsWith(prefix)) equipmentTimers.delete(key);
  }
}

function clearFeedbackTimers(room: Room, playerId?: string) {
  const prefix = `${room.id}:feedback:`;
  for (const key of feedbackTimers.keys()) {
    if (key.startsWith(prefix) || (playerId && key.includes(`:${playerId}:`))) feedbackTimers.delete(key);
  }
}

function clearZombieAiTimers(room: Room) {
  const prefix = `${room.id}:`;
  for (const key of zombieAiTimers.keys()) {
    if (key.startsWith(prefix)) zombieAiTimers.delete(key);
  }
}

function zombieSpeed(type: ZombieType, wave: number) {
  const base = type === 'runner' ? 166 : type === 'tanker' ? 76 : 102;
  return base + Math.min(wave, 10) * 6;
}

function zombieScore(type: ZombieType) {
  return ZOMBIE_SCORE[type];
}

function normalize(vector: Vec2): Vec2 {
  const size = length(vector);
  if (size <= 0.001) return { x: 0, y: 0 };
  return { x: vector.x / size, y: vector.y / size };
}

function length(vector: Vec2) {
  return Math.hypot(vector.x, vector.y);
}

function distance(a: Vec2, b: Vec2) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clampToMap(room: Room, point: Vec2, radius: number): Vec2 {
  return {
    x: clamp(point.x, radius, room.map.width - radius),
    y: clamp(point.y, radius, room.map.height - radius)
  };
}

function movePlayerWithSlide(room: Room, position: Vec2, direction: Vec2, speed: number) {
  const step = speed * DT;
  if (length(direction) <= 0) return position;

  const diagonal = clampToMap(room, {
    x: position.x + direction.x * step,
    y: position.y + direction.y * step
  }, PLAYER_RADIUS);
  if (canPlayerOccupy(room, diagonal)) return diagonal;

  const xOnly = clampToMap(room, {
    x: position.x + direction.x * step,
    y: position.y
  }, PLAYER_RADIUS);
  const yOnly = clampToMap(room, {
    x: position.x,
    y: position.y + direction.y * step
  }, PLAYER_RADIUS);
  const canMoveX = Math.abs(direction.x) > 0.001 && canPlayerOccupy(room, xOnly);
  const canMoveY = Math.abs(direction.y) > 0.001 && canPlayerOccupy(room, yOnly);

  if (canMoveX && canMoveY) {
    return Math.abs(direction.x) >= Math.abs(direction.y) ? xOnly : yOnly;
  }
  if (canMoveX) return xOnly;
  if (canMoveY) return yOnly;
  return position;
}

function canPlayerOccupy(room: Room, point: Vec2) {
  return !collidesWithWalls(point, PLAYER_RADIUS, room.walls) && !collidesWithFacilities(room, point, PLAYER_RADIUS);
}

function moveZombieAroundWalls(room: Room, zombie: Zombie, desired: Vec2, targetPoint: Vec2, speed: number) {
  const step = speed * DT;
  const candidates = [
    desired,
    rotate(desired, Math.PI / 5),
    rotate(desired, -Math.PI / 5),
    rotate(desired, Math.PI / 2),
    rotate(desired, -Math.PI / 2),
    { x: desired.x, y: 0 },
    { x: 0, y: desired.y },
    normalize({
      x: room.map.width / 2 - zombie.position.x,
      y: room.map.height / 2 - zombie.position.y
    })
  ]
    .map(normalize)
    .filter((candidate) => length(candidate) > 0);

  const best = candidates
    .map((candidate) => {
      const point = clampToMap(room, {
        x: zombie.position.x + candidate.x * step,
        y: zombie.position.y + candidate.y * step
      }, ZOMBIE_RADIUS);
      const blocked = collidesWithWalls(point, ZOMBIE_RADIUS, room.walls) || collidesWithFacilities(room, point, ZOMBIE_RADIUS);
      const goalDistance = distance(point, targetPoint);
      const alignment = candidate.x * desired.x + candidate.y * desired.y;
      return { point, blocked, score: goalDistance - alignment * 18 };
    })
    .filter((candidate) => !candidate.blocked)
    .sort((a, b) => a.score - b.score)[0];

  if (best) return best.point;
  if (zombie.type === 'tanker') damageBlockingWall(room, zombie, targetPoint);
  return zombie.position;
}

function moveZombieWithPatterns(room: Room, zombie: Zombie, desired: Vec2, targetPoint: Vec2, speed: number) {
  const state = getZombieAiState(room, zombie);
  const now = Date.now() / 1000;
  const targetDistance = distance(zombie.position, targetPoint);

  if (now >= state.nextSpecialAt) {
    if (zombie.type === 'runner' && targetDistance > 120 && targetDistance < 520) {
      state.dashUntil = now + 0.34;
      state.dashDirection = desired;
      state.nextSpecialAt = now + 2.8 + Math.random() * 2.2;
      pushFeedback(room, 'hit', zombie.position, '돌진', 0.18);
    } else if (zombie.type === 'normal' && now >= state.leapCooldownUntil && targetDistance < 460) {
      const leaped = tryLeapWall(room, zombie, desired);
      state.leapCooldownUntil = now + 5.5 + Math.random() * 2.5;
      state.nextSpecialAt = now + 3.2 + Math.random() * 2.4;
      if (leaped) return zombie.position;
    } else {
      state.nextSpecialAt = now + 2.6 + Math.random() * 2.8;
    }
  }

  if (now < state.dashUntil) {
    const dashPoint = clampToMap(room, {
      x: zombie.position.x + state.dashDirection.x * speed * 2.5 * DT,
      y: zombie.position.y + state.dashDirection.y * speed * 2.5 * DT
    }, ZOMBIE_RADIUS);
    if (!collidesWithWalls(dashPoint, ZOMBIE_RADIUS, room.walls) && !collidesWithFacilities(room, dashPoint, ZOMBIE_RADIUS)) return dashPoint;
    state.dashUntil = 0;
  }

  return moveZombieAroundWalls(room, zombie, desired, targetPoint, speed);
}

function getZombieAiState(room: Room, zombie: Zombie) {
  const key = zombieAiKey(room, zombie);
  let state = zombieAiTimers.get(key);
  if (!state) {
    const now = Date.now() / 1000;
    state = {
      nextSpecialAt: now + 1.2 + Math.random() * 3.2,
      dashUntil: 0,
      dashDirection: { x: 0, y: 0 },
      leapCooldownUntil: 0
    };
    zombieAiTimers.set(key, state);
  }
  return state;
}

function zombieAiKey(room: Room, zombie: Zombie) {
  return `${room.id}:${zombie.id}`;
}

function tryLeapWall(room: Room, zombie: Zombie, desired: Vec2) {
  const nearWall = room.walls
    .filter((wall) => !isOuterWall(room, wall))
    .some((wall) => circleRect(zombie.position, ZOMBIE_RADIUS + 24, wall));
  if (!nearWall) return false;

  const landing = clampToMap(room, {
    x: zombie.position.x + desired.x * 76,
    y: zombie.position.y + desired.y * 76
  }, ZOMBIE_RADIUS);
  if (collidesWithWalls(landing, ZOMBIE_RADIUS, room.walls) || collidesWithFacilities(room, landing, ZOMBIE_RADIUS)) return false;
  zombie.position = landing;
  pushFeedback(room, 'hit', landing, '도약', 0.18);
  return true;
}

function rotate(vector: Vec2, angle: number): Vec2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: vector.x * cos - vector.y * sin,
    y: vector.x * sin + vector.y * cos
  };
}

function collidesWithWalls(point: Vec2, radius: number, activeWalls = MAP_PRESETS.timedSurvival.walls) {
  return activeWalls.some((wall) => circleRect(point, radius, wall));
}

function collidesWithMapBounds(room: Room, point: Vec2, radius: number) {
  return point.x < radius || point.y < radius || point.x > room.map.width - radius || point.y > room.map.height - radius;
}

function damageBlockingWall(room: Room, zombie: Zombie, targetPoint: Vec2) {
  const dir = normalize({ x: targetPoint.x - zombie.position.x, y: targetPoint.y - zombie.position.y });
  const probe = {
    x: zombie.position.x + dir.x * (ZOMBIE_RADIUS + 12),
    y: zombie.position.y + dir.y * (ZOMBIE_RADIUS + 12)
  };
  const wall = room.walls
    .filter((candidate) => !isOuterWall(room, candidate))
    .filter((candidate) => circleRect(probe, ZOMBIE_RADIUS + 8, candidate) || circleRect(zombie.position, ZOMBIE_RADIUS + 8, candidate))
    .sort((a, b) => distance(rectCenter(a), targetPoint) - distance(rectCenter(b), targetPoint))[0];
  if (!wall) return;
  const key = wallKey(wall);
  const nextHp = (room.wallHp.get(key) ?? wallHp(wall)) - (18 + room.wave * 2) * DT;
  room.wallHp.set(key, nextHp);
  if (nextHp > 0) return;
  room.walls = room.walls.filter((candidate) => wallKey(candidate) !== key);
  room.wallHp.delete(key);
  pushFeedback(room, 'hit', rectCenter(wall), '파괴', 0.15);
}

function wallHp(wall: Wall) {
  return Math.max(70, Math.min(180, (wall.width + wall.height) * 0.28));
}

function wallKey(wall: Wall) {
  return `${wall.x}:${wall.y}:${wall.width}:${wall.height}`;
}

function isOuterWall(room: Room, wall: Wall) {
  return wall.x <= 0 || wall.y <= 0 || wall.x + wall.width >= room.map.width || wall.y + wall.height >= room.map.height;
}

function rectCenter(wall: Wall): Vec2 {
  return {
    x: wall.x + wall.width / 2,
    y: wall.y + wall.height / 2
  };
}

function collidesWithFacilities(room: Room, point: Vec2, radius: number) {
  return room.facilities.some((facility) => {
    if (facility.type === 'medStation') return false;
    if (facility.width && facility.height) return circleRect(point, radius, facilityRect(facility));
    return distance(point, facility.position) < radius + FACILITY_RADIUS;
  });
}

function rectCollidesWithFacilities(room: Room, rect: Wall) {
  return room.facilities.some((facility) => {
    if (facility.type === 'medStation') return false;
    return rectsOverlap(rect, facilityRect(facility));
  });
}

function rectCollidesWithWalls(rect: Wall, activeWalls = MAP_PRESETS.timedSurvival.walls) {
  return activeWalls.some((wall) => rectsOverlap(rect, wall));
}

function facilityRect(facility: Pick<Facility, 'position' | 'width' | 'height'>): Wall {
  const width = facility.width ?? FACILITY_RADIUS * 2;
  const height = facility.height ?? FACILITY_RADIUS * 2;
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

function circleRect(point: Vec2, radius: number, rect: Wall) {
  const closestX = clamp(point.x, rect.x, rect.x + rect.width);
  const closestY = clamp(point.y, rect.y, rect.y + rect.height);
  return distance(point, { x: closestX, y: closestY }) < radius;
}

app.get('/api/rooms', (_req, res) => {
  res.json(roomSummaries());
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    players: [...rooms.values()].reduce((total, room) => total + room.players.size, 0),
    uptimeSec: Math.floor(process.uptime())
  });
});

io.on('connection', (socket) => {
  socket.emit('roomList', roomSummaries());

  socket.on('requestRoomList', (reply) => {
    const summaries = roomSummaries();
    if (reply) reply(summaries);
    else socket.emit('roomList', summaries);
  });

  socket.on('joinRoom', (payload) => {
    const roomId = payload.roomId?.trim().toUpperCase() || makeRoomId();
    const existing = rooms.get(roomId);
    const room = existing ?? createRoom(roomId, payload.settings, payload.roomTitle);
    if (!existing) rooms.set(roomId, room);
    if (room.phase !== 'lobby' && room.phase !== 'ended') {
      socket.emit('errorMessage', '진행 중인 방에는 입장할 수 없습니다.');
      return;
    }
    if (room.players.size >= room.settings.maxPlayers) {
      socket.emit('errorMessage', '방 정원이 가득 찼습니다.');
      return;
    }

    socket.join(room.id);
    socketRooms.set(socket.id, room.id);
    const player = createPlayer(socket.id, payload.nickname, room.players.size === 0, payload.avatarId);
    player.position = randomFreePosition(room.walls, room.map);
    room.players.set(socket.id, player);
    socket.emit('joined', { roomId: room.id, playerId: socket.id });
    broadcast(room);
    broadcastRoomList();
  });

  socket.on('setReady', (ready) => {
    const room = getSocketRoom(socket.id);
    const player = room?.players.get(socket.id);
    if (!room || !player || room.phase !== 'lobby') return;
    player.ready = ready;
    const players = [...room.players.values()];
    if (players.length > 0 && players.every((candidate) => candidate.ready)) startCountdown(room);
    broadcast(room);
    broadcastRoomList();
  });

  socket.on('updateSettings', (settings) => {
    const room = getSocketRoom(socket.id);
    const player = room?.players.get(socket.id);
    if (!room || !player?.host || room.phase !== 'lobby') return;
    room.settings = sanitizeSettings(settings);
    room.remainingSec = room.settings.gameMode === 'endless' ? 0 : room.settings.gameDurationSec;
    room.map = mapForMode(room.settings.gameMode);
    room.walls = wallsForMode(room.settings.gameMode);
    for (const candidate of room.players.values()) candidate.position = randomFreePosition(room.walls, room.map);
    broadcast(room);
    broadcastRoomList();
  });

  socket.on('chooseUpgrade', (upgradeId) => {
    const room = getSocketRoom(socket.id);
    const player = room?.players.get(socket.id);
    if (!room || !player || room.phase !== 'playing') return;
    chooseUpgrade(room, player, upgradeId);
    broadcast(room);
  });

  socket.on('pauseGame', (paused) => {
    const room = getSocketRoom(socket.id);
    const player = room?.players.get(socket.id);
    if (!room || !player?.host) return;
    if (paused && room.phase === 'playing') {
      room.phase = 'paused';
      broadcast(room);
      return;
    }
    if (!paused && room.phase === 'paused') {
      room.phase = 'playing';
      broadcast(room);
    }
  });

  socket.on('restartGame', () => {
    const room = getSocketRoom(socket.id);
    const player = room?.players.get(socket.id);
    if (!room || !player?.host || room.phase !== 'ended') return;
    for (const candidate of room.players.values()) candidate.ready = false;
    startCountdown(room);
    broadcast(room);
  });

  socket.on('input', (input) => {
    const room = getSocketRoom(socket.id);
    if (!room || room.phase !== 'playing') return;
    room.inputs.set(socket.id, input);
  });

  socket.on('leaveRoom', () => leave(socket.id));
  socket.on('disconnect', () => leave(socket.id));
});

function getSocketRoom(socketId: string) {
  const roomId = socketRooms.get(socketId);
  return roomId ? rooms.get(roomId) : undefined;
}

function leave(socketId: string) {
  const room = getSocketRoom(socketId);
  if (!room) return;
  killTimers.delete(comboKey(room, socketId));
  clearEquipmentTimers(room, socketId);
  clearFeedbackTimers(room, socketId);
  room.players.delete(socketId);
  room.inputs.delete(socketId);
  room.processedItemRequests.delete(socketId);
  room.processedCraftRequests.delete(socketId);
  room.processedSupportRequests.delete(socketId);
  socketRooms.delete(socketId);
  const nextHost = room.players.values().next().value as Player | undefined;
  if (nextHost) nextHost.host = true;
  if (room.players.size === 0) {
    clearZombieAiTimers(room);
    rooms.delete(room.id);
    broadcastRoomList();
    return;
  }
  broadcast(room);
  broadcastRoomList();
}

let loopFrame = 0;
setInterval(() => {
  loopFrame += 1;
  for (const room of rooms.values()) {
    tickRoom(room);
    broadcast(room);
  }
}, 1000 / TICK_RATE);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDist = path.resolve(process.cwd(), 'dist/client');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Zombie Office Survival server listening on ${PORT}`);
});
