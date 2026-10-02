"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Check, Copy } from "lucide-react";
import { cn } from "cn";
import type { GamePhase, TallyRow } from "@/lib/types";
import { TURN_SECONDS } from "@/lib/types";

/* ── 아바타 ── */

export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "sm" | "md" | "xl";
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid flex-none place-items-center rounded-full border border-border bg-surface-warm font-bold text-foreground",
        size === "sm" && "size-8 text-sm",
        size === "md" && "size-11 text-base",
        size === "xl" && "size-16 text-[26px]",
        className,
      )}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/* ── 상단 단계 네비게이션 ── */

const STAGES: { id: GamePhase; label: string }[] = [
  { id: "reveal", label: "역할 공개" },
  { id: "explain", label: "설명" },
  { id: "vote", label: "투표" },
  { id: "result", label: "결과" },
];

export function PhaseNav({ phase }: { phase: GamePhase }) {
  const idx = STAGES.findIndex((s) => s.id === phase);
  // guess는 투표 단계로 표시
  const activeIdx = phase === "guess" ? 2 : idx;
  return (
    <nav
      aria-label="게임 진행 단계"
      className="hidden items-center gap-5 text-sm md:flex"
    >
      {STAGES.map((s, i) => (
        <span
          key={s.id}
          className={cn(
            "border-b-2 border-transparent pb-1 font-semibold text-meta",
            i === activeIdx && "border-foreground text-foreground",
            i < activeIdx && "text-muted-foreground",
          )}
        >
          {s.label}
        </span>
      ))}
    </nav>
  );
}

/* ── 내 정보 칩 ── */

export function MeChip({
  name,
  onClick,
}: {
  name: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 items-center gap-2 rounded-full border border-border bg-background px-3.5 pl-1.5 text-sm font-semibold transition-colors hover:border-foreground"
    >
      <Avatar name={name} size="sm" />
      <span className="hidden sm:inline">{name}</span>
    </button>
  );
}

/* ── 코드 복사 버튼 ── */

export function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const ta = document.createElement("textarea");
        ta.value = code;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
    } catch {
      /* ignore */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "복사됨" : "방 코드 복사"}
      className="grid size-11 place-items-center rounded-full border border-border/60 bg-background text-foreground transition-colors hover:border-foreground hover:bg-surface-warm"
    >
      <motion.span
        key={copied ? "check" : "copy"}
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.15 }}
        className="grid place-items-center"
      >
        {copied ? <Check className="size-4.5" strokeWidth={2.5} /> : <Copy className="size-4.5" />}
      </motion.span>
    </button>
  );
}

/* ── 카운트다운 (설명 턴) ── */

export function Countdown({ endsAt }: { endsAt: number }) {
  // 턴 시작 시점이므로 전체 시간으로 시작 — 첫 tick(250ms)에서 정확히 보정
  const [leftMs, setLeftMs] = useState(() => TURN_SECONDS * 1000);

  useEffect(() => {
    const t = setInterval(() => {
      setLeftMs(Math.max(0, endsAt - Date.now()));
    }, 250);
    return () => clearInterval(t);
  }, [endsAt]);

  const leftSec = Math.ceil(leftMs / 1000);
  const pct = Math.max(0, Math.min(100, (leftMs / (TURN_SECONDS * 1000)) * 100));
  const low = leftSec <= 10;

  return (
    <div className={cn("mt-7", low && "[&_.timer-num]:text-primary")}>
      <div className="timer-num font-mono text-[56px] font-bold leading-none tabular-nums text-center">
        {leftSec}
      </div>
      <div className="mt-3.5 h-1.5 overflow-hidden rounded-full bg-fg-soft">
        <div
          className={cn(
            "h-full rounded-full bg-foreground transition-[width] duration-300 ease-linear",
            low && "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* ── 투표 집계 바 ── */

export function TallyBars({
  tally,
  className,
}: {
  tally: TallyRow[];
  className?: string;
}) {
  const max = Math.max(1, ...tally.map((t) => t.count));
  return (
    <div className={cn("flex flex-col gap-3.5", className)}>
      {tally.map((t) => (
        <div key={t.playerId} className="flex items-center gap-3">
          <Avatar name={t.name} size="sm" />
          <div className="min-w-0 flex-1">
            <span className="mb-1.5 block truncate text-sm font-semibold">
              {t.name}
            </span>
            <div className="h-2 overflow-hidden rounded-full bg-fg-soft">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(t.count / max) * 100}%` }}
                transition={{ duration: 0.5, ease: [0.2, 0, 0, 1] }}
                className="h-full rounded-full bg-foreground"
              />
            </div>
          </div>
          <span className="min-w-12 text-right text-sm font-bold tabular-nums">
            {t.count}표
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── 진행률 바 (투표 대기) ── */

export function ProgressBar({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  return (
    <div className={cn("h-2 overflow-hidden rounded-full bg-fg-soft", className)}>
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${value * 100}%` }}
        transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
        className="h-full rounded-full bg-foreground"
      />
    </div>
  );
}

/* ── 대기 펄스 ── */

export function PulseDot({ className }: { className?: string }) {
  return (
    <motion.span
      aria-hidden="true"
      animate={{ opacity: [1, 0.35, 1], scale: [1, 0.7, 1] }}
      transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
      className={cn("size-2 flex-none rounded-full bg-foreground", className)}
    />
  );
}

/* ── 선택 옵션 (투표/동정 확인 스타일) ── */

export function OptionRow({
  name,
  sub,
  selected,
  onClick,
}: {
  name: string;
  sub?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-16 w-full items-center gap-3 rounded-xl border border-border bg-background p-3 pl-4 text-left transition-all",
        selected && "border-foreground bg-surface-warm shadow-[0_0_0_1px_var(--foreground)]",
      )}
    >
      <Avatar name={name} size="sm" />
      <span className="min-w-0 flex-1">
        <b className="block text-base">{name}</b>
        {sub ? (
          <span className="mt-0.5 block truncate text-sm text-muted-foreground">
            {sub}
          </span>
        ) : null}
      </span>
      <motion.span
        animate={{ opacity: selected ? 1 : 0, scale: selected ? 1 : 0.6 }}
        transition={{ duration: 0.15 }}
        aria-hidden="true"
        className="grid size-6 flex-none place-items-center rounded-full bg-primary text-primary-foreground"
      >
        <Check className="size-3.5" strokeWidth={3} />
      </motion.span>
    </button>
  );
}
