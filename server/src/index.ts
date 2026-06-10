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
import { FACILITY_COSTS, FACILITY_HP, ZOMBIE_SCORE } from '../../shared/src/gameRules.js';

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
  wallHp: Map<string, number>;
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
const killTimers = new Map<string, number>();
const equipmentTimers = new Map<string, number>();
const feedbackTimers = new Map<string, number>();

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
    walls: walls.map((wall) => ({ ...wall })),
    wallHp: new Map()
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
    maxHp: 100,
    position: randomFreePosition(),
    aim: { x: 1, y: 0 },
    score: 0,
    kills: 0,
    combo: 0,
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
  room.nextZombieSpawnAt = 2.2;
  room.nextResourceSpawnAt = 0;
  room.zombies = [];
  room.projectiles = [];
  room.facilities = [];
  room.feedbackEvents = [];
  room.walls = walls.map((wall) => ({ ...wall }));
  room.wallHp = new Map();
  room.resources = Array.from({ length: 20 }, () => createResource());
  for (const player of room.players.values()) {
    killTimers.delete(comboKey(room, player.id));
    clearEquipmentTimers(room, player.id);
    clearFeedbackTimers(room, player.id);
    player.ready = false;
    player.alive = true;
    player.hp = 100;
    player.maxHp = 100;
    player.position = randomFreePosition();
    player.score = 0;
    player.kills = 0;
    player.combo = 0;
    player.inventory = emptyInventory();
    player.inventory.chairParts = 1;
    player.inventory.deskParts = 1;
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
  room.wave = 1 + Math.floor(elapsed / 24);
  updatePlayers(room, elapsed);
  updateProjectiles(room);
  updateZombies(room);
  spawnWorld(room, elapsed);
  updateFeedbackEvents(room);
  applySurvivalScore(room, elapsed);

  const aliveCount = [...room.players.values()].filter((player) => player.alive).length;
  if (room.remainingSec <= 0 || aliveCount === 0) endGame(room);
}

function updatePlayers(room: Room, elapsed: number) {
  for (const player of room.players.values()) {
    if (!player.alive) continue;
    refreshCombo(room, player);
    const input = room.inputs.get(player.id);
    if (!input) continue;

    const move = normalize(input.move);
    const next = {
      x: player.position.x + move.x * 220 * DT,
      y: player.position.y + move.y * 220 * DT
    };
    if (!collidesWithWalls(next, PLAYER_RADIUS, room.walls) && !collidesWithFacilities(room, next, PLAYER_RADIUS)) {
      player.position = clampToMap(next, PLAYER_RADIUS);
    }
    const aim = normalize(input.aim);
    if (length(aim) > 0) player.aim = aim;

    if (input.shooting && canAct(room, player.id, 'shoot', player.combo >= 5 ? 0.44 : 0.52)) {
      room.projectiles.push({
        id: makeId('shot'),
        ownerId: player.id,
        position: { ...player.position },
        velocity: { x: player.aim.x * 700, y: player.aim.y * 700 },
        ttl: 1
      });
    }
    if (input.melee && canAct(room, player.id, 'melee', player.combo >= 4 ? 0.26 : 0.32)) {
      meleeAttack(room, player);
    }

    collectResources(room, player);
    updateEquipment(room, player, elapsed);
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
  const damage = 28 + comboDamageBonus(player);
  for (const zombie of room.zombies) {
    if (distance(player.position, zombie.position) < 72) damageZombie(room, zombie, damage, player.id);
  }
  if (!room.settings.pvpEnabled) return;
  for (const target of room.players.values()) {
    if (target.id !== player.id && target.alive && distance(player.position, target.position) < 58) {
      damagePlayer(room, target, 20 + comboDamageBonus(player), player);
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
  return FACILITY_COSTS[type];
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
  return FACILITY_HP[type];
}

function collectResources(room: Room, player: Player) {
  const before = room.resources.length;
  room.resources = room.resources.filter((resource) => {
    if (distance(player.position, resource.position) < PLAYER_RADIUS + RESOURCE_RADIUS) {
      player.inventory[resource.type] += 1;
      player.resourcesCollected += 1;
      applyEquipmentUpgrade(player, resource.type);
      const score = resource.type === 'medKit' ? 8 : 5;
      player.score += score;
      pushFeedback(room, 'collect', resource.position, `Lv ${player.inventory[resource.type]}`);
      if (resource.type === 'medKit') pushFeedback(room, 'heal', player.position, '회복');
      return false;
    }
    return true;
  });
  if (before !== room.resources.length) room.nextResourceSpawnAt = Math.min(room.nextResourceSpawnAt, 1);
}

function applyEquipmentUpgrade(player: Player, type: ResourceType) {
  if (type !== 'medKit') return;
  player.maxHp = 100 + player.inventory.medKit * 8;
  player.hp = Math.min(player.maxHp, player.hp + 22);
}

function updateEquipment(room: Room, player: Player, elapsed: number) {
  const powerLevel = player.inventory.powerModule;
  const medLevel = player.inventory.medKit;
  if (medLevel > 0) {
    player.maxHp = Math.max(player.maxHp, 100 + medLevel * 8);
    player.hp = Math.min(player.maxHp, player.hp + (0.7 + medLevel * 0.22) * DT);
  }
  updateDeskBarrage(room, player, powerLevel);
  updateChairShield(room, player, powerLevel, elapsed);
  updatePanelGuard(room, player, powerLevel);
}

function updateDeskBarrage(room: Room, player: Player, powerLevel: number) {
  const level = player.inventory.deskParts;
  if (level <= 0) return;
  const cooldown = Math.max(0.24, 1.16 - level * 0.1 - powerLevel * 0.045);
  if (!canEquipmentAct(room, player.id, 'desk', cooldown)) return;
  const targets = nearestZombies(room, player.position, 1 + Math.floor(level / 4), 620 + level * 35);
  const damage = 13 + level * 3 + powerLevel * 2 + comboDamageBonus(player);
  for (const target of targets) {
    const dir = normalize({ x: target.position.x - player.position.x, y: target.position.y - player.position.y });
    room.projectiles.push({
      id: makeId('deskShot'),
      ownerId: player.id,
      position: { ...player.position },
      velocity: { x: dir.x * (720 + powerLevel * 24), y: dir.y * (720 + powerLevel * 24) },
      ttl: 0.9 + Math.min(level, 8) * 0.03
    });
    damageZombie(room, target, damage * 0.18, player.id);
  }
}

function updateChairShield(room: Room, player: Player, powerLevel: number, elapsed: number) {
  const level = player.inventory.chairParts;
  if (level <= 0) return;
  const cooldown = Math.max(0.22, 0.58 - level * 0.025 - powerLevel * 0.015);
  if (!canEquipmentAct(room, player.id, 'chair', cooldown)) return;
  const radius = 58 + level * 7;
  const damage = 7 + level * 2.2 + powerLevel * 0.8;
  for (const zombie of nearestZombies(room, player.position, 10 + Math.floor(level / 2), radius)) {
    damageZombie(room, zombie, damage, player.id);
  }
  if (level >= 3) {
    const orbit = {
      x: player.position.x + Math.cos(elapsed * 4.2) * Math.min(radius, 92),
      y: player.position.y + Math.sin(elapsed * 4.2) * Math.min(radius, 92)
    };
    pushFeedback(room, 'hit', orbit, '의자', 0.18);
  }
}

function updatePanelGuard(room: Room, player: Player, powerLevel: number) {
  const level = player.inventory.partitionMaterial;
  if (level <= 0) return;
  const cooldown = Math.max(0.32, 0.78 - level * 0.035);
  if (!canEquipmentAct(room, player.id, 'panel', cooldown)) return;
  const radius = 92 + level * 8;
  const damage = 5 + level * 1.6 + powerLevel * 0.7;
  for (const zombie of nearestZombies(room, player.position, 14 + Math.floor(level / 2), radius)) {
    damageZombie(room, zombie, damage, player.id);
  }
}

function canEquipmentAct(room: Room, playerId: string, action: string, cooldown: number) {
  const key = `${room.id}:${playerId}:equipment:${action}`;
  const now = Date.now() / 1000;
  const previous = equipmentTimers.get(key) ?? 0;
  if (now - previous < cooldown) return false;
  equipmentTimers.set(key, now);
  return true;
}

function nearestZombies(room: Room, point: Vec2, count: number, maxDistance: number) {
  return [...room.zombies]
    .filter((zombie) => distance(point, zombie.position) <= maxDistance)
    .sort((a, b) => distance(point, a.position) - distance(point, b.position))
    .slice(0, count);
}

function updateProjectiles(room: Room) {
  const live = [];
  for (const projectile of room.projectiles) {
    projectile.ttl -= DT;
    projectile.position.x += projectile.velocity.x * DT;
    projectile.position.y += projectile.velocity.y * DT;
    if (projectile.ttl <= 0 || collidesWithWalls(projectile.position, PROJECTILE_RADIUS, room.walls)) continue;

    let hit = false;
    const owner = room.players.get(projectile.ownerId);
    const damage = owner ? rangedDamage(room, owner) : 14;
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
    zombie.position = moveZombieAroundWalls(room, zombie, dir, targetPoint, zombieSpeed(zombie.type, room.wave) * chaseBoost);

    for (const facility of room.facilities) {
      if (distance(zombie.position, facility.position) < ZOMBIE_RADIUS + FACILITY_RADIUS) {
        facility.hp -= 14 * DT;
      }
    }
    if (distance(zombie.position, target.position) < ZOMBIE_RADIUS + PLAYER_RADIUS) {
      const biteDamage = zombie.type === 'tanker' ? 24 * DT : zombie.type === 'runner' ? 17 * DT : 12 * DT;
      damagePlayer(room, target, biteDamage);
    }
  }
  room.facilities = room.facilities.filter((facility) => facility.hp > 0);
  room.zombies = room.zombies.filter((zombie) => zombie.hp > 0);
}

function damageZombie(room: Room, zombie: Zombie, damage: number, attackerId: string) {
  if (zombie.hp <= 0) return;
  zombie.hp -= damage;
  pushFeedback(room, 'hit', zombie.position, `${Math.round(damage)}`, 0.08);
  if (zombie.hp > 0) return;
  const attacker = room.players.get(attackerId);
  if (!attacker) return;
  attacker.kills += 1;
  const combo = registerKillCombo(room, attacker);
  const score = zombieScore(zombie.type) + Math.min(combo - 1, 7) * 3;
  attacker.score += score;
  if (combo >= 3) attacker.hp = Math.min(100, attacker.hp + 2);
  pushFeedback(room, 'kill', zombie.position, combo >= 2 ? `x${combo} +${score}` : `+${score}`);
}

function damagePlayer(room: Room, target: Player, damage: number, attacker?: Player) {
  if (!target.alive) return;
  const guardLevel = target.inventory.partitionMaterial;
  const reduction = Math.min(0.38, guardLevel * 0.038 + target.inventory.powerModule * 0.008);
  target.hp -= damage * (1 - reduction);
  if (target.hp > 0) return;
  target.hp = 0;
  target.alive = false;
  if (attacker && attacker.id !== target.id) attacker.score += 40;
  pushFeedback(room, 'playerDown', target.position, '쓰러짐');
}

function spawnWorld(room: Room, elapsed: number) {
  room.nextZombieSpawnAt -= DT;
  room.nextResourceSpawnAt -= DT;
  if (room.nextZombieSpawnAt <= 0) {
    const aliveCount = [...room.players.values()].filter((player) => player.alive).length;
    const pressure = Math.floor(elapsed / 30);
    const count = Math.min(4 + Math.ceil(room.wave * 1.35) + Math.floor(pressure * 1.5) + Math.max(0, aliveCount - 1) * 2, 26);
    const cap = 52 + aliveCount * 16 + room.wave * 5;
    for (let i = 0; i < count && room.zombies.length < cap; i += 1) room.zombies.push(createZombie(room.wave));
    if (room.wave >= 4 && room.wave % 3 === 0) {
      for (let i = 0; i < aliveCount * 3 && room.zombies.length < cap; i += 1) room.zombies.push(createZombie(room.wave + 2, 'runner'));
    }
    room.nextZombieSpawnAt = Math.max(1.0, 3.8 - room.wave * 0.18);
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

function createZombie(wave: number, forcedType?: ZombieType): Zombie {
  const roll = Math.random();
  const tankerChance = wave >= 3 ? Math.min(0.06 + wave * 0.028, 0.28) : 0;
  const runnerChance = wave >= 2 ? Math.min(0.26 + wave * 0.04, 0.55) : 0;
  const type: ZombieType = forcedType ?? (roll < tankerChance ? 'tanker' : roll < tankerChance + runnerChance ? 'runner' : 'normal');
  const scaling = Math.max(0, wave - 1);
  return {
    id: makeId('zombie'),
    type,
    hp: type === 'tanker' ? 105 + scaling * 8 : type === 'runner' ? 22 + scaling * 2 : 32 + scaling * 3,
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

function chooseZombieTarget(room: Room, zombie: Zombie) {
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
        const aThreat = a.inventory.deskParts + a.inventory.chairParts + a.inventory.powerModule;
        const bThreat = b.inventory.deskParts + b.inventory.chairParts + b.inventory.powerModule;
        return distance(zombie.position, a.position) - aThreat * 18 - (distance(zombie.position, b.position) - bThreat * 18);
      })[0];
  }
  return nearestAlivePlayer(room, zombie.position);
}

function nearestFacility(room: Room, point: Vec2) {
  return room.facilities.sort((a, b) => distance(point, a.position) - distance(point, b.position))[0];
}

function hasPowerBuff(room: Room, player: Player) {
  return room.facilities.some((facility) => facility.type === 'powerAmplifier' && distance(player.position, facility.position) < 140);
}

function rangedDamage(room: Room, player: Player) {
  const powerDamage = player.inventory.powerModule * 2.2;
  return 15 + powerDamage + comboDamageBonus(player);
}

function comboDamageBonus(player: Player) {
  return Math.min(player.combo, 8);
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

function clampToMap(point: Vec2, radius: number): Vec2 {
  return {
    x: clamp(point.x, radius, MAP_WIDTH - radius),
    y: clamp(point.y, radius, MAP_HEIGHT - radius)
  };
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
      x: MAP_WIDTH / 2 - zombie.position.x,
      y: MAP_HEIGHT / 2 - zombie.position.y
    })
  ]
    .map(normalize)
    .filter((candidate) => length(candidate) > 0);

  const best = candidates
    .map((candidate) => {
      const point = clampToMap({
        x: zombie.position.x + candidate.x * step,
        y: zombie.position.y + candidate.y * step
      }, ZOMBIE_RADIUS);
      const blocked = collidesWithWalls(point, ZOMBIE_RADIUS, room.walls);
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

function rotate(vector: Vec2, angle: number): Vec2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: vector.x * cos - vector.y * sin,
    y: vector.x * sin + vector.y * cos
  };
}

function collidesWithWalls(point: Vec2, radius: number, activeWalls = walls) {
  return activeWalls.some((wall) => circleRect(point, radius, wall));
}

function collidesWithMapBounds(point: Vec2, radius: number) {
  return point.x < radius || point.y < radius || point.x > MAP_WIDTH - radius || point.y > MAP_HEIGHT - radius;
}

function damageBlockingWall(room: Room, zombie: Zombie, targetPoint: Vec2) {
  const dir = normalize({ x: targetPoint.x - zombie.position.x, y: targetPoint.y - zombie.position.y });
  const probe = {
    x: zombie.position.x + dir.x * (ZOMBIE_RADIUS + 12),
    y: zombie.position.y + dir.y * (ZOMBIE_RADIUS + 12)
  };
  const wall = room.walls
    .filter((candidate) => !isOuterWall(candidate))
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

function isOuterWall(wall: Wall) {
  return wall.x <= 0 || wall.y <= 0 || wall.x + wall.width >= MAP_WIDTH || wall.y + wall.height >= MAP_HEIGHT;
}

function rectCenter(wall: Wall): Vec2 {
  return {
    x: wall.x + wall.width / 2,
    y: wall.y + wall.height / 2
  };
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
  killTimers.delete(comboKey(room, socketId));
  clearEquipmentTimers(room, socketId);
  clearFeedbackTimers(room, socketId);
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
