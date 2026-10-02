import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  /** 4자 방 코드 (예: AB2C) — 공개 식별자 */
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  /** 게임 종류 (현재: 'lyar') */
  game: text("game").notNull().default("lyar"),
  hostPlayerId: text("host_player_id"),
  /** 'lobby' = 대기실, 'game' = 게임 진행 중 (결과는 phase가 판단) */
  status: text("status").notNull().default("lobby"),
  /** 제시어 그룹 id — null = 전체 랜덤 */
  wordGroupId: integer("word_group_id"),
  /** 'cmy' 방 설정: 이마/손 모드 (렌더링 전용) */
  cmyMode: text("cmy_mode").default("forehead"),
  /** 'cmy' 방 설정: 'random' | 'master' */
  cmyWordSource: text("cmy_word_source").default("random"),
  /** 'cmy' 방 설정: 출제자 플레이어 id (master 모드, 이 판 참여 불가) */
  cmyMasterPlayerId: text("cmy_master_player_id"),
  /** 'cmy' 방 설정: 'on' | 'off' */
  cmyTimer: text("cmy_timer").default("off"),
  createdAt: integer("created_at").notNull(),
});

export const players = sqliteTable(
  "players",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.code, { onDelete: "cascade" }),
    name: text("name").notNull(),
    joinedAt: integer("joined_at").notNull(),
  },
  (t) => [
    uniqueIndex("players_room_name_unique").on(t.roomId, t.name),
  ],
);

/**
 * 라이어 게임 전용 테이블 — 게임 종류가 여러 개 생기면
 * 게임마다 각자 테이블을 만든다.
 */
export const lyarGames = sqliteTable("lyar_games", {
  id: text("id").primaryKey(),
  roomId: text("room_id")
    .notNull()
    .references(() => rooms.code, { onDelete: "cascade" }),
  word: text("word").notNull(),
  liarPlayerId: text("liar_player_id").notNull(),
  /** 설명 순서 (플레이어 id 배열) */
  order: text("order", { mode: "json" }).notNull().$type<string[]>(),
  /** reveal | explain | vote | guess | result */
  phase: text("phase").notNull().default("reveal"),
  explainIndex: integer("explain_index").notNull().default(0),
  /** 역할을 확인한 플레이어 id 배열 */
  confirmed: text("confirmed", { mode: "json" })
    .notNull()
    .default("[]")
    .$type<string[]>(),
  /** voterId -> targetId */
  votes: text("votes", { mode: "json" })
    .notNull()
    .default("{}")
    .$type<Record<string, string>>(),
  /** 투표 마감 후 지목된 플레이어 (동률이면 null) */
  accusedPlayerId: text("accused_player_id"),
  guess: text("guess"),
  /** 'lyar' | 'citizen' */
  result: text("result"),
  resultReason: text("result_reason"),
  /** 이번 방에서 쓴 제시어 (재사용 방지) */
  usedWords: text("used_words", { mode: "json" })
    .notNull()
    .default("[]")
    .$type<string[]>(),
  /** 현재 설명 턴의 만료 시각 (ms epoch) — explain phase에서만 사용 */
  turnEndedAt: integer("turn_ended_at"),
  startedAt: integer("started_at").notNull(),
});

/**
 * 양세찬 게임(콜 마이 네임) 전용 테이블.
 * 규칙: 내 단어만 숨겨지고 다른 모든 플레이어의 단어를 본인이 봄.
 * 턴 순서로 예/아니오 질문 → 다른 전원 답변 → 언제든 정답 추측.
 */
export const cmyGames = sqliteTable(
  "cmy_games",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.code, { onDelete: "cascade" }),
    /** 'forehead' | 'hand' — 정보 구조 동일, 단어 표시 위치만 다름 */
    mode: text("mode").notNull().default("forehead"),
    /** 'random' | 'master' */
    wordSource: text("word_source").notNull().default("random"),
    /** 출제자 (master 모드, 이 판 비참가) */
    masterPlayerId: text("master_player_id"),
    /** setup | play | result */
    phase: text("phase").notNull().default("play"),
    /** playerId -> 제시어 (setup phase에는 비어 있음) */
    words: text("words", { mode: "json" })
      .notNull()
      .default("{}")
      .$type<Record<string, string>>(),
    /** 질문 순서 (플레이어 id 배열, shuffled) */
    order: text("order", { mode: "json" }).notNull().$type<string[]>(),
    turnIndex: integer("turn_index").notNull().default(0),
    /** 현재 Q&A — null이면 질문 대기(턴 플레이어의 질문 입력 단계) */
    question: text("question", { mode: "json" }).$type<{
      text: string;
      askedBy: string;
      /** playerId -> 답변 */
      answers: Record<string, "yes" | "no" | "skip">;
    } | null>(),
    /** 현재 스텝 만료 시각 (타이머 ON일 때만) — 질문 60초 / 답변 30초 */
    stepDeadline: integer("step_deadline"),
    /** 라운드 만료 시각 (타이머 ON일 때만) — 3분 */
    roundDeadline: integer("round_deadline"),
    /** playerId -> { atMs, rank } (해결 순서) */
    solved: text("solved", { mode: "json" })
      .notNull()
      .default("{}")
      .$type<Record<string, { atMs: number; rank: number }>>(),
    /** 이번 방에서 쓴 제시어 (랜덤 재사용 방지) */
    usedWords: text("used_words", { mode: "json" })
      .notNull()
      .default("[]")
      .$type<string[]>(),
    startedAt: integer("started_at").notNull(),
  },
  (t) => [uniqueIndex("cmy_games_room_unique").on(t.roomId)],
);

/* ── 제시어 (그룹별) ── */

export const wordGroups = sqliteTable("word_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  sort: integer("sort").notNull().default(0),
});

export const words = sqliteTable(
  "words",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    groupId: integer("group_id")
      .notNull()
      .references(() => wordGroups.id, { onDelete: "cascade" }),
    word: text("word").notNull(),
  },
  (t) => [uniqueIndex("words_word_unique").on(t.word)],
);

export type RoomRow = typeof rooms.$inferSelect;
export type PlayerRow = typeof players.$inferSelect;
export type LiarGameRow = typeof lyarGames.$inferSelect;
export type CmyGameRow = typeof cmyGames.$inferSelect;
export type WordGroupRow = typeof wordGroups.$inferSelect;
export type WordRow = typeof words.$inferSelect;
