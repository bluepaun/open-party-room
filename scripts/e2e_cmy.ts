/**
 * E2E: 양세찬 게임(콜 마이 네임) 소켓 시나리오.
 * 1) hand + random + 타이머 OFF + 2인: 추정 전용 (오답→턴 상실, 정답→등수) → 결과 → 한 판 더
 * 2) forehead + master + 3인(참가 2 + 출제자): setup → 공개(카운트다운) → '정답' 확인 → 결과
 * 3) master 모드 2인 시작 차단
 * 실행: PORT=3030 npx tsx scripts/e2e_cmy.ts  (dev 서버 실행 중일 때)
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { io, type Socket } from "socket.io-client";
import { db } from "../src/lib/db";
import { cmyGames, players, rooms } from "../src/lib/db/schema";

const URL = process.env.E2E_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
let failures = 0;

function check(cond: boolean, label: string, extra?: unknown) {
  if (cond) {
    console.log(`  ✔ ${label}`);
  } else {
    failures++;
    console.error(`  ✘ ${label}`, extra ?? "");
  }
}

interface CmyState {
  phase: string;
  startedAt: number;
  mode: string;
  wordSource: string;
  timerOn: boolean;
  roundDeadline: number | null;
  masterPlayerId: string | null;
  turnPlayerId: string | null;
  stepDeadline: number | null;
  players: {
    id: string;
    name: string;
    host: boolean;
    solved: boolean;
    rank: number | null;
    word: string | null;
  }[];
  solvedCount: number;
  totalCount: number;
  ranking: {
    playerId: string;
    name: string;
    word: string;
    solved: boolean;
    rank: number | null;
  }[] | null;
  setupTargets: { playerId: string; name: string }[] | null;
}
interface CmyYou {
  ownWord: string | null;
  othersWords: Record<string, string>;
  isMaster: boolean;
}
interface CmyMyGuess {
  ok: boolean;
  rank: number | null;
  stamp: number;
}

class Client {
  s: Socket;
  pid: string;
  state: CmyState | null = null;
  you: CmyYou | null = null;
  myGuess: CmyMyGuess | null = null;

  constructor(code: string, playerId: string) {
    this.pid = playerId;
    this.s = io(URL, {
      auth: { code, playerId },
      transports: ["websocket"],
      reconnection: false,
    });
    this.s.on("cmy:state", (g: CmyState) => (this.state = g));
    this.s.on("you:cmy-view", (v: CmyYou) => (this.you = v));
    this.s.on("my:cmy-guess", (g: CmyMyGuess) => (this.myGuess = g));
  }

  connected(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.s.connected) return resolve();
      this.s.once("connect", () => resolve());
      this.s.once("connect_error", reject);
    });
  }

  waitState(pred: (g: CmyState) => boolean, timeoutMs = 8000): Promise<CmyState> {
    return new Promise((resolve, reject) => {
      if (this.state && pred(this.state)) return resolve(this.state);
      const t = setTimeout(
        () => reject(new Error("timeout waiting cmy:state")),
        timeoutMs,
      );
      const h = (g: CmyState) => {
        if (pred(g)) {
          clearTimeout(t);
          this.s.off("cmy:state", h);
          resolve(g);
        }
      };
      this.s.on("cmy:state", h);
    });
  }

  waitMyGuess(
    pred: (g: CmyMyGuess) => boolean,
    timeoutMs = 8000,
    sinceStamp = 0,
  ): Promise<CmyMyGuess> {
    return new Promise((resolve, reject) => {
      if (this.myGuess && this.myGuess.stamp > sinceStamp && pred(this.myGuess)) {
        return resolve(this.myGuess);
      }
      const t = setTimeout(
        () => reject(new Error("timeout waiting my:cmy-guess")),
        timeoutMs,
      );
      const h = (g: CmyMyGuess) => {
        if (g.stamp > sinceStamp && pred(g)) {
          clearTimeout(t);
          this.s.off("my:cmy-guess", h);
          resolve(g);
        }
      };
      this.s.on("my:cmy-guess", h);
    });
  }

  waitYou(pred: (v: CmyYou) => boolean, timeoutMs = 8000): Promise<CmyYou> {
    return new Promise((resolve, reject) => {
      if (this.you && pred(this.you)) return resolve(this.you);
      const t = setTimeout(
        () => reject(new Error("timeout waiting you:cmy-view")),
        timeoutMs,
      );
      const h = (v: CmyYou) => {
        if (pred(v)) {
          clearTimeout(t);
          this.s.off("you:cmy-view", h);
          resolve(v);
        }
      };
      this.s.on("you:cmy-view", h);
    });
  }

  ack(event: string, payload?: unknown): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      if (payload === undefined) {
        this.s.timeout(4000).emit(event, (err: Error | null, res: { ok: boolean; error?: string }) => {
          resolve(err ? { ok: false, error: "ack error" } : res);
        });
      } else {
        this.s.timeout(4000).emit(event, payload, (err: Error | null, res: { ok: boolean; error?: string }) => {
          resolve(err ? { ok: false, error: "ack error" } : res);
        });
      }
    });
  }

  /** forehead: '정답' 버튼 */
  confirm() {
    this.s.emit("cmy:confirm");
  }

  sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

function makeRoom(
  code: string,
  opts: {
    game: string;
    host: string;
    players: { id: string; name: string }[];
    cmyMode?: string;
    cmyWordSource?: string;
    cmyMasterPlayerId?: string;
    cmyTimer?: string;
  },
) {
  const now = Date.now();
  db.delete(rooms).where(eq(rooms.code, code)).run();
  db.insert(rooms)
    .values({
      code,
      name: "E2E CMy",
      game: opts.game,
      hostPlayerId: opts.host,
      status: "lobby",
      createdAt: now,
      cmyMode: opts.cmyMode ?? "forehead",
      cmyWordSource: opts.cmyWordSource ?? "random",
      cmyMasterPlayerId: opts.cmyMasterPlayerId ?? null,
      cmyTimer: opts.cmyTimer ?? "off",
    })
    .run();
  opts.players.forEach((p, i) =>
    db.insert(players)
      .values({ id: p.id, roomId: code, name: p.name, joinedAt: now + i + 1 })
      .run(),
  );
}

/** 턴 플레이어의 추정 — 오답 시 질문 기회 상실(턴 넘김) */
async function doGuess(c: Client, word: string, expectOk: boolean, expectRank?: number, label = "") {
  const lastStamp = c.myGuess?.stamp ?? 0;
  c.s.emit("cmy:guess", word);
  const g = await c.waitMyGuess((x) => (expectOk ? x.ok : !x.ok), 8000, lastStamp);
  check(
    expectOk ? g.ok && g.rank === expectRank : !g.ok,
    `${label}: ${expectOk ? `정답 추정 → rank=${g.rank}` : "오답 → ok=false"}`,
  );
  return g;
}

async function main() {
  /* ══ 시나리오 1: hand + random + timer OFF + 2인 ══ */
  console.log("\n[1] hand + random + 타이머 OFF + 2인");
  const code1 = "C1E2";
  const a = randomUUID();
  const b = randomUUID();
  makeRoom(code1, {
    game: "cmy",
    host: a,
    players: [
      { id: a, name: "지우" },
      { id: b, name: "민준" },
    ],
    cmyMode: "hand",
    cmyWordSource: "random",
    cmyTimer: "off",
  });
  const ca = new Client(code1, a);
  const cb = new Client(code1, b);
  await ca.connected();
  await cb.connected();
  check(true, "2인 연결");

  const startRes = await ca.ack("game:start");
  check(startRes.ok, "호스트 시작 OK");

  await ca.waitState((g) => g.phase === "play");
  await cb.waitState((g) => g.phase === "play");
  check(ca.state!.mode === "hand", "모드: hand");
  check(ca.state!.timerOn === false && ca.state!.roundDeadline === null, "타이머 OFF");

  const row = db.select().from(cmyGames).where(eq(cmyGames.roomId, code1)).get()!;
  const wordA = row.words[a];
  const wordB = row.words[b];
  check(!!wordA && !!wordB, `단어 배정: A="${wordA}" B="${wordB}"`);

  // 개인화: 손 모드는 타인 단어만 (ownWord 없음)
  const youA = await ca.waitYou((v) => !v.isMaster);
  const youB = await cb.waitYou((v) => !v.isMaster);
  check(youA.othersWords[b] === wordB, "A는 B의 단어를 봄 (hand 카드)");
  check(!youA.othersWords[a] && youA.ownWord === null, "A: 본인 단어 없음 (ownWord null)");
  check(youB.othersWords[a] === wordA, "B는 A의 단어를 봄");

  const first = ca.state!.turnPlayerId;
  const second = first === a ? b : a;
  const firstC = first === a ? ca : cb;
  const secondC = first === a ? cb : ca;
  const firstWord = first === a ? wordA : wordB;
  const secondWord = second === a ? wordA : wordB;

  // 1) 비턴 추정 무시
  const staleStampB = secondC.myGuess?.stamp ?? 0;
  secondC.s.emit("cmy:guess", "없는단어_xyz");
  await secondC.sleep(600);
  check(
    secondC.myGuess === null || secondC.myGuess.stamp === staleStampB,
    "비턴 플레이어의 추정 무시 (신규 이벤트 없음)",
  );

  // 2) 비턴 패스 무시
  secondC.s.emit("cmy:pass");
  await secondC.sleep(500);
  check(secondC.state!.turnPlayerId === first, "비턴 플레이어의 턴 넘기기 무시");

  // 3) first: 턴 넘기기(패스) → 턴 second
  firstC.s.emit("cmy:pass");
  await secondC.waitState((g) => g.turnPlayerId === second);
  check(secondC.state!.turnPlayerId === second, "턴 넘기기 → 턴 second");

  // 4) second: 오답 → 질문 기회 상실 (턴 first)
  await doGuess(secondC, "없는단어_xyz", false, undefined, "턴1 오답");
  await firstC.waitState((g) => g.turnPlayerId === first);
  check(firstC.state!.turnPlayerId === first, "턴1: 오답 → 질문 기회 상실 (턴 first)");

  // 5) hand 모드에서는 '정답' 확인 버튼 무시
  firstC.confirm();
  await firstC.sleep(500);
  check(firstC.state!.solvedCount === 0, "hand 모드: cmy:confirm 무시");

  // 6) first: 정답 추정 rank1 → 턴 second
  await doGuess(firstC, firstWord, true, 1, "턴2");
  await firstC.waitState((g) => g.solvedCount === 1);
  check(firstC.state!.solvedCount === 1, "턴2: 추정 성공 → solvedCount=1");
  await secondC.waitState((g) => g.turnPlayerId === second);
  check(secondC.state!.turnPlayerId === second, "턴3: 턴 second (first 해결)");

  // 7) second: 정답 추정 rank2 → 전원 해결
  await doGuess(secondC, secondWord, true, 2, "턴3");

  const result1 = await ca.waitState((g) => g.phase === "result");
  check(result1.phase === "result", "전원 해결 → 결과");
  check(
    result1.ranking?.[0].playerId === first && result1.ranking?.[0].rank === 1,
    "1위 = first (먼저 맞춤)",
  );
  check(
    result1.ranking?.[1].playerId === second && result1.ranking?.[1].rank === 2,
    "2위 = second",
  );
  check(
    result1.players.find((x) => x.id === a)?.word === wordA,
    "결과에서 단어 공개",
  );

  // 한 판 더: 단어 재사용 방지 (usedWords)
  const nr = await ca.ack("game:new-round");
  check(nr.ok, "한 판 더 OK");
  await ca.waitState((g) => g.phase === "play" && g.startedAt !== result1.startedAt);
  const row2 = db.select().from(cmyGames).where(eq(cmyGames.roomId, code1)).get()!;
  check(
    row2.words[a] !== wordA || row2.words[b] !== wordB,
    "새 판: 사용된 단어 재사용 방지",
  );
  ca.s.disconnect();
  cb.s.disconnect();

  /* ══ 시나리오 2: forehead + master + 3인 (참가 2 + 출제자) ══ */
  console.log("\n[2] forehead + master + 3인 (참가 2 + 출제자)");
  const code2 = "C2E2";
  const m = randomUUID(); // 출제자 = 호스트
  const p = randomUUID();
  const q = randomUUID();
  makeRoom(code2, {
    game: "cmy",
    host: m,
    players: [
      { id: m, name: "수진" },
      { id: p, name: "준서" },
      { id: q, name: "하은" },
    ],
    cmyMode: "forehead",
    cmyWordSource: "master",
    cmyMasterPlayerId: m,
    cmyTimer: "off",
  });
  const cm = new Client(code2, m);
  const cp = new Client(code2, p);
  const cq = new Client(code2, q);
  await cm.connected();
  await cp.connected();
  await cq.connected();

  const s2res = await cm.ack("game:start");
  check(s2res.ok, "호스트(출제자) 시작 OK");

  await cm.waitState((g) => g.phase === "setup");
  await cp.waitState((g) => g.phase === "setup");
  check(cm.state!.setupTargets?.length === 2, "setup: 대상 2명 (출제자 제외)");
  check(cm.state!.players.length === 2, "플레이어 목록: 참가자만 (출제자 제외)");
  check(cp.you === null, "setup: 참가자에게 개인화 뷰 없음");

  // 제출 검증: 누락
  let sub = await cm.ack("cmy:master-submit", { [p]: "피자" });
  check(!sub.ok, "제출 검증: 단어 누락 시 실패");
  // 중복
  sub = await cm.ack("cmy:master-submit", { [p]: "피자", [q]: "피자" });
  check(!sub.ok, "제출 검증: 중복 단어 시 실패");
  // 정상
  sub = await cm.ack("cmy:master-submit", { [p]: "피자", [q]: "고래" });
  check(sub.ok, "제출 정상 → play");

  await cp.waitState((g) => g.phase === "play");
  check(cm.state!.mode === "forehead", "모드: forehead");
  check(cm.state!.turnPlayerId === null, "forehead: 턴 없음 (turnPlayerId null)");

  // 개인화: 참가자는 내 단어(ownWord) + 타인 단어, 출제자는 전원
  const youM = await cm.waitYou((v) => v.isMaster);
  check(
    youM.isMaster === true &&
      youM.ownWord === null &&
      youM.othersWords[p] === "피자" &&
      youM.othersWords[q] === "고래",
    "출제자: 전 단어 뷰 (심판, ownWord 없음)",
  );
  const youP = await cp.waitYou((v) => v.ownWord === "피자");
  check(youP.othersWords[q] === "고래" && !youP.othersWords[p], "참가 P: ownWord=피자 + Q 단어만");
  const youQ = await cq.waitYou((v) => v.ownWord === "고래");
  check(youQ.othersWords[p] === "피자" && !youQ.othersWords[q], "참가 Q: ownWord=고래 + P 단어만");

  // 카운트다운(10초) 종료 전 확인 불가
  cp.confirm();
  await cm.waitState((g) => g.phase === "play");
  await cm.sleep(300);
  check(cm.state!.solvedCount === 0, "공개(카운트다운) 전 '정답' 확인 무시");

  // 10초 카운트다운 대기 후 확인: P → 1위, Q → 2위 (출제자 확인은 무시)
  await cm.sleep(10500);
  cp.confirm();
  await cm.waitState((g) => g.solvedCount === 1);
  check(cm.state!.solvedCount === 1, "P 확인 → 1위");
  cm.confirm();
  await cm.sleep(300);
  check(cm.state!.solvedCount === 1, "출제자의 확인 무시");
  cq.confirm();
  const result2 = await cm.waitState((g) => g.phase === "result");
  check(result2.phase === "result", "전원 확인 → 결과");
  check(
    result2.ranking?.[0].playerId === p && result2.ranking?.[0].rank === 1,
    "1위 = P (먼저 확인)",
  );
  check(
    result2.ranking?.[1].playerId === q && result2.ranking?.[1].rank === 2,
    "2위 = Q",
  );
  check(result2.ranking?.every((r) => r.solved) === true, "등수: 전원 solved");
  cm.s.disconnect();
  cp.s.disconnect();
  cq.s.disconnect();

  /* ══ 시나리오 3: master 모드 2인 시작 차단 ══ */
  console.log("\n[3] master 모드 2인 시작 차단");
  const code3 = "C3E2";
  const m3 = randomUUID();
  const p3 = randomUUID();
  makeRoom(code3, {
    game: "cmy",
    host: m3,
    players: [
      { id: m3, name: "호" },
      { id: p3, name: "참" },
    ],
    cmyWordSource: "master",
    cmyMasterPlayerId: m3,
  });
  const cm3 = new Client(code3, m3);
  const cp3 = new Client(code3, p3);
  await cm3.connected();
  await cp3.connected();
  const res3 = await cm3.ack("game:start");
  check(!res3.ok && (res3.error?.includes("3명") ?? false), `2인 master 시작 차단: "${res3.error}"`);
  cm3.s.disconnect();
  cp3.s.disconnect();

  /* 정리 */
  db.delete(rooms).where(eq(rooms.code, code1)).run();
  db.delete(rooms).where(eq(rooms.code, code2)).run();
  db.delete(rooms).where(eq(rooms.code, code3)).run();

  console.log(failures === 0 ? "\n✅ CMy E2E ALL PASSED" : `\n❌ ${failures} failures`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
