/**
 * 시드 스크립트: "한국 유명인" / "해외 유명인" 제시어 그룹 추가 (각 50명).
 * 멱등: 이미 존재하는 그룹·단어는 건너뜀 (단어는 전역 UNIQUE).
 * 실행: npx tsx scripts/seed_celebrity_words.ts
 */
import path from "node:path";
import Database from "better-sqlite3";

const DB_FILE = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "partyroom.db");
const sqlite = new Database(DB_FILE);
sqlite.pragma("foreign_keys = ON");

const newGroups: { name: string; sort: number; words: string[] }[] = [
  {
    name: "한국 유명인",
    sort: 11,
    words: [
      // 스포츠 (6)
      "손흥민", "박지성", "김다비", "최현준", "이영주", "황인선",
      // 예능·코미디 (7)
      "유재석", "이지혜", "신동엽", "홍진영", "이국주", "이정형", "강호동",
      // 가수 (13)
      "비", "제이 파크", "아이유", "싸이", "리사", "지드래곤", "보아",
      "신승훈", "김종국", "신애라", "이승기", "아이브", "아이티제이",
      // 배우 (21)
      "김태희", "배용준", "장동건", "소지섭", "하정우", "손예진", "공유",
      "수지", "김수현", "이민호", "정해인", "한소희", "박보검", "김유정",
      "박신혜", "김지원", "문채원", "장근석", "류준열", "송지효", "김희선",
      // 기타 (3)
      "이수만", "정유미", "김희연",
    ],
  },
  {
    name: "해외 유명인",
    sort: 12,
    words: [
      // 기업·인물 (7)
      "스티브 잡스", "일론 머스크", "버락 오바마", "빌 게이츠",
      "마크 저커버그", "월트 디즈니", "알베르트 아인슈타인",
      // 가수 (13)
      "테일러 스위프트", "비욘세", "레이디 가가", "마이클 잭슨", "마돈나",
      "엘비스 프레슬리", "프리디 머큐리", "밥 말리", "아델", "에드 시런",
      "저스틴 비버", "해리 스타일즈", "코트니 코즈",
      // 배우 (23)
      "브래드 핏", "레오나르도 디카프리오", "톰 크루즈", "윌 스미스",
      "더웨인 존슨", "아널드 슈워제네거", "실베스터 스탬로네", "알 파치노",
      "메릴 스트립", "줄리아 로버츠", "안젤리나 졸리", "톰 행크스",
      "크리스 에반스", "로버트 다우니 주니어", "크리스 헴스워스", "톰 홀랜드",
      "에마 왓슨", "대니얼 레드클리프", "크리스 프랫", "라이언 레이놀즈",
      "조니 뎁", "오드리 헵번", "마릴린 먼로",
      // 스포츠 (7)
      "크리스티아누 호날두", "리오넬 메시", "세레나 윌리엄스", "마이클 조던",
      "레브론 제임스", "타이거 우즈", "유세인 볼트",
    ],
  },
];

let groupAdded = 0;
let wordAdded = 0;
for (const g of newGroups) {
  const existing = sqlite
    .prepare("SELECT id FROM word_groups WHERE name = ?")
    .get(g.name) as { id: number } | undefined;
  let groupId: number;
  if (existing) {
    groupId = existing.id;
  } else {
    const res = sqlite.prepare("INSERT INTO word_groups (name, sort) VALUES (?, ?)").run(g.name, g.sort);
    groupId = Number(res.lastInsertRowid);
    groupAdded++;
  }
  const before = sqlite.prepare("SELECT count(*) c FROM words WHERE group_id = ?").get(groupId) as { c: number };
  for (const w of g.words) {
    sqlite.prepare("INSERT OR IGNORE INTO words (group_id, word) VALUES (?, ?)").run(groupId, w);
  }
  const after = sqlite.prepare("SELECT count(*) c FROM words WHERE group_id = ?").get(groupId) as { c: number };
  wordAdded += after.c - before.c;
  console.log(`${g.name}: id=${groupId} 단어 ${after.c}개 (신규 ${after.c - before.c})`);
}
console.log(`완료: 신규 그룹 ${groupAdded}개, 신규 단어 ${wordAdded}개`);
sqlite.close();
