"use client";

import Link from "next/link";

export function TopNav({ right }: { right?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="mx-auto flex h-17 max-w-7xl items-center justify-between gap-4 px-4 md:px-6 lg:px-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-[19px] font-bold tracking-display"
        >
          <span
            aria-hidden="true"
            className="size-2.5 flex-none rounded-full bg-primary"
          />
          오픈파티룸
        </Link>
        {right ? (
          <div className="flex min-w-0 items-center gap-2.5">{right}</div>
        ) : null}
      </div>
    </header>
  );
}

export function PageFoot() {
  return (
    <footer className="mt-12 border-t border-border py-8">
      <div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-4 px-4 text-sm text-muted-foreground md:px-6 lg:px-10">
        <span>© 2026 오픈파티룸</span>
      </div>
    </footer>
  );
}
