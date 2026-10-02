"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import { closeRoom } from "@/actions/rooms";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRoom } from "./socket-context";
import {
  Avatar,
  Countdown,
  OptionRow,
  PulseDot,
  ProgressBar,
  TallyBars,
} from "./shared";
import { cn } from "cn";
import type { PlayerDTO } from "@/lib/types";

/* ════════════════════════════════════════════
   Reveal — 역할 공개
   ════════════════════════════════════════════ */

function RevealScreen() {
  const { game, you, confirmReveal } = useRoom();
  const [confirmed, setConfirmed] = useState(false);

  if (!game) return null;
  const isLiar = you?.isLiar ?? false;

  return (
    <div>
      <p className="mb-2 text-xs font-semibold tracking-[0.08em] text-muted-foreground">
        역할 공개
      </p>
      <h1 className="text-2xl font-bold tracking-display">당신만 볼 수 있어요</h1>

      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
        className="mt-6 rounded-3xl border border-border bg-card p-9 text-center shadow-[0_2px_6px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.1)]"
      >
        <p className="text-sm font-semibold text-muted-foreground">당신의 역할</p>
        <motion.p
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.12, duration: 0.25 }}
          className="mt-3 mb-3.5 text-3xl leading-[1.15] font-bold tracking-display break-all"
        >
          {you === null ? (
            <span className="text-meta">불러오는 중…</span>
          ) : isLiar ? (
            "라이어"
          ) : (
            you.word
          )}
        </motion.p>
        <p className="mx-auto max-w-[34ch] text-[15px] leading-relaxed text-foreground/80">
          {isLiar
            ? "제시어를 받지 못했어요. 자연스럽게 설명하세요."
            : "제시어를 그대로 말하지 마세요."}
        </p>
      </motion.div>

      {you !== null && !confirmed ? (
        <Button
          onClick={() => {
            setConfirmed(true);
            confirmReveal();
          }}
          className="mt-7 h-13 w-full rounded-lg text-base hover:bg-primary-hover"
        >
          알겠어요
        </Button>
      ) : null}

      {confirmed ? (
        <div className="mt-7 flex items-center justify-center gap-2.5 text-sm text-muted-foreground">
          <PulseDot />
          다른 플레이어 확인 대기 중 · {game.confirmedCount} / {game.order.length}명
        </div>
      ) : null}
    </div>
  );
}

/* ════════════════════════════════════════════
   Explain — 설명 순서
   ════════════════════════════════════════════ */

function ExplainScreen({ players }: { players: PlayerDTO[] }) {
  const { game, meId, explainDone } = useRoom();
  if (!game) return null;

  const idx = game.explainIndex;
  const curId = game.order[idx];
  const cur = players.find((p) => p.id === curId);
  const mine = curId === meId;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground">
          EXPLAIN · <span className="font-mono">{idx + 1} / {game.order.length}</span>
        </p>
        <Badge variant={mine ? "secondary" : "outline"} className="h-6 px-2.5">
          {mine ? "내 차례" : "기다려요"}
        </Badge>
      </div>
      <h1 className="mt-3.5 text-2xl font-bold tracking-display">
        {mine ? "당신 차례예요" : `${cur?.name ?? ""}님 차례`}
      </h1>

      <div className="mt-5 flex flex-col gap-2">
        {game.order.map((pid, i) => {
          const p = players.find((x) => x.id === pid);
          if (!p) return null;
          const state = i < idx ? "past" : i === idx ? "cur" : "next";
          return (
            <motion.div
              key={pid}
              layout
              transition={{ duration: 0.2 }}
              className={cn(
                "flex items-center gap-3 rounded-xl border bg-background p-2.75 pl-4",
                state === "cur"
                  ? "border-foreground bg-surface-warm shadow-[0_0_0_1px_var(--foreground)]"
                  : "border-border/60",
              )}
            >
              <span className="w-4.5 flex-none font-mono text-sm text-meta tabular-nums">
                {i + 1}
              </span>
              <Avatar name={p.name} size="sm" />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate font-semibold",
                  state === "past" && "font-medium text-muted-foreground",
                )}
              >
                {p.name}
                {pid === meId ? (
                  <span className="ml-1.5 text-xs font-semibold text-primary">(나)</span>
                ) : null}
              </span>
              {state === "past" ? (
                <Check className="size-4 flex-none" strokeWidth={3} aria-hidden="true" />
              ) : state === "cur" ? (
                <Badge className="h-6 bg-foreground px-2.5 text-background">설명 중</Badge>
              ) : null}
            </motion.div>
          );
        })}
      </div>

      {mine ? (
        <div>
          {game.turnEndedAt ? (
            <Countdown key={game.turnEndedAt} endsAt={game.turnEndedAt} />
          ) : null}
          <Button
            onClick={explainDone}
            className="mt-5 h-13 w-full rounded-lg text-base hover:bg-primary-hover"
          >
            설명 완료
          </Button>
        </div>
      ) : (
        <div className="mt-5 flex items-center gap-2.5 text-sm text-muted-foreground">
          <PulseDot />
          {cur?.name}님이 설명하고 있어요
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════
   Vote — 라이어 투표
   ════════════════════════════════════════════ */

function VoteScreen({ players }: { players: PlayerDTO[] }) {
  const { game, meId, myVote, vote, next } = useRoom();
  const [selected, setSelected] = useState<string | null>(null);

  if (!game) return null;
  const total = game.order.length;
  const myChoice = players.find((p) => p.id === (myVote ?? selected));
  const accused = game.tallyReady
    ? players.find((p) => p.id === game.accusedPlayerId)
    : null;

  /* ── 1) 투표용지 ── */
  if (!myVote && !game.tallyReady) {
    return (
      <div>
        <p className="mb-2 text-xs font-semibold tracking-[0.08em] text-muted-foreground">
          VOTE
        </p>
        <h1 className="text-2xl font-bold tracking-display">라이어를 투표하세요</h1>
        <div className="mt-4 flex flex-col gap-2.5" role="radiogroup" aria-label="투표 대상">
          {players
            .filter((p) => p.id !== meId)
            .map((p) => {
              const orderIdx = game.order.indexOf(p.id);
              return (
                <OptionRow
                  key={p.id}
                  name={p.name}
                  sub={`${orderIdx + 1}번째 설명`}
                  selected={selected === p.id}
                  onClick={() => setSelected(p.id)}
                />
              );
            })}
        </div>
        <Button
          disabled={!selected}
          onClick={() => selected && vote(selected)}
          className="mt-5 h-13 w-full rounded-lg text-base hover:bg-primary-hover"
        >
          {selected
            ? `${players.find((p) => p.id === selected)?.name ?? ""}에게 투표하기`
            : "플레이어를 선택하세요"}
        </Button>
      </div>
    );
  }

  /* ── 2) 투표 완료 대기 ── */
  if (!game.tallyReady) {
    return (
      <div>
        <p className="mb-2 text-xs font-semibold tracking-[0.08em] text-muted-foreground">
          VOTE
        </p>
        <h1 className="text-2xl font-bold tracking-display">투표 완료</h1>
        <Card className="mt-6 rounded-3xl p-9 text-center shadow-[0_2px_6px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.1)]">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-foreground text-background">
            <Check className="size-7" strokeWidth={3} aria-hidden="true" />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            {myChoice ? `당신의 선택: ${myChoice.name}` : "투표를 완료했어요"}
          </p>
          <div className="mx-auto mt-6 max-w-60">
            <ProgressBar value={game.votedCount / total} />
            <p className="mt-2.5 text-sm text-muted-foreground">
              {game.votedCount} / {total}명 투표 완료
            </p>
          </div>
        </Card>
      </div>
    );
  }

  /* ── 3) tally ── */
  return (
    <div>
      <p className="mb-2 text-xs font-semibold tracking-[0.08em] text-muted-foreground">
        VOTE · RESULT
      </p>
      <h1 className="text-2xl font-bold tracking-display">투표 결과</h1>
      <p className="mt-2.5 text-sm text-muted-foreground">
        {accused
          ? `${accused.name}님이 지목됐어요.`
          : "동률 — 아무도 지목되지 않았어요."}
      </p>
      <TallyBars tally={game.tally ?? []} className="mt-4.5" />
      <Button
        onClick={next}
        className="mt-6 h-13 w-full rounded-lg text-base hover:bg-primary-hover"
      >
        {accused?.id === game.liarPlayerId ? "다음" : "결과 보기"}
      </Button>
    </div>
  );
}

/* ════════════════════════════════════════════
   Guess — 최종 도전
   ════════════════════════════════════════════ */

function GuessScreen({ players }: { players: PlayerDTO[] }) {
  const { game, meId, submitGuess } = useRoom();
  const [value, setValue] = useState("");

  if (!game) return null;
  const liar = players.find((p) => p.id === game.liarPlayerId);
  const iAmLiar = meId === game.liarPlayerId;

  return (
    <div>
      <p className="mb-2 text-xs font-semibold tracking-[0.08em] text-muted-foreground">
        FINAL CHALLENGE
      </p>

      {iAmLiar ? (
        <>
          <h1 className="text-2xl font-bold tracking-display">당신이 붙잡혔어요!</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            제시어를 맞히면 라이어가 승리해요.
          </p>
          <Card className="mt-6 rounded-2xl p-6">
            <div className="flex flex-col gap-2">
              <Label htmlFor="guess-input">제시어</Label>
              <Input
                id="guess-input"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && value.trim()) submitGuess(value.trim());
                }}
                placeholder="제시어"
                autoComplete="off"
                className="h-12 rounded-lg text-base"
              />
            </div>
            <Button
              disabled={!value.trim()}
              onClick={() => value.trim() && submitGuess(value.trim())}
              className="mt-4 h-13 w-full rounded-lg text-base hover:bg-primary-hover"
            >
              제출하기
            </Button>
          </Card>
        </>
      ) : (
        <Card className="mt-4 rounded-3xl p-9 text-center shadow-[0_2px_6px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.1)]">
          {liar ? (
            <>
              <Avatar name={liar.name} size="xl" className="mx-auto" />
              <p className="mt-4 text-3xl font-bold tracking-display">{liar.name}</p>
              <div className="mt-3 flex items-center justify-center gap-2.5 text-sm text-muted-foreground">
                <PulseDot />
                제시어를 추측 중
              </div>
            </>
          ) : null}
        </Card>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════
   Result — 결과
   ════════════════════════════════════════════ */

function ResultScreen({
  players,
  roomCode,
  onLobby,
}: {
  players: PlayerDTO[];
  roomCode: string;
  onLobby: () => void;
}) {
  const { game, isHost, newRound, meId } = useRoom();
  const [starting, setStarting] = useState(false);

  if (!game) return null;
  const isLiarWin = game.result === "lyar";

  return (
    <div>
      <p className="mb-2 text-xs font-semibold tracking-[0.08em] text-muted-foreground">
        RESULT
      </p>
      <motion.h1
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
        className="text-3xl font-bold tracking-display"
      >
        {isLiarWin ? "라이어 승리!" : "시민 승리!"}
      </motion.h1>
      <p className="mt-3 max-w-[48ch] text-sm text-muted-foreground">
        {game.resultReason}
      </p>

      <Card className="mt-6 rounded-xl px-6 py-5 text-center">
        <p className="text-sm text-muted-foreground">제시어</p>
        <p className="mt-1.5 text-3xl font-bold tracking-display">{game.word}</p>
      </Card>

      <h2 className="mt-7 mb-3 text-base font-semibold">투표 결과</h2>
      <TallyBars tally={game.tally ?? []} />

      <h2 className="mt-7 mb-3 text-base font-semibold">플레이어</h2>
      <div className="flex flex-col gap-2.5">
        {players.map((p) => {
          const isLiar = p.id === game.liarPlayerId;
          const orderIdx = game.order.indexOf(p.id);
          return (
            <div
              key={p.id}
              className="flex items-center gap-2.5 rounded-xl border border-border bg-background p-3.5 pl-4"
            >
              <Avatar name={p.name} size="sm" />
              <span className="min-w-0 flex-1 truncate font-semibold">
                {p.name}
                {p.id === meId ? (
                  <span className="ml-1.5 text-xs font-semibold text-primary">(나)</span>
                ) : null}
              </span>
              <Badge
                variant={isLiar ? "secondary" : "outline"}
                className={cn("h-6 px-2.5", isLiar && "bg-foreground text-background")}
              >
                {isLiar ? "라이어" : "시민"}
              </Badge>
              <span className="flex-none text-sm text-muted-foreground">
                {orderIdx + 1}번째 설명
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-7 flex gap-2.5">
        {isHost ? (
          <Button
            className="h-13 flex-1 rounded-lg text-base hover:bg-primary-hover"
            disabled={starting}
            onClick={async () => {
              setStarting(true);
              await newRound();
              setStarting(false);
            }}
          >
            {starting ? "시작 중…" : "한 판 더"}
          </Button>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-meta">
            호스트가 새 게임을 시작해요
          </div>
        )}
        <Button
          variant="outline"
          className="h-13 flex-1 rounded-lg text-base"
          onClick={onLobby}
        >
          대기실로
        </Button>
      </div>
      {isHost ? (
        <Button
          variant="ghost"
          className="mt-2.5 h-11 w-full text-sm text-muted-foreground"
          onClick={() => {
            if (confirm("정말 방을 정리할까요? 모든 플레이어가 나가요.")) {
              closeRoom(roomCode, meId);
            }
          }}
        >
          방을 정리하고 새로 시작
        </Button>
      ) : null}
    </div>
  );
}

/* ════════════════════════════════════════════
   GameView — 스크린 전환
   ════════════════════════════════════════════ */

export function GameView({ onLobby }: { onLobby: () => void }) {
  const { room, game } = useRoom();

  const players = useMemo(
    () => room?.players ?? [],
    [room],
  );

  if (!room || !game) {
    return (
      <div className="mx-auto max-w-[620px] px-4 py-24 text-center text-sm text-muted-foreground">
        <PulseDot className="mx-auto" />
        <p className="mt-3">게임 상태를 불러오는 중…</p>
      </div>
    );
  }

  const screenKey = `${game.startedAt}-${game.phase}${game.tallyReady ? "-tally" : ""}${game.result ? "-end" : ""}`;

  return (
    <div className="mx-auto max-w-[620px] px-4 pt-11 pb-24">
      <AnimatePresence mode="wait">
        <motion.div
          key={screenKey}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
        >
          {game.phase === "reveal" ? (
            <RevealScreen />
          ) : game.phase === "explain" ? (
            <ExplainScreen players={players} />
          ) : game.phase === "vote" ? (
            <VoteScreen players={players} />
          ) : game.phase === "guess" ? (
            <GuessScreen players={players} />
          ) : (
            <ResultScreen players={players} roomCode={room.code} onLobby={onLobby} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
