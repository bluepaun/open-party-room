"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TopNav, PageFoot } from "@/components/top-nav";

interface GameCard {
  id: string;
  no: string;
  word: string;
  title: string;
  spec: string;
  href: string;
  cta: string;
  cover: string | null;
}

const games: GameCard[] = [
  {
    id: "lyar",
    no: "GAME 01",
    word: "라이어",
    title: "라이어 게임",
    spec: "3명 이상",
    href: "/rooms/create",
    cta: "방 만들기",
    cover: "/images/liar-cover.png",
  },
  {
    id: "cmy",
    no: "GAME 02",
    word: "콜마이네임",
    title: "양세찬 게임",
    spec: "2–8명 · 이마/손",
    href: "/rooms/create?game=cmy",
    cta: "방 만들기",
    // © irasutoya (https://www.irasutoya.com/2014/08/blog-post_14.html) — free license
    cover: "/images/cmy-cover.png",
  },
];

export default function HomePage() {
  return (
    <>
      <TopNav
        right={
          <Button asChild variant="ghost" className="h-9 px-3 text-base">
            <Link href="/join">코드로 참가</Link>
          </Button>
        }
      />

      <main className="px-4 py-12 md:px-6 lg:px-10 lg:py-16">
        <div className="mx-auto max-w-7xl">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 text-xs font-semibold tracking-[0.08em] text-muted-foreground">
                GAME LIST
              </p>
              <h1 className="text-2xl font-bold tracking-display">
                오늘 할 게임을 고르세요
              </h1>
          </div>
          </div>

          <motion.div
            initial="hidden"
            animate="show"
            variants={{
              hidden: {},
              show: { transition: { staggerChildren: 0.08 } },
            }}
            className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3"
          >
            {games.map((g) => (
              <motion.article
                key={g.id}
                variants={{
                  hidden: { opacity: 0, y: 14 },
                  show: {
                    opacity: 1,
                    y: 0,
                    transition: { duration: 0.35, ease: [0.2, 0, 0, 1] },
                  },
                }}
                className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card"
              >
                {g.cover ? (
                  <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-surface-warm">
                    <Image
                      src={g.cover}
                      alt={`${g.title} 표지`}
                      fill
                      sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                      className="object-contain p-3"
                    />
                    <span className="absolute top-3.5 left-4 font-mono text-xs font-semibold tracking-[0.18em] text-muted-foreground">
                      {g.no}
                    </span>
                  </div>
                ) : (
                  <div
                    aria-hidden="true"
                    className="flex aspect-[4/3] flex-col justify-between bg-foreground p-5 text-background"
                  >
                    <span className="font-mono text-xs font-semibold tracking-[0.18em] opacity-60">
                      {g.no}
                    </span>
                    <span className="text-3xl font-bold leading-none tracking-display">
                      {g.word}
                    </span>
                  </div>
                )}
                <div className="flex flex-1 flex-col p-4 pt-5">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-bold tracking-[-0.01em]">
                      {g.title}
                    </h2>
                    <Badge variant="secondary" className="h-6 px-2.5">
                      플레이 가능
                    </Badge>
                  </div>
                  <p className="mt-2 font-mono text-sm text-meta">{g.spec}</p>
                  <div className="mt-4 pt-1">
                    <Button
                      asChild
                      className="h-11 w-full rounded-lg text-base"
                      variant="default"
                    >
                      <Link href={g.href}>{g.cta}</Link>
                    </Button>
                  </div>
                </div>
              </motion.article>
            ))}
          </motion.div>
        </div>
      </main>

      <PageFoot />
    </>
  );
}
