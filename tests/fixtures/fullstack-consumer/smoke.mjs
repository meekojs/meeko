import assert from "node:assert/strict";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
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
  assert.match(await response.text(), new RegExp(marker));
}
assert.equal((await (await get("/status.txt")).text()).trim(), "public asset");
const privateDir = resolve(".meeko/private-static-test");
const publicLink = resolve("public/private-static-test");
await mkdir(privateDir, { recursive: true });
await writeFile(resolve(privateDir, "secret.txt"), "private content");
await symlink(privateDir, publicLink, "junction");
try {
  assert.equal((await get("/private-static-test/secret.txt")).status, 403);
} finally {
  await rm(publicLink, { recursive: true, force: true });
  await rm(privateDir, { recursive: true, force: true });
}
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
console.log("Full-stack HTTP, static path boundary, concurrent sessions, RPC, CSRF, layer and WebSocket: OK");
