import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TopNav, PageFoot } from "@/components/top-nav";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <TopNav />
      <main className="flex flex-1 items-center justify-center px-4 py-24">
        <div className="text-center">
          <p
            aria-hidden="true"
            className="font-mono text-[88px] font-bold leading-none tracking-display"
          >
            <span className="text-border">4</span>
            <span className="text-primary">0</span>
            <span className="text-border">4</span>
          </p>
          <h1 className="mt-7 text-2xl font-bold tracking-display">
            페이지를 찾을 수 없어요
          </h1>
          <p className="mt-2.5 text-sm text-muted-foreground">
            이 주소는 존재하지 않거나 이동되었어요.
          </p>
          <Button
            asChild
            className="mt-8 h-13 w-full max-w-xs rounded-lg text-base hover:bg-primary-hover"
          >
            <Link href="/">게임 목록으로</Link>
          </Button>
        </div>
      </main>
      <PageFoot />
    </div>
  );
}
