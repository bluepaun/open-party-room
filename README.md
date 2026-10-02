# 파티룸 (Party Room)

각자의 기기(모바일·PC)로 함께 즐기는 **멀티플레이 파티 게임 웹앱**.
원본 정적 HTML 프로토타입([../파티게임-웹사이트-제작](../파티게임-웹사이트-제작))을
실시간 multiplayer 아키텍처로 재구현했다.

현재 플레이 가능:
- **라이어 게임** — 1명이 랜덤으로 라이어가 되어 제시어를 모른 채 자연스럽게
  설명하고, 나머지는 투표로 잡아낸다.
- **양세찬 게임 (콜 마이 네임)** — 내 제시어는 숨겨지고 다른 플레이어의 제시어는
  보여, 예/아니오 질문으로 내 단어를 추리하는 게임. 이마/손 모드·랜덤/출제자
  제시어·타이머 ON/OFF를 방에서 선택.

## Tech Stack (모두 최신)

| 구분 | 사용 | 버전 |
|---|---|---|
| 프레임워크 | Next.js (App Router, Turbopack) | 16.3.8 |
| UI | React | 19.3.0 |
| 스타일 | Tailwind CSS v4 | 4.3.3 |
| 컴포넌트 | shadcn/ui (radix-nova 프리셋) | latest |
| 모션 | motion (ex-Framer Motion) | 13.5.0 |
| 실시간 통신 | Socket.IO (커스텀 서버) | 4.8.4 |
| DB | SQLite (better-sqlite3) | 13.0.3 |
| ORM | Drizzle ORM + drizzle-kit | 0.45.3 / 0.31.11 |
| 언어 | TypeScript | 7.0.2 (native, `tsc` 바이너리) / 6.0 API (lint 도구용, MS 공식 사이드바이사이드 방식) |

## 실행

```bash
npm install

# dev (커스텀 서버: Next + Socket.IO)
npm run dev            # http://localhost:3000

# production
npm run build
npm run start
```

- `DATABASE_PATH` 환경변수로 DB 파일 위치 변경 가능 (기본 `./data/partyroom.db`).
- 마이그레이션은 서버 시작 시 자동 적용 (`drizzle/` 저널).
- **LAN 플레이**: 서버가 `0.0.0.0`에 listen → 같은 네트워크의 기기에서
  `http://<이 기기의 IP>:3000` 으로 접속 후 코드로 참가.
- Vercel 등 serverless 플랫폼에서는 WebSocket 때문에 배포 불가 (커스텀 서버 필요).

## 스크립트

| 명령 | 설명 |
|---|---|
| `npm run dev` | dev 서버 (tsx server.ts) |
| `npm run build` | production 빌드 |
| `npm run start` | production 서버 |
| `npm run lint` | ESLint (eslint-config-next + TS6 API) |
| `npm run db:generate` | 스키마 변경 → 마이그레이션 SQL 생성 |
| `npm run db:studio` | Drizzle Studio (DB GUI) |
| `npx tsx scripts/e2e.ts` | 라이어 소켓 게임 엔진 E2E (dev 서버 실행 중) |
| `PORT=3030 npx tsx scripts/e2e_cmy.ts` | 양세찬 게임 소켓 E2E (2인 hand·3인 출제자·검증) |
| `python scripts/browser_e2e.py` | 라이어 3기기 브라우저 E2E (camoufox) |
| `python scripts/browser_e2e_cmy.py` | 양세찬 3기기 브라우저 E2E (이마 배지·질문·추정·결과) |
| `npx tsx scripts/probe.ts` 등 | 임시 스크립트 |

## 아키텍처

### 요청 처리 분업 (API Router 최소화)

| 동작 | 방식 |
|---|---|
| 방 만들기 / 코드로 참가 / 방 나가기 / 방 정리 | **Server Action** (`src/actions/rooms.ts`) → SQLite 직접 쓰기 + 쿠키(`partyroom.me` = `{code: {id, name}}` 아이덴티티) + `redirect` |
| 로비 실시간(참가·이탈) · 게임 전체 진행 | **WebSocket (Socket.IO)** — 커스텀 서버(`server.ts`)에서 Next와 같은 HTTP 서버로 공유 |

- 게임 내 모든 상태 전이는 서버 소액터티브(socket-authoritative). 클라이언트는
  화면 전환과 사용자 입력만 담당하고, 역할(라이어/제시어)은 **개별 소켓에 비공개**로 전송.
- 커스텀 서버와 Server Action은 모듈 그래프가 달라 `globalThis` 레지스트리
  (`src/lib/broadcast.ts`)로 Socket.IO 인스턴스를 공유. 상태는 전부 SQLite라
  인스턴스가 두 개여도 충돌 없음 (턴 진행은 조건부 UPDATE로 멱등).

### 게임 플로우 (양세찬 / 콜 마이 네임)

```
lobby →(host: game:start)→ [출제자 모드] setup(출제자가 각자 단어 지정, 본인 비참가)
                            [랜덤 모드]   단어 자동 추출(단어 그룹, 재사용 방지)
  → play: 턴 순서로 예/아니오 질문 1개 → 다른 전원이 사실대로 답변(공개)
          자기 턴에 질문 대신 "정답 외치기" (실패: 질문 기회 없이 턴 넘김)
          전원 해결 또는 라운드 만료(타이머 ON: 3분) → result
  → result: 해결 순서 등수 + 전원 단어 공개 + 꼴등 표시 → "한 판 더" | 대기실
```

- **모드**: 🔝 이마(타인 단어 = 상대 아바타 위 배지) / ✋ 손(타인 단어 = 내 손
  카드 트레이). 정보 구조는 동일(내 단어만 숨김, 타인 단어 전부 표시), 표시 위치만 다름.
- **제시어**: 랜덤(단어 그룹 선택) / 출제자 지정(1명, 이 판 비참가). 둘 다 로비에서
  호스트가 선택 — `setGameSettings` Server Action + `room:state`로 실시간 동기화.
- **타이머**: ON(라운드 3분·질문 60초·답변 30초, 서버 sweep) / OFF(제한 없음).
- 역할과 달리 단어는 **개인화 뷰**(`you:cmy-view`)로 전송: 참가자에게는 타인
  단어만, 출제자(심판)에게는 전 단어.

### 게임 플로우 (라이어)

```
lobby →(host: game:start)→ reveal(개별 역할 비공개, 모두 확인)
    → explain(순서대로 60초 턴, 서버 sweep 자동 진행)
    → vote(자기 제외 투표, 전원 종료 시 tally)
    → [동률] result(라이어 무사 → 라이어 승리)
    → [라이어 지목] guess(라이어만 제시어 추측)
    → result(맞히면 라이어 승리 / 아니면 시민 승리)
```

- 설명 턴 타임아웃: 서버가 `turnEndedAt`을 2.5초 sweep으로 검사 (클라이언트
  타이머는 표시용, 서버가 권위).
- 게임 중 이탈(닫힘·나가기) → 원본과 동일하게 **이번 판 초기화** 후 대기실 복귀.
- 결과 후 호스트 "한 판 더" → 같은 플레이어 구성으로 새 라운드 (제시어 재사용 방지).
- **제시어 그룹**: 호스트가 대기실에서 그룹을 선택하거나 "전체 랜덤"으로 두면
  그 그룹의 단어만(또는 전체 단어를) 풀로 사용. Server Action으로 저장하고
  `room:state`로 모든 기기에 실시간 동기화. 다음 판부터 적용.

### DB 스키마 (Drizzle, SQLite)

- `rooms` — code(4자, PK), name, game(lyar|cmy), hostPlayerId,
  status(lobby|game), wordGroupId(null = 전체 랜덤) + cmy 설정
  (cmyMode, cmyWordSource, cmyMasterPlayerId, cmyTimer)
- `players` — id, roomId, name, joinedAt · unique(roomId, name)
- `lyar_games` — 라이어 게임 전용 라운드 상태 (word, liarPlayerId, order[],
  phase, explainIndex, confirmed[], votes{}, accusedPlayerId, guess, result,
  usedWords[], turnEndedAt)
- `cmy_games` — 양세찬 게임 전용 라운드 상태 (mode, wordSource,
  masterPlayerId, phase(setup|play|result), words{}, order[], turnIndex,
  question{}, stepDeadline, roundDeadline, solved{}, usedWords[])
  — 게임 종류가 추가되면 게임별 테이블로 확장
- `word_groups` — id, name, sort · 제시어 그룹 (시드: 10그룹 × 30+ 단어 = 332개)
- `words` — id, groupId, word · unique(word)

### 폴더 구조

```
server.ts                  # 커스텀 서버 (Next + Socket.IO)
drizzle/                   # 마이그레이션
src/
  actions/rooms.ts         # Server Actions (방 라이프사이클)
  app/
    page.tsx               # 게임 목록
    rooms/create/          # 방 만들기
    join/                  # 코드로 참가
    room/[code]/           # 대기실 + 게임 (클라이언트 하위 트리)
  components/
    room/                  # RoomProvider(소켓 상태) / 로비 / 게임 화면
    ui/                    # shadcn/ui
  lib/
    db/                    # schema + better-sqlite3/drizzle 싱글톤 + 자동 마이그레이션
    game/lyar.ts           # 라이어 게임 로직 (순수함수 + DB 쓰기)
    game/cmy.ts            # 양세찬 게임 로직 (질문/답변/추정/sweep/개인화 뷰)
    rooms.ts               # 방/플레이어 헬퍼
    socket/index.ts        # Socket.IO 핸들러 (인증·이벤트·sweep·disconnect grace)
    broadcast.ts           # globalThis Socket.IO 레지스트리
    types.ts               # 공유 DTO/이벤트 이름
scripts/e2e.ts             # 게임 엔진 E2E (socket.io-client 3명 시뮬레이션)
```

## 원본 대비 개선 (멀티플레이화)

- localStorage 기반 가짜 동시접속 → **실제 Socket.IO 멀티클라이언트**.
- "당신은 누구예요?" 동정 확인 화면 제거 — 참가 시점에 플레이어 식별이 확정되어
  (이름 중복 불가 + 쿠키 아이덴티티) 불필요.
- 새로고침·재접속 시 소켓 인증으로 자동 재동기화 (역할도 재수신), 중복 탭은 evict.
- 설명 턴 타임아웃이 클라이언트마다 각자 돌던 것에서 **서버 권위** sweep으로 이동.
- 게임 상태 SQLite 영속화 (서버 재시작 시 방/라운드 복원 가능).

## 알려진 한계

- 인증/회원제 없음 (이름 기반, 원본과 동일).
- 8명 초과·대규모 동시 방 처리는 미고려 (파티 규모 기준).
- 투표·설명 등 게임 중 참가 불가 (라운드 구성 보호).
- 양세찬 게임의 예/아니오 답변은 서버에서 의미 검증을 하지 못함 (진실성·질문
  형식은 플레이어 책임 — 원조 게임과 동일).
