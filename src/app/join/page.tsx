import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { TopNav } from "@/components/top-nav";
import { Button } from "@/components/ui/button";
import { JoinRoomForm } from "@/components/join-room-form";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "코드로 참가 · 파티룸",
};

export default function JoinPage() {
  return (
    <>
      <TopNav
        right={
          <Button asChild variant="ghost" className="h-9 px-3 text-base">
            <Link href="/">← 게임 목록</Link>
          </Button>
        }
      />
      <main className="px-4 py-14 md:px-6 lg:px-10 lg:py-24">
        <div className="mx-auto flex w-full max-w-[460px] flex-col">
          <p className="mb-2 text-xs font-semibold tracking-[0.08em] text-muted-foreground">
            JOIN A ROOM
          </p>
          <h1 className="text-2xl font-bold tracking-display">코드로 참가</h1>

          <div className="mt-7">
            <Suspense fallback={<Card className="rounded-xl p-6" />}>
              <JoinRoomForm />
            </Suspense>
          </div>

          <p className="mt-7 text-center text-sm text-muted-foreground">
            방을 만들고 있나요?{" "}
            <Link
              href="/rooms/create"
              className="text-foreground underline underline-offset-[3px] hover:text-foreground/70"
            >
              방 만들기
            </Link>
          </p>
        </div>
      </main>
    </>
  );
}
