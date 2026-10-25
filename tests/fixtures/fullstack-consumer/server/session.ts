import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { MemorySessionStore, SessionManager, SqlSessionStore } from "@meekojs/meeko/server";
import type { SqlSessionDriver, SqlSessionRow } from "@meekojs/meeko/server";

export function createSessionManager(production: boolean) {
  if (!production) return new SessionManager({ store: new MemorySessionStore<{ user: string }>(), production: false, secure: false });
  const directory = resolve(".meeko/output");
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(resolve(directory, "sessions.sqlite"));
  db.exec("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, familyId TEXT, csrfToken TEXT NOT NULL, dataJson TEXT NOT NULL, createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL)");
  const columns = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "familyId")) db.exec("ALTER TABLE sessions ADD COLUMN familyId TEXT");
  db.exec("UPDATE sessions SET familyId = id WHERE familyId IS NULL");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS sessions_family ON sessions(familyId)");
  const read = db.prepare("SELECT id, familyId, csrfToken, dataJson, createdAt, expiresAt FROM sessions WHERE id = ?");
  const write = db.prepare("INSERT OR REPLACE INTO sessions (id, familyId, csrfToken, dataJson, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)");
  const remove = db.prepare("DELETE FROM sessions WHERE id = ?");
  const revokeFamily = db.prepare("DELETE FROM sessions WHERE familyId = ?");
  const driver: SqlSessionDriver = {
    async read(id) { return read.get(id) as unknown as SqlSessionRow | undefined; },
    async write(row) { write.run(row.id, row.familyId, row.csrfToken, row.dataJson, row.createdAt, row.expiresAt); },
    async remove(id) { remove.run(id); },
    async replace(previousId, row, now) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const previous = read.get(previousId) as unknown as SqlSessionRow | undefined;
        if (!previous || previous.expiresAt <= now || previous.familyId !== row.familyId) { db.exec("ROLLBACK"); return false; }
        remove.run(previousId);
        write.run(row.id, row.familyId, row.csrfToken, row.dataJson, row.createdAt, row.expiresAt);
        db.exec("COMMIT");
        return true;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    async revokeFamily(familyId) { revokeFamily.run(familyId); },
    async close() { db.close(); },
  };
  return new SessionManager({ store: new SqlSessionStore<{ user: string }>(driver, { closeDriver: true }), production: true });
}
