/**
 * 서버(socket/actions)와 클라이언트가 공유하는 상태 타입.
 * src/lib/ 하위에 두어 양쪽 그래프에서 동일하게 import.
 */

export type RoomStatus = "lobby" | "game";
export type GameKind = "lyar" | "cmy";
export type GamePhase = "reveal" | "explain" | "vote" | "guess" | "result";
export type GameResult = "lyar" | "citizen";

/* ── 양세찬 게임(콜 마이 네임) ── */
export type CmyMode = "forehead" | "hand";
export type CmyWordSource = "random" | "master";
export type CmyPhase = "setup" | "play" | "result";

export interface CmyPlayerView {
  id: string;
  name: string;
  host: boolean;
  /** result phase부터 */
  solved: boolean;
  rank: number | null;
  /** result phase부터: 그 플레이어의 단어 */
  word: string | null;
}

export interface CmyRankingRow {
  playerId: string;
  name: string;
  word: string;
  solved: boolean;
  /** 해결 순서 — 미해결(꼴등)은 null */
  rank: number | null;
}

export interface CmyGameDTO {
  phase: CmyPhase;
  mode: CmyMode;
  wordSource: CmyWordSource;
  timerOn: boolean;
  startedAt: number;
  /** 타이머 ON일 때만 */
  roundDeadline: number | null;
  masterPlayerId: string | null;
  /** 현재 턴 플레이어 (hand 모드 전용, play) */
  turnPlayerId: string | null;
  /** hand 모드: 턴 마감 (타이머 ON) */
  stepDeadline: number | null;
  players: CmyPlayerView[];
  solvedCount: number;
  totalCount: number;
  /** result phase: 등수 (미해결은 마지막) */
  ranking: CmyRankingRow[] | null;
  /** setup phase: 출제자가 단어 입력할 대상 (참여자) */
  setupTargets: { playerId: string; name: string }[] | null;
}

/** 개인화: 내가 볼 수 있는 단어 (모드별) */
export interface CmyYouView {
  /** forehead: 내 단어 (전체화면 표시 — 다른 사람에게 보여줌) / hand: null */
  ownWord: string | null;
  /** hand: 타인 아바타 카드 트레이 / master: 전원 단어 (본인 제외, 출제자는 전원) */
  othersWords: Record<string, string>;
  isMaster: boolean;
}

/** 내 추정 결과 (성공/실패) — stamp: 클라이언트 토스트 리마운트용 */
export interface CmyMyGuess {
  ok: boolean;
  rank: number | null;
  stamp: number;
}

export interface PlayerDTO {
  id: string;
  name: string;
  host: boolean;
  joinedAt: number;
}

export interface RoomDTO {
  code: string;
  name: string;
  game: GameKind;
  status: RoomStatus;
  hostId: string | null;
  /** 제시어 그룹 id — null = 전체 랜덤 */
  wordGroupId: number | null;
  /** 'cmy' 방 설정 */
  cmyMode: CmyMode;
  cmyWordSource: CmyWordSource;
  cmyMasterPlayerId: string | null;
  cmyTimer: "on" | "off";
  players: PlayerDTO[];
}

export interface TallyRow {
  playerId: string;
  name: string;
  count: number;
}

export interface GameDTO {
  phase: GamePhase;
  /** 라운드 시작 시각 (새 라운드 구분용) */
  startedAt: number;
  /** result phase에서만 노출 */
  word: string | null;
  guess: string | null;
  liarPlayerId: string;
  order: string[];
  explainIndex: number;
  currentTurnPlayerId: string | null;
  /** ms epoch — explain phase의 현재 턴 만료 시각 */
  turnEndedAt: number | null;
  confirmedCount: number;
  votedCount: number;
  /** 투표 마감 후 지목된 플레이어 id (동률: null) */
  accusedPlayerId: string | null;
  /** 모든 투표가 들어와 결과가 나온 상태 (tally 화면) */
  tallyReady: boolean;
  tally: TallyRow[] | null;
  result: GameResult | null;
  resultReason: string;
}

/** 개별 플레이어에게만 보내는 역할 정보 */
export interface YouRoleDTO {
  isLiar: boolean;
  word: string | null;
}

/** 서버 → 클라이언트 이벤트 */
export const EV = {
  roomState: "room:state",
  gameState: "game:state",
  /** cmy: 게임 상태 (베이스, 단어 불포함) */
  cmyState: "cmy:state",
  youRole: "you:role",
  /** 투표한 플레이어에게만: 나의 선택 */
  myVote: "my:vote",
  /** cmy: 개인화 단어 뷰 (forehead: 내 단어 / hand: 타인 단어) */
  youCmyView: "you:cmy-view",
  /** cmy: 내 추정 결과 */
  myCmyGuess: "my:cmy-guess",
  roomClosed: "room:closed",
} as const;

/** 클라이언트 → 서버 이벤트 */
export const C2S = {
  start: "game:start",
  confirm: "game:confirm",
  explainDone: "game:explain-done",
  vote: "game:vote",
  next: "game:next",
  guess: "game:guess",
  newRound: "game:new-round",
  /** cmy: 정답 추정 (hand 모드, 턴 플레이어) */
  cmyGuess: "cmy:guess",
  /** cmy: 턴 넘기기 (hand 모드, 턴 플레이어) */
  cmyPass: "cmy:pass",
  /** cmy: 정답 확인 (forehead 모드 — 다른 사람이 맞히면 눌러줌) */
  cmyConfirm: "cmy:confirm",
  /** cmy: 출제자의 단어 제출 (setup) */
  cmyMasterSubmit: "cmy:master-submit",
} as const;

export const TURN_SECONDS = 60;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;

/* ── cmy 타이머 (타이머 ON 모드) ── */
export const CMY_MIN_PLAYERS = 2;
/** master 모드: 참가자 2 + 출제자 1 */
export const CMY_MIN_PLAYERS_MASTER = 3;
/** hand 모드: 턴 한계 */
export const CMY_TURN_SECONDS = 60;
/** forehead 모드: 카운트다운(전원 화면 공개 안내) 후 단어 공개 */
export const CMY_REVEAL_SECONDS = 10;
export const CMY_ROUND_SECONDS = 180;
