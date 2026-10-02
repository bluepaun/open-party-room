/**
 * 서버(socket/actions)와 클라이언트가 공유하는 상태 타입.
 * src/lib/ 하위에 두어 양쪽 그래프에서 동일하게 import.
 */

export type RoomStatus = "lobby" | "game";
export type GamePhase = "reveal" | "explain" | "vote" | "guess" | "result";
export type GameResult = "lyar" | "citizen";

export interface PlayerDTO {
  id: string;
  name: string;
  host: boolean;
  joinedAt: number;
}

export interface RoomDTO {
  code: string;
  name: string;
  status: RoomStatus;
  hostId: string | null;
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
  youRole: "you:role",
  /** 투표한 플레이어에게만: 나의 선택 */
  myVote: "my:vote",
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
} as const;

export const TURN_SECONDS = 60;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
