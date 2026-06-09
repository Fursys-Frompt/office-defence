import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io, Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  FacilityType,
  FeedbackEvent,
  GameSnapshot,
  PlayerInput,
  ResourceType,
  RoomSettings,
  ServerToClientEvents,
  Vec2
} from '../../shared/src/types';
import { EQUIPMENT_DESCRIPTIONS, EQUIPMENT_LABELS, RESOURCE_LABELS, resourceKeys } from '../../shared/src/gameRules';
import { ConceptArtBoard } from './ConceptArtBoard';
import avatarAtlasUrl from './assets/office-player-avatars.png';
import propAtlasUrl from './assets/office-props-atlas.png';
import spriteSheetUrl from './assets/office-survival-sprites.png';
import './styles.css';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type VisualEffect = Omit<FeedbackEvent, 'type'> & {
  type: FeedbackEvent['type'] | 'meleeSwing';
  startedAt: number;
};
type AudioCue = FeedbackEvent['type'] | 'shoot' | 'melee';

const socket: GameSocket = io();
const SPRITES = {
  player: { col: 0, row: 0, size: 70 },
  normal: { col: 1, row: 0, size: 68 },
  runner: { col: 0, row: 1, size: 72 },
  tanker: { col: 1, row: 1, size: 92 }
} as const;
const RESOURCE_SPRITES: Record<ResourceType, { col: number; row: number; size: number }> = {
  chairParts: { col: 0, row: 0, size: 34 },
  deskParts: { col: 1, row: 0, size: 34 },
  partitionMaterial: { col: 2, row: 0, size: 38 },
  powerModule: { col: 3, row: 0, size: 36 },
  medKit: { col: 0, row: 1, size: 36 }
};
const FACILITY_SPRITES: Record<FacilityType, { col: number; row: number; size: number }> = {
  partitionBarricade: { col: 1, row: 1, size: 58 },
  deskBarricade: { col: 2, row: 1, size: 62 },
  medStation: { col: 3, row: 1, size: 62 },
  powerAmplifier: { col: 0, row: 2, size: 62 }
};
const DECOR_SPRITES = [
  { col: 1, row: 2, position: { x: 260, y: 210 }, size: 118 },
  { col: 1, row: 2, position: { x: 440, y: 240 }, size: 118 },
  { col: 2, row: 2, position: { x: 820, y: 210 }, size: 150 },
  { col: 3, row: 2, position: { x: 1160, y: 310 }, size: 130 },
  { col: 1, row: 3, position: { x: 420, y: 790 }, size: 122 },
  { col: 0, row: 3, position: { x: 940, y: 820 }, size: 128 },
  { col: 2, row: 3, position: { x: 1340, y: 780 }, size: 124 },
  { col: 3, row: 3, position: { x: 108, y: 510 }, size: 84 },
  { col: 3, row: 3, position: { x: 1490, y: 128 }, size: 84 }
] as const;
const AVATARS = [
  { id: 0, label: 'Teal Lead', col: 0, row: 0 },
  { id: 1, label: 'Coral Planner', col: 1, row: 0 },
  { id: 2, label: 'Gold Maker', col: 0, row: 1 },
  { id: 3, label: 'Violet Guard', col: 1, row: 1 }
] as const;
const CANVAS_AVATAR_STYLES = [
  { hair: '#20282c', cloth: '#f4f7f1', accent: '#6fd7c8', cosmetic: 'pin' },
  { hair: '#1b2232', cloth: '#ffe4e5', accent: '#63d8ff', cosmetic: 'band' },
  { hair: '#6c4d3f', cloth: '#fff0dc', accent: '#9edfb5', cosmetic: 'clip' },
  { hair: '#29334a', cloth: '#ece7ff', accent: '#f2c84e', cosmetic: 'stripe' }
] as const;

function App() {
  const [nickname, setNickname] = useState('');
  const [roomInput, setRoomInput] = useState('');
  const [roomId, setRoomId] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [avatarId, setAvatarId] = useState(0);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [settings, setSettings] = useState<RoomSettings>({
    maxPlayers: 6,
    gameDurationSec: 180,
    pvpEnabled: false
  });

  useEffect(() => {
    socket.on('joined', (payload) => {
      setRoomId(payload.roomId);
      setPlayerId(payload.playerId);
      setError('');
    });
    socket.on('snapshot', setSnapshot);
    socket.on('errorMessage', setError);
    return () => {
      socket.off('joined');
      socket.off('snapshot');
      socket.off('errorMessage');
    };
  }, []);

  const me = snapshot?.players.find((player) => player.id === playerId);
  const readyCount = snapshot?.players.filter((player) => player.ready).length ?? 0;

  if (!snapshot || !me) {
    return (
      <main className="shell intro">
        <section className="join-panel">
          <div>
            <p className="eyebrow">FURSYS Smart Office</p>
            <h1>Zombie Office Survival</h1>
            <p className="subtitle">Collect office parts, build a defensive line, and chain kills before the next wave overwhelms the room.</p>
          </div>
          <label>
            Nickname
            <input value={nickname} maxLength={16} onChange={(event) => setNickname(event.target.value)} placeholder="Survivor" />
          </label>
          <label>
            Room code
            <input value={roomInput} maxLength={8} onChange={(event) => setRoomInput(event.target.value.toUpperCase())} placeholder="Leave blank to create" />
          </label>
          <div className="avatar-picker" aria-label="Avatar">
            {AVATARS.map((avatar) => (
              <button
                key={avatar.id}
                type="button"
                className={avatarId === avatar.id ? 'avatar-option active' : 'avatar-option'}
                onClick={() => setAvatarId(avatar.id)}
                title={avatar.label}
              >
                <span
                  className="avatar-thumb"
                  style={{
                    backgroundImage: `url(${avatarAtlasUrl})`,
                    backgroundPosition: spriteBackgroundPosition(avatar.col, avatar.row, 2, 2)
                  }}
                />
              </button>
            ))}
          </div>
          <div className="avatar-preview">
            <span
              className="avatar-preview-image"
              style={{
                backgroundImage: `url(${avatarAtlasUrl})`,
                backgroundPosition: spriteBackgroundPosition(AVATARS[avatarId].col, AVATARS[avatarId].row, 2, 2)
              }}
            />
            <div>
              <strong>{AVATARS[avatarId].label}</strong>
              <span>Selected survivor avatar</span>
            </div>
          </div>
          <button
            className="primary cta"
            onClick={() =>
              socket.emit('joinRoom', {
                nickname: nickname || 'Survivor',
                roomId: roomInput || undefined,
                avatarId,
                settings
              })
            }
          >
            Enter room
          </button>
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  if (snapshot.phase === 'lobby') {
    return (
      <main className="shell lobby">
        <section className="panel">
          <div className="room-header">
            <div>
              <p className="eyebrow">Mission Room</p>
              <h1>{roomId}</h1>
              <div className="room-meta">
                <span>{snapshot.players.length}/{snapshot.settings.maxPlayers} Players</span>
                <span>{readyCount}/{snapshot.players.length} Ready</span>
                <span>{Math.round(snapshot.settings.gameDurationSec / 60)} min</span>
              </div>
            </div>
            <button onClick={() => socket.emit('leaveRoom')}>Leave</button>
          </div>
          <div className="player-list">
            {snapshot.players.map((player) => (
              <div key={player.id} className="player-row">
                <span>{player.nickname}{player.host ? ' / Host' : ''}</span>
                <strong className={player.ready ? 'status ready' : 'status wait'}>{player.ready ? 'READY' : 'WAIT'}</strong>
              </div>
            ))}
          </div>
          {me.host && (
            <div className="settings">
              <label>
                Max players
                <input
                  type="number"
                  min={2}
                  max={8}
                  value={settings.maxPlayers}
                  onChange={(event) => setSettings({ ...settings, maxPlayers: Number(event.target.value) })}
                />
              </label>
              <label>
                Duration (sec)
                <input
                  type="number"
                  min={60}
                  max={600}
                  step={30}
                  value={settings.gameDurationSec}
                  onChange={(event) => setSettings({ ...settings, gameDurationSec: Number(event.target.value) })}
                />
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.pvpEnabled}
                  onChange={(event) => setSettings({ ...settings, pvpEnabled: event.target.checked })}
                />
                PVP
              </label>
              <button onClick={() => socket.emit('updateSettings', settings)}>Apply settings</button>
            </div>
          )}
          <button className="primary" onClick={() => socket.emit('setReady', !me.ready)}>
            {me.ready ? 'Cancel ready' : 'Ready'}
          </button>
        </section>
      </main>
    );
  }

  if (snapshot.phase === 'ended') {
    const ranking = [...snapshot.players].sort((a, b) => b.score - a.score);
    return (
      <main className="shell result">
        <section className="panel">
          <p className="eyebrow">Result</p>
          <h1>Result</h1>
          <div className="ranking">
            {ranking.map((player, index) => (
              <div key={player.id} className="rank-row">
                <strong className="rank-place">{index + 1}</strong>
                <span>{player.nickname}</span>
                <span>{player.score} pt</span>
                <span>{player.kills} kills</span>
                <span>{player.survivalSec}s</span>
              </div>
            ))}
          </div>
          <button onClick={() => window.location.reload()}>Back to lobby</button>
        </section>
      </main>
    );
  }

  return <GameView snapshot={snapshot} playerId={playerId} />;
}
function GameView({ snapshot, playerId }: { snapshot: GameSnapshot; playerId: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const latestRender = useRef<{ snapshot: GameSnapshot; me: NonNullable<typeof snapshot.players[number]> } | null>(null);
  const pressed = useRef(new Set<string>());
  const pointer = useRef<Vec2>({ x: 1, y: 0 });
  const joystick = useRef<{ id: number; origin: Vec2; value: Vec2 } | null>(null);
  const seenFeedback = useRef(new Set<string>());
  const visualEffects = useRef<VisualEffect[]>([]);
  const audio = useRef(createAudioEngine());
  const spriteSheet = useGameImage(spriteSheetUrl);
  const propAtlas = useGameImage(propAtlasUrl);
  const avatarAtlas = useGameImage(avatarAtlasUrl);
  const me = snapshot.players.find((player) => player.id === playerId);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      audio.current.unlock();
      pressed.current.add(event.code);
    };
    const onKeyUp = (event: KeyboardEvent) => pressed.current.delete(event.code);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      const move = keyboardMove(pressed.current, joystick.current?.value);
      const autoAim = me ? getAutoAim(snapshot, me.position) : undefined;
      const aim = autoAim ? autoAim.direction : pointer.current;
      const input: PlayerInput = {
        move,
        aim,
        shooting: false,
        melee: false
      };
      socket.emit('input', input);
    }, 50);
    return () => window.clearInterval(id);
  }, [snapshot, me]);

  useEffect(() => {
    if (me) latestRender.current = { snapshot, me };
  }, [snapshot, me]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    let frame = 0;
    const render = () => {
      const current = latestRender.current;
      if (current) {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const targetWidth = Math.floor(rect.width * dpr);
        const targetHeight = Math.floor(rect.height * dpr);
        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
          canvas.width = targetWidth;
          canvas.height = targetHeight;
        }
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawGame(
          context,
          rect.width,
          rect.height,
          current.snapshot,
          current.me.position,
          spriteSheet,
          propAtlas,
          avatarAtlas,
          undefined,
          visualEffects.current
        );
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [spriteSheet, propAtlas, avatarAtlas]);

  useEffect(() => {
    const now = performance.now();
    for (const event of snapshot.feedbackEvents) {
      if (seenFeedback.current.has(event.id)) continue;
      seenFeedback.current.add(event.id);
      visualEffects.current.push({ ...event, startedAt: now });
      audio.current.play(event.type);
    }
    visualEffects.current = visualEffects.current.filter((effect) => now - effect.startedAt < 900);
    if (seenFeedback.current.size > 240) {
      const visibleIds = new Set(snapshot.feedbackEvents.map((event) => event.id));
      seenFeedback.current = new Set([...seenFeedback.current].filter((id) => visibleIds.has(id)));
    }
  }, [snapshot.feedbackEvents]);

  const hud = useMemo(() => {
    const sorted = [...snapshot.players].sort((a, b) => b.score - a.score).slice(0, 4);
    return sorted;
  }, [snapshot.players]);
  const hp = Math.ceil(me?.hp ?? 0);
  const maxHp = Math.max(1, Math.ceil(me?.maxHp ?? 100));
  const hpPercent = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  const combo = me?.combo ?? 0;
  const threat = getThreatLabel(snapshot.wave);

  return (
    <main className="game">
      <canvas
        ref={canvasRef}
        onMouseMove={(event) => {
          if (!me) return;
          const rect = event.currentTarget.getBoundingClientRect();
          pointer.current = {
            x: event.clientX - rect.left - rect.width / 2,
            y: event.clientY - rect.top - rect.height / 2
          };
        }}
        onMouseDown={() => {
          audio.current.unlock();
        }}
        onTouchStart={(event) => handleTouch(event, joystick)}
        onTouchMove={(event) => handleTouch(event, joystick)}
        onTouchEnd={(event) => handleTouch(event, joystick)}
      />
      <div className={hpPercent <= 30 ? 'damage-vignette visible' : 'damage-vignette'} />
      <section className={`hud player-hud top-left ${hpPercent <= 30 ? 'danger' : ''}`}>
        <div className="player-summary">
          <strong>{me?.nickname}</strong>
          <span>{me?.score ?? 0} pt</span>
        </div>
        <div className="hp-meter" aria-label={`HP ${hp} of ${maxHp}`}>
          <span style={{ width: `${hpPercent}%` }} />
        </div>
        <b>HP {hp}/{maxHp}</b>
      </section>
      <section className="hud inventory-hud">
        {resourceKeys.map((resource) => (
          <span key={resource} className={`inventory-chip ${(me?.inventory[resource] ?? 0) > 0 ? 'has' : 'empty'}`}>
            <i
              style={{
                backgroundImage: `url(${propAtlasUrl})`,
                backgroundPosition: spriteBackgroundPosition(RESOURCE_SPRITES[resource].col, RESOURCE_SPRITES[resource].row, 4, 4)
              }}
            />
            <b>{me?.inventory[resource] ?? 0}</b>
            <em>{RESOURCE_LABELS[resource]}</em>
          </span>
        ))}
      </section>
      <section className="hud mission-hud top-right">
        <span><b>{snapshot.remainingSec}</b>s</span>
        <span>Wave <b>{snapshot.wave}</b></span>
        <span className={`threat ${threat.tone}`}>Threat {threat.label}</span>
        <span className={snapshot.settings.pvpEnabled ? 'pvp-on' : 'pvp-off'}>{snapshot.settings.pvpEnabled ? 'PVP ON' : 'PVP OFF'}</span>
      </section>
      {combo >= 2 && (
        <section className="hud combo-hud">
          <strong>x{combo}</strong>
          <span>CHAIN</span>
        </section>
      )}
      <section className="hud ranking-mini">
        {hud.map((player, index) => (
          <span key={player.id}>{index + 1}. {player.nickname} {player.score}</span>
        ))}
      </section>
      {snapshot.phase === 'countdown' && <div className="countdown">{snapshot.countdown}</div>}
      <section className="equipment-bar">
        <div className="build-state">
          <strong>Auto Gear</strong>
          <span>Collect parts to upgrade</span>
        </div>
        {resourceKeys.map((resource) => (
          <div key={resource} className={`equipment-chip ${(me?.inventory[resource] ?? 0) > 0 ? 'active' : ''}`}>
            <strong>Lv {me?.inventory[resource] ?? 0}</strong>
            <span>{EQUIPMENT_LABELS[resource]}</span>
            <small>{EQUIPMENT_DESCRIPTIONS[resource]}</small>
          </div>
        ))}
      </section>
      <div className="touch-affordance" aria-hidden="true">
        <span />
      </div>
    </main>
  );
}

function keyboardMove(keys: Set<string>, joystickMove?: Vec2): Vec2 {
  if (joystickMove && Math.hypot(joystickMove.x, joystickMove.y) > 0.05) return joystickMove;
  return {
    x: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
    y: (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0)
  };
}

function getThreatLabel(wave: number) {
  if (wave >= 8) return { label: 'EXTREME', tone: 'extreme' };
  if (wave >= 5) return { label: 'HIGH', tone: 'high' };
  if (wave >= 3) return { label: 'MID', tone: 'mid' };
  return { label: 'LOW', tone: 'low' };
}

function spriteBackgroundPosition(col: number, row: number, columns: number, rows: number) {
  const x = columns <= 1 ? 0 : (col / (columns - 1)) * 100;
  const y = rows <= 1 ? 0 : (row / (rows - 1)) * 100;
  return `${x}% ${y}%`;
}

function handleTouch(
  event: React.TouchEvent<HTMLCanvasElement>,
  joystick: React.MutableRefObject<{ id: number; origin: Vec2; value: Vec2 } | null>
) {
  createAudioEngine().unlock();
  event.preventDefault();
  const rect = event.currentTarget.getBoundingClientRect();
  const touches = Array.from(event.touches);
  const left = touches.find((touch) => touch.clientX - rect.left < rect.width * 0.7);
  if (!left) {
    joystick.current = null;
    return;
  }
  if (!joystick.current || joystick.current.id !== left.identifier) {
    joystick.current = { id: left.identifier, origin: { x: left.clientX, y: left.clientY }, value: { x: 0, y: 0 } };
  }
  const dx = left.clientX - joystick.current.origin.x;
  const dy = left.clientY - joystick.current.origin.y;
  const size = Math.max(1, Math.hypot(dx, dy));
  joystick.current.value = {
    x: Math.max(-1, Math.min(1, dx / Math.max(60, size))),
    y: Math.max(-1, Math.min(1, dy / Math.max(60, size)))
  };
}

const localCueCooldowns = new Map<AudioCue, number>();

function canPlayLocalCue(cue: AudioCue) {
  const now = performance.now();
  const previous = localCueCooldowns.get(cue) ?? 0;
  const cooldown = cue === 'shoot' ? 150 : 260;
  if (now - previous < cooldown) return false;
  localCueCooldowns.set(cue, now);
  return true;
}

let sharedAudioEngine: ReturnType<typeof createAudioEngineInternal> | undefined;

function createAudioEngine() {
  sharedAudioEngine ??= createAudioEngineInternal();
  return sharedAudioEngine;
}

function createAudioEngineInternal() {
  let context: AudioContext | undefined;
  const cueCooldowns = new Map<AudioCue, number>();

  const unlock = () => {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
  };

  const playTone = (frequency: number, duration: number, gainValue: number, type: OscillatorType, slideTo?: number) => {
    if (!context || context.state !== 'running') return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  };

  const play = (cue: AudioCue) => {
    unlock();
    const nowMs = performance.now();
    const previous = cueCooldowns.get(cue) ?? 0;
    const cooldown = cue === 'hit' ? 90 : cue === 'collect' ? 80 : cue === 'shoot' ? 130 : 180;
    if (nowMs - previous < cooldown) return;
    cueCooldowns.set(cue, nowMs);

    if (cue === 'shoot') playTone(560, 0.08, 0.025, 'square', 760);
    else if (cue === 'melee') playTone(180, 0.09, 0.035, 'sawtooth', 110);
    else if (cue === 'hit') playTone(220, 0.08, 0.028, 'triangle', 145);
    else if (cue === 'kill') {
      playTone(320, 0.08, 0.032, 'triangle', 480);
      window.setTimeout(() => playTone(520, 0.09, 0.025, 'triangle', 780), 70);
    } else if (cue === 'collect') playTone(720, 0.07, 0.024, 'sine', 980);
    else if (cue === 'build') playTone(420, 0.11, 0.03, 'square', 620);
    else if (cue === 'heal') playTone(660, 0.16, 0.022, 'sine', 880);
    else if (cue === 'playerDown') playTone(140, 0.24, 0.04, 'sawtooth', 80);
  };

  return { unlock, play };
}

function useGameImage(url: string) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const loadedImage = new Image();
    loadedImage.src = url;
    loadedImage.onload = () => setImage(loadedImage);
  }, [url]);

  return image;
}

function getAutoAim(snapshot: GameSnapshot, position: Vec2) {
  const candidates = snapshot.zombies
    .map((zombie) => ({
      position: zombie.position,
      distance: Math.hypot(zombie.position.x - position.x, zombie.position.y - position.y)
    }))
    .sort((a, b) => a.distance - b.distance);
  const target = candidates[0];
  if (!target) return undefined;
  const dx = target.position.x - position.x;
  const dy = target.position.y - position.y;
  const size = Math.max(1, Math.hypot(dx, dy));
  return {
    distance: target.distance,
    direction: { x: dx / size, y: dy / size }
  };
}

function drawGame(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: GameSnapshot,
  camera: Vec2,
  spriteSheet: HTMLImageElement | null,
  propAtlas: HTMLImageElement | null,
  avatarAtlas: HTMLImageElement | null,
  selectedFacility: FacilityType | undefined,
  effects: VisualEffect[]
) {
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#dce8e5';
  context.fillRect(0, 0, width, height);
  context.save();
  context.translate(width / 2 - camera.x, height / 2 - camera.y);

  drawOfficeFloor(context, snapshot.map.width, snapshot.map.height, propAtlas);
  for (const wall of snapshot.walls) {
    drawWall(context, wall);
  }
  for (const resource of snapshot.resources) {
    drawShadow(context, resource.position, 22);
    drawResourceNode(context, resource.type, resource.position);
  }
  for (const facility of snapshot.facilities) {
    drawShadow(context, facility.position, 42);
    drawFacilityNode(context, facility.type, facility.position);
    context.fillStyle = 'rgba(255,255,255,0.35)';
    context.fillRect(facility.position.x - 24, facility.position.y - 25, Math.max(0, facility.hp / 160) * 48, 4);
  }
  for (const projectile of snapshot.projectiles) {
    drawProjectile(context, projectile);
  }
  for (const zombie of snapshot.zombies) {
    const impact = getActiveImpact(zombie.position, effects);
    const shake = impact ? Math.sin((performance.now() - impact.startedAt) * 0.09) * (1 - impact.age) * 5 : 0;
    const drawPosition = { x: zombie.position.x + shake, y: zombie.position.y };
    drawShadow(context, drawPosition, zombie.type === 'tanker' ? 44 : 30);
    drawEnemyUnit(context, zombie.type, drawPosition);
    if (impact) drawImpactFlash(context, drawPosition, zombie.type === 'tanker' ? 52 : 38, impact.age, impact.type);
  }
  for (const player of snapshot.players) {
    context.globalAlpha = player.alive ? 1 : 0.35;
    drawShadow(context, player.position, 28);
    const accentColor = player.id === socket.id ? '#7bdff2' : playerColor(player.id);
    drawPlayerUnit(context, player.position, player.avatarId);
    context.strokeStyle = accentColor;
    context.lineWidth = player.id === socket.id ? 3 : 2;
    context.beginPath();
    context.arc(player.position.x, player.position.y, player.id === socket.id ? 21 : 19, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = '#ffffff';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(player.position.x, player.position.y);
    context.lineTo(player.position.x + player.aim.x * 24, player.position.y + player.aim.y * 24);
    context.stroke();
    drawEquipmentAuras(context, player);
    drawPlayerNameplate(context, player.nickname, player.hp, player.position, accentColor, player.alive);
    context.globalAlpha = 1;
  }
  drawVisualEffects(context, effects);
  context.restore();
}

function drawVisualEffects(context: CanvasRenderingContext2D, effects: VisualEffect[]) {
  const now = performance.now();
  for (const effect of effects) {
    const age = (now - effect.startedAt) / 900;
    if (age < 0 || age > 1) continue;
    const alpha = 1 - age;
    const y = effect.position.y - 28 - age * 34;
    const color = effect.type === 'hit'
      ? '#fff4a3'
      : effect.type === 'kill'
        ? '#ff6f61'
        : effect.type === 'build'
          ? '#5ac8c8'
          : effect.type === 'heal'
            ? '#7edc9b'
            : effect.type === 'playerDown'
              ? '#4f5960'
              : effect.type === 'meleeSwing'
                ? '#ffffff'
                : '#f0c86a';

    context.save();
    context.globalAlpha = alpha;
    if (effect.type === 'meleeSwing') {
      context.strokeStyle = 'rgba(255,255,255,0.92)';
      context.lineWidth = 7;
      context.beginPath();
      context.arc(effect.position.x, effect.position.y, 34, -0.25 * Math.PI - age, 0.75 * Math.PI + age);
      context.stroke();
      context.strokeStyle = 'rgba(123,223,242,0.84)';
      context.lineWidth = 3;
      context.beginPath();
      context.arc(effect.position.x, effect.position.y, 42, -0.15 * Math.PI - age, 0.65 * Math.PI + age);
      context.stroke();
      context.restore();
      continue;
    }
    if (effect.type === 'hit') {
      context.strokeStyle = color;
      context.lineWidth = 3;
      context.beginPath();
      context.arc(effect.position.x, effect.position.y, 10 + age * 22, 0, Math.PI * 2);
      context.stroke();
    } else if (effect.type === 'kill') {
      context.strokeStyle = 'rgba(255,111,97,0.82)';
      context.lineWidth = 4;
      context.beginPath();
      context.arc(effect.position.x, effect.position.y, 20 + age * 42, 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = 'rgba(255,244,163,0.55)';
      for (let i = 0; i < 5; i += 1) {
        const angle = age * Math.PI * 2 + i * 1.256;
        context.beginPath();
        context.arc(effect.position.x + Math.cos(angle) * 24, effect.position.y + Math.sin(angle) * 18, 3, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.font = effect.type === 'playerDown' ? 'bold 18px sans-serif' : 'bold 16px sans-serif';
    context.textAlign = 'center';
    context.lineWidth = 4;
    context.strokeStyle = 'rgba(42,55,58,0.72)';
    context.strokeText(effect.text, effect.position.x, y);
    context.fillStyle = color;
    context.fillText(effect.text, effect.position.x, y);
    context.restore();
  }
}

function drawProjectile(context: CanvasRenderingContext2D, projectile: GameSnapshot['projectiles'][number]) {
  const speed = Math.max(1, Math.hypot(projectile.velocity.x, projectile.velocity.y));
  const dir = { x: projectile.velocity.x / speed, y: projectile.velocity.y / speed };
  const tail = {
    x: projectile.position.x - dir.x * 34,
    y: projectile.position.y - dir.y * 34
  };

  context.save();
  const gradient = context.createLinearGradient(tail.x, tail.y, projectile.position.x, projectile.position.y);
  gradient.addColorStop(0, 'rgba(123,223,242,0)');
  gradient.addColorStop(0.4, 'rgba(123,223,242,0.5)');
  gradient.addColorStop(1, 'rgba(255,244,163,0.95)');
  context.strokeStyle = gradient;
  context.lineWidth = 5;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(tail.x, tail.y);
  context.lineTo(projectile.position.x, projectile.position.y);
  context.stroke();
  context.fillStyle = '#fff4a3';
  context.shadowColor = '#7bdff2';
  context.shadowBlur = 10;
  context.beginPath();
  context.arc(projectile.position.x, projectile.position.y, 5, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawEquipmentAuras(context: CanvasRenderingContext2D, player: GameSnapshot['players'][number]) {
  const chairLevel = player.inventory.chairParts;
  const panelLevel = player.inventory.partitionMaterial;
  const powerLevel = player.inventory.powerModule;
  const now = performance.now() / 1000;

  context.save();
  if (panelLevel > 0) {
    context.strokeStyle = 'rgba(126, 220, 155, 0.26)';
    context.lineWidth = Math.min(8, 2 + panelLevel * 0.6);
    context.beginPath();
    context.arc(player.position.x, player.position.y, 92 + panelLevel * 8, 0, Math.PI * 2);
    context.stroke();
  }
  if (powerLevel > 0) {
    context.strokeStyle = 'rgba(123, 223, 242, 0.34)';
    context.lineWidth = 3;
    context.setLineDash([8, 8]);
    context.beginPath();
    context.arc(player.position.x, player.position.y, 34 + Math.min(powerLevel, 10) * 2, now, Math.PI * 2 + now);
    context.stroke();
    context.setLineDash([]);
  }
  if (chairLevel > 0) {
    context.fillStyle = 'rgba(240, 200, 106, 0.86)';
    context.strokeStyle = 'rgba(23, 59, 63, 0.38)';
    const count = Math.min(5, 1 + Math.floor(chairLevel / 2));
    const radius = 58 + chairLevel * 7;
    for (let i = 0; i < count; i += 1) {
      const angle = now * 3.4 + (Math.PI * 2 * i) / count;
      const x = player.position.x + Math.cos(angle) * Math.min(radius, 96);
      const y = player.position.y + Math.sin(angle) * Math.min(radius, 96);
      context.beginPath();
      context.roundRect(x - 8, y - 6, 16, 12, 3);
      context.fill();
      context.stroke();
    }
  }
  context.restore();
}

function drawPlayerUnit(context: CanvasRenderingContext2D, position: Vec2, avatarId: number) {
  const style = CANVAS_AVATAR_STYLES[Math.max(0, Math.min(CANVAS_AVATAR_STYLES.length - 1, Math.round(avatarId)))];
  const x = position.x;
  const y = position.y;

  context.save();
  context.translate(x, y);

  context.fillStyle = '#d4e0db';
  context.strokeStyle = '#172d31';
  context.lineWidth = 3;
  context.beginPath();
  context.ellipse(0, 14, 18, 24, 0, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  context.fillStyle = style.cloth;
  context.beginPath();
  context.ellipse(0, 8, 16, 20, 0, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = style.accent;
  context.beginPath();
  context.roundRect(-4, -1, 8, 20, 4);
  context.fill();

  context.fillStyle = '#c7d4d1';
  context.beginPath();
  context.roundRect(-22, 6, 10, 18, 8);
  context.roundRect(12, 6, 10, 18, 8);
  context.fill();
  context.stroke();

  context.fillStyle = '#f4bf88';
  context.beginPath();
  context.arc(0, -10, 18, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  context.fillStyle = style.hair;
  context.beginPath();
  context.arc(0, -12, 20, Math.PI, Math.PI * 2);
  context.fill();
  if (style.cosmetic === 'pin') {
    context.fillStyle = style.accent;
    context.beginPath();
    context.arc(10, -16, 4, 0, Math.PI * 2);
    context.fill();
  } else if (style.cosmetic === 'band') {
    context.strokeStyle = style.accent;
    context.lineWidth = 5;
    context.beginPath();
    context.arc(0, -10, 17, Math.PI * 1.05, Math.PI * 1.95);
    context.stroke();
  } else if (style.cosmetic === 'clip') {
    context.strokeStyle = style.accent;
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(8, -20);
    context.lineTo(14, -11);
    context.stroke();
  } else {
    context.fillStyle = style.accent;
    context.beginPath();
    context.roundRect(-11, -22, 22, 6, 4);
    context.fill();
  }

  context.restore();
}

function drawEnemyUnit(context: CanvasRenderingContext2D, type: GameSnapshot['zombies'][number]['type'], position: Vec2) {
  const x = position.x;
  const y = position.y;

  context.save();
  context.translate(x, y);
  context.strokeStyle = '#172d31';
  context.lineWidth = 3;

  if (type === 'runner') {
    context.rotate(-0.2);
    context.fillStyle = '#88d4a9';
    context.beginPath();
    context.moveTo(0, -22);
    context.quadraticCurveTo(18, -8, 12, 20);
    context.quadraticCurveTo(-6, 26, -18, 8);
    context.quadraticCurveTo(-16, -10, 0, -22);
    context.fill();
    context.stroke();
    context.fillStyle = '#5dc98f';
    drawEnemyLimb(context, -22, -2, 22, 7, -0.2);
    drawEnemyLimb(context, 22, 8, 22, 7, -0.22);
    drawEnemyLimb(context, -18, 18, 18, 6, 0.55);
    drawEnemyLimb(context, 18, -14, 18, 6, -0.65);
    context.fillStyle = '#ff6b62';
    context.beginPath();
    context.roundRect(-9, -2, 18, 7, 4);
    context.fill();
  } else if (type === 'tanker') {
    context.fillStyle = '#8f78bd';
    context.beginPath();
    context.ellipse(0, 0, 30, 24, 0, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = 'rgba(255,255,255,0.08)';
    context.beginPath();
    context.ellipse(0, -4, 34, 28, 0, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = '#7a6baa';
    drawEnemyLimb(context, -26, -8, 22, 10, 0);
    drawEnemyLimb(context, 26, -8, 22, 10, 0);
    drawEnemyLimb(context, -16, 22, 18, 8, 0);
    drawEnemyLimb(context, 16, 22, 18, 8, 0);
    context.fillStyle = '#2b2642';
    context.beginPath();
    context.roundRect(-11, -4, 22, 8, 4);
    context.fill();
  } else {
    context.fillStyle = '#92d4a6';
    context.beginPath();
    context.ellipse(0, 0, 21, 23, 0, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = 'rgba(255,255,255,0.08)';
    context.beginPath();
    context.ellipse(0, -2, 24, 26, 0, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = '#79c994';
    drawEnemyLimb(context, -19, -4, 18, 8, 0);
    drawEnemyLimb(context, 19, -4, 18, 8, 0);
    drawEnemyLimb(context, -14, 16, 15, 7, 0.35);
    drawEnemyLimb(context, 14, 16, 15, 7, -0.35);
    context.fillStyle = '#172d31';
    context.beginPath();
    context.roundRect(-7, -3, 14, 5, 3);
    context.fill();
  }

  context.fillStyle = '#e9fff0';
  context.beginPath();
  context.arc(type === 'runner' ? 0 : 2, type === 'runner' ? 8 : 7, type === 'tanker' ? 5 : 4, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.restore();
}

function drawEnemyLimb(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number
) {
  context.save();
  context.translate(x, y);
  context.rotate(rotation);
  context.beginPath();
  context.roundRect(-width / 2, -height / 2, width, height, height / 2);
  context.fill();
  context.stroke();
  context.restore();
}

function drawResourceNode(context: CanvasRenderingContext2D, type: ResourceType, position: Vec2) {
  const x = position.x;
  const y = position.y;
  context.save();
  context.translate(x, y);
  context.strokeStyle = '#172d31';
  context.lineWidth = 2.5;

  if (type === 'chairParts') {
    context.fillStyle = '#35c7bd';
    context.beginPath();
    context.roundRect(-11, -11, 22, 16, 6);
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(-6, 6);
    context.lineTo(-8, 14);
    context.moveTo(6, 6);
    context.lineTo(8, 14);
    context.stroke();
  } else if (type === 'deskParts') {
    context.fillStyle = '#e6be60';
    context.beginPath();
    context.roundRect(-12, -6, 24, 14, 5);
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(-7, 8);
    context.lineTo(-9, 14);
    context.moveTo(7, 8);
    context.lineTo(9, 14);
    context.stroke();
  } else if (type === 'partitionMaterial') {
    context.fillStyle = '#a7debd';
    context.beginPath();
    context.roundRect(-6, -13, 12, 26, 4);
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(0, -13);
    context.lineTo(0, 13);
    context.stroke();
  } else if (type === 'powerModule') {
    context.fillStyle = '#80dff0';
    context.beginPath();
    context.roundRect(-11, -11, 22, 22, 6);
    context.fill();
    context.stroke();
    context.fillStyle = '#ffe06c';
    context.beginPath();
    context.moveTo(1, -8);
    context.lineTo(-5, 1);
    context.lineTo(0, 1);
    context.lineTo(-2, 8);
    context.lineTo(7, -1);
    context.lineTo(1, -1);
    context.closePath();
    context.fill();
  } else {
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.roundRect(-12, -12, 24, 24, 6);
    context.fill();
    context.stroke();
    context.strokeStyle = '#f56e68';
    context.lineWidth = 5;
    context.beginPath();
    context.moveTo(0, -7);
    context.lineTo(0, 7);
    context.moveTo(-7, 0);
    context.lineTo(7, 0);
    context.stroke();
  }
  context.restore();
}

function drawFacilityNode(context: CanvasRenderingContext2D, type: FacilityType, position: Vec2) {
  const x = position.x;
  const y = position.y;
  context.save();
  context.translate(x, y);
  context.strokeStyle = '#172d31';
  context.lineWidth = 3;

  if (type === 'partitionBarricade') {
    context.fillStyle = '#98dcb7';
    context.beginPath();
    context.roundRect(-22, -10, 44, 20, 8);
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(-10, 10);
    context.lineTo(-12, 18);
    context.moveTo(10, 10);
    context.lineTo(12, 18);
    context.stroke();
  } else if (type === 'deskBarricade') {
    context.fillStyle = '#e5c46a';
    context.beginPath();
    context.roundRect(-26, -12, 52, 24, 8);
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(-18, 12);
    context.lineTo(-22, 22);
    context.moveTo(18, 12);
    context.lineTo(22, 22);
    context.stroke();
  } else if (type === 'medStation') {
    context.fillStyle = '#9be0b8';
    context.beginPath();
    context.roundRect(-22, -18, 44, 36, 10);
    context.fill();
    context.stroke();
    context.strokeStyle = '#ffffff';
    context.lineWidth = 6;
    context.beginPath();
    context.moveTo(0, -8);
    context.lineTo(0, 8);
    context.moveTo(-8, 0);
    context.lineTo(8, 0);
    context.stroke();
    context.strokeStyle = 'rgba(155, 224, 184, 0.45)';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(0, 0, 28, 0, Math.PI * 2);
    context.stroke();
  } else {
    context.fillStyle = '#80dff0';
    context.beginPath();
    context.moveTo(0, -24);
    context.lineTo(20, -10);
    context.lineTo(20, 10);
    context.lineTo(0, 24);
    context.lineTo(-20, 10);
    context.lineTo(-20, -10);
    context.closePath();
    context.fill();
    context.stroke();
    context.fillStyle = '#ffe06c';
    context.beginPath();
    context.moveTo(3, -14);
    context.lineTo(-6, -1);
    context.lineTo(0, -1);
    context.lineTo(-4, 12);
    context.lineTo(9, -2);
    context.lineTo(2, -2);
    context.closePath();
    context.fill();
  }

  context.restore();
}

function avatarSprite(avatarId: number) {
  const safeId = Math.max(0, Math.min(3, Math.round(avatarId)));
  return {
    col: safeId % 2,
    row: Math.floor(safeId / 2),
    size: 60
  };
}

function drawPlayerNameplate(
  context: CanvasRenderingContext2D,
  nickname: string,
  hp: number,
  position: Vec2,
  accentColor: string,
  alive: boolean
) {
  const label = fitCanvasText(context, nickname, 92);
  const x = position.x;
  const y = position.y - 50;
  const width = Math.max(78, Math.min(124, context.measureText(label).width + 28));
  const height = 30;
  const left = x - width / 2;
  const top = y - height;
  const hpRatio = Math.max(0, Math.min(1, hp / 100));

  context.save();
  context.globalAlpha *= alive ? 1 : 0.72;
  context.fillStyle = 'rgba(247,251,250,0.9)';
  context.strokeStyle = accentColor;
  context.lineWidth = 2;
  context.beginPath();
  context.roundRect(left, top, width, height, 8);
  context.fill();
  context.stroke();

  context.font = 'bold 11px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = alive ? '#17211d' : '#4f5960';
  context.fillText(alive ? label : `${label} DOWN`, x, top + 10);

  context.fillStyle = 'rgba(23,59,63,0.16)';
  context.beginPath();
  context.roundRect(left + 8, top + 20, width - 16, 5, 3);
  context.fill();
  context.fillStyle = hpRatio > 0.55 ? '#7edc9b' : hpRatio > 0.25 ? '#f0c86a' : '#ff6f61';
  context.beginPath();
  context.roundRect(left + 8, top + 20, (width - 16) * hpRatio, 5, 3);
  context.fill();
  context.restore();
}

function fitCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (context.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && context.measureText(`${result}...`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}...`;
}

function playerColor(id: string) {
  const palette = ['#ff8a7a', '#65c7d0', '#f0c86a', '#8fcf8b', '#b49ce2', '#f49ac2', '#82b1ff', '#d4a373'];
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

function getActiveImpact(position: Vec2, effects: VisualEffect[]) {
  const now = performance.now();
  return effects
    .map((effect) => ({
      ...effect,
      age: (now - effect.startedAt) / 420
    }))
    .filter((effect) => (effect.type === 'hit' || effect.type === 'kill') && effect.age >= 0 && effect.age <= 1)
    .filter((effect) => Math.hypot(effect.position.x - position.x, effect.position.y - position.y) < 42)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
}

function drawImpactFlash(
  context: CanvasRenderingContext2D,
  position: Vec2,
  size: number,
  age: number,
  type: VisualEffect['type']
) {
  context.save();
  context.globalAlpha = (1 - age) * (type === 'kill' ? 0.5 : 0.34);
  context.fillStyle = type === 'kill' ? '#ff6f61' : '#fff4a3';
  context.beginPath();
  context.arc(position.x, position.y - size * 0.08, size * 0.34, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawSprite(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  col: number,
  row: number,
  position: Vec2,
  size: number
) {
  const frameWidth = image.naturalWidth / 2;
  const frameHeight = image.naturalHeight / 2;
  context.drawImage(
    image,
    col * frameWidth,
    row * frameHeight,
    frameWidth,
    frameHeight,
    position.x - size / 2,
    position.y - size / 2,
    size,
    size
  );
}

function drawAtlasSprite(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  col: number,
  row: number,
  columns: number,
  rows: number,
  position: Vec2,
  size: number
) {
  const frameWidth = image.naturalWidth / columns;
  const frameHeight = image.naturalHeight / rows;
  context.drawImage(
    image,
    col * frameWidth,
    row * frameHeight,
    frameWidth,
    frameHeight,
    position.x - size / 2,
    position.y - size / 2,
    size,
    size
  );
}

function drawShadow(context: CanvasRenderingContext2D, position: Vec2, width: number) {
  context.fillStyle = 'rgba(28,56,58,0.18)';
  context.beginPath();
  context.ellipse(position.x, position.y + 18, width * 0.55, width * 0.18, 0, 0, Math.PI * 2);
  context.fill();
}

function drawWall(context: CanvasRenderingContext2D, wall: { x: number; y: number; width: number; height: number }) {
  const gradient = context.createLinearGradient(wall.x, wall.y, wall.x + wall.width, wall.y + wall.height);
  gradient.addColorStop(0, '#8aa39d');
  gradient.addColorStop(1, '#6f8580');
  context.fillStyle = gradient;
  context.beginPath();
  context.roundRect(wall.x, wall.y, wall.width, wall.height, 8);
  context.fill();
  context.strokeStyle = 'rgba(255,255,255,0.36)';
  context.lineWidth = 2;
  context.stroke();
}

function drawOfficeFloor(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  propAtlas: HTMLImageElement | null
) {
  context.fillStyle = '#e8f0ee';
  context.fillRect(0, 0, width, height);
  context.fillStyle = 'rgba(255,255,255,0.42)';
  for (let x = 40; x < width; x += 160) {
    for (let y = 40; y < height; y += 160) {
      context.beginPath();
      context.roundRect(x, y, 72, 72, 14);
      context.fill();
    }
  }
  context.strokeStyle = 'rgba(23,59,63,0.10)';
  for (let x = 0; x < width; x += 80) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 0; y < height; y += 80) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  context.strokeStyle = 'rgba(45,178,170,0.16)';
  context.lineWidth = 4;
  context.strokeRect(32, 32, width - 64, height - 64);
  context.lineWidth = 1;
  if (propAtlas) {
    for (const decor of DECOR_SPRITES) {
      drawAtlasSprite(context, propAtlas, decor.col, decor.row, 4, 4, decor.position, decor.size);
    }
  }
  const zones = [
    ['Open Office', 80, 80],
    ['Meeting Room', 720, 90],
    ['Lounge', 1120, 200],
    ['Focus Zone', 420, 720],
    ['Cafe', 900, 760],
    ['Storage', 1280, 700]
  ] as const;
  context.fillStyle = 'rgba(23,59,63,0.35)';
  context.font = '18px sans-serif';
  zones.forEach(([label, x, y]) => context.fillText(label, x, y));
}

function Root() {
  const params = new URLSearchParams(window.location.search);
  return params.get('concept') === '1' ? <ConceptArtBoard /> : <App />;
}

createRoot(document.getElementById('root')!).render(<Root />);
