"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import { closeRoom } from "@/actions/rooms";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRoom } from "./socket-context";
import { Avatar, PulseDot, ProgressBar } from "./shared";
import { cn } from "cn";

/* ── 라운드 타이머 (MM:SS) — 호출부에서 key로 리마운트 ── */
function RoundTimer({ endsAt }: { endsAt: number }) {
  const [leftMs, setLeftMs] = useState(() => endsAt - Date.now());
  useEffect(() => {
    const t = setInterval(() => setLeftMs(endsAt - Date.now()), 500);
    return () => clearInterval(t);
  }, [endsAt]);
  const sec = Math.max(0, Math.ceil(leftMs / 1000));
  const low = sec <= 30;
  return (
    <span
      className={cn(
        "font-mono text-sm font-bold tabular-nums",
        low ? "text-primary" : "text-muted-foreground",
      )}
      aria-label="라운드 남은 시간"
    >
      {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, "0")}
    </span>
  );
}

/* ════════════════════════════════════════════
   Setup — 출제자 단어 지정
   ════════════════════════════════════════════ */
function SetupScreen() {
  const { room, cmyGame: game, cmyMasterSubmit, meId } = useRoom();
  const [words, setWords] = useState<Record<string, string>>({});
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!game || !game.setupTargets) return null;
  const iAmMaster = game.masterPlayerId === meId;
  const masterName =
    room?.players.find((p) => p.id === game.masterPlayerId)?.name ?? "";

  if (!iAmMaster) {
    return (
      <div className="py-20 text-center">
        <PulseDot className="mx-auto" />
        <h1 className="mt-6 text-2xl font-bold tracking-display">출제 준비 중</h1>
        <p className="mt-2.5 text-sm text-muted-foreground">
          {masterName}님이 다들의 단어들을 정하고 있어요…
        </p>
      </div>
    );
  }

  const allFilled = game.setupTargets.every((t) => (words[t.playerId] ?? "").trim());

  const submit = async () => {
    setSubmitting(true);
    setSubmitErr(null);
    const res = await cmyMasterSubmit(words);
    setSubmitting(false);
    if (!res.ok) setSubmitErr(res.error ?? "제출할 수 없어요.");
  };

  return (
    <div>
      <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground">
        SETUP
      </p>
      <h1 className="mt-3.5 text-2xl font-bold tracking-display">단어 지정</h1>
      <p className="mt-2.5 text-sm text-muted-foreground">
        당신은 <b className="text-foreground">출제자</b>라 이 판에 참여하지 않아요.
        각 플레이어에게 서로 다른 단어를 입력하세요.
      </p>

      <div className="mt-5 flex flex-col gap-2.5">
        {game.setupTargets.map((t) => (
          <div
            key={t.playerId}
            className="flex items-center gap-3 rounded-xl border border-border bg-background p-2.5 pl-3.5"
          >
            <Avatar name={t.name} size="sm" />
            <Input
              value={words[t.playerId] ?? ""}
              onChange={(e) =>
                setWords((w) => ({ ...w, [t.playerId]: e.target.value }))
              }
              maxLength={20}
              placeholder="단어"
              autoComplete="off"
              aria-label={`${t.name}의 단어`}
              className="h-11 flex-1 rounded-lg"
            />
          </div>
        ))}
      </div>

      {submitErr ? (
        <p role="alert" className="mt-3 text-sm font-semibold text-destructive">
          {submitErr}
        </p>
      ) : null}

      <Button
        disabled={!allFilled || submitting}
        onClick={submit}
        className="mt-5 h-13 w-full rounded-lg text-base hover:bg-primary-hover"
      >
        {submitting ? "시작 중…" : "게임 시작"}
      </Button>
    </div>
  );
}

/* ── 오답 토스트 — stamp key로 리마운트, 2.2초 후 자취 ── */
function NopeToast({ stamp }: { stamp: number }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 2200);
    return () => clearTimeout(t);
  }, []);
  if (!visible) return null;
  return (
    <motion.div
      key={stamp}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-foreground px-4.5 py-2.5 text-sm font-bold text-background shadow-lg"
    >
      아직 아니에요! 다음 사람 차례
    </motion.div>
  );
}

/* ════════════════════════════════════════════
   Play — 질문·답변·추측
   ════════════════════════════════════════════ */
function PlayScreen() {
  const {
    cmyGame: game,
    cmyYou: you,
    cmyMyGuess,
    meId,
    cmyAsk,
    cmyAnswer,
    cmyGuess,
  } = useRoom();
  const [question, setQuestion] = useState("");
  const [guessOpen, setGuessOpen] = useState(false);
  const [guess, setGuess] = useState("");

  // 참고: 새 라운드/단계 전환 시 CmyView의 screenKey 변경으로
  // PlayScreen이 리마운트되어 로컬 상태는 자동 초기화됨.

  if (!game) return null;

  const mode = game.mode;
  const iAmMaster = game.masterPlayerId === meId;
  const me = game.players.find((p) => p.id === meId) ?? null;
  const iSolved = !!me?.solved;
  const myRank = me?.rank ?? null;
  const q = game.question;
  const turnId = game.turnPlayerId;
  const iAmTurn = turnId === meId;
  const turnName = game.players.find((p) => p.id === turnId)?.name ?? "";
  const askedBy = q
    ? game.players.find((p) => p.id === q.askedBy)?.name ?? ""
    : "";
  const iAmAskedBy = () => (q ? q.askedBy === meId : false);
  const iAnswered = q ? (q.answers[meId] ?? null) : null;

  const submitQuestion = () => {
    const value = question.trim();
    if (!value) return;
    cmyAsk(value);
    setQuestion("");
  };

  const submitGuess = () => {
    const value = guess.trim();
    if (!value) return;
    cmyGuess(value);
    setGuess("");
    setGuessOpen(false);
  };

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground">
          CALL MY NAME · {mode === "forehead" ? "이마" : "손"}
        </p>
        <div className="flex items-center gap-2.5">
          {game.timerOn && game.roundDeadline ? (
            <RoundTimer key={game.roundDeadline} endsAt={game.roundDeadline} />
          ) : (
            <span className="text-xs font-semibold text-meta">제한 없음</span>
          )}
          <Badge variant="secondary" className="h-6 px-2.5">
            {game.solvedCount}/{game.totalCount}
          </Badge>
        </div>
      </div>
      <h1 className="mt-3 text-2xl font-bold tracking-display">
        {q
          ? `${askedBy}님의 질문`
          : iAmTurn
            ? "당신 차례예요!"
            : `${turnName}님 차례`}
      </h1>

      {/* 플레이어 그리드 */}
      <div className="mt-5 grid grid-cols-2 gap-2.5 sm:gap-3">
        {game.players.map((p) => {
          const isTurn = p.id === turnId && !p.solved;
          const word = you?.othersWords[p.id] ?? null;
          return (
            <div
              key={p.id}
              className={cn(
                "relative rounded-xl border border-border/60 bg-background p-3 pt-4",
                isTurn && "border-foreground bg-surface-warm shadow-[0_0_0_1px_var(--foreground)]",
              )}
            >
              {mode === "forehead" && word ? (
                <span
                  className="absolute -top-2.5 left-1/2 max-w-full -translate-x-1/2 truncate rounded-full border border-border bg-surface-warm px-2.5 py-0.5 text-xs font-bold whitespace-nowrap"
                  title={word}
                >
                  {word}
                </span>
              ) : null}
              <div className="flex items-center gap-2">
                <Avatar name={p.name} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {p.name}
                  {p.id === meId ? (
                    <span className="ml-1 text-xs font-semibold text-primary">(나)</span>
                  ) : null}
                </span>
                {p.solved ? (
                  <Badge className="h-6 bg-foreground px-2 text-xs text-background">
                    {p.rank}위
                  </Badge>
                ) : isTurn ? (
                  <Badge variant="secondary" className="h-6 px-2 text-xs">
                    {q ? "답변 대기" : "질문 중"}
                  </Badge>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* 손 모드: 내 카드 트레이 */}
      {mode === "hand" && !iAmMaster && me ? (
        <div className="mt-6">
          <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground">
            내 손 카드 {game.totalCount - 1}장
          </p>
          <div className="mt-2.5 flex gap-2.5 overflow-x-auto pb-1.5">
            {game.players
              .filter((p) => p.id !== meId)
              .map((p) => (
                <div
                  key={p.id}
                  className="w-40 flex-none rounded-xl border border-border bg-surface-warm p-3.5 text-center"
                >
                  <p className="truncate text-xs text-muted-foreground">
                    {p.name}의 단어
                  </p>
                  <p className="mt-1.5 text-xl font-bold tracking-display break-all">
                    {you?.othersWords[p.id] ?? ""}
                  </p>
                </div>
              ))}
          </div>
        </div>
      ) : null}

      {/* 출제자(심판) 관전 */}
      {iAmMaster ? (
        <Card className="mt-5 rounded-2xl p-4">
          <p className="text-sm font-bold">심판 모드</p>
          <p className="mt-1 text-xs text-muted-foreground">
            출제자라 이 판에는 참여하지 않아요.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {game.players.map((p) => (
              <span
                key={p.id}
                className="rounded-full border border-border bg-surface-warm px-2.5 py-1 text-xs font-semibold"
              >
                {p.name}: {you?.othersWords[p.id] ?? "?"}
              </span>
            ))}
          </div>
        </Card>
      ) : null}

      {/* 맞혔어요 배너 */}
      {iSolved ? (
        <Card className="mt-5 rounded-2xl p-5 text-center">
          <p className="text-2xl font-bold tracking-display">맞혔어요! 🎉</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {myRank}위예요. 남은 플레이어들을 관전하세요.
          </p>
        </Card>
      ) : null}

      {/* 내 턴: 질문 입력 */}
      {iAmTurn && !q && !iAmMaster && !iSolved ? (
        <div className="mt-5">
          <Label htmlFor="cmy-question">예/아니오로 답할 수 있는 질문</Label>
          <div className="mt-2 flex gap-2">
            <Input
              id="cmy-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitQuestion();
              }}
              placeholder="예: 저는 사람인가요?"
              maxLength={100}
              autoComplete="off"
              className="h-12 flex-1 rounded-lg"
            />
            <Button
              onClick={submitQuestion}
              disabled={!question.trim()}
              className="h-12 w-28 flex-none rounded-lg"
            >
              질문하기
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-meta">또는 정답을 외칠 수 있어요.</p>
        </div>
      ) : null}

      {/* 진행 중인 질문 */}
      {q ? (
        <Card className="mt-5 rounded-2xl p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate text-xs font-semibold text-muted-foreground">
              {askedBy}님의 질문
            </span>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {q.answered}/{q.total} 답변
            </span>
          </div>
          <p className="mt-1.5 text-lg font-bold break-words">“{q.text}”</p>
          <ProgressBar value={q.total ? q.answered / q.total : 0} className="mt-3" />

          <div className="mt-3 flex flex-wrap gap-1.5">
            {game.players
              .filter((p) => p.id !== q.askedBy)
              .map((p) => {
                const a = q.answers[p.id];
                return (
                  <span
                    key={p.id}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs font-semibold",
                      a === "yes" && "border-foreground bg-foreground text-background",
                      a === "no" && "border-border bg-surface-warm text-foreground",
                      a === "skip" && "border-border text-meta",
                      !a && "border-border/60 text-meta",
                    )}
                  >
                    {p.name}
                    {a === "yes" ? " 예" : a === "no" ? " 아니요" : a === "skip" ? " 패스" : " …"}
                  </span>
                );
              })}
          </div>

          {!iAmAskedBy() && !iAmMaster && me ? (
            iAnswered ? (
              <p className="mt-3.5 text-sm text-muted-foreground">
                내 답변:{" "}
                <b className="text-foreground">
                  {iAnswered === "yes" ? "예" : iAnswered === "no" ? "아니요" : "—"}
                </b>
              </p>
            ) : (
              <div className="mt-3.5 grid grid-cols-2 gap-2.5">
                <Button
                  variant="outline"
                  className="h-13 rounded-lg text-lg font-bold"
                  onClick={() => cmyAnswer("yes")}
                >
                  예
                </Button>
                <Button
                  variant="outline"
                  className="h-13 rounded-lg text-lg font-bold"
                  onClick={() => cmyAnswer("no")}
                >
                  아니요
                </Button>
              </div>
            )
          ) : null}
        </Card>
      ) : null}

      {/* 정답 외치기 — 내 턴에만 (질문 대신), 실패 시 질문 기회 상실 */}
      {iAmTurn && !q && !iAmMaster && !iSolved ? (
        <div className="mt-3">
          {guessOpen ? (
            <Card className="rounded-2xl p-4">
              <Label htmlFor="cmy-guess">정답 외치기 — 내 단어</Label>
              <p className="mt-1.5 text-xs text-meta">
                실패하면 질문 기회 없이 다음 사람 차례로 넘어가요.
              </p>
              <div className="mt-2 flex gap-2">
                <Input
                  id="cmy-guess"
                  value={guess}
                  onChange={(e) => setGuess(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitGuess();
                  }}
                  placeholder="내 단어"
                  maxLength={30}
                  autoComplete="off"
                  className="h-12 flex-1 rounded-lg"
                />
                <Button
                  onClick={submitGuess}
                  disabled={!guess.trim()}
                  className="h-12 w-28 flex-none rounded-lg"
                >
                  외치기!
                </Button>
              </div>
              <Button
                variant="ghost"
                className="mt-1.5 h-9 w-full text-sm text-muted-foreground"
                onClick={() => {
                  setGuessOpen(false);
                  setGuess("");
                }}
              >
                취소
              </Button>
            </Card>
          ) : (
            <Button
              variant="outline"
              className="h-12 w-full rounded-lg text-base"
              onClick={() => setGuessOpen(true)}
            >
              내 단어를 알아냈어요!
            </Button>
          )}
        </div>
      ) : null}

      {/* 오답 플래시 (페널티 없음 — 토스트만) */}
      <AnimatePresence>
        {cmyMyGuess && !cmyMyGuess.ok ? (
          <NopeToast key={cmyMyGuess.stamp} stamp={cmyMyGuess.stamp} />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ════════════════════════════════════════════
   Result — 등수
   ════════════════════════════════════════════ */
function ResultScreen({ onLobby }: { onLobby: () => void }) {
  const { room, cmyGame: game, isHost, newRound, meId } = useRoom();
  const [starting, setStarting] = useState(false);

  if (!room || !game || !game.ranking) return null;
  const last = game.ranking.filter((r) => !r.solved).map((r) => r.name);

  return (
    <div>
      <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground">
        RESULT
      </p>
      <motion.h1
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
        className="mt-3.5 text-3xl font-bold tracking-display"
      >
        라운드 종료!
      </motion.h1>
      <p className="mt-2.5 text-sm text-muted-foreground">
        {last.length > 0 ? (
          <>
            못 맞힌 사람: <b className="text-foreground">{last.join(", ")}</b> —
            꼴등이에요.
          </>
        ) : (
          "모두 맞혔어요! 🎉"
        )}
      </p>

      <div className="mt-5 flex flex-col gap-2.5">
        {game.ranking.map((r) => (
          <div
            key={r.playerId}
            className={cn(
              "flex items-center gap-3 rounded-xl border bg-background p-3 pl-4",
              r.rank === 1
                ? "border-foreground shadow-[0_0_0_1px_var(--foreground)]"
                : "border-border",
            )}
          >
            <span className="w-7 flex-none text-center font-mono text-lg font-bold tabular-nums">
              {r.rank ?? "—"}
            </span>
            <Avatar name={r.name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">
                {r.name}
                {r.playerId === meId ? (
                  <span className="ml-1 text-xs font-semibold text-primary">(나)</span>
                ) : null}
              </p>
              <p className="truncate text-sm text-muted-foreground">
                단어: <b className="text-foreground">{r.word}</b>
              </p>
            </div>
            {r.solved ? (
              <Check className="size-4.5 flex-none text-primary" strokeWidth={3} aria-hidden="true" />
            ) : (
              <span className="text-xs text-meta">미해결</span>
            )}
          </div>
        ))}
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
              closeRoom(room.code, meId);
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
   CmyView — 스크린 전환
   ════════════════════════════════════════════ */
export function CmyView({ onLobby }: { onLobby: () => void }) {
  const { room, cmyGame: game } = useRoom();

  if (!room || !game) {
    return (
      <div className="mx-auto max-w-[620px] px-4 py-24 text-center text-sm text-muted-foreground">
        <PulseDot className="mx-auto" />
        <p className="mt-3">게임 상태를 불러오는 중…</p>
      </div>
    );
  }

  const screenKey = `${game.startedAt}-${game.phase}`;

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
          {game.phase === "setup" ? (
            <SetupScreen />
          ) : game.phase === "play" ? (
            <PlayScreen />
          ) : (
            <ResultScreen onLobby={onLobby} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
