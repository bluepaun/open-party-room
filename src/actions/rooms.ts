"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { players, rooms, wordGroups } from "@/lib/db/schema";
import {
  countPlayers,
  generateRoomCode,
  getRoomDTO,
  removePlayer,
} from "@/lib/rooms";
import { getGameDTO } from "@/lib/game/lyar";
import { emitRoomClosed, emitRoomState } from "@/lib/broadcast";
import { MAX_PLAYERS } from "@/lib/types";

const COOKIE = "partyroom.me";
type CookieData = Record<string, { id: string; name: string }>;

export interface RoomActionState {
  error?: string;
}

async function readCookieData(): Promise<CookieData> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (!raw) return {};
  try {
    const d = JSON.parse(raw);
    return d && typeof d === "object" && !Array.isArray(d) ? (d as CookieData) : {};
  } catch {
    return {};
  }
}

async function setIdentity(code: string, id: string, name: string) {
  const data = await readCookieData();
  data[code] = { id, name };
  const store = await cookies();
  store.set(COOKIE, JSON.stringify(data), {
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
    sameSite: "lax",
  });
}

async function clearIdentity(code: string) {
  const data = await readCookieData();
  delete data[code];
  const store = await cookies();
  store.set(COOKIE, JSON.stringify(data), {
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
    sameSite: "lax",
  });
}

/** 방 만들기 → /room/[code] 리다이렉트 */
export async function createRoom(
  _prev: RoomActionState,
  formData: FormData,
): Promise<RoomActionState> {
  const hostName = String(formData.get("hostName") ?? "").trim();
  if (!hostName) return { error: "이름을 입력해 주세요." };
  if (hostName.length > 12) return { error: "이름은 12자 이하로 입력해 주세요." };
  const name = String(formData.get("name") ?? "").trim() || "파티룸";
  if (name.length > 20) return { error: "방 이름은 20자 이하로 입력해 주세요." };

  const code = generateRoomCode();
  const playerId = randomUUID();
  const now = Date.now();
  const game = String(formData.get("game") ?? "lyar") === "cmy" ? "cmy" : ("lyar" as const);

  db.insert(rooms)
    .values({
      code,
      name,
      game,
      hostPlayerId: playerId,
      status: "lobby",
      createdAt: now,
    })
    .run();
  db.insert(players).values({ id: playerId, roomId: code, name: hostName, joinedAt: now }).run();
  await setIdentity(code, playerId, hostName);

  const room = getRoomDTO(code);
  if (room) emitRoomState(code, room);
  redirect(`/room/${code}`);
}

/** 코드로 참가 → /room/[code] 리다이렉트 */
export async function joinRoom(
  _prev: RoomActionState,
  formData: FormData,
): Promise<RoomActionState> {
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim();
  if (!/^[A-Z0-9]{4}$/.test(code)) {
    return { error: "방 코드는 4자리(영문 대문자·숫자)예요." };
  }
  if (!name) return { error: "이름을 입력해 주세요." };
  if (name.length > 12) return { error: "이름은 12자 이하로 입력해 주세요." };

  const roomRow = db.select().from(rooms).where(eq(rooms.code, code)).get();
  if (!roomRow) return { error: "방을 찾을 수 없어요. 코드를 확인해 주세요." };

  if (roomRow.status === "game") {
    const game = getGameDTO(code);
    if (game && game.phase !== "result") {
      return { error: "게임이 진행 중이라 지금은 참가할 수 없어요." };
    }
  }

  if (countPlayers(code) >= MAX_PLAYERS) {
    return { error: "이 방은 8명까지 참여할 수 있어요." };
  }

  const existing = db.select().from(players).where(eq(players.roomId, code)).all();
  if (existing.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    return { error: "이미 같은 이름의 플레이어가 있어요. 다른 이름으로 참가해 주세요." };
  }

  const playerId = randomUUID();
  db.insert(players).values({ id: playerId, roomId: code, name, joinedAt: Date.now() }).run();
  await setIdentity(code, playerId, name);

  const room = getRoomDTO(code);
  if (room) emitRoomState(code, room);
  redirect(`/room/${code}`);
}

/** 방 나가기 (대기실·결과 포함) → 홈. 게임 중이면 이번 판 초기화. */
export async function leaveRoom(code: string, playerId: string) {
  const room = removePlayer(code, playerId);
  await clearIdentity(code);
  if (room) emitRoomState(code, room);
  else emitRoomClosed(code);
  redirect("/");
}

/** 호스트만. 제시어 그룹 설정 (null = 전체 랜덤). */
export async function setWordGroup(
  code: string,
  playerId: string,
  groupId: number | null,
): Promise<{ ok: boolean; error?: string }> {
  const room = db.select().from(rooms).where(eq(rooms.code, code)).get();
  if (!room) return { ok: false, error: "방을 찾을 수 없어요." };
  if (room.hostPlayerId !== playerId) {
    return { ok: false, error: "호스트만 설정할 수 있어요." };
  }
  if (groupId !== null) {
    const grp = db.select().from(wordGroups).where(eq(wordGroups.id, groupId)).get();
    if (!grp) return { ok: false, error: "존재하지 않는 그룹이에요." };
  }
  db.update(rooms).set({ wordGroupId: groupId }).where(eq(rooms.code, code)).run();
  const roomDTO = getRoomDTO(code);
  if (roomDTO) emitRoomState(code, roomDTO);
  return { ok: true };
}

export interface CmySettingsPatch {
  cmyMode?: "forehead" | "hand";
  cmyWordSource?: "random" | "master";
  cmyMasterPlayerId?: string | null;
  cmyTimer?: "on" | "off";
  wordGroupId?: number | null;
}

/** 호스트만. 방 설정 (단어 그룹 + 양세찬 게임 모드/제시어/출제자/타이머). */
export async function setGameSettings(
  code: string,
  playerId: string,
  patch: CmySettingsPatch,
): Promise<{ ok: boolean; error?: string }> {
  const room = db.select().from(rooms).where(eq(rooms.code, code)).get();
  if (!room) return { ok: false, error: "방을 찾을 수 없어요." };
  if (room.hostPlayerId !== playerId) {
    return { ok: false, error: "호스트만 설정할 수 있어요." };
  }

  const set: {
    wordGroupId?: number | null;
    cmyMode?: string;
    cmyWordSource?: string;
    cmyMasterPlayerId?: string | null;
    cmyTimer?: string;
  } = {};

  if (patch.wordGroupId !== undefined) {
    if (patch.wordGroupId !== null) {
      const grp = db.select().from(wordGroups).where(eq(wordGroups.id, patch.wordGroupId)).get();
      if (!grp) return { ok: false, error: "존재하지 않는 그룹이에요." };
    }
    set.wordGroupId = patch.wordGroupId;
  }
  if (patch.cmyMode !== undefined) {
    if (patch.cmyMode !== "forehead" && patch.cmyMode !== "hand") {
      return { ok: false, error: "잘못된 모드예요." };
    }
    set.cmyMode = patch.cmyMode;
  }
  if (patch.cmyWordSource !== undefined) {
    if (patch.cmyWordSource !== "random" && patch.cmyWordSource !== "master") {
      return { ok: false, error: "잘못된 설정이에요." };
    }
    set.cmyWordSource = patch.cmyWordSource;
    // 랜덤으로 전환하면 출제자 지정 해제
    if (patch.cmyWordSource === "random") set.cmyMasterPlayerId = null;
  }
  if (patch.cmyMasterPlayerId !== undefined) {
    if (patch.cmyMasterPlayerId === null) {
      set.cmyMasterPlayerId = null;
    } else {
      const p = db.select().from(players).where(eq(players.id, patch.cmyMasterPlayerId)).get();
      if (!p || p.roomId !== code) return { ok: false, error: "이 방의 플레이어를 선택해 주세요." };
      set.cmyMasterPlayerId = patch.cmyMasterPlayerId;
    }
  }
  if (patch.cmyTimer !== undefined) {
    if (patch.cmyTimer !== "on" && patch.cmyTimer !== "off") {
      return { ok: false, error: "잘못된 설정이에요." };
    }
    set.cmyTimer = patch.cmyTimer;
  }

  db.update(rooms).set(set).where(eq(rooms.code, code)).run();
  const roomDTO = getRoomDTO(code);
  if (roomDTO) emitRoomState(code, roomDTO);
  return { ok: true };
}

/** 호스트만. 방 전체를 정리 → 홈. */
export async function closeRoom(code: string, playerId: string) {
  const room = db.select().from(rooms).where(eq(rooms.code, code)).get();
  if (room && room.hostPlayerId === playerId) {
    db.delete(rooms).where(eq(rooms.code, code)).run(); // cascade → players, games
    await clearIdentity(code);
    emitRoomClosed(code);
  }
  redirect("/");
}
