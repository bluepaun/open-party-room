import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export const DB_FILE =
  process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "partyroom.db");

type GlobalDb = {
  __prSqlite?: Database.Database;
  __prMigrated?: boolean;
};

function getSqlite() {
  const g = globalThis as typeof globalThis & GlobalDb;
  if (!g.__prSqlite) {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    const sqlite = new Database(DB_FILE);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("busy_timeout = 5000");
    g.__prSqlite = sqlite;
  }
  return g.__prSqlite;
}

/** 이진/모듈 그래프가 여러 개여도 마이그레이션은 한 번만. */
function runMigrations() {
  const g = globalThis as typeof globalThis & GlobalDb;
  if (g.__prMigrated) return;
  g.__prMigrated = true;
  const folder = path.join(process.cwd(), "drizzle");
  if (fs.existsSync(folder)) {
    migrate(drizzle(getSqlite(), { schema }), { migrationsFolder: folder });
  }
}

runMigrations();

export const sqlite = getSqlite();
export const db = drizzle(sqlite, { schema });

export { schema };
