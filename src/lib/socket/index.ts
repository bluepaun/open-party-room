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
  startGame,
  startNewRound,
  submitGuess,
  sweepExpiredTurns,
} from "../game/lyar";
import { setIo, emitRoomClosed, emitGameState, emitRoomState } from "../broadcast";
import { C2S, EV } from "../types";

interface Ack {
  (res: { ok: boolean; error?: string }): void;
}

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

function handlePlayerLeft(code: string, playerId: string) {
  const room = removePlayer(code, playerId);
  if (room) {
    emitRoomState(code, room);
    if (room.status === "game") {
      const game = getGameDTO(code);
      if (game) emitGameState(code, game);
    }
  } else {
    emitRoomClosed(code);
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

    evictStaleSockets(io, socket);
    socket.join(`room:${code}`);

    const room = getRoomDTO(code);
    if (!room) return socket.disconnect(true);
    socket.emit(EV.roomState, room);

    if (room.status === "game") {
      const game = getGameDTO(code);
      if (game) {
        socket.emit(EV.gameState, game);
        if (game.phase === "reveal") {
          const role = buildRole(code, playerId);
          if (role) socket.emit(EV.youRole, role);
        }
      }
    }

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
      const res = startNewRound(code);
      if (!res.ok) return cb?.(res);
      emitNewGame(res);
      cb?.({ ok: true });
    });

    socket.on("disconnect", () => {
      // 새로고침·네트워크 변동은 재연결로 돌아온다.
      // 잠시 지켜보다가 진짜 이탈(재연결 없음)일 때만 상태 처리.
      const t = setTimeout(() => {
        const stillHere = [...io.of("/").sockets.values()].some(
          (s) => (s.data as { code?: string; playerId?: string }).playerId === playerId &&
            (s.data as { code?: string; playerId?: string }).code === code,
        );
        if (!stillHere) handlePlayerLeft(code, playerId);
      }, 5000);
      t.unref?.();
    });
  });

  // 설명 턴 타임아웃 sweep (2.5초 주기)
  const sweep = setInterval(() => {
    try {
      for (const c of sweepExpiredTurns()) {
        const room = getRoomDTO(c);
        if (!room) continue;
        emitRoomState(c, room);
        broadcastGameFor(c);
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
