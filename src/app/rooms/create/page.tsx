import type { Metadata } from "next";
import Link from "next/link";
import { TopNav } from "@/components/top-nav";
import { Button } from "@/components/ui/button";
import { CreateRoomForm } from "@/components/create-room-form";

export const metadata: Metadata = {
  title: "방 만들기 · 파티룸",
};

export default async function CreateRoomPage({
  searchParams,
}: {
  searchParams: Promise<{ game?: string }>;
}) {
  const { game } = await searchParams;
  const g = game === "cmy" ? ("cmy" as const) : ("lyar" as const);

  return (
    <>
      <TopNav
        right={
          <Button asChild variant="ghost" className="h-9 px-3 text-base">
            <Link href="/">← 게임 목록</Link>
          </Button>
        }
      />
      <main className="px-4 py-12 md:px-6 lg:px-10 lg:py-24">
        <div className="mx-auto flex w-full max-w-[620px] flex-col">
          <p className="mb-2 text-xs font-semibold tracking-[0.08em] text-muted-foreground">
            MAKE A ROOM · 1 / 3
          </p>
          <h1 className="text-2xl font-bold tracking-display">방 만들기</h1>
          <div className="mt-8">
            <CreateRoomForm game={g} />
          </div>
        </div>
      </main>
    </>
  );
}
