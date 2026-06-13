export type GamePhase = 'lobby' | 'countdown' | 'playing' | 'paused' | 'ended';
export type ZombieType = 'normal' | 'runner' | 'tanker';
export type ResourceType = 'chairParts' | 'deskParts' | 'partitionMaterial' | 'medKit';
export type FacilityType = 'partitionBarricade' | 'deskBarricade' | 'medStation';
export type ResourceInventory = Record<ResourceType, number>;
export type UpgradeType = 'range' | 'damage' | 'maxHp' | 'moveSpeed' | 'medKit' | 'partition';

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
  gameDurationSec: number;
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
};

export type Player = {
  id: string;
  nickname: string;
  avatarId: number;
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

export type ResourceNode = {
  id: string;
  type: ResourceType;
  position: Vec2;
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
  resources: ResourceNode[];
  facilities: Facility[];
  powerZones: PowerZone[];
  projectiles: Projectile[];
  walls: Wall[];
  feedbackEvents: FeedbackEvent[];
  wave: number;
  countdown: number;
  remainingSec: number;
  map: {
    width: number;
    height: number;
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
  maxPlayers: number;
  readyCount: number;
  gameDurationSec: number;
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
