import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io, Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  FacilityType,
  FeedbackEvent,
  GameMode,
  GameSnapshot,
  PlayerInput,
  ResourceType,
  RoomSummary,
  RoomSettings,
  ServerToClientEvents,
  SupportEquipmentType,
  UpgradeOption,
  Vec2,
  WeaponType
} from '../../shared/src/types';
import {
  RESOURCE_LABELS,
  SUPPORT_EQUIPMENT_COSTS,
  SUPPORT_EQUIPMENT_LABELS,
  WEAPON_COSTS,
  WEAPON_LABELS,
  craftMaterialKeys,
  getPartitionPlacement,
  supportEquipmentKeys,
  usableResourceKeys,
  weaponKeys,
  type PartitionPlacement
} from '../../shared/src/gameRules';
import { ConceptArtBoard } from './ConceptArtBoard';
import avatarAtlasUrl from './assets/office-player-avatars.png';
import craftingIconsUrl from './assets/office-crafting-icons.png';
import emergencyAedIconUrl from './assets/emergency-aed-icon.png';
import propAtlasUrl from './assets/office-props-atlas.png';
import spriteSheetUrl from './assets/office-survival-sprites.png';
import './styles.css';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type VisualEffect = Omit<FeedbackEvent, 'type'> & {
  type: FeedbackEvent['type'] | 'meleeSwing';
  startedAt: number;
};
type AudioCue = FeedbackEvent['type'] | 'shoot' | 'melee';
type TouchControlSide = 'left' | 'right';
type InstallItem = Extract<ResourceType, 'partitionMaterial'>;
type TutorialStep = 'move' | 'attack' | 'levelup' | 'collect' | 'craft' | 'complete';
type TutorialController = {
  step: TutorialStep;
  onMove: (move: Vec2) => void;
  onUpgrade: () => void;
  onCraft: (weapon: WeaponType) => void;
  onExit: () => void;
};

const socket: GameSocket = io();
const TOUCH_CONTROL_SIDE_KEY = 'zombie-office-survival.touchControlSide';
const GAME_MODE_LABELS: Record<GameMode, string> = {
  timedSurvival: '제한시간 생존',
  endless: '무제한',
  killTarget: '좀비 처치'
};
const GAME_MODE_MAP_LABELS: Record<GameMode, string> = {
  timedSurvival: '분할 사무실',
  endless: '순환 복도',
  killTarget: '중앙 교전 구역'
};
const SPRITES = {
  player: { row: 0, size: 74, shadow: 30, frameMs: 130 },
  normal: { row: 1, size: 74, shadow: 32, frameMs: 150 },
  runner: { row: 2, size: 78, shadow: 30, frameMs: 95 },
  tanker: { row: 3, size: 104, shadow: 46, frameMs: 210 }
} as const;
const WALK_FRAME_COUNT = 4;
const MOVEMENT_HOLD_MS = 180;
const INPUT_SEND_MS = 16;
const ITEM_INPUT_HOLD_MS = 220;
const MAX_CRAFT_LEVEL = 5;
const CAMERA_FOLLOW_AMOUNT = 0.62;
const LOCAL_PLAYER_FOLLOW_AMOUNT = 0.84;
const REMOTE_ENTITY_FOLLOW_AMOUNT = 0.36;
const BASE_ATTACK_RANGE = 360;
const POWER_ZONE_RANGE_BONUS = 110;
const RESOURCE_SPRITES: Record<ResourceType, { col: number; row: number; size: number }> = {
  partitionMaterial: { col: 2, row: 0, size: 38 },
  mixCoffee: { col: 0, row: 1, size: 36 },
  keycapSet: { col: 0, row: 0, size: 34 },
  paperBundle: { col: 1, row: 0, size: 34 },
  officeMotor: { col: 1, row: 1, size: 34 },
  batteryPack: { col: 2, row: 1, size: 34 },
  rubberPart: { col: 3, row: 0, size: 34 },
  approvalKit: { col: 3, row: 1, size: 34 }
};
const CRAFTING_ICON_SPRITES: Record<ResourceType | WeaponType | SupportEquipmentType, { col: number; row: number }> = {
  partitionMaterial: { col: 2, row: 0 },
  mixCoffee: { col: 2, row: 3 },
  keycapSet: { col: 0, row: 0 },
  paperBundle: { col: 1, row: 0 },
  officeMotor: { col: 2, row: 0 },
  batteryPack: { col: 3, row: 0 },
  rubberPart: { col: 0, row: 1 },
  approvalKit: { col: 1, row: 1 },
  keyboardShotgun: { col: 2, row: 1 },
  printerCannon: { col: 3, row: 1 },
  plunger: { col: 0, row: 2 },
  corporateCardBoomerang: { col: 1, row: 2 },
  guardFlashlight: { col: 2, row: 2 },
  robotVacuumDrone: { col: 3, row: 2 },
  mzKeycap: { col: 0, row: 3 },
  annualLeaveShield: { col: 1, row: 3 },
  emergencyAed: { col: 3, row: 3 }
};
const CRAFTING_ICON_IMAGES: Partial<Record<ResourceType | WeaponType | SupportEquipmentType, string>> = {
  emergencyAed: emergencyAedIconUrl
};
const FACILITY_SPRITES: Record<FacilityType, { col: number; row: number; size: number }> = {
  partitionBarricade: { col: 1, row: 1, size: 58 },
  deskBarricade: { col: 2, row: 1, size: 62 },
  medStation: { col: 3, row: 1, size: 62 }
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
  { id: 0, label: '오피스 틸', col: 0, row: 0 },
  { id: 1, label: '핑크 코랄', col: 1, row: 0 },
  { id: 2, label: '골드 가드', col: 0, row: 1 },
  { id: 3, label: '바이올렛', col: 1, row: 1 }
] as const;
const AVATAR_CELL_SIZE = 512;
const AVATAR_VISUAL_OFFSETS = [
  { x: -32, y: -20 },
  { x: 54, y: -19 },
  { x: -26, y: 61 },
  { x: 53, y: 61 }
] as const;
const CANVAS_AVATAR_STYLES = [
  { hair: '#20282c', cloth: '#f4f7f1', accent: '#6fd7c8', cosmetic: 'pin' },
  { hair: '#1b2232', cloth: '#ffe4e5', accent: '#63d8ff', cosmetic: 'band' },
  { hair: '#6c4d3f', cloth: '#fff0dc', accent: '#9edfb5', cosmetic: 'clip' },
  { hair: '#29334a', cloth: '#ece7ff', accent: '#f2c84e', cosmetic: 'stripe' }
] as const;

type MotionSample = {
  position: Vec2;
  direction: Vec2;
  lastMovedAt: number;
};

const motionSamples = new Map<string, MotionSample>();
const renderPositions = new Map<string, Vec2>();
const usableItemKeys: ResourceType[] = usableResourceKeys;

type PendingRoomAction = {
  mode: 'create' | 'join';
  roomId?: string;
};

function sanitizeRoomCode(value: string | null | undefined) {
  return (value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function roomInviteUrl(nextRoomId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('room', nextRoomId);
  return url.toString();
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function resultShareText(snapshot: GameSnapshot, ranking: GameSnapshot['players']) {
  const top = ranking[0];
  const lines = [
    '[오피스 좀비 서바이벌 결과]',
    `${snapshot.roomTitle}`,
    `${snapshot.objective.label} ${objectiveSummary(snapshot.objective)}`,
    top ? `1위 ${top.nickname} | ${top.score}점 | ${top.kills}처치 | ${formatDuration(top.survivalSec)} 생존` : '',
    ...ranking.slice(1, 3).map((player, index) => `${index + 2}위 ${player.nickname} | ${player.score}점 | ${player.kills}처치`),
    roomInviteUrl(snapshot.roomId)
  ].filter(Boolean);
  return lines.join('\n');
}

function externalShareTargets(text: string, url: string) {
  const encodedText = encodeURIComponent(text);
  const encodedUrl = encodeURIComponent(url);
  return [
    { label: '문자', href: `sms:?&body=${encodedText}` },
    { label: '메일', href: `mailto:?subject=${encodeURIComponent('오피스 좀비 서바이벌 결과')}&body=${encodedText}` },
    { label: 'WhatsApp', href: `https://wa.me/?text=${encodedText}` },
    { label: 'Telegram', href: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}` },
    { label: 'X', href: `https://twitter.com/intent/tweet?text=${encodedText}` },
    { label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}` }
  ];
}

function drawShareText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.split(' ');
  let line = '';
  let currentY = y;
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (context.measureText(testLine).width > maxWidth && line) {
      context.fillText(line, x, currentY);
      line = word;
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) context.fillText(line, x, currentY);
  return currentY + lineHeight;
}

async function createResultShareImage(snapshot: GameSnapshot, ranking: GameSnapshot['players']) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 630;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available.');

  const gradient = context.createLinearGradient(0, 0, 1200, 630);
  gradient.addColorStop(0, '#173b3f');
  gradient.addColorStop(0.56, '#3e7d63');
  gradient.addColorStop(1, '#f0c86a');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1200, 630);

  context.fillStyle = 'rgba(247, 251, 250, 0.94)';
  context.beginPath();
  context.roundRect(64, 56, 1072, 518, 28);
  context.fill();

  context.fillStyle = '#0f8b8d';
  context.font = '800 28px Inter, sans-serif';
  context.fillText('OFFICE ZOMBIE SURVIVAL', 104, 116);

  context.fillStyle = '#17211d';
  context.font = '900 64px Inter, sans-serif';
  context.fillText(ranking[0] ? `${ranking[0].nickname} 1위` : '생존 결과', 104, 196);

  context.font = '800 30px Inter, sans-serif';
  const nextY = drawShareText(
    context,
    `${snapshot.roomTitle} · ${snapshot.objective.label} ${objectiveSummary(snapshot.objective)}`,
    104,
    250,
    790,
    38
  );

  const top = ranking[0];
  const stats = top
    ? [`${top.score}점`, `${top.kills}처치`, `${top.survivalSec}초 생존`]
    : ['결과 없음'];
  let statX = 104;
  for (const stat of stats) {
    const width = Math.max(132, context.measureText(stat).width + 42);
    context.fillStyle = '#173b3f';
    context.beginPath();
    context.roundRect(statX, nextY + 18, width, 54, 14);
    context.fill();
    context.fillStyle = '#f7fbfa';
    context.font = '900 26px Inter, sans-serif';
    context.fillText(stat, statX + 21, nextY + 53);
    statX += width + 14;
  }

  context.fillStyle = '#17211d';
  context.font = '800 28px Inter, sans-serif';
  ranking.slice(1, 4).forEach((player, index) => {
    context.fillText(`${index + 2}위 ${player.nickname}`, 104, 430 + index * 42);
    context.fillStyle = 'rgba(23, 33, 29, 0.64)';
    context.font = '800 24px Inter, sans-serif';
    context.fillText(`${player.score}점 · ${player.kills}처치`, 360, 430 + index * 42);
    context.fillStyle = '#17211d';
    context.font = '800 28px Inter, sans-serif';
  });

  context.fillStyle = 'rgba(23, 33, 29, 0.62)';
  context.font = '800 24px Inter, sans-serif';
  context.fillText(roomInviteUrl(snapshot.roomId), 104, 536);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error('Failed to render result image.'));
    }, 'image/png');
  });
  return new File([blob], `office-zombie-${snapshot.roomId}.png`, { type: 'image/png' });
}

function LobbyApp() {
  const [nickname, setNickname] = useState('');
  const [roomTitle, setRoomTitle] = useState('');
  const [roomInput, setRoomInput] = useState('');
  const [roomId, setRoomId] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [avatarId, setAvatarId] = useState(0);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingRoomAction | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false);
  const [sharePanelOpen, setSharePanelOpen] = useState(false);
  const [inviteStatus, setInviteStatus] = useState('');
  const [shareStatus, setShareStatus] = useState('');
  const settingsRoomRef = useRef('');
  const deepLinkHandledRef = useRef(false);
  const [settings, setSettings] = useState<RoomSettings>({
    maxPlayers: 6,
    gameMode: 'timedSurvival',
    gameDurationSec: 180,
    killTarget: 100,
    pvpEnabled: false
  });

  const refreshRooms = () => {
    socket.emit('requestRoomList', setRooms);
  };

  useEffect(() => {
    socket.on('joined', (payload) => {
      setRoomId(payload.roomId);
      setPlayerId(payload.playerId);
      setPendingAction(null);
      setError('');
      const url = new URL(window.location.href);
      url.searchParams.set('room', payload.roomId);
      window.history.replaceState(null, '', url);
    });
    socket.on('connect', refreshRooms);
    socket.on('snapshot', setSnapshot);
    socket.on('errorMessage', setError);
    refreshRooms();
    const roomRefreshTimer = window.setInterval(refreshRooms, 2500);
    return () => {
      window.clearInterval(roomRefreshTimer);
      socket.off('connect', refreshRooms);
      socket.off('joined');
      socket.off('snapshot');
      socket.off('errorMessage');
    };
  }, []);

  useEffect(() => {
    if (deepLinkHandledRef.current) return;
    const requestedRoom = sanitizeRoomCode(new URLSearchParams(window.location.search).get('room'));
    if (!requestedRoom) return;
    deepLinkHandledRef.current = true;
    setRoomInput(requestedRoom);
    setPendingAction({ mode: 'join', roomId: requestedRoom });
  }, []);

  useEffect(() => {
    if (snapshot?.phase !== 'lobby') return;
    if (settingsRoomRef.current === snapshot.roomId) return;
    settingsRoomRef.current = snapshot.roomId;
    setSettings(snapshot.settings);
  }, [snapshot?.phase, snapshot?.roomId, snapshot?.settings]);

  const me = snapshot?.players.find((player) => player.id === playerId);
  const readyCount = snapshot?.players.filter((player) => player.ready).length ?? 0;

  const updateRoomSettings = (nextSettings: RoomSettings) => {
    setSettings(nextSettings);
    if (snapshot?.phase === 'lobby' && me?.host) socket.emit('updateSettings', nextSettings);
  };

  const openJoinModal = (nextRoomId?: string) => {
    setError('');
    setPendingAction({ mode: 'join', roomId: sanitizeRoomCode(nextRoomId) });
  };

  const confirmRoomAction = () => {
    if (!pendingAction) return;
    socket.emit('joinRoom', {
      nickname: nickname.trim() || '생존자',
      roomId: pendingAction.mode === 'join' ? pendingAction.roomId : undefined,
      roomTitle: pendingAction.mode === 'create' ? roomTitle : undefined,
      avatarId,
      settings: pendingAction.mode === 'create' ? settings : undefined
    });
  };

  const leaveRoom = () => {
    socket.emit('leaveRoom');
    settingsRoomRef.current = '';
    setRoomId('');
    setPlayerId('');
    setSnapshot(null);
    setShareStatus('');
    setInviteStatus('');
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    refreshRooms();
  };

  const createNewRoom = () => {
    socket.emit('leaveRoom');
    settingsRoomRef.current = '';
    setRoomId('');
    setPlayerId('');
    setSnapshot(null);
    setShareStatus('');
    setInviteStatus('');
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    setPendingAction({ mode: 'create' });
    refreshRooms();
  };

  const copyInviteLink = async () => {
    const activeRoomId = snapshot?.roomId || roomId;
    if (!activeRoomId) return;
    try {
      await copyText(roomInviteUrl(activeRoomId));
      setInviteStatus('초대 링크를 복사했습니다.');
    } catch {
      setInviteStatus('초대 링크 복사에 실패했습니다.');
    }
  };

  if (tutorialOpen) {
    return <TutorialGame onExit={() => setTutorialOpen(false)} />;
  }

  if (!snapshot || !me) {
    return (
      <main className="shell intro">
        <section className="join-panel room-browser">
          <div className="lobby-title">
            <p className="eyebrow">Mission Lobby</p>
            <h1>오피스 좀비 서바이벌</h1>
            <p className="subtitle">대기중인 방에 입장하거나 새 방을 만들어 개인 생존 경쟁을 시작하세요.</p>
          </div>

          <div className="lobby-actions">
            <button type="button" onClick={() => setTutorialOpen(true)}>게임 설명</button>
            <button type="button" className="primary" onClick={() => setPendingAction({ mode: 'create' })}>방 생성</button>
          </div>

          <div className="direct-room">
            <label>
              방 코드 직접 입력
              <input
                value={roomInput}
                maxLength={8}
                onChange={(event) => setRoomInput(event.target.value.toUpperCase())}
                placeholder="예: ABC123"
              />
            </label>
            <button type="button" onClick={() => roomInput.trim() && openJoinModal(roomInput)}>코드로 입장</button>
          </div>

          <section className="room-list" aria-label="생성된 방 목록">
            <div className="room-list-header">
              <strong>대기중인 방</strong>
              <button type="button" onClick={refreshRooms}>새로고침</button>
            </div>
            {rooms.length === 0 ? (
              <p className="empty-room">입장 가능한 방이 없습니다.</p>
            ) : (
              rooms.map((room) => {
                const full = room.playerCount >= room.maxPlayers;
                return (
                  <button
                    key={room.roomId}
                    type="button"
                    className="room-card"
                    disabled={full}
                    onClick={() => openJoinModal(room.roomId)}
                  >
                    <span>
                      <strong>{room.roomTitle}</strong>
                      <em>코드 {room.roomId} · 방장 {room.hostNickname}</em>
                    </span>
                    <span>{room.playerCount}/{room.maxPlayers}</span>
                    <span>{GAME_MODE_LABELS[room.gameMode]}</span>
                    <span>{room.gameMode === 'endless' ? '무제한' : room.gameMode === 'killTarget' ? `${room.killTarget}킬` : `${Math.round(room.gameDurationSec / 60)}분`}</span>
                    <span className={room.pvpEnabled ? 'pvp-on' : 'pvp-off'}>{room.pvpEnabled ? 'PVP ON' : 'PVP OFF'}</span>
                  </button>
                );
              })
            )}
          </section>

          {error && <p className="error">{error}</p>}
        </section>

        {guideOpen && (
          <GameGuideModal
            onClose={() => setGuideOpen(false)}
            onStartTutorial={() => {
              setGuideOpen(false);
              setTutorialOpen(true);
            }}
          />
        )}
        {pendingAction && (
          <ProfileModal
            action={pendingAction}
            nickname={nickname}
            roomTitle={roomTitle}
            avatarId={avatarId}
            onNicknameChange={setNickname}
            onRoomTitleChange={setRoomTitle}
            onAvatarChange={setAvatarId}
            onCancel={() => setPendingAction(null)}
            onConfirm={confirmRoomAction}
          />
        )}
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
              <h1>{snapshot.roomTitle}</h1>
              <div className="room-meta">
                <span>코드 {roomId}</span>
                <span>참가 {snapshot.players.length}/{snapshot.settings.maxPlayers}</span>
                <span>준비 {readyCount}/{snapshot.players.length}</span>
                <span>{GAME_MODE_LABELS[snapshot.settings.gameMode]}</span>
                <span>맵 {snapshot.map.name}</span>
                <span>{snapshot.settings.gameMode === 'endless' ? '무제한' : snapshot.settings.gameMode === 'killTarget' ? `${snapshot.settings.killTarget}킬` : `${Math.round(snapshot.settings.gameDurationSec / 60)}분`}</span>
                <span className={snapshot.settings.pvpEnabled ? 'pvp-on' : 'pvp-off'}>{snapshot.settings.pvpEnabled ? 'PVP ON' : 'PVP OFF'}</span>
              </div>
            </div>
          <div className="room-header-actions">
              <button type="button" onClick={() => setTutorialOpen(true)}>게임 설명</button>
              <button type="button" onClick={copyInviteLink}>초대 링크</button>
              <button onClick={leaveRoom}>나가기</button>
            </div>
          </div>
          {inviteStatus && <p className="action-status">{inviteStatus}</p>}
          <div className="player-list">
            {snapshot.players.map((player) => (
              <div key={player.id} className="player-row">
                <span>{player.nickname}{player.host ? ' / 방장' : ''}</span>
                <strong className={player.ready ? 'status ready' : 'status wait'}>{player.ready ? '준비 완료' : '대기중'}</strong>
              </div>
            ))}
          </div>
          {me.host && (
            <div className="settings">
              <div className="settings-primary">
                <label>
                  최대 인원
                  <input
                    type="number"
                    min={2}
                    max={8}
                    value={settings.maxPlayers}
                    onChange={(event) => updateRoomSettings({ ...settings, maxPlayers: Number(event.target.value) })}
                  />
                </label>
                <label>
                  기본 목표
                  <input value={`${GAME_MODE_LABELS[settings.gameMode]} · ${GAME_MODE_MAP_LABELS[settings.gameMode]}`} readOnly />
                </label>
                {settings.gameMode === 'timedSurvival' && (
              <label>
                플레이 시간(초)
                <input
                  type="number"
                  min={60}
                  max={600}
                  step={30}
                  value={settings.gameDurationSec}
                  onChange={(event) => updateRoomSettings({ ...settings, gameDurationSec: Number(event.target.value) })}
                />
              </label>
                )}
              </div>
              <button
                type="button"
                className="secondary settings-advanced-toggle"
                onClick={() => setAdvancedSettingsOpen((open) => !open)}
              >
                {advancedSettingsOpen ? '고급 설정 닫기' : '고급 설정'}
              </button>
              {advancedSettingsOpen && (
                <div className="settings-advanced">
                  <label>
                    게임 모드
                    <select
                      value={settings.gameMode}
                      onChange={(event) => updateRoomSettings({ ...settings, gameMode: event.target.value as GameMode })}
                    >
                      <option value="timedSurvival">제한시간 생존</option>
                      <option value="endless">무제한</option>
                      <option value="killTarget">좀비 N마리 처치</option>
                    </select>
                  </label>
                  <label>
                    맵 구조
                    <input value={GAME_MODE_MAP_LABELS[settings.gameMode]} readOnly />
                  </label>
                  {settings.gameMode === 'killTarget' && (
              <label>
                목표 처치 수
                <input
                  type="number"
                  min={10}
                  max={1000}
                  step={10}
                  value={settings.killTarget}
                  onChange={(event) => updateRoomSettings({ ...settings, killTarget: Number(event.target.value) })}
                />
              </label>
                  )}
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={settings.pvpEnabled}
                      onChange={(event) => updateRoomSettings({ ...settings, pvpEnabled: event.target.checked })}
                    />
                    PVP 허용
                  </label>
                  <button onClick={() => socket.emit('updateSettings', settings)}>설정 다시 동기화</button>
                </div>
              )}
            </div>
          )}
          <button className="primary" onClick={() => socket.emit('setReady', !me.ready)}>
            {me.ready ? '준비 취소' : '준비 완료'}
          </button>
        </section>
      </main>
    );
  }

  if (snapshot.phase === 'ended') {
    const ranking = snapshot.results.length > 0
      ? snapshot.results
      : [...snapshot.players].sort((a, b) => b.score - a.score);
    const objective = snapshot.objective;
    const topPlayer = ranking[0];
    const shareText = resultShareText(snapshot, ranking);
    const shareLines = shareText.split('\n');
    const shareUrl = roomInviteUrl(snapshot.roomId);
    const shareTargets = externalShareTargets(shareText, shareUrl);
    const saveResultImage = async () => {
      try {
        const image = await createResultShareImage(snapshot, ranking);
        const url = URL.createObjectURL(image);
        const link = document.createElement('a');
        link.href = url;
        link.download = image.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        setShareStatus('결과 이미지를 저장했습니다.');
      } catch {
        setShareStatus('결과 이미지 저장에 실패했습니다.');
      }
    };
    const shareResult = async () => {
      const nativeNavigator = navigator as Navigator & {
        share?: (data: ShareData) => Promise<void>;
      };
      const nativeShare = nativeNavigator.share;
      if (!nativeShare) {
        setSharePanelOpen(true);
        setShareStatus('공유할 앱을 선택하세요.');
        return;
      }
      try {
        await nativeShare({
          title: '오피스 좀비 서바이벌 결과',
          text: shareText,
          url: shareUrl
        });
        setShareStatus('공유를 열었습니다.');
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setSharePanelOpen(true);
        setShareStatus('브라우저 공유 대신 앱 목록을 열었습니다.');
      }
    };
    return (
      <main className="shell result">
        <section className="panel result-panel">
          <div className="result-header">
            <div>
              <p className="eyebrow">Game Result</p>
              <h1>{objective.failed ? '작전 실패' : objective.completed ? '목표 달성' : '생존 순위'}</h1>
              <p className="result-objective">{snapshot.roomTitle} · {objective.label} {objectiveSummary(objective)}</p>
            </div>
            <span className={objective.failed ? 'result-badge failed' : 'result-badge'}>
              {objective.failed ? '실패' : objective.completed ? '완료' : '종료'}
            </span>
          </div>

          <section className="result-summary-grid">
            <article className="result-card" aria-label="우승자 요약">
              <div>
                <span>Top Survivor</span>
                <strong>{objective.label}</strong>
              </div>
              <h2>{topPlayer ? `${topPlayer.nickname}` : '결과 없음'}</h2>
              <p>{topPlayer ? '이번 생존 경쟁 1위' : '기록된 결과가 없습니다.'}</p>
              {topPlayer && (
                <div className="result-card-stats">
                  <span>{topPlayer.score}점</span>
                  <span>{topPlayer.kills}처치</span>
                  <span>{formatDuration(topPlayer.survivalSec)} 생존</span>
                </div>
              )}
            </article>
          </section>

          <section className="ranking result-ranking" aria-label="최종 랭킹">
            <div className="ranking-header">
              <strong>최종 랭킹</strong>
              <span>{ranking.length}명 참가</span>
            </div>
            {ranking.map((player, index) => (
              <div key={player.id} className={`rank-row ${index === 0 ? 'winner' : ''}`}>
                <strong className="rank-place">{index + 1}</strong>
                <span className="rank-name">{player.nickname}</span>
                <span>{player.score}점</span>
                <span>{player.kills}처치</span>
                <span>{formatDuration(player.survivalSec)} 생존</span>
              </div>
            ))}
          </section>

          <div className="result-actions">
            <button type="button" onClick={shareResult}>공유하기</button>
            <button type="button" onClick={saveResultImage}>이미지 저장</button>
            <button type="button" onClick={copyInviteLink}>초대 링크</button>
            {me.host && <button className="primary" onClick={() => socket.emit('restartGame')}>같은 방 다시하기</button>}
            <button type="button" onClick={createNewRoom}>새 방 만들기</button>
            <button onClick={leaveRoom}>로비로 나가기</button>
          </div>
          {(shareStatus || inviteStatus) && <p className="action-status">{shareStatus || inviteStatus}</p>}
        </section>
        {sharePanelOpen && (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <section className="modal-card share-modal">
              <div className="modal-header">
                <div>
                  <p className="eyebrow">Share Result</p>
                  <h2>공유하기</h2>
                </div>
                <button type="button" onClick={() => setSharePanelOpen(false)}>닫기</button>
              </div>
              <div className="message-bubble modal-message">
                {shareLines.map((line, index) => (
                  <span key={`${index}-${line}`}>{line}</span>
                ))}
              </div>
              <div className="share-target-grid">
                {shareTargets.map((target) => (
                  <a key={target.label} href={target.href} target="_blank" rel="noreferrer">
                    {target.label}
                  </a>
                ))}
                <button
                  type="button"
                  onClick={async () => {
                    await copyText(shareText);
                    setShareStatus('결과 메시지를 복사했습니다.');
                    setSharePanelOpen(false);
                  }}
                >
                  복사
                </button>
              </div>
            </section>
          </div>
        )}
      </main>
    );
  }

  return <GameView snapshot={snapshot} playerId={playerId} />;
}

function TutorialGame({ onExit }: { onExit: () => void }) {
  const [step, setStep] = useState<TutorialStep>('move');
  const [playerPosition, setPlayerPosition] = useState<Vec2>({ x: 420, y: 520 });
  const [collected, setCollected] = useState(false);
  const [attackConfirmed, setAttackConfirmed] = useState(false);
  const lastMoveAt = useRef(performance.now());

  useEffect(() => {
    if (step !== 'attack' || attackConfirmed) return;
    const timer = window.setTimeout(() => {
      setAttackConfirmed(true);
      setStep('levelup');
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [attackConfirmed, step]);

  useEffect(() => {
    if (step !== 'collect' || collected) return;
    if (Math.hypot(playerPosition.x - 610, playerPosition.y - 520) > 58) return;
    setCollected(true);
    setStep('craft');
  }, [collected, playerPosition, step]);

  const handleMove = useCallback((move: Vec2) => {
    if (step === 'complete') return;
    const normalized = normalizeInputDirection(move);
    if (!normalized) return;
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.012, (now - lastMoveAt.current) / 1000));
    lastMoveAt.current = now;
    const speed = 220;
    if (step === 'move') setStep('attack');
    setPlayerPosition((position) => ({
      x: clampClient(position.x + normalized.x * speed * dt, 70, 1530),
      y: clampClient(position.y + normalized.y * speed * dt, 70, 930)
    }));
  }, [step]);

  const handleUpgrade = useCallback(() => {
    if (step === 'levelup') setStep('collect');
  }, [step]);

  const handleCraft = useCallback((weapon: WeaponType) => {
    if (step === 'craft' && weapon === 'keyboardShotgun') setStep('complete');
  }, [step]);

  const tutorialSnapshot = useMemo(
    () => makeTutorialSnapshot(step, playerPosition, collected, attackConfirmed),
    [attackConfirmed, collected, playerPosition, step]
  );

  return (
    <GameView
      snapshot={tutorialSnapshot}
      playerId="tutorial-player"
      tutorial={{ step, onMove: handleMove, onUpgrade: handleUpgrade, onCraft: handleCraft, onExit }}
    />
  );
}

function makeTutorialSnapshot(
  step: TutorialStep,
  playerPosition: Vec2,
  collected: boolean,
  attackConfirmed: boolean
): GameSnapshot {
  const inventory = emptyClientInventory();
  if (collected || step === 'craft' || step === 'complete') {
    inventory.keycapSet = 3;
    inventory.officeMotor = 1;
    inventory.mixCoffee = 1;
    inventory.partitionMaterial = 1;
  }
  const craftedWeapons: WeaponType[] = step === 'complete' ? ['keyboardShotgun'] : [];
  return {
    roomId: 'TUTORIAL',
    roomTitle: '튜토리얼',
    phase: step === 'complete' ? 'ended' : 'playing',
    settings: {
      maxPlayers: 1,
      gameMode: 'timedSurvival',
      gameDurationSec: 180,
      killTarget: 100,
      pvpEnabled: false
    },
    players: [{
      id: 'tutorial-player',
      nickname: '튜토리얼',
      avatarId: 0,
      ready: true,
      host: true,
      alive: true,
      hp: 100,
      maxHp: 100,
      position: playerPosition,
      aim: { x: 1, y: 0 },
      score: step === 'complete' ? 120 : collected ? 36 : attackConfirmed ? 20 : 0,
      kills: attackConfirmed ? 1 : 0,
      combo: attackConfirmed ? 1 : 0,
      level: step === 'levelup' || step === 'collect' || step === 'craft' || step === 'complete' ? 2 : 1,
      nextLevelKills: 3,
      pendingUpgradeChoices: step === 'levelup' ? tutorialUpgradeChoices() : [],
      pendingUpgradeCount: step === 'levelup' ? 1 : 0,
      upgrades: {
        range: 0,
        damage: 0,
        maxHp: 0,
        moveSpeed: 0,
        coffee: 0,
        partition: 0
      },
      inventory,
      craftedWeapons,
      weaponLevels: step === 'complete' ? { keyboardShotgun: 1 } : {},
      equippedWeapon: step === 'complete' ? 'keyboardShotgun' : undefined,
      craftedSupportEquipment: [],
      supportEquipmentLevels: {},
      equippedSupportEquipment: undefined,
      activeSupportEquipment: undefined,
      resourcesCollected: collected ? 2 : 0,
      facilitiesBuilt: 0,
      survivalSec: step === 'complete' ? 18 : 8
    }],
    results: [],
    zombies: step === 'attack' ? [{
      id: 'tutorial-zombie',
      type: 'normal',
      hp: attackConfirmed ? 0 : 18,
      position: { x: 710, y: 520 }
    }] : [],
    spawnWarnings: [],
    resources: collected || step === 'craft' || step === 'complete'
      ? []
      : [
          { id: 'tutorial-keycap', type: 'keycapSet', position: { x: 610, y: 520 } },
          { id: 'tutorial-motor', type: 'officeMotor', position: { x: 650, y: 560 } }
        ],
    craftingStations: [{
      id: 'tutorial-craft-station',
      position: { x: 940, y: 820 },
      width: 118,
      height: 78,
      interactionRadius: 150
    }],
    facilities: [],
    powerZones: [],
    supportZones: [],
    projectiles: step === 'attack' ? [{
      id: 'tutorial-shot',
      ownerId: 'tutorial-player',
      position: { x: playerPosition.x + 56, y: playerPosition.y },
      velocity: { x: 700, y: 0 },
      ttl: 0.4,
      variant: 'default',
      damage: 12,
      radius: 5,
      pierce: 0
    }] : [],
    walls: [
      { x: 0, y: 0, width: 1600, height: 24 },
      { x: 0, y: 976, width: 1600, height: 24 },
      { x: 0, y: 0, width: 24, height: 1000 },
      { x: 1576, y: 0, width: 24, height: 1000 },
      { x: 360, y: 120, width: 22, height: 360 },
      { x: 720, y: 520, width: 500, height: 22 },
      { x: 1100, y: 120, width: 300, height: 22 }
    ],
    feedbackEvents: step === 'attack' ? [{
      id: 'tutorial-hit',
      type: attackConfirmed ? 'kill' : 'hit',
      position: { x: 710, y: 520 },
      text: attackConfirmed ? '+10' : 'hit'
    }] : step === 'collect' || step === 'craft' ? [{
      id: 'tutorial-collect',
      type: 'collect',
      position: { x: 610, y: 520 },
      text: '재료'
    }] : [],
    wave: 1,
    wavePhase: step === 'craft' || step === 'complete' ? 'break' : 'combat',
    waveTimeRemaining: step === 'craft' || step === 'complete' ? 15 : 34,
    countdown: 0,
    remainingSec: 180,
    elapsedSec: step === 'complete' ? 18 : collected ? 12 : 6,
    objective: {
      mode: 'timedSurvival',
      label: '튜토리얼',
      current: step === 'complete' ? 1 : 0,
      target: 1,
      completed: step === 'complete',
      failed: false
    },
    map: {
      width: 1600,
      height: 1000,
      name: '분할 사무실',
      theme: 'officeGrid'
    }
  };
}

function emptyClientInventory(): GameSnapshot['players'][number]['inventory'] {
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

function tutorialUpgradeChoices(): UpgradeOption[] {
  return [
    {
      id: 'tutorial-damage',
      type: 'damage',
      title: '집중 타격',
      description: '기본 공격과 제작 무기 피해가 증가합니다.'
    },
    {
      id: 'tutorial-range',
      type: 'range',
      title: '시야 확보',
      description: '공격 사거리가 증가합니다.'
    },
    {
      id: 'tutorial-move',
      type: 'moveSpeed',
      title: '동선 숙달',
      description: '이동 속도가 조금 증가합니다.'
    }
  ];
}

function clampClient(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function GameGuideModal({ onClose, onStartTutorial }: { onClose: () => void; onStartTutorial: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="modal-card guide-modal">
        <div className="modal-header">
          <h2>게임 설명</h2>
          <button type="button" onClick={onClose}>닫기</button>
        </div>
        <div className="guide-actions">
          <button type="button" className="primary" onClick={onStartTutorial}>튜토리얼 시작</button>
        </div>
        <div className="guide-grid">
          <article className="guide-tutorial">
            <strong>실제 화면 튜토리얼</strong>
            <ol>
              <li>실제 게임 화면에서 WASD로 이동합니다.</li>
              <li>캔버스 안의 좀비 자동공격을 확인합니다.</li>
              <li>바닥 재료 쪽으로 이동해 수집합니다.</li>
              <li>실제 제작 HUD에서 장비를 하나 만듭니다.</li>
            </ol>
          </article>
          <article>
            <strong>목표</strong>
            <p>기본 목표는 제한시간 생존입니다. 무제한 생존과 좀비 처치 목표는 방장이 고급 설정에서 바꿀 수 있습니다.</p>
          </article>
          <article>
            <strong>아이템</strong>
            <p>제작대 근처에서 재료를 조합해 무기와 보조장비를 만들 수 있습니다. 믹스커피와 파티션은 직접 사용해야 합니다.</p>
          </article>
          <article>
            <strong>조작</strong>
            <p>WASD로 이동합니다. 자동 조준이 가까운 대상을 공격합니다. Q는 구급, E는 파티션 전개입니다.</p>
          </article>
          <article>
            <strong>난이도</strong>
            <p>아이템을 모으기 전에는 공격 범위가 짧습니다. 벽과 장판 위치를 활용해야 안정적으로 버팁니다.</p>
          </article>
        </div>
      </section>
    </div>
  );
}

function objectiveSummary(objective: GameSnapshot['objective']) {
  if (objective.mode === 'endless') return formatDuration(objective.current);
  if (objective.target === undefined) return `${objective.current}`;
  if (objective.mode === 'killTarget') return `${objective.current}/${objective.target}킬`;
  return `${objective.current}/${objective.target}초`;
}

function openingObjectiveTitle(snapshot: GameSnapshot) {
  if (snapshot.objective.mode === 'killTarget') return `먼저 ${snapshot.settings.killTarget}처치 달성`;
  if (snapshot.objective.mode === 'endless') return '오래 버티고 점수 올리기';
  return `${formatDuration(snapshot.settings.gameDurationSec)} 생존 경쟁`;
}

function openingObjectiveDetail(snapshot: GameSnapshot) {
  if (snapshot.objective.mode === 'killTarget') return '개인 처치 수가 목표에 먼저 도달하면 순위가 결정됩니다.';
  if (snapshot.objective.mode === 'endless') return '웨이브 압박 속에서 생존 시간과 점수를 함께 끌어올리세요.';
  return '제한 시간 동안 생존, 처치, 자원 수집으로 개인 점수를 높이세요.';
}

function formatDuration(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function ProfileModal({
  action,
  nickname,
  roomTitle,
  avatarId,
  onNicknameChange,
  onRoomTitleChange,
  onAvatarChange,
  onCancel,
  onConfirm
}: {
  action: PendingRoomAction;
  nickname: string;
  roomTitle: string;
  avatarId: number;
  onNicknameChange: (value: string) => void;
  onRoomTitleChange: (value: string) => void;
  onAvatarChange: (value: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="modal-card profile-modal">
        <div className="modal-header">
          <div>
            <p className="eyebrow">{action.mode === 'create' ? 'Create Room' : 'Join Room'}</p>
            <h2>{action.mode === 'create' ? '방 생성' : `${action.roomId} 입장`}</h2>
          </div>
          <button type="button" onClick={onCancel}>닫기</button>
        </div>
        {action.mode === 'create' && (
          <label>
            방 제목
            <input value={roomTitle} maxLength={24} onChange={(event) => onRoomTitleChange(event.target.value)} placeholder="생존 방" />
          </label>
        )}
        <label>
          닉네임
          <input value={nickname} maxLength={16} onChange={(event) => onNicknameChange(event.target.value)} placeholder="생존자" />
        </label>
        <div className="avatar-picker" aria-label="캐릭터 선택">
          {AVATARS.map((avatar) => (
            <button
              key={avatar.id}
              type="button"
              className={avatarId === avatar.id ? 'avatar-option active' : 'avatar-option'}
              onClick={() => onAvatarChange(avatar.id)}
              title={avatar.label}
            >
              <span
                className="avatar-thumb"
                style={avatarSelectionSpriteStyle(avatar, 64)}
              />
            </button>
          ))}
        </div>
        <div className="avatar-preview compact">
          <span
            className="avatar-preview-image"
            style={avatarSelectionSpriteStyle(AVATARS[avatarId], 92)}
          />
          <div>
            <strong>{AVATARS[avatarId].label}</strong>
            <span>외형만 바뀌며 능력 차이는 없습니다.</span>
          </div>
        </div>
        <button className="primary cta" onClick={onConfirm}>{action.mode === 'create' ? '방 만들기' : '입장하기'}</button>
      </section>
    </div>
  );
}

function GameView({ snapshot, playerId, tutorial }: { snapshot: GameSnapshot; playerId: string; tutorial?: TutorialController }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const latestRender = useRef<{ snapshot: GameSnapshot; me: NonNullable<typeof snapshot.players[number]> } | null>(null);
  const pressed = useRef(new Set<string>());
  const pointer = useRef<Vec2>({ x: 0, y: 0 });
  const lastInputDirection = useRef<Vec2>({ x: 1, y: 0 });
  const joystick = useRef<{ id: number; origin: Vec2; value: Vec2 } | null>(null);
  const [touchControlSide, setTouchControlSide] = useState<TouchControlSide>(() => readTouchControlSide());
  const [touchControlOpen, setTouchControlOpen] = useState(false);
  const [upgradeChoicesOpen, setUpgradeChoicesOpen] = useState(true);
  const [selectedInstallItem, setSelectedInstallItem] = useState<InstallItem | null>(null);
  const selectedInstallItemRef = useRef<InstallItem | null>(null);
  const queuedItem = useRef<{ type: ResourceType; requestId: number; until: number; aim?: Vec2 } | null>(null);
  const queuedCraft = useRef<{
    requestId: number;
    until: number;
    craftWeapon?: WeaponType;
    equipWeapon?: WeaponType;
    craftSupport?: SupportEquipmentType;
    equipSupport?: SupportEquipmentType;
  } | null>(null);
  const queuedSupport = useRef<{ type: SupportEquipmentType; requestId: number; until: number } | null>(null);
  const itemRequestSeq = useRef(0);
  const craftRequestSeq = useRef(0);
  const supportRequestSeq = useRef(0);
  const seenFeedback = useRef(new Set<string>());
  const visualEffects = useRef<VisualEffect[]>([]);
  const latestInputState = useRef<{ snapshot: GameSnapshot; me?: GameSnapshot['players'][number] }>({ snapshot });
  const audio = useRef(createAudioEngine());
  const spriteSheet = useGameImage(spriteSheetUrl);
  const propAtlas = useGameImage(propAtlasUrl);
  const craftingIcons = useGameImage(craftingIconsUrl);
  const avatarAtlas = useGameImage(avatarAtlasUrl);
  const me = snapshot.players.find((player) => player.id === playerId);
  latestInputState.current = { snapshot, me };

  const sendInput = useCallback(() => {
    const current = latestInputState.current;
    const currentMe = current.me;
    const move = keyboardMove(pressed.current, joystick.current?.value);
    const normalizedMove = normalizeInputDirection(move);
    if (normalizedMove) lastInputDirection.current = normalizedMove;
    const canFight = Boolean(currentMe?.alive);
    const now = performance.now();
    if (!canFight || (queuedItem.current && queuedItem.current.until < now)) queuedItem.current = null;
    if (!canFight || (queuedCraft.current && queuedCraft.current.until < now)) queuedCraft.current = null;
    if (!canFight || (queuedSupport.current && queuedSupport.current.until < now)) queuedSupport.current = null;
    const useItemRequest = canFight ? queuedItem.current : null;
    const craftRequest = canFight ? queuedCraft.current : null;
    const supportRequest = canFight ? queuedSupport.current : null;
    const autoAim = canFight && currentMe ? getAutoAim(current.snapshot, currentMe) : undefined;
    const aim = useItemRequest?.aim ?? (autoAim ? autoAim.direction : getPlacementAim(currentMe, pointer.current, move, lastInputDirection.current));
    const input: PlayerInput = {
      move,
      aim,
      shooting: Boolean(canFight && autoAim && currentMe && autoAim.distance <= playerAttackRange(current.snapshot, currentMe)),
      melee: false,
      useItem: useItemRequest?.type,
      useItemRequestId: useItemRequest?.requestId,
      craftWeapon: craftRequest?.craftWeapon,
      equipWeapon: craftRequest?.equipWeapon,
      craftSupport: craftRequest?.craftSupport,
      equipSupport: craftRequest?.equipSupport,
      craftRequestId: craftRequest?.requestId,
      activateSupport: supportRequest?.type,
      supportRequestId: supportRequest?.requestId
    };
    if (tutorial) tutorial.onMove(move);
    else socket.emit('input', input);
  }, [tutorial]);

  const queueItemUse = useCallback((type: ResourceType, aim?: Vec2) => {
    itemRequestSeq.current += 1;
    queuedItem.current = {
      type,
      requestId: itemRequestSeq.current,
      until: performance.now() + ITEM_INPUT_HOLD_MS,
      aim
    };
    sendInput();
  }, [sendInput]);

  const queueCraftAction = useCallback((action: Omit<NonNullable<typeof queuedCraft.current>, 'requestId' | 'until'>) => {
    craftRequestSeq.current += 1;
    queuedCraft.current = {
      ...action,
      requestId: craftRequestSeq.current,
      until: performance.now() + ITEM_INPUT_HOLD_MS
    };
    sendInput();
  }, [sendInput]);

  const queueSupportUse = useCallback((type: SupportEquipmentType) => {
    supportRequestSeq.current += 1;
    queuedSupport.current = {
      type,
      requestId: supportRequestSeq.current,
      until: performance.now() + ITEM_INPUT_HOLD_MS
    };
    sendInput();
  }, [sendInput]);

  const confirmPartitionInstall = useCallback(() => {
    const currentMe = latestInputState.current.me;
    if (!currentMe?.alive || currentMe.inventory.partitionMaterial <= 0) return;
    queueItemUse('partitionMaterial', getPlacementAim(
      currentMe,
      pointer.current,
      keyboardMove(pressed.current, joystick.current?.value),
      lastInputDirection.current
    ));
    setSelectedInstallItem(null);
  }, [queueItemUse]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      audio.current.unlock();
      pressed.current.add(event.code);
      if (!event.repeat && event.code === 'KeyQ') queueItemUse('mixCoffee');
      if (!event.repeat && event.code === 'KeyR') {
        const support = latestInputState.current.me?.equippedSupportEquipment;
        if (support && support !== 'robotVacuumDrone' && support !== 'emergencyAed') queueSupportUse(support);
      }
      if (!event.repeat && event.code === 'KeyE') {
        if (selectedInstallItemRef.current === 'partitionMaterial') confirmPartitionInstall();
        else if ((latestInputState.current.me?.inventory.partitionMaterial ?? 0) > 0) setSelectedInstallItem('partitionMaterial');
      }
      if (!event.repeat && event.code === 'Escape') setSelectedInstallItem(null);
      if (!event.repeat && (event.code === 'Enter' || event.code === 'Space') && selectedInstallItemRef.current === 'partitionMaterial') {
        event.preventDefault();
        confirmPartitionInstall();
      }
      sendInput();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      pressed.current.delete(event.code);
      sendInput();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [confirmPartitionInstall, queueItemUse, queueSupportUse, sendInput]);

  useEffect(() => {
    const id = window.setInterval(() => {
      sendInput();
    }, INPUT_SEND_MS);
    return () => window.clearInterval(id);
  }, [sendInput]);

  useEffect(() => {
    writeTouchControlSide(touchControlSide);
    joystick.current = null;
  }, [touchControlSide]);

  useEffect(() => {
    selectedInstallItemRef.current = selectedInstallItem;
  }, [selectedInstallItem]);

  useEffect(() => {
    if (!me?.alive || me.inventory.partitionMaterial <= 0) setSelectedInstallItem(null);
  }, [me?.alive, me?.inventory.partitionMaterial]);

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
        const camera = smoothRenderPosition(`camera:${current.me.id}`, current.me.position, CAMERA_FOLLOW_AMOUNT);
        const partitionPreview = selectedInstallItemRef.current === 'partitionMaterial' && current.me.inventory.partitionMaterial > 0
          ? getPartitionPlacement(
              current.me.position,
              getPlacementAim(
                current.me,
                pointer.current,
                keyboardMove(pressed.current, joystick.current?.value),
                lastInputDirection.current
              ),
              current.me.upgrades.partition,
              current.snapshot.walls,
              current.snapshot.facilities
            )
          : undefined;
        drawGame(
          context,
          rect.width,
          rect.height,
          current.snapshot,
          camera,
          spriteSheet,
          propAtlas,
          craftingIcons,
          avatarAtlas,
          partitionPreview,
          visualEffects.current
        );
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [spriteSheet, propAtlas, craftingIcons, avatarAtlas]);

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
  const threat = getThreatLabel(snapshot.wave);
  const isSpectating = Boolean(me && !me.alive);
  const pendingChoices = me?.pendingUpgradeChoices ?? [];
  const pendingUpgradeCount = me?.pendingUpgradeCount ?? 0;
  const pendingChoiceKey = pendingChoices.map((choice) => choice.id).join('|');
  const showOpeningTip = snapshot.phase === 'playing' && snapshot.elapsedSec < 18 && !isSpectating;
  const nearestCraftingStation = me
    ? snapshot.craftingStations
        .map((station) => ({ station, distance: Math.hypot(station.position.x - me.position.x, station.position.y - me.position.y) }))
        .filter(({ station, distance }) => distance <= station.interactionRadius)
        .sort((a, b) => a.distance - b.distance)[0]?.station
    : undefined;
  const sortedCraftWeapons = useMemo(() => {
    return sortCraftEntries(weaponKeys, (weapon) => ({
      crafted: Boolean(me?.craftedWeapons.includes(weapon)),
      equipped: me?.equippedWeapon === weapon,
      canCraft: Boolean(me && craftLevel(me.weaponLevels, weapon, me.craftedWeapons.includes(weapon)) < MAX_CRAFT_LEVEL && hasCost(me.inventory, WEAPON_COSTS[weapon]))
    }));
  }, [me?.craftedWeapons, me?.equippedWeapon, me?.inventory]);
  const sortedCraftSupport = useMemo(() => {
    return sortCraftEntries(supportEquipmentKeys, (support) => ({
      crafted: Boolean(me?.craftedSupportEquipment.includes(support)),
      equipped: me?.equippedSupportEquipment === support,
      canCraft: Boolean(me && craftLevel(me.supportEquipmentLevels, support, me.craftedSupportEquipment.includes(support)) < MAX_CRAFT_LEVEL && hasCost(me.inventory, SUPPORT_EQUIPMENT_COSTS[support]))
    }));
  }, [me?.craftedSupportEquipment, me?.equippedSupportEquipment, me?.inventory]);

  useEffect(() => {
    if (pendingChoices.length > 0) setUpgradeChoicesOpen(true);
  }, [pendingChoiceKey, pendingChoices.length]);

  const chooseUpgrade = useCallback((upgradeId: string) => {
    if (tutorial?.step === 'levelup') {
      tutorial.onUpgrade();
      return;
    }
    socket.emit('chooseUpgrade', upgradeId);
  }, [tutorial]);

  const activateUsableItem = useCallback((resource: ResourceType) => {
    if (isSpectating) return;
    if (resource === 'partitionMaterial') {
      if (selectedInstallItemRef.current === 'partitionMaterial') confirmPartitionInstall();
      else setSelectedInstallItem('partitionMaterial');
      return;
    }
    queueItemUse(resource);
  }, [confirmPartitionInstall, isSpectating, queueItemUse]);

  const craftOrEquipWeapon = useCallback((weapon: WeaponType) => {
    if (isSpectating) return;
    if (tutorial?.step === 'craft') {
      tutorial.onCraft(weapon);
      return;
    }
    const crafted = Boolean(me?.craftedWeapons.includes(weapon));
    const equipped = me?.equippedWeapon === weapon;
    const canUpgrade = Boolean(me && craftLevel(me.weaponLevels, weapon, crafted) < MAX_CRAFT_LEVEL && hasCost(me.inventory, WEAPON_COSTS[weapon]));
    if (crafted && !equipped) queueCraftAction({ equipWeapon: weapon });
    else if (canUpgrade) queueCraftAction({ craftWeapon: weapon });
    else if (crafted) queueCraftAction({ equipWeapon: weapon });
  }, [isSpectating, me, queueCraftAction, tutorial]);

  const craftOrEquipSupport = useCallback((support: SupportEquipmentType) => {
    if (isSpectating) return;
    const crafted = Boolean(me?.craftedSupportEquipment.includes(support));
    const equipped = me?.equippedSupportEquipment === support;
    const canUpgrade = Boolean(me && craftLevel(me.supportEquipmentLevels, support, crafted) < MAX_CRAFT_LEVEL && hasCost(me.inventory, SUPPORT_EQUIPMENT_COSTS[support]));
    if (crafted && !equipped) queueCraftAction({ equipSupport: support });
    else if (canUpgrade) queueCraftAction({ craftSupport: support });
    else if (crafted) queueCraftAction({ equipSupport: support });
  }, [isSpectating, me, queueCraftAction]);

  return (
    <main className={`game joystick-${touchControlSide}`}>
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
          if (selectedInstallItemRef.current === 'partitionMaterial') confirmPartitionInstall();
        }}
        onTouchStart={(event) => {
          handleTouch(event, joystick, touchControlSide);
          sendInput();
        }}
        onTouchMove={(event) => {
          handleTouch(event, joystick, touchControlSide);
          sendInput();
        }}
        onTouchEnd={(event) => {
          handleTouch(event, joystick, touchControlSide);
          sendInput();
        }}
      />
      <div
        className="touch-joystick-zone"
        onTouchStart={(event) => {
          handleTouch(event, joystick, 'all');
          sendInput();
        }}
        onTouchMove={(event) => {
          handleTouch(event, joystick, 'all');
          sendInput();
        }}
        onTouchEnd={(event) => {
          handleTouch(event, joystick, 'all');
          sendInput();
        }}
        onTouchCancel={(event) => {
          handleTouch(event, joystick, 'all');
          sendInput();
        }}
        aria-hidden="true"
      />
      <div className={!isSpectating && hpPercent <= 30 ? 'damage-vignette visible' : 'damage-vignette'} />
      <section className={`hud player-hud top-left ${hpPercent <= 30 && !isSpectating ? 'danger' : ''} ${isSpectating ? 'spectating' : ''}`}>
        <div className="player-summary">
          <strong>{me?.nickname}</strong>
          <span>{isSpectating ? '관전 중' : `${me?.score ?? 0}점`}</span>
        </div>
        <div className="hp-meter" aria-label={`체력 ${hp}/${maxHp}`}>
          <span style={{ width: `${hpPercent}%` }} />
        </div>
        <b>{isSpectating ? '이동 관전 가능' : `체력 ${hp}/${maxHp}`}</b>
      </section>
      <section className="hud usable-item-hud">
        {usableItemKeys.map((resource) => {
          const count = me?.inventory[resource] ?? 0;
          return (
            <button
              key={resource}
              type="button"
              className={`usable-item-button ${count > 0 ? 'ready' : 'empty'}`}
              aria-pressed={resource === selectedInstallItem}
              disabled={count <= 0 || isSpectating}
              onTouchStart={(event) => {
                event.preventDefault();
                event.stopPropagation();
                activateUsableItem(resource);
              }}
              onClick={() => activateUsableItem(resource)}
            >
              <i
                style={{
                  backgroundImage: resource === 'mixCoffee' ? `url(${craftingIconsUrl})` : `url(${propAtlasUrl})`,
                  backgroundPosition: resource === 'mixCoffee'
                    ? spriteBackgroundPosition(CRAFTING_ICON_SPRITES.mixCoffee.col, CRAFTING_ICON_SPRITES.mixCoffee.row, 4, 4)
                    : spriteBackgroundPosition(RESOURCE_SPRITES[resource].col, RESOURCE_SPRITES[resource].row, 4, 4)
                }}
              />
              <span>{resource === 'mixCoffee' ? 'Q' : selectedInstallItem === 'partitionMaterial' ? '확정' : 'E'}</span>
              <strong>{RESOURCE_LABELS[resource]}</strong>
              <b>{count}</b>
            </button>
          );
        })}
      </section>
      <section className="hud crafting-hud">
        <div className="crafting-title">
          <strong>{nearestCraftingStation ? '제작대' : '제작대 밖'}</strong>
          <span>{me?.equippedWeapon ? WEAPON_LABELS[me.equippedWeapon] : '기본 공격'} · {me?.equippedSupportEquipment ? SUPPORT_EQUIPMENT_LABELS[me.equippedSupportEquipment] : '보조 없음'}</span>
        </div>
        {nearestCraftingStation && !isSpectating ? (
        <div className="material-row">
          {craftMaterialKeys.map((resource) => (
            <span key={resource} className={(me?.inventory[resource] ?? 0) > 0 ? 'has' : ''}>
              <i
                style={{
                  backgroundImage: `url(${craftingIconsUrl})`,
                  backgroundPosition: spriteBackgroundPosition(CRAFTING_ICON_SPRITES[resource].col, CRAFTING_ICON_SPRITES[resource].row, 4, 4)
                }}
              />
              <b>{me?.inventory[resource] ?? 0}</b>
              <em>{RESOURCE_LABELS[resource]}</em>
            </span>
          ))}
        </div>
        ) : (
          <p className="crafting-hint">재료를 줍고 제작대에 가까이 가면 무기와 보조장비를 만들 수 있습니다.</p>
        )}
        {nearestCraftingStation && !isSpectating && (
          <div className="crafting-list">
            {sortedCraftWeapons.map((weapon) => {
              const crafted = Boolean(me?.craftedWeapons.includes(weapon));
              const equipped = me?.equippedWeapon === weapon;
              const level = craftLevel(me?.weaponLevels, weapon, crafted);
              const canCraft = Boolean(me && level < MAX_CRAFT_LEVEL && hasCost(me.inventory, WEAPON_COSTS[weapon]));
              return (
                <button
                  key={weapon}
                  type="button"
                  className={equipped ? 'equipped' : crafted ? 'crafted' : canCraft ? 'ready' : 'locked'}
                  disabled={!crafted && !canCraft}
                  onClick={() => craftOrEquipWeapon(weapon)}
                >
                  <i
                    style={craftingIconStyle(weapon)}
                  />
                  <strong>{WEAPON_LABELS[weapon]}{level > 0 ? ` +${level}` : ''}</strong>
                  <span>{crafted ? equipped ? canCraft ? `강화 ${costText(WEAPON_COSTS[weapon])}` : '장착 중' : '장착' : costText(WEAPON_COSTS[weapon])}</span>
                </button>
              );
            })}
            {sortedCraftSupport.map((support) => {
              const crafted = Boolean(me?.craftedSupportEquipment.includes(support));
              const equipped = me?.equippedSupportEquipment === support;
              const level = craftLevel(me?.supportEquipmentLevels, support, crafted);
              const canCraft = Boolean(me && level < MAX_CRAFT_LEVEL && hasCost(me.inventory, SUPPORT_EQUIPMENT_COSTS[support]));
              return (
                <button
                  key={support}
                  type="button"
                  className={equipped ? 'equipped support' : crafted ? 'crafted support' : canCraft ? 'ready support' : 'locked support'}
                  disabled={!crafted && !canCraft}
                  onClick={() => craftOrEquipSupport(support)}
                >
                  <i
                    style={craftingIconStyle(support)}
                  />
                  <strong>{SUPPORT_EQUIPMENT_LABELS[support]}{level > 0 ? ` +${level}` : ''}</strong>
                  <span>{crafted ? equipped ? canCraft ? `강화 ${costText(SUPPORT_EQUIPMENT_COSTS[support])}` : '장착 중' : '장착' : costText(SUPPORT_EQUIPMENT_COSTS[support])}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>
      {me?.equippedSupportEquipment && me.equippedSupportEquipment !== 'robotVacuumDrone' && me.equippedSupportEquipment !== 'emergencyAed' && (
        <button
          type="button"
          className="hud support-use-button"
          disabled={isSpectating}
          onClick={() => queueSupportUse(me.equippedSupportEquipment!)}
        >
          <strong>R</strong>
          <span>{SUPPORT_EQUIPMENT_LABELS[me.equippedSupportEquipment]}</span>
        </button>
      )}
      {pendingChoices.length > 0 && !isSpectating && !upgradeChoicesOpen && (
        <button
          type="button"
          className="hud upgrade-choice-hud upgrade-choice-collapsed"
          onTouchStart={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setUpgradeChoicesOpen(true);
          }}
          onClick={() => setUpgradeChoicesOpen(true)}
        >
          <strong>Lv {me?.level} 업그레이드</strong>
          <span>{pendingUpgradeCount > 1 ? `${pendingUpgradeCount}개 대기` : '선택 대기'}</span>
        </button>
      )}
      {pendingChoices.length > 0 && !isSpectating && upgradeChoicesOpen && (
        <section className="hud upgrade-choice-hud" aria-label="레벨업 업그레이드 선택">
          <div className="upgrade-choice-title">
            <strong>Lv {me?.level} 업그레이드</strong>
            <button
              type="button"
              className="upgrade-defer-button"
              onTouchStart={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setUpgradeChoicesOpen(false);
              }}
              onClick={() => setUpgradeChoicesOpen(false)}
            >
              {pendingUpgradeCount > 1 ? `${pendingUpgradeCount}개 대기` : '선택 대기'}
            </button>
          </div>
          <div className="upgrade-choice-list">
            {pendingChoices.map((upgrade) => (
              <button
                key={upgrade.id}
                type="button"
                onTouchStart={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  chooseUpgrade(upgrade.id);
                }}
                onClick={() => chooseUpgrade(upgrade.id)}
              >
                <strong>{upgrade.title}</strong>
                <span>{upgrade.description}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="hud mission-hud top-right">
        <span className="objective-chip"><strong>{snapshot.objective.label}</strong> {objectiveSummary(snapshot.objective)}</span>
        <span>웨이브 <b>{snapshot.wave}</b> · {snapshot.wavePhase === 'break' ? '제작 시간' : '전투'} {snapshot.waveTimeRemaining}초</span>
        <span>경과 <b>{formatDuration(snapshot.elapsedSec)}</b></span>
        <span>Lv <b>{me?.level ?? 1}</b></span>
        <span>다음 {me ? Math.max(0, me.nextLevelKills - me.kills) : 0}킬</span>
        <span className={`threat ${threat.tone}`}>위협 {threat.label}</span>
        <span className={snapshot.settings.pvpEnabled ? 'pvp-on' : 'pvp-off'}>{snapshot.settings.pvpEnabled ? 'PVP 켜짐' : 'PVP 꺼짐'}</span>
        {me?.host && (
          <button
            type="button"
            className="pause-button"
            onClick={() => socket.emit('pauseGame', snapshot.phase !== 'paused')}
          >
            {snapshot.phase === 'paused' ? '재개' : '일시정지'}
          </button>
        )}
      </section>
      {showOpeningTip && (
        <section className="hud opening-tip-hud" aria-label="초반 목표">
          <div>
            <strong>{openingObjectiveTitle(snapshot)}</strong>
            <span>{openingObjectiveDetail(snapshot)}</span>
          </div>
          <div className="opening-tip-steps">
            <span>자원 수집</span>
            <span>장비 성장</span>
            <span>랭킹 상승</span>
          </div>
        </section>
      )}
      {snapshot.phase === 'paused' && (
        <div className="pause-overlay">
          <strong>일시정지</strong>
          <span>{me?.host ? '재개 버튼으로 게임을 이어갈 수 있습니다.' : '방장이 게임을 멈췄습니다.'}</span>
        </div>
      )}
      <div className="touch-control-menu">
        <button
          type="button"
          className="hud touch-control-toggle"
          aria-label="조이스틱 설정"
          aria-expanded={touchControlOpen}
          onClick={() => setTouchControlOpen((open) => !open)}
        >
          ⚙
        </button>
        {touchControlOpen && (
          <section className="hud touch-control-hud" aria-label="조이스틱 위치">
            <span>조이스틱</span>
            <div className="touch-control-options">
              {(['left', 'right'] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  className={touchControlSide === side ? 'active' : ''}
                  aria-pressed={touchControlSide === side}
                  onClick={() => {
                    setTouchControlSide(side);
                    setTouchControlOpen(false);
                  }}
                >
                  {side === 'left' ? '왼쪽' : '오른쪽'}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
      <section className="hud ranking-mini">
        {hud.map((player, index) => (
          <span key={player.id}>{index + 1}. {player.nickname} {player.score}</span>
        ))}
      </section>
      {snapshot.phase === 'countdown' && <div className="countdown">{snapshot.countdown}</div>}
      <div className="touch-affordance" aria-hidden="true">
        <span />
      </div>
      {tutorial && (
        <TutorialOverlay
          step={tutorial.step}
          onExit={tutorial.onExit}
        />
      )}
    </main>
  );
}

function TutorialOverlay({ step, onExit }: { step: TutorialStep; onExit: () => void }) {
  const stepIndex = step === 'complete' ? 5 : ['move', 'attack', 'levelup', 'collect', 'craft'].indexOf(step);
  return (
    <>
      {step !== 'complete' && <div className={`tutorial-focus tutorial-focus-${step}`} aria-hidden="true" />}
      <section className="tutorial-step-card actual-tutorial-card" aria-live="polite">
        <div className="tutorial-progress">
          {['이동', '공격', '레벨업', '수집', '제작'].map((label, index) => (
            <span key={label} className={index <= stepIndex ? 'active' : ''}>{label}</span>
          ))}
        </div>
        {step === 'move' && (
          <>
            <strong>1. 실제 조작으로 이동</strong>
            <p>WASD 또는 방향키를 누르면 실제 게임 화면의 캐릭터가 움직입니다.</p>
          </>
        )}
        {step === 'attack' && (
          <>
            <strong>2. 자동공격 확인</strong>
            <p>가까운 좀비가 자동으로 타깃이 됩니다. 잠시 기다리면 처치가 확인됩니다.</p>
          </>
        )}
        {step === 'levelup' && (
          <>
            <strong>3. 레벨업 선택</strong>
            <p>실제 게임처럼 레벨업 선택지가 열렸습니다. 원하는 업그레이드 하나를 고르세요.</p>
          </>
        )}
        {step === 'collect' && (
          <>
            <strong>4. 재료 줍기</strong>
            <p>캔버스 안의 재료 쪽으로 이동하세요. 실제 게임처럼 가까이 가면 수집됩니다.</p>
          </>
        )}
        {step === 'craft' && (
          <>
            <strong>5. 제작대로 이동 후 장비 제작</strong>
            <p>오른쪽 아래 제작대로 직접 이동하세요. 가까이 가면 실제 제작 HUD가 열리고 키보드 샷건을 만들 수 있습니다.</p>
          </>
        )}
        {step === 'complete' && (
          <>
            <strong>튜토리얼 완료</strong>
            <p>실제 게임과 같은 HUD 흐름으로 이동, 자동공격, 수집, 제작을 확인했습니다.</p>
            <button type="button" className="primary" onClick={onExit}>로비로 돌아가기</button>
          </>
        )}
      </section>
    </>
  );
}

function readTouchControlSide(): TouchControlSide {
  if (typeof window === 'undefined') return 'left';
  try {
    return window.localStorage.getItem(TOUCH_CONTROL_SIDE_KEY) === 'right' ? 'right' : 'left';
  } catch {
    return 'left';
  }
}

function writeTouchControlSide(side: TouchControlSide) {
  try {
    window.localStorage.setItem(TOUCH_CONTROL_SIDE_KEY, side);
  } catch {
    // The setting still works for the current session when persistent storage is unavailable.
  }
}

function sortCraftEntries<T>(entries: readonly T[], getState: (entry: T) => { crafted: boolean; equipped: boolean; canCraft: boolean }) {
  return [...entries].sort((a, b) => craftSortScore(getState(a)) - craftSortScore(getState(b)));
}

function craftSortScore(state: { crafted: boolean; equipped: boolean; canCraft: boolean }) {
  if (state.canCraft) return 0;
  if (state.equipped) return 1;
  if (state.crafted) return 2;
  return 3;
}

function craftLevel<T extends string>(levels: Partial<Record<T, number>> | undefined, type: T, fallbackOwned: boolean) {
  return Math.max(fallbackOwned ? 1 : 0, levels?.[type] ?? 0);
}

function hasCost(inventory: GameSnapshot['players'][number]['inventory'], cost: Partial<Record<ResourceType, number>>) {
  return Object.entries(cost).every(([resource, amount]) => inventory[resource as ResourceType] >= (amount ?? 0));
}

function costText(cost: Partial<Record<ResourceType, number>>) {
  return Object.entries(cost)
    .map(([resource, amount]) => `${RESOURCE_LABELS[resource as ResourceType]} ${amount}`)
    .join(' · ');
}

function materialGlyph(resource: ResourceType) {
  if (resource === 'keycapSet') return 'K';
  if (resource === 'paperBundle') return '문';
  if (resource === 'officeMotor') return 'M';
  if (resource === 'batteryPack') return 'B';
  if (resource === 'rubberPart') return 'R';
  if (resource === 'approvalKit') return '승';
  return '·';
}

function keyboardMove(keys: Set<string>, joystickMove?: Vec2): Vec2 {
  if (joystickMove && Math.hypot(joystickMove.x, joystickMove.y) > 0.025) return joystickMove;
  return {
    x: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
    y: (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0)
  };
}

function normalizeInputDirection(direction?: Vec2) {
  const length = direction ? Math.hypot(direction.x, direction.y) : 0;
  if (!direction || length <= 0.025) return undefined;
  return {
    x: direction.x / length,
    y: direction.y / length
  };
}

function getPlacementAim(
  player: GameSnapshot['players'][number] | undefined,
  pointerAim: Vec2,
  moveAim?: Vec2,
  fallbackAim?: Vec2
): Vec2 {
  const normalizedMove = normalizeInputDirection(moveAim);
  if (normalizedMove) return normalizedMove;

  const normalizedFallback = normalizeInputDirection(fallbackAim);
  if (normalizedFallback) return normalizedFallback;

  const pointerLength = Math.hypot(pointerAim.x, pointerAim.y);
  if (pointerLength > 0.001) {
    return {
      x: pointerAim.x / pointerLength,
      y: pointerAim.y / pointerLength
    };
  }
  return player?.aim ?? { x: 1, y: 0 };
}

function getThreatLabel(wave: number) {
  if (wave >= 8) return { label: '매우 높음', tone: 'extreme' };
  if (wave >= 5) return { label: '높음', tone: 'high' };
  if (wave >= 3) return { label: '보통', tone: 'mid' };
  return { label: '낮음', tone: 'low' };
}

function spriteBackgroundPosition(col: number, row: number, columns: number, rows: number) {
  const x = columns <= 1 ? 0 : (col / (columns - 1)) * 100;
  const y = rows <= 1 ? 0 : (row / (rows - 1)) * 100;
  return `${x}% ${y}%`;
}

function craftingIconStyle(type: ResourceType | WeaponType | SupportEquipmentType): React.CSSProperties {
  const image = CRAFTING_ICON_IMAGES[type];
  if (image) {
    return {
      backgroundImage: `url(${image})`,
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      backgroundSize: 'contain'
    };
  }
  const sprite = CRAFTING_ICON_SPRITES[type];
  return {
    backgroundImage: `url(${craftingIconsUrl})`,
    backgroundPosition: spriteBackgroundPosition(sprite.col, sprite.row, 4, 4)
  };
}

function avatarSelectionSpriteStyle(avatar: (typeof AVATARS)[number], displaySize: number): React.CSSProperties {
  const baseX = avatar.col === 0 ? '0%' : '100%';
  const baseY = avatar.row === 0 ? '0%' : '100%';
  const offset = AVATAR_VISUAL_OFFSETS[avatar.id];
  const x = Math.round((offset.x / AVATAR_CELL_SIZE) * displaySize * 10) / 10;
  const y = Math.round((offset.y / AVATAR_CELL_SIZE) * displaySize * 10) / 10;

  return {
    backgroundImage: `url(${avatarAtlasUrl})`,
    backgroundPosition: `calc(${baseX} + ${x}px) calc(${baseY} + ${y}px)`
  };
}

function handleTouch(
  event: React.TouchEvent<HTMLElement>,
  joystick: React.MutableRefObject<{ id: number; origin: Vec2; value: Vec2 } | null>,
  side: TouchControlSide | 'all'
) {
  createAudioEngine().unlock();
  event.preventDefault();
  const rect = event.currentTarget.getBoundingClientRect();
  const touches = Array.from(event.touches);
  const joystickTouch = touches.find((touch) => {
    if (side === 'all') return true;
    const x = touch.clientX - rect.left;
    return side === 'left' ? x <= rect.width / 2 : x >= rect.width / 2;
  });
  if (!joystickTouch) {
    joystick.current = null;
    return;
  }
  if (!joystick.current || joystick.current.id !== joystickTouch.identifier) {
    joystick.current = { id: joystickTouch.identifier, origin: { x: joystickTouch.clientX, y: joystickTouch.clientY }, value: { x: 0, y: 0 } };
  }
  const dx = joystickTouch.clientX - joystick.current.origin.x;
  const dy = joystickTouch.clientY - joystick.current.origin.y;
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

function getAutoAim(snapshot: GameSnapshot, player: NonNullable<GameSnapshot['players'][number]>) {
  const candidates = [
    ...snapshot.zombies.map((zombie) => ({
      position: zombie.position,
      distance: Math.hypot(zombie.position.x - player.position.x, zombie.position.y - player.position.y)
    })),
    ...(snapshot.settings.pvpEnabled
      ? snapshot.players
          .filter((target) => target.id !== player.id && target.alive)
          .map((target) => ({
            position: target.position,
            distance: Math.hypot(target.position.x - player.position.x, target.position.y - player.position.y)
          }))
      : [])
  ]
    .sort((a, b) => a.distance - b.distance);
  const target = candidates[0];
  if (!target) return undefined;
  const dx = target.position.x - player.position.x;
  const dy = target.position.y - player.position.y;
  const size = Math.max(1, Math.hypot(dx, dy));
  return {
    distance: target.distance,
    direction: { x: dx / size, y: dy / size }
  };
}

function playerAttackRange(snapshot: GameSnapshot, player: GameSnapshot['players'][number]) {
  const zoneBonus = snapshot.powerZones.some((zone) => Math.hypot(zone.position.x - player.position.x, zone.position.y - player.position.y) <= zone.radius)
    ? POWER_ZONE_RANGE_BONUS
    : 0;
  return (BASE_ATTACK_RANGE + zoneBonus) * (1 + player.upgrades.range * 0.1);
}

function drawGame(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: GameSnapshot,
  camera: Vec2,
  spriteSheet: HTMLImageElement | null,
  propAtlas: HTMLImageElement | null,
  craftingIcons: HTMLImageElement | null,
  avatarAtlas: HTMLImageElement | null,
  partitionPreview: PartitionPlacement | undefined,
  effects: VisualEffect[]
) {
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#dce8e5';
  context.fillRect(0, 0, width, height);
  context.save();
  context.translate(width / 2 - camera.x, height / 2 - camera.y);

  drawOfficeFloor(context, snapshot.map, propAtlas);
  for (const wall of snapshot.walls) {
    drawWall(context, wall);
  }
  for (const warning of snapshot.spawnWarnings) {
    drawSpawnWarning(context, warning);
  }
  for (const resource of snapshot.resources) {
    drawWorldResource(context, propAtlas, craftingIcons, resource.type, resource.position);
  }
  for (const station of snapshot.craftingStations) {
    drawCraftingStation(context, propAtlas, station);
  }
  for (const zone of snapshot.powerZones) {
    drawPowerZone(context, zone);
  }
  for (const zone of snapshot.supportZones) {
    drawSupportZone(context, zone);
  }
  for (const facility of snapshot.facilities) {
    drawWorldFacility(context, propAtlas, facility);
    const hpBarWidth = Math.max(48, (facility.width ?? 48) * 0.72);
    const hpBarTop = facility.position.y - (facility.height ?? 56) / 2 - 9;
    context.fillStyle = 'rgba(255,255,255,0.35)';
    context.fillRect(facility.position.x - hpBarWidth / 2, hpBarTop, Math.max(0, facility.hp / 220) * hpBarWidth, 4);
  }
  if (partitionPreview) drawPartitionPreview(context, partitionPreview);
  for (const projectile of snapshot.projectiles) {
    drawProjectile(context, projectile);
  }
  for (const zombie of snapshot.zombies) {
    const impact = getActiveImpact(zombie.position, effects);
    const shake = impact ? Math.sin((performance.now() - impact.startedAt) * 0.09) * (1 - impact.age) * 5 : 0;
    const now = performance.now();
    const smoothedPosition = smoothRenderPosition(`zombie:${zombie.id}`, zombie.position, REMOTE_ENTITY_FOLLOW_AMOUNT);
    const drawPosition = { x: smoothedPosition.x + shake, y: smoothedPosition.y };
    const sprite = SPRITES[zombie.type];
    const motion = sampleMotion(`zombie:${zombie.id}`, zombie.position, now);
    const frame = walkFrame(now, sprite.frameMs, motion.lastMovedAt);
    const pulse = framePulse(frame);
    drawShadow(context, drawPosition, sprite.shadow + pulse * 4);
    if (spriteSheet) drawAnimatedSprite(context, spriteSheet, sprite.row, frame, drawPosition, sprite.size, motion.direction, pulse);
    else drawEnemyUnit(context, zombie.type, drawPosition);
    if (impact) drawImpactFlash(context, drawPosition, zombie.type === 'tanker' ? 58 : 42, impact.age, impact.type);
  }
  for (const player of snapshot.players) {
    const now = performance.now();
    const motion = sampleMotion(`player:${player.id}`, player.position, now);
    const moving = now - motion.lastMovedAt < MOVEMENT_HOLD_MS;
    const frame = moving ? walkFrame(now, SPRITES.player.frameMs, motion.lastMovedAt) : 0;
    const pulse = moving ? framePulse(frame) : 0;
    const renderDirection = moving ? motion.direction : player.aim;
    const impact = getActiveImpact(player.position, effects);
    const shake = impact ? Math.sin((performance.now() - impact.startedAt) * 0.16) * (1 - impact.age) * 7 : 0;
    const baseDrawPosition = smoothRenderPosition(
      `player:${player.id}`,
      player.position,
      player.id === socket.id ? LOCAL_PLAYER_FOLLOW_AMOUNT : REMOTE_ENTITY_FOLLOW_AMOUNT
    );
    const drawPosition = { x: baseDrawPosition.x + shake, y: baseDrawPosition.y };
    context.globalAlpha = player.alive ? 1 : 0.35;
    drawShadow(context, drawPosition, 28 + pulse * 3);
    const accentColor = player.id === socket.id ? '#7bdff2' : playerColor(player.id);
    const sprite = avatarSprite(player.avatarId);
    if (avatarAtlas) drawMotionAtlasSprite(context, avatarAtlas, sprite.col, sprite.row, 2, 2, drawPosition, sprite.size, renderDirection, pulse);
    else if (spriteSheet) drawAnimatedSprite(context, spriteSheet, SPRITES.player.row, frame, drawPosition, SPRITES.player.size, renderDirection, pulse);
    else drawPlayerUnit(context, drawPosition, player.avatarId);
    if (impact) drawPlayerHitFlash(context, drawPosition, impact.age);
    context.strokeStyle = accentColor;
    context.lineWidth = player.id === socket.id ? 3 : 2;
    context.beginPath();
    context.arc(drawPosition.x, drawPosition.y, player.id === socket.id ? 21 : 19, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = '#ffffff';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(drawPosition.x, drawPosition.y);
    context.lineTo(drawPosition.x + player.aim.x * 24, drawPosition.y + player.aim.y * 24);
    context.stroke();
    const visualPlayer = { ...player, position: drawPosition };
    drawEquipmentAuras(context, visualPlayer);
    drawPlayerSupportEquipment(context, visualPlayer);
    drawPlayerNameplate(context, player.nickname, player.hp, drawPosition, accentColor, player.alive);
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
      drawInkSlash(context, effect.position, 34 + age * 16, age, 'rgba(247,251,250,0.86)', 'rgba(42,55,58,0.45)');
      context.restore();
      continue;
    }
    if (effect.type === 'hit') {
      drawHitBurst(context, effect.position, age, '#fff0a3');
    } else if (effect.type === 'kill') {
      drawHitBurst(context, effect.position, age, '#ff806f', 1.45);
      drawInkSlash(context, effect.position, 38 + age * 28, age, 'rgba(255,128,111,0.72)', 'rgba(42,55,58,0.36)');
    } else if (effect.type === 'collect' || effect.type === 'build' || effect.type === 'heal') {
      drawPickupMotes(context, effect.position, age, color);
    } else if (effect.type === 'playerDown') {
      drawDownDust(context, effect.position, age);
    }
    context.font = effect.type === 'playerDown' ? '800 17px sans-serif' : '800 14px sans-serif';
    context.textAlign = 'center';
    context.lineWidth = 3;
    context.strokeStyle = 'rgba(28,38,36,0.78)';
    context.strokeText(effect.text, effect.position.x, y);
    context.fillStyle = color;
    context.fillText(effect.text, effect.position.x, y);
    context.restore();
  }
}

function drawHitBurst(context: CanvasRenderingContext2D, position: Vec2, age: number, color: string, scale = 1) {
  context.save();
  context.strokeStyle = 'rgba(31,39,38,0.62)';
  context.fillStyle = color;
  context.lineCap = 'round';
  for (let i = 0; i < 7; i += 1) {
    const angle = i * 0.897 + age * 0.45;
    const inner = (8 + age * 8) * scale;
    const outer = (18 + age * 24 + (i % 2) * 5) * scale;
    const x1 = position.x + Math.cos(angle) * inner;
    const y1 = position.y + Math.sin(angle) * inner * 0.62;
    const x2 = position.x + Math.cos(angle) * outer;
    const y2 = position.y + Math.sin(angle) * outer * 0.62;
    context.lineWidth = i % 2 === 0 ? 4 : 2;
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
    context.beginPath();
    context.arc(x2, y2, (2.2 + (i % 3)) * (1 - age * 0.35), 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawInkSlash(
  context: CanvasRenderingContext2D,
  position: Vec2,
  radius: number,
  age: number,
  color: string,
  outline: string
) {
  context.save();
  context.lineCap = 'round';
  context.strokeStyle = outline;
  context.lineWidth = 9 * (1 - age * 0.45);
  context.beginPath();
  context.arc(position.x, position.y, radius, -0.78 - age * 0.2, 0.82 + age * 0.16);
  context.stroke();
  context.strokeStyle = color;
  context.lineWidth = 5 * (1 - age * 0.45);
  context.beginPath();
  context.arc(position.x, position.y, radius, -0.7 - age * 0.2, 0.72 + age * 0.16);
  context.stroke();
  context.restore();
}

function drawPickupMotes(context: CanvasRenderingContext2D, position: Vec2, age: number, color: string) {
  context.save();
  context.fillStyle = color;
  context.strokeStyle = 'rgba(28,38,36,0.4)';
  context.lineWidth = 1.5;
  for (let i = 0; i < 6; i += 1) {
    const angle = i * 1.047 + 0.4;
    const distance = 8 + age * (22 + i * 1.7);
    const x = position.x + Math.cos(angle) * distance;
    const y = position.y + Math.sin(angle) * distance * 0.58 - age * 18;
    context.beginPath();
    context.roundRect(x - 3, y - 3, 6, 6, 2);
    context.fill();
    context.stroke();
  }
  context.restore();
}

function drawDownDust(context: CanvasRenderingContext2D, position: Vec2, age: number) {
  context.save();
  context.fillStyle = 'rgba(52,61,58,0.24)';
  for (let i = 0; i < 5; i += 1) {
    const angle = i * 1.256;
    context.beginPath();
    context.ellipse(
      position.x + Math.cos(angle) * age * 34,
      position.y + 16 + Math.sin(angle) * age * 10,
      12 * (1 - age * 0.35),
      5 * (1 - age * 0.35),
      angle,
      0,
      Math.PI * 2
    );
    context.fill();
  }
  context.restore();
}

function drawProjectile(context: CanvasRenderingContext2D, projectile: GameSnapshot['projectiles'][number]) {
  const speed = Math.max(1, Math.hypot(projectile.velocity.x, projectile.velocity.y));
  const dir = { x: projectile.velocity.x / speed, y: projectile.velocity.y / speed };
  const tail = {
    x: projectile.position.x - dir.x * 34,
    y: projectile.position.y - dir.y * 34
  };
  const color = projectile.variant === 'keyboardShotgun'
    ? '#f49ac2'
    : projectile.variant === 'printerCannon'
      ? '#f7fbfa'
      : projectile.variant === 'corporateCardBoomerang'
        ? '#f0c86a'
        : projectile.variant === 'guardFlashlight'
          ? '#fff4a3'
          : '#fff4a3';
  const glow = projectile.variant === 'printerCannon' ? '#4f5960' : projectile.variant === 'corporateCardBoomerang' ? '#f0c86a' : '#7bdff2';

  context.save();
  const gradient = context.createLinearGradient(tail.x, tail.y, projectile.position.x, projectile.position.y);
  gradient.addColorStop(0, 'rgba(123,223,242,0)');
  gradient.addColorStop(0.4, projectile.variant === 'corporateCardBoomerang' ? 'rgba(240,200,106,0.45)' : 'rgba(123,223,242,0.5)');
  gradient.addColorStop(1, color);
  context.strokeStyle = gradient;
  context.lineWidth = projectile.variant === 'printerCannon' ? 8 : 5;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(tail.x, tail.y);
  context.lineTo(projectile.position.x, projectile.position.y);
  context.stroke();
  context.fillStyle = color;
  context.shadowColor = glow;
  context.shadowBlur = 10;
  if (projectile.variant === 'corporateCardBoomerang') {
    context.translate(projectile.position.x, projectile.position.y);
    context.rotate(Math.atan2(dir.y, dir.x));
    context.beginPath();
    context.roundRect(-9, -5, 18, 10, 3);
    context.fill();
  } else if (projectile.variant === 'printerCannon') {
    context.beginPath();
    context.arc(projectile.position.x, projectile.position.y, 9, 0, Math.PI * 2);
    context.fill();
  } else {
    context.beginPath();
    context.arc(projectile.position.x, projectile.position.y, 5, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawSpawnWarning(context: CanvasRenderingContext2D, warning: GameSnapshot['spawnWarnings'][number]) {
  const progress = 1 - Math.max(0, Math.min(1, warning.ttl / Math.max(0.001, warning.duration)));
  const pulse = 0.5 + Math.sin(performance.now() * 0.018) * 0.5;
  const radius = warning.type === 'tanker' ? 46 : warning.type === 'runner' ? 34 : 38;
  const ringRadius = radius + progress * 18 + pulse * 4;
  const color = warning.type === 'tanker' ? '#a979ff' : warning.type === 'runner' ? '#ff9d5c' : '#ff6f61';
  const label = warning.type === 'tanker' ? '대형 접근' : warning.type === 'runner' ? '고속 접근' : '좀비 접근';

  context.save();
  context.translate(warning.position.x, warning.position.y);
  context.globalAlpha = 0.22 + progress * 0.38;
  context.fillStyle = color;
  context.beginPath();
  context.arc(0, 0, radius * (0.55 + progress * 0.2), 0, Math.PI * 2);
  context.fill();

  context.globalAlpha = 0.82;
  context.strokeStyle = color;
  context.lineWidth = 4;
  context.setLineDash([10, 7]);
  context.beginPath();
  context.arc(0, 0, ringRadius, 0, Math.PI * 2);
  context.stroke();
  context.setLineDash([]);

  context.globalAlpha = 0.95;
  context.strokeStyle = 'rgba(23,33,29,0.72)';
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(-12, -12);
  context.lineTo(0, 12);
  context.lineTo(12, -12);
  context.stroke();
  context.strokeStyle = '#fff4a3';
  context.lineWidth = 2.5;
  context.beginPath();
  context.moveTo(-12, -12);
  context.lineTo(0, 12);
  context.lineTo(12, -12);
  context.stroke();

  context.font = '800 12px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.strokeStyle = 'rgba(23,33,29,0.78)';
  context.lineWidth = 3;
  context.strokeText(label, 0, -radius - 18);
  context.fillStyle = '#fff4a3';
  context.fillText(label, 0, -radius - 18);
  context.restore();
}

function drawWorldResource(
  context: CanvasRenderingContext2D,
  propAtlas: HTMLImageElement | null,
  craftingIcons: HTMLImageElement | null,
  type: ResourceType,
  position: Vec2
) {
  const sprite = RESOURCE_SPRITES[type];
  const now = performance.now();
  const bob = Math.sin(now * 0.004 + position.x * 0.03 + position.y * 0.02) * 1.6;
  const size = sprite.size * 1.34;

  context.save();
  drawGroundBlob(context, position, size * 0.86, 'rgba(28,38,36,0.16)');
  context.globalAlpha = 0.85;
  context.strokeStyle = 'rgba(255,244,163,0.28)';
  context.lineWidth = 2;
  context.setLineDash([5, 6]);
  context.beginPath();
  context.ellipse(position.x, position.y + 8, size * 0.48, size * 0.22, 0, 0, Math.PI * 2);
  context.stroke();
  context.setLineDash([]);
  context.globalAlpha = 1;

  if (craftingIcons && CRAFTING_ICON_SPRITES[type]) {
    const icon = CRAFTING_ICON_SPRITES[type];
    drawAtlasSprite(context, craftingIcons, icon.col, icon.row, 4, 4, { x: position.x, y: position.y + bob }, size * 1.28);
  } else if (propAtlas && isAtlasResource(type)) {
    drawAtlasSprite(context, propAtlas, sprite.col, sprite.row, 4, 4, { x: position.x, y: position.y + bob }, size);
  } else {
    drawResourceNode(context, type, { x: position.x, y: position.y + bob });
  }
  context.restore();
}

function isAtlasResource(type: ResourceType) {
  return type === 'partitionMaterial';
}

function drawCraftingStation(context: CanvasRenderingContext2D, propAtlas: HTMLImageElement | null, station: GameSnapshot['craftingStations'][number]) {
  const { position } = station;
  const pulse = 0.5 + Math.sin(performance.now() * 0.004 + position.x * 0.01) * 0.5;
  context.save();
  if (propAtlas) {
    drawAtlasSprite(context, propAtlas, 1, 2, 4, 4, position, 132);
  } else {
    drawGroundBlob(context, position, 132, 'rgba(23,59,63,0.18)');
    context.fillStyle = '#b88458';
    context.strokeStyle = '#203230';
    context.lineWidth = 3;
    context.beginPath();
    context.roundRect(position.x - 58, position.y - 30, 116, 60, 8);
    context.fill();
    context.stroke();
    context.fillStyle = '#243d42';
    context.beginPath();
    context.roundRect(position.x - 24, position.y - 45, 48, 30, 5);
    context.fill();
    context.stroke();
    context.fillStyle = '#7bdff2';
    context.globalAlpha = 0.82;
    context.fillRect(position.x - 17, position.y - 39, 34, 18);
  }
  context.globalAlpha = 0.28 + pulse * 0.18;
  context.strokeStyle = '#fff4a3';
  context.lineWidth = 2;
  context.setLineDash([8, 8]);
  context.beginPath();
  context.arc(position.x, position.y, station.interactionRadius, 0, Math.PI * 2);
  context.stroke();
  context.setLineDash([]);
  context.globalAlpha = 1;
  context.fillStyle = '#fff4a3';
  context.font = '900 12px sans-serif';
  context.textAlign = 'center';
  context.strokeStyle = 'rgba(23,33,29,0.76)';
  context.lineWidth = 3;
  context.strokeText('제작대', position.x, position.y - 58);
  context.fillText('제작대', position.x, position.y - 58);
  context.restore();
}

function drawSupportZone(context: CanvasRenderingContext2D, zone: GameSnapshot['supportZones'][number]) {
  context.save();
  const progress = Math.max(0, Math.min(1, zone.ttl / 3));
  context.globalAlpha = 0.18 + progress * 0.16;
  context.fillStyle = zone.type === 'mzKeycap' ? '#f49ac2' : '#7bdff2';
  context.beginPath();
  context.arc(zone.position.x, zone.position.y, zone.radius, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 0.92;
  context.strokeStyle = '#fff4a3';
  context.lineWidth = 3;
  context.setLineDash([7, 9]);
  context.beginPath();
  context.arc(zone.position.x, zone.position.y, zone.radius * (0.35 + (1 - progress) * 0.65), 0, Math.PI * 2);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = '#fff4a3';
  context.font = '900 13px sans-serif';
  context.textAlign = 'center';
  context.fillText('ASMR 아님', zone.position.x, zone.position.y - 10);
  context.restore();
}

function drawWorldFacility(
  context: CanvasRenderingContext2D,
  propAtlas: HTMLImageElement | null,
  facility: GameSnapshot['facilities'][number]
) {
  const { type, position } = facility;
  if (type === 'partitionBarricade' && facility.width && facility.height) {
    drawPartitionBarrier(context, position, facility.width, facility.height);
    return;
  }
  const sprite = FACILITY_SPRITES[type];
  const size = sprite.size * 1.72;

  context.save();
  drawGroundBlob(context, position, size * 1.04, 'rgba(20,31,30,0.22)');
  context.strokeStyle = 'rgba(23,59,63,0.24)';
  context.lineWidth = 2;
  context.beginPath();
  context.ellipse(position.x, position.y + 10, size * 0.55, size * 0.28, -0.08, 0, Math.PI * 2);
  context.stroke();

  if (propAtlas) {
    drawAtlasSprite(context, propAtlas, sprite.col, sprite.row, 4, 4, position, size);
  } else {
    drawFacilityNode(context, type, position);
  }
  context.restore();
}

function drawPartitionBarrier(context: CanvasRenderingContext2D, position: Vec2, width: number, height: number) {
  const left = position.x - width / 2;
  const top = position.y - height / 2;
  const vertical = height > width;
  const seamCount = Math.max(2, Math.floor((vertical ? height : width) / 34));

  context.save();
  drawGroundBlob(context, position, Math.max(width, height) * 0.94, 'rgba(20,31,30,0.2)');
  context.fillStyle = '#a7debd';
  context.strokeStyle = 'rgba(23,59,63,0.46)';
  context.lineWidth = 3;
  context.beginPath();
  context.roundRect(left, top, width, height, 6);
  context.fill();
  context.stroke();

  context.strokeStyle = 'rgba(23,59,63,0.28)';
  context.lineWidth = 2;
  for (let i = 1; i < seamCount; i += 1) {
    context.beginPath();
    if (vertical) {
      const y = top + (height / seamCount) * i;
      context.moveTo(left + 4, y);
      context.lineTo(left + width - 4, y);
    } else {
      const x = left + (width / seamCount) * i;
      context.moveTo(x, top + 4);
      context.lineTo(x, top + height - 4);
    }
    context.stroke();
  }

  context.fillStyle = 'rgba(247,251,250,0.42)';
  context.beginPath();
  context.roundRect(left + 5, top + 5, Math.max(4, width - 10), Math.max(4, Math.min(8, height - 10)), 3);
  context.fill();
  context.restore();
}

function drawGroundBlob(context: CanvasRenderingContext2D, position: Vec2, width: number, fill: string) {
  context.fillStyle = fill;
  context.beginPath();
  context.ellipse(position.x + 2, position.y + 18, width * 0.46, width * 0.18, -0.08, 0, Math.PI * 2);
  context.fill();
}

function drawPowerZone(context: CanvasRenderingContext2D, zone: GameSnapshot['powerZones'][number]) {
  const pulse = 0.5 + Math.sin(performance.now() * 0.008) * 0.5;
  context.save();
  context.fillStyle = `rgba(123, 223, 242, ${0.12 + pulse * 0.05})`;
  context.strokeStyle = 'rgba(255, 224, 108, 0.62)';
  context.lineWidth = 3;
  context.setLineDash([10, 8]);
  context.beginPath();
  context.arc(zone.position.x, zone.position.y, zone.radius, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = 'rgba(255, 244, 163, 0.72)';
  context.beginPath();
  context.arc(zone.position.x, zone.position.y, 10 + pulse * 4, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawEquipmentAuras(context: CanvasRenderingContext2D, player: GameSnapshot['players'][number]) {
  if (!player.equippedWeapon) return;
  context.save();
  context.globalAlpha = 0.18;
  context.strokeStyle = '#fff4a3';
  context.lineWidth = 2;
  context.beginPath();
  context.arc(player.position.x, player.position.y + 2, 28, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawPlayerSupportEquipment(context: CanvasRenderingContext2D, player: GameSnapshot['players'][number]) {
  const now = performance.now() / 1000;
  context.save();
  if (player.equippedSupportEquipment === 'robotVacuumDrone') {
    const angle = now * 2.6;
    const x = player.position.x + Math.cos(angle) * 42;
    const y = player.position.y + Math.sin(angle) * 24 + 8;
    drawGroundBlob(context, { x, y }, 34, 'rgba(23,59,63,0.16)');
    context.fillStyle = '#d7e3e4';
    context.strokeStyle = '#172d31';
    context.lineWidth = 2.5;
    context.beginPath();
    context.ellipse(x, y, 18, 14, angle * 0.2, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = '#7bdff2';
    context.beginPath();
    context.arc(x + Math.cos(angle) * 7, y + Math.sin(angle) * 5, 4, 0, Math.PI * 2);
    context.fill();
  }
  if (player.activeSupportEquipment === 'annualLeaveShield') {
    const pulse = 0.5 + Math.sin(now * 13) * 0.5;
    context.globalAlpha = 0.42 + pulse * 0.16;
    context.strokeStyle = '#f0c86a';
    context.fillStyle = 'rgba(255,244,163,0.12)';
    context.lineWidth = 4;
    context.beginPath();
    context.arc(player.position.x, player.position.y + 2, 34 + pulse * 5, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.globalAlpha = 0.95;
    context.font = '900 11px sans-serif';
    context.textAlign = 'center';
    context.fillStyle = '#f0c86a';
    context.fillText('반려', player.position.x, player.position.y - 36);
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

  if (type === 'partitionMaterial') {
    context.fillStyle = '#a7debd';
    context.beginPath();
    context.roundRect(-6, -13, 12, 26, 4);
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(0, -13);
    context.lineTo(0, 13);
    context.stroke();
  } else if (type === 'mixCoffee') {
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.roundRect(-10, -13, 20, 26, 6);
    context.fill();
    context.stroke();
    context.strokeStyle = '#b88458';
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(-10, -4);
    context.lineTo(10, -4);
    context.moveTo(-5, -13);
    context.lineTo(-2, -19);
    context.moveTo(4, -13);
    context.lineTo(7, -19);
    context.stroke();
  } else {
    const colors: Record<string, string> = {
      keycapSet: '#f49ac2',
      paperBundle: '#f7fbfa',
      officeMotor: '#6f8580',
      batteryPack: '#7bdff2',
      rubberPart: '#8fcf8b',
      approvalKit: '#f0c86a'
    };
    context.fillStyle = colors[type] ?? '#fff4a3';
    context.beginPath();
    context.roundRect(-13, -13, 26, 26, 7);
    context.fill();
    context.stroke();
    context.fillStyle = '#172d31';
    context.font = '900 12px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(materialGlyph(type), 0, 1);
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

function drawPartitionPreview(context: CanvasRenderingContext2D, placement: PartitionPlacement) {
  const { position, width, height, valid } = placement;
  const left = position.x - width / 2;
  const top = position.y - height / 2;
  const color = valid ? '#5ac8c8' : '#ff6f61';
  const fill = valid ? 'rgba(90, 200, 200, 0.24)' : 'rgba(255, 111, 97, 0.18)';

  context.save();
  context.fillStyle = fill;
  context.strokeStyle = color;
  context.lineWidth = 3;
  context.setLineDash(valid ? [10, 6] : [5, 5]);
  context.beginPath();
  context.roundRect(left, top, width, height, 6);
  context.fill();
  context.stroke();
  context.setLineDash([]);

  context.fillStyle = color;
  context.globalAlpha = 0.9;
  context.font = '800 12px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.strokeStyle = 'rgba(23,33,29,0.72)';
  context.lineWidth = 3;
  const label = valid ? '설치 가능' : '공간 부족';
  context.strokeText(label, position.x, top - 12);
  context.fillText(label, position.x, top - 12);
  context.restore();
}

function avatarSprite(avatarId: number) {
  const safeId = Math.max(0, Math.min(3, Math.round(avatarId)));
  return {
    col: safeId % 2,
    row: Math.floor(safeId / 2),
    size: SPRITES.player.size
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
  context.fillText(alive ? label : `${label} 쓰러짐`, x, top + 10);

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
  while (result.length > 1 && context.measureText(result + '...').width > maxWidth) {
    result = result.slice(0, -1);
  }
  return result + '...';
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
  context.globalAlpha = (1 - age) * (type === 'kill' ? 0.72 : 0.5);
  context.strokeStyle = type === 'kill' ? 'rgba(255,128,111,0.78)' : 'rgba(255,240,163,0.72)';
  context.lineWidth = type === 'kill' ? 5 : 3;
  context.lineCap = 'round';
  for (let i = 0; i < 5; i += 1) {
    const angle = i * 1.256 + age * 0.35;
    const inner = size * (0.08 + age * 0.06);
    const outer = size * (0.28 + age * 0.16);
    context.beginPath();
    context.moveTo(position.x + Math.cos(angle) * inner, position.y + Math.sin(angle) * inner * 0.65);
    context.lineTo(position.x + Math.cos(angle) * outer, position.y + Math.sin(angle) * outer * 0.65);
    context.stroke();
  }
  context.restore();
}

function drawPlayerHitFlash(context: CanvasRenderingContext2D, position: Vec2, age: number) {
  context.save();
  context.globalAlpha = (1 - age) * 0.78;
  context.strokeStyle = 'rgba(255, 87, 78, 0.88)';
  context.fillStyle = 'rgba(255, 87, 78, 0.16)';
  context.lineWidth = 4;
  context.lineCap = 'round';
  context.beginPath();
  context.arc(position.x, position.y + 2, 30 + age * 14, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  for (let i = 0; i < 4; i += 1) {
    const angle = i * Math.PI * 0.5 + age * 0.6;
    const inner = 18 + age * 6;
    const outer = 34 + age * 18;
    context.beginPath();
    context.moveTo(position.x + Math.cos(angle) * inner, position.y + Math.sin(angle) * inner * 0.72);
    context.lineTo(position.x + Math.cos(angle) * outer, position.y + Math.sin(angle) * outer * 0.72);
    context.stroke();
  }
  context.restore();
}

function sampleMotion(id: string, position: Vec2, now: number): MotionSample {
  const previous = motionSamples.get(id);
  if (!previous) {
    const sample = { position: { ...position }, direction: { x: 1, y: 0 }, lastMovedAt: now };
    motionSamples.set(id, sample);
    return sample;
  }
  const dx = position.x - previous.position.x;
  const dy = position.y - previous.position.y;
  const distance = Math.hypot(dx, dy);
  if (distance > 0.35) {
    previous.direction = { x: dx / distance, y: dy / distance };
    previous.lastMovedAt = now;
    previous.position = { ...position };
  }
  return previous;
}

function smoothRenderPosition(id: string, target: Vec2, amount: number): Vec2 {
  const previous = renderPositions.get(id);
  if (!previous) {
    const initial = { ...target };
    renderPositions.set(id, initial);
    return initial;
  }
  const dx = target.x - previous.x;
  const dy = target.y - previous.y;
  if (Math.hypot(dx, dy) > 240) {
    previous.x = target.x;
    previous.y = target.y;
    return previous;
  }
  previous.x += dx * amount;
  previous.y += dy * amount;
  return previous;
}

function walkFrame(now: number, frameMs: number, lastMovedAt: number) {
  if (now - lastMovedAt > MOVEMENT_HOLD_MS) return 0;
  return Math.floor(now / frameMs) % WALK_FRAME_COUNT;
}

function framePulse(frame: number) {
  return frame === 1 || frame === 3 ? 1 : 0;
}

function spriteRotationFromDirection(direction: Vec2) {
  const length = Math.hypot(direction.x, direction.y);
  if (length < 0.05) return 0;
  return Math.atan2(direction.y / length, direction.x / length) - Math.PI / 2;
}

function drawAnimatedSprite(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  row: number,
  frame: number,
  position: Vec2,
  size: number,
  direction: Vec2,
  pulse: number
) {
  const frameWidth = image.naturalWidth / WALK_FRAME_COUNT;
  const frameHeight = image.naturalHeight / 4;
  const lean = Math.max(-0.09, Math.min(0.09, direction.x * 0.045 + (pulse ? direction.x * 0.035 : 0)));
  const lift = pulse ? -2 : 0;
  const rotation = spriteRotationFromDirection(direction) + lean;
  context.save();
  context.translate(position.x, position.y + lift);
  context.rotate(rotation);
  context.drawImage(
    image,
    frame * frameWidth,
    row * frameHeight,
    frameWidth,
    frameHeight,
    -size / 2,
    -size / 2,
    size,
    size
  );
  context.restore();
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

function drawMotionAtlasSprite(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  col: number,
  row: number,
  columns: number,
  rows: number,
  position: Vec2,
  size: number,
  direction: Vec2,
  pulse: number
) {
  const frameWidth = image.naturalWidth / columns;
  const frameHeight = image.naturalHeight / rows;
  const lean = Math.max(-0.08, Math.min(0.08, direction.x * 0.045 + (pulse ? direction.x * 0.025 : 0)));
  const lift = pulse ? -2 : 0;
  const rotation = spriteRotationFromDirection(direction) + lean;
  context.save();
  context.translate(position.x, position.y + lift);
  context.rotate(rotation);
  context.drawImage(
    image,
    col * frameWidth,
    row * frameHeight,
    frameWidth,
    frameHeight,
    -size / 2,
    -size / 2,
    size,
    size
  );
  context.restore();
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

function drawOfficeFloor(context: CanvasRenderingContext2D, map: GameSnapshot['map'], propAtlas: HTMLImageElement | null) {
  const { width, height, theme } = map;
  context.fillStyle = theme === 'killArena' ? '#e4e0d6' : theme === 'serviceLoop' ? '#d7e3e4' : '#dfe7e3';
  context.fillRect(0, 0, width, height);

  if (theme === 'serviceLoop') {
    drawServiceLoopFloor(context, width, height, propAtlas);
    return;
  }
  if (theme === 'killArena') {
    drawKillArenaFloor(context, width, height, propAtlas);
    return;
  }

  context.fillStyle = 'rgba(255,255,255,0.16)';
  for (let x = 24; x < width; x += 160) {
    for (let y = 24; y < height; y += 160) {
      const offset = ((x * 17 + y * 31) % 23) - 11;
      context.fillRect(x + offset * 0.4, y - offset * 0.25, 68, 54);
    }
  }

  context.strokeStyle = 'rgba(32,50,48,0.12)';
  context.lineWidth = 1;
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

  context.strokeStyle = 'rgba(255,255,255,0.18)';
  for (let x = 40; x < width; x += 80) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 40; y < height; y += 80) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  for (let i = 0; i < 34; i += 1) {
    const x = (i * 337) % width;
    const y = (i * 191) % height;
    const radius = 18 + (i % 5) * 7;
    context.fillStyle = i % 3 === 0 ? 'rgba(44,58,55,0.045)' : 'rgba(255,255,255,0.11)';
    context.beginPath();
    context.ellipse(x, y, radius * 1.35, radius * 0.48, (i % 7) * 0.31, 0, Math.PI * 2);
    context.fill();
  }

  context.strokeStyle = 'rgba(34,59,57,0.22)';
  context.lineWidth = 4;
  context.strokeRect(32, 32, width - 64, height - 64);
  context.lineWidth = 1;
  if (propAtlas) {
    for (const decor of DECOR_SPRITES) {
      drawAtlasSprite(context, propAtlas, decor.col, decor.row, 4, 4, decor.position, decor.size);
    }
  }
}

function drawServiceLoopFloor(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  propAtlas: HTMLImageElement | null
) {
  context.fillStyle = '#d7e3e4';
  context.fillRect(0, 0, width, height);
  context.fillStyle = 'rgba(23,59,63,0.08)';
  context.fillRect(120, 112, width - 240, height - 224);
  context.fillStyle = 'rgba(247,251,250,0.58)';
  context.fillRect(260, 250, width - 520, height - 500);
  context.strokeStyle = 'rgba(15,139,141,0.38)';
  context.lineWidth = 6;
  context.setLineDash([36, 26]);
  context.strokeRect(170, 162, width - 340, height - 324);
  context.setLineDash([]);
  context.lineWidth = 1;
  context.strokeStyle = 'rgba(23,59,63,0.16)';
  for (let x = 80; x < width; x += 140) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 80; y < height; y += 140) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  context.fillStyle = 'rgba(255,244,163,0.34)';
  context.fillRect(70, height / 2 - 52, 180, 104);
  context.fillRect(width - 250, height / 2 - 52, 180, 104);
  context.strokeStyle = 'rgba(23,59,63,0.24)';
  context.lineWidth = 4;
  context.strokeRect(32, 32, width - 64, height - 64);
  if (propAtlas) {
    const decor = [
      { col: 2, row: 2, position: { x: width / 2, y: 150 }, size: 130 },
      { col: 3, row: 2, position: { x: width / 2, y: height - 150 }, size: 130 },
      { col: 0, row: 3, position: { x: 155, y: height / 2 }, size: 112 },
      { col: 2, row: 3, position: { x: width - 155, y: height / 2 }, size: 112 }
    ] as const;
    for (const item of decor) drawAtlasSprite(context, propAtlas, item.col, item.row, 4, 4, item.position, item.size);
  }
}

function drawKillArenaFloor(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  propAtlas: HTMLImageElement | null
) {
  context.fillStyle = '#e4e0d6';
  context.fillRect(0, 0, width, height);
  const center = { x: width / 2, y: height / 2 };
  const arenaGradient = context.createRadialGradient(center.x, center.y, 80, center.x, center.y, 470);
  arenaGradient.addColorStop(0, 'rgba(255,244,163,0.34)');
  arenaGradient.addColorStop(0.58, 'rgba(198,63,63,0.12)');
  arenaGradient.addColorStop(1, 'rgba(23,59,63,0.05)');
  context.fillStyle = arenaGradient;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = 'rgba(198,63,63,0.32)';
  context.lineWidth = 8;
  context.beginPath();
  context.ellipse(center.x, center.y, 310, 230, 0, 0, Math.PI * 2);
  context.stroke();
  context.lineWidth = 3;
  context.strokeStyle = 'rgba(23,59,63,0.22)';
  for (const gate of [
    { x: center.x, y: 52, w: 210, h: 72 },
    { x: width - 52, y: center.y, w: 72, h: 210 },
    { x: center.x, y: height - 52, w: 210, h: 72 },
    { x: 52, y: center.y, w: 72, h: 210 }
  ]) {
    context.fillStyle = 'rgba(198,63,63,0.16)';
    context.fillRect(gate.x - gate.w / 2, gate.y - gate.h / 2, gate.w, gate.h);
    context.strokeRect(gate.x - gate.w / 2, gate.y - gate.h / 2, gate.w, gate.h);
  }
  context.strokeStyle = 'rgba(255,255,255,0.28)';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(center.x, 88);
  context.lineTo(center.x, height - 88);
  context.moveTo(88, center.y);
  context.lineTo(width - 88, center.y);
  context.stroke();
  context.strokeStyle = 'rgba(34,59,57,0.24)';
  context.lineWidth = 4;
  context.strokeRect(32, 32, width - 64, height - 64);
  if (propAtlas) {
    const decor = [
      { col: 1, row: 2, position: { x: center.x - 230, y: center.y - 180 }, size: 108 },
      { col: 1, row: 2, position: { x: center.x + 230, y: center.y + 180 }, size: 108 },
      { col: 3, row: 3, position: { x: center.x - 250, y: center.y + 180 }, size: 86 },
      { col: 3, row: 3, position: { x: center.x + 250, y: center.y - 180 }, size: 86 }
    ] as const;
    for (const item of decor) drawAtlasSprite(context, propAtlas, item.col, item.row, 4, 4, item.position, item.size);
  }
}

function Root() {
  const params = new URLSearchParams(window.location.search);
  return params.get('concept') === '1' ? <ConceptArtBoard /> : <LobbyApp />;
}

const rootElement = document.getElementById('root')!;
const rootStore = window as typeof window & { __zombieOfficeRoot?: ReturnType<typeof createRoot> };
rootStore.__zombieOfficeRoot ??= createRoot(rootElement);
rootStore.__zombieOfficeRoot.render(<Root />);

