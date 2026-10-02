import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { wordGroups, words } from "../db/schema";

export interface WordGroupDTO {
  id: number;
  name: string;
}

/** 제시어 그룹 목록 — 로비 설정 UI용 */
export function listWordGroups(): WordGroupDTO[] {
  return db
    .select({ id: wordGroups.id, name: wordGroups.name })
    .from(wordGroups)
    .orderBy(asc(wordGroups.sort), asc(wordGroups.id))
    .all();
}

/**
 * 제시어 풀.
 * @param groupId null = 전체 랜덤 (모든 그룹), 그 외 = 해당 그룹만
 */
export function getWordPool(groupId: number | null): string[] {
  const rows =
    groupId === null
      ? db.select({ word: words.word }).from(words).all()
      : db.select({ word: words.word }).from(words).where(eq(words.groupId, groupId)).all();
  return rows.map((r) => r.word);
}
