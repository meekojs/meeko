import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { MemorySessionStore, SessionManager } from "../src/framework-server/sessions.ts";
import { RedisSessionStore, SqlSessionStore } from "../src/framework-server/session-stores.ts";
import type { RedisSessionClient, SqlSessionDriver, SqlSessionRow } from "../src/framework-server/session-stores.ts";
import { createServerDispatcher } from "../src/framework-server/discovery.ts";

class TestRedis implements RedisSessionClient {
  readonly records = new Map<string, { value: string; expiresAt: number }>();
  closed = false;
  failGet = false;
  async get(key: string): Promise<string | null> {
    if (this.failGet) throw new Error("secret redis connection detail");
    const row = this.records.get(key);
    if (!row || row.expiresAt <= Date.now()) return null;
    return row.value;
  }
  async set(key: string, value: string, options: { PX: number }): Promise<void> {
    this.records.set(key, { value, expiresAt: Date.now() + options.PX });
  }
  async del(key: string): Promise<void> { this.records.delete(key); }
  async eval(_script: string, options: { keys: string[]; arguments: string[] }): Promise<number> {
    const [oldKey, newKey] = options.keys;
    const [value, ttl] = options.arguments;
    if (!oldKey || !newKey || !value || !ttl || !(await this.get(oldKey))) return 0;
    this.records.set(newKey, { value, expiresAt: Date.now() + Number(ttl) });
    this.records.delete(oldKey);
    return 1;
  }
  async quit(): Promise<void> { this.closed = true; }
}

class TestSql implements SqlSessionDriver {
  readonly rows = new Map<string, SqlSessionRow>();
  closed = false;
  failWrite = false;
  failRemove = false;
  async read(id: string): Promise<SqlSessionRow | undefined> { return this.rows.get(id); }
  async write(row: SqlSessionRow): Promise<void> {
    if (this.failWrite) throw new Error("SQL unavailable");
    this.rows.set(row.id, row);
  }
  async remove(id: string): Promise<void> {
    if (this.failRemove) throw new Error("SQL unavailable");
    this.rows.delete(id);
  }
  async replace(previousId: string, row: SqlSessionRow, now: number): Promise<boolean> {
    if (this.failWrite || this.failRemove) throw new Error("SQL unavailable");
    const previous = this.rows.get(previousId);
    if (!previous || previous.expiresAt <= now) return false;
    this.rows.set(row.id, row);
    this.rows.delete(previousId);
    return true;
  }
  async close(): Promise<void> { this.closed = true; }
}

test("production requires an explicitly persistent store and rejects in-memory substitutes", () => {
  assert.throws(() => new SessionManager({ store: new MemorySessionStore(), production: true }), /Persistent session storage/);
  assert.throws(() => new SessionManager({ store: { get: async () => undefined, set: async () => {}, delete: async () => {} }, production: true }), /Persistent session storage/);
  assert.doesNotThrow(() => new SessionManager({ store: new RedisSessionStore(new TestRedis(), { prefix: "meeko:test:" }), production: true }));
});

test("Redis sessions isolate concurrent users, expire, revoke and close their owned client", async () => {
  const client = new TestRedis();
  const store = new RedisSessionStore<{ userId: string }>(client, { prefix: "meeko:test:", closeClient: true });
  const manager = new SessionManager({ store, production: true, ttlMs: 60_000 });
  const [alice, bob] = await Promise.all([
    manager.load(new Request("https://example.test/")),
    manager.load(new Request("https://example.test/")),
  ]);
  const [a, b] = await Promise.all([alice.create({ userId: "alice" }), bob.create({ userId: "bob" })]);
  assert.notEqual(a.id, b.id);
  assert.ok(client.records.has(`meeko:test:${a.id}`));
  assert.equal((await manager.load(new Request("https://example.test/", { headers: { cookie: `${manager.cookieName}=${a.id}` } }))).current?.data.userId, "alice");
  assert.equal((await manager.load(new Request("https://example.test/", { headers: { cookie: `${manager.cookieName}=${b.id}` } }))).current?.data.userId, "bob");
  const rotated = await alice.rotate();
  assert.equal(await store.get(a.id), undefined);
  assert.equal((await store.get(rotated.id))?.data.userId, "alice");
  assert.equal((await store.get(b.id))?.data.userId, "bob");
  await bob.revoke();
  assert.equal(await store.get(b.id), undefined);
  assert.match(bob.cookieHeader ?? "", /Max-Age=0/);
  await manager.close();
  assert.equal(client.closed, true);
});

test("SQL sessions serialize server data and preserve the old session when rotation cannot persist", async () => {
  const driver = new TestSql();
  const store = new SqlSessionStore<{ userId: string }>(driver, { closeDriver: true });
  const manager = new SessionManager({ store, production: true, secure: false });
  const handle = await manager.load(new Request("http://localhost/"));
  const created = await handle.create({ userId: "a" });
  assert.equal(driver.rows.get(created.id)?.dataJson, '{"userId":"a"}');
  driver.failWrite = true;
  await assert.rejects(handle.rotate(), /SQL unavailable/);
  assert.equal(handle.current?.id, created.id);
  assert.equal((await store.get(created.id))?.data.userId, "a");
  driver.failWrite = false;
  driver.failRemove = true;
  await assert.rejects(handle.rotate(), /SQL unavailable/);
  assert.equal(handle.current?.id, created.id);
  assert.equal(driver.rows.size, 1);
  driver.failRemove = false;
  const rotated = await handle.rotate();
  assert.equal(await store.get(created.id), undefined);
  assert.equal((await store.get(rotated.id))?.data.userId, "a");
  const persisted = driver.rows.get(rotated.id);
  assert.ok(persisted);
  persisted.expiresAt = Date.now() - 1;
  assert.equal(await store.get(rotated.id), undefined);
  assert.equal(driver.rows.has(rotated.id), false);
  await manager.close();
  assert.equal(driver.closed, true);
});

test("unavailable Redis is a sanitized HTTP error and never creates an anonymous session", async () => {
  const client = new TestRedis();
  const manager = new SessionManager({ store: new RedisSessionStore(client, { prefix: "meeko:test:" }), production: true });
  const created = await manager.load(new Request("https://example.test/"));
  const record = await created.create({ userId: "a" });
  client.failGet = true;
  const dispatch = createServerDispatcher({ manifest: { api: [], rpc: [] }, sessions: manager, services: {} });
  const response = await dispatch(new Request("https://example.test/api/missing", { headers: { cookie: `${manager.cookieName}=${record.id}` } }));
  assert.equal(response.status, 500);
  const body = await response.json() as { code: string; requestId: string };
  assert.equal(body.code, "INTERNAL_ERROR");
  assert.ok(body.requestId);
  assert.doesNotMatch(JSON.stringify(body), /secret redis/);
});

test("SQL store rotates and revokes sessions in a real SQLite transaction", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, csrf_token TEXT NOT NULL, data_json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)");
  const row = (value: unknown): SqlSessionRow | undefined => {
    if (!value) return undefined;
    const item = value as { id: string; csrf_token: string; data_json: string; created_at: number; expires_at: number };
    return { id: item.id, csrfToken: item.csrf_token, dataJson: item.data_json, createdAt: item.created_at, expiresAt: item.expires_at };
  };
  const insert = db.prepare("INSERT INTO sessions (id, csrf_token, data_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?)");
  const driver: SqlSessionDriver = {
    async read(id) { return row(db.prepare("SELECT * FROM sessions WHERE id = ?").get(id)); },
    async write(value) { insert.run(value.id, value.csrfToken, value.dataJson, value.createdAt, value.expiresAt); },
    async remove(id) { db.prepare("DELETE FROM sessions WHERE id = ?").run(id); },
    async replace(previousId, value, now) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const deleted = db.prepare("DELETE FROM sessions WHERE id = ? AND expires_at > ?").run(previousId, now);
        if (deleted.changes === 0) { db.exec("ROLLBACK"); return false; }
        insert.run(value.id, value.csrfToken, value.dataJson, value.createdAt, value.expiresAt);
        db.exec("COMMIT");
        return true;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    async close() { db.close(); },
  };
  const manager = new SessionManager({ store: new SqlSessionStore<{ userId: string }>(driver, { closeDriver: true }), production: true, secure: false });
  const handle = await manager.load(new Request("http://localhost/"));
  const created = await handle.create({ userId: "sqlite-user" });
  const rotated = await handle.rotate();
  assert.equal(await manager.store.get(created.id), undefined);
  assert.equal((await manager.store.get(rotated.id))?.data.userId, "sqlite-user");
  await handle.revoke();
  assert.equal(await manager.store.get(rotated.id), undefined);
  await manager.close();
});
