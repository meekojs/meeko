import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { appendFile, mkdir, symlink, unlink, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { join, resolve } from "node:path";
import test from "node:test";
import { createServer, normalizePath, resolveConfig, type InlineConfig, type Plugin, type ViteDevServer } from "vite";
import { createDevAppReloader, isDevWatchIgnored, isDiscoverySource } from "../src/framework/dev-watch.ts";
import { initFrameworkProject } from "../src/framework/init.ts";
import { meeko } from "../src/vite.ts";
import { createTempProject, repositoryRoot, stopChild, tempProject } from "./helpers/temp-project.ts";

async function freePort(): Promise<number> {
  const server = createNetServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  server.close();
  await once(server, "close");
  return address.port;
}

test("the dev watcher skips .meeko except the generated entries Vite serves", () => {
  const root = resolve("project");
  for (const path of [".meeko/check/x/tsconfig.json", ".meeko/routes/routes.d.ts", ".meeko/types/app/x.d.meeko.ts", ".meeko/output/public/index.html",
    ".meeko/build/app-data.json", ".meeko/manifests/client.json", ".meeko/tsconfig.app.json", ".meeko/stale/install/package.json", "layers/base/.meeko/types/x.ts"]) {
    assert.ok(isDevWatchIgnored(join(root, path), root), path);
  }
  for (const path of [".meeko", ".meeko/generated", ".meeko/generated/entry-client.ts", "app/pages/index.meeko", "meeko.config.ts", "../elsewhere/.meeko/check/x.ts"]) {
    assert.ok(!isDevWatchIgnored(join(root, path), root), path);
  }
  assert.ok(isDevWatchIgnored(`${root.replaceAll("\\", "/")}/.meeko/output/index.html`, root));
  // The rule is relative to the root: a project under some `.meeko` keeps its sources watched.
  const nested = resolve(".meeko", "tmp", "project");
  assert.ok(!isDevWatchIgnored(join(nested, "app", "pages", "index.meeko"), nested));
  assert.ok(isDevWatchIgnored(join(nested, ".meeko", "check", "x.ts"), nested));
});

test("the plugin adds its watch and scan exclusions to the user's Vite config", async () => {
  const project = await createTempProject("dev-config");
  try {
    const resolveServe = (config: InlineConfig) => resolveConfig({ root: project.root, configFile: false, logLevel: "silent", plugins: [meeko()], ...config }, "serve");
    const crawled = await resolveServe({ server: { watch: { ignored: ["**/custom/**"] } } });
    const ignored = crawled.server.watch?.ignored;
    assert.ok(Array.isArray(ignored) && ignored.includes("**/custom/**") && ignored.some((matcher) => typeof matcher === "function"), String(ignored));
    // Vite's own HTML crawl, outside `.meeko`.
    assert.deepEqual(crawled.environments.client!.optimizeDeps.entries, ["**/*.html", "!**/__tests__/**", "!**/coverage/**", "!**/.meeko/**"]);
    const explicit = await resolveServe({ optimizeDeps: { entries: "src/*.html" } });
    assert.deepEqual(explicit.environments.client!.optimizeDeps.entries, ["src/*.html", "!**/.meeko/**"]);
    // An input names the scan entries itself; explicit entries would replace it.
    const input = await resolveServe({ build: { rolldownOptions: { input: "main.js" } } });
    assert.equal(input.environments.client!.optimizeDeps.entries, undefined);
    // The editor bridge descriptors are denied, and Vite's default denials stay.
    const vite = await resolveConfig({ root: project.root, configFile: false, logLevel: "silent" }, "serve");
    assert.deepEqual(crawled.server.fs.deny, [...vite.server.fs.deny, "**/.meeko/dev/**"]);
    const custom = await resolveServe({ server: { fs: { deny: ["secret.txt"] } } });
    assert.deepEqual(custom.server.fs.deny, ["secret.txt", "**/.meeko/dev/**"], "The user's list replaces Vite's defaults, as without the plugin");
    // `server.watch: null` turns the watcher off and stays off.
    const unwatched = await resolveServe({ server: { watch: null } });
    assert.equal(unwatched.server.watch, null);
    assert.deepEqual(unwatched.server.fs.deny, [...vite.server.fs.deny, "**/.meeko/dev/**"]);
    const build = await resolveConfig({ root: project.root, configFile: false, logLevel: "silent", plugins: [meeko()] }, "build");
    assert.equal(build.optimizeDeps.entries, undefined);
  } finally {
    await project.remove();
  }
});

test("Vite neither watches nor scans stale .meeko files and still watches the generated entries", { timeout: 30_000 }, async (context) => {
  let server: ViteDevServer | undefined;
  const root = await tempProject(context, "dev-stale", () => server?.close());
  const files: Record<string, string> = {
    "index.html": '<!doctype html><script type="module">import "scan-probe/root";</script>\n',
    "probe.js": "export {};\n",
    // A previous build and a stale install: prerendered HTML and package manifests.
    ".meeko/output/public/index.html": '<!doctype html><script type="module">import "scan-probe/stale";</script>\n',
    ".meeko/stale/install/package.json": '{"name":"stale"}\n',
    ".meeko/check/probe/tsconfig.json": "{}\n",
    ".meeko/generated/entry.ts": "export const value = 1;\n",
  };
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(root, name, ".."), { recursive: true });
    await writeFile(join(root, name), content);
  }
  // The dependency scanner resolves the bare imports of each HTML entry it crawls.
  const scanned: string[] = [];
  const recorder: Plugin = {
    name: "record-scan",
    resolveId(id, _importer, options) {
      if (!id.startsWith("scan-probe/")) return null;
      if ((options as { scan?: boolean }).scan) scanned.push(id);
      return join(root, "probe.js");
    },
  };
  // A cache of its own: a cached optimization from an earlier run would skip the scan.
  server = await createServer({ root, configFile: false, logLevel: "silent", cacheDir: join(root, ".vite-cache"), plugins: [meeko(), recorder], server: { middlewareMode: true, hmr: false } });
  await server.environments.client.depsOptimizer?.scanProcessing;
  assert.deepEqual(scanned, ["scan-probe/root"]);
  const watcher = server.watcher as typeof server.watcher & { _readyEmitted?: boolean };
  if (!watcher._readyEmitted) await once(watcher, "ready");
  const meekoDirectory = normalizePath(join(root, ".meeko"));
  const listing = () => Object.fromEntries(Object.entries(watcher.getWatched()).map(([directory, entries]) => [normalizePath(directory), entries]));
  // On a slow runner chokidar can still be adding `.meeko/generated` after `ready`;
  // an edit written before that would never produce an event.
  for (let waited = 0; !(listing()[`${meekoDirectory}/generated`]?.includes("entry.ts")) && waited < 10_000; waited += 50) {
    await new Promise((done) => setTimeout(done, 50));
  }
  const watched = listing();
  assert.ok(watched[`${meekoDirectory}/generated`]?.includes("entry.ts"), JSON.stringify(watched));
  // The listing of `.meeko` can still be filling in right after `ready` on a slow
  // runner; only `generated` may appear in it, and the change event below proves it is watched.
  assert.ok((watched[meekoDirectory] ?? []).every((entry) => entry === "generated"), JSON.stringify(watched));
  assert.ok(!Object.keys(watched).some((directory) => directory.startsWith(`${meekoDirectory}/`) && directory !== `${meekoDirectory}/generated`), JSON.stringify(watched));
  // An edit of a generated entry still reaches Vite's hot update.
  const entry = join(root, ".meeko", "generated", "entry.ts");
  const changed = new Promise<string>((done) => watcher.on("change", (file) => { if (resolve(file) === entry) done(file); }));
  await writeFile(entry, "export const value = 2;\n");
  await changed;
});

test("discovery sources cover routes, layouts, middleware and server modules of every source root", () => {
  const root = resolve("project");
  const layer = resolve("project", "layers", "base");
  for (const path of ["app/pages/x.meeko", "app/layouts/default.meeko", "app/middleware/auth.ts", "app/error.meeko", "app/app.meeko",
    "server/api/users.get.ts", "server/rpc/notes.ts", "server/socket/chat.ts", "server/middleware/log.ts"]) {
    assert.ok(isDiscoverySource(join(root, path), [root]), path);
    assert.ok(isDiscoverySource(join(layer, path), [root, layer]), `layer ${path}`);
  }
  for (const path of ["app/components/Card.meeko", "server/utils/db.ts", ".meeko/check/x/tsconfig.json", "app/app.meeko.bak", "../outside/app/pages/x.meeko"]) {
    assert.ok(!isDiscoverySource(join(root, path), [root]), path);
  }
});

test("the dev app reloader builds one app per burst of changes and waits for Vite restarts", async () => {
  const deferred = () => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
  };
  const tick = () => new Promise((done) => setTimeout(done, 5));
  const replaced: number[] = [];
  let version = 0;
  const reloader = createDevAppReloader(0, async (prior) => { replaced.push(prior); return ++version; }, 1);
  assert.equal(await reloader.current, 0);

  // Discovery events of one tree change coalesce.
  reloader.rebuild();
  reloader.rebuild();
  assert.equal(await reloader.current, 1);
  assert.deepEqual(replaced, [0]);

  // A restart and a discovery change at once: one app, built after the restart, and the
  // requests in between wait for it instead of reaching the app of the closed runner.
  const restart = deferred();
  reloader.rebuild();
  void reloader.restart(() => restart.promise);
  reloader.rebuild();
  let served: number | undefined;
  void reloader.current.then((value) => { served = value; });
  await tick();
  assert.equal(served, undefined);
  assert.deepEqual(replaced, [0]);
  restart.resolve();
  assert.equal(await reloader.current, 2);
  assert.deepEqual(replaced, [0, 1]);

  // Overlapping restarts are all awaited; a failed one still replaces the app.
  const first = deferred();
  const second = deferred();
  void reloader.restart(() => first.promise);
  const failed = reloader.restart(() => second.promise);
  first.resolve();
  await tick();
  assert.deepEqual(replaced, [0, 1]);
  second.reject(new Error("restart failed"));
  await assert.rejects(failed, /restart failed/);
  assert.equal(await reloader.current, 3);
  assert.deepEqual(replaced, [0, 1, 2]);

  // A restart that starts while an app is being built waits for that build, which learns it was
  // superseded, and queues one more app after the restart.
  const building = deferred();
  const later = deferred();
  const superseded: boolean[] = [];
  const slow = createDevAppReloader(0, async (prior, stale) => {
    if (prior === 0) await building.promise;
    superseded.push(stale());
    return prior + 1;
  }, 1);
  slow.rebuild();
  await tick();
  let started = false;
  void slow.restart(() => { started = true; return later.promise; });
  await tick();
  assert.equal(started, false);
  building.resolve();
  await tick();
  assert.equal(started, true);
  later.resolve();
  assert.equal(await slow.current, 2);
  assert.deepEqual(superseded, [true, false]);
});

test("a Vite restart waits for the requests in flight and later requests wait for the new app", async () => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
  };
  const tick = () => new Promise((done) => setTimeout(done, 5));
  const reloader = createDevAppReloader("old", async () => "new", 1);
  const inFlight = deferred();
  const first = reloader.use(async (app) => { await inFlight.promise; return app; });
  await tick();
  const events: string[] = [];
  const restart = deferred();
  const restarted = reloader.restart(() => { events.push("restart"); return restart.promise; });
  const later = reloader.use(async (app) => { events.push(`later:${app}`); return app; });
  await tick();
  // The restart would close the module runner the first request still loads through.
  assert.deepEqual(events, []);
  inFlight.resolve();
  assert.equal(await first, "old");
  await tick();
  assert.deepEqual(events, ["restart"]);
  restart.resolve();
  await restarted;
  assert.equal(await later, "new");
  assert.deepEqual(events, ["restart", "later:new"]);

  // A request that never settles delays the restart only up to the drain timeout.
  const stuck = createDevAppReloader(0, async (prior) => prior + 1, 1, 20);
  void stuck.use(() => new Promise<never>(() => {}));
  await tick();
  let began = false;
  await stuck.restart(async () => { began = true; });
  assert.equal(began, true);
  assert.equal(await stuck.current, 1);
});

test("meeko dev serves a page added or removed while it runs", { timeout: 60_000 }, async (context) => {
  let child: ChildProcess | undefined;
  const root = await tempProject(context, "dev-watch", () => stopChild(child));
  const repository = repositoryRoot;
  await initFrameworkProject(root);
  await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
  await symlink(repository, join(root, "node_modules", "@meekojs", "meeko"), "junction");
  await symlink(join(repository, "node_modules", "vite"), join(root, "node_modules", "vite"), "junction");
  const port = await freePort();
  const hmrPort = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const running = spawn(process.execPath, [join(repository, "dist", "cli.js"), "dev", root], {
    cwd: root, env: { ...process.env, PORT: String(port), MEEKO_HMR_PORT: String(hmrPort) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  child = running;
  let logs = "";
  running.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  running.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  await new Promise<void>((done, fail) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (logs.includes(origin)) { clearInterval(timer); done(); }
      else if (running.exitCode !== null) { clearInterval(timer); fail(new Error(logs)); }
      else if (Date.now() - start > 20_000) { clearInterval(timer); fail(new Error(`Starter did not listen: ${logs}`)); }
    }, 25);
  });
  const get = async (): Promise<{ status: number; html: string }> => {
    const response = await fetch(`${origin}/fresh`, { headers: { accept: "text/html" } });
    return { status: response.status, html: await response.text() };
  };
  const waitFor = async (accept: (result: { status: number; html: string }) => boolean): Promise<{ status: number; html: string }> => {
    const start = Date.now();
    let result = await get();
    while (!accept(result) && Date.now() - start < 20_000) {
      await new Promise((done) => setTimeout(done, 100));
      result = await get();
    }
    return result;
  };
  assert.equal((await get()).status, 404, logs);
  const pageFile = join(root, "app", "pages", "fresh.meeko");
  await writeFile(pageFile, '<script lang="ts">\nconst label = "fresh page";\n</script>\n<template><p id="fresh">{label}</p></template>\n');
  const added = await waitFor((result) => result.status === 200);
  assert.equal(added.status, 200, logs);
  assert.match(added.html, /fresh page/);
  await unlink(pageFile);
  const removed = await waitFor((result) => result.status === 404);
  assert.equal(removed.status, 404, logs);
  // A generated check directory does not make Vite reload the app.
  await mkdir(join(root, ".meeko", "check", "probe"), { recursive: true });
  await writeFile(join(root, ".meeko", "check", "probe", "tsconfig.json"), "{}\n");
  await new Promise((done) => setTimeout(done, 300));
  assert.doesNotMatch(logs, /tsconfig file detected/);
});

// Vite replaces its watcher when it restarts (a changed `.env`, `server.restart()`):
// the discovery listeners must follow the new one, once.
test("meeko dev serves a page added after Vite restarts", { timeout: 60_000 }, async (context) => {
  let child: ChildProcess | undefined;
  const root = await tempProject(context, "dev-watch-restart", () => stopChild(child));
  const repository = repositoryRoot;
  await initFrameworkProject(root);
  await writeFile(join(root, ".env"), "MEEKO_TEST_RESTART=1\n");
  await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
  await symlink(repository, join(root, "node_modules", "@meekojs", "meeko"), "junction");
  await symlink(join(repository, "node_modules", "vite"), join(root, "node_modules", "vite"), "junction");
  const port = await freePort();
  const hmrPort = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const running = spawn(process.execPath, [join(repository, "dist", "cli.js"), "dev", root], {
    cwd: root, env: { ...process.env, PORT: String(port), MEEKO_HMR_PORT: String(hmrPort), MEEKO_EDITOR_BRIDGE: "0" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  child = running;
  let logs = "";
  running.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  running.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  const until = async (condition: () => boolean | Promise<boolean>, message: () => string, timeout = 20_000): Promise<void> => {
    const start = Date.now();
    while (!(await condition())) {
      if (Date.now() - start > timeout) throw new Error(message());
      await new Promise((done) => setTimeout(done, 50));
    }
  };
  await until(() => logs.includes(origin) || running.exitCode !== null, () => `meeko dev did not listen: ${logs}`, 30_000);
  assert.equal(running.exitCode, null, logs);
  const status = async (path: string): Promise<number> => {
    const response = await fetch(`${origin}${path}`, { headers: { accept: "text/html" } });
    await response.body?.cancel();
    return response.status;
  };
  assert.equal(await status("/fresh"), 404, logs);

  // A changed `.env` restarts Vite: it closes the old watcher and creates a new one. Twice,
  // so the listeners follow every restart and not only the first.
  for (const restart of [1, 2]) {
    await writeFile(join(root, ".env"), `MEEKO_TEST_RESTART=${restart + 1}\n`);
    await until(() => logs.split("server restarted").length - 1 === restart, () => `Vite did not restart (${restart}): ${logs}`);
  }

  const pageFile = join(root, "app", "pages", "fresh.meeko");
  await writeFile(pageFile, '<script lang="ts">\nconst label = "after restart";\n</script>\n<template><p>{label}</p></template>\n');
  await until(async () => await status("/fresh") === 200, () => `The page added after the restart was not served: ${logs}`);
  const page = await fetch(`${origin}/fresh`, { headers: { accept: "text/html" } });
  assert.match(await page.text(), /after restart/);
  await unlink(pageFile);
  await until(async () => await status("/fresh") === 404, () => `The page removed after the restart was still served: ${logs}`);
  // One rebuild per change: a duplicated listener would rebuild again, and a rebuild that fails reports an error.
  assert.equal(running.exitCode, null, logs);
  assert.doesNotMatch(logs, /request error/);
});

// A restart also closes the module runner that loaded the app and its pages: the app must be
// created again on the new one, or every page answers 500 until a page is added or removed.
test("meeko dev keeps serving pages across Vite restarts", { timeout: 90_000 }, async (context) => {
  let child: ChildProcess | undefined;
  const root = await tempProject(context, "dev-restart", () => stopChild(child));
  const repository = repositoryRoot;
  await initFrameworkProject(root);
  await writeFile(join(root, ".env"), "MEEKO_TEST_RESTART=1\n");
  // Counts the apps created: the entry imports the runtime once per app.
  const runtimeLoaded = "[meeko-test] runtime loaded";
  await appendFile(join(root, "server", "runtime.ts"), `process.stdout.write(${JSON.stringify(`${runtimeLoaded}\n`)});\n`);
  await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
  await symlink(repository, join(root, "node_modules", "@meekojs", "meeko"), "junction");
  await symlink(join(repository, "node_modules", "vite"), join(root, "node_modules", "vite"), "junction");
  const port = await freePort();
  const hmrPort = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const running = spawn(process.execPath, [join(repository, "dist", "cli.js"), "dev", root], {
    cwd: root, env: { ...process.env, PORT: String(port), MEEKO_HMR_PORT: String(hmrPort), MEEKO_EDITOR_BRIDGE: "0" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  child = running;
  let logs = "";
  running.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  running.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  const until = async (condition: () => boolean | Promise<boolean>, message: () => string, timeout = 20_000): Promise<void> => {
    const start = Date.now();
    while (!(await condition())) {
      if (Date.now() - start > timeout) throw new Error(message());
      await new Promise((done) => setTimeout(done, 50));
    }
  };
  const count = (text: string): number => logs.split(text).length - 1;
  await until(() => logs.includes(origin) || running.exitCode !== null, () => `meeko dev did not listen: ${logs}`, 30_000);
  assert.equal(running.exitCode, null, logs);
  const status = async (path: string): Promise<number> => {
    const response = await fetch(`${origin}${path}`, { headers: { accept: "text/html" } });
    await response.body?.cancel();
    return response.status;
  };
  assert.equal(await status("/"), 200, logs);
  assert.equal(count(runtimeLoaded), 1, logs);

  // Requests sent while Vite restarts wait for the new app instead of failing.
  const statuses: number[] = [];
  let polling = true;
  const poller = (async () => {
    while (polling) {
      statuses.push(await status("/"));
      await new Promise((done) => setTimeout(done, 10));
    }
  })();
  try {
    // Twice, so the app follows every restart and not only the first.
    for (const restart of [1, 2]) {
      await writeFile(join(root, ".env"), `MEEKO_TEST_RESTART=${restart + 1}\n`);
      await until(() => count("server restarted") === restart, () => `Vite did not restart (${restart}): ${logs}`);
      assert.equal(await status("/"), 200, logs);
      // One app per restart.
      assert.equal(count(runtimeLoaded), restart + 1, logs);
    }
  } finally {
    polling = false;
    await poller;
  }
  assert.ok(statuses.length > 0 && statuses.every((value) => value === 200), `${statuses.join(",")}\n${logs}`);

  // A restart and a discovery change at once: the new app serves the added page.
  const pageFile = join(root, "app", "pages", "fresh.meeko");
  await writeFile(pageFile, '<script lang="ts">\nconst label = "with restart";\n</script>\n<template><p>{label}</p></template>\n');
  await writeFile(join(root, ".env"), "MEEKO_TEST_RESTART=4\n");
  await until(() => count("server restarted") === 3, () => `Vite did not restart (3): ${logs}`);
  await until(async () => await status("/fresh") === 200, () => `The page added with the restart was not served: ${logs}`);
  assert.equal(await status("/"), 200, logs);
  assert.equal(running.exitCode, null, logs);
  assert.doesNotMatch(logs, /request error|module runner has been closed/i);
});
