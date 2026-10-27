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
  async eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<number> {
    const [first, second, third] = options.keys;
    const args = options.arguments;
    if (!first) throw new Error("Missing Redis key");
    if (script.startsWith("-- meeko:session:set")) {
      if (!second || !args[0] || !args[1] || !args[2] || !args[3]) throw new Error("Missing Redis set argument");
      const prior = await this.get(first);
      if (prior) {
        const old = JSON.parse(prior) as { id: string; familyId?: string };
        if ((old.familyId ?? old.id) !== args[3]) return 0;
      }
      const active = await this.get(second);
      if (active && active !== args[1]) return 0;
      await this.set(first, args[0], { PX: Number(args[2]) });
      await this.set(second, args[1], { PX: Number(args[2]) });
      return 1;
    }
    if (script.startsWith("-- meeko:session:replace")) {
      if (!second || !third || !args[0] || !args[1] || !args[2] || !args[3] || !args[4] || !args[5]) throw new Error("Missing Redis replace argument");
      const previousRaw = await this.get(first);
      if (!previousRaw) return 0;
      const previous = JSON.parse(previousRaw) as { id: string; familyId?: string; expiresAt: number };
      if ((previous.familyId ?? previous.id) !== args[2] || previous.expiresAt <= Number(args[3])) return 0;
      const active = await this.get(third);
      if (active && active !== args[1]) return 0;
      await this.set(second, args[0], { PX: Number(args[4]) });
      await this.set(third, args[5], { PX: Number(args[4]) });
      this.records.delete(first);
      return 1;
    }
    if (script.startsWith("-- meeko:session:delete")) {
      if (!second || !args[0] || !await this.get(first)) return 0;
      const active = await this.get(second);
      this.records.delete(first);
      if (active === args[0]) this.records.delete(second);
      return 1;
    }
    if (script.startsWith("-- meeko:session:revoke-family")) {
      if (!args[0] || !args[1]) throw new Error("Missing Redis family argument");
      const active = await this.get(first);
      this.records.delete(`${args[0]}${active ?? args[1]}`);
      this.records.delete(first);
      return 1;
    }
    throw new Error("Unexpected Redis script");
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
    if (!previous || previous.expiresAt <= now || previous.familyId !== row.familyId) return false;
    this.rows.set(row.id, row);
    this.rows.delete(previousId);
    return true;
  }
  async revokeFamily(familyId: string): Promise<void> {
    for (const row of this.rows.values()) if (row.familyId === familyId) this.rows.delete(row.id);
  }
  async close(): Promise<void> { this.closed = true; }
}

test("production requires an explicitly persistent store and rejects in-memory substitutes", () => {
  assert.throws(() => new SessionManager({ store: new MemorySessionStore(), production: true }), /Persistent session storage/);
  assert.throws(() => new SessionManager({ store: { get: async () => undefined, set: async () => {}, delete: async () => {} }, production: true }), /Persistent session storage/);
  assert.throws(() => new SessionManager({ store: { persistent: true, get: async () => undefined, set: async () => {}, delete: async () => {}, replace: async () => true }, production: true }), /family revocation/);
  assert.throws(() => new SqlSessionStore({ read: async () => undefined, write: async () => {}, remove: async () => {}, replace: async () => true } as unknown as SqlSessionDriver), /family revocation/);
  assert.doesNotThrow(() => new SessionManager({ store: new RedisSessionStore(new TestRedis(), { prefix: "meeko:test:" }), production: true }));
});

test("a session id cannot be reassigned to another family", async () => {
  const record = { id: "session-id", familyId: "family-a", csrfToken: "csrf", data: { userId: "alice" }, createdAt: Date.now(), expiresAt: Date.now() + 60_000 };
  const changed = { ...record, familyId: "family-b" };
  const memory = new MemorySessionStore();
  await memory.set(record);
  await assert.rejects(memory.set(changed), /cannot change family/);
  assert.equal((await memory.get(record.id))?.familyId, record.familyId);
  await memory.revokeFamily(record.familyId);
  const redis = new RedisSessionStore(new TestRedis(), { prefix: "meeko:family:" });
  await redis.set(record);
  await assert.rejects(redis.set(changed), /already has an active id/);
  assert.equal((await redis.get(record.id))?.familyId, record.familyId);
  await redis.revokeFamily(record.familyId);
});

test("a stale memory handle revokes a session after another request rotates it", async () => {
  const store = new MemorySessionStore<{ userId: string }>();
  const manager = new SessionManager({ store, secure: false });
  const owner = await manager.load(new Request("http://localhost/"));
  const first = await owner.create({ userId: "alice" });
  const stale = await manager.load(new Request("http://localhost/", { headers: { cookie: `${manager.cookieName}=${first.id}` } }));
  const rotated = await owner.rotate();
  await stale.revoke();
  assert.equal(await store.get(rotated.id), undefined);
  assert.equal((await manager.load(new Request("http://localhost/", { headers: { cookie: `${manager.cookieName}=${rotated.id}` } }))).current, undefined);
  await assert.rejects(owner.rotate(), /expired or been revoked/);
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

test("a stale Redis handle revokes the active id after multiple rotations", async () => {
  const client = new TestRedis();
  const manager = new SessionManager({ store: new RedisSessionStore<{ userId: string }>(client, { prefix: "meeko:race:" }), production: true, secure: false });
  const owner = await manager.load(new Request("http://localhost/"));
  const original = await owner.create({ userId: "alice" });
  const stale = await manager.load(new Request("http://localhost/", { headers: { cookie: `${manager.cookieName}=${original.id}` } }));
  const once = await owner.rotate();
  const twice = await owner.rotate();
  assert.equal((await manager.store.get(twice.id))?.data.userId, "alice");
  await stale.revoke();
  assert.equal(await manager.store.get(twice.id), undefined);
  assert.equal(await manager.store.get(once.id), undefined);
  assert.equal(client.records.size, 0);
  await assert.rejects(owner.rotate(), /expired or been revoked/);
  await stale.revoke();
});

test("legacy Redis records migrate on rotation and a stale handle still revokes them", async () => {
  const client = new TestRedis();
  const prefix = "meeko:legacy:";
  const manager = new SessionManager({ store: new RedisSessionStore<{ userId: string }>(client, { prefix }), production: true, secure: false });
  const seed = await manager.load(new Request("http://localhost/"));
  const created = await seed.create({ userId: "legacy" });
  client.records.set(`${prefix}${created.id}`, { value: JSON.stringify({ ...created, familyId: undefined }), expiresAt: created.expiresAt });
  client.records.delete(`${prefix}family:${created.familyId}`);
  const cookie = `${manager.cookieName}=${created.id}`;
  const owner = await manager.load(new Request("http://localhost/", { headers: { cookie } }));
  const stale = await manager.load(new Request("http://localhost/", { headers: { cookie } }));
  const rotated = await owner.rotate();
  assert.equal(rotated.familyId, created.id);
  await stale.revoke();
  assert.equal(await manager.store.get(rotated.id), undefined);
  assert.equal(client.records.size, 0);
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
  const dispatch = createServerDispatcher({ manifest: { api: [], rpc: [] }, sessions: manager, services: {}, load: async () => ({}) });
  const response = await dispatch(new Request("https://example.test/api/missing", { headers: { cookie: `${manager.cookieName}=${record.id}` } }));
  assert.equal(response.status, 500);
  const body = await response.json() as { code: string; requestId: string };
  assert.equal(body.code, "INTERNAL_ERROR");
  assert.ok(body.requestId);
  assert.doesNotMatch(JSON.stringify(body), /secret redis/);
});

test("SQL store rotates and revokes sessions in a real SQLite transaction", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, family_id TEXT NOT NULL UNIQUE, csrf_token TEXT NOT NULL, data_json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)");
  const row = (value: unknown): SqlSessionRow | undefined => {
    if (!value) return undefined;
    const item = value as { id: string; family_id: string; csrf_token: string; data_json: string; created_at: number; expires_at: number };
    return { id: item.id, familyId: item.family_id, csrfToken: item.csrf_token, dataJson: item.data_json, createdAt: item.created_at, expiresAt: item.expires_at };
  };
  const insert = db.prepare("INSERT INTO sessions (id, family_id, csrf_token, data_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)");
  const driver: SqlSessionDriver = {
    async read(id) { return row(db.prepare("SELECT * FROM sessions WHERE id = ?").get(id)); },
    async write(value) { insert.run(value.id, value.familyId, value.csrfToken, value.dataJson, value.createdAt, value.expiresAt); },
    async remove(id) { db.prepare("DELETE FROM sessions WHERE id = ?").run(id); },
    async replace(previousId, value, now) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const deleted = db.prepare("DELETE FROM sessions WHERE id = ? AND family_id = ? AND expires_at > ?").run(previousId, value.familyId, now);
        if (deleted.changes === 0) { db.exec("ROLLBACK"); return false; }
        insert.run(value.id, value.familyId, value.csrfToken, value.dataJson, value.createdAt, value.expiresAt);
        db.exec("COMMIT");
        return true;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    async revokeFamily(familyId) { db.prepare("DELETE FROM sessions WHERE family_id = ?").run(familyId); },
    async close() { db.close(); },
  };
  const manager = new SessionManager({ store: new SqlSessionStore<{ userId: string }>(driver, { closeDriver: true }), production: true, secure: false });
  const handle = await manager.load(new Request("http://localhost/"));
  const created = await handle.create({ userId: "sqlite-user" });
  const stale = await manager.load(new Request("http://localhost/", { headers: { cookie: `${manager.cookieName}=${created.id}` } }));
  const rotated = await handle.rotate();
  const rotatedAgain = await handle.rotate();
  assert.equal(await manager.store.get(created.id), undefined);
  assert.equal(await manager.store.get(rotated.id), undefined);
  assert.equal((await manager.store.get(rotatedAgain.id))?.data.userId, "sqlite-user");
  await stale.revoke();
  assert.equal(await manager.store.get(rotatedAgain.id), undefined);
  await handle.revoke();
  assert.equal(await manager.store.get(rotated.id), undefined);
  await manager.close();
});

test("a session's own TTL drives the cookie and each store's expiry, and survives rotation", async () => {
  const hour = 60 * 60 * 1000;
  const redis = new TestRedis();
  const stores = [
    ["memory", new MemorySessionStore<{ role: string }>()],
    ["redis", new RedisSessionStore<{ role: string }>(redis, { prefix: "meeko:ttl:" })],
    ["sql", new SqlSessionStore<{ role: string }>(new TestSql())],
  ] as const;
  for (const [name, store] of stores) {
    const manager = new SessionManager({ store, secure: false, ttlMs: 7 * 24 * hour });
    const handle = await manager.load(new Request("http://localhost/"));
    for (const ttlMs of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(handle.create({ role: "staff" }, { ttlMs }), RangeError, `${name}: ${ttlMs}`);
    }
    assert.equal(handle.current, undefined, name);
    assert.equal(handle.cookieHeader, undefined, name);

    const staff = await handle.create({ role: "staff" }, { ttlMs: 12 * hour });
    assert.equal(staff.ttlMs, 12 * hour, name);
    assert.equal(staff.expiresAt - staff.createdAt, 12 * hour, name);
    assert.match(handle.cookieHeader ?? "", /Max-Age=43200(;|$)/, name);
    if (name === "redis") {
      const stored = redis.records.get(`meeko:ttl:${staff.id}`);
      assert.ok(stored && Math.abs(stored.expiresAt - staff.expiresAt) < 1000, "Redis PX follows the session TTL");
    }

    // A later request reads the TTL back from the store and keeps it when rotating.
    const loaded = await manager.load(new Request("http://localhost/", { headers: { cookie: `${manager.cookieName}=${staff.id}` } }));
    assert.equal(loaded.current?.ttlMs, 12 * hour, name);
    const rotated = await loaded.rotate();
    assert.equal(rotated.ttlMs, 12 * hour, name);
    assert.equal(rotated.expiresAt - rotated.createdAt, 12 * hour, name);
    assert.match(loaded.cookieHeader ?? "", /Max-Age=43200(;|$)/, name);
    assert.equal((await store.get(rotated.id))?.expiresAt, rotated.expiresAt, name);

    // Without options, the manager's TTL applies, as in 1.1.
    const owner = await manager.load(new Request("http://localhost/"));
    const created = await owner.create({ role: "owner" });
    assert.equal(created.ttlMs, undefined, name);
    assert.equal(created.expiresAt - created.createdAt, 7 * 24 * hour, name);
    assert.match(owner.cookieHeader ?? "", /Max-Age=604800(;|$)/, name);
    assert.equal((await owner.rotate()).expiresAt - owner.current!.createdAt, 7 * 24 * hour, name);
  }
});

test("records written before per-session TTLs rotate with the manager's TTL", async () => {
  const store = new MemorySessionStore<{ userId: string }>();
  const now = Date.now();
  await store.set({ id: "a".repeat(43), familyId: "legacy", csrfToken: "csrf", data: { userId: "u" }, createdAt: now, expiresAt: now + 60_000 });
  const manager = new SessionManager({ store, secure: false, ttlMs: 2 * 60_000 });
  const handle = await manager.load(new Request("http://localhost/", { headers: { cookie: `meeko.sid=${"a".repeat(43)}` } }));
  const rotated = await handle.rotate();
  assert.equal(rotated.ttlMs, undefined);
  assert.equal(rotated.expiresAt - rotated.createdAt, 2 * 60_000);
  assert.match(handle.cookieHeader ?? "", /Max-Age=120(;|$)/);
});
