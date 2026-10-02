import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { rooms } from "@/lib/db/schema";
import { listWordGroups } from "@/lib/game/words";
import { RoomClient } from "@/components/room/room-client";

const COOKIE = "partyroom.me";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const normCode = code.toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(normCode)) notFound();

  const room = db.select().from(rooms).where(eq(rooms.code, normCode)).get();
  if (!room) notFound();

  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  let me: { id: string; name: string } | null = null;
  if (raw) {
    try {
      const data = JSON.parse(raw) as Record<string, { id: string; name: string }>;
      me = data[normCode] ?? null;
    } catch {
      me = null;
    }
  }

  if (!me) redirect(`/join?code=${normCode}`);

  return (
    <RoomClient
      code={normCode}
      playerId={me.id}
      name={me.name}
      wordGroups={listWordGroups()}
    />
  );
}
