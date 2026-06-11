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
  RoomSummary,
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
  powerZones: GameSnapshot['powerZones'];
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
const PROJECTILE_SPEED = 700;
const BASE_ATTACK_RANGE = 360;
const DESK_RANGE_BONUS = 18;
const POWER_ZONE_RADIUS = 145;
const POWER_ZONE_TTL = 8;
const POWER_ZONE_DAMAGE_BONUS = 0.35;
const POWER_ZONE_RANGE_BONUS = 110;
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
const zombieAiTimers = new Map<string, {
  nextSpecialAt: number;
  dashUntil: number;
  dashDirection: Vec2;
  leapCooldownUntil: number;
}>();

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
    powerZones: [],
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
    powerZones: room.powerZones,
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

function roomSummaries(): RoomSummary[] {
  return [...rooms.values()]
    .filter((room) => room.phase === 'lobby')
    .map((room) => {
      const players = [...room.players.values()];
      const host = players.find((player) => player.host) ?? players[0];
      return {
        roomId: room.id,
        phase: room.phase,
        playerCount: players.length,
        maxPlayers: room.settings.maxPlayers,
        readyCount: players.filter((player) => player.ready).length,
        gameDurationSec: room.settings.gameDurationSec,
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
  room.remainingSec = room.settings.gameDurationSec;
  room.startedAt = Date.now();
  room.lastWaveAt = 0;
  room.nextZombieSpawnAt = 2.2;
  room.nextResourceSpawnAt = 0;
  clearZombieAiTimers(room);
  room.zombies = [];
  room.projectiles = [];
  room.facilities = [];
  room.powerZones = [];
  room.feedbackEvents = [];
  room.walls = walls.map((wall) => ({ ...wall }));
  room.wallHp = new Map();
  room.resources = Array.from({ length: 14 }, () => createResource());
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
    player.inventory.chairParts = 0;
    player.inventory.deskParts = 0;
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
  updatePowerZones(room);
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

    if (input.useItem) useItem(room, player, input.useItem);

    if (input.shooting && canAct(room, player.id, 'shoot', player.combo >= 5 ? 0.44 : 0.52)) {
      const attackRange = playerAttackRange(room, player);
      room.projectiles.push({
        id: makeId('shot'),
        ownerId: player.id,
        position: { ...player.position },
        velocity: { x: player.aim.x * PROJECTILE_SPEED, y: player.aim.y * PROJECTILE_SPEED },
        ttl: attackRange / PROJECTILE_SPEED
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
    if (distance(player.position, zombie.position) < 54) damageZombie(room, zombie, damage, player.id);
  }
  if (!room.settings.pvpEnabled) return;
  for (const target of room.players.values()) {
    if (target.id !== player.id && target.alive && distance(player.position, target.position) < 44) {
      damagePlayer(room, target, 20 + comboDamageBonus(player), player);
    }
  }
}

function useItem(room: Room, player: Player, type: ResourceType) {
  if (player.inventory[type] <= 0 || !canAct(room, player.id, `use:${type}`, 0.35)) return;

  if (type === 'medKit') {
    if (player.hp >= player.maxHp - 1) return;
    player.inventory.medKit -= 1;
    player.hp = Math.min(player.maxHp, player.hp + 28);
    pushFeedback(room, 'heal', player.position, '+28');
    return;
  }

  if (type === 'powerModule') {
    player.inventory.powerModule -= 1;
    room.powerZones.push({
      id: makeId('powerZone'),
      ownerId: player.id,
      position: { ...player.position },
      radius: POWER_ZONE_RADIUS,
      ttl: POWER_ZONE_TTL
    });
    pushFeedback(room, 'build', player.position, 'POWER');
  }
}

function updatePowerZones(room: Room) {
  room.powerZones = room.powerZones
    .map((zone) => ({ ...zone, ttl: zone.ttl - DT }))
    .filter((zone) => zone.ttl > 0);
}

function playerAttackRange(room: Room, player: Player) {
  const zoneBonus = isInPowerZone(room, player.position) ? POWER_ZONE_RANGE_BONUS : 0;
  return BASE_ATTACK_RANGE + player.inventory.deskParts * DESK_RANGE_BONUS + zoneBonus;
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
      const score = resource.type === 'medKit' ? 8 : 5;
      player.score += score;
      pushFeedback(room, 'collect', resource.position, `x${player.inventory[resource.type]}`);
      return false;
    }
    return true;
  });
  if (before !== room.resources.length) room.nextResourceSpawnAt = Math.min(room.nextResourceSpawnAt, 1);
}

function updateEquipment(room: Room, player: Player, elapsed: number) {
  updateDeskBarrage(room, player);
  updateChairShield(room, player, elapsed);
  updatePanelGuard(room, player);
}

function updateDeskBarrage(room: Room, player: Player) {
  const level = player.inventory.deskParts;
  if (level <= 0) return;
  const cooldown = Math.max(0.54, 1.55 - level * 0.08);
  if (!canEquipmentAct(room, player.id, 'desk', cooldown)) return;
  const range = playerAttackRange(room, player) + 80;
  const targets = nearestAutoAttackTargets(room, player, 1 + Math.floor(level / 5), range);
  const damage = 9 + level * 2.2 + comboDamageBonus(player);
  for (const target of targets) {
    const dir = normalize({ x: target.position.x - player.position.x, y: target.position.y - player.position.y });
    room.projectiles.push({
      id: makeId('deskShot'),
      ownerId: player.id,
      position: { ...player.position },
      velocity: { x: dir.x * PROJECTILE_SPEED, y: dir.y * PROJECTILE_SPEED },
      ttl: range / PROJECTILE_SPEED
    });
    damageAutoAttackTarget(room, target, damage * 0.18, player);
  }
}

function updateChairShield(room: Room, player: Player, elapsed: number) {
  const level = player.inventory.chairParts;
  if (level <= 0) return;
  const cooldown = Math.max(0.36, 0.86 - level * 0.025);
  if (!canEquipmentAct(room, player.id, 'chair', cooldown)) return;
  const radius = 42 + level * 5;
  const damage = 5 + level * 1.5;
  for (const target of nearestAutoAttackTargets(room, player, 10 + Math.floor(level / 2), radius)) {
    damageAutoAttackTarget(room, target, damage, player);
  }
  if (level >= 3) {
    const orbit = {
      x: player.position.x + Math.cos(elapsed * 4.2) * Math.min(radius, 92),
      y: player.position.y + Math.sin(elapsed * 4.2) * Math.min(radius, 92)
    };
    pushFeedback(room, 'hit', orbit, '?섏옄', 0.18);
  }
}

function updatePanelGuard(room: Room, player: Player) {
  const level = player.inventory.partitionMaterial;
  if (level <= 0) return;
  const cooldown = Math.max(0.5, 1.05 - level * 0.035);
  if (!canEquipmentAct(room, player.id, 'panel', cooldown)) return;
  const radius = 70 + level * 6;
  const damage = 3.5 + level * 1.15;
  for (const target of nearestAutoAttackTargets(room, player, 14 + Math.floor(level / 2), radius)) {
    damageAutoAttackTarget(room, target, damage, player);
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
    zombie.position = moveZombieWithPatterns(room, zombie, dir, targetPoint, zombieSpeed(zombie.type, room.wave) * chaseBoost);

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
  room.zombies = room.zombies.filter((zombie) => {
    if (zombie.hp > 0) return true;
    zombieAiTimers.delete(zombieAiKey(room, zombie));
    return false;
  });
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
  pushFeedback(room, 'kill', zombie.position, combo >= 2 ? `x${combo} +${score}` : `+${score}`);
}

function damagePlayer(room: Room, target: Player, damage: number, attacker?: Player) {
  if (!target.alive) return;
  const guardLevel = target.inventory.partitionMaterial;
  const reduction = Math.min(0.26, guardLevel * 0.032);
  const effectiveDamage = damage * (1 - reduction);
  target.hp -= effectiveDamage;
  pushFeedback(room, 'hit', target.position, `-${Math.max(1, Math.round(effectiveDamage))}`, 0.12);
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
    const pressure = Math.floor(elapsed / 30);
    const count = Math.min(4 + Math.ceil(room.wave * 1.35) + Math.floor(pressure * 1.5) + Math.max(0, aliveCount - 1) * 2, 26);
    const cap = 52 + aliveCount * 16 + room.wave * 5;
    for (let i = 0; i < count && room.zombies.length < cap; i += 1) room.zombies.push(createZombie(room.wave));
    if (room.wave >= 4 && room.wave % 3 === 0) {
      for (let i = 0; i < aliveCount * 3 && room.zombies.length < cap; i += 1) room.zombies.push(createZombie(room.wave + 2, 'runner'));
    }
    room.nextZombieSpawnAt = Math.max(1.0, 3.8 - room.wave * 0.18);
  }
  if (room.nextResourceSpawnAt <= 0 && room.resources.length < 24) {
    room.resources.push(createResource());
    room.nextResourceSpawnAt = 3.8 + Math.random() * 4.8;
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
  const types: ResourceType[] = [
    'chairParts',
    'chairParts',
    'chairParts',
    'deskParts',
    'deskParts',
    'deskParts',
    'partitionMaterial',
    'partitionMaterial',
    'partitionMaterial',
    'powerModule',
    'powerModule',
    'medKit'
  ];
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
        const aThreat = a.inventory.deskParts + a.inventory.chairParts + a.inventory.partitionMaterial;
        const bThreat = b.inventory.deskParts + b.inventory.chairParts + b.inventory.partitionMaterial;
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
  const base = 11 + player.inventory.deskParts * 0.8 + comboDamageBonus(player);
  return isInPowerZone(room, player.position) ? base * (1 + POWER_ZONE_DAMAGE_BONUS) : base;
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

function moveZombieWithPatterns(room: Room, zombie: Zombie, desired: Vec2, targetPoint: Vec2, speed: number) {
  const state = getZombieAiState(room, zombie);
  const now = Date.now() / 1000;
  const targetDistance = distance(zombie.position, targetPoint);

  if (now >= state.nextSpecialAt) {
    if (zombie.type === 'runner' && targetDistance > 120 && targetDistance < 520) {
      state.dashUntil = now + 0.34;
      state.dashDirection = desired;
      state.nextSpecialAt = now + 2.8 + Math.random() * 2.2;
      pushFeedback(room, 'hit', zombie.position, '?뚯쭊', 0.18);
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
    const dashPoint = clampToMap({
      x: zombie.position.x + state.dashDirection.x * speed * 2.5 * DT,
      y: zombie.position.y + state.dashDirection.y * speed * 2.5 * DT
    }, ZOMBIE_RADIUS);
    if (!collidesWithWalls(dashPoint, ZOMBIE_RADIUS, room.walls)) return dashPoint;
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
    .filter((wall) => !isOuterWall(wall))
    .some((wall) => circleRect(zombie.position, ZOMBIE_RADIUS + 24, wall));
  if (!nearWall) return false;

  const landing = clampToMap({
    x: zombie.position.x + desired.x * 76,
    y: zombie.position.y + desired.y * 76
  }, ZOMBIE_RADIUS);
  if (collidesWithWalls(landing, ZOMBIE_RADIUS, room.walls) || collidesWithFacilities(room, landing, ZOMBIE_RADIUS)) return false;
  zombie.position = landing;
  pushFeedback(room, 'hit', landing, '?꾩빟', 0.18);
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
  pushFeedback(room, 'hit', rectCenter(wall), '?뚭눼', 0.15);
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

app.get('/api/rooms', (_req, res) => {
  res.json(roomSummaries());
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
    const room = existing ?? createRoom(roomId, payload.settings);
    if (!existing) rooms.set(roomId, room);
    if (room.phase !== 'lobby' && room.phase !== 'ended') {
      socket.emit('errorMessage', '吏꾪뻾 以묒씤 諛⑹뿉???낆옣?????놁뒿?덈떎.');
      return;
    }
    if (room.players.size >= room.settings.maxPlayers) {
      socket.emit('errorMessage', '諛??뺤썝??媛??李쇱뒿?덈떎.');
      return;
    }

    socket.join(room.id);
    socketRooms.set(socket.id, room.id);
    const player = createPlayer(socket.id, payload.nickname, room.players.size === 0, payload.avatarId);
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
    room.remainingSec = room.settings.gameDurationSec;
    broadcast(room);
    broadcastRoomList();
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
