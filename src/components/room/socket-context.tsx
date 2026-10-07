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
  C2S,
  EV,
  type CmyGameDTO,
  type CmyMyGuess,
  type CmyYouView,
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
  /** 양세찬 게임 */
  cmyGame: CmyGameDTO | null;
  cmyYou: CmyYouView | null;
  cmyMyGuess: CmyMyGuess | null;
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
  cmyGuess: (word: string) => void;
  cmyPass: () => void;
  cmyConfirm: () => void;
  cmyMasterSubmit: (words: Record<string, string>) => Promise<AckResult>;
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
  const [cmyGame, setCmyGame] = useState<CmyGameDTO | null>(null);
  const [cmyYou, setCmyYou] = useState<CmyYouView | null>(null);
  const [cmyMyGuess, setCmyMyGuess] = useState<CmyMyGuess | null>(null);
  const [connected, setConnected] = useState(false);
  const [authFailed, setAuthFailed] = useState(false);
  const [roomClosed, setRoomClosed] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  // 현재 라운드 startedAt — 라운드 전환 감지용 (myVote 리셋)
  const roundRef = useRef<number | null>(null);

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
      if (r.status === "lobby") {
        setGame(null);
        setCmyGame(null);
        setCmyYou(null);
      }
    });
    socket.on(EV.gameState, (g: GameDTO) => {
      // 새 라운드 진입(startedAt 변화) 시 "투표함" 표시 초기화 —
      // 지난 라운드 myVote가 남아 있으면 새 라운드 투표 단계에서
      // 투표용지를 건너뛴 채 "투표 완료" 화면이 보여진다.
      if (roundRef.current !== null && g.startedAt !== roundRef.current) {
        setMyVote(null);
      }
      roundRef.current = g.startedAt;
      setGame(g);
    });
    socket.on(EV.youRole, (y: YouRoleDTO) => setYou(y));
    socket.on(EV.myVote, (v: { targetId: string }) => setMyVote(v.targetId));
    socket.on(EV.cmyState, (g: CmyGameDTO) => setCmyGame(g));
    socket.on(EV.youCmyView, (v: CmyYouView) => setCmyYou(v));
    socket.on(EV.myCmyGuess, (g: CmyMyGuess) => setCmyMyGuess(g));
    socket.on(EV.roomClosed, () => {
      setRoomClosed(true);
      setRoom(null);
      setGame(null);
    });

    socket.on("connect", () => {
      setConnected(true);
      socket.emit(C2S.sync);
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", (err: Error) => {
      const msg = err.message ?? "";
      if (msg === "player not found" || msg === "room closed") {
        setAuthFailed(true);
        socket.disconnect();
      }
    });

    // 화면 복귀(폰 화면 켜짐·다른 앱에서 복귀·탭 전환) 시 즉시 재연결 및 최신 상태 동기화
    const syncState = () => {
      if (socket.connected) {
        socket.emit(C2S.sync);
      } else {
        socket.connect();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        syncState();
      }
    };

    const handleFocus = () => {
      syncState();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handleFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handleFocus);
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
    socketRef.current?.emit(C2S.guess, word);
  }, []);
  const cmyGuess = useCallback((word: string) => {
    socketRef.current?.emit(C2S.cmyGuess, word);
  }, []);
  const cmyPass = useCallback(() => {
    socketRef.current?.emit(C2S.cmyPass);
  }, []);
  const cmyConfirm = useCallback(() => {
    socketRef.current?.emit(C2S.cmyConfirm);
  }, []);
  const cmyMasterSubmit = useCallback(
    (words: Record<string, string>) =>
      new Promise<AckResult>((resolve) => {
        socketRef.current?.timeout(5000).emit(C2S.cmyMasterSubmit, words, (err: Error | null, res?: AckResult) => {
          resolve(err ? { ok: false, error: "서버에 연결할 수 없어요." } : (res ?? { ok: true }));
        });
      }),
    [],
  );

  const value = useMemo<RoomContextValue>(
    () => ({
      room,
      game,
      you,
      myVote,
      cmyGame,
      cmyYou,
      cmyMyGuess,
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
      cmyGuess,
      cmyPass,
      cmyConfirm,
      cmyMasterSubmit,
    }),
    [
      room, game, you, myVote, cmyGame, cmyYou, cmyMyGuess, connected, authFailed, roomClosed,
      playerId, name, startGame, newRound, confirmReveal, explainDone,
      vote, next, submitGuess, cmyGuess, cmyPass, cmyConfirm, cmyMasterSubmit,
    ],
  );

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}
