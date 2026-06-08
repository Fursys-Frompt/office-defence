# Zombie Office Survival

FURSYS Group의 공간 설계 철학을 모티브로 한 실시간 멀티플레이 웹 생존 게임 MVP입니다.

## 1. 전체 시스템 아키텍처 설계
- React + TypeScript 클라이언트가 Canvas 렌더링과 입력 수집을 담당합니다.
- Express + Socket.IO 서버가 룸, 플레이어, 좀비, 자원, 시설, 점수를 메모리에서 관리합니다.
- 서버는 20Hz 권위 게임 루프를 돌리고 클라이언트는 `snapshot`을 받아 화면을 갱신합니다.

## 2. 폴더 구조 설계
```text
client/src/main.tsx      React UI, Canvas, 입력
client/src/styles.css    반응형 UI 스타일
server/src/index.ts      Express, Socket.IO, 게임 루프
shared/src/types.ts      공유 타입과 이벤트 계약
docs/sdd                 11개 SDD 문서
```

## 3. 게임 상태(State) 정의
- `lobby`, `countdown`, `playing`, `ended`
- `GameSnapshot`에 플레이어, 좀비, 자원, 시설, 투사체, 벽, 웨이브, 남은 시간이 포함됩니다.

## 4. Socket.IO 이벤트 정의
- Client -> Server: `joinRoom`, `setReady`, `updateSettings`, `input`, `leaveRoom`
- Server -> Client: `joined`, `snapshot`, `errorMessage`

## 5. 데이터 모델 정의
- `Player`, `Zombie`, `ResourceNode`, `Facility`, `Projectile`, `Wall`, `RoomSettings`
- 상세 타입은 `shared/src/types.ts`에 있습니다.

## 6. 서버 구현
- `server/src/index.ts`
- 룸 생성/입장, Ready, 방장 설정, 카운트다운, 게임 루프, 좀비 AI, 충돌, 점수, 결과 처리 구현

## 7. 클라이언트 구현
- `client/src/main.tsx`
- 로비, 게임, 결과 화면 구현
- Socket.IO 연결 및 입력 송신 구현
- Space는 상황별 자동 공격입니다. 가까운 적은 근접 공격, 멀리 있는 적은 자동 조준 원거리 공격으로 처리합니다.

## 8. Canvas 렌더링 구조
- 서버 스냅샷 기준으로 바닥, 벽, 자원, 시설, 투사체, 좀비, 플레이어를 그립니다.
- 카메라는 내 플레이어 위치를 중심으로 이동합니다.
- 플레이어와 좀비는 `client/src/assets/office-survival-sprites.png` 스프라이트 시트를 사용합니다.

## 9. 모바일 조작 구조
- 좌측 터치: 가상 조이스틱 이동
- 우측 터치: 공격 유지
- 하단 버튼: 시설 선택, 설치, 근접 공격

## 10. Render 배포 방법
- `render.yaml` 포함
- Build Command: `npm ci && npm run build`
- Start Command: `npm start`
- Node.js 20 이상

## 11. 개발 일정표
- 1주차: 룸/Ready/게임 루프/기본 Canvas
- 2주차: 좀비/공격/점수/결과
- 3주차: 자원/시설/모바일 조작/밸런싱
- 4주차: QA/Render 배포/멀티 접속 테스트

## 12. MVP 이후 확장 계획
- 계정 및 시즌 랭킹
- 맵 프리셋과 맵 에디터
- 직무별 캐릭터 역할
- 시설 업그레이드와 협동 보너스
- 관전 모드와 리플레이

## 실행
```bash
npm install
npm run dev
```

## 검증
```bash
npm run typecheck
npm run build
```

## Loop Polish Update
- Server balance now uses a smoother zombie wave curve, slightly faster resource flow, stronger facility HP, and clearer solo/multiplayer spawn scaling.
- Combat feel now includes higher ranged/melee impact values with shorter cooldowns.
- `GameSnapshot.feedbackEvents` carries short-lived hit, kill, collect, build, heal, and player-down events.
- Canvas renders floating score text, hit rings, build feedback, collect feedback, and heal feedback from server-authoritative events.
- Mobile right-side touch attack now uses auto-aim like Space attack.

## Feel Polish Update
- Added lightweight Web Audio cues for shooting, melee, hit, kill, collect, build, heal, and player-down feedback.
- Added a `requestAnimationFrame` canvas render loop so short feedback animations play smoothly between network snapshots.
- Added zombie hit shake, hit flash, kill burst rings, and small sparkle feedback while keeping server-authoritative state unchanged.

## Lobby Avatar Update
- Added four selectable survivor avatars before room entry.
- `JoinRoomPayload.avatarId` is saved on the server and included in snapshots as `Player.avatarId`.
- The game renderer draws each player with their selected avatar while keeping player-specific nameplate/ring colors for readability.

## Item Build UX Update
- Added `Player.inventory` with per-resource counts for chair parts, desk parts, partition material, power modules, and med kits.
- Facility building now consumes typed resource costs instead of a single total resource counter.
- The HUD shows each resource type, and the build bar shows each facility name plus required resources.
- Build actions are disabled when the selected facility cannot be afforded.
- Canvas now previews the selected facility placement with green/red validity feedback and support-facility range rings.

## Tactical UI Pass
- Resource counts are now icon chips with stronger visual weight and filled/empty states.
- Facility preview is now an explicit build mode that can be toggled off with Cancel or Escape.
- Player avatars are smaller in-game to better match item and zombie scale.
- Lobby avatar selection now includes a large customization preview.
- Projectile trails are brighter and longer for readable ranged attack paths.
- Melee attacks now create a local swing arc even when they do not hit a target.
