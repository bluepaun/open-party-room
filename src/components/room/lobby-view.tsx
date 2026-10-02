"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { leaveRoom, closeRoom } from "@/actions/rooms";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useRoom } from "./socket-context";
import { Avatar, CopyCodeButton, PulseDot } from "./shared";
import { MIN_PLAYERS } from "@/lib/types";

const RULES: { bold: string; text: string }[] = [
  { bold: "한 명", text: "플레이어 중 한 명이 라이어로 랜덤하게 정해져요." },
  { bold: "라이어만", text: "제시어를 몰라요 — 나머지 플레이어는 제시어를 확인해요." },
  { bold: "60초", text: "순서대로 60초씩 제시어를 설명해요. 라이어는 자연스럽게 속이세요." },
  { bold: "투표", text: "모두 설명을 마치면, 누가 라이어인지 투표해요." },
  {
    bold: "",
    text: "투표가 라이어를 빠지면 라이어 승리. 붙잡으면 라이어가 제시어를 맞히면 승리, 못 맞히면 라이어 패배예요.",
  },
];

export function LobbyView() {
  const { room, game, isHost, startGame, newRound, meId, meName } = useRoom();
  const [startErr, setStartErr] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  if (!room) return null;

  const inResult = room.status === "game" && game?.phase === "result";
  const canStart = room.status === "lobby" && room.players.length >= MIN_PLAYERS;

  const handleStart = async () => {
    setStarting(true);
    setStartErr(null);
    const res = await startGame();
    setStarting(false);
    if (!res.ok) setStartErr(res.error ?? "시작할 수 없어요.");
  };

  const handleNewRound = async () => {
    setStarting(true);
    setStartErr(null);
    const res = await newRound();
    setStarting(false);
    if (!res.ok) setStartErr(res.error ?? "시작할 수 없어요.");
  };

  return (
    <div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_370px] lg:gap-12">
      {/* ── 왼쪽: 방 정보 + 플레이어 + 규칙 ── */}
      <div className="flex min-w-0 flex-col gap-5">
        <div>
          <Link href="/" className="text-sm font-semibold text-muted-foreground hover:text-foreground">
            ← 게임 목록
          </Link>
          <h1 className="mt-3 text-2xl font-bold tracking-display break-all">
            {room.name}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            방 코드 <span className="font-mono font-bold">{room.code}</span> · 라이어 게임
          </p>
        </div>

        {/* 결과 요약 (결과 단계에서 대기실로 왔을 때) */}
        <AnimatePresence>
          {inResult && game ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Card className="rounded-2xl p-5 text-center">
                <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground">
                  JUST FINISHED
                </p>
                <p className="mt-2 text-3xl font-bold tracking-display">
                  {game.result === "lyar" ? "라이어 승리!" : "시민 승리!"}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">{game.resultReason}</p>
                <div className="mt-4 rounded-xl border border-border bg-surface-warm py-4">
                  <p className="text-sm text-muted-foreground">제시어</p>
                  <p className="mt-1 text-3xl font-bold tracking-display">{game.word}</p>
                </div>
              </Card>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <Card className="rounded-2xl p-5">
          <div className="mb-3.5 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">
              플레이어 <span className="font-mono text-meta">{room.players.length}명</span>
            </h2>
            <Badge variant="outline" className="h-6 px-2.5">
              3–8명
            </Badge>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <AnimatePresence mode="popLayout">
              {room.players.map((p, i) => (
                <motion.div
                  key={p.id}
                  layout
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92 }}
                  transition={{ duration: 0.18 }}
                  className="flex items-center gap-3 rounded-xl border border-border/60 bg-background p-2.5 pl-3"
                >
                  <Avatar name={p.name} />
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-base font-semibold"
                      title={p.name}
                      data-me={p.id === meId ? "true" : undefined}
                    >
                      {p.name}
                      {p.id === meId ? (
                        <span className="ml-1.5 text-xs font-semibold text-primary">
                          (나)
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-meta">
                      {p.host ? "호스트 · " : ""}플레이어 {i + 1}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </Card>

        <Card className="rounded-2xl px-5 py-4">
          <h2 className="text-base font-semibold">게임 규칙</h2>
          <ol className="mt-3 flex flex-col gap-2.5">
            {RULES.map((r, i) => (
              <li
                key={i}
                className="flex gap-3 text-[15px] leading-relaxed text-foreground/80"
              >
                <span
                  aria-hidden="true"
                  className="grid size-6.5 flex-none place-items-center rounded-full border border-border bg-surface-warm font-mono text-xs font-bold text-muted-foreground"
                >
                  {i + 1}
                </span>
                <span>
                  {r.bold ? (
                    <>
                      <b className="font-bold text-foreground">{r.bold}</b>{" "}
                    </>
                  ) : null}
                  {r.text}
                  {i === 4 ? (
                    <span className="text-meta"> 동률 투표는 아무도 지목되지 않은 걸로 봐요.</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      {/* ── 오른쪽: 시작 패널 ── */}
      <aside className="rounded-3xl border border-border bg-card p-6 shadow-[0_2px_6px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.1)] lg:sticky lg:top-6">
        <div className="flex items-center gap-3.5">
          <div
            aria-hidden="true"
            className="grid size-13 flex-none place-items-center rounded-xl bg-foreground font-mono text-lg font-bold text-background"
          >
            Ly
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-[-0.01em]">라이어 게임</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              3–8명 · 5–10분 · 제시어 1개
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-surface-warm p-3.5 pb-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-muted-foreground">방 코드</span>
            <CopyCodeButton code={room.code} />
          </div>
          <span className="mt-2 block font-mono text-2xl font-bold tracking-[0.16em]">
            {room.code}
          </span>
        </div>

        <div className="mt-3 flex items-center justify-between px-0.5">
          <span className="text-sm text-muted-foreground">플레이어</span>
          <span className="font-mono font-bold">{room.players.length}명</span>
        </div>

        {startErr ? (
          <p role="alert" className="mt-3 text-sm font-semibold text-destructive">
            {startErr}
          </p>
        ) : null}

        {!inResult ? (
          <Button
            onClick={handleStart}
            disabled={!canStart || starting}
            className="mt-5 h-13 w-full rounded-lg text-base hover:bg-primary-hover"
          >
            {room.status === "game" ? (
              <span className="flex items-center gap-2">
                <PulseDot className="size-1.5 bg-background" /> 게임 진행 중
              </span>
            ) : starting ? (
              "시작 중…"
            ) : room.players.length < MIN_PLAYERS ? (
              `${MIN_PLAYERS}명부터 시작해요 (${room.players.length}명)`
            ) : (
              "게임 시작"
            )}
          </Button>
        ) : (
          <Button
            onClick={handleNewRound}
            disabled={!isHost || starting}
            title={isHost ? undefined : "호스트만 새 게임을 시작할 수 있어요"}
            className="mt-5 h-13 w-full rounded-lg text-base hover:bg-primary-hover"
          >
            {starting ? "시작 중…" : "한 판 더"}
          </Button>
        )}

        <Button
          onClick={() => leaveRoom(room.code, meId)}
          variant="ghost"
          className="mt-1.5 h-11 w-full text-base"
        >
          방 나가기
        </Button>

        {isHost ? (
          <Button
            onClick={() => {
              if (confirm("정말 방을 정리할까요? 모든 플레이어가 나가요.")) {
                closeRoom(room.code, meId);
              }
            }}
            variant="ghost"
            className="mt-1.5 h-10 w-full text-sm text-muted-foreground"
          >
            방을 정리하고 새로 시작
          </Button>
        ) : null}

        <p className="mt-4 text-center text-xs leading-relaxed text-meta">
          {meName}님, 코드를 공유해서
          <br />
          친구들을 초대하세요.
        </p>
      </aside>
    </div>
  );
}
