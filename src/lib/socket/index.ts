import type { Server, Socket } from "socket.io";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { players, rooms } from "../db/schema";
import { getRoomDTO, removePlayer } from "../rooms";
import {
  advanceAfterTally,
  advanceExplain,
  buildRole,
  castVote,
  confirmReveal,
  getGameDTO,
  getPlayerVote,
  startGame,
  startNewRound,
  submitGuess,
  sweepExpiredTurns,
} from "../game/lyar";
import {
  buildCmyYouView,
  confirmCmyWord,
  getCmyGameDTO,
  guessCmyWord,
  masterSubmitWords,
  passCmyTurn,
  startCmyGame,
  startCmyNewRound,
  sweepCmy,
} from "../game/cmy";
import { setIo, emitRoomClosed, emitGameState, emitRoomState } from "../broadcast";
import { C2S, EV } from "../types";

interface Ack {
  (res: { ok: boolean; error?: string }): void;
}

/** 이탈 유예 타이머 (key: `${code}:${playerId}`) */
const pendingDisconnects = new Map<string, NodeJS.Timeout>();

export function cancelDisconnectGracePeriod(code: string, playerId: string) {
  const key = `${code}:${playerId}`;
  const timer = pendingDisconnects.get(key);
  if (timer) {
    clearTimeout(timer);
    pendingDisconnects.delete(key);
  }
}

const GRACE_PERIOD_GAME_MS = process.env.DISCONNECT_GRACE_GAME_MS
  ? Number(process.env.DISCONNECT_GRACE_GAME_MS)
  : 10 * 60 * 1000; // 게임 중: 기본 10분 유예
const GRACE_PERIOD_LOBBY_MS = process.env.DISCONNECT_GRACE_LOBBY_MS
  ? Number(process.env.DISCONNECT_GRACE_LOBBY_MS)
  : 3 * 60 * 1000; // 대기실: 기본 3분 유예

/**
 * 같은 플레이어의 여러 소켓(새 탭·재연결 중 겹침) 중 가장 오래된 것만 남긴다.
 */
function evictStaleSockets(io: Server, socket: Socket) {
  const { code, playerId } = socket.data as { code: string; playerId: string };
  for (const s of io.of("/").sockets.values()) {
    if (s === socket) continue;
    const d = s.data as { code?: string; playerId?: string };
    if (d.code === code && d.playerId === playerId) s.disconnect(true);
  }
}

function handlePlayerLeft(io: Server, code: string, playerId: string) {
  const room = removePlayer(code, playerId);
  if (room) {
    emitRoomState(code, room);
    if (room.status === "game") {
      if (room.game === "cmy") emitCmyState(io, code);
      else {
        const game = getGameDTO(code);
        if (game) emitGameState(code, game);
      }
    }
  } else {
    emitRoomClosed(code);
  }
}

/** cmy 상태 브로드캐스트 (베이스 + 소켓별 개인화 단어 뷰) */
function emitCmyState(io: Server, code: string) {
  const g = getCmyGameDTO(code);
  if (!g) return;
  io.to(`room:${code}`).emit(EV.cmyState, g);
  for (const s of io.of("/").sockets.values()) {
    const d = s.data as { code?: string; playerId?: string };
    if (d.code !== code || !d.playerId) continue;
    const view = buildCmyYouView(code, d.playerId);
    if (view) s.emit(EV.youCmyView, view);
  }
}

/** 접속·재접속·화면 복귀 시 해당 플레이어 소켓에 최신 방/게임 전체 상태 동기화 */
function sendFullStateToSocket(socket: Socket, code: string, playerId: string) {
  const room = getRoomDTO(code);
  if (!room) {
    socket.disconnect(true);
    return;
  }
  socket.emit(EV.roomState, room);

  if (room.status === "game") {
    if (room.game === "cmy") {
      const g = getCmyGameDTO(code);
      if (g) socket.emit(EV.cmyState, g);
      const view = buildCmyYouView(code, playerId);
      if (view) socket.emit(EV.youCmyView, view);
    } else {
      const game = getGameDTO(code);
      if (game) {
        socket.emit(EV.gameState, game);
        const role = buildRole(code, playerId);
        if (role) socket.emit(EV.youRole, role);
        if (game.phase === "vote") {
          const myVote = getPlayerVote(code, playerId);
          if (myVote) socket.emit(EV.myVote, { targetId: myVote });
        }
      }
    }
  }
}

export function setupSocketServer(io: Server) {
  setIo(io);

  // handshake auth: { code, playerId }
  io.use((socket, next) => {
    const auth = socket.handshake.auth as { code?: string; playerId?: string } | undefined;
    const code = auth?.code ?? "";
    const playerId = auth?.playerId ?? "";
    if (!code || !playerId) return next(new Error("unauthorized"));

    const player = db.select().from(players).where(eq(players.id, playerId)).get();
    if (!player || player.roomId !== code) return next(new Error("player not found"));
    const room = db.select().from(rooms).where(eq(rooms.code, code)).get();
    if (!room) return next(new Error("room closed"));

    socket.data.code = code;
    socket.data.playerId = playerId;
    next();
  });

  io.on("connection", (socket) => {
    const code = socket.data.code as string;
    const playerId = socket.data.playerId as string;

    // 재접속 시 진행 중인 이탈 타이머 취소 (동일 세션 유지)
    cancelDisconnectGracePeriod(code, playerId);

    evictStaleSockets(io, socket);
    socket.join(`room:${code}`);

    // 접속 직후 최신 전체 상태 동기화
    sendFullStateToSocket(socket, code, playerId);

    // 클라이언트 포커스/가시성 복귀 시 수동 상태 동기화 요청 처리
    socket.on(C2S.sync, () => {
      sendFullStateToSocket(socket, code, playerId);
    });

    // 플레이어의 명시적 방 나가기 요청
    socket.on(C2S.leave, () => {
      cancelDisconnectGracePeriod(code, playerId);
      handlePlayerLeft(io, code, playerId);
    });

    const emitNewGame = (res: {
      ok: true;
      room: NonNullable<ReturnType<typeof getRoomDTO>>;
    }) => {
      emitRoomState(code, res.room);
      const game = getGameDTO(code);
      if (game) emitGameState(code, game);
      for (const s of io.of("/").sockets.values()) {
        const d = s.data as { code?: string; playerId?: string };
        if (d.code !== code) continue;
        const role = buildRole(code, d.playerId!);
        if (role) s.emit(EV.youRole, role);
      }
    };

    socket.on(C2S.start, (cb?: Ack) => {
      const now = getRoomDTO(code);
      if (!now) return cb?.({ ok: false, error: "방을 찾을 수 없어요." });
      if (now.hostId !== playerId) return cb?.({ ok: false, error: "호스트만 게임을 시작할 수 있어요." });
      if (now.status === "game") return cb?.({ ok: false, error: "이미 진행 중인 게임이 있어요." });

      if (now.game === "cmy") {
        const res = startCmyGame(code);
        if (!res.ok) return cb?.(res);
        emitRoomState(code, res.room);
        emitCmyState(io, code);
        cb?.({ ok: true });
        return;
      }

      const res = startGame(code);
      if (!res.ok) return cb?.(res);
      emitNewGame(res);
      cb?.({ ok: true });
    });

    socket.on(C2S.confirm, () => {
      const game = confirmReveal(code, playerId);
      if (game) emitGameState(code, game);
    });

    socket.on(C2S.explainDone, () => {
      const current = getGameDTO(code);
      if (!current || current.currentTurnPlayerId !== playerId) return;
      const game = advanceExplain(code);
      if (game) emitGameState(code, game);
    });

    socket.on(C2S.vote, (targetId: unknown) => {
      const tid = String(targetId ?? "");
      const game = castVote(code, playerId, tid);
      if (game) {
        emitGameState(code, game);
        socket.emit(EV.myVote, { targetId: tid });
      }
    });

    socket.on(C2S.next, () => {
      const game = advanceAfterTally(code);
      if (game) emitGameState(code, game);
    });

    socket.on(C2S.guess, (word: unknown) => {
      const game = submitGuess(code, playerId, String(word ?? ""));
      if (game) emitGameState(code, game);
    });

    socket.on(C2S.newRound, (cb?: Ack) => {
      const now = getRoomDTO(code);
      if (!now || now.hostId !== playerId) {
        return cb?.({ ok: false, error: "호스트만 새 게임을 시작할 수 있어요." });
      }
      if (now.game === "cmy") {
        const res = startCmyNewRound(code);
        if (!res.ok) return cb?.(res);
        emitRoomState(code, res.room);
        emitCmyState(io, code);
        cb?.({ ok: true });
        return;
      }
      const res = startNewRound(code);
      if (!res.ok) return cb?.(res);
      emitNewGame(res);
      cb?.({ ok: true });
    });

    /* ── 양세찬 게임 (콜 마이 네임) ── */

    // hand 모드: 턴 플레이어의 정답 추정
    socket.on(C2S.cmyGuess, (word: unknown) => {
      const { game, myGuess } = guessCmyWord(code, playerId, String(word ?? ""));
      if (myGuess) socket.emit(EV.myCmyGuess, myGuess);
      if (game) emitCmyState(io, code);
    });

    // hand 모드: 턴 넘기기
    socket.on(C2S.cmyPass, () => {
      const game = passCmyTurn(code, playerId);
      if (game) emitCmyState(io, code);
    });

    // forehead 모드: 다른 사람이 내 단어를 맞히면 내가 눌러주는 '정답' 버튼
    socket.on(C2S.cmyConfirm, () => {
      const game = confirmCmyWord(code, playerId);
      if (game) emitCmyState(io, code);
    });

    socket.on(C2S.cmyMasterSubmit, (words: unknown, cb?: Ack) => {
      const w =
        typeof words === "object" && words !== null ? (words as Record<string, string>) : {};
      const res = masterSubmitWords(code, playerId, w);
      if ("ok" in res) {
        cb?.(res);
        return;
      }
      emitCmyState(io, code);
      cb?.({ ok: true });
    });

    socket.on("disconnect", () => {
      // 같은 플레이어의 다른 소켓이 연결되어 있는지 확인
      const stillHere = [...io.of("/").sockets.values()].some(
        (s) =>
          s !== socket &&
          (s.data as { code?: string; playerId?: string }).playerId === playerId &&
          (s.data as { code?: string; playerId?: string }).code === code,
      );
      if (stillHere) return;

      const disconnectKey = `${code}:${playerId}`;
      const existingTimer = pendingDisconnects.get(disconnectKey);
      if (existingTimer) clearTimeout(existingTimer);

      const room = getRoomDTO(code);
      if (!room) return;

      // 게임 중에는 모바일 화면 꺼짐·앱 전환 등 재연결을 위해 넉넉한 유예 시간(기본 10분) 적용
      // 대기실에서도 다른 친구 입장을 기다리며 화면을 끌 수 있으므로 기본 3분 적용
      const graceMs = room.status === "game" ? GRACE_PERIOD_GAME_MS : GRACE_PERIOD_LOBBY_MS;

      const timer = setTimeout(() => {
        pendingDisconnects.delete(disconnectKey);
        const isConnectedNow = [...io.of("/").sockets.values()].some(
          (s) =>
            (s.data as { code?: string; playerId?: string }).playerId === playerId &&
            (s.data as { code?: string; playerId?: string }).code === code,
        );
        if (!isConnectedNow) {
          handlePlayerLeft(io, code, playerId);
        }
      }, graceMs);
      timer.unref?.();
      pendingDisconnects.set(disconnectKey, timer);
    });
  });

  // 턴 타임아웃 sweep (2.5초 주기) — 라이어(설명 턴) + cmy(질문/답변/라운드)
  const sweep = setInterval(() => {
    try {
      const changed = new Set<string>();
      for (const c of sweepExpiredTurns()) changed.add(c);
      for (const c of sweepCmy()) changed.add(c);
      for (const c of changed) {
        const room = getRoomDTO(c);
        if (!room) continue;
        emitRoomState(c, room);
        if (room.game === "cmy") emitCmyState(io, c);
        else broadcastGameFor(c);
      }
    } catch (err) {
      console.error("[sweep] error", err);
    }
  }, 2500);
  sweep.unref?.();

  function broadcastGameFor(c: string) {
    const g = getGameDTO(c);
    if (g) emitGameState(c, g);
  }
}
