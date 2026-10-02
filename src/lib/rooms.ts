import { randomUUID } from "node:crypto";
import { eq, asc } from "drizzle-orm";
import { db } from "./db";
import { players, rooms, lyarGames } from "./db/schema";
import type { PlayerDTO, RoomDTO } from "./types";

/** 코드의 가독성을 위해 I·L·O·0·1 제거 */
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateRoomCode(): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = "";
    for (let i = 0; i < 4; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    const [existing] = db.select({ code: rooms.code }).from(rooms).where(eq(rooms.code, code)).all();
    if (!existing) return code;
  }
  // 사실상 불가능한 충돌 회피용
  return randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, "K");
}

export function listPlayers(code: string): PlayerDTO[] {
  const rows = db
    .select()
    .from(players)
    .where(eq(players.roomId, code))
    .orderBy(asc(players.joinedAt), asc(players.id))
    .all();
  const host = db.select({ hostPlayerId: rooms.hostPlayerId }).from(rooms).where(eq(rooms.code, code)).get();
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    host: p.id === host?.hostPlayerId,
    joinedAt: p.joinedAt,
  }));
}

export function getRoomDTO(code: string): RoomDTO | null {
  const room = db.select().from(rooms).where(eq(rooms.code, code)).get();
  if (!room) return null;
  return {
    code: room.code,
    name: room.name,
    status: room.status as RoomDTO["status"],
    hostId: room.hostPlayerId,
    wordGroupId: room.wordGroupId ?? null,
    players: listPlayers(code),
  };
}

export function countPlayers(code: string): number {
  return db.select().from(players).where(eq(players.roomId, code)).all().length;
}

/**
 * 플레이어 제거. 게임 진행 중(결과 아님)이면 이번 판을 초기화한다.
 * (원본 HTML과 동일: 게임 중 이탈 = 이번 판 초기화)
 */
export function removePlayer(code: string, playerId: string): RoomDTO | null {
  const room = db.select().from(rooms).where(eq(rooms.code, code)).get();
  if (!room) return null;

  const game = db.select().from(lyarGames).where(eq(lyarGames.roomId, code)).get();
  const gameActive = room.status === "game" && game && game.phase !== "result";

  db.delete(players).where(eq(players.id, playerId)).run();

  if (gameActive) {
    db.delete(lyarGames).where(eq(lyarGames.roomId, code)).run();
    db.update(rooms).set({ status: "lobby" }).where(eq(rooms.code, code)).run();
  }

  const remaining = db
    .select()
    .from(players)
    .where(eq(players.roomId, code))
    .orderBy(asc(players.joinedAt))
    .all();

  if (remaining.length === 0) {
    db.delete(rooms).where(eq(rooms.code, code)).run();
    return null;
  }

  // 호스트가 나갔으면 가장 먼저 들어온 플레이어가 호스트
  if (room.hostPlayerId === playerId || !remaining.some((p) => p.id === room.hostPlayerId)) {
    db.update(rooms)
      .set({ hostPlayerId: remaining[0].id })
      .where(eq(rooms.code, code))
      .run();
  }

  return getRoomDTO(code);
}
