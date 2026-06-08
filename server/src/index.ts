import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  Facility,
  FacilityType,
  GamePhase,
  FeedbackEvent,
  GameSnapshot,
  Player,
  PlayerInput,
  ResourceInventory,
  ResourceNode,
  ResourceType,
  RoomSettings,
  ServerToClientEvents,
  Vec2,
  Wall,
  Zombie,
  ZombieType
} from '../../shared/src/types.js';

type Room = {
  id: string;
  phase: GamePhase;
  settings: RoomSettings;
  players: Map<string, Player>;
  inputs: Map<string, PlayerInput>;
  zombies: Zombie[];
  resources: ResourceNode[];
  facilities: Facility[];
  projectiles: GameSnapshot['projectiles'];
  feedbackEvents: Array<FeedbackEvent & { ttl: number }>;
  wave: number;
  countdown: number;
  remainingSec: number;
  startedAt: number;
  lastWaveAt: number;
  nextZombieSpawnAt: number;
  nextResourceSpawnAt: number;
  walls: Wall[];
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
const DEFAULT_SETTINGS: RoomSettings = {
  maxPlayers: 6,
  gameDurationSec: 180,
  pvpEnabled: false
};

const rooms = new Map<string, Room>();
const socketRooms = new Map<string, string>();

const walls: Wall[] = [
  { x: 0, y: 0, width: MAP_WIDTH, height: 24 },
  { x: 0, y: MAP_HEIGHT - 24, width: MAP_WIDTH, height: 24 },
  { x: 0, y: 0, width: 24, height: MAP_HEIGHT },
  { x: MAP_WIDTH - 24, y: 0, width: 24, height: MAP_HEIGHT },
  { x: 360, y: 120, width: 22, height: 360 },
  { x: 680, y: 0, width: 22, height: 300 },
  { x: 980, y: 190, width: 22, height: 360 },
  { x: 1200, y: 560, width: 22, height: 320 },
  { x: 220, y: 650, width: 420, height: 22 },
  { x: 720, y: 520, width: 500, height: 22 },
  { x: 1100, y: 120, width: 300, height: 22 }
];

function createRoom(id: string, settings?: Partial<RoomSettings>): Room {
  return {
    id,
    phase: 'lobby',
    settings: sanitizeSettings({ ...DEFAULT_SETTINGS, ...settings }),
    players: new Map(),
    inputs: new Map(),
    zombies: [],
    resources: [],
    facilities: [],
    projectiles: [],
    feedbackEvents: [],
    wave: 1,
    countdown: 0,
    remainingSec: DEFAULT_SETTINGS.gameDurationSec,
    startedAt: 0,
    lastWaveAt: 0,
    nextZombieSpawnAt: 0,
    nextResourceSpawnAt: 0,
    walls
  };
}

function sanitizeSettings(settings: RoomSettings): RoomSettings {
  return {
    maxPlayers: clamp(Math.round(settings.maxPlayers), 2, 8),
    gameDurationSec: clamp(Math.round(settings.gameDurationSec), 60, 600),
    pvpEnabled: Boolean(settings.pvpEnabled)
  };
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
    position: randomFreePosition(),
    aim: { x: 1, y: 0 },
    score: 0,
    kills: 0,
    inventory: emptyInventory(),
    resourcesCollected: 0,
    facilitiesBuilt: 0,
    survivalSec: 0
  };
}

function emptyInventory(): ResourceInventory {
  return {
    chairParts: 0,
    deskParts: 0,
    partitionMaterial: 0,
    powerModule: 0,
    medKit: 0
  };
}

function sanitizeAvatarId(avatarId: number) {
  return clamp(Math.round(Number.isFinite(avatarId) ? avatarId : 0), 0, 3);
}

function randomFreePosition(): Vec2 {
  for (let i = 0; i < 80; i += 1) {
    const point = {
      x: 80 + Math.random() * (MAP_WIDTH - 160),
      y: 80 + Math.random() * (MAP_HEIGHT - 160)
    };
    if (!collidesWithWalls(point, PLAYER_RADIUS)) return point;
  }
  return { x: 120, y: 120 };
}

function snapshot(room: Room): GameSnapshot {
  return {
    roomId: room.id,
    phase: room.phase,
    settings: room.settings,
    players: [...room.players.values()],
    zombies: room.zombies,
    resources: room.resources,
    facilities: room.facilities,
    projectiles: room.projectiles,
    walls: room.walls,
    feedbackEvents: room.feedbackEvents.map(({ ttl: _ttl, ...event }) => event),
    wave: room.wave,
    countdown: Math.ceil(room.countdown),
    remainingSec: Math.max(0, Math.ceil(room.remainingSec)),
    map: { width: MAP_WIDTH, height: MAP_HEIGHT }
  };
}

function broadcast(room: Room) {
  io.to(room.id).emit('snapshot', snapshot(room));
}

function startCountdown(room: Room) {
  room.phase = 'countdown';
  room.countdown = 3;
}

function startGame(room: Room) {
  room.phase = 'playing';
  room.wave = 1;
  room.remainingSec = room.settings.gameDurationSec;
  room.startedAt = Date.now();
  room.lastWaveAt = 0;
  room.nextZombieSpawnAt = 0;
  room.nextResourceSpawnAt = 0;
  room.zombies = [];
  room.projectiles = [];
  room.facilities = [];
  room.feedbackEvents = [];
  room.resources = Array.from({ length: 20 }, () => createResource());
  for (const player of room.players.values()) {
    player.ready = false;
    player.alive = true;
    player.hp = 100;
    player.position = randomFreePosition();
    player.score = 0;
    player.kills = 0;
    player.inventory = emptyInventory();
    player.resourcesCollected = 0;
    player.facilitiesBuilt = 0;
    player.survivalSec = 0;
  }
}

function endGame(room: Room) {
  room.phase = 'ended';
  const alive = [...room.players.values()].filter((player) => player.alive);
  if (alive.length === 1) alive[0].score += 50;
}

function tickRoom(room: Room) {
  if (room.phase === 'lobby') return;

  if (room.phase === 'countdown') {
    room.countdown -= DT;
    if (room.countdown <= 0) startGame(room);
    return;
  }

  if (room.phase !== 'playing') return;

  room.remainingSec -= DT;
  const elapsed = room.settings.gameDurationSec - room.remainingSec;
  room.wave = 1 + Math.floor(elapsed / 30);
  updatePlayers(room);
  updateProjectiles(room);
  updateZombies(room);
  spawnWorld(room, elapsed);
  updateFeedbackEvents(room);
  applySurvivalScore(room, elapsed);

  const aliveCount = [...room.players.values()].filter((player) => player.alive).length;
  if (room.remainingSec <= 0 || aliveCount === 0) endGame(room);
}

function updatePlayers(room: Room) {
  for (const player of room.players.values()) {
    if (!player.alive) continue;
    const input = room.inputs.get(player.id);
    if (!input) continue;

    const move = normalize(input.move);
    const next = {
      x: player.position.x + move.x * 220 * DT,
      y: player.position.y + move.y * 220 * DT
    };
    if (!collidesWithWalls(next, PLAYER_RADIUS) && !collidesWithFacilities(room, next, PLAYER_RADIUS)) {
      player.position = clampToMap(next, PLAYER_RADIUS);
    }
    const aim = normalize(input.aim);
    if (length(aim) > 0) player.aim = aim;

    if (input.shooting && canAct(room, player.id, 'shoot', 0.62)) {
      room.projectiles.push({
        id: makeId('shot'),
        ownerId: player.id,
        position: { ...player.position },
        velocity: { x: player.aim.x * 620, y: player.aim.y * 620 },
        ttl: 0.9
      });
    }
    if (input.melee && canAct(room, player.id, 'melee', 0.36)) {
      meleeAttack(room, player);
    }
    if (input.build) buildFacility(room, player, input.build);

    collectResources(room, player);
    useMedStations(room, player);
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
  for (const zombie of room.zombies) {
    if (distance(player.position, zombie.position) < 66) damageZombie(room, zombie, 24, player.id);
  }
  if (!room.settings.pvpEnabled) return;
  for (const target of room.players.values()) {
    if (target.id !== player.id && target.alive && distance(player.position, target.position) < 58) {
      damagePlayer(room, target, 20, player);
    }
  }
}

function buildFacility(room: Room, player: Player, type: FacilityType) {
  if (!canAct(room, player.id, `build:${type}`, 0.6)) return;
  const cost = facilityCost(type);
  if (!hasResources(player.inventory, cost)) return;
  const position = {
    x: player.position.x + player.aim.x * 52,
    y: player.position.y + player.aim.y * 52
  };
  if (collidesWithWalls(position, FACILITY_RADIUS) || collidesWithFacilities(room, position, FACILITY_RADIUS)) return;
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
  if (type === 'partitionBarricade') return { chairParts: 1, partitionMaterial: 1 };
  if (type === 'deskBarricade') return { deskParts: 2, partitionMaterial: 1 };
  if (type === 'medStation') return { medKit: 1, deskParts: 1 };
  return { powerModule: 1, partitionMaterial: 2 };
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
  if (type === 'deskBarricade') return 190;
  if (type === 'partitionBarricade') return 130;
  if (type === 'medStation') return 120;
  return 110;
}

function collectResources(room: Room, player: Player) {
  const before = room.resources.length;
  room.resources = room.resources.filter((resource) => {
    if (distance(player.position, resource.position) < PLAYER_RADIUS + RESOURCE_RADIUS) {
      player.inventory[resource.type] += 1;
      player.resourcesCollected += 1;
      const score = resource.type === 'medKit' ? 6 : 4;
      player.score += score;
      pushFeedback(room, 'collect', resource.position, `+${score}`);
      if (resource.type === 'medKit') {
        player.hp = Math.min(100, player.hp + 25);
        pushFeedback(room, 'heal', player.position, '+HP');
      }
      return false;
    }
    return true;
  });
  if (before !== room.resources.length) room.nextResourceSpawnAt = Math.min(room.nextResourceSpawnAt, 1);
}

function useMedStations(room: Room, player: Player) {
  for (const facility of room.facilities) {
    if (facility.type === 'medStation' && distance(player.position, facility.position) < 74) {
      player.hp = Math.min(100, player.hp + 10 * DT);
    }
  }
}

function updateProjectiles(room: Room) {
  const live = [];
  for (const projectile of room.projectiles) {
    projectile.ttl -= DT;
    projectile.position.x += projectile.velocity.x * DT;
    projectile.position.y += projectile.velocity.y * DT;
    if (projectile.ttl <= 0 || collidesWithWalls(projectile.position, PROJECTILE_RADIUS)) continue;

    let hit = false;
    const owner = room.players.get(projectile.ownerId);
    const damage = owner && hasPowerBuff(room, owner) ? 18 : 12;
    for (const zombie of room.zombies) {
      if (distance(projectile.position, zombie.position) < ZOMBIE_RADIUS + PROJECTILE_RADIUS) {
        damageZombie(room, zombie, damage, projectile.ownerId);
        hit = true;
        break;
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

function updateZombies(room: Room) {
  for (const zombie of room.zombies) {
    const target = nearestAlivePlayer(room, zombie.position);
    if (!target) continue;
    const blockingFacility = nearestFacility(room, zombie.position);
    const targetPoint = blockingFacility && distance(blockingFacility.position, zombie.position) < 70 ? blockingFacility.position : target.position;
    const dir = normalize({ x: targetPoint.x - zombie.position.x, y: targetPoint.y - zombie.position.y });
    const next = {
      x: zombie.position.x + dir.x * zombieSpeed(zombie.type, room.wave) * DT,
      y: zombie.position.y + dir.y * zombieSpeed(zombie.type, room.wave) * DT
    };

    if (!collidesWithWalls(next, ZOMBIE_RADIUS)) zombie.position = clampToMap(next, ZOMBIE_RADIUS);

    for (const facility of room.facilities) {
      if (distance(zombie.position, facility.position) < ZOMBIE_RADIUS + FACILITY_RADIUS) {
        facility.hp -= 14 * DT;
      }
    }
    if (distance(zombie.position, target.position) < ZOMBIE_RADIUS + PLAYER_RADIUS) {
      const biteDamage = zombie.type === 'tanker' ? 16 * DT : zombie.type === 'runner' ? 11 * DT : 8 * DT;
      damagePlayer(room, target, biteDamage);
    }
  }
  room.facilities = room.facilities.filter((facility) => facility.hp > 0);
  room.zombies = room.zombies.filter((zombie) => zombie.hp > 0);
}

function damageZombie(room: Room, zombie: Zombie, damage: number, attackerId: string) {
  zombie.hp -= damage;
  pushFeedback(room, 'hit', zombie.position, `${Math.round(damage)}`);
  if (zombie.hp > 0) return;
  const attacker = room.players.get(attackerId);
  if (!attacker) return;
  attacker.kills += 1;
  const score = zombieScore(zombie.type);
  attacker.score += score;
  pushFeedback(room, 'kill', zombie.position, `+${score}`);
}

function damagePlayer(room: Room, target: Player, damage: number, attacker?: Player) {
  if (!target.alive) return;
  target.hp -= damage;
  if (target.hp > 0) return;
  target.hp = 0;
  target.alive = false;
  if (attacker && attacker.id !== target.id) attacker.score += 40;
  pushFeedback(room, 'playerDown', target.position, 'DOWN');
}

function spawnWorld(room: Room, elapsed: number) {
  room.nextZombieSpawnAt -= DT;
  room.nextResourceSpawnAt -= DT;
  if (room.nextZombieSpawnAt <= 0) {
    const aliveCount = [...room.players.values()].filter((player) => player.alive).length;
    const count = Math.min(2 + Math.ceil(room.wave * 0.75) + Math.max(0, aliveCount - 1), 11);
    for (let i = 0; i < count; i += 1) room.zombies.push(createZombie(room.wave));
    room.nextZombieSpawnAt = Math.max(3.2, 6.5 - room.wave * 0.35);
  }
  if (room.nextResourceSpawnAt <= 0 && room.resources.length < 30) {
    room.resources.push(createResource());
    room.nextResourceSpawnAt = 2.4 + Math.random() * 3.6;
  }
  room.lastWaveAt = elapsed;
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

function pushFeedback(room: Room, type: FeedbackEvent['type'], position: Vec2, text: string) {
  room.feedbackEvents.push({
    id: makeId('fx'),
    type,
    position: { ...position },
    text,
    ttl: 0.8
  });
  if (room.feedbackEvents.length > 80) room.feedbackEvents.splice(0, room.feedbackEvents.length - 80);
}

function updateFeedbackEvents(room: Room) {
  room.feedbackEvents = room.feedbackEvents
    .map((event) => ({ ...event, ttl: event.ttl - DT }))
    .filter((event) => event.ttl > 0);
}

function createZombie(wave: number): Zombie {
  const roll = Math.random();
  const tankerChance = wave >= 4 ? Math.min(0.08 + wave * 0.025, 0.24) : 0;
  const runnerChance = wave >= 2 ? Math.min(0.22 + wave * 0.035, 0.46) : 0;
  const type: ZombieType = roll < tankerChance ? 'tanker' : roll < tankerChance + runnerChance ? 'runner' : 'normal';
  return {
    id: makeId('zombie'),
    type,
    hp: type === 'tanker' ? 100 : type === 'runner' ? 20 : 30,
    position: randomEdgePosition()
  };
}

function createResource(): ResourceNode {
  const types: ResourceType[] = ['chairParts', 'deskParts', 'partitionMaterial', 'powerModule', 'medKit'];
  return {
    id: makeId('resource'),
    type: types[Math.floor(Math.random() * types.length)],
    position: randomFreePosition()
  };
}

function randomEdgePosition(): Vec2 {
  const side = Math.floor(Math.random() * 4);
  if (side === 0) return { x: Math.random() * MAP_WIDTH, y: 40 };
  if (side === 1) return { x: MAP_WIDTH - 40, y: Math.random() * MAP_HEIGHT };
  if (side === 2) return { x: Math.random() * MAP_WIDTH, y: MAP_HEIGHT - 40 };
  return { x: 40, y: Math.random() * MAP_HEIGHT };
}

function nearestAlivePlayer(room: Room, point: Vec2) {
  return [...room.players.values()]
    .filter((player) => player.alive)
    .sort((a, b) => distance(point, a.position) - distance(point, b.position))[0];
}

function nearestFacility(room: Room, point: Vec2) {
  return room.facilities.sort((a, b) => distance(point, a.position) - distance(point, b.position))[0];
}

function hasPowerBuff(room: Room, player: Player) {
  return room.facilities.some((facility) => facility.type === 'powerAmplifier' && distance(player.position, facility.position) < 140);
}

function zombieSpeed(type: ZombieType, wave: number) {
  const base = type === 'runner' ? 135 : type === 'tanker' ? 60 : 82;
  return base + Math.min(wave, 8) * 4;
}

function zombieScore(type: ZombieType) {
  return type === 'runner' ? 15 : type === 'tanker' ? 30 : 10;
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

function clampToMap(point: Vec2, radius: number): Vec2 {
  return {
    x: clamp(point.x, radius, MAP_WIDTH - radius),
    y: clamp(point.y, radius, MAP_HEIGHT - radius)
  };
}

function collidesWithWalls(point: Vec2, radius: number) {
  return walls.some((wall) => circleRect(point, radius, wall));
}

function collidesWithFacilities(room: Room, point: Vec2, radius: number) {
  return room.facilities.some((facility) => {
    if (facility.type === 'medStation' || facility.type === 'powerAmplifier') return false;
    return distance(point, facility.position) < radius + FACILITY_RADIUS;
  });
}

function circleRect(point: Vec2, radius: number, rect: Wall) {
  const closestX = clamp(point.x, rect.x, rect.x + rect.width);
  const closestY = clamp(point.y, rect.y, rect.y + rect.height);
  return distance(point, { x: closestX, y: closestY }) < radius;
}

io.on('connection', (socket) => {
  socket.on('joinRoom', (payload) => {
    const roomId = payload.roomId?.trim().toUpperCase() || makeRoomId();
    const existing = rooms.get(roomId);
    const room = existing ?? createRoom(roomId, payload.settings);
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
    room.players.set(socket.id, player);
    socket.emit('joined', { roomId: room.id, playerId: socket.id });
    broadcast(room);
  });

  socket.on('setReady', (ready) => {
    const room = getSocketRoom(socket.id);
    const player = room?.players.get(socket.id);
    if (!room || !player || room.phase !== 'lobby') return;
    player.ready = ready;
    const players = [...room.players.values()];
    if (players.length > 0 && players.every((candidate) => candidate.ready)) startCountdown(room);
    broadcast(room);
  });

  socket.on('updateSettings', (settings) => {
    const room = getSocketRoom(socket.id);
    const player = room?.players.get(socket.id);
    if (!room || !player?.host || room.phase !== 'lobby') return;
    room.settings = sanitizeSettings(settings);
    room.remainingSec = room.settings.gameDurationSec;
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
  room.players.delete(socketId);
  room.inputs.delete(socketId);
  socketRooms.delete(socketId);
  const nextHost = room.players.values().next().value as Player | undefined;
  if (nextHost) nextHost.host = true;
  if (room.players.size === 0) {
    rooms.delete(room.id);
    return;
  }
  broadcast(room);
}

setInterval(() => {
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
