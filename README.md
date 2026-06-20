# Office Defence: Zombie Office Survival

FURSYS 오피스 공간을 배경으로 한 실시간 멀티플레이 생존 액션 MVP입니다. 여러 플레이어가 같은 방에 접속해 제한 시간 생존, 무제한 생존, 좀비 처치 목표, 물자 지키기 모드 중 하나를 플레이하며 개인 점수와 생존 기록을 경쟁합니다.

이 프로젝트는 협동 미션 게임이 아니라 개인 생존 경쟁을 중심에 둡니다. 아바타는 능력 차이를 만들지 않는 취향 선택 요소이며, 성장과 승패는 플레이 중 수집, 제작, 장비 운용, 전투 판단으로 결정됩니다.

## 현재 구현

- React + TypeScript + Canvas 기반 클라이언트
- Express + Socket.IO 기반 실시간 서버
- 서버 권위 20Hz 게임 루프와 `snapshot` 동기화
- 방 목록 조회, 방 생성, 방 코드 입장, 초대 링크 딥링크
- 최대 2-8인 방 설정, 난이도 `easy | normal | hard`
- 게임 모드 4종: 제한시간 생존, 무제한 생존, 좀비 처치 목표, 물자 지키기
- Ready 후 카운트다운, 호스트 설정 변경, 일시정지, 종료 후 재시작
- 키보드/마우스 및 모바일 터치 조이스틱 조작
- 자동 조준, 자원 수집, 믹스커피 회복, 안전지대 설치/수리
- 제작 스테이션 기반 무기/보조장비 제작 및 5레벨 강화
- 레벨업 선택지, 콤보, 주야간 사이클, 웨이브 전투/휴식 흐름
- 일반/러너/탱커 좀비, 스폰 경고, 벽/시설 충돌 및 일부 벽 파괴
- 결과 랭킹, 공유 텍스트/이미지 생성, 외부 공유 링크
- 튜토리얼과 게임 설명 모달
- `/api/health`, `/api/rooms` 운영 확인 API
- `?concept=1` 콘셉트 아트 보드 진입

## 기술 구성

```text
client/src/main.tsx              React UI, Canvas 렌더링, 입력, 공유, 튜토리얼
client/src/styles.css            반응형 UI와 HUD 스타일
client/src/ConceptArtBoard.tsx   콘셉트 아트 보드
client/src/assets                스프라이트, 아이콘, 배경음
server/src/index.ts              Express, Socket.IO, 게임 루프와 룸 상태
shared/src/types.ts              클라이언트/서버 공용 타입과 이벤트 계약
shared/src/gameRules.ts          자원, 제작 비용, 시설, 배치 규칙
docs/sdd                         SDD 문서
docs/improvement-roadmap.md      개선 방향 로드맵
```

## 실행

요구 사항: Node.js 20 이상

```bash
npm install
npm run dev
```

개발 서버는 기본적으로 클라이언트 `5173`, API/Socket 서버 `3000` 포트를 사용합니다.

## 검증

```bash
npm run typecheck
npm run build
```

프로덕션 실행:

```bash
npm run build
npm start
```

서버 상태 확인:

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/rooms
```

## 문서

- [프로젝트 개요](docs/sdd/01_프로젝트개요서.md)
- [요구사항 정의](docs/sdd/03_요구사항정의서.md)
- [업무 규칙 정의](docs/sdd/05_업무규칙정의서.md)
- [인터페이스 정의](docs/sdd/08_인터페이스정의서.md)
- [운영 매뉴얼](docs/sdd/11_운영매뉴얼.md)
- [상용화 전환 계획](docs/sdd/13_상용화전환계획.md)
- [개선 방향 로드맵](docs/improvement-roadmap.md)

## 알려진 주의 사항

- 일부 기존 한글 라벨 문서와 `shared/src/gameRules.ts`의 표시 문자열에 인코딩 깨짐이 남아 있습니다. 사용자 화면 품질을 위해 우선 복구가 필요합니다.
- 현재 룸/플레이어 상태는 메모리 기반입니다. 서버 재시작 시 방과 진행 상태는 사라집니다.
- PVP 설정 필드는 존재하지만 현재 핵심 전투 흐름은 좀비 생존 중심입니다.
