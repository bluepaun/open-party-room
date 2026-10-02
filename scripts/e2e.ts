/**
 * E2E: 3명 소켓 클라이언트로 라이어 게임 한 판 전체를 검증.
 * 실행: npx tsx scripts/e2e.ts   (dev 서버 실행 중일 때)
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { io, type Socket } from "socket.io-client";
import { db } from "../src/lib/db";
import { lyarGames, players, rooms, wordGroups, words } from "../src/lib/db/schema";

const URL = process.env.E2E_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

function check(cond: boolean, label: string, extra?: unknown) {
  if (cond) {
    console.log(`  ✔ ${label}`);
  } else {
    failures++;
    console.error(`  ✘ ${label}`, extra ?? "");
  }
}

interface RoomDTO {
  code: string;
  name: string;
  status: string;
  hostId: string | null;
  players: { id: string; name: string; host: boolean; joinedAt: number }[];
}
interface GameDTO {
  phase: string;
  startedAt: number;
  order: string[];
  explainIndex: number;
  currentTurnPlayerId: string | null;
  turnEndedAt: number | null;
  confirmedCount: number;
  votedCount: number;
  accusedPlayerId: string | null;
  tallyReady: boolean;
  tally: { playerId: string; name: string; count: number }[] | null;
  result: string | null;
  resultReason: string;
  word: string | null;
  guess: string | null;
  liarPlayerId: string;
}
interface Role {
  isLiar: boolean;
  word: string | null;
}

/**
 * 이벤트 버퍼링 클라이언트: 연결 전부터 리스너를 달아
 * connect 직후 서버가 보내는 room:state 등을 놓치지 않는다.
 */
class Client {
  s: Socket;
  room: RoomDTO | null = null;
  game: GameDTO | null = null;
  role: Role | null = null;
  myVote: string | null = null;

  constructor(code: string, playerId: string) {
    this.s = io(URL, {
      auth: { code, playerId },
      transports: ["websocket"],
      reconnection: false,
    });
    this.s.on("room:state", (r: RoomDTO) => (this.room = r));
    this.s.on("game:state", (g: GameDTO) => (this.game = g));
    this.s.on("you:role", (y: Role) => (this.role = y));
    this.s.on("my:vote", (v: { targetId: string }) => (this.myVote = v.targetId));
  }

  connected(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.s.connected) return resolve();
      this.s.once("connect", () => resolve());
      this.s.once("connect_error", reject);
    });
  }

  waitForRoom(pred: (r: RoomDTO) => boolean, timeoutMs = 8000): Promise<RoomDTO> {
    return new Promise((resolve, reject) => {
      if (this.room && pred(this.room)) return resolve(this.room);
      const t = setTimeout(() => reject(new Error(`timeout waiting room: ${pred}`)), timeoutMs);
      const h = (r: RoomDTO) => {
        if (pred(r)) {
          clearTimeout(t);
          this.s.off("room:state", h);
          resolve(r);
        }
      };
      this.s.on("room:state", h);
    });
  }

  waitForGame(pred: (g: GameDTO) => boolean, timeoutMs = 8000): Promise<GameDTO> {
    return new Promise((resolve, reject) => {
      if (this.game && pred(this.game)) return resolve(this.game);
      const t = setTimeout(() => reject(new Error(`timeout waiting game: ${pred}`)), timeoutMs);
      const h = (g: GameDTO) => {
        if (pred(g)) {
          clearTimeout(t);
          this.s.off("game:state", h);
          resolve(g);
        }
      };
      this.s.on("game:state", h);
    });
  }

  waitForRole(timeoutMs = 5000): Promise<Role> {
    return new Promise((resolve, reject) => {
      if (this.role) return resolve(this.role);
      const t = setTimeout(() => reject(new Error("timeout waiting you:role")), timeoutMs);
      this.s.once("you:role", (y: Role) => {
        clearTimeout(t);
        resolve(y);
      });
    });
  }

  ack(event: string): Promise<{ ok: boolean; error?: string }> {
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      this.s.timeout(4000).emit(
        event,
        (err: Error | null, res: { ok: boolean; error?: string }) => {
          resolve(err ? { ok: false, error: "ack error" } : res);
        },
      );
    });
  }
}

async function main() {
  // ── 셋업: 방 + 3명 (DB 직접) ──
  const code = `E2${Math.floor(10 + Math.random() * 90)}`;
  const now = Date.now();
  const p1 = randomUUID(); // host 지우
  const p2 = randomUUID(); // 민준
  const p3 = randomUUID(); // 수진
  db.delete(rooms).where(eq(rooms.code, code)).run();
  db.insert(rooms)
    .values({ code, name: "E2E 방", game: "lyar", hostPlayerId: p1, status: "lobby", createdAt: now })
    .run();
  db.insert(players).values({ id: p1, roomId: code, name: "지우", joinedAt: now + 1 }).run();
  db.insert(players).values({ id: p2, roomId: code, name: "민준", joinedAt: now + 2 }).run();
  db.insert(players).values({ id: p3, roomId: code, name: "수진", joinedAt: now + 3 }).run();
  console.log(`방 ${code} 생성 (host=지우)`);

  // 제시어 그룹 설정: 특정 그룹 → 그 그룹의 단어만 뽑혀야 함
  const grp = db.select().from(wordGroups).orderBy(wordGroups.sort).get()!;
  db.update(rooms).set({ wordGroupId: grp.id }).where(eq(rooms.code, code)).run();
  const grpWords = db
    .select({ word: words.word })
    .from(words)
    .where(eq(words.groupId, grp.id))
    .all()
    .map((r) => r.word);

  const c1 = new Client(code, p1);
  const c2 = new Client(code, p2);
  const c3 = new Client(code, p3);
  await Promise.all([c1.connected(), c2.connected(), c3.connected()]);
  console.log("3명 접속 완료");

  // ── 1. room state 수신 ──
  const r1 = await c1.waitForRoom((r) => r.code === code);
  check(r1.players.length === 3 && r1.hostId === p1, "room:state 3명 + 호스트");

  // ── 2. 게임 시작 (호스트) ──
  const startAck = await c1.ack("game:start");
  check(startAck.ok, "game:start ack ok", startAck);
  const badStart = await c2.ack("game:start");
  check(!badStart.ok, "비호스트 시작 차단", badStart);

  const gReveal = await c1.waitForGame((g) => g.phase === "reveal");
  check(gReveal.phase === "reveal", "phase=reveal");

  const [role1, role2, role3] = await Promise.all([
    c1.waitForRole(),
    c2.waitForRole(),
    c3.waitForRole(),
  ]);
  const liars = [role1, role2, role3].filter((r) => r.isLiar);
  check(liars.length === 1, "라이어 정확히 1명");
  const word = [role1.word, role2.word, role3.word].find(Boolean);
  check(!!word, "시민은 제시어 수신", word);
  check(
    typeof word === "string" && grpWords.includes(word),
    `제시어 그룹 반영 (${grp.name})`,
    word,
  );

  const liarId = role1.isLiar ? p1 : role2.isLiar ? p2 : p3;
  const liarName = liarId === p1 ? "지우" : liarId === p2 ? "민준" : "수진";
  console.log(`  → 라이어: ${liarName}, 제시어: ${word}`);

  // ── 3. reveal 확인 → explain ──
  c1.s.emit("game:confirm");
  c2.s.emit("game:confirm");
  await sleep(50);
  c3.s.emit("game:confirm"); // 마지막 확인 → explain
  const gExplain = await c1.waitForGame((g) => g.phase === "explain");
  check(gExplain.turnEndedAt !== null && gExplain.turnEndedAt > Date.now(), "turnEndedAt 설정");
  check(gExplain.currentTurnPlayerId === gExplain.order[0], "첫 턴 = order[0]");

  // 3명 순서대로 설명 완료 (다른 사람의 explain-done은 무시)
  for (let i = 0; i < 3; i++) {
    const cur = gExplain.order[i];
    const curClient = cur === p1 ? c1 : cur === p2 ? c2 : c3;
    const wrongClient = cur === p1 ? c2 : c1;
    const nextPromise = c1.waitForGame(
      (g) => g.explainIndex > i || g.phase === "vote",
      6000,
    );
    wrongClient.s.emit("game:explain-done"); // 무효 시도
    await sleep(120);
    curClient.s.emit("game:explain-done");
    await nextPromise;
  }
  const gVote = await c1.waitForGame((g) => g.phase === "vote");
  check(gVote.phase === "vote", "phase=vote");
  check(c2.myVote === null && c3.myVote === null, "my:vote는 투표자에게만");

  // ── 4. 투표: 라이어를 2표로 지목 ──
  const others = [p1, p2, p3].filter((id) => id !== liarId);
  const targets: Record<string, string> = {
    [liarId]: others[0],
    [others[0]]: liarId,
    [others[1]]: liarId,
  };
  const clients: Record<string, Client> = { [p1]: c1, [p2]: c2, [p3]: c3 };
  const gTally = c1.waitForGame((g) => g.tallyReady);
  for (const id of [p1, p2, p3]) clients[id].s.emit("game:vote", targets[id]);
  const gTallyResult = await gTally;
  check(gTallyResult.tallyReady, "tallyReady");
  check(gTallyResult.accusedPlayerId === liarId, "라이어가 지목됨 (2표)");
  check(
    gTallyResult.tally?.find((t) => t.playerId === liarId)?.count === 2,
    "tally: 라이어 2표",
    gTallyResult.tally,
  );
  const voter = clients[others[0]];
  check(voter.myVote === liarId, "my:vote 수신 (투표자)");

  // ── 5. next → guess ──
  const gGuess = c1.waitForGame((g) => g.phase === "guess");
  c1.s.emit("game:next");
  await gGuess;
  check(true, "phase=guess");

  // ── 6. guess: 라이어가 정답 → 라이어 승리 ──
  const gResultP = c1.waitForGame((g) => g.phase === "result");
  clients[liarId].s.emit("game:guess", word!);
  const gResult = await gResultP;
  check(gResult.result === "lyar", "결과: 라이어 승리");
  check(gResult.word === word, "결과: 제시어 공개", gResult.word);
  check(gResult.resultReason.includes("맞혔어요"), "결과 메시지", gResult.resultReason);

  const dbGame = db.select().from(lyarGames).where(eq(lyarGames.roomId, code)).get();
  check(dbGame?.phase === "result" && dbGame?.result === "lyar", "DB: result 저장");

  // ── 7. 새 라운드 (호스트) ──
  const nrAck = await c1.ack("game:new-round");
  check(nrAck.ok, "new-round ack ok", nrAck);
  const gNew = await c1.waitForGame((g) => g.phase === "reveal" && g.startedAt > gResult.startedAt);
  check(gNew.phase === "reveal", "새 라운드 reveal");

  // ── 8. sweep: turnEndedAt 과거로 → 턴 자동 진행 ──
  c1.s.emit("game:confirm");
  c2.s.emit("game:confirm");
  c3.s.emit("game:confirm");
  await c1.waitForGame((g) => g.phase === "explain" && g.explainIndex === 0);
  db.update(lyarGames)
    .set({ turnEndedAt: Date.now() - 1000 })
    .where(eq(lyarGames.roomId, code))
    .run();
  const gAdvanced = await c1.waitForGame((g) => g.explainIndex === 1, 10000);
  check(gAdvanced.explainIndex === 1, "sweep: 턴 자동 진행");

  // ── 8b. 2라운드 설명 완료 (턴 1, 2) ──
  for (let i = 1; i < 3; i++) {
    const cur = gAdvanced.order[i];
    const curClient = cur === p1 ? c1 : cur === p2 ? c2 : c3;
    const nextPromise = c1.waitForGame(
      (g) => g.explainIndex > i || g.phase === "vote",
      6000,
    );
    curClient.s.emit("game:explain-done");
    await nextPromise;
  }
  await c1.waitForGame((g) => g.phase === "vote");

  // ── 8c. 2라운드 투표: 라이어 아닌 사람 지목 → 규칙 5 (라이어 승리) ──
  const dbGame2nd = db.select().from(lyarGames).where(eq(lyarGames.roomId, code)).get();
  const liar2 = dbGame2nd!.liarPlayerId;
  const nonLiar = [p1, p2, p3].find((id) => id !== liar2)!;
  const gTally2 = c1.waitForGame((g) => g.tallyReady);
  for (const id of [p1, p2, p3]) {
    // 비자기투표 금지: nonLiar 본인은 라이어를 지목
    clients[id].s.emit("game:vote", id === nonLiar ? liar2 : nonLiar);
  }
  const gTally2State = await gTally2;
  check(
    gTally2State.accusedPlayerId === nonLiar,
    "2라운드: 라이어 아닌 사람 지목",
    JSON.stringify({ accused: gTally2State.accusedPlayerId, tally: gTally2State.tally }),
  );
  const gRes2 = c1.waitForGame((g) => g.phase === "result");
  c1.s.emit("game:next");
  const gResult2 = await gRes2;
  check(gResult2.result === "lyar", "2라운드: 탈출 → 라이어 승리 (규칙 5)", gResult2);
  check(gResult2.resultReason.includes("무사히"), "2라운드: 결과 메시지", gResult2.resultReason);
  check(gResult2.guess === null, "2라운드: guess 단계 생략");

  // ── 9. 게임 중 이탈 → 라운드 초기화 (3라운드 reveal, grace 5s) ──
  const nrAck2 = await c1.ack("game:new-round");
  check(nrAck2.ok, "3라운드 시작");
  await c1.waitForGame((g) => g.phase === "reveal");
  c2.s.disconnect();
  const rLobby = await c1.waitForRoom((r) => r.status === "lobby", 15000);
  check(rLobby.players.length === 2, "이탈자 제거 broadcast");
  const dbRoom = db.select().from(rooms).where(eq(rooms.code, code)).get();
  check(dbRoom?.status === "lobby", "DB: room → lobby");
  check(
    db.select().from(players).where(eq(players.roomId, code)).all().length === 2,
    "DB: 이탈자 제거",
  );
  const dbGame2 = db.select().from(lyarGames).where(eq(lyarGames.roomId, code)).get();
  check(!dbGame2, "DB: game 삭제");

  // ── 10. 재접속 차단 확인 (이탈한 플레이어) ──
  const c4 = new Client(code, p2);
  const reAuth = await c4
    .connected()
    .then(() => "connected")
    .catch((e: Error) => e.message);
  check(reAuth === "player not found", "이탈 플레이어 재접속 차단", reAuth);

  c1.s.disconnect();
  c3.s.disconnect();
  c4.s.disconnect();
  db.delete(rooms).where(eq(rooms.code, code)).run();

  console.log(failures === 0 ? "\n✅ ALL PASSED" : `\n❌ ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("E2E error:", e);
  process.exit(1);
});
