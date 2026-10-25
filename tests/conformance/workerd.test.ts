import assert from "node:assert/strict";
import { once } from "node:events";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import type WebSocket from "ws";
import { conformanceSuite, connect, messages, opened, send } from "./assertions.ts";

/** Resolves with the next text frame, unparsed. */
async function nextText(peer: WebSocket): Promise<string> {
  const [data] = await once(peer, "message") as [WebSocket.RawData];
  return String(data);
}

/** Fails if a peer receives anything while `during` runs and shortly after. */
async function silent(peers: WebSocket[], during: () => Promise<void>): Promise<void> {
  const leaked: string[] = [];
  const listeners = peers.map((peer) => {
    const listener = (data: WebSocket.RawData) => { leaked.push(String(data)); };
    peer.on("message", listener);
    return () => peer.off("message", listener);
  });
  try {
    await during();
    await new Promise((resolve) => setTimeout(resolve, 200));
  } finally {
    for (const off of listeners) off();
  }
  assert.deepEqual(leaked, []);
}

// The cloudflare adapter's output under workerd, through Wrangler's local
// runtime, with D1 sessions and Durable Object Socket rooms. Skipped with a
// message when wrangler is not installed, unless MEEKO_CONFORMANCE_REQUIRE
// lists workerd.
conformanceSuite("workerd", ({ server, session, track }) => {
  const said = (text: string) => ({ event: "said", payload: { text } });

  it("keeps sessions in D1 and authorizes them in other isolates", async () => {
    const workerd = server().workerd!;
    const origin = server().origin;
    const count = async () => Number((await workerd.query("SELECT count(*) AS n FROM meeko_sessions"))[0]!.n);
    const before = await count();
    assert.ok(before >= 1, "the suite login is stored in D1");
    const login = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { origin } });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const { csrf } = await login.json() as { csrf: string };
    assert.equal(await count(), before + 1);
    const mutation = await fetch(`${origin}/api/echo`, {
      method: "POST", headers: { origin, cookie, "content-type": "application/json", "x-meeko-csrf": csrf }, body: JSON.stringify({ text: "d1" }),
    });
    assert.equal(mutation.status, 200);
    assert.deepEqual(await mutation.json(), { text: "d1", platform: "cloudflare" });
    // The private channel's Durable Object reads the same D1 session.
    const peer = await opened(track(connect(origin, "private", { cookie })));
    const reply = messages(peer, 1);
    send(peer, "say", { text: "from d1" });
    assert.deepEqual(await reply, [said("from d1")]);
    assert.ok(session().cookie !== cookie);
  });

  it("rebuilds hibernated Socket connections and keeps broadcasting in both directions", async () => {
    const { origin, workerd } = server();
    const first = await opened(track(connect(origin, "room", { room: "hibernate" })));
    const second = await opened(track(connect(origin, "room", { room: "hibernate" })));
    const warm = messages(second, 1);
    send(first, "say", { text: "before" });
    assert.deepEqual(await warm, [said("before")]);

    await workerd!.hibernate("room", "hibernate");
    // The runtime answers the auto-response pair without waking the object.
    first.send("ping");
    assert.equal(await nextText(first), "pong");
    let both = [messages(first, 1), messages(second, 1)];
    send(first, "say", { text: "after first wake" });
    assert.deepEqual(await Promise.all(both), [[said("after first wake")], [said("after first wake")]]);

    await workerd!.hibernate("room", "hibernate");
    both = [messages(first, 1), messages(second, 1)];
    send(second, "say", { text: "from second" });
    assert.deepEqual(await Promise.all(both), [[said("from second")], [said("from second")]]);

    // A publish from the Worker wakes the room through RPC.
    await workerd!.hibernate("room", "hibernate");
    both = [messages(first, 1), messages(second, 1)];
    const response = await fetch(`${origin}/api/broadcast`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ room: "hibernate", text: "from api" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await Promise.all(both), [[said("from api")], [said("from api")]]);
  });

  it("bundles the Worker into one module next to its configuration and assets", async () => {
    const { output } = server();
    // .wrangler holds the local runtime's state, created when the output runs.
    assert.deepEqual((await readdir(output)).filter((name) => name !== ".wrangler").sort(), ["assets", "worker.js", "wrangler.jsonc"]);
    const worker = await readFile(join(output, "worker.js"), "utf8");
    // codeSplitting: false leaves no relative chunk imports, static or dynamic.
    assert.doesNotMatch(worker, /\bimport\s*\(\s*["'`]\.{1,2}\//);
    assert.doesNotMatch(worker, /\bfrom\s*["']\.{1,2}\//);
  });

  it("keeps only the session cookie with a connection, whatever else the Cookie header carries", async () => {
    const { origin } = server();
    // Far over the 16 KiB WebSocket attachment limit if the whole header were kept.
    const crowded = `${Array.from({ length: 36 }, (_, index) => `pref${index}=${"x".repeat(500)}`).join("; ")}; ${session().cookie}`;
    const peer = await opened(track(connect(origin, "private", { cookie: crowded })));
    const reply = messages(peer, 1);
    send(peer, "say", { text: "crowded cookie" });
    assert.deepEqual(await reply, [said("crowded cookie")]);
  });

  it("publishes inside a room whose Durable Object name exceeds 1,024 bytes", async () => {
    const { origin, workerd } = server();
    // The runtime leaves ctx.id.name undefined for such names; the room learns
    // it from its connections, also after waking from hibernation.
    const room = "long-".repeat(220);
    const first = await opened(track(connect(origin, "room", { room })));
    const second = await opened(track(connect(origin, "room", { room })));
    let both = [messages(first, 1), messages(second, 1)];
    send(first, "say", { text: "long name" });
    assert.deepEqual(await Promise.all(both), [[said("long name")], [said("long name")]]);

    await workerd!.hibernate("room", room);
    both = [messages(first, 1), messages(second, 1)];
    send(second, "say", { text: "long name after wake" });
    assert.deepEqual(await Promise.all(both), [[said("long name after wake")], [said("long name after wake")]]);

    await workerd!.hibernate("room", room);
    both = [messages(first, 1), messages(second, 1)];
    const response = await fetch(`${origin}/api/broadcast`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ room, text: "long name from api" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await Promise.all(both), [[said("long name from api")], [said("long name from api")]]);
  });

  it("publishes from one room's Durable Object to another without leaking", async () => {
    const { origin } = server();
    const source = await opened(track(connect(origin, "room", { room: "source" })));
    const target = await opened(track(connect(origin, "room", { room: "target" })));
    const bystander = await opened(track(connect(origin, "room", { room: "bystander" })));
    const received = messages(target, 2);
    await silent([source, bystander], async () => {
      send(source, "relay", { room: "target", text: "relayed" });
      send(source, "relay", { room: "target", text: "relayed again" });
      assert.deepEqual(await received, [said("relayed"), said("relayed again")]);
    });
  });
});
