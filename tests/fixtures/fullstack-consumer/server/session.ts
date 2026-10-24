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
  db.exec("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, csrfToken TEXT NOT NULL, dataJson TEXT NOT NULL, createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL)");
  const read = db.prepare("SELECT id, csrfToken, dataJson, createdAt, expiresAt FROM sessions WHERE id = ?");
  const write = db.prepare("INSERT OR REPLACE INTO sessions (id, csrfToken, dataJson, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?)");
  const remove = db.prepare("DELETE FROM sessions WHERE id = ?");
  const driver: SqlSessionDriver = {
    async read(id) { return read.get(id) as unknown as SqlSessionRow | undefined; },
    async write(row) { write.run(row.id, row.csrfToken, row.dataJson, row.createdAt, row.expiresAt); },
    async remove(id) { remove.run(id); },
    async replace(previousId, row, now) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const previous = read.get(previousId) as unknown as SqlSessionRow | undefined;
        if (!previous || previous.expiresAt <= now) { db.exec("ROLLBACK"); return false; }
        write.run(row.id, row.csrfToken, row.dataJson, row.createdAt, row.expiresAt);
        remove.run(previousId);
        db.exec("COMMIT");
        return true;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    async close() { db.close(); },
  };
  return new SessionManager({ store: new SqlSessionStore<{ user: string }>(driver, { closeDriver: true }), production: true });
}
