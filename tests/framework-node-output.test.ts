import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { prepareFrameworkTypes } from "../src/framework/check-project.ts";
import { initFrameworkProject } from "../src/framework/init.ts";
import { assetManifest, buildProject } from "../src/framework/project.ts";
import { createNodeAssetReader } from "../src/node.ts";

test("asset keys match the URL pathname browsers request and only Vite build files are immutable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meeko-asset-keys-"));
  try {
    await mkdir(join(directory, "assets"));
    await mkdir(join(directory, ".vite"));
    // File name -> the href an author writes for it.
    const links: Record<string, string> = {
      "a@2x.png": "/a@2x.png", "a+b.txt": "/a+b.txt", "a b.txt": "/a b.txt", "café ñ.txt": "/café ñ.txt",
      "100%.txt": "/100%25.txt", "q#x.txt": "/q%23x.txt", "assets/plain.png": "/assets/plain.png", "assets/entry-abc.js": "/assets/entry-abc.js",
    };
    for (const name of Object.keys(links)) await writeFile(join(directory, ...name.split("/")), `content of ${name}`);
    await writeFile(join(directory, ".vite", "manifest.json"), "{}");
    const assets = await assetManifest(directory, { ".meeko/generated/entry-client.ts": { file: "assets/entry-abc.js" } });
    assert.deepEqual(Object.keys(assets).sort(), [
      "/100%25.txt", "/a%20b.txt", "/a+b.txt", "/a@2x.png", "/assets/entry-abc.js", "/assets/plain.png", "/caf%C3%A9%20%C3%B1.txt", "/q%23x.txt",
    ]);
    const reader = createNodeAssetReader({ root: directory, assets });
    for (const [name, link] of Object.entries(links)) {
      const request = new Request(new URL(link, "http://local.test"));
      const response = await reader.get(new URL(request.url).pathname, request);
      assert.equal(response?.status, 200, name);
      assert.equal(await response?.text(), `content of ${name}`);
    }
    assert.equal(assets["/assets/entry-abc.js"]?.immutable, true);
    assert.equal(assets["/assets/plain.png"]?.immutable, undefined, "public/assets files are not content-hashed");
    assert.equal(assets["/a@2x.png"]?.immutable, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function files(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await files(path));
    else found.push(path);
  }
  return found;
}

test("the built Node output serves prerendered pages and assets without the source tree", { timeout: 60_000 }, async (context) => {
  const projectRoot = resolve(".meeko");
  await mkdir(projectRoot, { recursive: true });
  const root = await mkdtemp(join(projectRoot, "node-output-"));
  const repository = resolve(".");
  let child: ReturnType<typeof spawn> | undefined;
  context.after(async () => {
    if (child && child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  });
  await initFrameworkProject(root);
  await writeFile(join(root, "server", "runtime.ts"), `import { defineServerRuntime, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";

export default defineServerRuntime(({ production }) => {
  const memory = new MemorySessionStore();
  return { sessions: new SessionManager({ secure: false, production, store: {
    persistent: true,
    get: (id) => memory.get(id),
    set: (record) => memory.set(record),
    delete: (id) => memory.delete(id),
    replace: (oldId, record) => memory.replace(oldId, record),
    revokeFamily: (familyId) => memory.revokeFamily(familyId),
    close: () => memory.close(),
  } }) };
});
`);
  await mkdir(join(root, "server", "middleware"), { recursive: true });
  await writeFile(join(root, "server", "middleware", "10-header.ts"), `import { defineServerMiddleware } from "@meekojs/meeko/server";

export default defineServerMiddleware(async (_request, next) => {
  const response = await next();
  const headers = new Headers(response.headers);
  headers.set("x-output-middleware", "active");
  return new Response(response.body, { status: response.status, headers });
});
`);
  await mkdir(join(root, "server", "api", "auth"), { recursive: true });
  await writeFile(join(root, "server", "api", "auth", "login.post.ts"), `import { defineApiRoute } from "@meekojs/meeko/server";

export default defineApiRoute({ contentType: "response", async handler({ context }) {
  const session = await context.session.create({ user: "ada" });
  return Response.json({ csrf: session.csrfToken });
} });
`);
  await mkdir(join(root, "public", "assets"), { recursive: true });
  await writeFile(join(root, "public", "logo@2x.png"), "logo");
  await writeFile(join(root, "public", "café menu.txt"), "menu");
  await writeFile(join(root, "public", "assets", "plain.txt"), "unhashed");
  await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
  await symlink(repository, join(root, "node_modules", "@meekojs", "meeko"), "junction");
  await symlink(join(repository, "node_modules", "vite"), join(root, "node_modules", "vite"), "junction");
  await prepareFrameworkTypes(root);
  const result = await buildProject(root, { adapter: "node" });
  assert.deepEqual(result, { adapter: "node", output: join(root, ".meeko", "output", "node") });
  const output = await files(result.output);
  const bundle = await Promise.all(output.filter((file) => file.endsWith(".mjs")).map((file) => readFile(file, "utf8")));
  assert.ok(bundle.length > 0);
  assert.ok(!bundle.some((code) => /@typescript\/typescript6|from "typescript"|discoverConfiguredRoutes/.test(code)), "the Node output must not load build tooling");
  const prerenderIndex = JSON.parse(await readFile(join(result.output, "prerender", "manifest.json"), "utf8")) as { version: number; pages: Record<string, { file: string }> };
  assert.deepEqual(Object.keys(prerenderIndex.pages), ["/"]);
  // The output must not need the application sources it was built from.
  const moved = join(root, "moved-sources");
  await mkdir(moved);
  for (const name of ["app", "server", "public", "meeko.config.ts", ".meeko/generated"]) {
    await rename(join(root, name), join(moved, name.replaceAll("/", "-")));
  }
  child = spawn(process.execPath, [join(result.output, "index.mjs")], {
    cwd: root, env: { ...process.env, PORT: "0", HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let logs = "";
  child.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  const origin = await new Promise<string>((done, fail) => {
    const start = Date.now();
    const timer = setInterval(() => {
      const url = logs.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (url) { clearInterval(timer); done(url); }
      else if (child?.exitCode !== null) { clearInterval(timer); fail(new Error(`Node output exited: ${logs}`)); }
      else if (Date.now() - start > 20_000) { clearInterval(timer); fail(new Error(`Node output did not listen: ${logs}`)); }
    }, 25);
  });
  // A failed prerender read is not cached: the next request reads the file again.
  const stored = join(result.output, "prerender", "index.html");
  await rename(stored, `${stored}.away`);
  assert.equal((await fetch(origin)).status, 500);
  await rename(`${stored}.away`, stored);
  const home = await fetch(origin);
  assert.equal(home.status, 200, logs);
  assert.equal(home.headers.get("x-output-middleware"), "active");
  assert.equal(home.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  const etag = home.headers.get("etag");
  assert.ok(etag);
  const html = await home.text();
  assert.match(html, /Welcome to Meeko/);
  assert.doesNotMatch(html, /id="meeko-routes"/);
  assert.doesNotMatch(html, /meeko-csrf-token/);
  const entry = html.match(/<script type="module" src="(\/assets\/[^"]+\.js)"><\/script>/)?.[1];
  assert.ok(entry, html);
  assert.match(html, /<link rel="stylesheet" href="\/assets\/[^"]+\.css">/);
  const script = await fetch(`${origin}${entry}`);
  assert.equal(script.status, 200);
  assert.equal(script.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal((await fetch(origin, { headers: { "if-none-match": etag } })).status, 304);
  assert.equal((await fetch(`${origin}/.vite/manifest.json`)).status, 404);
  const logo = await fetch(`${origin}/logo@2x.png`);
  assert.equal(logo.status, 200);
  assert.equal(await logo.text(), "logo");
  assert.equal(await (await fetch(`${origin}/café menu.txt`)).text(), "menu");
  const plain = await fetch(`${origin}/assets/plain.txt`);
  assert.equal(plain.status, 200);
  assert.equal(plain.headers.get("cache-control"), "public, max-age=0, must-revalidate", "public/assets files are not content-hashed");
  await plain.body?.cancel();
  const login = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { origin } });
  assert.equal(login.status, 200, logs);
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const csrf = ((await login.json()) as { csrf: string }).csrf;
  const personal = await fetch(origin, { headers: { cookie } });
  assert.equal(personal.headers.get("cache-control"), "private, no-store");
  assert.equal(personal.headers.get("x-output-middleware"), "active");
  assert.ok((await personal.text()).includes(`<meta name="meeko-csrf-token" content="${csrf}">`));
});
