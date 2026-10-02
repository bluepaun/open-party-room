import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { lyarGames, players, rooms } from "../db/schema";
import { getWordPool } from "./words";
import { getRoomDTO } from "../rooms";
import {
  TURN_SECONDS,
  type GameDTO,
  type RoomDTO,
  type TallyRow,
  type YouRoleDTO,
} from "../types";

const TURN_MS = TURN_SECONDS * 1000;

/* ── 조회 ── */

function getGameRow(code: string) {
  return db.select().from(lyarGames).where(eq(lyarGames.roomId, code)).get() ?? null;
}

export function buildTally(g: NonNullable<ReturnType<typeof getGameRow>>): TallyRow[] {
  const counts: Record<string, number> = {};
  for (const target of Object.values(g.votes)) counts[target] = (counts[target] ?? 0) + 1;
  const rows = db
    .select()
    .from(players)
    .where(eq(players.roomId, g.roomId))
    .orderBy(asc(players.joinedAt), asc(players.id))
    .all();
  return rows
    .map((p) => ({ playerId: p.id, name: p.name, count: counts[p.id] ?? 0 }))
    .sort((a, b) => b.count - a.count || a.playerId.localeCompare(b.playerId));
}

export function getGameDTO(code: string): GameDTO | null {
  const g = getGameRow(code);
  if (!g) return null;
  const total = g.order.length;
  const votedCount = Object.keys(g.votes).length;
  const allVoted = votedCount === total;
  const isResult = g.phase === "result";
  const showTally = allVoted || isResult;
  return {
    phase: g.phase as GameDTO["phase"],
    startedAt: g.startedAt,
    word: isResult ? g.word : null,
    guess: isResult ? g.guess : null,
    liarPlayerId: g.liarPlayerId,
    order: g.order,
    explainIndex: g.explainIndex,
    currentTurnPlayerId:
      g.phase === "explain" ? g.order[g.explainIndex] ?? null : null,
    turnEndedAt: g.phase === "explain" ? g.turnEndedAt : null,
    confirmedCount: g.confirmed.length,
    votedCount,
    accusedPlayerId: allVoted ? g.accusedPlayerId : null,
    tallyReady: g.phase === "vote" && allVoted,
    tally: showTally ? buildTally(g) : null,
    result: g.result as GameDTO["result"],
    resultReason: g.resultReason ?? "",
  };
}

export function buildRole(code: string, playerId: string): YouRoleDTO | null {
  const g = getGameRow(code);
  if (!g) return null;
  const isLiar = g.liarPlayerId === playerId;
  return { isLiar, word: isLiar ? null : g.word };
}

function nameOf(code: string, playerId: string): string {
  return (
    db.select().from(players).where(eq(players.id, playerId)).get()?.name ?? "?"
  );
}

function norm(s: string): string {
  return s.trim().replace(/\s+/g, "").toLowerCase();
}

function pickWord(pool: string[], used: string[]): string {
  const usedNorm = new Set(used.map(norm));
  const fresh = pool.filter((w) => !usedNorm.has(norm(w)));
  const from = fresh.length > 0 ? fresh : pool;
  return from[Math.floor(Math.random() * from.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ── 시작 ── */

export interface StartResult {
  ok: true;
  room: RoomDTO;
  game: GameDTO;
  roles: Record<string, YouRoleDTO>;
}
export interface StartError {
  ok: false;
  error: string;
}

export function startGame(code: string): StartResult | StartError {
  const room = db.select().from(rooms).where(eq(rooms.code, code)).get();
  if (!room) return { ok: false, error: "방을 찾을 수 없어요." };
  const playerRows = db
    .select()
    .from(players)
    .where(eq(players.roomId, code))
    .orderBy(asc(players.joinedAt), asc(players.id))
    .all();
  if (playerRows.length < 3) return { ok: false, error: "3명 이상이어야 시작할 수 있어요." };
  if (playerRows.length > 8) return { ok: false, error: "최대 8명까지예요." };

  const prev = getGameRow(code);
  const pool = getWordPool(room.wordGroupId); // null = 전체 랜덤
  if (pool.length === 0) return { ok: false, error: "제시어가 없어요. 관리자에게 문의하세요." };
  const word = pickWord(pool, prev?.usedWords ?? []);
  const ids = playerRows.map((p) => p.id);
  const liarId = ids[Math.floor(Math.random() * ids.length)];

  db.delete(lyarGames).where(eq(lyarGames.roomId, code)).run();
  db.insert(lyarGames)
    .values({
      id: randomUUID(),
      roomId: code,
      word,
      liarPlayerId: liarId,
      order: shuffle(ids),
      phase: "reveal",
      explainIndex: 0,
      confirmed: [],
      votes: {},
      accusedPlayerId: null,
      guess: null,
      result: null,
      resultReason: null,
      usedWords: [...(prev?.usedWords ?? []), word],
      turnEndedAt: null,
      startedAt: Date.now(),
    })
    .run();
  db.update(rooms).set({ status: "game" }).where(eq(rooms.code, code)).run();

  const roles: Record<string, YouRoleDTO> = {};
  for (const p of playerRows) {
    const isLiar = p.id === liarId;
    roles[p.id] = { isLiar, word: isLiar ? null : word };
  }

  return {
    ok: true,
    room: getRoomDTO(code)!,
    game: getGameDTO(code)!,
    roles,
  };
}

/** 결과 후 새 라운드 (호스트). 현재 방의 플레이어 그대로 다시 시작. */
export function startNewRound(code: string): StartResult | StartError {
  const g = getGameRow(code);
  if (!g || g.phase !== "result") return { ok: false, error: "결과 단계에서만 새 게임을 시작할 수 있어요." };
  return startGame(code);
}

/* ── reveal 확인 ── */

export function confirmReveal(code: string, playerId: string): GameDTO | null {
  const g = getGameRow(code);
  if (!g || g.phase !== "reveal") return null;
  if (!g.confirmed.includes(playerId)) {
    const confirmed = [...g.confirmed, playerId];
    const everyone = confirmed.length >= g.order.length;
    db.update(lyarGames)
      .set(
        everyone
          ? { confirmed, phase: "explain", turnEndedAt: Date.now() + TURN_MS }
          : { confirmed },
      )
      .where(eq(lyarGames.id, g.id))
      .run();
  }
  return getGameDTO(code);
}

/* ── explain 진행 ── */

/**
 * 현재 설명 턴을 다음으로 넘김.
 * explainIndex/phase 가드가 있어 sweep·클라이언트 이중 트리도 멱등.
 * opts.requireExpired: 타임아웃 sweep용 — 만료되지 않으면 아무 일도 안 함.
 */
export function advanceExplain(
  code: string,
  opts: { requireExpired?: boolean } = {},
): GameDTO | null {
  const g = getGameRow(code);
  if (!g || g.phase !== "explain") return null;
  if (opts.requireExpired && (!g.turnEndedAt || g.turnEndedAt >= Date.now())) {
    return null;
  }

  const last = g.explainIndex + 1 >= g.order.length;
  const patch = last
    ? { phase: "vote", turnEndedAt: null }
    : { explainIndex: g.explainIndex + 1, turnEndedAt: Date.now() + TURN_MS };

  const res = db
    .update(lyarGames)
    .set(patch)
    .where(
      and(
        eq(lyarGames.id, g.id),
        eq(lyarGames.phase, "explain"),
        eq(lyarGames.explainIndex, g.explainIndex),
      ),
    )
    .run();
  if (res.changes === 0) return null;
  return getGameDTO(code);
}

/** 턴 만료 sweep: explain 단계 + turnEndedAt 지난 게임만. */
export function sweepExpiredTurns(): string[] {
  const now = Date.now();
  const all = db.select().from(lyarGames).where(eq(lyarGames.phase, "explain")).all();
  const expired = all.filter((g) => g.turnEndedAt !== null && g.turnEndedAt < now);
  const changed: string[] = [];
  for (const g of expired) {
    const dto = advanceExplain(g.roomId, { requireExpired: true });
    if (dto) changed.push(g.roomId);
  }
  return changed;
}

/* ── 투표 ── */

export function castVote(
  code: string,
  playerId: string,
  targetId: string,
): GameDTO | null {
  const g = getGameRow(code);
  if (!g || g.phase !== "vote") return null;
  if (targetId === playerId) return null;
  if (!g.order.includes(targetId)) return null;
  if (Object.keys(g.votes).length >= g.order.length) return getGameDTO(code);

  const votes = { ...g.votes, [playerId]: targetId };
  const allVoted = Object.keys(votes).length === g.order.length;

  let accusedPlayerId = g.accusedPlayerId;
  if (allVoted) {
    const counts: Record<string, number> = {};
    for (const t of Object.values(votes)) counts[t] = (counts[t] ?? 0) + 1;
    const max = Math.max(...Object.values(counts));
    const tops = Object.keys(counts).filter((k) => counts[k] === max);
    accusedPlayerId = tops.length === 1 ? tops[0] : null;
  }

  db.update(lyarGames)
    .set(allVoted ? { votes, accusedPlayerId } : { votes })
    .where(eq(lyarGames.id, g.id))
    .run();
  return getGameDTO(code);
}

/**
 * tally 화면 후 '결과 보기'.
 * 동률 → 라이어 승리(무사脱출). 라이어 지목 → guess. 아니면 시민 승리.
 */
export function advanceAfterTally(code: string): GameDTO | null {
  const g = getGameRow(code);
  if (!g || g.phase !== "vote") return null;
  if (Object.keys(g.votes).length < g.order.length) return null;

  if (g.accusedPlayerId === null) {
    return finish(code, "lyar", "투표가 동률로 끝났어요. 아무도 지목되지 않았으니 라이어가 무사히 빠져나갔어요.");
  }
  if (g.accusedPlayerId === g.liarPlayerId) {
    db.update(lyarGames).set({ phase: "guess" }).where(eq(lyarGames.id, g.id)).run();
    return getGameDTO(code);
  }
  // 규칙 5: 투표가 라이어를 빠지면 라이어 승리 (무사 탈출)
  return finish(
    code,
    "lyar",
    `${nameOf(code, g.accusedPlayerId)}님이 투표에서 지목됐어요. 하지만 그분은 라이어가 아니에요. 라이어가 무사히 빠져나갔어요!`,
  );
}

/* ── guess ── */

export function submitGuess(
  code: string,
  playerId: string,
  guess: string,
): GameDTO | null {
  const g = getGameRow(code);
  if (!g || g.phase !== "guess") return null;
  if (playerId !== g.liarPlayerId) return null;
  const value = guess.trim();
  if (!value) return null;

  if (norm(value) === norm(g.word)) {
    return finish(
      code,
      "lyar",
      `라이어 ${nameOf(code, g.liarPlayerId)}님이 제시어 “${g.word}”을(를) 맞혔어요. 붙잡혔지만 이겼어요.`,
      value,
    );
  }
  return finish(
    code,
    "citizen",
    `라이어는 제시어 “${g.word}”을(를) 맞히지 못했어요. (추측: “${value}”)`,
    value,
  );
}

/* ── 종료 ── */

function finish(
  code: string,
  result: "lyar" | "citizen",
  reason: string,
  guess?: string,
): GameDTO {
  const g = getGameRow(code);
  if (!g) throw new Error("game not found");
  db.update(lyarGames)
    .set({
      phase: "result",
      result,
      resultReason: reason,
      ...(guess ? { guess } : {}),
    })
    .where(eq(lyarGames.id, g.id))
    .run();
  return getGameDTO(code)!;
}

/** 게임(라운드) 초기화 → 대기실. */
export function resetToLobby(code: string): RoomDTO | null {
  const room = db.select().from(rooms).where(eq(rooms.code, code)).get();
  if (!room) return null;
  db.delete(lyarGames).where(eq(lyarGames.roomId, code)).run();
  db.update(rooms).set({ status: "lobby" }).where(eq(rooms.code, code)).run();
  return getRoomDTO(code);
}
