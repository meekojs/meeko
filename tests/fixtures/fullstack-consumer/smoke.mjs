import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import WebSocket from "ws";

const origin = `http://127.0.0.1:${process.env.MEEKO_TEST_PORT ?? "4387"}`;
const login = async (user) => {
  const response = await fetch(`${origin}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ user }),
  });
  assert.equal(response.status, 200, response.status === 200 ? "" : await response.text());
  const body = await response.json();
  return { cookie: response.headers.get("set-cookie")?.split(";")[0], csrf: body.csrfToken };
};
const [alice, bob] = await Promise.all([login("alice"), login("bob")]);
assert.notEqual(alice.cookie, bob.cookie);
const get = async (path, cookie) => fetch(`${origin}${path}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
for (const [path, marker] of [["/", "Welcome"], ["/users", "Ada"], ["/layer-demo", "Layer route works"]]) {
  const response = await get(path);
  assert.equal(response.status, 200, path);
  assert.equal(response.headers.get("x-meeko-fixture-middleware"), "active");
  assert.match(await response.text(), new RegExp(marker));
}
// A render: "client" page: server middleware and the layout run on the server, its loader in the browser.
const notes = await get("/notes");
assert.equal(notes.status, 200);
assert.equal(notes.headers.get("x-meeko-fixture-middleware"), "active");
const notesHtml = await notes.text();
assert.match(notesHtml, /class="app-shell/);
assert.match(notesHtml, /"render":"client"/);
assert.doesNotMatch(notesHtml, /Ada|<title>/, "a client page must not render loader data or head on the server");
assert.doesNotMatch(notesHtml, /id="notes-data"/, "the page outlet must be empty in the server HTML");
const deniedRoute = await get("/users?deny=1");
assert.equal(deniedRoute.status, 403);
assert.equal(await deniedRoute.text(), "Route denied");
assert.equal(deniedRoute.headers.get("x-meeko-fixture-middleware"), "active");
assert.equal((await (await get("/status.txt")).text()).trim(), "public asset");
// Only files listed in the build manifest are served, even inside the client output.
const unlisted = resolve(".meeko/output/node/client/unlisted-static-test.txt");
await writeFile(unlisted, "private content");
try {
  assert.equal((await get("/unlisted-static-test.txt")).status, 404);
} finally {
  await rm(unlisted, { force: true });
}
const asset = await get("/status.txt");
const assetTag = asset.headers.get("etag");
assert.ok(assetTag);
assert.equal(asset.headers.get("cache-control"), "public, max-age=0, must-revalidate");
assert.equal((await fetch(`${origin}/status.txt`, { headers: { "if-none-match": assetTag } })).status, 304);
const head = await fetch(`${origin}/status.txt`, { method: "HEAD" });
assert.equal(head.status, 200);
assert.equal(head.headers.get("content-length"), asset.headers.get("content-length"));
// The prerendered home page still runs server middleware and carries the session CSRF token.
const anonymousHome = await get("/");
const homeTag = anonymousHome.headers.get("etag");
assert.ok(homeTag);
assert.equal(anonymousHome.headers.get("cache-control"), "public, max-age=0, must-revalidate");
assert.doesNotMatch(await anonymousHome.text(), /meeko-csrf-token/);
const revalidated = await fetch(`${origin}/`, { headers: { "if-none-match": homeTag } });
assert.equal(revalidated.status, 304);
assert.equal(revalidated.headers.get("x-meeko-fixture-middleware"), "active");
const aliceHome = await get("/", alice.cookie);
assert.equal(aliceHome.headers.get("cache-control"), "private, no-store");
assert.equal(aliceHome.headers.get("x-meeko-fixture-middleware"), "active");
const aliceHtml = await aliceHome.text();
assert.ok(aliceHtml.includes(`<meta name="meeko-csrf-token" content="${alice.csrf}">`), "prerendered page lacks the session CSRF token");
assert.doesNotMatch(aliceHtml, /id="meeko-routes"/);
assert.equal((await get("/dashboard")).status, 302);
const [aDashboard, bDashboard] = await Promise.all([get("/dashboard", alice.cookie), get("/dashboard", bob.cookie)]);
assert.match(await aDashboard.text(), /alice/);
assert.match(await bDashboard.text(), /bob/);
const rpc = async (identity) => fetch(`${origin}/_meeko/rpc/users/get`, {
  method: "POST",
  headers: { cookie: identity.cookie, origin, "x-meeko-csrf": identity.csrf, "content-type": "application/json" },
  body: JSON.stringify({ id: "x" }),
});
assert.deepEqual(await (await rpc(alice)).json(), { id: "x", name: "alice" });
assert.deepEqual(await (await rpc(bob)).json(), { id: "x", name: "bob" });
const invalidCsrf = await fetch(`${origin}/_meeko/rpc/users/get`, {
  method: "POST", headers: { cookie: alice.cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ id: "x" }),
});
assert.equal(invalidCsrf.status, 403);
assert.equal((await invalidCsrf.json()).code, "INVALID_CSRF");
const ws = new WebSocket(`${origin.replace("http:", "ws:")}/_meeko/socket/chat?room=general`, { headers: { cookie: alice.cookie, origin } });
await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
ws.send(JSON.stringify({ event: "message", payload: { text: "Hola", roomId: "general" } }));
const message = await new Promise((resolve, reject) => { ws.once("message", resolve); ws.once("error", reject); });
assert.deepEqual(JSON.parse(String(message)), { event: "message", payload: { text: "Hola", roomId: "general" } });
ws.close();
console.log("Full-stack HTTP, middleware, asset manifest boundary, prerender, concurrent sessions, RPC, CSRF, layer and WebSocket: OK");
