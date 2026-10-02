"use client";

import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import { joinRoom, type RoomActionState } from "@/actions/rooms";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: RoomActionState = {};

export function JoinRoomForm() {
  const params = useSearchParams();
  const prefillCode = (params.get("code") ?? "").toUpperCase();
  const [state, formAction, pending] = useActionState(joinRoom, initial);
  const [code, setCode] = useState(prefillCode);

  return (
    <Card className="rounded-xl p-6">
      <form action={formAction} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="code">방 코드</Label>
          <Input
            id="code"
            name="code"
            maxLength={4}
            placeholder="····"
            autoComplete="off"
            aria-label="방 코드 4자리"
            value={code}
            onChange={(e) =>
              setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                document.getElementById("join-name")?.focus();
              }
            }}
            className="h-12 rounded-lg text-center font-mono text-3xl font-bold tracking-[0.24em] uppercase"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="join-name">이름</Label>
          <Input
            id="join-name"
            name="name"
            maxLength={12}
            placeholder="예: 민준"
            autoComplete="off"
            aria-label="이름"
            aria-invalid={!!state.error}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                document.getElementById("join-submit")?.click();
              }
            }}
            className="h-12 rounded-lg text-base"
          />
        </div>

        {state.error ? (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {state.error}
          </p>
        ) : null}

        <Button
          id="join-submit"
          type="submit"
          size="lg"
          disabled={pending}
          className="h-13 w-full rounded-lg text-base hover:bg-primary-hover"
        >
          {pending ? "참여 중…" : "방에 참여"}
        </Button>
      </form>
    </Card>
  );
}
