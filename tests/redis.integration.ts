import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "redis";
import { RedisSessionStore } from "../src/framework-server/session-stores.ts";
import { SessionManager } from "../src/framework-server/sessions.ts";
import type { SessionRecord } from "../src/framework-server/sessions.ts";

const url = process.env.MEEKO_REDIS_URL;

test("RedisSessionStore persists isolated concurrent users, rotates, revokes and expires on real Redis", { skip: !url }, async () => {
  if (!url) throw new Error("MEEKO_REDIS_URL is required");
  const client = createClient({ url, socket: { reconnectStrategy: false } });
  client.on("error", () => { /* Connection errors are asserted at the call site. */ });
  await client.connect();
  const serverInfo = await client.info("server");
  const version = serverInfo.split("\n").find((line) => line.startsWith("redis_version:"))?.slice("redis_version:".length).trim();
  assert.ok(version, "Redis server version was not reported");
  console.log(`Redis server version: ${version}`);
  const prefix = `meeko:test:${randomUUID()}:`;
  const otherPrefix = `meeko:test:${randomUUID()}:`;
  const ids = new Set<string>();
  try {
    const store = new RedisSessionStore<{ user: string }>(client, { prefix });
    const other = new RedisSessionStore<{ user: string }>(client, { prefix: otherPrefix });
    const manager = new SessionManager({ store, production: true, secure: false, ttlMs: 5_000 });
    const handles = await Promise.all(Array.from({ length: 8 }, () => manager.load(new Request("http://localhost/"))));
    const records = await Promise.all(handles.map((handle, index) => handle.create({ user: `user-${index}` })));
    for (const record of records) ids.add(record.id);
    assert.equal(new Set(records.map((record) => record.id)).size, records.length);
    const recovered = await Promise.all(records.map((record) => store.get(record.id)));
    assert.deepEqual(recovered.map((record) => record?.data.user), handles.map((_, index) => `user-${index}`));
    assert.equal(await store.get("missing"), undefined);
    assert.equal(await other.get(records[0]!.id), undefined);
    const raw = await client.get(`${prefix}${records[0]!.id}`);
    assert.ok(raw);
    assert.equal((JSON.parse(raw) as SessionRecord<{ user: string }>).data.user, "user-0");
    const initialTtl = await client.pTTL(`${prefix}${records[0]!.id}`);
    assert.ok(initialTtl > 0 && initialTtl <= 5_000);
    assert.ok(Math.abs(initialTtl - (records[0]!.expiresAt - Date.now())) < 500);

    const rotated = await handles[0]!.create({ user: "updated" });
    ids.add(rotated.id);
    assert.equal(await store.get(records[0]!.id), undefined);
    assert.equal((await store.get(rotated.id))?.data.user, "updated");
    assert.ok((await client.pTTL(`${prefix}${rotated.id}`)) > 0);
    assert.equal((await store.get(records[1]!.id))?.data.user, "user-1");
    await handles[1]!.revoke();
    assert.equal(await store.get(records[1]!.id), undefined);

    const renewable = { id: randomUUID(), csrfToken: randomUUID(), data: { user: "renewable" }, createdAt: Date.now(), expiresAt: Date.now() + 600 };
    ids.add(renewable.id);
    await store.set(renewable);
    const renewed = { ...renewable, expiresAt: Date.now() + 5_000 };
    await store.set(renewed);
    assert.ok((await client.pTTL(`${prefix}${renewable.id}`)) > 4_000);

    const soon = { id: randomUUID(), csrfToken: randomUUID(), data: { user: "short" }, createdAt: Date.now(), expiresAt: Date.now() + 500 };
    ids.add(soon.id);
    await store.set(soon);
    assert.ok((await client.pTTL(`${prefix}${soon.id}`)) > 0);
    const deadline = Date.now() + 2_000;
    while (await client.exists(`${prefix}${soon.id}`)) {
      assert.ok(Date.now() < deadline, "Redis TTL did not expire within the bounded deadline");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(await store.get(soon.id), undefined);

    const wrongType = randomUUID();
    ids.add(wrongType);
    await client.lPush(`${prefix}${wrongType}`, "not a session");
    await assert.rejects(store.get(wrongType), /WRONGTYPE/);
  } finally {
    await Promise.all([...ids].map((id) => client.del(`${prefix}${id}`)));
    await client.quit();
  }
});

test("RedisSessionStore rejects a closed connection and recovers with a replacement client", { skip: !url }, async () => {
  if (!url) throw new Error("MEEKO_REDIS_URL is required");
  const client = createClient({ url, disableOfflineQueue: true, socket: { reconnectStrategy: false } });
  client.on("error", () => {});
  await client.connect();
  const prefix = `meeko:test:${randomUUID()}:`;
  const id = randomUUID();
  const store = new RedisSessionStore<{ user: string }>(client, { prefix, closeClient: true });
  await store.set({ id, csrfToken: randomUUID(), data: { user: "recovered" }, createdAt: Date.now(), expiresAt: Date.now() + 5_000 });
  await store.close();
  await assert.rejects(store.get(id));

  const replacement = createClient({ url, disableOfflineQueue: true, socket: { reconnectStrategy: false } });
  replacement.on("error", () => {});
  try {
    await replacement.connect();
    const recoveredStore = new RedisSessionStore<{ user: string }>(replacement, { prefix });
    assert.equal((await recoveredStore.get(id))?.data.user, "recovered");
    await recoveredStore.delete(id);
  } finally {
    if (replacement.isOpen) await replacement.quit();
  }
});
