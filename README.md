# Zombie Office Survival

FURSYS Group의 스마트 오피스 공간 철학을 모티브로 한 개인 생존 액션 MVP입니다.

이 프로젝트의 핵심은 협동이 아니라, 같은 사무실 공간에서 각 플레이어가 각자 생존하고 점수를 겨루는 짧은 세션형 액션 경험입니다. 캐릭터 선택은 능력이나 역할군을 나누기 위한 장치가 아니라, 플레이어 취향을 만족시키는 아바타 선택 장치입니다.

## 1. 제품 방향

- 장르: 실시간 웹 기반 개인 생존 액션, 점수 경쟁
- 핵심 재미: 이동, 자동 공격, 자원 수집, 장비 성장, 시설 설치, 콤보, 웨이브 압박
- 제외 방향: 협동 플레이를 핵심 가치로 삼지 않는다.
- 캐릭터 방향: 역할군/직업/능력 차이를 두지 않고 외형 취향만 제공한다.

## 2. 시스템 구조

- React + TypeScript 클라이언트가 UI, Canvas 렌더링, 입력 수집을 담당합니다.
- Express + Socket.IO 서버가 룸, 플레이어, 좀비, 자원, 시설, 점수를 메모리에서 관리합니다.
- 서버는 20Hz 권위 게임 루프를 돌리고 클라이언트는 `snapshot`을 받아 화면을 갱신합니다.

## 3. 주요 파일

```text
client/src/main.tsx      React UI, Canvas, 입력
client/src/styles.css    반응형 UI 스타일
client/src/assets        캐릭터, 좀비, 아이템 스프라이트
server/src/index.ts      Express, Socket.IO, 게임 루프
shared/src/types.ts      공유 타입과 이벤트 계약
shared/src/gameRules.ts  자원/시설/장비 규칙
docs/sdd                 SDD 문서
```

## 4. 게임 흐름

1. 닉네임과 취향 아바타 선택
2. 방 생성 또는 방 코드 입장
3. Ready 후 카운트다운
4. 각 플레이어가 독립적으로 생존, 수집, 전투, 점수 경쟁
5. 제한 시간 종료 또는 전원 사망 시 결과 랭킹 표시

## 5. 캐릭터/아바타 원칙

- 아바타는 플레이어 성향과 취향 표현을 위한 장치다.
- 아바타별 능력, 직업, 역할, 팀 기여 효과를 부여하지 않는다.
- 선택 화면에서 매력과 수집욕을 주되, 게임 규칙상 우열은 없어야 한다.

## 6. 실행

```bash
npm install
npm run dev
```

## 7. 검증

```bash
npm run typecheck
npm run build
```
