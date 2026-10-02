"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { leaveRoom } from "@/actions/rooms";
import { TopNav } from "@/components/top-nav";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RoomProvider, useRoom } from "./socket-context";
import { LobbyView } from "./lobby-view";
import { GameView } from "./game-view";
import { CmyView } from "./cmy-view";
import { MeChip, PhaseNav } from "./shared";
import type { WordGroupDTO } from "@/lib/game/words";

function RoomShell({ wordGroups }: { wordGroups: WordGroupDTO[] }) {
  const { room, game, cmyGame, connected, authFailed, roomClosed, meId, meName } = useRoom();
  const router = useRouter();
  const [viewLobby, setViewLobby] = useState(false);

  // 인증 실패 / 방 정리 → 홈(또는 참가)으로
  useEffect(() => {
    if (authFailed) router.replace("/join");
  }, [authFailed, router]);

  useEffect(() => {
    if (roomClosed) router.replace("/");
  }, [roomClosed, router]);

  if (!room) {
    return (
      <div className="flex flex-1 flex-col">
        <TopNav />
        <div className="mx-auto w-full max-w-[620px] px-4 py-16">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="mt-4 h-9 w-64" />
          <Skeleton className="mt-6 h-48 w-full rounded-2xl" />
          <p className="mt-8 text-center text-sm text-muted-foreground">
            {connected ? "방 정보를 불러오는 중…" : "서버에 연결 중…"}
          </p>
        </div>
      </div>
    );
  }

  const inGame = room.status === "game";
  // viewLobby는 result phase 동안만 의미: 새 라운드 시작(phase 변경) 시 자동 해제
  const inResult =
    room.game === "cmy" ? cmyGame?.phase === "result" : game?.phase === "result";
  const showLobby = !inGame || (viewLobby && inResult);

  const exitGame = () => {
    if (
      confirm(
        inGame && game?.phase !== "result"
          ? "게임을 나가면 이번 판 진행 내용이 초기화돼요. 나가겠어요?"
          : "방에서 나가겠어요?",
      )
    ) {
      leaveRoom(room.code, meId);
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <TopNav
        right={
          inGame ? (
            <>
              {room.game === "cmy" ? (
                <span className="hidden text-sm font-semibold text-muted-foreground md:inline">
                  질문 · 추리
                </span>
              ) : (
                <PhaseNav phase={game?.phase ?? "reveal"} />
              )}
              <MeChip name={meName} />
              <Button
                variant="ghost"
                className="h-9 px-3 text-sm"
                onClick={exitGame}
              >
                나가기
              </Button>
            </>
          ) : (
            <span className="font-mono text-sm text-muted-foreground">
              방 {room.code}
            </span>
          )
        }
      />

      <main className="flex-1 px-4 py-10 md:px-6 lg:px-10 lg:py-10">
        {showLobby ? (
          <LobbyView wordGroups={wordGroups} />
        ) : room.game === "cmy" ? (
          <CmyView onLobby={() => setViewLobby(true)} />
        ) : (
          <GameView onLobby={() => setViewLobby(true)} />
        )}
      </main>
    </div>
  );
}

export function RoomClient({
  code,
  playerId,
  name,
  wordGroups,
}: {
  code: string;
  playerId: string;
  name: string;
  wordGroups: WordGroupDTO[];
}) {
  return (
    <RoomProvider code={code} playerId={playerId} name={name}>
      <RoomShell wordGroups={wordGroups} />
    </RoomProvider>
  );
}
