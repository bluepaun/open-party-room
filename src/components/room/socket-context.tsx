"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { io, type Socket } from "socket.io-client";
import {
  EV,
  type GameDTO,
  type RoomDTO,
  type YouRoleDTO,
} from "@/lib/types";

interface AckResult {
  ok: boolean;
  error?: string;
}

interface RoomContextValue {
  room: RoomDTO | null;
  game: GameDTO | null;
  you: YouRoleDTO | null;
  myVote: string | null;
  connected: boolean;
  /** 소켓 인증 실패 (플레이어/방 없음) */
  authFailed: boolean;
  roomClosed: boolean;
  meId: string;
  meName: string;
  isHost: boolean;
  startGame: () => Promise<AckResult>;
  newRound: () => Promise<AckResult>;
  confirmReveal: () => void;
  explainDone: () => void;
  vote: (targetId: string) => void;
  next: () => void;
  submitGuess: (word: string) => void;
}

const RoomContext = createContext<RoomContextValue | null>(null);

export function useRoom(): RoomContextValue {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error("useRoom must be used within <RoomProvider>");
  return ctx;
}

export function RoomProvider({
  code,
  playerId,
  name,
  children,
}: {
  code: string;
  playerId: string;
  name: string;
  children: React.ReactNode;
}) {
  const [room, setRoom] = useState<RoomDTO | null>(null);
  const [game, setGame] = useState<GameDTO | null>(null);
  const [you, setYou] = useState<YouRoleDTO | null>(null);
  const [myVote, setMyVote] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [authFailed, setAuthFailed] = useState(false);
  const [roomClosed, setRoomClosed] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io({
      auth: { code, playerId },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 3000,
    });
    socketRef.current = socket;

    socket.on(EV.roomState, (r: RoomDTO) => {
      setRoom(r);
      // 라운드 초기화(게임 중 이탈) 시 게임 상태도 비워줌
      if (r.status === "lobby") setGame(null);
    });
    socket.on(EV.gameState, (g: GameDTO) => setGame(g));
    socket.on(EV.youRole, (y: YouRoleDTO) => setYou(y));
    socket.on(EV.myVote, (v: { targetId: string }) => setMyVote(v.targetId));
    socket.on(EV.roomClosed, () => {
      setRoomClosed(true);
      setRoom(null);
      setGame(null);
    });

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", (err: Error) => {
      const msg = err.message ?? "";
      if (msg === "player not found" || msg === "room closed") {
        setAuthFailed(true);
        socket.disconnect();
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [code, playerId]);

  const startGame = useCallback(
    () =>
      new Promise<AckResult>((resolve) => {
        socketRef.current?.timeout(5000).emit("game:start", (err: Error | null, res?: AckResult) => {
          resolve(err ? { ok: false, error: "서버에 연결할 수 없어요." } : (res ?? { ok: true }));
        });
      }),
    [],
  );

  const newRound = useCallback(
    () =>
      new Promise<AckResult>((resolve) => {
        socketRef.current?.timeout(5000).emit("game:new-round", (err: Error | null, res?: AckResult) => {
          resolve(err ? { ok: false, error: "서버에 연결할 수 없어요." } : (res ?? { ok: true }));
        });
      }),
    [],
  );

  const confirmReveal = useCallback(() => {
    socketRef.current?.emit("game:confirm");
  }, []);
  const explainDone = useCallback(() => {
    socketRef.current?.emit("game:explain-done");
  }, []);
  const vote = useCallback((targetId: string) => {
    socketRef.current?.emit("game:vote", targetId);
  }, []);
  const next = useCallback(() => {
    socketRef.current?.emit("game:next");
  }, []);
  const submitGuess = useCallback((word: string) => {
    socketRef.current?.emit("game:guess", word);
  }, []);

  const value = useMemo<RoomContextValue>(
    () => ({
      room,
      game,
      you,
      myVote,
      connected,
      authFailed,
      roomClosed,
      meId: playerId,
      meName: name,
      isHost: room?.hostId === playerId,
      startGame,
      newRound,
      confirmReveal,
      explainDone,
      vote,
      next,
      submitGuess,
    }),
    [
      room, game, you, myVote, connected, authFailed, roomClosed,
      playerId, name, startGame, newRound, confirmReveal, explainDone,
      vote, next, submitGuess,
    ],
  );

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}
