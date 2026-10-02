/**
 * E2E: 양세찬 게임(콜 마이 네임) 소켓 시나리오.
 * 1) hand + random + 타이머 OFF + 2인: 질문→답변→추정 → 결과 → 한 판 더(단어 재사용 방지)
 * 2) forehead + master + 3인(참가 2 + 출제자): setup 검증 → 플레이 → 결과
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

interface CmyQuestion {
  text: string;
  askedBy: string;
  answers: Record<string, string>;
  answered: number;
  total: number;
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
  turnStep: string | null;
  stepDeadline: number | null;
  question: CmyQuestion | null;
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

/** 턴 플레이어가 질문 → 상대 답변 → 턴 이동 확인 → 턴 플레이어 추정 */
async function askAndGuess(
  asker: Client,
  answerer: Client,
  word: string,
  label: string,
) {
  asker.s.emit("cmy:ask", "저는 사람인가요?");
  await asker.waitState((g) => g.question?.text === "저는 사람인가요?" && g.question.askedBy === g.turnPlayerId);
  check(true, `${label}: 질문 수신 (askedBy=턴 플레이어)`);

  const lastStamp = asker.myGuess?.stamp ?? 0;

  answerer.s.emit("cmy:answer", "yes");
  await asker.waitState((g) => g.question === null);
  check(true, `${label}: 답변 완료 → 턴 이동`);

  // 오답 시도 (페널티 없어야 함 — 상태 불변)
  const before = asker.state!;
  asker.s.emit("cmy:guess", "없는 단어_xyz");
  const wrong = await asker.waitMyGuess((g) => !g.ok, 8000, lastStamp);
  check(wrong.ok === false, `${label}: 오답 → my:cmy-guess ok=false`);
  const after = asker.state!;
  check(
    after.turnPlayerId === before.turnPlayerId && after.solvedCount === before.solvedCount,
    `${label}: 오답 후 상태 불변 (페널티 없음)`,
  );

  asker.s.emit("cmy:guess", word);
  const ok = await asker.waitMyGuess((g) => g.ok, 8000, lastStamp);
  check(ok.ok && ok.rank !== null, `${label}: 정답 추정 → rank=${ok.rank}`);
  await asker.waitState((g) => g.players.find((p) => p.id === asker.pid)?.solved === true);
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

  // 개인화: 서로의 단어만 보이고 본인 것은 안 보임
  const youA = await ca.waitYou((v) => !v.isMaster);
  const youB = await cb.waitYou((v) => !v.isMaster);
  check(youA.othersWords[b] === wordB, "A는 B의 단어를 봄 (hand 카드)");
  check(!youA.othersWords[a], "A는 본인의 단어를 못 봄");
  check(youB.othersWords[a] === wordA, "B는 A의 단어를 봄");

  // 1턴: 턴 플레이어 질문 → 상대 답변 → 추정
  const first = ca.state!.turnPlayerId;
  const second = first === a ? b : a;
  const firstC = first === a ? ca : cb;
  const secondC = first === a ? cb : ca;
  const firstWord = first === a ? wordA : wordB;

  await askAndGuess(firstC, secondC, firstWord, "턴1");
  const s1 = firstC.state!;
  check(s1.solvedCount === 1, "턴1 추정 성공 → solvedCount=1");

  // 턴이 second로 이동했는지
  await secondC.waitState((g) => g.turnPlayerId === second);
  check(secondC.state!.turnPlayerId === second, "턴 이동 → 2번째 플레이어");

  // 2턴: second 질문 (이미 solved된 first도 답변 가능) → second 추정 → 전원 해결 → result
  const secondWord = second === a ? wordA : wordB;
  await askAndGuess(secondC, firstC, secondWord, "턴2");

  const result1 = await ca.waitState((g) => g.phase === "result");
  check(result1.phase === "result", "전원 해결 → 결과");
  check(
    result1.ranking?.[0].playerId === first && result1.ranking?.[0].rank === 1,
    "1위 = 먼저 맞춘 플레이어",
  );
  check(result1.ranking?.[1].rank === 2, "2위 = 두 번째 플레이어");
  check(
    result1.players.find((p) => p.id === a)?.word === wordA,
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
  // 출제자는 전 단어 확인, 참가자는 타인 단어만
  const youM = await cm.waitYou((v) => v.isMaster);
  check(
    youM.isMaster === true && youM.othersWords[p] === "피자" && youM.othersWords[q] === "고래",
    "출제자: 전 단어 뷰 (심판)",
  );
  const youP = await cp.waitYou((v) => !v.isMaster);
  check(youP.othersWords[q] === "고래" && !youP.othersWords[p], "참가 P: Q 단어만");
  const youQ = await cq.waitYou((v) => !v.isMaster);
  check(youQ.othersWords[p] === "피자" && !youQ.othersWords[q], "참가 Q: P 단어만");

  // 출제자는 답변 불가
  const turn2 = cm.state!.turnPlayerId;
  const turnC = turn2 === p ? cp : cq;
  const otherC = turn2 === p ? cq : cp;
  turnC.s.emit("cmy:ask", "저는 동물이나요?");
  await cm.waitState((g) => g.question?.text === "저는 동물이나요?");
  cm.s.emit("cmy:answer", "yes");
  await new Promise((r) => setTimeout(r, 400));
  check(!cm.state!.question?.answers[m], "출제자의 답변은 무시됨");

  // 참가자 답변 → 턴 이동
  otherC.s.emit("cmy:answer", "no");
  await cm.waitState((g) => g.question === null);
  check(true, "참가자 답변 → 턴 이동");

  // 추정: 턴 순서대로 전원 해결 → result
  // 현재 턴 플레이어 추정
  const t2 = cm.state!.turnPlayerId!;
  const t2C = t2 === p ? cp : cq;
  const t2OtherC = t2 === p ? cq : cp;
  const t2Word = t2 === p ? "피자" : "고래";
  t2C.s.emit("cmy:guess", t2Word);
  await t2C.waitMyGuess((g) => g.ok);
  await t2C.waitState((g) => g.solvedCount === 1);
  check(t2C.state!.solvedCount === 1, "참가자 추정 성공");

  // 나머지 참가자: 턴 → 질문 → (solved인 상대도 답변) → 추정
  const t3 = t2C.state!.turnPlayerId!;
  const t3C = t3 === p ? cp : cq;
  const t3OtherC = t3 === p ? cq : cp;
  const t3Word = t3 === p ? "피자" : "고래";
  t3C.s.emit("cmy:ask", "저는 바다에 있나요?");
  await t3C.waitState((g) => g.question?.text === "저는 바다에 있나요?");
  t3OtherC.s.emit("cmy:answer", "yes");
  await t3C.waitState((g) => g.question === null);
  t3C.s.emit("cmy:guess", t3Word);
  await t3C.waitMyGuess((g) => g.ok);

  const result2 = await cm.waitState((g) => g.phase === "result");
  check(result2.phase === "result", "모두 해결 → 결과");
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
