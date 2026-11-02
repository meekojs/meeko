import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { type watch as fsWatch, type FSWatcher } from "node:fs";
import { appendFile, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { mock } from "node:test";
import { pathToFileURL } from "node:url";

import { createSettleDebounce, findLinkedMeeko, findLinkedPackages, linkWatchEnabled, warnLinkedMeekoRebuilds, watchLinkedMeeko } from "../src/framework/dev-link.ts";

/** A junction on Windows (no privilege needed), a directory symlink elsewhere. */
const link = (target: string, path: string) => symlink(target, path, process.platform === "win32" ? "junction" : "dir");

/** Writes a minimal `@meekojs/meeko` package at `directory`. */
async function fakeMeeko(directory: string): Promise<void> {
  await mkdir(join(directory, "dist"), { recursive: true });
  await writeFile(join(directory, "package.json"), JSON.stringify({ name: "@meekojs/meeko", type: "module", exports: { ".": { default: "./dist/index.js" } } }));
  await writeFile(join(directory, "dist", "index.js"), "export {};\n");
}

async function sandbox(context: { after(fn: () => Promise<void>): void }): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "meeko-dev-link-")));
  context.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return root;
}

test("a Meeko installed in node_modules is not linked", async (context) => {
  const root = await sandbox(context);
  const app = join(root, "app");
  await fakeMeeko(join(app, "node_modules", "@meekojs", "meeko"));
  assert.equal(findLinkedMeeko(app), undefined);
});

test("a Meeko in the pnpm store, reached through a link, is not linked", async (context) => {
  const root = await sandbox(context);
  const app = join(root, "app");
  // pnpm's layout: node_modules/@meekojs/meeko links into node_modules/.pnpm.
  const store = join(app, "node_modules", ".pnpm", "@meekojs+meeko@1.2.0", "node_modules", "@meekojs", "meeko");
  await fakeMeeko(store);
  await mkdir(join(app, "node_modules", "@meekojs"), { recursive: true });
  await link(store, join(app, "node_modules", "@meekojs", "meeko"));
  assert.equal(findLinkedMeeko(app), undefined);
  // A store shared by a workspace, above the app's own node_modules.
  const workspace = join(root, "workspace");
  const shared = join(workspace, "node_modules", ".pnpm", "@meekojs+meeko@1.2.0", "node_modules", "@meekojs", "meeko");
  await fakeMeeko(shared);
  const nested = join(workspace, "apps", "web");
  await mkdir(join(nested, "node_modules", "@meekojs"), { recursive: true });
  await link(shared, join(nested, "node_modules", "@meekojs", "meeko"));
  assert.equal(findLinkedMeeko(nested), undefined);
});

test("a Meeko linked from a checkout is found with its dist", async (context) => {
  const root = await sandbox(context);
  const checkout = join(root, "meeko");
  await fakeMeeko(checkout);
  const app = join(root, "app");
  await mkdir(join(app, "node_modules", "@meekojs"), { recursive: true });
  await link(checkout, join(app, "node_modules", "@meekojs", "meeko"));
  assert.deepEqual(findLinkedMeeko(app), { directory: checkout, dist: join(checkout, "dist") });
  // From a subdirectory of the app too, as Node resolves it.
  await mkdir(join(app, "app", "pages"), { recursive: true });
  assert.deepEqual(findLinkedMeeko(join(app, "app", "pages")), { directory: checkout, dist: join(checkout, "dist") });
});

test("an app that does not resolve Meeko has nothing to watch", async (context) => {
  const root = await sandbox(context);
  const app = join(root, "app");
  await mkdir(app, { recursive: true });
  assert.equal(findLinkedMeeko(app), undefined);
  assert.equal(findLinkedMeeko(join(root, "missing")), undefined);
});

test("MEEKO_LINK_WATCH=0 and a supervised server turn the link watch off", () => {
  assert.equal(linkWatchEnabled({}), true);
  assert.equal(linkWatchEnabled({ MEEKO_LINK_WATCH: "1" }), true);
  assert.equal(linkWatchEnabled({ MEEKO_LINK_WATCH: "0" }), false);
  assert.equal(linkWatchEnabled({ MEEKO_DEV_SUPERVISED: "1" }), false);
});

test("the settle debounce runs once after the last trigger", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const run = mock.fn();
  const debounce = createSettleDebounce(400, run);
  // A build writes files in bursts; each write extends the quiet period.
  for (let index = 0; index < 50; index++) {
    debounce.trigger();
    context.mock.timers.tick(100);
  }
  assert.equal(run.mock.callCount(), 0);
  assert.equal(debounce.pending, true);
  context.mock.timers.tick(299);
  assert.equal(run.mock.callCount(), 0);
  context.mock.timers.tick(1);
  assert.equal(run.mock.callCount(), 1);
  assert.equal(debounce.pending, false);
  // A later build restarts again.
  debounce.trigger();
  context.mock.timers.tick(400);
  assert.equal(run.mock.callCount(), 2);
  // A cancelled run never happens.
  debounce.trigger();
  debounce.cancel();
  context.mock.timers.tick(1000);
  assert.equal(run.mock.callCount(), 2);
  assert.equal(debounce.pending, false);
});

const pause = (milliseconds: number) => new Promise((done) => setTimeout(done, milliseconds));

async function until(condition: () => boolean, message: () => string, timeout = 10_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error(message());
    await pause(25);
  }
}

test("the link watch reports writes to the linked build, not reads of it", { timeout: 30_000 }, async (context) => {
  const root = await sandbox(context);
  const checkout = join(root, "meeko");
  await fakeMeeko(checkout);
  await mkdir(join(checkout, "dist", "framework"), { recursive: true });
  const server = join(checkout, "dist", "framework", "server.js");
  await writeFile(server, "export {};\n");
  const files = [join(checkout, "package.json"), join(checkout, "dist", "index.js"), server];
  // Last read hours ago: Windows updates the access time on the next read and reports it as a
  // change (with access time updates on), as when a fresh `meeko dev` loads a build from yesterday.
  const hoursAgo = new Date(Date.now() - 3 * 3_600_000);
  for (const file of files) await utimes(file, hoursAgo, (await stat(file)).mtime);
  await pause(200);
  let changes = 0;
  const watcher = watchLinkedMeeko({ directory: checkout, dist: join(checkout, "dist") }, () => { changes++; });
  context.after(() => watcher.close());
  await pause(300);
  for (const file of files) await readFile(file);
  await readdir(join(checkout, "dist"), { recursive: true });
  await pause(800);
  assert.equal(changes, 0, "Reading the build is not a rebuild");
  await appendFile(server, "\n");
  await until(() => changes > 0, () => "A write to dist was not reported");
  const afterWrite = changes;
  await writeFile(join(checkout, "dist", "added.js"), "export {};\n");
  await until(() => changes > afterWrite, () => "A new file in dist was not reported");
  const afterAdd = changes;
  await writeFile(files[0]!, `${await readFile(files[0]!, "utf8")}\n`);
  await until(() => changes > afterAdd, () => "A change of package.json was not reported");
});

test("an unsupervised dev warns once per settled rebuild of the linked Meeko", { timeout: 30_000 }, async (context) => {
  const root = await sandbox(context);
  const checkout = join(root, "meeko");
  await fakeMeeko(checkout);
  const previous = process.env.MEEKO_LINK_WATCH;
  process.env.MEEKO_LINK_WATCH = "0";
  context.after(() => {
    if (previous === undefined) delete process.env.MEEKO_LINK_WATCH;
    else process.env.MEEKO_LINK_WATCH = previous;
  });
  const lines: string[] = [];
  const warning = warnLinkedMeekoRebuilds({ directory: checkout, dist: join(checkout, "dist") }, (text) => { lines.push(text); }, 150, { loadedAt: Date.now() });
  context.after(() => warning.close());
  await pause(300);
  // A build writes in bursts: one warning once it settles.
  const index = join(checkout, "dist", "index.js");
  for (let round = 0; round < 5; round++) {
    await appendFile(index, "\n");
    await pause(40);
  }
  await until(() => lines.length > 0, () => "The rebuild was not reported");
  await pause(600);
  assert.equal(lines.length, 1, lines.join(""));
  assert.equal(lines[0], `[meeko] Meeko enlazado cambió (${join(checkout, "dist")}), pero este meeko dev no se reinicia solo (MEEKO_LINK_WATCH=0): `
    + "el servidor sigue con el código anterior y el navegador recibe el nuevo. Reinicia meeko dev.\n");
  // The next build warns again; a closed warning stays quiet.
  await appendFile(index, "\n");
  await until(() => lines.length === 2, () => `The second rebuild was not reported: ${lines.join("")}`);
  warning.close();
  await appendFile(index, "\n");
  await pause(600);
  assert.equal(lines.length, 2);
});

test("findLinkedPackages finds the linked packages built for Meeko, also through another one", async (context) => {
  const root = await sandbox(context);
  const app = join(root, "apps", "site");
  const write = async (directory: string, manifest: object, dist = true): Promise<void> => {
    await mkdir(dist ? join(directory, "dist") : directory, { recursive: true });
    await writeFile(join(directory, "package.json"), JSON.stringify(manifest));
  };
  await write(app, { dependencies: { "@meekojs/docs": "workspace:*", "plain-tool": "workspace:*", registry: "1.0.0" } }, false);
  await write(join(root, "packages", "docs"), { name: "@meekojs/docs", peerDependencies: { "@meekojs/meeko": "*" }, dependencies: { "@meekojs/ui": "workspace:*" } }, false);
  await write(join(root, "packages", "ui"), { name: "@meekojs/ui", peerDependencies: { "@meekojs/meeko": "*" }, dependencies: { "@meekojs/docs": "workspace:*" } });
  await write(join(root, "packages", "plain"), { name: "plain-tool" });
  await write(join(app, "node_modules", "registry"), { name: "registry", dependencies: { "@meekojs/meeko": "*" } });
  await mkdir(join(app, "node_modules", "@meekojs"), { recursive: true });
  await link(join(root, "packages", "docs"), join(app, "node_modules", "@meekojs", "docs"));
  await link(join(root, "packages", "plain"), join(app, "node_modules", "plain-tool"));
  await mkdir(join(root, "packages", "docs", "node_modules", "@meekojs"), { recursive: true });
  await link(join(root, "packages", "ui"), join(root, "packages", "docs", "node_modules", "@meekojs", "ui"));
  await mkdir(join(root, "packages", "ui", "node_modules", "@meekojs"), { recursive: true });
  // A cycle between linked packages ends: each one is visited once.
  await link(join(root, "packages", "docs"), join(root, "packages", "ui", "node_modules", "@meekojs", "docs"));
  const ui = join(root, "packages", "ui");
  // `docs` has no `dist`, `plain-tool` does not use Meeko and `registry` is an install.
  assert.deepEqual(findLinkedPackages(app), [{ directory: ui, dist: join(ui, "dist") }]);
  assert.deepEqual(findLinkedPackages(join(root, "missing")), []);
});

/** A supervisor whose server fails while `ready` is missing, as one that reads a `dist` halfway. */
async function supervisor(context: { after(fn: () => Promise<void>): void }, options: { failAfter?: number; ready?: boolean } = {}) {
  const root = await sandbox(context);
  const meeko = join(root, "meeko");
  const ui = join(root, "ui");
  await mkdir(join(meeko, "dist"), { recursive: true });
  await mkdir(join(ui, "dist"), { recursive: true });
  const ready = join(root, "ready");
  const log = join(root, "log");
  if (options.ready) await writeFile(ready, "");
  await writeFile(log, "");
  const script = join(root, "supervisor.mts");
  const module = pathToFileURL(resolve("src/framework/dev-link.ts")).href;
  await writeFile(script, `import { appendFileSync, existsSync } from "node:fs";
import { isSupervisedDevelopment, runSupervisedDevelopment, superviseDevelopment } from ${JSON.stringify(module)};
const log = ${JSON.stringify(log)};
if (isSupervisedDevelopment()) {
  appendFileSync(log, "start\\n");
  await new Promise((done) => setTimeout(done, ${options.failAfter ?? 0}));
  await runSupervisedDevelopment(async () => {
    if (!existsSync(${JSON.stringify(ready)})) throw new Error("halfway");
    appendFileSync(log, "ready\\n");
    return {};
  }, async () => {}).catch(() => { appendFileSync(log, "fail\\n"); process.exit(1); });
} else {
  const dir = (directory) => ({ directory, dist: directory + "/dist" });
  process.exitCode = await superviseDevelopment(dir(${JSON.stringify(meeko)}), { delay: 100, stopTimeout: 1000, related: [dir(${JSON.stringify(ui)})] });
}
`);
  const running = spawn(process.execPath, ["--import", "tsx", script], { cwd: resolve("."), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let output = "";
  running.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  running.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  const exited = new Promise<number | null>((done) => { running.once("exit", (code) => done(code)); });
  context.after(async () => {
    running.kill();
    await exited;
  });
  const lines = async (): Promise<string[]> => (await readFile(log, "utf8")).split("\n").filter(Boolean);
  const count = async (line: string): Promise<number> => (await lines()).filter((item) => item === line).length;
  const until = async (line: string, times: number): Promise<void> => {
    const start = Date.now();
    while (await count(line) < times) {
      if (Date.now() - start > 30_000) throw new Error(`${times} × ${line} did not arrive: ${(await lines()).join()}\n${output}`);
      await new Promise((done) => setTimeout(done, 25));
    }
  };
  return { meeko, ui, ready, count, until, exited, output: () => output };
}

test("a server that fails on a package being written comes back when that package settles", { timeout: 90_000 }, async (context) => {
  const { meeko, ui, ready, count, until, output } = await supervisor(context, { ready: true });
  await until("ready", 1);
  // Meeko is rebuilt and the restart finds `@meekojs/ui` halfway. Before, nothing else restarted it.
  await rm(ready);
  await writeFile(join(meeko, "dist", "index.js"), "export {};\n");
  await until("fail", 1);
  await new Promise((done) => setTimeout(done, 500));
  assert.equal(await count("start"), 2, "nothing was written since it started: it is not retried");
  assert.match(output(), /próximo cambio de .*meeko.*ui/s);
  await writeFile(join(ui, "dist", "index.js"), "export {};\n");
  await writeFile(ready, "");
  await until("ready", 2);
  // A build of that package does not restart a healthy server.
  await writeFile(join(ui, "dist", "index.js"), "export const again = 1;\n");
  await new Promise((done) => setTimeout(done, 500));
  assert.equal(await count("start"), 3);
});

test("a server that read a package while it was written starts again by itself, waiting for it to settle", { timeout: 90_000 }, async (context) => {
  const { ui, ready, count, until } = await supervisor(context, { failAfter: 800 });
  await until("start", 1);
  await writeFile(join(ui, "dist", "index.js"), "export {};\n");
  await until("fail", 1);
  await writeFile(ready, "");
  await until("ready", 1);
  assert.equal(await count("start"), 2);
});

test("a first server that fails with nothing written ends the supervisor with its code", { timeout: 90_000 }, async (context) => {
  const { count, exited } = await supervisor(context);
  assert.equal(await exited, 1);
  assert.equal(await count("start"), 1);
});

test("the starts of a server that keeps failing while its packages are written are bounded", { timeout: 90_000 }, async (context) => {
  const { ui, count, until, output } = await supervisor(context, { failAfter: 1500 });
  const deadline = Date.now() + 60_000;
  const waits = () => output().match(/próximo cambio/g)?.length ?? 0;
  const write = () => writeFile(join(ui, "dist", "index.js"), `export const at = ${Date.now()};\n`);
  while (!output().includes("reintento 6 de 6")) {
    assert.ok(Date.now() < deadline, output());
    await write();
    await pause(150);
  }
  // The last server is written under as well, so only the limit stops the retries. The write comes
  // long before it fails: one the watch reports after that (100 ms later) is the next change, which
  // starts it again by design.
  await until("start", 7);
  await write();
  while (waits() < 1) {
    assert.ok(Date.now() < deadline, output());
    await pause(25);
  }
  // The first start, its six retries, and then it waits: without writes nothing starts it again.
  assert.equal(await count("start"), 7, output());
  await pause(2000);
  assert.equal(await count("start"), 7, output());
  // The next change starts it once more, and it waits again without retrying.
  await write();
  await until("fail", 8);
  await pause(2000);
  assert.equal(await count("start"), 8, output());
  assert.equal(waits(), 2, output());
});

/** A `fs.watch` whose events the test fires by hand: the platform does not produce them on demand. */
function fakeWatch() {
  const listeners = new Map<string, (event: string, name: string | null) => void>();
  const watchers = new Map<string, EventEmitter>();
  const watch = ((path: string, _options: unknown, listener: (event: string, name: string | null) => void) => {
    const watcher = Object.assign(new EventEmitter(), { close() {} });
    listeners.set(path, listener);
    watchers.set(path, watcher);
    return watcher as unknown as FSWatcher;
  }) as unknown as typeof fsWatch;
  return {
    watch,
    emit: (path: string, event: string, name: string | null) => listeners.get(path)?.(event, name),
    fail: (path: string) => watchers.get(path)?.emit("error", new Error("EPERM")),
  };
}

test("events that are not writes do not report the linked build; real builds do", { timeout: 30_000 }, async (context) => {
  const root = await sandbox(context);
  const checkout = join(root, "meeko");
  await fakeMeeko(checkout);
  const dist = join(checkout, "dist");
  const fake = fakeWatch();
  let changes = 0;
  const watcher = watchLinkedMeeko({ directory: checkout, dist }, () => { changes++; }, { watch: fake.watch, verifyDelay: 50 });
  context.after(() => watcher.close());
  // Renames, events without a name, a missing file and watcher errors, with nothing written.
  fake.emit(dist, "rename", "index.js");
  fake.emit(dist, "change", null);
  fake.emit(dist, "change", "gone.js");
  fake.emit(checkout, "change", null);
  fake.emit(checkout, "rename", "package.json");
  fake.emit(checkout, "rename", "dist");
  fake.fail(dist);
  await pause(300);
  assert.equal(changes, 0, "Events without a write are not a rebuild");
  // A real write is reported even when it comes with a bare event.
  await appendFile(join(dist, "index.js"), "\n");
  fake.emit(dist, "change", null);
  await until(() => changes === 1, () => "The write was not reported");
  await pause(200);
  assert.equal(changes, 1, "One write, one report");
  // A build that rewrites nothing is quiet again.
  fake.emit(dist, "rename", "index.js");
  await pause(200);
  assert.equal(changes, 1);
  // dist removed and created again with other content.
  await rm(dist, { recursive: true });
  fake.emit(checkout, "rename", "dist");
  await pause(20);
  await mkdir(dist);
  await writeFile(join(dist, "index.js"), "export const x = 1;\n");
  fake.emit(checkout, "rename", "dist");
  await until(() => changes === 2, () => "dist recreated was not reported");
  // package.json written.
  await writeFile(join(checkout, "package.json"), `${await readFile(join(checkout, "package.json"), "utf8")}\n`);
  fake.emit(checkout, "change", "package.json");
  await until(() => changes === 3, () => "package.json was not reported");
  // A file renamed in dist: the paths differ.
  await rename(join(dist, "index.js"), join(dist, "main.js"));
  fake.emit(dist, "rename", "main.js");
  await until(() => changes === 4, () => "A renamed file was not reported");
});

test("a write after the comparison is reported by its own event", { timeout: 30_000 }, async (context) => {
  const root = await sandbox(context);
  const checkout = join(root, "meeko");
  await fakeMeeko(checkout);
  const dist = join(checkout, "dist");
  const fake = fakeWatch();
  let changes = 0;
  const watcher = watchLinkedMeeko({ directory: checkout, dist }, () => {
    changes++;
    // The build keeps writing right after the comparison.
    if (changes === 1) void appendFile(join(dist, "late.js"), "x").then(() => fake.emit(dist, "change", "late.js"));
  }, { watch: fake.watch, verifyDelay: 30 });
  context.after(() => watcher.close());
  await appendFile(join(dist, "index.js"), "\n");
  fake.emit(dist, "change", "index.js");
  await until(() => changes === 2, () => `The second write was lost (${changes})`);
});

test("a build written after the process loaded it, before the watch, is reported once", { timeout: 30_000 }, async (context) => {
  const root = await sandbox(context);
  const checkout = join(root, "meeko");
  await fakeMeeko(checkout);
  const linked = { directory: checkout, dist: join(checkout, "dist") };
  const fake = fakeWatch();
  let changes = 0;
  const loaded = watchLinkedMeeko(linked, () => { changes++; }, { watch: fake.watch, verifyDelay: 30, loadedAt: Date.now() - 60_000 });
  context.after(() => loaded.close());
  await until(() => changes === 1, () => "The build written before the watch was not reported");
  await pause(200);
  assert.equal(changes, 1);
  let later = 0;
  const current = watchLinkedMeeko(linked, () => { later++; }, { watch: fake.watch, verifyDelay: 30, loadedAt: Date.now() + 60_000 });
  context.after(() => current.close());
  await pause(200);
  assert.equal(later, 0);
});

test("an unsupervised dev stays quiet for events that wrote nothing", { timeout: 30_000 }, async (context) => {
  const root = await sandbox(context);
  const checkout = join(root, "meeko");
  await fakeMeeko(checkout);
  const dist = join(checkout, "dist");
  const fake = fakeWatch();
  const lines: string[] = [];
  const warning = warnLinkedMeekoRebuilds({ directory: checkout, dist }, (text) => { lines.push(text); }, 50, { watch: fake.watch, verifyDelay: 30, loadedAt: Date.now() });
  context.after(() => warning.close());
  fake.emit(dist, "change", null);
  fake.emit(dist, "rename", "index.js");
  fake.fail(dist);
  fake.emit(checkout, "rename", "dist");
  await pause(400);
  assert.deepEqual(lines, []);
  await appendFile(join(dist, "index.js"), "\n");
  fake.emit(dist, "change", null);
  await until(() => lines.length === 1, () => "The rebuild was not reported");
});

test("a build of 1000 files is read once when the watch starts and compared per event", { timeout: 30_000 }, async (context) => {
  const root = await sandbox(context);
  const checkout = join(root, "meeko");
  await fakeMeeko(checkout);
  const dist = join(checkout, "dist");
  for (let index = 0; index < 1000; index++) await writeFile(join(dist, `file-${index}.js`), "export {};\n");
  const fake = fakeWatch();
  let changes = 0;
  const started = performance.now();
  const watcher = watchLinkedMeeko({ directory: checkout, dist }, () => { changes++; }, { watch: fake.watch, verifyDelay: 20 });
  context.after(() => watcher.close());
  const initial = performance.now() - started;
  fake.emit(dist, "change", null);
  await pause(200);
  assert.equal(changes, 0);
  assert.ok(initial < 1000, `The first scan took ${initial} ms`);
  process.stdout.write(`# 1000 files: first scan ${initial.toFixed(1)} ms\n`);
});
