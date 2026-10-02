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

export const games = sqliteTable("games", {
  id: text("id").primaryKey(),
  roomId: text("room_id")
    .notNull()
    .references(() => rooms.code, { onDelete: "cascade" }),
  word: text("word").notNull(),
  wordId: integer("word_id").notNull(),
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
  /** 이번 방에서 쓴 제시어 wordId (재사용 방지) */
  usedWords: text("used_words", { mode: "json" })
    .notNull()
    .default("[]")
    .$type<number[]>(),
  /** 현재 설명 턴의 만료 시각 (ms epoch) — explain phase에서만 사용 */
  turnEndedAt: integer("turn_ended_at"),
  startedAt: integer("started_at").notNull(),
});

export type RoomRow = typeof rooms.$inferSelect;
export type PlayerRow = typeof players.$inferSelect;
export type GameRow = typeof games.$inferSelect;
