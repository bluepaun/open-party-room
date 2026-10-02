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
export type WordGroupRow = typeof wordGroups.$inferSelect;
export type WordRow = typeof words.$inferSelect;
