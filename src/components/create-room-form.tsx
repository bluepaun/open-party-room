"use client";

import { useActionState } from "react";
import { createRoom, type RoomActionState } from "@/actions/rooms";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const initial: RoomActionState = {};

export function CreateRoomForm() {
  const [state, formAction, pending] = useActionState(createRoom, initial);

  return (
    <div className="flex flex-col gap-7">
      <Card className="flex items-center gap-3.5 rounded-xl p-3.5">
        <div
          aria-hidden="true"
          className="grid size-14 flex-none place-items-center rounded-[10px] bg-foreground font-mono text-lg font-bold text-background"
        >
          Ly
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-lg font-bold tracking-[-0.01em]">
              라이어 게임
            </span>
            <Badge variant="secondary" className="h-6 px-2.5">
              플레이 가능
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            3명 이상 · 말하기 추리
          </p>
        </div>
      </Card>

      <form action={formAction} className="flex flex-col gap-7">
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">방 이름</Label>
          <Input
            id="name"
            name="name"
            maxLength={20}
            placeholder="예: 금요일 밤 파티"
            autoComplete="off"
            className="h-12 rounded-lg text-base"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="hostName">당신의 이름</Label>
          <Input
            id="hostName"
            name="hostName"
            maxLength={12}
            placeholder="예: 지우"
            autoComplete="off"
            aria-invalid={!!state.error}
            className="h-12 rounded-lg text-base"
          />
        </div>

        {state.error ? (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {state.error}
          </p>
        ) : null}

        <Button
          type="submit"
          size="lg"
          disabled={pending}
          className="h-13 w-full rounded-lg text-base hover:bg-primary-hover"
        >
          {pending ? "만드는 중…" : "방 만들기"}
        </Button>
      </form>
    </div>
  );
}
