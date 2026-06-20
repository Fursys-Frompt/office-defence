export type GamePhase = 'lobby' | 'countdown' | 'playing' | 'paused' | 'ended';
export type GameMode = 'timedSurvival' | 'endless' | 'killTarget' | 'supplyDefense';
export type GameDifficulty = 'easy' | 'normal' | 'hard';
export type MapTheme = 'officeGrid' | 'serviceLoop' | 'killArena';
export type ZombieType = 'normal' | 'runner' | 'tanker';
export type CraftMaterialType = 'keycapSet' | 'paperBundle' | 'officeMotor' | 'batteryPack' | 'rubberPart' | 'approvalKit';
export type ResourceType = 'partitionMaterial' | 'mixCoffee' | CraftMaterialType;
export type FacilityType = 'partitionBarricade' | 'deskBarricade' | 'medStation' | 'supplyCache';
export type ResourceInventory = Record<ResourceType, number>;
export type UpgradeType =
  | 'range'
  | 'damage'
  | 'maxHp'
  | 'moveSpeed'
  | 'coffee'
  | 'partition'
  | 'supply'
  | 'nightMove'
  | 'resourceSense'
  | 'partitionReinforce'
  | 'finisher';
export type WeaponType = 'keyboardShotgun' | 'printerCannon' | 'plunger' | 'corporateCardBoomerang' | 'guardFlashlight';
export type SupportEquipmentType = 'robotVacuumDrone' | 'mzKeycap' | 'annualLeaveShield' | 'emergencyAed';
export type WavePhase = 'combat' | 'break';
export type DayNightPhase = 'day' | 'dusk' | 'night' | 'dawn';

export type UpgradeOption = {
  id: string;
  type: UpgradeType;
  title: string;
  description: string;
};

export type PlayerUpgrades = Record<UpgradeType, number>;

export type Vec2 = {
  x: number;
  y: number;
};

export type RoomSettings = {
  maxPlayers: number;
  gameMode: GameMode;
  difficulty: GameDifficulty;
  gameDurationSec: number;
  killTarget: number;
  pvpEnabled: boolean;
};

export type PlayerInput = {
  move: Vec2;
  aim: Vec2;
  shooting: boolean;
  melee: boolean;
  useItem?: ResourceType;
  useItemRequestId?: number;
  build?: FacilityType;
  craftWeapon?: WeaponType;
  equipWeapon?: WeaponType;
  craftSupport?: SupportEquipmentType;
  equipSupport?: SupportEquipmentType;
  activateSupport?: SupportEquipmentType;
  craftRequestId?: number;
  supportRequestId?: number;
};

export type Player = {
  id: string;
  nickname: string;
  avatarId: number;
  spectator?: boolean;
  ready: boolean;
  host: boolean;
  alive: boolean;
  hp: number;
  maxHp: number;
  position: Vec2;
  aim: Vec2;
  score: number;
  kills: number;
  combo: number;
  level: number;
  nextLevelKills: number;
  pendingUpgradeChoices: UpgradeOption[];
  pendingUpgradeCount: number;
  upgrades: PlayerUpgrades;
  inventory: ResourceInventory;
  craftedWeapons: WeaponType[];
  weaponLevels: Partial<Record<WeaponType, number>>;
  equippedWeapon?: WeaponType;
  craftedSupportEquipment: SupportEquipmentType[];
  supportEquipmentLevels: Partial<Record<SupportEquipmentType, number>>;
  equippedSupportEquipment?: SupportEquipmentType;
  activeSupportEquipment?: SupportEquipmentType;
  supportExpiresAt?: number;
  resourcesCollected: number;
  facilitiesBuilt: number;
  survivalSec: number;
};

export type Zombie = {
  id: string;
  type: ZombieType;
  hp: number;
  position: Vec2;
};

export type SpawnWarning = {
  id: string;
  type: ZombieType;
  position: Vec2;
  ttl: number;
  duration: number;
};

export type ResourceNode = {
  id: string;
  type: ResourceType;
  position: Vec2;
};

export type CraftingStation = {
  id: string;
  position: Vec2;
  width: number;
  height: number;
  interactionRadius: number;
};

export type Facility = {
  id: string;
  type: FacilityType;
  ownerId: string;
  hp: number;
  position: Vec2;
  width?: number;
  height?: number;
};

export type PowerZone = {
  id: string;
  ownerId: string;
  position: Vec2;
  radius: number;
  ttl: number;
};

export type Projectile = {
  id: string;
  ownerId: string;
  position: Vec2;
  velocity: Vec2;
  ttl: number;
  variant?: WeaponType | 'default';
  damage?: number;
  radius?: number;
  pierce?: number;
};

export type SupportZone = {
  id: string;
  ownerId: string;
  type: SupportEquipmentType;
  position: Vec2;
  radius: number;
  ttl: number;
};

export type SafeZone = {
  id: string;
  ownerId: string;
  position: Vec2;
  radius: number;
  hp: number;
  maxHp: number;
};

export type Wall = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FeedbackEventType = 'hit' | 'kill' | 'collect' | 'build' | 'heal' | 'playerDown';

export type FeedbackEvent = {
  id: string;
  type: FeedbackEventType;
  position: Vec2;
  text: string;
};

export type GameSnapshot = {
  roomId: string;
  roomTitle: string;
  phase: GamePhase;
  settings: RoomSettings;
  players: Player[];
  results: Player[];
  zombies: Zombie[];
  spawnWarnings: SpawnWarning[];
  resources: ResourceNode[];
  craftingStations: CraftingStation[];
  facilities: Facility[];
  powerZones: PowerZone[];
  supportZones: SupportZone[];
  safeZones: SafeZone[];
  projectiles: Projectile[];
  walls: Wall[];
  feedbackEvents: FeedbackEvent[];
  wave: number;
  wavePhase: WavePhase;
  waveTimeRemaining: number;
  dayNightProgress: number;
  nightIntensity: number;
  dayNightPhase: DayNightPhase;
  countdown: number;
  remainingSec: number;
  elapsedSec: number;
  objective: {
    mode: GameMode;
    label: string;
    current: number;
    target?: number;
    completed: boolean;
    failed: boolean;
  };
  map: {
    width: number;
    height: number;
    name: string;
    theme: MapTheme;
  };
};

export type JoinRoomPayload = {
  roomId?: string;
  roomTitle?: string;
  nickname: string;
  avatarId?: number;
  settings?: RoomSettings;
};

export type RoomSummary = {
  roomId: string;
  roomTitle: string;
  phase: GamePhase;
  playerCount: number;
  spectatorCount: number;
  maxPlayers: number;
  readyCount: number;
  gameMode: GameMode;
  difficulty: GameDifficulty;
  gameDurationSec: number;
  killTarget: number;
  pvpEnabled: boolean;
  hostNickname: string;
};

export type ServerToClientEvents = {
  joined: (payload: { roomId: string; playerId: string }) => void;
  snapshot: (snapshot: GameSnapshot) => void;
  roomList: (rooms: RoomSummary[]) => void;
  errorMessage: (message: string) => void;
};

export type ClientToServerEvents = {
  joinRoom: (payload: JoinRoomPayload) => void;
  requestRoomList: (callback?: (rooms: RoomSummary[]) => void) => void;
  setReady: (ready: boolean) => void;
  updateSettings: (settings: RoomSettings) => void;
  chooseUpgrade: (upgradeId: string) => void;
  pauseGame: (paused: boolean) => void;
  restartGame: () => void;
  input: (input: PlayerInput) => void;
  leaveRoom: () => void;
};
