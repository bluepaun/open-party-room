import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { cmyGames, players, rooms } from "../db/schema";
import { getRoomDTO } from "../rooms";
import { getWordPool } from "./words";
import {
  CMY_ANSWER_SECONDS,
  CMY_ASK_SECONDS,
  CMY_MIN_PLAYERS,
  CMY_MIN_PLAYERS_MASTER,
  CMY_ROUND_SECONDS,
  MAX_PLAYERS,
  type CmyAnswer,
  type CmyGameDTO,
  type CmyMyGuess,
  type CmyRankingRow,
  type CmyYouView,
  type RoomDTO,
} from "../types";

const ASK_MS = CMY_ASK_SECONDS * 1000;
const ANSWER_MS = CMY_ANSWER_SECONDS * 1000;
const ROUND_MS = CMY_ROUND_SECONDS * 1000;

type CmyRow = NonNullable<ReturnType<typeof getGameRow>>;

/* ── 유틸 ── */

function getGameRow(code: string) {
  return db.select().from(cmyGames).where(eq(cmyGames.roomId, code)).get() ?? null;
}

function norm(s: string): string {
  return s.trim().replace(/\s+/g, "").toLowerCase();
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function timerOn(g: CmyRow): boolean {
  const room = db.select().from(rooms).where(eq(rooms.code, g.roomId)).get();
  return (room?.cmyTimer ?? "on") === "on";
}

/** 풀에서 usedWords 제외하고 n개 고유 추출 (풀 부족 시 재사용 허용) */
function drawWords(pool: string[], n: number, used: string[]): string[] {
  const usedNorm = new Set(used.map(norm));
  let fresh = pool.filter((w) => !usedNorm.has(norm(w)));
  if (fresh.length < n) fresh = pool;
  const src = shuffle(fresh);
  const picked: string[] = [];
  while (picked.length < n && src.length > 0) {
    const w = src.pop()!;
    if (!picked.some((x) => norm(x) === norm(w))) picked.push(w);
  }
  return picked;
}

/* ── DTO ── */

function participantRows(code: string, order: string[]) {
  const room = db.select().from(rooms).where(eq(rooms.code, code)).get();
  const rows = db
    .select()
    .from(players)
    .where(eq(players.roomId, code))
    .orderBy(asc(players.joinedAt), asc(players.id))
    .all();
  const set = new Set(order);
  return rows.filter((p) => set.has(p.id)).map((p) => ({
    ...p,
    host: p.id === room?.hostPlayerId,
  }));
}

export function getCmyGameDTO(code: string): CmyGameDTO | null {
  const g = getGameRow(code);
  if (!g) return null;
  const isResult = g.phase === "result";
  const ps = participantRows(code, g.order);
  const solvedCount = Object.keys(g.solved).length;

  const totalAnswerers = g.question ? g.order.length - 1 : 0;
  const answeredCount = g.question
    ? g.order.filter((pid) => pid !== g.question!.askedBy && g.question!.answers[pid]).length
    : 0;

  return {
    phase: g.phase as CmyGameDTO["phase"],
    mode: g.mode as CmyGameDTO["mode"],
    wordSource: g.wordSource as CmyGameDTO["wordSource"],
    timerOn: timerOn(g),
    startedAt: g.startedAt,
    roundDeadline: g.phase === "play" ? g.roundDeadline : null,
    masterPlayerId: g.masterPlayerId,
    turnPlayerId: g.phase === "play" ? (g.order[g.turnIndex] ?? null) : null,
    turnStep: g.phase === "play" ? (g.question ? "answers" : "ask") : null,
    stepDeadline: g.phase === "play" ? g.stepDeadline : null,
    question:
      g.phase === "play" && g.question
        ? {
            text: g.question.text,
            askedBy: g.question.askedBy,
            answers: g.question.answers,
            answered: answeredCount,
            total: totalAnswerers,
          }
        : null,
    players: ps.map((p) => ({
      id: p.id,
      name: p.name,
      host: p.host,
      solved: !!g.solved[p.id],
      rank: g.solved[p.id]?.rank ?? null,
      word: isResult ? (g.words[p.id] ?? null) : null,
    })),
    solvedCount,
    totalCount: g.order.length,
    ranking: isResult ? buildRanking(code, g) : null,
    setupTargets:
      g.phase === "setup"
        ? ps.map((p) => ({ playerId: p.id, name: p.name }))
        : null,
  };
}

function buildRanking(code: string, g: CmyRow): CmyRankingRow[] {
  const ps = participantRows(code, g.order);
  return ps
    .map((p) => {
      const s = g.solved[p.id];
      return {
        playerId: p.id,
        name: p.name,
        word: g.words[p.id] ?? "",
        solved: !!s,
        rank: s?.rank ?? null,
      };
    })
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));
}

/** 개인화: 내가 볼 수 있는 타인 단어 (본인 제외). setup에는 없음. */
export function buildCmyYouView(code: string, playerId: string): CmyYouView | null {
  const g = getGameRow(code);
  if (!g || g.phase === "setup") return null;
  const isMaster = playerId === g.masterPlayerId;
  const others: Record<string, string> = {};
  for (const pid of g.order) {
    if (!isMaster && pid === playerId) continue;
    const w = g.words[pid];
    if (w) others[pid] = w;
  }
  return { othersWords: others, isMaster };
}

/* ── 시작 ── */

export interface CmyStartResult {
  ok: true;
  room: RoomDTO;
  game: CmyGameDTO;
}
export interface CmyStartError {
  ok: false;
  error: string;
}

export function startCmyGame(code: string): CmyStartResult | CmyStartError {
  const room = db.select().from(rooms).where(eq(rooms.code, code)).get();
  if (!room) return { ok: false, error: "방을 찾을 수 없어요." };
  if (room.game !== "cmy") return { ok: false, error: "이 방은 양세찬 게임 방이 아니에요." };

  const playerRows = db
    .select()
    .from(players)
    .where(eq(players.roomId, code))
    .orderBy(asc(players.joinedAt), asc(players.id))
    .all();
  if (playerRows.length > MAX_PLAYERS) return { ok: false, error: "최대 8명까지예요." };

  const mode = (room.cmyMode ?? "forehead") as "forehead" | "hand";
  const wordSource = (room.cmyWordSource ?? "random") as "random" | "master";
  const masterId = room.cmyMasterPlayerId ?? null;
  const tOn = (room.cmyTimer ?? "on") === "on";

  let participantRows: typeof playerRows;
  if (wordSource === "master") {
    if (!masterId || !playerRows.some((p) => p.id === masterId)) {
      return { ok: false, error: "출제자를 지정해 주세요." };
    }
    if (playerRows.length < CMY_MIN_PLAYERS_MASTER) {
      return { ok: false, error: "출제자 지정 모드는 3명 이상이어야 해요." };
    }
    participantRows = playerRows.filter((p) => p.id !== masterId);
  } else {
    if (playerRows.length < CMY_MIN_PLAYERS) {
      return { ok: false, error: "2명 이상이어야 시작할 수 있어요." };
    }
    participantRows = playerRows;
  }

  const prev = getGameRow(code);
  const words: Record<string, string> = {};
  const phase: "setup" | "play" = wordSource === "master" ? "setup" : "play";
  const now = Date.now();

  if (wordSource === "random") {
    const pool = getWordPool(room.wordGroupId);
    if (pool.length === 0) return { ok: false, error: "제시어가 없어요." };
    const drawn = drawWords(pool, participantRows.length, prev?.usedWords ?? []);
    for (const [i, p] of participantRows.entries()) {
      const w = drawn[i];
      if (!w) return { ok: false, error: "제시어가 부족해요." };
      words[p.id] = w;
    }
  }

  db.delete(cmyGames).where(eq(cmyGames.roomId, code)).run();
  db.insert(cmyGames)
    .values({
      id: randomUUID(),
      roomId: code,
      mode,
      wordSource,
      masterPlayerId: wordSource === "master" ? masterId : null,
      phase,
      words,
      order: shuffle(participantRows.map((p) => p.id)),
      turnIndex: 0,
      question: null,
      stepDeadline: phase === "play" && tOn ? now + ASK_MS : null,
      roundDeadline: phase === "play" && tOn ? now + ROUND_MS : null,
      solved: {},
      usedWords: [
        ...(prev?.usedWords ?? []),
        ...(wordSource === "random" ? Object.values(words) : []),
      ],
      startedAt: now,
    })
    .run();
  db.update(rooms).set({ status: "game" }).where(eq(rooms.code, code)).run();

  return {
    ok: true,
    room: getRoomDTO(code)!,
    game: getCmyGameDTO(code)!,
  };
}

/** 결과 후 새 라운드 (호스트) — master 모드면 다시 setup. */
export function startCmyNewRound(code: string): CmyStartResult | CmyStartError {
  const g = getGameRow(code);
  if (!g || g.phase !== "result") {
    return { ok: false, error: "결과 단계에서만 새 게임을 시작할 수 있어요." };
  }
  return startCmyGame(code);
}

/* ── setup: 출제자 단어 제출 ── */

export function masterSubmitWords(
  code: string,
  playerId: string,
  words: Record<string, string>,
): CmyGameDTO | { ok: false; error: string } {
  const g = getGameRow(code);
  if (!g || g.phase !== "setup") return { ok: false, error: "출제 단계가 아니에요." };
  if (playerId !== g.masterPlayerId) return { ok: false, error: "출제자만 제출할 수 있어요." };

  const missing = g.order.filter((pid) => !words[pid]?.trim());
  if (missing.length > 0) {
    return { ok: false, error: "모든 플레이어에게 단어를 입력해 주세요." };
  }
  const normSeen = new Set<string>();
  for (const pid of g.order) {
    const w = words[pid].trim();
    if (w.length > 20) return { ok: false, error: "단어는 20자 이하로 입력해 주세요." };
    if (normSeen.has(norm(w))) return { ok: false, error: "같은 단어를 둘 이상 쓸 수 없어요." };
    normSeen.add(norm(w));
  }

  const tOn = (db.select().from(rooms).where(eq(rooms.code, code)).get()?.cmyTimer ?? "on") === "on";
  const now = Date.now();
  db.update(cmyGames)
    .set({
      words: Object.fromEntries(g.order.map((pid) => [pid, words[pid].trim()])),
      phase: "play",
      stepDeadline: tOn ? now + ASK_MS : null,
      roundDeadline: tOn ? now + ROUND_MS : null,
    })
    .where(eq(cmyGames.id, g.id))
    .run();
  return getCmyGameDTO(code) ?? { ok: false, error: "상태를 불러올 수 없어요." };
}

/* ── play: 질문 ── */

export function askCmyQuestion(
  code: string,
  playerId: string,
  text: string,
): CmyGameDTO | null {
  const g = getGameRow(code);
  if (!g || g.phase !== "play") return null;
  if (g.order[g.turnIndex] !== playerId) return null;
  if (g.question !== null) return null;
  if (g.solved[playerId]) return null;
  const value = text.trim();
  if (!value || value.length > 100) return null;

  const tOn = timerOn(g);
  db.update(cmyGames)
    .set({
      question: { text: value, askedBy: playerId, answers: {} },
      stepDeadline: tOn ? Date.now() + ANSWER_MS : null,
    })
    .where(
      and(
        eq(cmyGames.id, g.id),
        eq(cmyGames.phase, "play"),
        eq(cmyGames.turnIndex, g.turnIndex),
      ),
    )
    .run();
  return getCmyGameDTO(code);
}

/* ── play: 답변 ── */

export function answerCmyQuestion(
  code: string,
  playerId: string,
  answer: CmyAnswer,
): CmyGameDTO | null {
  const g = getGameRow(code);
  if (!g || g.phase !== "play" || !g.question) return null;
  if (playerId === g.question.askedBy) return null;
  if (!g.order.includes(playerId)) return null;
  if (answer !== "yes" && answer !== "no") return null;
  if (g.question.answers[playerId]) return null;

  const answers = { ...g.question.answers, [playerId]: answer };
  const allAnswered = g.order.every(
    (pid) => pid === g.question!.askedBy || answers[pid],
  );

  if (allAnswered) {
    // 전원 답변 완료 → 즉시 턴 이동 (질문자는 라이브로 봤음)
    return advanceTurn(code);
  }
  db.update(cmyGames)
    .set({ question: { ...g.question, answers } })
    .where(eq(cmyGames.id, g.id))
    .run();
  return getCmyGameDTO(code);
}

/* ── play: 턴 진행 (정답 맞힌 사람 스킵, 멱등) ── */

function advanceTurn(code: string, opts: { requireExpired?: boolean } = {}): CmyGameDTO | null {
  const g = getGameRow(code);
  if (!g || g.phase !== "play") return null;
  if (opts.requireExpired && (!g.stepDeadline || g.stepDeadline >= Date.now())) {
    return null;
  }

  const allSolved = Object.keys(g.solved).length >= g.order.length;
  let idx = (g.turnIndex + 1) % g.order.length;
  // 정답 맞힌 플레이어의 턴은 자동 패스
  while (!allSolved && g.solved[g.order[idx]]) {
    idx = (idx + 1) % g.order.length;
  }

  const res = db
    .update(cmyGames)
    .set({
      turnIndex: idx,
      question: null,
      stepDeadline: timerOn(g) ? Date.now() + ASK_MS : null,
    })
    .where(
      and(
        eq(cmyGames.id, g.id),
        eq(cmyGames.phase, "play"),
        eq(cmyGames.turnIndex, g.turnIndex),
      ),
    )
    .run();
  if (res.changes === 0) return null;
  return getCmyGameDTO(code);
}

/* ── play: 정답 추정 ── */

export function guessCmyWord(
  code: string,
  playerId: string,
  text: string,
): { game: CmyGameDTO | null; myGuess: CmyMyGuess | null } {
  const g = getGameRow(code);
  if (!g || g.phase !== "play") return { game: null, myGuess: null };
  if (!g.order.includes(playerId) || g.solved[playerId]) {
    return { game: getCmyGameDTO(code), myGuess: null };
  }
  const value = text.trim();
  if (!value || value.length > 30) return { game: getCmyGameDTO(code), myGuess: null };

  const myWord = g.words[playerId];
  const stamp = Date.now();
  if (myWord && norm(value) === norm(myWord)) {
    const rank = Object.keys(g.solved).length + 1;
    const solved = { ...g.solved, [playerId]: { atMs: stamp, rank } };
    const allSolved = Object.keys(solved).length >= g.order.length;

    db.update(cmyGames)
      .set(
        allSolved
          ? { solved, phase: "result", question: null, stepDeadline: null, roundDeadline: null }
          : { solved },
      )
      .where(eq(cmyGames.id, g.id))
      .run();

    if (!allSolved && g.order[g.turnIndex] === playerId) {
      advanceTurn(code); // 맞힌 사람의 턴은 패스
    }
    return { game: getCmyGameDTO(code), myGuess: { ok: true, rank, stamp } };
  }
  // 오답: 페널티 없음 — 토스트만
  return { game: getCmyGameDTO(code), myGuess: { ok: false, rank: null, stamp } };
}

/* ── 종료 ── */

export function finishCmyRound(code: string): CmyGameDTO | null {
  const g = getGameRow(code);
  if (!g || g.phase !== "play") return null;
  db.update(cmyGames)
    .set({ phase: "result", question: null, stepDeadline: null, roundDeadline: null })
    .where(and(eq(cmyGames.id, g.id), eq(cmyGames.phase, "play")))
    .run();
  return getCmyGameDTO(code);
}

/** 타이머 sweep: 질문/답변 타임아웃 + 라운드 만료. */
export function sweepCmy(): string[] {
  const now = Date.now();
  const all = db.select().from(cmyGames).where(eq(cmyGames.phase, "play")).all();
  const changed = new Set<string>();
  for (const g of all) {
    if (g.roundDeadline !== null && g.roundDeadline < now) {
      if (finishCmyRound(g.roomId)) changed.add(g.roomId);
      continue;
    }
    if (g.stepDeadline !== null && g.stepDeadline < now) {
      if (g.question === null) {
        // 질문 타임아웃 → 턴 패스
        if (advanceTurn(g.roomId, { requireExpired: true })) changed.add(g.roomId);
      } else {
        // 답변 타임아웃 → 남은 답변자 skip 처리 후 턴 진행
        const missing = g.order.filter(
          (pid) => pid !== g.question!.askedBy && !g.question!.answers[pid],
        );
        if (missing.length > 0) {
          const answers = { ...g.question.answers };
          for (const pid of missing) answers[pid] = "skip" as const;
          db.update(cmyGames)
            .set({ question: { ...g.question, answers } })
            .where(eq(cmyGames.id, g.id))
            .run();
          changed.add(g.roomId);
        }
        if (advanceTurn(g.roomId)) changed.add(g.roomId);
      }
    }
  }
  return [...changed];
}
